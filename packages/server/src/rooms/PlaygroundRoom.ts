import { Room, ServerError, matchMaker, type Client } from "@colyseus/core";
import {
  DEFAULT_PATCH_RATE_HZ,
  INPUT_MESSAGE,
  MSG_PLAYGROUND_BOT_DEBUG,
  MSG_PLAYGROUND_PAUSE,
  MSG_PLAYGROUND_SETUP,
  MSG_PLAYGROUND_TUNING,
  PLAYGROUND_ROOM_NAME,
  PLAYGROUND_SEATS,
  PLAYGROUND_SEAT_IDS,
  PRACTICE_ROOM_NAME,
  PlayerState,
  PlayerStatus,
  PlaygroundState,
  ROOM_NAME,
  TICK_RATE_HZ,
  defaultPlaygroundSetup,
  isBotDifficulty,
  isPlaygroundSetup,
  newCombatEvents,
  applyOverrides,
  validateTuning,
  DEFAULT_GAME_MODE,
  modeConfigOrDefault,
  type CombatEvents,
  type FiredEvent,
  type InputMessage,
  type ModeConfig,
  type PlaygroundCarSetup,
  type PlaygroundSetup,
} from "@motor-combat-moba/shared";
import { getTickRateHz } from "../mode.js";
import { isInputMessage } from "../net/input-message.js";
import { forgetCombatPlayer, newCombatMemory, type CombatMemory } from "../sim/combat-bridge.js";
import { forgetContactPlayer, newContactMemory, type ContactMemory } from "../sim/ram-bridge.js";
import {
  buildBotView,
  botConfigOf,
  botRingCapacity,
  deriveSeed,
  makeRng,
  snapshotWorld,
  HumanController,
  ViewRing,
  type BotController,
  type BotModeConfig,
  type Rng,
} from "../bot/index.js";
import { shouldRejectSecondArena } from "./singleton-arena.js";
import { beginCountdown, countdownSweep } from "./countdown.js";
import {
  respawnPlayer,
  respawnSweep,
  runPipeline,
  type PipelineCtx,
} from "./tick-pipeline.js";
import { scoped } from "./mode-scope.js";

/**
 * The level every playground car is held at. Every `unlocksAt` in `weapons()` is at or below it,
 * so no slot the sandbox lets you pick can be dead on arrival — `playground-room.test.ts` pins that
 * against the roster rather than trusting this comment.
 */
export const PLAYGROUND_LEVEL = 3;

/** Same shape as `ROOM_FULL_ERROR`: the string the join screen shows, naming the fix. */
export const ARENA_BUSY_ERROR =
  "Someone is in a match right now. Close the arena and any practice session, then try again";

/**
 * The close code carried with `ARENA_BUSY_ERROR`. Sits alongside `ArenaRoom`'s 4003 (second arena)
 * and 4000/4001/4002 (bad name, taken name, kicked) in the room-defined 4000+ block.
 */
const ARENA_BUSY_CODE = 4004;

/**
 * The string a second playground tab sees. `maxClients = 1` only keeps ONE client out of a given
 * room; `joinOrCreate` on a full room asks Colyseus to make a new one, and nothing before this guard
 * stopped it (PG15). Same "name the fix" shape as `ARENA_BUSY_ERROR`.
 */
export const PLAYGROUND_BUSY_ERROR = "A playground session is already open";

/** The close code carried with `PLAYGROUND_BUSY_ERROR`, next in the room-defined 4000+ block. */
const PLAYGROUND_BUSY_CODE = 4005;

/**
 * May a playground room open right now? No, if anyone at all is sitting in the arena OR in a
 * practice room (spec PG15, widened by PR10).
 *
 * **The reason this guard was written is gone (MC39/MC40).** It was a tuning-leak guard: the tuning
 * store was a module-level singleton shared by every room in the process, so overrides typed into
 * the playground silently re-balanced a live match — or a player's practice session — next door.
 * Tuning is per-room now (`applyOverrides` into this room's own `this.modeConfig`, installing
 * nothing), so that particular leak cannot happen any more. What is left is the weaker, still-true
 * claim that a playground is a dev tool nobody should be running beside a real match — a
 * `DEV_TOOLS=1` process shares its CPU, its bots and its matchmaker with those rooms. Whether that
 * still justifies refusing the room outright is the user's call, and deliberately not made here:
 * removing a safety guard is not a comment edit.
 *
 * Practice rooms are registered on EVERY process, the `npm run dev` one included, which is why they
 * count here at all.
 *
 * Pure, and takes only the field it reads, so the rule is testable without a matchmaker.
 */
export function shouldRefusePlayground(
  arenaListings: readonly { clients: number }[],
  practiceListings: readonly { clients: number }[],
): boolean {
  const busy = (listing: { clients: number }): boolean => listing.clients > 0;
  return arenaListings.some(busy) || practiceListings.some(busy);
}

/**
 * Which seat is this session id, or -1 (spec PG57).
 *
 * Every car in this room is a seat and nothing else is: a client's Colyseus session id owns no car
 * here, which is what makes handing the wheel to another car a single write to
 * `controlledSessionId`. `indexOf` over six frozen strings rather than a parsed suffix, so
 * `"pg-99"` and `"pg-0x1"` are simply not seats instead of being clamped into one.
 */
export function seatIndexOf(sessionId: string): number {
  return PLAYGROUND_SEAT_IDS.indexOf(sessionId);
}

/**
 * Does this setup change actually require a respawn? Chassis and loadout do; **colour does not**
 * (PG32) — repainting a car mid-test must not reset its hp, cooldowns and pose. Pure and exported so
 * the rule is a test rather than a comment inside a room method.
 */
export function loadoutOrChassisChanged(
  currentCarId: string,
  currentWeapons: readonly string[],
  setup: PlaygroundCarSetup,
): boolean {
  return currentCarId !== setup.carId || currentWeapons.join() !== setup.weapons.join();
}

/**
 * The dev-only sandbox room (spec PG3). Registered only behind `DEV_TOOLS=1`, so a release build
 * never defines it and no shipped client can reach it.
 *
 * It reuses `ArenaRoom`'s pipeline verbatim through `tick-pipeline.ts` and shares none of its flow:
 * `reduceFlow` is never called, and there is no win check of any kind (PG6). Death runs the
 * deathmatch respawn machinery forever. The phase is written by `countdown.ts` alone — an opening
 * `COUNTDOWN` that `countdownSweep` turns into the `MATCH` the room then stays in for its life.
 */
export class PlaygroundRoom extends Room<PlaygroundState> {
  maxClients = 1;
  private inputQueues = new Map<string, InputMessage[]>();
  private prevFireMasks = new Map<string, number>();
  /** Consecutive empty-queue ticks per session; see `PipelineCtx.silentTicks`. */
  private silentTicks = new Map<string, number>();
  private matchRoster = new Set<string>();
  private phaseCaps = new Map<string, number>();
  private combat: CombatMemory = newCombatMemory();
  private ram: ContactMemory = newContactMemory();
  /**
   * Fed to the pipeline as `PipelineCtx.events` and drained every tick (below): this is what makes
   * `BotView.observedFires` non-empty here, which is what feeds ult memory and vengefulness (B18).
   * Draining matters as much as populating it — a `CombatEvents` bag nothing ever clears would grow
   * for the life of the room, and a playground session has no match end to reclaim it at.
   */
  private readonly botEvents: CombatEvents = newCombatEvents();
  /**
   * The mode's bot bundle (MC29), resolved from the same `DEFAULT_GAME_MODE` `modeConfig` below is
   * — declared ahead of it so `botRing`'s field initializer, which runs first, can read it.
   */
  private readonly botConfig: BotModeConfig = botConfigOf(DEFAULT_GAME_MODE);
  /** One tick's world, N ticks deep (B19) — owned here because "the world N ticks ago" does not
   * depend on which bot is asking, and this room has exactly one. */
  private readonly botRing = new ViewRing(botRingCapacity(this.botConfig));
  /** This tick's view of "what the bot just saw fired" — last tick's fires, sliced off the drained
   * bag before it was cleared. */
  private previousTickFires: readonly FiredEvent[] = [];
  /**
   * The un-driven cars' input `seq`. Monotonic across the room rather than per car, which is all
   * `serverTick` needs — it sorts a batch by seq and acks the highest, and never compares one
   * player's seq to another's.
   */
  private opponentSeq = 0;
  /**
   * One bot per seat (B10, spec PG69). Rebuilt when the difficulty changes — a profile is
   * constructor state — and dropped wholesale whenever a setup arrives, the bot is switched off or
   * the wheel moves, which is the three-case staleness rule (PG29) applied per seat.
   */
  private bots = new Map<string, BotController>();
  /**
   * A distinct, seeded stream per seat rather than one shared stream: two seats sharing an RNG would
   * make each bot's draw depend on the other's turn order, which is not what "seat 3's bot" means.
   * The same reasoning `packages/server/balance/match.ts` already runs six seats on. The BASE seed is
   * a constant because the playground is interactive — the streams exist to be independent, not to
   * make the sandbox reproducible.
   */
  private readonly botRngs = new Map<string, Rng>(
    PLAYGROUND_SEAT_IDS.map((id, seat) => [id, makeRng(deriveSeed(1, "playground-seat", seat))]),
  );
  /**
   * The bundle this room's session runs inside. Resolved from `DEFAULT_GAME_MODE` initially — the
   * playground has no mode picker of its own. Every entry point below runs wrapped in
   * `scoped(this.modeConfig, ...)` so nothing here reads whatever bundle another room last happened
   * to install (MC15, MC21).
   *
   * **Mutable, not `readonly` (2026-09-22 final review, tuning-inert-server-side fix; rewired onto
   * `applyOverrides` for MC39/MC40).** The `MSG_PLAYGROUND_TUNING` handler below re-assigns this
   * field to `applyOverrides`'s return value — a brand-new sibling bundle built from this room's own
   * pristine base, with nothing installed process-wide. Reassigning the field is the ONLY way a
   * tuned bundle reaches this room at all: `applyOverrides` has no side effect to lean on in the
   * first place (unlike the old `setTuning`, there is no module-level `installMode` write it could
   * even try to trust), so if the handler did not capture its return value here the tuned bundle
   * would simply be built and immediately discarded. What the reassignment defeats is `scoped`'s own
   * `finally`: this whole handler already runs inside `scoped(this.modeConfig, ...)`, i.e.
   * `withMode(this.modeConfig, fn)`, which restores the module-level "current" bundle to whatever
   * `this.modeConfig` was BEFORE the handler ran the instant `fn` returns — so a tuned bundle that
   * only ever lived as the module-level "current" one would still be lost the moment the handler
   * returned. Reassigning the field is what makes a tuned value actually reach a subsequent tick —
   * see `PlaygroundRoom.test.ts` for the regression test.
   */
  private modeConfig: ModeConfig = modeConfigOrDefault(DEFAULT_GAME_MODE);

  async onCreate(): Promise<void> {
    const listings = await matchMaker.query({ name: ROOM_NAME });
    const practiceListings = await matchMaker.query({ name: PRACTICE_ROOM_NAME });
    if (shouldRefusePlayground(listings, practiceListings)) {
      throw new ServerError(ARENA_BUSY_CODE, ARENA_BUSY_ERROR);
    }

    // Second query (PG15, updated MC39/MC40). This used to be about tuning specifically: `setTuning`
    // wrote a module-level, one-per-process store, so two playground rooms alive at once could fight
    // over it, and either one closing would wipe the tables the other still thought were active. Now
    // that tuning lives on each room's own `this.modeConfig` instead, that particular reason is gone
    // — but the playground is still meant to be a singleton dev tool, one at a time, and nothing else
    // has stepped in to justify running two concurrently. `maxClients = 1` does not enforce that on
    // its own: it only rejects a second CLIENT, and `joinPlayground`'s `joinOrCreate` reacts to a full
    // room by asking Colyseus to create another one. Reuses `shouldRejectSecondArena` unchanged — "any
    // listed room besides myself" is exactly the rule here too.
    const playgroundListings = await matchMaker.query({ name: PLAYGROUND_ROOM_NAME });
    if (shouldRejectSecondArena(playgroundListings, this.roomId)) {
      throw new ServerError(PLAYGROUND_BUSY_CODE, PLAYGROUND_BUSY_ERROR);
    }

    // Everything below this point is synchronous — the room has awaited its last matchmaker query
    // above — so it runs as one `scoped` stretch, the same shape `ArenaRoom.onCreate` uses (MC15).
    scoped(this.modeConfig, () => {
      this.setState(new PlaygroundState());
      // Nothing in this room reduces a flow, so `countdown.ts` is the only thing that ever writes the
      // gate `serverTick` and `runPipeline` both check (PG6). Opening on COUNTDOWN rather than MATCH
      // is what keeps the room from running live ticks between creation and the player's arrival —
      // `onJoin` re-stamps it once the cars are placed, and `countdownSweep` opens the match.
      beginCountdown(this.state);
      this.setPatchRate(1000 / DEFAULT_PATCH_RATE_HZ);
      this.setSimulationInterval(
        () => scoped(this.modeConfig, () => this.tick()),
        1000 / getTickRateHz(TICK_RATE_HZ),
      );

      // Straight into the CONTROLLED car's queue (PG9), and with no latency injection: the playground
      // is a local dev tool, and simulated lag would only make a feel test lie.
      this.onMessage(INPUT_MESSAGE, (_client, msg: unknown) =>
        scoped(this.modeConfig, () => {
          if (!isInputMessage(msg)) return;
          this.inputQueues.get(this.state.controlledSessionId)?.push(msg);
        }),
      );

      this.onMessage(MSG_PLAYGROUND_PAUSE, () =>
        scoped(this.modeConfig, () => {
          this.state.paused = !this.state.paused;
        }),
      );

      this.onMessage(MSG_PLAYGROUND_TUNING, (_client, msg: unknown) =>
        scoped(this.modeConfig, () => this.applyTuningMessage(msg)),
      );

      this.onMessage(MSG_PLAYGROUND_SETUP, (_client, msg: unknown) =>
        scoped(this.modeConfig, () => {
          if (!isPlaygroundSetup(msg)) return;
          this.applySetup(msg);
        }),
      );
    });
  }

  onJoin(_client: Client, _options?: { name?: unknown }): void {
    scoped(this.modeConfig, () => {
      // No car is created here. `applySetup` is the one path that adds, removes and configures cars
      // (PG66), and it runs below with whatever this browser last saved replayed over it moments later
      // by `PlaygroundScene` (PG20). The human's session id names no car at all (PG57).
      this.applySetup(defaultPlaygroundSetup());
      // After the cars are spawned, so the 3-2-1 counts the player's own three seconds rather than
      // ticks the room burned before they connected. Deliberately NOT re-stamped by `applySetup`
      // itself: this is a MATCH-start countdown, and re-running it on every weapon swap would put a
      // three-second freeze between the tester and every edit.
      beginCountdown(this.state);
    });
  }

  onLeave(): void {
    scoped(this.modeConfig, () => {
      this.disconnect();
    });
  }

  onDispose(): void {
    // Nothing to do here any more (MC39/MC40). `applyTuningMessage` used to call the process-wide
    // `setTuning`, so a playground closing with overrides still active would leave the NEXT room —
    // arena or another playground — silently re-balanced by them, which is why this hook and
    // `onLeave` above used to unconditionally reset that global store on the way out (PG15). Tuning
    // now lives entirely on this room's own `this.modeConfig` field: `applyOverrides` builds a
    // sibling bundle and installs nothing process-wide, so the field dies with the room and there is
    // no shared store left for a later room to inherit.
  }

  /**
   * Validate and apply one `MSG_PLAYGROUND_TUNING` blob — extracted out of the `onMessage` closure
   * (2026-09-22 final review) so a test can drive it directly, the same way `applySetup` already is,
   * rather than only through Colyseus's own message dispatch.
   *
   * Reject-whole (PG13): one bad path discards the blob rather than applying the good half, so the
   * client's view of what is active can never disagree with the store field by field.
   */
  private applyTuningMessage(msg: unknown): void {
    // Tuning REPLACES, never accumulates (PG13): every call starts fresh from the room's own
    // pristine base — the same `modeConfigOrDefault(DEFAULT_GAME_MODE)` bundle the `modeConfig`
    // field was seeded from, NOT `this.modeConfig`, which may already carry a previous blob's
    // overrides.
    //
    // Resolved BEFORE validation, and handed to `validateTuning`, because the paths and ranges a
    // blob is judged against have to be the ones of the bundle it is about to be written into. The
    // validator used to walk the raw `config/` globals, which are nobody's mode; while both shipped
    // modes stay byte-identical that agreed with this bundle by coincidence, not by construction.
    // The client's own panel resolves the same bundle through `dev/playground/tuning-base.ts` —
    // that function and this line are the pair that move together if the playground ever grows a
    // mode picker.
    const base = modeConfigOrDefault(DEFAULT_GAME_MODE);
    const result = validateTuning(base, msg);
    if (!result.ok) return;
    // An empty object IS the reset: it drops the room back onto its pristine base bundle two lines
    // below, and `""` is what the client's watcher reads as "clear my store too" (an empty string is
    // not malformed JSON).
    const overrides = Object.keys(result.overrides).length > 0 ? result.overrides : null;
    // `applyOverrides` builds a new sibling bundle and installs nothing; assigning it to
    // `this.modeConfig` (see that field's own doc comment) is what makes a subsequent tick's
    // `scoped(this.modeConfig, ...)` actually adopt the tuned numbers.
    this.modeConfig = overrides ? applyOverrides(base, overrides) : base;
    this.state.tuningJson = overrides ? JSON.stringify(overrides) : "";
  }

  /**
   * Apply a validated setup blob (PG16/PG66) — the one path that adds, removes and configures cars.
   *
   * A seat is identified by its index, never by who is driving it: the human keeps configuring seat
   * 3 after taking the wheel of seat 5, which is what makes "drive that one for a minute" a view
   * change rather than an edit.
   *
   * A car whose chassis or loadout actually changed is respawned, and so is every enabled car on an
   * arena change; a car that changed nothing keeps its pose, hp and cooldowns. A COLOUR change never
   * respawns (PG32). Stat overrides never come through here — they hot-apply on their own message.
   */
  private applySetup(setup: PlaygroundSetup): void {
    this.state.botEnabled = setup.botEnabled;
    this.state.botDifficulty = setup.botDifficulty;
    // Any setup change can invalidate a held intent — a new chassis drives differently, a new
    // difficulty has a different cadence, the wheel may have moved, and a bot may have just been
    // switched off (PG29). Dropping every controller is the whole of that rule.
    this.bots.clear();
    this.state.controlledSessionId = PLAYGROUND_SEAT_IDS[setup.drivenSeat]!;
    const arenaChanged = this.state.arenaId !== setup.arenaId;
    if (arenaChanged) this.state.arenaId = setup.arenaId;

    const respawn: string[] = [];
    for (let seat = 0; seat < PLAYGROUND_SEATS; seat++) {
      const id = PLAYGROUND_SEAT_IDS[seat]!;
      const car = setup.cars[seat]!;
      const existing = this.state.players.get(id);

      if (!car.enabled) {
        if (existing) this.removeSeat(id);
        continue;
      }
      if (!existing) {
        this.addCar(id, `Car ${seat + 1}`, car.colorId, seat % 2);
        this.applyCarSetup(id, car);
        respawn.push(id);
        continue;
      }
      if (this.applyCarSetup(id, car) || arenaChanged) respawn.push(id);
    }

    for (const id of respawn) {
      const player = this.state.players.get(id);
      // `respawnPlayer` is the whole of "this car is new": fresh hp for the chassis, a fire state
      // built from the loadout written just above, a spawn away from the other cars, spawn
      // protection, and every knock and debuff cleared.
      if (player) respawnPlayer(this.ctx(), player);
    }
  }

  /** Writes one seat's chassis, loadout and colour, and reports whether a RESPAWN is owed. Colour is
   * always written and never owes one (PG32). */
  private applyCarSetup(sessionId: string, setup: PlaygroundCarSetup): boolean {
    const player = this.state.players.get(sessionId);
    if (!player) return false;
    const current = this.combat.loadouts.get(sessionId) ?? [];
    // Written before the early return, so a colour-only edit still repaints. `ArenaScene` keys its
    // car container on `carId:colorId:alive`, so this reaches the screen on the next patch.
    player.colorId = setup.colorId;
    if (!loadoutOrChassisChanged(player.carId, current, setup)) return false;
    player.carId = setup.carId;
    // Held in combat memory rather than only in the fire state, so `toCombatPlayers` compares the
    // running slots against THIS list instead of the chassis's shipped kit — see `CombatMemory`.
    this.combat.loadouts.set(sessionId, [...setup.weapons]);
    return true;
  }

  /**
   * Take one seat off the field (PG67).
   *
   * Every per-session map, not merely `state.players`: a seat switched back on later must arrive as
   * a NEW car, never inheriting a stale target lock, a half-finished maneuver, a ram-falloff stack
   * or a contact pair from its previous life. The two `forget*` helpers own the memory bags; the
   * four maps here are this room's own.
   */
  private removeSeat(sessionId: string): void {
    this.state.players.delete(sessionId);
    this.inputQueues.delete(sessionId);
    this.prevFireMasks.delete(sessionId);
    this.silentTicks.delete(sessionId);
    this.matchRoster.delete(sessionId);
    this.phaseCaps.delete(sessionId);
    this.bots.delete(sessionId);
    forgetCombatPlayer(this.combat, sessionId);
    forgetContactPlayer(this.ram, sessionId);
  }

  /** One seat's car. Schema-ordinary — the client renders every seat alike. */
  private addCar(sessionId: string, name: string, colorId: number, team: number): PlayerState {
    const player = new PlayerState();
    player.sessionId = sessionId;
    player.name = name;
    // Straight from the setup (PG73). The old `pickColor(used, Math.random)` draw was overwritten by
    // `applyCarSetup` on the same pass, so it was never observed — and it was the one `Math.random`
    // call in a room that otherwise runs off seeded streams.
    player.colorId = colorId;
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
    this.silentTicks.set(sessionId, 0);
    this.matchRoster.add(sessionId);
    return player;
  }

  private tick(): void {
    // Before the increment, so a paused sim freezes coherently (PG7): cooldowns, statuses, respawn
    // timers and shot lifetimes all key off this counter, and none of them may advance alone.
    if (this.state.paused) return;
    this.state.tick += 1;
    // Top of the tick, before anything reads the phase, and below the pause return so that pausing
    // during the 3-2-1 freezes the 3-2-1 too.
    countdownSweep(this.state);
    respawnSweep(this.ctx());
    // Before the bot decides, not after: `buildBotView` reads `this.botRing.at(tick - staleness)`
    // for THIS tick, so this tick's world has to already be in the ring by the time the bot asks.
    this.botRing.push(snapshotWorld(this.state, this.combat));
    this.enqueueAiInputs();

    // Every 6 ticks (5 Hz): a debug read-out that updates 30 times a second is unreadable, and this
    // is a dev-only room, so the bandwidth is not the reason for the throttle.
    const debug = this.debugBot()?.debug();
    if (debug && this.state.tick % 6 === 0) {
      this.broadcast(MSG_PLAYGROUND_BOT_DEBUG, {
        tick: debug.tick,
        situation: debug.situation,
        targetSessionId: debug.targetSessionId ?? "",
        preferredRange: Math.round(debug.preferredRange),
        personality: debug.personality,
        firedSlot: debug.firedSlot ?? -1,
        dangerEv: Math.round(debug.dangerEv),
        // `debug.plan` is `undefined` only before the bot's first recompute window. 0/0/0 is NOT a
        // sentinel — coast at a score of zero is a plan the planner can genuinely choose — but the
        // `terms` line beside it does carry one (`-`, see below), and the two are written from the
        // same `debug` in the same tick, so the overlay never shows a plan without its breakdown.
        planSteer: debug.plan?.steer ?? 0,
        planThrottle: debug.plan?.throttle ?? 0,
        planScore: Math.round((debug.plan?.score ?? 0) * 100) / 100,
        // Copied WHOLESALE, never term by term: `BotDebug.planTerms` is keyed off `PlanWeights`
        // itself, so entry-copying is what carries that derivation across the wire. Naming the six
        // terms here would compile cleanly against a seven-term `PlanWeights` and silently drop the
        // new one — see `BotDebugPayload.terms`. Absent before the bot's first recompute window,
        // where `{}` prints a `-` on the overlay (`termLine`, R-C4) — the same "nothing to report"
        // sentinel `firedSlot: -1` gets above. Until that fix the label was followed by nothing at
        // all, which reads as a broken renderer rather than as an empty reading.
        terms: Object.fromEntries(
          Object.entries(debug.planTerms ?? {}).map(([k, v]) => [k, Math.round(v * 100) / 100]),
        ),
        shotEvBest: Math.round(debug.shotEv.best),
        shotEvThreshold: Math.round(debug.shotEv.threshold),
      });
    }

    // No win check, ever (PG6) — `runPipeline`'s players are deliberately dropped.
    runPipeline(this.ctx());
    // This tick's fires, ready for next tick's view, and the bag drained so a long playground
    // session does not accumulate every event of the session in a sink nothing else reads.
    this.previousTickFires = this.botEvents.fired.slice();
    this.botEvents.fired.length = 0;
    this.botEvents.damaged.length = 0;
    this.botEvents.killed.length = 0;
  }

  /**
   * One input per tick for every enabled seat the human is NOT driving — that seat's bot intent with
   * the bot on, a neutral input with it off. Either way it goes through the ordinary input queue, so
   * the "clients send inputs, never state" invariant holds: a bot is a client, just an in-process one.
   */
  private enqueueAiInputs(): void {
    const driven = this.state.controlledSessionId;
    const difficulty = isBotDifficulty(this.state.botDifficulty) ? this.state.botDifficulty : "medium";

    for (const id of PLAYGROUND_SEAT_IDS) {
      if (id === driven) continue;
      const queue = this.inputQueues.get(id);
      // No queue means the seat is off the field. Nothing to drive.
      if (!queue) continue;

      // A fresh `seq` every tick, held intent or not: `serverTick` wants one input per tick per car,
      // and reusing a sequence number reads as a duplicate rather than a repeat. Monotonic across the
      // room rather than per seat, which is all `serverTick` needs — it sorts a batch by seq and acks
      // the highest, and never compares one player's seq to another's.
      this.opponentSeq += 1;
      const seq = this.opponentSeq;

      // Alone mode (PG11/PG71) sends a NEUTRAL input, not silence. `serverTick` leaves an input-less
      // player unstepped unless it is carrying a knock, so a dummy handed no input freezes exactly
      // where the bot was switched off — and it KEEPS the velocity it was carrying, which
      // `serverTick` reports as that car's `approachVelocities` on every subsequent tick.
      // `resolveRam` reads that as the drive-in term, so a parked dummy scores as an attacker at its
      // last driving speed in every contact, forever. Coasting it on zeros runs it through the
      // ordinary drive model instead.
      if (!this.state.botEnabled) {
        this.bots.delete(id);
        queue.push({ seq, steer: 0, throttle: 0, fireSlots: 0 });
        continue;
      }

      // `!bot ||` rather than `bot?.profileId !==`: the optional-chain form is equivalent at
      // runtime but leaves `bot` typed `BotController | undefined` after the block, so
      // `bot.decide(view)` below would not compile. Assigning in the `!bot` branch is what narrows it.
      let bot = this.bots.get(id);
      if (!bot || bot.profileId !== difficulty) {
        // No `targetSessionId` (PG70): each bot resolves its own target through `pickTarget` against
        // everything it can see, so a six-car brawl is a brawl rather than five cars queueing to
        // chase the human.
        bot = new HumanController(difficulty, { botConfig: this.botConfig });
        this.bots.set(id, bot);
      }

      const view = buildBotView({
        state: this.state,
        selfSessionId: id,
        combat: this.combat,
        rng: this.botRngs.get(id)!,
        observedFires: this.previousTickFires,
        stalenessTicks: this.botConfig.profiles[difficulty].viewStalenessTicks,
        ring: this.botRing,
      });
      // No car for this seat: push NOTHING. An input queued for a session that is not in
      // `state.players` is never consumed by `serverTick`, and would be read as a stale intent if
      // that seat were re-added.
      if (!view) continue;

      queue.push({ seq, ...bot.decide(view) });
    }
  }

  /**
   * Whose thoughts the debug read-out prints (spec PG72).
   *
   * H12's read-out is ONE bot's, and five stacked two-line entries over the arena would be
   * unreadable — so: the first seat, in seat order, whose bot is currently targeting the car the
   * human is driving; failing that, the first bot seat there is. Recomputed at every broadcast
   * window and never held, or a controller held across its seat being switched off would keep
   * broadcasting a dead bot's last thought.
   */
  private debugBot(): HumanController | undefined {
    let fallback: HumanController | undefined;
    for (const id of PLAYGROUND_SEAT_IDS) {
      const bot = this.bots.get(id);
      if (!(bot instanceof HumanController)) continue;
      fallback ??= bot;
      if (bot.currentTargetSessionId === this.state.controlledSessionId) return bot;
    }
    return fallback;
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
      silentTicks: this.silentTicks,
      matchRoster: this.matchRoster,
      phaseCaps: this.phaseCaps,
      combat: this.combat,
      ram: this.ram,
      hz: getTickRateHz(TICK_RATE_HZ),
      // True regardless of the mode, which stays FFA_LAST_STANDING: the phased spawn-protection
      // lifecycle has to end and refresh here exactly as it does in a deathmatch, and faking the
      // mode would drag the match clock and the deathmatch HUD along with it.
      runPhaseSweep: true,
      events: this.botEvents,
    };
  }
}
