import { Room, ServerError, matchMaker, type Client } from "@colyseus/core";
import {
  BOT_SESSION_ID,
  DEFAULT_PATCH_RATE_HZ,
  GameMode,
  INPUT_MESSAGE,
  MSG_PRACTICE_IDLE_WARNING,
  MSG_PRACTICE_PAUSE,
  NET_CONFIG,
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
  RoomPhase,
  TICK_RATE_HZ,
  assignSpawns,
  getArena,
  isPracticeSetup,
  pickColor,
  weaponDefOf,
  type BotDifficulty,
  type CarId,
  type InputMessage,
  type PracticeSetup,
} from "@motor-combat-moba/shared";
import { getMaxPracticeRooms, getSimulatedLatency, getTickRateHz } from "../mode.js";
import { isInputMessage } from "../net/input-message.js";
import { withSimulatedLatency } from "../net/latency-injector.js";
import { newCombatMemory, type CombatMemory } from "../sim/combat-bridge.js";
import { newContactMemory, type ContactMemory } from "../sim/ram-bridge.js";
import {
  BOT_PROFILES,
  botInput,
  pulsedFireSlots,
  shouldRecomputeIntent,
  type BotPose,
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
import {
  respawnPlayer,
  respawnSweep,
  runPipeline,
  type PipelineCtx,
} from "./tick-pipeline.js";

/**
 * The room's opening state, exported so the two decisions in it are pinned by a test rather than by
 * this comment (spec PR9).
 *
 * `phase` is written once, here, and never again: nothing in this room reduces a flow, so this is
 * the only thing that opens the gate `serverTick` and `runPipeline` both check.
 *
 * `mode` is Deathmatch, and `matchEndsTick` is deliberately left at 0. `matchClockLabel` returns ""
 * for a non-positive value, so the HUD drops the clock with no client conditional, while
 * `winRuleOf(mode) === "deathmatch"` keeps the kills panel lit. `runPipeline` reads the mode only
 * through `sidesOf`, which answers "ffa" for both FFA modes, so nothing else in the sim changes.
 */
export function newPracticeState(): PracticeState {
  const state = new PracticeState();
  state.phase = RoomPhase.MATCH;
  state.mode = GameMode.FFA_DEATHMATCH;
  return state;
}

/**
 * Player-facing practice: the shipped game with one bot in it (spec PR1).
 *
 * Deliberately NOT a copy of `PlaygroundRoom`. There is no tuning store (PR10), no control routing
 * (PR12), no mid-session setup message (PR7) and no singleton guard (PR4) — Colyseus minting one
 * room per player is the feature here, not a bug to suppress.
 *
 * `setTuning`, the store the playground writes through, is never imported or called from here, and
 * `practice-room.test.ts` reads this source (comments stripped, so naming it right here cannot fail
 * that test) to hold that. It is a module-level singleton, one per server process rather than one per
 * room, so a practice room that touched it would silently re-balance every other room in the process
 * — including a live match next door.
 */
export class PracticeRoom extends Room<PracticeState> {
  maxClients = 1;

  private readonly inputQueues = new Map<string, InputMessage[]>();
  private readonly prevFireMasks = new Map<string, number>();
  private readonly matchRoster = new Set<string>();
  private readonly phaseCaps = new Map<string, number>();
  private readonly combat: CombatMemory = newCombatMemory();
  private readonly ram: ContactMemory = newContactMemory();

  private humanSessionId = "";
  /**
   * The bot's input `seq`. Monotonic across the room rather than per car, which is all `serverTick`
   * needs — it sorts a batch by seq and acks the highest, and never compares one player's seq to
   * another's.
   */
  private botSeq = 0;
  /**
   * The bot's last computed intent, re-enqueued on the ticks its profile is not recomputing.
   * Cleared whenever it could go stale — here, only a target that is no longer alive.
   */
  private heldBotIntent: InputMessage | undefined;
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
   * Latched at the first close, because `disconnect()` is asynchronous and the simulation interval
   * can fire again before the room is gone — without this the idle sweep would keep kicking clients
   * that have already left.
   */
  private closing = false;

  async onCreate(options?: unknown): Promise<void> {
    // The join options reach `onCreate` too (Colyseus merges the client's options into the create
    // call), so the setup is validated once, before the room exists, rather than on join.
    if (!isPracticeSetup(options)) {
      throw new ServerError(PRACTICE_INVALID_SETUP_CLOSE_CODE, PRACTICE_INVALID_SETUP_ERROR);
    }

    const listings = await matchMaker.query({ name: PRACTICE_ROOM_NAME });
    // Defensive, not currently load-bearing: in the installed @colyseus/core (0.15.57),
    // `listing.save()` runs AFTER `onCreate`, so this room is never in `listings` yet and the filter
    // below removes nothing today. Kept anyway so a future Colyseus that lists earlier cannot make
    // this room count itself toward its own cap.
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

    this.setup = options;
    this.difficulty = options.difficulty;

    this.setState(newPracticeState());
    this.setPatchRate(1000 / DEFAULT_PATCH_RATE_HZ);
    this.setSimulationInterval(() => this.tick(), 1000 / getTickRateHz(TICK_RATE_HZ));

    // Mirrors `ArenaRoom`'s injector (PR11). The playground deliberately skips it — simulated lag
    // makes a feel test lie — but practice takes the opposite decision for the reason it exists:
    // strict mirror means practice must feel like the arena on the same deploy. The knobs are off in
    // a release build, where `withSimulatedLatency` hands back the deliver function unwrapped.
    const enqueue = withSimulatedLatency<{ sessionId: string; msg: InputMessage }>(
      ({ sessionId, msg }) => {
        const q = this.inputQueues.get(sessionId);
        // Capped, not just eventually drained (review F3): `tick()` returns before `serverTick` ever
        // runs while `state.paused` is true, so nothing reads this queue for as long as pause holds.
        // The shipped client stops sending on pause, so a well-behaved session never gets close to
        // this, but this codebase does not trust a client to shape its own inputs, and a client that
        // keeps sending through a HELD pause would otherwise grow it without bound for as long as the
        // pause lasts. Clearing once on the pause->true edge would not close that — the same client
        // could just keep sending afterward — so the bound is on every push instead. Reuses
        // `NET_CONFIG.pendingInputCap`, the same "an honest client has this many inputs outstanding"
        // figure the client already holds itself to on its own prediction buffer.
        if (q && q.length < NET_CONFIG.pendingInputCap) q.push(msg);
      },
      getSimulatedLatency(),
    );

    this.onMessage(INPUT_MESSAGE, (client, msg: unknown) => {
      if (!isInputMessage(msg)) return;
      // Gated on `isActiveInput`, not on arrival: `ArenaScene.sendInputTick` sends one message a
      // tick regardless of whether the player touched anything, so a neutral input is not evidence
      // of presence and must not reset the idle clock — that is the whole bug I1 fixes. Stamped
      // BEFORE the latency injector, so injected lag can never make a live player look idle.
      if (isActiveInput(msg)) {
        this.lastInputAtMs = Date.now();
        this.warnedOfIdle = false;
      }
      // Enqueued unconditionally, active or not: the sim needs every tick's input to drive
      // correctly, including "hold nothing". Only the idle stamp above is conditional.
      enqueue({ sessionId: client.sessionId, msg });
    });

    // A toggle rather than a set: the client holds no pause state of its own to disagree with.
    this.onMessage(MSG_PRACTICE_PAUSE, () => {
      this.state.paused = !this.state.paused;
      // Counts as presence (PR27): `sweepIdle` runs at the TOP of `tick()`, ahead of the pause
      // return, so a player who resumes right at the timeout would otherwise be reaped on the very
      // next tick, before their first post-resume input has a chance to land and restamp it.
      this.lastInputAtMs = Date.now();
      this.warnedOfIdle = false;
    });
  }

  onJoin(client: Client, options?: unknown): void {
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
    // other before the 1.5-3s window (`STATUS_TABLE.phased`) lapses on its own.
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
  }

  /**
   * `allowReconnection` is deliberately never called (PR30): a closed tab disposes the room
   * immediately rather than holding a 30 Hz sim through a grace window nobody is watching.
   */
  onLeave(): void {
    this.closing = true;
    void this.disconnect();
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
    this.inputQueues.set(sessionId, []);
    this.prevFireMasks.set(sessionId, 0);
    this.matchRoster.add(sessionId);
    return player;
  }

  private tick(): void {
    // ABOVE the pause return, and on wall clock (PR27). Both halves matter: a tick-based counter
    // would never advance while paused, and a check below the return would never run while paused —
    // and a player who walked away with the menu open is exactly the room worth reaping.
    if (this.sweepIdle()) return;
    // Before the increment, so a paused sim freezes coherently (PR13): cooldowns, statuses, respawn
    // timers and shot lifetimes all key off this counter, and none of them may advance alone.
    if (this.state.paused) return;
    this.state.tick += 1;
    respawnSweep(this.ctx());
    this.enqueueBotInput();
    // No win check, ever (PR9) — `runPipeline`'s players are deliberately dropped.
    runPipeline(this.ctx());
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
   * One input per tick for the bot's car, through the ordinary input queue — so "clients send
   * inputs, never state" holds: the bot is a client, just an in-process one. Nothing here ever
   * writes to the human's queue (PR14); that queue is fed only by the `INPUT_MESSAGE` handler.
   */
  private enqueueBotInput(): void {
    const self = this.state.players.get(BOT_SESSION_ID);
    const queue = this.inputQueues.get(BOT_SESSION_ID);
    if (!self || !queue) return;

    this.botSeq += 1;
    const seq = this.botSeq;
    const profile = BOT_PROFILES[this.difficulty];

    const human = this.state.players.get(this.humanSessionId);
    // A dead target is no target: the bot coasts rather than chasing the wreck's last pose, and the
    // hold is dropped so it reacts the instant the target respawns instead of waiting out its
    // cadence.
    const target = human?.alive ? poseOf(human) : null;
    if (target === null) this.heldBotIntent = undefined;

    if (
      shouldRecomputeIntent(this.state.tick, profile.reactionTicks, this.heldBotIntent !== undefined)
    ) {
      const slots = this.combat.fireStates.get(BOT_SESSION_ID)?.slots ?? [];
      this.heldBotIntent = botInput(
        seq,
        poseOf(self),
        target,
        slots.map((slot) => weaponDefOf(slot.weaponId).range),
        profile,
      );
    }

    const intent = this.heldBotIntent ?? { seq, steer: 0, throttle: 0, fireSlots: 0 };
    // A held intent is re-enqueued with a FRESH seq: `serverTick` wants one input per tick per car,
    // and reusing a sequence number reads as a duplicate rather than a repeat.
    //
    // The fire mask is PULSED rather than passed straight through, for the reason spelled out on
    // `pulsedFireSlots`: `serverTick` counts only newly-set bits as a press, so a bot holding the
    // same bits fires each slot once and then never again.
    queue.push({
      ...intent,
      seq,
      fireSlots: pulsedFireSlots(this.state.tick, profile.firePeriodTicks, intent.fireSlots),
    });
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
      // The phased spawn-protection lifecycle has to end and refresh here exactly as it does in a
      // real deathmatch, and `runPipeline` will not infer that from the mode.
      runPhaseSweep: true,
    };
  }
}

function poseOf(player: PlayerState): BotPose {
  return { x: player.x, y: player.y, angle: player.angle };
}
