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
  winRuleOf,
  getArena,
  hpOf,
  isActiveCarId,
  DEATHMATCH_TICKS,
  farthestSpawn,
  isDueToRespawn,
  phaseDecision,
  applyStatus,
  newFireState,
  hasStatus,
  carHullOf,
  obbsOverlap,
  isSolid,
  carIdOf,
  deathmatchEnded,
  deathmatchOutcome,
  type CarId,
  type DeathmatchPlayer,
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
import { readStatuses, statusTick, writeStatuses } from "../sim/status-bridge.js";
import {
  clearKnock,
  contactTick,
  newContactMemory,
  type ContactMemory,
  type ContactTickResult,
} from "../sim/ram-bridge.js";
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
  /**
   * Per-player tick at which spawn protection must end no matter what. Server-only: the client reads
   * the status row's own `endsTick`, and this is the ceiling that row may never pass.
   */
  private phaseCaps = new Map<string, number>();
  private postMatchIds = new Set<string>();
  private flow: FlowState | null = null;
  /**
   * The instance id counter, per-player fire state, and the live instances themselves. Server-only
   * by design: none of it is anything a client needs to render, and putting it on the schema would
   * patch per-instance timers with no wire representation to everyone at the tick rate for no
   * visible gain.
   */
  private combat: CombatMemory = newCombatMemory();
  private ram: ContactMemory = newContactMemory();

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
    this.phaseCaps.delete(client.sessionId);

    if (this.state.hostSessionId === client.sessionId) {
      const remaining: { sessionId: string; joinedAtTick: number }[] = [];
      this.state.players.forEach((player) => {
        remaining.push({ sessionId: player.sessionId, joinedAtTick: player.joinedAtTick });
      });
      this.state.hostSessionId = selectNextHost(remaining);
    }

    if (!wasInMatch || !wasInRoster || this.state.phase === RoomPhase.LOBBY) return;

    if (winRuleOf(this.state.mode) === "deathmatch") {
      this.checkDeathmatchEnd();
      return;
    }

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
      this.state.phase === RoomPhase.MATCH &&
      winRuleOf(this.state.mode) === "deathmatch"
    ) {
      this.respawnSweep();
    }
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
    // Contact, after driving and before combat. The order is the rule: contacts are measured against
    // the poses driving actually produced, and the knock written here is read by stepDrive next tick.
    // Dash hits and hard slams it finds this tick are priced by combat below, in phase 0d.
    //
    // `approachSpeeds` is the one thing contact must NOT read from the poses driving produced.
    // Contact resolution reflected `speed` on its way through `serverTick`, so the post-drive value
    // is the rebound, not the impact — see `TickResult.approachSpeeds`.
    let contact: ContactTickResult = { contactHits: [], statusRequests: [] };
    if (this.state.phase === RoomPhase.MATCH && this.matchRoster.size > 0) {
      contact = contactTick(
        this.state,
        this.matchRoster,
        this.ram,
        sidesOf(this.state.mode),
        statusMods,
        approachSpeeds,
        this.combat.maneuverWeapons,
        this.state.tick,
      );
    }
    this.combatTick(dt, masks, contact);
  }

  /**
   * Combat, after driving. The order is the rule, not an implementation detail: hits are tested
   * against the poses cars actually ended the tick at, not where they were a moment before.
   *
   * Only `MATCH` runs combat, and only with a live roster. Outside that the whole thing is skipped
   * and any instance still in flight is cleared — a shot that survived into the lobby would be
   * drawn to everyone and could never hit anything.
   */
  private combatTick(dt: number, masks: ReadonlyMap<string, number>, contact: ContactTickResult): void {
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
      contactHits: contact.contactHits,
      statusRequests: contact.statusRequests,
    });

    applyCombatResult(this.state, result, this.combat);
    this.combat.instanceSeq = result.instanceSeq;

    if (winRuleOf(this.state.mode) === "deathmatch") this.phaseEndSweep(masks);

    // Win check every tick, on the state combat just wrote.
    if (winRuleOf(this.state.mode) === "deathmatch") {
      this.checkDeathmatchEnd();
      return;
    }

    // `livingSides` counts only roster members who are still alive, so a wreck and a disconnect end
    // the match by the same rule.
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

  /**
   * Deathmatch never asks `livingSides` (M25). With respawns every player can be dead at once while
   * their timers run, and that would read as a draw and end the match under everyone's feet.
   */
  private checkDeathmatchEnd(): void {
    const players: DeathmatchPlayer[] = [];
    for (const id of this.matchRoster) {
      const player = this.state.players.get(id);
      if (!player) continue;
      players.push({ sessionId: id, kills: player.kills, deaths: player.deaths, inRoster: true });
    }

    if (!deathmatchEnded(players.length, this.state.tick, this.state.matchEndsTick)) return;
    const outcome = deathmatchOutcome(players);
    this.endMatch(outcome.winnerSessionId, outcome.winnerTeam);
  }

  /**
   * Bring back everyone whose respawn timer has run out.
   *
   * Runs at the TOP of the tick, before `statusTick`, and that placement is the decision (M21):
   * writing the status list here means the modifiers derived moments later already include `phased`,
   * so there is no tick on which a freshly respawned car is solid. The documented `statusRequests`
   * seam is the right route for a pickup and the wrong one here, because by design a request lands
   * this tick and bites on the NEXT one — precisely the window a spawn must not have.
   */
  private respawnSweep(): void {
    for (const id of this.matchRoster) {
      const player = this.state.players.get(id);
      if (!player || player.alive) continue;
      if (!isDueToRespawn(player.diedAtTick, this.state.tick)) continue;
      this.respawn(player);
    }
  }

  /** One car back on the field. Nothing survives a death except the score. */
  private respawn(player: PlayerState): void {
    const enemies: { x: number; y: number }[] = [];
    for (const id of this.matchRoster) {
      if (id === player.sessionId) continue;
      const other = this.state.players.get(id);
      if (other?.alive) enemies.push({ x: other.x, y: other.y });
    }

    const spawn = farthestSpawn(getArena(this.state.arenaId).ffaSpawns, enemies);
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = spawn.angle;
    player.speed = 0;
    // Or the car returns already spinning, its steering still degraded by the ram that killed it.
    clearKnock(player);

    const carId = carIdOf(player);
    player.hp = hpOf(carId);
    player.alive = true;
    player.diedAtTick = 0;
    player.killedBySessionId = "";

    // No stock, no switch lock and no half-finished burst carries across a death.
    this.combat.fireStates.set(player.sessionId, newFireState(carId, player.level));
    // Or whoever last hurt you before this death is credited with your next one.
    this.combat.lastDamagers.set(player.sessionId, "");

    this.phaseCaps.set(player.sessionId, this.state.tick + DEATHMATCH_TICKS.phaseMax);
    // Applied to an EMPTY list, not to the car's current one: every debuff goes with the wreck, so a
    // lingering slow cannot ride back onto the field with a car that was just rebuilt.
    writeStatuses(
      player,
      applyStatus([], "phased", this.state.tick, DEATHMATCH_TICKS.phase, ""),
    );
  }

  /**
   * End spawn protection, per `phaseDecision`.
   *
   * Runs at the END of the tick, unlike `respawnSweep`, and the asymmetry is deliberate: this needs
   * the fire masks the tick actually simulated and the poses driving finally settled on. A one-tick
   * lag on *ending* protection is harmless; a one-tick lag on *starting* it would leave a car solid
   * on its spawn frame.
   */
  private phaseEndSweep(masks: ReadonlyMap<string, number>): void {
    const tick = this.state.tick;
    for (const id of this.matchRoster) {
      const player = this.state.players.get(id);
      if (!player) continue;

      const rows = readStatuses(player);
      if (!hasStatus(rows, "phased", tick)) {
        this.phaseCaps.delete(id);
        continue;
      }
      const phase = rows.find((s) => s.statusId === "phased");
      if (!phase) continue;

      const action = phaseDecision({
        tick,
        endsTick: phase.endsTick,
        capTick: this.phaseCaps.get(id) ?? tick,
        fired: (masks.get(id) ?? 0) !== 0,
        overlapping: this.overlapsSolid(player),
      });

      if (action === "run") continue;
      if (action === "drop") {
        writeStatuses(player, rows.filter((s) => s.statusId !== "phased"));
        this.phaseCaps.delete(id);
        continue;
      }
      // `refresh` extends rather than overwrites, which is what `chainable` exists to permit for a
      // flag-carrying row. Two ticks, so the new end is strictly beyond the one about to lapse.
      writeStatuses(player, applyStatus(rows, "phased", tick, 2, ""));
    }
  }

  /** Is this car's hull touching any car that is actually solid right now? */
  private overlapsSolid(player: PlayerState): boolean {
    const hull = carHullOf(player.x, player.y, player.angle);
    for (const id of this.matchRoster) {
      if (id === player.sessionId) continue;
      const other = this.state.players.get(id);
      if (!other || !isSolid(other, this.state.tick)) continue;
      if (obbsOverlap(hull, carHullOf(other.x, other.y, other.angle))) return true;
    }
    return false;
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
      // 0 in every other mode: nothing reads it there, and a stale non-zero value would hand the
      // client's HUD a clock to count down that means nothing.
      this.state.matchEndsTick =
        winRuleOf(this.state.mode) === "deathmatch"
          ? this.state.tick + DEATHMATCH_TICKS.match
          : 0;
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
      // The score is match-scoped, and this is the only match boundary that owns it. `PlayerState`
      // lives as long as the connection, not as long as the match, and the only other writers are
      // the increments in `combat-bridge.ts` and the per-respawn clear in `respawn` — so without
      // this, match two is scored on match one's totals, a player who joined for match two starts
      // behind accumulated numbers they never earned, `uint8` eventually wraps past 255, and the
      // Last Standing and Team scoreboards show a running career tally where they promise a match.
      player.kills = 0;
      player.deaths = 0;
      player.killedBySessionId = "";
      player.diedAtTick = 0;
    }
    // Nothing from the previous match survives into this one: no shots in flight, and no stale fire
    // state (a stock or a switch lock the new car never earned).
    clearInstances(this.state, this.combat);
    this.ram = newContactMemory();
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
    this.phaseCaps.clear();
    // The match clock is written only on the edge INTO `MATCH`, so a finished deathmatch's value
    // would otherwise survive the whole of the next match's LOBBY, CAR_SELECT, REVEAL and
    // COUNTDOWN. `viewFor` routes COUNTDOWN to the arena scene and `syncDeathmatchHud` has no phase
    // gate, so last match's countdown clock draws over the next match's 3-2-1 — including a Last
    // Standing one, which has no match clock at all. Same rule as `phaseCaps` above: nothing this
    // match ends holding is allowed to be read by the next one.
    this.state.matchEndsTick = 0;
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
    isActiveCarId((msg as { carId?: unknown }).carId)
  );
}
