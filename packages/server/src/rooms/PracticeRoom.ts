import { Room, ServerError, matchMaker, type Client } from "@colyseus/core";
import {
  BOT_SESSION_ID,
  GameMode,
  INPUT_MESSAGE,
  isInputPacket,
  newTickInputBuffer,
  MSG_PRACTICE_IDLE_WARNING,
  MSG_PRACTICE_PAUSE,
  MSG_SPECTATE_TARGET,
  PLAYGROUND_ROOM_NAME,
  PRACTICE_CONFIG,
  PRACTICE_FULL_CLOSE_CODE,
  PRACTICE_FULL_ERROR,
  PRACTICE_IDLE_CLOSE_CODE,
  PRACTICE_INVALID_SETUP_CLOSE_CODE,
  PRACTICE_INVALID_SETUP_ERROR,
  PRACTICE_PLAYGROUND_BUSY_CLOSE_CODE,
  PRACTICE_PLAYGROUND_BUSY_ERROR,
  PRACTICE_ROOM_NAME,
  PlayerState,
  PlayerStatus,
  PracticeState,
  MS_PER_TICK,
  TICK_RATE_HZ,
  assignSpawns,
  getArena,
  isPracticeSetup,
  pickColor,
  newCombatEvents,
  modeConfigOrDefault,
  type BotDifficulty,
  type CarId,
  type CombatEvents,
  type FiredEvent,
  type InputPacket,
  type TickInputBuffer,
  type ModeConfig,
  type PracticeSetup,
} from "@motor-combat-moba/shared";
import { getMaxPracticeRooms, getSimulatedLatency } from "../mode.js";
import { offerForTick } from "../net/offer-input.js";
import { InputDelay, OutgoingDelay } from "../net/latency-injector.js";
import { assertProtocol } from "../net/protocol-gate.js";
import { ViewManager, ensureView, viewersOf } from "../net/view-manager.js";
import { ClientLimits, MAX_MESSAGES_PER_SECOND, limited, refuseUnknownMessages } from "../net/rate-limit.js";
import { newCombatMemory, type CombatMemory } from "../sim/combat-bridge.js";
import { newContactMemory, type ContactMemory } from "../sim/ram-bridge.js";
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
} from "../bot/index.js";
import { copySpawnNumbers } from "./match-helpers.js";
import {
  isActiveInput,
  isIdleWarningDue,
  isPracticeIdle,
  resolveOpponentCar,
  shouldRefusePractice,
  shouldRefusePracticeForPlayground,
} from "./practice-rules.js";
import { beginCountdown, countdownSweep } from "./countdown.js";
import { isSnapshotTick } from "./snapshot-cadence.js";
import {
  respawnPlayer,
  respawnSweep,
  runPipeline,
  type PipelineCtx,
} from "./tick-pipeline.js";
import { scoped } from "./mode-scope.js";
import { newRoomStepper } from "./fixed-step.js";
import { NetSessions, installNetHandlers, netNowMs } from "../net/net-session.js";

/**
 * The room's opening state, exported so the two decisions in it are pinned by a test rather than by
 * this comment (spec PR9).
 *
 * `phase` opens on `COUNTDOWN`, not `MATCH`. Nothing in this room reduces a flow, so `countdown.ts`
 * is the only thing that ever writes the gate `serverTick` and `runPipeline` both check: it opens
 * here, is re-stamped from the join tick once the cars exist, and is flipped to `MATCH` by
 * `countdownSweep` at the top of the tick. Opening on `COUNTDOWN` rather than pinning `MATCH` and
 * counting down afterwards matters — the room ticks from creation, so the other order would run a
 * few ticks of live match before the player had even arrived to see the 3.
 *
 * `mode` is Deathmatch, and `matchEndsTick` is deliberately left at 0. `matchClockLabel` returns ""
 * for a non-positive value, so the HUD drops the clock with no client conditional, while
 * `rulesOf(mode).winRuleLabel === "deathmatch"` keeps the kills panel lit. `runPipeline` reads the mode only
 * through `rulesOf(mode).sides`, which answers "ffa" for both FFA modes, so nothing else in the sim
 * changes.
 */
export function newPracticeState(): PracticeState {
  const state = new PracticeState();
  beginCountdown(state);
  state.mode = GameMode.FFA_DEATHMATCH;
  // Deathmatch's own arena (MC23, MC26), resolved from the same pinned `GameMode.FFA_DEATHMATCH`
  // constant `state.mode` was just set from — never `this.state.mode` and never `ACTIVE_ARENA_ID` —
  // so the two can never disagree, the same reasoning `PracticeRoom.modeConfig`'s field comment
  // gives for the bundle itself.
  state.arenaId = modeConfigOrDefault(GameMode.FFA_DEATHMATCH).arenas[0];
  return state;
}

/**
 * Player-facing practice: the shipped game with one bot in it (spec PR1).
 *
 * Deliberately NOT a copy of `PlaygroundRoom`. There is no tuning (PR10), no control routing
 * (PR12), no mid-session setup message (PR7) and no singleton guard (PR4) — Colyseus minting one
 * room per player is the feature here, not a bug to suppress.
 *
 * **This room never installs a mode bundle process-wide.** It reads config the way every room does,
 * through `scoped(this.modeConfig, ...)`, which puts its own bundle in place for the duration of a
 * handler and restores the previous one on the way out. `installMode` does not restore anything —
 * the module-level "current bundle" is one per server PROCESS, not one per room — so calling it here
 * would hand this room's numbers to every other room in the process, a live match next door
 * included. (Until MC39/MC40 the same leak had a different name: the playground's `setTuning`, which
 * installed process-wide, and which this room was forbidden to call for exactly this reason.
 * `setTuning` is gone; the rule is now about `installMode`, which is the only way left to cause it.)
 * `practice-room.test.ts` reads this source with comments stripped, so naming `installMode` right
 * here cannot fail that test.
 */
export class PracticeRoom extends Room<{ state: PracticeState }> {
  maxClients = 1;
  /** Colyseus's pre-decode backstop above the NR54 token buckets; see `MAX_MESSAGES_PER_SECOND`. */
  maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;

  private readonly inputBuffers = new Map<string, TickInputBuffer>();
  private readonly prevFireMasks = new Map<string, number>();
  private readonly matchRoster = new Set<string>();
  private readonly phaseCaps = new Map<string, number>();
  private readonly combat: CombatMemory = newCombatMemory();
  private readonly ram: ContactMemory = newContactMemory();
  /**
   * Fed to the pipeline as `PipelineCtx.events` and drained every tick (below): this is what makes
   * `BotView.observedFires` non-empty here, which is what feeds ult memory and vengefulness (B18).
   * Draining matters as much as populating it — a `CombatEvents` bag nothing ever clears would grow
   * for the life of the room, and a practice session has no match end to reclaim it at.
   */
  private readonly botEvents: CombatEvents = newCombatEvents();
  /**
   * The mode's bot bundle (MC29), resolved from the same pinned constant `modeConfig` below is —
   * declared ahead of it so `botRing`'s field initializer, which runs first, can read it.
   */
  private readonly botConfig: BotModeConfig = botConfigOf(GameMode.FFA_DEATHMATCH);
  /** One tick's world, N ticks deep (B19) — owned here because "the world N ticks ago" does not
   * depend on which bot is asking, and this room has exactly one. */
  private readonly botRing = new ViewRing(botRingCapacity(this.botConfig));
  /** This tick's view of "what the bot just saw fired" — last tick's fires, sliced off the drained
   * bag before it was cleared. */
  private previousTickFires: readonly FiredEvent[] = [];

  private humanSessionId = "";
  /** The bot, as an instance (B10). Built once: practice has no mid-session reconfiguration. */
  private bot: BotController | undefined;
  private readonly botRng = makeRng(deriveSeed(1, "practice-bot"));
  /**
   * Written once in `onCreate` and never again (PR19): a match's opponent does not get easier
   * halfway through, so neither does the bot. Changing it means exiting and starting again.
   */
  private difficulty: BotDifficulty = "medium";
  private setup: PracticeSetup | undefined;

  /** Wall-clock stamp of the last input received (PR27). Not a tick: a paused sim must still age. */
  private lastInputAtMs = Date.now();
  /** Latched so the warning is sent once per quiet stretch, not on every tick inside the window. */
  private warnedOfIdle = false;
  /**
   * The bundle this room's match runs inside. Unlike `ArenaRoom`, never re-resolved: `newPracticeState`
   * pins `mode` to `GameMode.FFA_DEATHMATCH` for the life of the room (PR9/MC22), so there is no
   * `MSG_SET_MODE` equivalent here and no LOBBY window to resolve a different mode in. Resolved
   * straight from that same constant rather than from `this.state.mode` — the two can never disagree,
   * and this field exists before `setState` runs. Every entry point below runs wrapped in
   * `scoped(this.modeConfig, ...)` so nothing here reads whatever bundle another room last happened to
   * install (MC15, MC21).
   */
  private readonly modeConfig: ModeConfig = modeConfigOrDefault(GameMode.FFA_DEATHMATCH);
  /** Turns interval frames into whole ticks at exactly `TICK_RATE_HZ` (Phase C I1). */
  private readonly stepper = newRoomStepper();
  /** Time-sync state (NR18, NR19): the tick grid pongs describe and each session's measured RTT. */
  private readonly netSessions = new NetSessions();
  /** Per-client message budgets (NR54); every handler below is charged to one. */
  private readonly limits = new ClientLimits();
  /** Who receives what (NR44–NR47), the same manager every room kind runs. */
  private readonly views = new ViewManager();
  /** Server → client latency injection (NR56), mirroring `ArenaRoom` (PR11); inactive unless SIM_LATENCY_MS is set. */
  private readonly outgoing = new OutgoingDelay(getSimulatedLatency());
  /** Client → server latency injection (NR56), one in-order line per session; built in `onCreate`. */
  private inputDelay: InputDelay<{ sessionId: string; msg: InputPacket }> | undefined;
  /**
   * Latched at the first close, because `disconnect()` is asynchronous and the simulation interval
   * can fire again before the room is gone — without this the idle sweep would keep kicking clients
   * that have already left.
   */
  private closing = false;

  async onCreate(options?: unknown): Promise<void> {
    // The join options reach `onCreate` too (Colyseus merges the client's options into the create
    // call), so the setup is validated once, before the room exists, rather than on join.
    //
    // Scoped (2026-09-22 final review): `isPracticeSetup` reads mode-scoped config transitively —
    // `isActiveCarId` goes through `cars()` — and this is the FIRST thing this method does, on a
    // process that may never have installed any bundle at all (nothing does at server startup).
    // Unscoped, this threw "config read outside a mode scope" on the very first practice room a
    // fresh process ever created — masked in tests only because every one of them installs a mode
    // globally in its own `beforeEach` before touching the room. `this.modeConfig` is a class field,
    // already initialised by the time `onCreate` runs, so it is available here before any of the
    // `await`s below.
    //
    // The predicate's narrowing has to come back OUT of the callback (2026-09-23): wrapping
    // `isPracticeSetup(options)` in `scoped` buries the type guard inside a closure, where it
    // narrows nothing and leaves `options` as `unknown` for the assignments below. Returning the
    // value itself — `options` when it passed, `undefined` when it did not — carries the narrowed
    // type out through `scoped`'s return, so `setup` is a `PracticeSetup` with no assertion.
    // An old client is told to refresh (NR55) rather than that its setup is invalid.
    assertProtocol(options);
    const setup = scoped(this.modeConfig, () => (isPracticeSetup(options) ? options : undefined));
    if (setup === undefined) {
      throw new ServerError(PRACTICE_INVALID_SETUP_CLOSE_CODE, PRACTICE_INVALID_SETUP_ERROR);
    }

    const listings = await matchMaker.query({ name: PRACTICE_ROOM_NAME });
    // Defensive, not currently load-bearing: the room may or may not already be in
    // `listings` depending on when Colyseus saves the listing relative to `onCreate`. The filter is
    // safe either way, and keeps this room from counting itself toward its own cap.
    const others = listings.filter((entry) => entry.roomId !== this.roomId);
    if (shouldRefusePractice(others, getMaxPracticeRooms(PRACTICE_CONFIG.maxConcurrentRooms))) {
      throw new ServerError(PRACTICE_FULL_CLOSE_CODE, PRACTICE_FULL_ERROR);
    }

    // The mirror `shouldRefusePlayground` does not cover on its own (PR10): that guard stops a NEW
    // playground from opening over a live practice session, but a playground already open when this
    // room is being created would run it on process-wide tables an arena is not using. Only
    // reachable on a `DEV_TOOLS=1` process — a release server never calls `gameServer.define` for
    // `PLAYGROUND_ROOM_NAME` (see `index.ts`), so a release practice room can never be refused here.
    const playgroundListings = await matchMaker.query({ name: PLAYGROUND_ROOM_NAME });
    if (shouldRefusePracticeForPlayground(playgroundListings)) {
      throw new ServerError(PRACTICE_PLAYGROUND_BUSY_CLOSE_CODE, PRACTICE_PLAYGROUND_BUSY_ERROR);
    }

    this.setup = setup;
    this.difficulty = setup.difficulty;

    // Everything below this point is synchronous — the room has awaited its last matchmaker query
    // above — so it runs as one `scoped` stretch, the same shape `ArenaRoom.onCreate` uses (MC15).
    scoped(this.modeConfig, () => {
      this.setState(newPracticeState());
      this.setSimulationInterval((deltaMs) => this.onFrame(deltaMs), MS_PER_TICK);
      // No patch timer (NR12): `tick()` broadcasts at the end of every snapshot tick itself, so a
      // snapshot is always the state of exactly one tick and carries that tick. Assigned AFTER
      // `setSimulationInterval`: Colyseus 0.18's `patchRate` setter otherwise arms a stray clock
      // interval.
      this.patchRate = null;
      installNetHandlers(this, this.netSessions, (fn) => scoped(this.modeConfig, fn), this.limits, (client, send) =>
        this.outgoing.delayOutgoing(client, send),
      );
      refuseUnknownMessages(this);

      // Mirrors `ArenaRoom`'s injector (PR11). The playground deliberately skips it — simulated lag
      // makes a feel test lie — but practice takes the opposite decision for the reason it exists:
      // strict mirror means practice must feel like the arena on the same deploy. The knobs are off in
      // a release build, where `InputDelay` delivers straight through.
      this.inputDelay = new InputDelay<{ sessionId: string; msg: InputPacket }>(
        ({ sessionId, msg }) => {
          // Bounded without a cap of its own (review F3's concern): `tick()` returns before
          // `serverTick` runs while `state.paused` holds, so nothing takes from this buffer then, but
          // `state.tick` is frozen too and the buffer drops every frame stamped further than
          // `maxInputLeadMs` past it. A client that keeps sending through a held pause fills at most
          // that window and never grows it.
          const buffer = this.inputBuffers.get(sessionId);
          if (!buffer) return;
          for (const frame of msg.inputs) buffer.offer(frame, this.state.tick);
        },
        getSimulatedLatency(),
        ({ sessionId }) => sessionId,
      );

      this.onMessage(INPUT_MESSAGE, limited(this.limits, "input", (client, msg: unknown) =>
        scoped(this.modeConfig, () => {
          if (!isInputPacket(msg)) return;
          // Gated on `isActiveInput`, not on arrival: the client sends a packet every tick whether or
          // not the player touched anything, so a neutral input is not evidence of presence and must
          // not reset the idle clock — that is the whole bug I1 fixes. Read off the NEWEST frame: the
          // older ones are redundancy (NR24) and were already judged when they were newest. Stamped
          // BEFORE the latency injector, so injected lag can never make a live player look idle.
          // It refreshes on any VALID packet, even one whose every frame the buffer then refuses as
          // late or early: that is still a live client pressing keys, so counting it as presence is
          // harmless — the stamp only decides when an idle room is reaped, never what the car does.
          if (isActiveInput(msg.inputs[msg.inputs.length - 1]!)) {
            this.lastInputAtMs = Date.now();
            this.warnedOfIdle = false;
          }
          // Offered unconditionally, active or not: the sim needs every tick's input to drive
          // correctly, including "hold nothing". Only the idle stamp above is conditional.
          this.inputDelay?.offer({ sessionId: client.sessionId, msg });
        })),
      );

      // A toggle rather than a set: the client holds no pause state of its own to disagree with.
      this.onMessage(MSG_PRACTICE_PAUSE, limited(this.limits, "lobby", () =>
        scoped(this.modeConfig, () => {
          this.state.paused = !this.state.paused;
          // Counts as presence (PR27): `sweepIdle` runs at the TOP of `tick()`, ahead of the pause
          // return, so a player who resumes right at the timeout would otherwise be reaped on the very
          // next tick, before their first post-resume input has a chance to land and restamp it.
          this.lastInputAtMs = Date.now();
          this.warnedOfIdle = false;
        })),
      );

      /**
       * NR45: the car this client's spectate camera shows. `pickSpectate` validates it against the
       * mode's spectate cycle for this client's car and ignores anything else. Registered here too
       * because the arena scene sends it from every room kind, and an unregistered type is a kick.
       */
      this.onMessage(MSG_SPECTATE_TARGET, limited(this.limits, "spectate", (client, msg: unknown) =>
        scoped(this.modeConfig, () => {
          this.views.pickSpectate(this.state, { sessionId: client.sessionId }, msg);
        })),
      );
    });
  }

  onJoin(client: Client, options?: unknown): void {
    assertProtocol(options);
    this.outgoing.wrapClient(client);
    scoped(this.modeConfig, () => {
      // `onCreate` has already rejected an invalid setup, so the room cannot exist without one; the
      // client's own options are preferred only because they are the same object, freshly validated.
      const setup = isPracticeSetup(options) ? options : this.setup;
      if (!setup) return;

      this.humanSessionId = client.sessionId;
      this.lastInputAtMs = Date.now();

      // Two colours drawn from the same table the lobby uses, so the pair reads as two distinct cars.
      // Teams 0 and 1 are visual only: the mode is FFA, so `canDamage` never consults them.
      const name = setup.name.trim() || "Player";
      const human = this.addCar(client.sessionId, name, setup.carId, [], 0);
      const opponentCarId = resolveOpponentCar(setup.opponentCarId, Math.random);
      this.addCar(BOT_SESSION_ID, "Bot", opponentCarId, [human.colorId], 1);

      // `respawnPlayer` is the whole of "this car is new": chassis hp, a fire state built from the
      // chassis's own kit, and the real `phased` protection (PR16). Its pose is `farthestSpawn` — the
      // right rule for an actual RESPAWN, kept below for that — but it is the wrong rule for this
      // opening placement: the bot's `PlayerState` is still sitting on its schema default of (0, 0)
      // when the human's car is respawned first, so every session would deterministically drop the
      // human on whichever `ffaSpawn` is farthest from the origin (review F4). Overwritten just below
      // with `assignSpawns`, the same mechanism `ArenaRoom.revealCars` uses to open a real match — a
      // real match never opens on a repeatable spot either.
      //
      // The `phased` grant rides along uninvited: a real match's opening (`revealCars`) hands out no
      // spawn protection at all, so this is a third divergence from strict mirror beyond the two PR1
      // names. Left as-is because it is harmless, not because it was missed — both cars get it
      // symmetrically, and `assignSpawns` places them far enough apart that neither can reach the
      // other before the 1.5-3s window (`statusTable().phased`) lapses on its own.
      for (const id of this.matchRoster) {
        const player = this.state.players.get(id);
        if (player) respawnPlayer(this.ctx(), player);
      }

      const roster: { sessionId: string; team: 0 | 1 }[] = [];
      for (const id of this.matchRoster) {
        const player = this.state.players.get(id);
        if (player) roster.push({ sessionId: id, team: player.team === 1 ? 1 : 0 });
      }
      const spawns = assignSpawns(getArena(this.state.arenaId), this.state.mode, roster, Math.random);
      for (const id of this.matchRoster) {
        const player = this.state.players.get(id);
        const spawn = spawns[id];
        if (!player || !spawn) continue;
        const pose = copySpawnNumbers(spawn);
        player.x = pose.x;
        player.y = pose.y;
        player.angle = pose.angle;
      }

      // LAST, after both cars exist and are standing on their spawns. The room has been ticking since
      // `onCreate`, so re-anchoring here is what makes the player's 3 start when they arrive rather
      // than counting down ticks they were not present for. `serverTick` holds both cars still for the
      // duration and `combatTick` skips combat, so this is a real countdown and not a caption.
      beginCountdown(this.state);
    });
    // Every client has a view (NR42), filled before Colyseus sends the joiner its full state. The bot
    // is not a client and has no view: it reads the room's state directly (NR49).
    ensureView(client);
    scoped(this.modeConfig, () =>
      this.views.update(this.state, viewersOf([client], (c) => c.sessionId), this.state.tick),
    );
  }

  /**
   * `allowReconnection` is deliberately never called (PR30): a closed tab disposes the room
   * immediately rather than holding a 60 Hz sim through a grace window nobody is watching.
   */
  onLeave(client: Client): void {
    scoped(this.modeConfig, () => {
      this.netSessions.drop(client.sessionId);
      this.limits.drop(client.sessionId);
      this.views.forget(client.sessionId);
      this.outgoing.drop(client.sessionId);
      this.inputDelay?.drop(client.sessionId);
      this.closing = true;
      void this.disconnect();
    });
  }

  /**
   * One car. Both rows are schema-ordinary, so the client renders the bot exactly like a remote
   * player and no client change is needed to see it (PR14).
   *
   * `level` is deliberately NOT set: `PlayerState`'s own default is what a real match starts you at,
   * and strict mirror (PR1) means practice starts you there too. The playground pins level 3; this
   * room must not.
   *
   * No loadout is written into `combat.loadouts` either, which is what makes the car carry its
   * chassis's shipped kit — `newFireState` falls back to it when the map has no entry.
   */
  private addCar(
    sessionId: string,
    name: string,
    carId: CarId,
    usedColorIds: number[],
    team: number,
  ): PlayerState {
    const player = new PlayerState();
    player.sessionId = sessionId;
    player.name = name;
    player.carId = carId;
    player.colorId = pickColor(usedColorIds, Math.random);
    player.team = team;
    player.joinedAtTick = this.state.tick;
    // In the match from the first tick: there is no lobby, no car select and no countdown to pass
    // through, and `isOnField` gates the mover on exactly this pair of fields.
    player.status = PlayerStatus.IN_MATCH;
    player.alive = true;
    this.state.players.set(sessionId, player);
    this.inputBuffers.set(sessionId, newTickInputBuffer());
    this.prevFireMasks.set(sessionId, 0);
    this.matchRoster.add(sessionId);
    return player;
  }

  /**
   * One wall-clock frame of the simulation interval (Phase C I1). Colyseus hands the MEASURED delta
   * since the last frame; the stepper runs `tick()` once per whole `MS_PER_TICK` of it, so the room
   * ticks at exactly `TICK_RATE_HZ` though Node truncates the 16.67 ms interval to 16 ms, and a
   * stall runs a bounded catch-up rather than a spiral.
   */
  private onFrame(deltaMs: number): void {
    this.stepper.advance(deltaMs, () => scoped(this.modeConfig, () => this.tick()));
    // Date the last tick to the steady tick grid, not to this callback: the banked remainder is how far
    // past that tick's due time `wallNow` already is. One mark per callback, even after a catch-up.
    this.netSessions.markTick(this.state.tick, netNowMs() - this.stepper.remainderMs);
  }

  /**
   * One sim tick, then the snapshot of it when this is a snapshot tick (NR12). A paused tick still
   * broadcasts — `state.tick` is frozen then, and the pause flag and anything a message wrote while
   * paused would otherwise never reach the client; `broadcastPatch` sends nothing when nothing
   * changed. A closing room broadcasts nothing.
   */
  private tick(): void {
    if (this.step() === "closing") return;
    // Paused: broadcast regardless of `isSnapshotTick` — the frozen tick number may never be a
    // snapshot tick, and the pause flag and paused edits must still reach the client.
    if (this.state.paused || isSnapshotTick(this.state.tick)) this.sendSnapshot();
  }

  /** The human's view brought up to date (NR44–NR47), then the patch. */
  private sendSnapshot(): void {
    this.views.update(this.state, viewersOf(this.clients, (c) => c.sessionId), this.state.tick);
    this.broadcastPatch();
  }

  private step(): "closing" | "ran" {
    // ABOVE the pause return, and on wall clock (PR27). Both halves matter: a tick-based counter
    // would never advance while paused, and a check below the return would never run while paused —
    // and a player who walked away with the menu open is exactly the room worth reaping.
    if (this.sweepIdle()) return "closing";
    // Before the increment, so a paused sim freezes coherently (PR13): cooldowns, statuses, respawn
    // timers and shot lifetimes all key off this counter, and none of them may advance alone.
    if (this.state.paused) return "ran";
    this.state.tick += 1;
    // Top of the tick, before anything reads the phase. Below the pause return on purpose: pausing
    // during the 3-2-1 has to freeze the 3-2-1 too, and the countdown keys off `state.tick` like
    // every other timer in the room.
    countdownSweep(this.state);
    respawnSweep(this.ctx());
    // Before the bot decides, not after: `buildBotView` reads `this.botRing.at(tick - staleness)`
    // for THIS tick, so this tick's world has to already be in the ring by the time the bot asks.
    this.botRing.push(snapshotWorld(this.state, this.combat));
    this.enqueueBotInput();
    // No win check, ever (PR9) — `runPipeline`'s players are deliberately dropped.
    runPipeline(this.ctx());
    // This tick's fires, ready for next tick's view, and the bag drained so a long practice session
    // does not accumulate every event of the match in a sink nothing else reads.
    this.previousTickFires = this.botEvents.fired.slice();
    this.botEvents.fired.length = 0;
    this.botEvents.damaged.length = 0;
    this.botEvents.killed.length = 0;
    return "ran";
  }

  /** Warns once, then closes. Returns true when the room is going away and the tick must stop. */
  private sweepIdle(): boolean {
    if (this.closing) return true;
    const now = Date.now();
    const { idleTimeoutSeconds, idleWarningSeconds } = PRACTICE_CONFIG;
    if (isPracticeIdle(this.lastInputAtMs, now, idleTimeoutSeconds)) {
      this.closing = true;
      // The close code is what tells the client this was a reaping rather than a crash; it has also
      // already seen the warning below, so the two agree.
      for (const client of this.clients) client.leave(PRACTICE_IDLE_CLOSE_CODE);
      void this.disconnect();
      return true;
    }
    if (
      !this.warnedOfIdle &&
      isIdleWarningDue(this.lastInputAtMs, now, idleTimeoutSeconds, idleWarningSeconds)
    ) {
      this.warnedOfIdle = true;
      this.broadcast(MSG_PRACTICE_IDLE_WARNING);
    }
    return false;
  }

  /**
   * One input per tick for the bot's car, offered into its ordinary `TickInputBuffer` for the tick
   * about to run (NR27, lead 0) — so "clients send inputs, never state" holds: the bot is a client,
   * just an in-process one. Nothing here ever writes to the human's buffer (PR14); that buffer is fed
   * only by the `INPUT_MESSAGE` handler.
   *
   * Called after `state.tick += 1`, so `state.tick` IS the tick `runPipeline` is about to simulate.
   * A multi-tick stepper frame runs increment, offer and consume per tick, so the bot can never
   * offer for a tick the room has already passed.
   */
  private enqueueBotInput(): void {
    const buffer = this.inputBuffers.get(BOT_SESSION_ID);
    if (!buffer) return;

    this.bot ??= new HumanController(this.difficulty, {
      targetSessionId: this.humanSessionId,
      botConfig: this.botConfig,
    });

    const view = buildBotView({
      state: this.state,
      selfSessionId: BOT_SESSION_ID,
      combat: this.combat,
      rng: this.botRng,
      observedFires: this.previousTickFires,
      stalenessTicks: this.botConfig.profiles[this.difficulty].viewStalenessTicks,
      ring: this.botRing,
    });
    // No view (the bot's car is gone): nothing offered, and its buffer repeats then goes neutral.
    if (!view) return;

    offerForTick(buffer, this.state.tick, this.bot.decide(view));
  }

  /**
   * The room's long-lived maps and memory bags, handed to the pipeline for one use. Built fresh at
   * every call, never cached — see the hazard note on `PipelineCtx`.
   */
  private ctx(): PipelineCtx {
    return {
      state: this.state,
      inputBuffers: this.inputBuffers,
      prevFireMasks: this.prevFireMasks,
      matchRoster: this.matchRoster,
      phaseCaps: this.phaseCaps,
      combat: this.combat,
      ram: this.ram,
      hz: TICK_RATE_HZ,
      // The phased spawn-protection lifecycle has to end and refresh here exactly as it does in a
      // real deathmatch, and `runPipeline` will not infer that from the mode.
      runPhaseSweep: true,
      events: this.botEvents,

      // NR36: the RTT this room measured for a session (app RTT bounded by the transport ping RTT)
      // prices its presses' shot compensation.
      rttMsOf: (id) => this.netSessions.compRttMs(id),
    };
  }
}
