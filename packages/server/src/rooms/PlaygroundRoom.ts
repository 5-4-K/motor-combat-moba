import { Room, ServerError, matchMaker, type Client } from "@colyseus/core";
import {
  BOT_SESSION_ID,
  DEFAULT_PATCH_RATE_HZ,
  INPUT_MESSAGE,
  MSG_PLAYGROUND_PAUSE,
  MSG_PLAYGROUND_SETUP,
  MSG_PLAYGROUND_SWITCH,
  MSG_PLAYGROUND_TUNING,
  PlayerState,
  PlayerStatus,
  PlaygroundState,
  ROOM_NAME,
  RoomPhase,
  TICK_RATE_HZ,
  defaultPlaygroundSetup,
  isPlaygroundSetup,
  pickColor,
  setTuning,
  validateTuning,
  weaponDefOf,
  type InputMessage,
  type PlaygroundCarSetup,
  type PlaygroundSetup,
} from "@motor-combat-moba/shared";
import { getTickRateHz } from "../mode.js";
import { isInputMessage } from "../net/input-message.js";
import { newCombatMemory, type CombatMemory } from "../sim/combat-bridge.js";
import { newContactMemory, type ContactMemory } from "../sim/ram-bridge.js";
import { botInput, type BotPose } from "./playground-bot.js";
import {
  respawnPlayer,
  respawnSweep,
  runPipeline,
  type PipelineCtx,
} from "./tick-pipeline.js";

/**
 * The level every playground car is held at. Every `unlocksAt` in `WEAPON_TABLE` is at or below it,
 * so no slot the sandbox lets you pick can be dead on arrival — `playground-room.test.ts` pins that
 * against the roster rather than trusting this comment.
 */
export const PLAYGROUND_LEVEL = 3;

/** Same shape as `ROOM_FULL_ERROR`: the string the join screen shows, naming the fix. */
export const ARENA_BUSY_ERROR = "Close the arena first: playground tuning is process-wide";

/**
 * The close code carried with `ARENA_BUSY_ERROR`. Sits alongside `ArenaRoom`'s 4003 (second arena)
 * and 4000/4001/4002 (bad name, taken name, kicked) in the room-defined 4000+ block.
 */
const ARENA_BUSY_CODE = 4004;

/**
 * How often the bot's fire bits are allowed to be set: one tick in this many, zero on the rest. 2 is
 * the smallest value that still produces a press edge every time the bot wants to shoot — see the
 * comment in `enqueueOpponentInput` for why a latched mask fires once and then stops.
 */
const OPPONENT_FIRE_PERIOD = 2;

/**
 * May a playground room open right now? No, if anyone at all is sitting in the arena (spec PG15):
 * the tuning store is a module-level singleton shared by every room in the process, so overrides
 * typed into the playground would silently re-balance a live match next door.
 *
 * Pure, and takes only the field it reads, so the rule is testable without a matchmaker.
 */
export function shouldRefusePlayground(listings: readonly { clients: number }[]): boolean {
  return listings.some((listing) => listing.clients > 0);
}

/**
 * The other of the playground's two cars. There are exactly two — the human's session and the bot's
 * reserved id — so anything that is not the human resolves to the bot and vice versa; an empty or
 * unrecognised id lands on the human rather than inventing a third car.
 */
export function otherPlaygroundId(sessionId: string, humanSessionId: string): string {
  return sessionId === humanSessionId ? BOT_SESSION_ID : humanSessionId;
}

/**
 * The dev-only sandbox room (spec PG3). Registered only behind `DEV_TOOLS=1`, so a release build
 * never defines it and no shipped client can reach it.
 *
 * It reuses `ArenaRoom`'s pipeline verbatim through `tick-pipeline.ts` and shares none of its flow:
 * the phase is pinned to `MATCH` at creation, `reduceFlow` is never called, and there is no win
 * check of any kind (PG6). Death runs the deathmatch respawn machinery forever.
 */
export class PlaygroundRoom extends Room<PlaygroundState> {
  maxClients = 1;
  private inputQueues = new Map<string, InputMessage[]>();
  private prevFireMasks = new Map<string, number>();
  private matchRoster = new Set<string>();
  private phaseCaps = new Map<string, number>();
  private combat: CombatMemory = newCombatMemory();
  private ram: ContactMemory = newContactMemory();
  /** The human's session id, fixed for the room's life. Control routes; identity does not. */
  private humanSessionId = "";
  /**
   * The un-driven car's input `seq`. Monotonic across the room rather than per car, which is all
   * `serverTick` needs — it sorts a batch by seq and acks the highest, and never compares one
   * player's seq to another's.
   */
  private opponentSeq = 0;

  async onCreate(): Promise<void> {
    const listings = await matchMaker.query({ name: ROOM_NAME });
    if (shouldRefusePlayground(listings)) {
      throw new ServerError(ARENA_BUSY_CODE, ARENA_BUSY_ERROR);
    }

    this.setState(new PlaygroundState());
    // Pinned here and never written again (PG6). Nothing in this room reduces a flow, so this is the
    // only thing that ever opens the gate `serverTick` and `runPipeline` both check.
    this.state.phase = RoomPhase.MATCH;
    this.setPatchRate(1000 / DEFAULT_PATCH_RATE_HZ);
    this.setSimulationInterval(() => this.tick(), 1000 / getTickRateHz(TICK_RATE_HZ));

    // Straight into the CONTROLLED car's queue (PG9), and with no latency injection: the playground
    // is a local dev tool, and simulated lag would only make a feel test lie.
    this.onMessage(INPUT_MESSAGE, (_client, msg: unknown) => {
      if (!isInputMessage(msg)) return;
      this.inputQueues.get(this.state.controlledSessionId)?.push(msg);
    });

    this.onMessage(MSG_PLAYGROUND_PAUSE, () => {
      this.state.paused = !this.state.paused;
    });

    this.onMessage(MSG_PLAYGROUND_SWITCH, () => {
      this.state.controlledSessionId = otherPlaygroundId(
        this.state.controlledSessionId,
        this.humanSessionId,
      );
    });

    this.onMessage(MSG_PLAYGROUND_TUNING, (_client, msg: unknown) => {
      const result = validateTuning(msg);
      // Reject-whole (PG13): one bad path discards the blob rather than applying the good half, so
      // the client's view of what is active can never disagree with the store field by field.
      if (!result.ok) return;
      // An empty object IS the reset: `setTuning(null)` restores every table, and `""` is what the
      // client's watcher reads as "clear my store too" (an empty string is not malformed JSON).
      const overrides = Object.keys(result.overrides).length > 0 ? result.overrides : null;
      setTuning(overrides);
      this.state.tuningJson = overrides ? JSON.stringify(overrides) : "";
    });

    this.onMessage(MSG_PLAYGROUND_SETUP, (_client, msg: unknown) => {
      if (!isPlaygroundSetup(msg)) return;
      this.applySetup(msg);
    });
  }

  onJoin(client: Client, options?: { name?: unknown }): void {
    this.humanSessionId = client.sessionId;
    const name = typeof options?.name === "string" && options.name.trim() ? options.name.trim() : "Dev";

    // Two colours drawn from the same table the lobby uses, so the pair reads as two distinct cars.
    // Teams 0 and 1 are visual only: the mode is FFA, so `canDamage` never consults them.
    const human = this.addCar(client.sessionId, name, [], 0);
    this.addCar(BOT_SESSION_ID, "Bot", [human.colorId], 1);

    this.state.controlledSessionId = client.sessionId;
    // Opens the sandbox on the default chassis for both cars, which is also what spawns them: every
    // car/loadout/arena change goes through the one apply path, first one included. The client
    // replays its own stored setup right after joining (PG20), which simply overwrites this.
    this.applySetup(defaultPlaygroundSetup());
  }

  onLeave(): void {
    // Unconditional (PG15). The store is process-wide, so a playground that closes holding overrides
    // would leave the next arena match silently re-balanced.
    setTuning(null);
    this.disconnect();
  }

  onDispose(): void {
    setTuning(null);
  }

  /** One car: the human's or the bot's. Both are schema-ordinary — the client renders them alike. */
  private addCar(sessionId: string, name: string, usedColorIds: number[], team: number): PlayerState {
    const player = new PlayerState();
    player.sessionId = sessionId;
    player.name = name;
    player.colorId = pickColor(usedColorIds, Math.random);
    player.team = team;
    player.joinedAtTick = this.state.tick;
    // In the match from the first tick: there is no lobby, no car select and no countdown to pass
    // through, and `isOnField` gates the mover on exactly this pair of fields.
    player.status = PlayerStatus.IN_MATCH;
    player.alive = true;
    player.level = PLAYGROUND_LEVEL;
    this.state.players.set(sessionId, player);
    this.inputQueues.set(sessionId, []);
    this.prevFireMasks.set(sessionId, 0);
    this.matchRoster.add(sessionId);
    return player;
  }

  /**
   * Apply a validated setup blob (PG16).
   *
   * `me` is ALWAYS the human's session and `opponent` ALWAYS the bot's — identity, not control. The
   * human keeps configuring the same car after a switch, which is what makes "drive the other one
   * for a minute" a view change rather than an edit.
   *
   * A car whose chassis or loadout actually changed is respawned, and so are both cars on an arena
   * change; a car that changed nothing keeps its pose, hp and cooldowns. Stat overrides never come
   * through here — they hot-apply on their own message and disturb nothing.
   */
  private applySetup(setup: PlaygroundSetup): void {
    this.state.botEnabled = setup.botEnabled;
    const arenaChanged = this.state.arenaId !== setup.arenaId;
    if (arenaChanged) this.state.arenaId = setup.arenaId;

    const respawn: string[] = [];
    if (this.applyCarSetup(this.humanSessionId, setup.me) || arenaChanged) {
      respawn.push(this.humanSessionId);
    }
    if (this.applyCarSetup(BOT_SESSION_ID, setup.opponent) || arenaChanged) {
      respawn.push(BOT_SESSION_ID);
    }

    for (const id of respawn) {
      const player = this.state.players.get(id);
      // `respawnPlayer` is the whole of "this car is new": fresh hp for the chassis, a fire state
      // built from the loadout written just above, a spawn away from the other car, spawn
      // protection, and every knock and debuff cleared.
      if (player) respawnPlayer(this.ctx(), player);
    }
  }

  /** Writes one car's chassis and loadout, and reports whether either actually moved. */
  private applyCarSetup(sessionId: string, setup: PlaygroundCarSetup): boolean {
    const player = this.state.players.get(sessionId);
    if (!player) return false;
    const current = this.combat.loadouts.get(sessionId) ?? [];
    if (player.carId === setup.carId && current.join() === setup.weapons.join()) return false;
    player.carId = setup.carId;
    // Held in combat memory rather than only in the fire state, so `toCombatPlayers` compares the
    // running slots against THIS list instead of the chassis's shipped kit — see `CombatMemory`.
    this.combat.loadouts.set(sessionId, [...setup.weapons]);
    return true;
  }

  private tick(): void {
    // Before the increment, so a paused sim freezes coherently (PG7): cooldowns, statuses, respawn
    // timers and shot lifetimes all key off this counter, and none of them may advance alone.
    if (this.state.paused) return;
    this.state.tick += 1;
    respawnSweep(this.ctx());
    this.enqueueOpponentInput();
    // No win check, ever (PG6) — `runPipeline`'s players are deliberately dropped.
    runPipeline(this.ctx());
  }

  /**
   * One input per tick for whichever car the human is NOT driving — the bot's intent with the bot on,
   * a neutral input with it off. Either way it goes through the ordinary input queue, so the "clients
   * send inputs, never state" invariant holds: the bot is a client, just an in-process one.
   */
  private enqueueOpponentInput(): void {
    const opponentId = otherPlaygroundId(this.state.controlledSessionId, this.humanSessionId);
    const self = this.state.players.get(opponentId);
    const queue = this.inputQueues.get(opponentId);
    if (!self || !queue) return;

    this.opponentSeq += 1;
    const seq = this.opponentSeq;

    // Alone mode (PG11) sends a NEUTRAL input, not silence. `serverTick` leaves an input-less player
    // unstepped unless it is carrying a knock, so a dummy handed no input freezes exactly where the
    // bot was switched off — and it keeps the `speed` it was carrying, which `serverTick` reports as
    // that car's `approachSpeeds` on every subsequent tick. `resolveRam` reads that as the approach
    // term, so a parked target dummy scores as an attacker at its last driving speed in every
    // contact, forever. Coasting it on zeros runs it through the ordinary drive model instead: it
    // decelerates and its speed reaches 0, the way letting go of the throttle does.
    if (!this.state.botEnabled) {
      queue.push({ seq, steer: 0, throttle: 0, fireSlots: 0 });
      return;
    }

    const driven = this.state.players.get(this.state.controlledSessionId);
    // A dead target is no target: the bot coasts rather than chasing the wreck's last pose.
    const target = driven?.alive ? poseOf(driven) : null;
    const slots = this.combat.fireStates.get(opponentId)?.slots ?? [];
    const intent = botInput(
      seq,
      poseOf(self),
      target,
      slots.map((slot) => weaponDefOf(slot.weaponId).range),
    );

    // The fire mask is PULSED rather than passed straight through, and that is this room's decision
    // to make rather than `botInput`'s — the bot reports intent, the room decides what reaches the
    // wire, exactly as a real client's key state does.
    //
    // `serverTick` counts only newly-set bits as a press (`clean & ~prev`), so a bot holding the same
    // bits for as long as its target stays in cone and in range fires each slot exactly ONCE and then
    // never again; `respawnPlayer` does not clear `prevFireMasks` either, so a killed bot comes back
    // still latched. Zeroing the bits on odd ticks turns every tick the bot wants to shoot into a
    // fresh press edge. It does not make the bot fire twice as fast: `runCombat`'s stocks, recharges
    // and switch lock are what bound the rate, and feeling those is the whole point of tuning here.
    const pressed = this.state.tick % OPPONENT_FIRE_PERIOD === 0 ? intent.fireSlots : 0;
    queue.push({ ...intent, fireSlots: pressed });
  }

  /**
   * The room's long-lived maps and memory bags, handed to the pipeline for one use. Built fresh at
   * every call, never cached — see the hazard note on `PipelineCtx`.
   */
  private ctx(): PipelineCtx {
    return {
      state: this.state,
      inputQueues: this.inputQueues,
      prevFireMasks: this.prevFireMasks,
      matchRoster: this.matchRoster,
      phaseCaps: this.phaseCaps,
      combat: this.combat,
      ram: this.ram,
      hz: getTickRateHz(TICK_RATE_HZ),
      // True regardless of the mode, which stays FFA_LAST_STANDING: the phased spawn-protection
      // lifecycle has to end and refresh here exactly as it does in a deathmatch, and faking the
      // mode would drag the match clock and the deathmatch HUD along with it.
      runPhaseSweep: true,
    };
  }
}

function poseOf(player: PlayerState): BotPose {
  return { x: player.x, y: player.y, angle: player.angle };
}
