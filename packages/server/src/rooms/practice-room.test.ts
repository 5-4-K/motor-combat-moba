import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
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
import { isIdleWarningDue, isPracticeIdle } from "./practice-rules.js";

const ROOM_SOURCE = readFileSync(
  fileURLToPath(new URL("./PracticeRoom.ts", import.meta.url)),
  "utf8",
);

/** The module minus its prose: these are assertions about CODE, not about how it is documented. */
const ROOM_CODE = ROOM_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("newPracticeState (PR9)", () => {
  it("opens in MATCH — nothing in this room reduces a flow to get there", () => {
    expect(newPracticeState().phase).toBe(RoomPhase.MATCH);
  });

  it("runs deathmatch rules, so death respawns instead of eliminating", () => {
    expect(newPracticeState().mode).toBe(GameMode.FFA_DEATHMATCH);
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

// The tuning store is a MODULE-LEVEL singleton, one per server process rather than one per room, so
// a practice room that wrote to it would silently re-balance every other room in the process —
// including a live arena match. There is no typed way to assert an absence, so this reads the source
// — against ROOM_CODE, comments stripped, so naming `setTuning` in a doc comment (as the class
// header above `PracticeRoom` now does, deliberately) cannot fail this the way it once did. These are
// guards against the specific regression a copy-paste from `PlaygroundRoom` would produce, not proofs
// — an aliased import or `player["setTuning"]`-style indirection would slip straight through.
describe("the practice room never touches the tuning store (PR10)", () => {
  it("does not mention setTuning anywhere in its module", () => {
    expect(ROOM_CODE).not.toContain("setTuning");
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
    for (const carId of activeCarIds()) {
      const slots = newFireState(carId, defaultLevel).slots.length;
      expect(`${carId}:${hpOf(carId) > 0}:${slots}`).toBe(`${carId}:true:3`);
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
