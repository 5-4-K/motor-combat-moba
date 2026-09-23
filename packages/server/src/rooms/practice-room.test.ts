import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GAME_MODE,
  activeArenaIds,
  installMode,
  isActiveGameMode,
  modeConfigOf,
} from "@motor-combat-moba/shared";
import {
  BOT_SESSION_ID,
  GameMode,
  PRACTICE_CONFIG,
  PlayerState,
  PracticeState,
  RoomPhase,
  activeCarIds,
  hpOf,
  newFireState,
  type BotDifficulty,
  type CarId,
  type CombatEvents,
  type FiredEvent,
  type InputMessage,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../config/bot-profiles.js";
import { HumanController, ViewRing, type BotView } from "../bot/index.js";
import { PracticeRoom, newPracticeState } from "./PracticeRoom.js";
import { countdownTicks } from "./countdown.js";
import { isIdleWarningDue, isPracticeIdle } from "./practice-rules.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const ROOM_SOURCE = readFileSync(
  fileURLToPath(new URL("./PracticeRoom.ts", import.meta.url)),
  "utf8",
);

/** The module minus its prose: these are assertions about CODE, not about how it is documented. */
const ROOM_CODE = ROOM_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("newPracticeState (PR9)", () => {
  // Was MATCH from the first tick. The room now opens on the same 3-2-1 a real match does, and
  // `countdown.ts` is the only thing that writes the phase — nothing here reduces a flow.
  it("opens in COUNTDOWN, so a session starts with the 3-2-1 rather than mid-fight", () => {
    expect(newPracticeState().phase).toBe(RoomPhase.COUNTDOWN);
  });

  // The room ticks from creation, before anyone has joined. Opening on MATCH and starting a
  // countdown afterwards would run live ticks nobody was there to see.
  it("has a countdown already stamped, so there is no MATCH window before it", () => {
    expect(newPracticeState().countdownEndsTick).toBe(countdownTicks());
  });

  it("runs deathmatch rules, so death respawns instead of eliminating", () => {
    expect(newPracticeState().mode).toBe(GameMode.FFA_DEATHMATCH);
  });

  // `newPracticeState` pins this mode by CONSTANT, and nothing else ties that constant to the mode
  // still being published. Mark Deathmatch `isActive: false` and practice keeps running it — but
  // `activeArenaIds()` stops covering its arenas, so the client's boot filter skips that art and
  // `build-release.mjs` prunes it from the zip: every practice session would then play on the
  // procedural fallback floor instead of the arena's own, with nothing anywhere saying why.
  // Whoever deactivates Deathmatch must decide what practice runs instead; this is the tripwire.
  it("pins a mode that is actually ACTIVE, so the arena union still covers practice's arena", () => {
    expect(isActiveGameMode(GameMode.FFA_DEATHMATCH)).toBe(true);
    for (const arenaId of modeConfigOf(GameMode.FFA_DEATHMATCH).arenas) {
      expect(activeArenaIds()).toContain(arenaId);
    }
    expect(activeArenaIds()).toContain(newPracticeState().arenaId);
  });

  // MC23/MC26: pins the INTENDED source — Deathmatch's own bundle, not `ACTIVE_ARENA_ID` — as
  // literal documentation. It does NOT prove causation on its own: Deathmatch's shipped `arenas[0]`
  // is "arena-01", the SAME string `ArenaState.arenaId`'s field initializer defaults to via
  // `ACTIVE_ARENA_ID`, so this assertion still passes even with the room's own `state.arenaId` write
  // deleted (verified by hand while writing this task). `practice-room-arena.test.ts` is the test
  // that actually distinguishes the two, by mocking the bundle so the two values are forced to
  // differ — see its header comment for why a second file was needed here.
  it("takes its arena from the Deathmatch bundle's arena set, not ACTIVE_ARENA_ID", () => {
    expect(newPracticeState().arenaId).toBe(modeConfigOf(GameMode.FFA_DEATHMATCH).arenas[0]);
  });

  // The whole point of practice: no clock, so no win condition can arrive. `matchClockLabel` reads
  // a non-positive value as "no clock", which is what drops the HUD timer with no client change.
  it("leaves matchEndsTick at 0 — a deathmatch with no deadline", () => {
    expect(newPracticeState().matchEndsTick).toBe(0);
  });

  it("starts unpaused", () => {
    expect(newPracticeState().paused).toBe(false);
  });
});

// Repointed from `setTuning` to `installMode` (MC39/MC40): `setTuning` is deleted, so an assertion
// naming it could no longer fail and no longer taught anything. The HAZARD outlived the function.
// `installMode` writes the module-level "current bundle" — one per server process, not one per room
// — so a practice room that called it would hand its own numbers to every other room in the process,
// a live arena match included. That is the same leak `setTuning` used to cause, and `installMode` is
// now the only way left to cause it. The room reads config through `scoped(this.modeConfig, ...)`
// instead, which restores the previous bundle on the way out.
//
// There is no typed way to assert an absence, so this reads the source — against ROOM_CODE, comments
// stripped, so naming `installMode` in a doc comment (as the class header above `PracticeRoom` does,
// deliberately) cannot fail this. A guard against the specific regression a copy-paste from
// `PlaygroundRoom` would produce, not a proof — an aliased import or `room["installMode"]`-style
// indirection would slip straight through.
describe("the practice room never installs a bundle process-wide (PR10)", () => {
  it("does not mention installMode anywhere in its module", () => {
    expect(ROOM_CODE).not.toContain("installMode");
  });
});

// Strict mirror (PR1): a practice car must be the car a real match gives you. Both of these are
// absences in `addCar`, and an absence is exactly what a later edit reinstates without noticing.
// Same caveat as above: a guard against a copy-paste regression, not a proof — `player["level"] =`
// would slip through untouched.
describe("practice cars are shipped cars, not sandbox cars", () => {
  it("never pins a level — PlayerState's own default is what an arena match starts you at", () => {
    expect(ROOM_CODE).not.toContain("player.level =");
  });

  it("never writes a loadout, so newFireState falls back to the chassis's shipped kit", () => {
    expect(ROOM_CODE).not.toContain("loadouts.set");
  });
});

describe("practice room rules", () => {
  it("warns before it closes, never after", () => {
    const { idleTimeoutSeconds: t, idleWarningSeconds: w } = PRACTICE_CONFIG;
    const warnAt = (t - w) * 1000;
    expect(isIdleWarningDue(0, warnAt, t, w)).toBe(true);
    expect(isPracticeIdle(0, warnAt, t)).toBe(false);
  });

  it("ships a profile for every difficulty the setup guard accepts", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      expect(BOT_PROFILES[difficulty]).toBeDefined();
    }
  });
});

// Not the room's own code, but what the two absences above rest on: a practice car is built by
// `respawnPlayer` from nothing but its chassis and `PlayerState`'s default level, so every chassis a
// setup can name must arrive with hp and a full kit at level 1 — no slot may be dead on arrival.
describe("every chassis practice can seat is armed at the default level", () => {
  const defaultLevel = new PlayerState().level;

  it("has hp and a shipped kit with no loadout written", () => {
    // 4, not 3: every chassis carries three loadout abilities plus its own basic attack
    // (`CarDef.basicAttack`), and `newFireState` builds one slot per entry `fireSlotsOf` returns —
    // the kit, then the basic attack. Four is the fourth slot existing, not a kit that grew.
    for (const carId of activeCarIds()) {
      const slots = newFireState(carId, defaultLevel).slots.length;
      expect(`${carId}:${hpOf(carId) > 0}:${slots}`).toBe(`${carId}:true:4`);
    }
  });
});

/**
 * The Task 8 host wiring itself, exercised for real rather than trusted by construction.
 *
 * Every one of these pieces threads through OPTIONAL parameters — `buildBotView`'s `stalenessTicks?`,
 * `ring?`, `observedFires?`, and `PipelineCtx.events?` — so a regression here (the ring push moved
 * after `enqueueBotInput`, `events: this.botEvents` dropped from `ctx()`, the three drain lines
 * deleted) would compile cleanly and pass every OTHER suite. Nothing before this block named
 * `botRing`, `observedFires`, or `stalenessTicks` at all.
 *
 * `readyPracticeRoom` reaches past `private` with a cast — TypeScript's `private` is a compile-time
 * fence, not a runtime one — because the wiring under test (`tick`, `enqueueBotInput`, `ctx`) has no
 * public surface, and standing up the real thing (`onCreate`'s matchmaker queries, `onJoin`'s spawn
 * assignment) would pull in machinery this file has no business running. Not a substitute for the
 * black-box tests above; a white-box harness for the one thing nothing else here exercises.
 */
describe("Task 8: the view ring and the fired sink actually run outside the harness", () => {
  interface PracticeRoomHarness {
    state: PracticeState;
    difficulty: BotDifficulty;
    humanSessionId: string;
    inputQueues: Map<string, InputMessage[]>;
    botEvents: CombatEvents;
    setState(state: PracticeState): void;
    addCar(
      sessionId: string,
      name: string,
      carId: CarId,
      usedColorIds: number[],
      team: number,
    ): PlayerState;
    tick(): void;
  }

  function readyPracticeRoom(difficulty: BotDifficulty): PracticeRoomHarness {
    const room = new PracticeRoom() as unknown as PracticeRoomHarness;
    room.setState(newPracticeState());
    // Past the opening 3-2-1, because every scenario below is about a LIVE match's tick wiring —
    // the ring, the fired sink, the drain. `combatTick` skips combat outside `MATCH`, so a harness
    // left in `COUNTDOWN` would measure a room in which nothing can fire, and the `observedFires`
    // test would pass an empty bag off as a wiring failure. `countdownSweep` is inert once the phase
    // is MATCH, so this survives every tick below.
    room.state.phase = RoomPhase.MATCH;
    room.difficulty = difficulty;
    room.humanSessionId = "human";

    const human = room.addCar("human", "Player", "mirage", [], 0);
    const bot = room.addCar(BOT_SESSION_ID, "Bot", "bastion", [], 1);
    // `addCar` marks both alive but leaves hp at the schema default (0) — a real join relies on
    // `respawnPlayer` for that, which also grants spawn-protected `phased` and would complicate the
    // staleness/firing scenarios below for no benefit; setting hp directly is the smaller diff.
    human.hp = hpOf("mirage");
    bot.hp = hpOf("bastion");
    human.x = 0;
    human.y = 0;
    human.angle = 0;
    bot.x = 200;
    bot.y = 0;
    bot.angle = Math.PI;

    return room;
  }

  it("pushes this tick's world into the ring before the bot decides on it (B19)", () => {
    const room = readyPracticeRoom("medium");
    const order: string[] = [];

    const originalPush = ViewRing.prototype.push;
    const pushSpy = vi.spyOn(ViewRing.prototype, "push").mockImplementation(function (
      this: ViewRing,
      snapshot,
    ) {
      order.push(`push:${snapshot.tick}`);
      return originalPush.call(this, snapshot);
    });

    const originalDecide = HumanController.prototype.decide;
    const decideSpy = vi.spyOn(HumanController.prototype, "decide").mockImplementation(function (
      this: HumanController,
      view: BotView,
    ) {
      order.push(`decide:${view.tick}`);
      return originalDecide.call(this, view);
    });

    for (let i = 0; i < 3; i++) room.tick();
    pushSpy.mockRestore();
    decideSpy.mockRestore();

    for (let tick = 1; tick <= 3; tick++) {
      const pushIndex = order.indexOf(`push:${tick}`);
      const decideIndex = order.indexOf(`decide:${tick}`);
      expect(pushIndex).toBeGreaterThanOrEqual(0);
      expect(decideIndex).toBeGreaterThan(pushIndex);
    }
  });

  it("serves the bot a genuinely stale world once the ring has filled (B19)", () => {
    const room = readyPracticeRoom("easy"); // viewStalenessTicks = 4, ring capacity 5
    const staleness = BOT_PROFILES.easy.viewStalenessTicks;
    const seenViews: BotView[] = [];

    // The bot's own decision is irrelevant to this test and, if left real, could drive it into the
    // human over enough ticks and confound the position read below with a ram — mocked to a neutral
    // hold so nothing but the manual `human.x` writes moves anyone, while still recording every view
    // the room hands it.
    const decideSpy = vi.spyOn(HumanController.prototype, "decide").mockImplementation(function (
      this: HumanController,
      view: BotView,
    ) {
      seenViews.push(view);
      return { steer: 0, throttle: 0, fireSlots: 0 };
    });

    const human = room.state.players.get("human")!;
    const totalTicks = staleness + 6;
    for (let t = 1; t <= totalTicks; t++) {
      human.x = t * 10; // a fact only the LIVE world knows on tick t
      room.tick();
    }
    decideSpy.mockRestore();

    const lastView = seenViews.at(-1)!;
    expect(lastView.tick).toBe(totalTicks);
    const seenHuman = lastView.others.find((car) => car.sessionId === "human");
    expect(seenHuman).toBeDefined();
    // The ring has long since filled (capacity 5 > staleness 4): the bot's picture of the human is
    // `staleness` ticks behind the position just written above, never the live one.
    expect(seenHuman!.x).toBe((totalTicks - staleness) * 10);
    expect(seenHuman!.x).not.toBe(human.x);
  });

  it("carries observedFires from a real fired shot into the NEXT tick's view (B18)", () => {
    const room = readyPracticeRoom("medium");
    const seenViews: BotView[] = [];

    const originalDecide = HumanController.prototype.decide;
    const decideSpy = vi.spyOn(HumanController.prototype, "decide").mockImplementation(function (
      this: HumanController,
      view: BotView,
    ) {
      seenViews.push(view);
      return originalDecide.call(this, view);
    });

    // A REAL press through the ordinary input queue, not a synthetic event pushed straight into
    // `botEvents` — `isFighting` (shared `combat.ts`) only requires `inRoster && alive`, so this
    // fires regardless of aim, range, or whether the bot's own AI ever chooses to. If a future edit
    // dropped `events: this.botEvents` from `ctx()`, this press would still happen but nothing would
    // carry it forward, and the assertion below would catch exactly that.
    room.inputQueues.get("human")?.push({ seq: 1, steer: 0, throttle: 0, fireSlots: 0b111 });
    room.tick(); // tick 1: the press resolves, a FiredEvent lands in botEvents, then gets drained
    // into `previousTickFires` for the NEXT tick's view.
    room.tick(); // tick 2: the bot's own decide() call should now see it.
    decideSpy.mockRestore();

    const tick2View = seenViews.find((view) => view.tick === 2);
    expect(tick2View).toBeDefined();
    expect(tick2View!.observedFires.length).toBeGreaterThan(0);
    // The honest model (B18): seen a tick after it happened, from the human's real press, never
    // fabricated and never same-tick.
    const shot = tick2View!.observedFires.find(
      (fire: FiredEvent) => fire.shooterSessionId === "human",
    );
    expect(shot).toBeDefined();
    expect(shot!.tick).toBe(1);
  });

  it("drains the events bag every tick, so a long practice session cannot grow it without bound", () => {
    const room = readyPracticeRoom("medium");

    for (let t = 1; t <= 200; t++) {
      // Pressed every tick so the bag is actually exercised repeatedly across the run, not merely
      // empty because nothing ever fired.
      room.inputQueues.get("human")?.push({ seq: t, steer: 0, throttle: 0, fireSlots: 0b111 });
      room.tick();
      expect(room.botEvents.fired.length).toBe(0);
      expect(room.botEvents.damaged.length).toBe(0);
      expect(room.botEvents.killed.length).toBe(0);
    }
  });
});
