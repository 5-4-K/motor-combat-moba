import { Room, ServerError, matchMaker, type Client } from "@colyseus/core";
import {
  BOT_SESSION_ID,
  DEFAULT_PATCH_RATE_HZ,
  INPUT_MESSAGE,
  MSG_PLAYGROUND_BOT_DEBUG,
  MSG_PLAYGROUND_PAUSE,
  MSG_PLAYGROUND_SETUP,
  MSG_PLAYGROUND_SWITCH,
  MSG_PLAYGROUND_TUNING,
  PLAYGROUND_ROOM_NAME,
  PRACTICE_ROOM_NAME,
  PlayerState,
  PlayerStatus,
  PlaygroundState,
  ROOM_NAME,
  RoomPhase,
  TICK_RATE_HZ,
  defaultPlaygroundSetup,
  isBotDifficulty,
  isPlaygroundSetup,
  newCombatEvents,
  pickColor,
  setTuning,
  validateTuning,
  type CombatEvents,
  type FiredEvent,
  type InputMessage,
  type PlaygroundCarSetup,
  type PlaygroundSetup,
} from "@motor-combat-moba/shared";
import { getTickRateHz } from "../mode.js";
import { isInputMessage } from "../net/input-message.js";
import { newCombatMemory, type CombatMemory } from "../sim/combat-bridge.js";
import { newContactMemory, type ContactMemory } from "../sim/ram-bridge.js";
import {
  buildBotView,
  botRingCapacity,
  deriveSeed,
  makeRng,
  snapshotWorld,
  BOT_PROFILES,
  HumanController,
  ViewRing,
  type BotController,
} from "../bot/index.js";
import { shouldRejectSecondArena } from "./singleton-arena.js";
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
export const ARENA_BUSY_ERROR =
  "Close the arena first, and any practice session too: playground tuning is process-wide";

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
 * practice room (spec PG15, widened by PR10): the tuning store is a module-level singleton shared by
 * every room in the process, so overrides typed into the playground would silently re-balance a live
 * match — or a player's practice session — next door.
 *
 * Practice rooms are registered on EVERY process, the `npm run dev` one included, which is exactly
 * how a developer's sliders reach a friend's session.
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
 * The other of the playground's two cars. There are exactly two — the human's session and the bot's
 * reserved id — so anything that is not the human resolves to the bot and vice versa; an empty or
 * unrecognised id lands on the human rather than inventing a third car.
 */
export function otherPlaygroundId(sessionId: string, humanSessionId: string): string {
  return sessionId === humanSessionId ? BOT_SESSION_ID : humanSessionId;
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
  /**
   * Fed to the pipeline as `PipelineCtx.events` and drained every tick (below): this is what makes
   * `BotView.observedFires` non-empty here, which is what feeds ult memory and vengefulness (B18).
   * Draining matters as much as populating it — a `CombatEvents` bag nothing ever clears would grow
   * for the life of the room, and a playground session has no match end to reclaim it at.
   */
  private readonly botEvents: CombatEvents = newCombatEvents();
  /** One tick's world, N ticks deep (B19) — owned here because "the world N ticks ago" does not
   * depend on which bot is asking, and this room has exactly one. */
  private readonly botRing = new ViewRing(botRingCapacity());
  /** This tick's view of "what the bot just saw fired" — last tick's fires, sliced off the drained
   * bag before it was cleared. */
  private previousTickFires: readonly FiredEvent[] = [];
  /** The human's session id, fixed for the room's life. Control routes; identity does not. */
  private humanSessionId = "";
  /**
   * The un-driven car's input `seq`. Monotonic across the room rather than per car, which is all
   * `serverTick` needs — it sorts a batch by seq and acks the highest, and never compares one
   * player's seq to another's.
   */
  private opponentSeq = 0;
  /**
   * The bot, as an instance (B10). Rebuilt when the difficulty changes, because a profile is
   * constructor state — and rebuilding also drops the held intent, which is exactly what the three
   * old `heldBotIntent = undefined` resets were doing by hand.
   */
  private bot: BotController | undefined;
  /** The playground is interactive, so the seed is a constant — it exists to satisfy the contract,
   * not to make the playground reproducible. */
  private readonly botRng = makeRng(deriveSeed(1, "playground-bot"));

  async onCreate(): Promise<void> {
    const listings = await matchMaker.query({ name: ROOM_NAME });
    const practiceListings = await matchMaker.query({ name: PRACTICE_ROOM_NAME });
    if (shouldRefusePlayground(listings, practiceListings)) {
      throw new ServerError(ARENA_BUSY_CODE, ARENA_BUSY_ERROR);
    }

    // Second query, same reasoning (PG15): the tuning store this room writes through `setTuning` is
    // module-level, one per process — not per room — so two playground rooms alive at once fight over
    // it, and either one closing wipes the tables the other still thinks are active. `maxClients = 1`
    // does not prevent this: it only rejects a second CLIENT, and `joinPlayground`'s `joinOrCreate`
    // reacts to a full room by asking Colyseus to create another one. Reuses `shouldRejectSecondArena`
    // unchanged — "any listed room besides myself" is exactly the rule here too.
    const playgroundListings = await matchMaker.query({ name: PLAYGROUND_ROOM_NAME });
    if (shouldRejectSecondArena(playgroundListings, this.roomId)) {
      throw new ServerError(PLAYGROUND_BUSY_CODE, PLAYGROUND_BUSY_ERROR);
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
      // Switching flips which car `enqueueOpponentInput` drives as the bot (PG29's third staleness
      // case, missed by the original pass): a held intent was computed from the OLD bot car's pose,
      // and re-enqueuing it against the newly-bot-driven car for the rest of the reaction window
      // would fire it from a pose that car was never in.
      this.bot = undefined;
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
    this.state.botDifficulty = setup.botDifficulty;
    // Any setup change can invalidate a held intent — a new chassis drives differently, a new
    // difficulty has a different cadence, and the bot may have just been switched off (PG29).
    this.bot = undefined;
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

  /** Writes one car's chassis, loadout and colour, and reports whether a RESPAWN is owed. Colour is
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

  private tick(): void {
    // Before the increment, so a paused sim freezes coherently (PG7): cooldowns, statuses, respawn
    // timers and shot lifetimes all key off this counter, and none of them may advance alone.
    if (this.state.paused) return;
    this.state.tick += 1;
    respawnSweep(this.ctx());
    // Before the bot decides, not after: `buildBotView` reads `this.botRing.at(tick - staleness)`
    // for THIS tick, so this tick's world has to already be in the ring by the time the bot asks.
    this.botRing.push(snapshotWorld(this.state, this.combat));
    this.enqueueOpponentInput();

    // Every 6 ticks (5 Hz): a debug read-out that updates 30 times a second is unreadable, and this
    // is a dev-only room, so the bandwidth is not the reason for the throttle.
    const debug = this.bot instanceof HumanController ? this.bot.debug() : undefined;
    if (debug && this.state.tick % 6 === 0) {
      this.broadcast(MSG_PLAYGROUND_BOT_DEBUG, {
        tick: debug.tick,
        goal: debug.goal,
        // Rounded to one decimal, and `-Infinity` entries dropped rather than sent: `scoreGoals`
        // uses `-Infinity` for "this goal is not even on the table" (no contact weapon and no ram
        // intent, or healthy enough that reset cannot win), and `JSON.stringify` turns that into
        // `null`, which the guard would reject and the read-out could not render. An absent key IS
        // the meaning (H12 / G9).
        goalScores: Object.fromEntries(
          Object.entries(debug.goalScores)
            .filter(([, score]) => Number.isFinite(score))
            .map(([goal, score]) => [goal, Math.round(score! * 10) / 10]),
        ),
        targetSessionId: debug.targetSessionId ?? "",
        preferredRange: Math.round(debug.preferredRange),
        personality: debug.personality,
        firedSlot: debug.firedSlot ?? -1,
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
   * One input per tick for whichever car the human is NOT driving — the bot's intent with the bot on,
   * a neutral input with it off. Either way it goes through the ordinary input queue, so the "clients
   * send inputs, never state" invariant holds: the bot is a client, just an in-process one.
   */
  private enqueueOpponentInput(): void {
    const opponentId = otherPlaygroundId(this.state.controlledSessionId, this.humanSessionId);
    const queue = this.inputQueues.get(opponentId);
    if (!queue) return;

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
      // Dropping the controller is what stops switching the bot back on from replaying an intent
      // computed against a pose from minutes ago (PG29).
      this.bot = undefined;
      queue.push({ seq, steer: 0, throttle: 0, fireSlots: 0 });
      return;
    }

    const difficulty = isBotDifficulty(this.state.botDifficulty) ? this.state.botDifficulty : "medium";
    if (this.bot?.profileId !== difficulty) {
      this.bot = new HumanController(difficulty, { targetSessionId: this.state.controlledSessionId });
    }
    // The playground can re-point the camera at the other car mid-session, which changes who the
    // bot is fighting; the target is re-stated every tick rather than only at construction.
    (this.bot as HumanController).setTarget(this.state.controlledSessionId);

    const view = buildBotView({
      state: this.state,
      selfSessionId: opponentId,
      combat: this.combat,
      rng: this.botRng,
      observedFires: this.previousTickFires,
      stalenessTicks: BOT_PROFILES[difficulty].viewStalenessTicks,
      ring: this.botRing,
    });
    // No car for the bot's seat: push NOTHING, exactly as the pre-migration
    // `if (!self || !queue) return;` did. An input queued for a session that is not in
    // `state.players` is never consumed by `serverTick`, and would be read as a stale intent if
    // that seat were ever re-added.
    if (!view) return;

    // A fresh `seq` every tick, held intent or not: `serverTick` wants one input per tick per car,
    // and reusing a sequence number reads as a duplicate rather than a repeat.
    queue.push({ seq, ...this.bot.decide(view) });
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
      events: this.botEvents,
    };
  }
}
