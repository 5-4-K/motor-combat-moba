import { Room, ServerError, matchMaker, type Client } from "@colyseus/core";
import {
  ArenaState,
  PlayerState,
  INPUT_MESSAGE,
  MAX_PLAYERS,
  ROOM_NAME,
  DEFAULT_PATCH_RATE_HZ,
  TICK_RATE_HZ,
  FLOW_CONFIG,
  GameMode,
  PlayerStatus,
  RoomPhase,
  MSG_SWITCH_TEAM,
  MSG_SET_MODE,
  MSG_START_MATCH,
  MSG_KICK,
  MSG_START_ERROR,
  MSG_SELECT_CAR,
  MSG_PREVIEW_CAR,
  MSG_RETURN_TO_LOBBY,
  validateName,
  isNameTaken,
  pickColor,
  pickTeam,
  canStart,
  canSwitchTeam,
  reduceFlow,
  assignSpawns,
  livingSides,
  sidesOf,
  getArena,
  hpOf,
  isCarId,
  type CarId,
  type FlowEvent,
  type FlowPlayer,
  type FlowState,
  type InputMessage,
  type StartRulePlayer,
} from "@motor-combat-moba/shared";
import {
  getTickRateHz,
  getSimulatedLatency,
  getCarSelectSeconds,
  getRevealSeconds,
} from "../mode.js";
import { isInputMessage } from "../net/input-message.js";
import { withSimulatedLatency } from "../net/latency-injector.js";
import { serverTick } from "../sim/tick.js";
import {
  applyCombatResult,
  clearInstances,
  newCombatMemory,
  runCombat,
  toCombatPlayers,
  toInstances,
  type CombatMemory,
} from "../sim/combat-bridge.js";
import { statusTick } from "../sim/status-bridge.js";
import { clearKnock, newRamMemory, ramTick, type RamMemory } from "../sim/ram-bridge.js";
import {
  fromFlowPhase,
  fromFlowStatus,
  toFlowPhase,
  toFlowStatus,
} from "./flow-map.js";
import {
  carAtDeadline,
  copySpawnNumbers,
  livingAfterLeave,
} from "./match-helpers.js";
import { selectNextHost } from "./select-next-host.js";
import { ROOM_FULL_ERROR, shouldRejectSecondArena } from "./singleton-arena.js";

export class ArenaRoom extends Room<ArenaState> {
  maxClients = MAX_PLAYERS;
  private inputQueues = new Map<string, InputMessage[]>();
  /**
   * What each player's last SIMULATED input had held down, so `serverTick` can tell a press from a
   * held key. Server-only and never networked: the client does not predict firing, so nothing on the
   * other half of the lockstep needs it.
   */
  private prevFireMasks = new Map<string, number>();
  private pendingCarId = new Map<string, CarId>();
  private matchRoster = new Set<string>();
  private postMatchIds = new Set<string>();
  private flow: FlowState | null = null;
  /**
   * The instance id counter, per-player fire state, and the live instances themselves. Server-only
   * by design: none of it is anything a client needs to render, and putting it on the schema would
   * patch per-instance timers with no wire representation to everyone at the tick rate for no
   * visible gain.
   */
  private combat: CombatMemory = newCombatMemory();
  private ram: RamMemory = newRamMemory();

  async onCreate(): Promise<void> {
    const listings = await matchMaker.query({ name: ROOM_NAME });
    if (shouldRejectSecondArena(listings, this.roomId)) {
      throw new ServerError(4003, ROOM_FULL_ERROR);
    }

    this.setState(new ArenaState());
    this.setPatchRate(1000 / DEFAULT_PATCH_RATE_HZ);
    const hz = getTickRateHz(TICK_RATE_HZ);
    this.setSimulationInterval(() => this.tick(), 1000 / hz);

    const enqueue = withSimulatedLatency<{ sessionId: string; msg: InputMessage }>(
      ({ sessionId, msg }) => {
        const q = this.inputQueues.get(sessionId);
        if (q) q.push(msg);
      },
      getSimulatedLatency(),
    );

    this.onMessage(INPUT_MESSAGE, (client, msg: unknown) => {
      if (!isInputMessage(msg)) return;
      enqueue({ sessionId: client.sessionId, msg });
    });

    this.onMessage(MSG_SWITCH_TEAM, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const teams: number[] = [];
      this.state.players.forEach((p) => teams.push(p.team));
      // Same predicate the lobby uses to grey the button out; the client cannot be trusted to have
      // run it, so the cap is decided here.
      if (!canSwitchTeam({ status: toFlowStatus(player.status), team: player.team }, teams)) return;
      player.team = player.team === 0 ? 1 : 0;
    });

    this.onMessage(MSG_SET_MODE, (client, msg: unknown) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.hasPlayerInMatch()) return;
      if (!isSetModePayload(msg)) return;
      this.state.mode = msg.mode;
    });

    this.onMessage(MSG_KICK, (client, msg: unknown) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (!isKickPayload(msg)) return;
      if (msg.sessionId === client.sessionId) return;
      const target = this.state.players.get(msg.sessionId);
      if (!target) return;
      if (target.status !== PlayerStatus.READY && target.status !== PlayerStatus.POST_MATCH) {
        return;
      }
      const targetClient = this.clients.find((c) => c.sessionId === msg.sessionId);
      if (targetClient) targetClient.leave(4002, "Kicked");
    });

    this.onMessage(MSG_START_MATCH, (client) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.state.phase !== RoomPhase.LOBBY) return;
      const players: StartRulePlayer[] = [];
      const readyIds: string[] = [];
      this.state.players.forEach((player) => {
        players.push({ status: toFlowStatus(player.status), team: player.team });
        if (player.status === PlayerStatus.READY) readyIds.push(player.sessionId);
      });
      const result = canStart(this.state.mode, players);
      if (!result.ok) {
        client.send(MSG_START_ERROR, { error: result.error });
        return;
      }
      this.reduce({
        type: "start",
        readyIds,
        nowTick: this.state.tick,
        carSelectTicks: getCarSelectSeconds(FLOW_CONFIG.carSelectSeconds) * TICK_RATE_HZ,
      });
      this.pendingCarId.clear();
    });

    this.onMessage(MSG_SELECT_CAR, (client, msg: unknown) => {
      if (this.state.phase !== RoomPhase.CAR_SELECT) return;
      if (!isSelectCarPayload(msg)) return;
      if (!this.matchRoster.has(client.sessionId)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.selectLocked) return;
      this.pendingCarId.set(client.sessionId, msg.carId);
      this.reduce({ type: "lock_car", sessionId: client.sessionId });
      if (this.allRosterLocked()) this.revealCars();
    });

    // A preview, not a commitment: it records what the player is sitting on so the deadline can hand
    // them that exact car. Same guards as MSG_SELECT_CAR minus the lock, and it
    // deliberately refuses once locked so a stray click cannot rewrite a committed pick.
    this.onMessage(MSG_PREVIEW_CAR, (client, msg: unknown) => {
      if (this.state.phase !== RoomPhase.CAR_SELECT) return;
      if (!isSelectCarPayload(msg)) return;
      if (!this.matchRoster.has(client.sessionId)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.selectLocked) return;
      this.pendingCarId.set(client.sessionId, msg.carId);
    });

    this.onMessage(MSG_RETURN_TO_LOBBY, (client) => {
      if (!this.postMatchIds.has(client.sessionId)) return;
      this.reduce({ type: "return_to_lobby", sessionId: client.sessionId });
    });
  }

  onJoin(client: Client, options?: { name?: unknown }): void {
    const nameResult = validateName(String(options?.name ?? ""));
    if (!nameResult.ok) {
      throw new ServerError(4000, nameResult.error);
    }

    const names: string[] = [];
    const teams: number[] = [];
    const colorIds: number[] = [];
    this.state.players.forEach((player) => {
      names.push(player.name);
      teams.push(player.team);
      colorIds.push(player.colorId);
    });

    if (isNameTaken(names, nameResult.name)) {
      throw new ServerError(4001, "Name is taken");
    }

    const index = this.state.players.size;
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.name = nameResult.name;
    player.colorId = pickColor(colorIds, Math.random);
    player.team = pickTeam(teams, Math.random);
    player.joinedAtTick = this.state.tick;
    player.status = PlayerStatus.READY;
    player.x = 400 + 80 * index;
    player.y = 300;
    this.state.players.set(client.sessionId, player);
    this.inputQueues.set(client.sessionId, []);
    this.prevFireMasks.set(client.sessionId, 0);
    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }
  }

  onLeave(client: Client): void {
    const leaving = this.state.players.get(client.sessionId);
    const wasInMatch = leaving?.status === PlayerStatus.IN_MATCH;
    const wasInRoster = this.matchRoster.has(client.sessionId);

    this.state.players.delete(client.sessionId);
    this.inputQueues.delete(client.sessionId);
    this.prevFireMasks.delete(client.sessionId);
    this.pendingCarId.delete(client.sessionId);
    this.postMatchIds.delete(client.sessionId);
    this.matchRoster.delete(client.sessionId);

    if (this.state.hostSessionId === client.sessionId) {
      const remaining: { sessionId: string; joinedAtTick: number }[] = [];
      this.state.players.forEach((player) => {
        remaining.push({ sessionId: player.sessionId, joinedAtTick: player.joinedAtTick });
      });
      this.state.hostSessionId = selectNextHost(remaining);
    }

    if (!wasInMatch || !wasInRoster || this.state.phase === RoomPhase.LOBBY) return;

    const remainingPlayers: { sessionId: string; team: 0 | 1; alive: boolean }[] = [];
    this.state.players.forEach((player) => {
      remainingPlayers.push({
        sessionId: player.sessionId,
        team: player.team === 1 ? 1 : 0,
        alive: player.alive,
      });
    });
    const result = livingSides(
      sidesOf(this.state.mode),
      livingAfterLeave(remainingPlayers, this.matchRoster),
    );
    if (result.sides <= 1) {
      this.endMatch(result.winnerSessionId, result.winnerTeam);
    }
  }

  private tick(): void {
    this.state.tick += 1;
    if (
      this.state.phase === RoomPhase.CAR_SELECT &&
      this.state.tick >= this.state.carSelectDeadlineTick
    ) {
      for (const id of this.matchRoster) {
        const player = this.state.players.get(id);
        if (!player || player.selectLocked) continue;
        this.pendingCarId.set(id, carAtDeadline(this.pendingCarId.get(id)));
        this.reduce({ type: "lock_car", sessionId: id });
      }
      this.revealCars();
    } else if (
      this.state.phase === RoomPhase.REVEAL &&
      this.state.tick >= this.state.revealEndsTick
    ) {
      // The grid has held its dwell; hand over to the 3-2-1 on the field.
      this.reduce({
        type: "begin_countdown",
        nowTick: this.state.tick,
        countdownTicks: FLOW_CONFIG.countdownSeconds * TICK_RATE_HZ,
      });
    } else if (
      this.state.phase === RoomPhase.COUNTDOWN &&
      this.state.tick >= this.state.countdownEndsTick
    ) {
      this.reduce({ type: "go" });
    }
    const dt = 1 / getTickRateHz(TICK_RATE_HZ);
    // Buffs and debuffs FIRST, before anything reads a modifier. `statusTick` sweeps every expired
    // effect and returns the multipliers driving, ramming and combat all share for this tick, so no
    // two phases can disagree about whether a car is still slowed, and no tick ever simulates an
    // effect whose last tick was the previous one. New effects are only ever added at the far end of
    // the tick, by combat, and take hold on the next one.
    const statusMods = statusTick(this.state, this.state.tick);
    const { masks, approachSpeeds } = serverTick(
      this.state,
      this.inputQueues,
      dt,
      this.state.phase,
      statusMods,
      this.prevFireMasks,
    );
    // Ramming, after driving and before combat. The order is the rule: contacts are measured against
    // the poses driving actually produced, and the knock written here is read by stepDrive next tick.
    //
    // `approachSpeeds` is the one thing ram must NOT read from the poses driving produced. Contact
    // resolution reflected `speed` on its way through `serverTick`, so the post-drive value is the
    // rebound, not the impact — see `TickResult.approachSpeeds`.
    if (this.state.phase === RoomPhase.MATCH && this.matchRoster.size > 0) {
      ramTick(
        this.state,
        this.matchRoster,
        this.ram,
        sidesOf(this.state.mode),
        statusMods,
        approachSpeeds,
      );
    }
    this.combatTick(dt, masks);
  }

  /**
   * Combat, after driving. The order is the rule, not an implementation detail: hits are tested
   * against the poses cars actually ended the tick at, not where they were a moment before.
   *
   * Only `MATCH` runs combat, and only with a live roster. Outside that the whole thing is skipped
   * and any instance still in flight is cleared — a shot that survived into the lobby would be
   * drawn to everyone and could never hit anything.
   */
  private combatTick(dt: number, masks: ReadonlyMap<string, number>): void {
    if (this.state.phase !== RoomPhase.MATCH || this.matchRoster.size === 0) {
      if (this.state.weapons.size > 0) clearInstances(this.state, this.combat);
      return;
    }

    const arena = getArena(this.state.arenaId);
    const result = runCombat({
      world: {
        tick: this.state.tick,
        dt,
        mode: sidesOf(this.state.mode),
        obstacles: arena.obstacles,
        bounds: { width: arena.width, height: arena.height },
      },
      players: toCombatPlayers(this.state, this.matchRoster, masks, this.combat),
      instances: toInstances(this.combat),
      instanceSeq: this.combat.instanceSeq,
    });

    applyCombatResult(this.state, result, this.combat);
    this.combat.instanceSeq = result.instanceSeq;

    // Win check every tick, on the state combat just wrote. `livingSides` counts only roster
    // members who are still alive, so a wreck and a disconnect end the match by the same rule.
    const outcome = livingSides(
      sidesOf(this.state.mode),
      result.players.map((p) => ({
        sessionId: p.sessionId,
        team: p.team,
        alive: p.alive,
        inRoster: p.inRoster,
      })),
    );
    if (outcome.sides <= 1) {
      this.endMatch(outcome.winnerSessionId, outcome.winnerTeam);
    }
  }

  private reduce(event: FlowEvent): void {
    this.applyFlow(reduceFlow(this.buildFlow(), event));
  }

  private buildFlow(): FlowState {
    const players: FlowPlayer[] = [];
    this.state.players.forEach((player) => {
      players.push({
        sessionId: player.sessionId,
        team: player.team === 1 ? 1 : 0,
        status: toFlowStatus(player.status),
        carId: player.carId,
        selectLocked: player.selectLocked,
        alive: player.alive,
      });
    });
    return {
      phase: toFlowPhase(this.state.phase),
      mode: sidesOf(this.state.mode),
      tick: this.state.tick,
      carSelectDeadlineTick: this.state.carSelectDeadlineTick,
      revealEndsTick: this.state.revealEndsTick,
      countdownEndsTick: this.state.countdownEndsTick,
      roster: [...this.matchRoster],
      postMatchIds: [...this.postMatchIds],
      winnerSessionId: this.state.winnerSessionId,
      winnerTeam: this.state.winnerTeam,
      players,
    };
  }

  private applyFlow(next: FlowState): void {
    const previousPhase = this.state.phase;
    this.flow = next;
    this.state.phase = fromFlowPhase(next.phase);
    // Stamp the match clock on the edge into MATCH, not on every tick inside it, so the results
    // duration counts from the green light rather than resetting under its own feet.
    if (this.state.phase === RoomPhase.MATCH && previousPhase !== RoomPhase.MATCH) {
      this.state.matchStartedAtTick = this.state.tick;
    }
    this.state.carSelectDeadlineTick = next.carSelectDeadlineTick;
    this.state.revealEndsTick = next.revealEndsTick;
    this.state.countdownEndsTick = next.countdownEndsTick;
    this.state.winnerSessionId = next.winnerSessionId;
    this.state.winnerTeam = next.winnerTeam;
    this.matchRoster = new Set(next.roster);
    this.postMatchIds = new Set(next.postMatchIds);
    for (const fp of next.players) {
      const player = this.state.players.get(fp.sessionId);
      if (!player) continue;
      player.carId = fp.carId;
      player.selectLocked = fp.selectLocked;
      player.alive = fp.alive;
    }
    this.syncPlayerStatus();
  }

  private syncPlayerStatus(): void {
    if (!this.flow) return;
    for (const fp of this.flow.players) {
      const player = this.state.players.get(fp.sessionId);
      if (player) player.status = fromFlowStatus(fp.status);
    }
  }

  private allRosterLocked(): boolean {
    if (this.matchRoster.size === 0) return false;
    for (const id of this.matchRoster) {
      const player = this.state.players.get(id);
      if (!player || !player.selectLocked) return false;
    }
    return true;
  }

  /** Assigns cars, places everyone, and opens the reveal grid. The countdown follows on its deadline. */
  private revealCars(): void {
    const cars: Record<string, string> = {};
    for (const [sessionId, carId] of this.pendingCarId) {
      cars[sessionId] = carId;
    }
    let next = reduceFlow(this.buildFlow(), { type: "reveal", cars });
    next = reduceFlow(next, {
      type: "begin_reveal",
      nowTick: this.state.tick,
      revealTicks: getRevealSeconds(FLOW_CONFIG.revealSeconds) * TICK_RATE_HZ,
    });
    this.applyFlow(next);

    const roster: { sessionId: string; team: 0 | 1 }[] = [];
    for (const id of this.matchRoster) {
      const player = this.state.players.get(id);
      if (!player) continue;
      roster.push({ sessionId: id, team: player.team === 1 ? 1 : 0 });
      const carId = this.pendingCarId.get(id);
      if (carId) {
        player.carId = carId;
        player.hp = hpOf(carId);
      }
      player.speed = 0;
      // Nothing from the previous match survives into this one — a knock included, or a car would
      // spawn already spinning with its steering degraded.
      clearKnock(player);
    }
    // Nothing from the previous match survives into this one: no shots in flight, and no stale fire
    // state (a stock or a switch lock the new car never earned).
    clearInstances(this.state, this.combat);
    this.ram = newRamMemory();
    const spawns = assignSpawns(
      getArena(this.state.arenaId),
      this.state.mode,
      roster,
      Math.random,
    );
    for (const id of this.matchRoster) {
      const player = this.state.players.get(id);
      const spawn = spawns[id];
      if (!player || !spawn) continue;
      const pose = copySpawnNumbers(spawn);
      player.x = pose.x;
      player.y = pose.y;
      player.angle = pose.angle;
    }
  }

  private endMatch(winnerSessionId: string, winnerTeam: number): void {
    this.reduce({ type: "end", winnerSessionId, winnerTeam });
    this.matchRoster.clear();
    this.pendingCarId.clear();
    clearInstances(this.state, this.combat);
  }

  private hasPlayerInMatch(): boolean {
    let found = false;
    this.state.players.forEach((player) => {
      if (player.status === PlayerStatus.IN_MATCH) found = true;
    });
    return found;
  }
}

function isSetModePayload(msg: unknown): msg is { mode: GameMode } {
  if (msg === null || typeof msg !== "object") return false;
  const mode = (msg as { mode?: unknown }).mode;
  return (
    mode === GameMode.FFA_LAST_STANDING ||
    mode === GameMode.TEAM ||
    mode === GameMode.FFA_DEATHMATCH
  );
}

function isKickPayload(msg: unknown): msg is { sessionId: string } {
  return (
    msg !== null &&
    typeof msg === "object" &&
    typeof (msg as { sessionId?: unknown }).sessionId === "string"
  );
}

function isSelectCarPayload(msg: unknown): msg is { carId: CarId } {
  return (
    msg !== null &&
    typeof msg === "object" &&
    isCarId((msg as { carId?: unknown }).carId)
  );
}
