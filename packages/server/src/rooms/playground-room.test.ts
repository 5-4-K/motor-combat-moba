import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import {
  ACTIVE_ARENA_ID,
  ARENA_IDS,
  BOT_SESSION_ID,
  PLAYGROUND_SEAT_IDS,
  PlayerState,
  PlaygroundState,
  RoomPhase,
  WEAPON_TABLE,
  defaultPlaygroundSetup,
  drive,
  forwardMaxSpeedOf,
  hpOf,
  pairKey,
  slotsOf,
  speedOf,
  weapons,
  type BotDifficulty,
  type CarId,
  type CombatEvents,
  type FiredEvent,
  type InputMessage,
  type ModeConfig,
  type PlaygroundSetup,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../config/bot-profiles.js";
import { HumanController, ViewRing, type BotView } from "../bot/index.js";
import {
  ARENA_BUSY_ERROR,
  PLAYGROUND_BUSY_ERROR,
  PLAYGROUND_LEVEL,
  PlaygroundRoom,
  loadoutOrChassisChanged,
  seatIndexOf,
  shouldRefusePlayground,
} from "./PlaygroundRoom.js";
import { scoped } from "./mode-scope.js";
import { shouldRejectSecondArena } from "./singleton-arena.js";
import type { CombatMemory } from "../sim/combat-bridge.js";
import type { ContactMemory } from "../sim/ram-bridge.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const ROOM_SOURCE = readFileSync(
  fileURLToPath(new URL("./PlaygroundRoom.ts", import.meta.url)),
  "utf8",
);

/** The module minus its prose: these are assertions about CODE, not about how it is documented. */
const ROOM_CODE = ROOM_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("shouldRefusePlayground", () => {
  it("opens when nothing else is running", () => {
    expect(shouldRefusePlayground([], [])).toBe(false);
  });

  it("opens when the arena is listed but empty", () => {
    expect(shouldRefusePlayground([{ clients: 0 }], [])).toBe(false);
  });

  it("refuses while anyone sits in the arena", () => {
    expect(shouldRefusePlayground([{ clients: 1 }], [])).toBe(true);
  });

  it("refuses while a practice room is open (PR10)", () => {
    // Historically a tuning-leak guard — the store was process-wide and sliders here re-balanced
    // that session next door. Tuning is per-room now; the rule stands on "a dev sandbox does not
    // run beside a live session" instead. See `shouldRefusePlayground`'s own doc comment.
    expect(shouldRefusePlayground([], [{ clients: 1 }])).toBe(true);
  });

  it("refuses when both are busy", () => {
    expect(shouldRefusePlayground([{ clients: 2 }], [{ clients: 1 }])).toBe(true);
  });
});

// `PlaygroundRoom.onCreate` reuses `shouldRejectSecondArena` unchanged to refuse a SECOND playground
// room (PG15): `maxClients = 1` only rejects a second client, so a full room makes `joinOrCreate`
// spin up another one. The original reason was a shared tuning store two rooms would fight over;
// that store is gone (MC39/MC40) and each room tunes its own bundle, so what is left is that a
// playground is meant to be a singleton dev tool — see `PlaygroundRoom.onCreate`'s own comment.
describe("shouldRejectSecondArena (reused for the second-playground guard)", () => {
  it("refuses when another playground room is already listed", () => {
    expect(shouldRejectSecondArena([{ roomId: "old" }], "new")).toBe(true);
  });

  it("allows when only this room (about to finish creating) is listed", () => {
    expect(shouldRejectSecondArena([{ roomId: "self" }], "self")).toBe(false);
  });

  it("allows an empty listing", () => {
    expect(shouldRejectSecondArena([], "self")).toBe(false);
  });
});

describe("PLAYGROUND_BUSY_ERROR", () => {
  it("names what happened, not the mechanism", () => {
    expect(PLAYGROUND_BUSY_ERROR).toContain("already open");
  });
});

describe("PLAYGROUND_LEVEL", () => {
  it("unlocks every weapon on the roster, so no slot is dead in the sandbox", () => {
    for (const [id, def] of Object.entries(WEAPON_TABLE)) {
      expect(`${id}:${def.unlocksAt <= PLAYGROUND_LEVEL}`).toBe(`${id}:true`);
    }
  });
});

describe("seatIndexOf (PG57)", () => {
  it("maps each seat id to its index", () => {
    PLAYGROUND_SEAT_IDS.forEach((id, i) => expect(seatIndexOf(id)).toBe(i));
  });

  it("returns -1 for anything that is not a seat", () => {
    // A client session id, the practice room's bot id, and junk all land here: this room's cars are
    // its seats and nothing else.
    expect(seatIndexOf("")).toBe(-1);
    expect(seatIndexOf(BOT_SESSION_ID)).toBe(-1);
    expect(seatIndexOf("aBcDeF123")).toBe(-1);
  });
});

describe("ARENA_BUSY_ERROR", () => {
  it("tells the player what to do, in their words, with no mechanism in it", () => {
    // It is shown on the join screen to whoever tried to open the playground. It used to end
    // "playground tuning is process-wide", which was jargon while it was true and is now simply
    // false (MC39/MC40).
    expect(ARENA_BUSY_ERROR).toContain("Close the arena");
    expect(ARENA_BUSY_ERROR).not.toMatch(/process-wide|tuning|store|bundle|setTuning/i);
  });
});

describe("loadoutOrChassisChanged (PG32)", () => {
  const setup = {
    carId: "bastion",
    colorId: 3,
    weapons: ["thumper", "roadblock", "wildcharge"],
  } as const;

  it("is false when chassis and loadout both already match", () => {
    expect(loadoutOrChassisChanged("bastion", ["thumper", "roadblock", "wildcharge"], setup)).toBe(
      false,
    );
  });

  it("is true on a chassis change", () => {
    expect(loadoutOrChassisChanged("mirage", ["thumper", "roadblock", "wildcharge"], setup)).toBe(
      true,
    );
  });

  it("is true on a loadout change, including a reorder", () => {
    expect(loadoutOrChassisChanged("bastion", ["thumper", "roadblock", "lance"], setup)).toBe(true);
    expect(loadoutOrChassisChanged("bastion", ["roadblock", "thumper", "wildcharge"], setup)).toBe(
      true,
    );
  });

  it("is true when the room has no loadout recorded yet", () => {
    expect(loadoutOrChassisChanged("bastion", [], setup)).toBe(true);
  });

  it("IGNORES colour — a repaint must not cost hp, cooldowns and a pose (PG32)", () => {
    const repainted = { ...setup, colorId: 5 } as const;
    expect(
      loadoutOrChassisChanged("bastion", ["thumper", "roadblock", "wildcharge"], repainted),
    ).toBe(false);
  });
});

/**
 * The Task 8 host wiring, mirrored from `practice-room.test.ts` — see that file's own describe block
 * for the full rationale (every piece threads through optional parameters, so a regression here
 * compiles clean and passes every other suite). Kept here too because `PlaygroundRoom` wires the
 * identical ring/events machinery independently, through its own `tick`/`enqueueAiInputs`/`ctx`, and
 * nothing before this block named `botRing`, `observedFires`, or `stalenessTicks` here either.
 *
 * Re-keyed onto seats (post-PG57 ruling): this block tests the view ring and the fired-events sink,
 * not the identity of the two cars, so seat 0 (driven) and seat 1 (bot) preserve exactly what it was
 * written to measure — `state.controlledSessionId` is what names the driven car now, and
 * `enqueueAiInputs` iterates `PLAYGROUND_SEAT_IDS` only, so a car keyed on anything else would
 * receive no input and go quiet rather than fail loudly.
 *
 * `readyPlaygroundRoom` skips `onCreate` (its matchmaker queries) and `applySetup` (chassis/loadout
 * wiring this file does not need) — it sets exactly what `tick()` and `enqueueAiInputs()` read.
 */
describe("Task 8: the view ring and the fired sink actually run outside the harness", () => {
  const DRIVEN = PLAYGROUND_SEAT_IDS[0]!;
  const BOT_SEAT = PLAYGROUND_SEAT_IDS[1]!;

  interface PlaygroundRoomHarness {
    state: PlaygroundState;
    inputQueues: Map<string, InputMessage[]>;
    botEvents: CombatEvents;
    setState(state: PlaygroundState): void;
    addCar(sessionId: string, name: string, colorId: number, team: number): PlayerState;
    tick(): void;
  }

  function readyPlaygroundRoom(difficulty: BotDifficulty): PlaygroundRoomHarness {
    const room = new PlaygroundRoom() as unknown as PlaygroundRoomHarness;
    room.setState(new PlaygroundState());
    // What `onCreate` pins before the sim ever runs (PG6) — nothing else here opens the gate.
    room.state.phase = RoomPhase.MATCH;
    room.state.botEnabled = true;
    room.state.botDifficulty = difficulty;
    room.state.controlledSessionId = DRIVEN; // so `enqueueAiInputs` drives every other seat as a bot

    const human = room.addCar(DRIVEN, "Player", 0, 0);
    const bot = room.addCar(BOT_SEAT, "Bot", 1, 1);
    // `addCar` never sets `carId` here — the real room does that through `applySetup`, which this
    // harness skips (it also grants spawn-protected `phased`, which would complicate the staleness/
    // firing scenarios below for no benefit). hp likewise defaults to 0 and is set directly.
    human.carId = "mirage";
    bot.carId = "bastion";
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
    const room = readyPlaygroundRoom("medium");
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
    const room = readyPlaygroundRoom("easy"); // viewStalenessTicks = 4, ring capacity 5
    const staleness = BOT_PROFILES.easy.viewStalenessTicks;
    const seenViews: BotView[] = [];

    // Mocked to a neutral hold, same reasoning as the practice-room version of this test: the bot's
    // own real decision is irrelevant here and, left real, could drive it into the human and
    // confound the position read below with a ram.
    const decideSpy = vi.spyOn(HumanController.prototype, "decide").mockImplementation(function (
      this: HumanController,
      view: BotView,
    ) {
      seenViews.push(view);
      return { steer: 0, throttle: 0, fireSlots: 0 };
    });

    const human = room.state.players.get(DRIVEN)!;
    const totalTicks = staleness + 6;
    for (let t = 1; t <= totalTicks; t++) {
      human.x = t * 10; // a fact only the LIVE world knows on tick t
      room.tick();
    }
    decideSpy.mockRestore();

    const lastView = seenViews.at(-1)!;
    expect(lastView.tick).toBe(totalTicks);
    const seenHuman = lastView.others.find((car) => car.sessionId === DRIVEN);
    expect(seenHuman).toBeDefined();
    expect(seenHuman!.x).toBe((totalTicks - staleness) * 10);
    expect(seenHuman!.x).not.toBe(human.x);
  });

  it("carries observedFires from a real fired shot into the NEXT tick's view (B18)", () => {
    const room = readyPlaygroundRoom("medium");
    const seenViews: BotView[] = [];

    const originalDecide = HumanController.prototype.decide;
    const decideSpy = vi.spyOn(HumanController.prototype, "decide").mockImplementation(function (
      this: HumanController,
      view: BotView,
    ) {
      seenViews.push(view);
      return originalDecide.call(this, view);
    });

    // A REAL press through the ordinary input queue, exactly as `practice-room.test.ts` forces one —
    // see that test's comment for why this does not depend on the bot's own AI ever choosing to fire.
    room.inputQueues.get(DRIVEN)?.push({ seq: 1, steer: 0, throttle: 0, fireSlots: 0b111 });
    room.tick(); // tick 1: the press resolves, a FiredEvent lands in botEvents, then gets drained.
    room.tick(); // tick 2: the bot's own decide() call should now see it.
    decideSpy.mockRestore();

    const tick2View = seenViews.find((view) => view.tick === 2);
    expect(tick2View).toBeDefined();
    expect(tick2View!.observedFires.length).toBeGreaterThan(0);
    const shot = tick2View!.observedFires.find(
      (fire: FiredEvent) => fire.shooterSessionId === DRIVEN,
    );
    expect(shot).toBeDefined();
    expect(shot!.tick).toBe(1);
  });

  it("drains the events bag every tick, so a long playground session cannot grow it without bound", () => {
    const room = readyPlaygroundRoom("medium");

    for (let t = 1; t <= 200; t++) {
      room.inputQueues.get(DRIVEN)?.push({ seq: t, steer: 0, throttle: 0, fireSlots: 0b111 });
      room.tick();
      expect(room.botEvents.fired.length).toBe(0);
      expect(room.botEvents.damaged.length).toBe(0);
      expect(room.botEvents.killed.length).toBe(0);
    }
  });
});

describe("seat lifecycle (PG66/PG67/PG68)", () => {
  interface SetupHarness {
    state: PlaygroundState;
    combat: CombatMemory;
    ram: ContactMemory;
    inputQueues: Map<string, InputMessage[]>;
    prevFireMasks: Map<string, number>;
    silentTicks: Map<string, number>;
    matchRoster: Set<string>;
    phaseCaps: Map<string, number>;
    setState(state: PlaygroundState): void;
    applySetup(setup: PlaygroundSetup): void;
  }

  function readyRoom(): SetupHarness {
    const room = new PlaygroundRoom() as unknown as SetupHarness;
    room.setState(new PlaygroundState());
    room.state.phase = RoomPhase.MATCH;
    room.state.arenaId = ACTIVE_ARENA_ID;
    return room;
  }

  /** The default setup with `mutate` applied — a fresh, legal six-seat blob every call. */
  function setupWith(mutate: (s: PlaygroundSetup) => PlaygroundSetup): PlaygroundSetup {
    return mutate(defaultPlaygroundSetup());
  }

  const enable = (s: PlaygroundSetup, ...seats: number[]): PlaygroundSetup => ({
    ...s,
    cars: s.cars.map((c, i) => ({ ...c, enabled: seats.includes(i) })),
    drivenSeat: seats[0]!,
  });

  it("opens the default setup with exactly two cars on the field", () => {
    const room = readyRoom();
    room.applySetup(defaultPlaygroundSetup());
    expect([...room.state.players.keys()]).toEqual([PLAYGROUND_SEAT_IDS[0], PLAYGROUND_SEAT_IDS[1]]);
    expect(room.state.controlledSessionId).toBe(PLAYGROUND_SEAT_IDS[0]);
  });

  it("adds a car when a seat is enabled", () => {
    const room = readyRoom();
    room.applySetup(defaultPlaygroundSetup());
    room.applySetup(setupWith((s) => enable(s, 0, 1, 4)));

    const added = room.state.players.get(PLAYGROUND_SEAT_IDS[4]!);
    expect(added).toBeDefined();
    expect(added!.alive).toBe(true);
    expect(added!.hp).toBe(hpOf(added!.carId));
    expect(room.matchRoster.has(PLAYGROUND_SEAT_IDS[4]!)).toBe(true);
    expect(room.inputQueues.has(PLAYGROUND_SEAT_IDS[4]!)).toBe(true);
  });

  it("removes a car, and every map entry with it, when a seat is disabled (PG67)", () => {
    const room = readyRoom();
    room.applySetup(setupWith((s) => enable(s, 0, 1, 2)));
    const gone = PLAYGROUND_SEAT_IDS[2]!;
    // State the removal has to clear, planted where the sim would have left it.
    room.ram.contacts.add(pairKey(gone, PLAYGROUND_SEAT_IDS[0]!));
    room.ram.falloff.set(gone, { count: 2, expiresAtTick: 99 });

    room.applySetup(setupWith((s) => enable(s, 0, 1)));

    expect(room.state.players.has(gone)).toBe(false);
    expect(room.inputQueues.has(gone)).toBe(false);
    expect(room.prevFireMasks.has(gone)).toBe(false);
    expect(room.silentTicks.has(gone)).toBe(false);
    expect(room.matchRoster.has(gone)).toBe(false);
    expect(room.phaseCaps.has(gone)).toBe(false);
    expect(room.combat.loadouts.has(gone)).toBe(false);
    expect(room.combat.fireStates.has(gone)).toBe(false);
    expect(room.ram.falloff.has(gone)).toBe(false);
    expect(room.ram.contacts.size).toBe(0);
  });

  it("respawns a car whose chassis changed, and NOT one whose colour changed (PG68/PG32)", () => {
    const room = readyRoom();
    room.applySetup(defaultPlaygroundSetup());
    const seat0 = room.state.players.get(PLAYGROUND_SEAT_IDS[0]!)!;
    const seat1 = room.state.players.get(PLAYGROUND_SEAT_IDS[1]!)!;
    seat0.x = 123;
    seat0.y = 456;
    seat1.x = 700;
    seat1.y = 400;
    seat1.hp = 5;

    room.applySetup(
      setupWith((s) => ({
        ...s,
        cars: s.cars.map((c, i) =>
          i === 0 ? { ...c, carId: "bastion", weapons: slotsOf("bastion") as typeof c.weapons } : i === 1 ? { ...c, colorId: 4 } : c,
        ),
      })),
    );

    // Seat 0 changed chassis: moved off its planted pose and given fresh hp.
    expect(room.state.players.get(PLAYGROUND_SEAT_IDS[0]!)!.x).not.toBe(123);
    expect(room.state.players.get(PLAYGROUND_SEAT_IDS[0]!)!.hp).toBe(hpOf("bastion"));
    // Seat 1 changed only its colour: repainted in place, hp and pose untouched.
    expect(room.state.players.get(PLAYGROUND_SEAT_IDS[1]!)!.colorId).toBe(4);
    expect(room.state.players.get(PLAYGROUND_SEAT_IDS[1]!)!.x).toBe(700);
    expect(room.state.players.get(PLAYGROUND_SEAT_IDS[1]!)!.hp).toBe(5);
  });

  it("accepts and respawns a seat carrying fewer than N weapons (VS34)", () => {
    // A seat's loadout is no longer always three: `applySetup` has no length assumption of its own,
    // and this is the room-level proof that a short kit reaches `combat.loadouts` and the fresh
    // `FireState` intact rather than being padded, truncated, or rejected.
    const room = readyRoom();
    room.applySetup(defaultPlaygroundSetup());

    const short = ["thumper"] as const;
    room.applySetup(
      setupWith((s) => ({
        ...s,
        cars: s.cars.map((c, i) => (i === 0 ? { ...c, carId: "bastion", weapons: short } : c)),
      })),
    );

    const seat0 = PLAYGROUND_SEAT_IDS[0]!;
    expect(room.combat.loadouts.get(seat0)).toEqual(short);
    // Basic attack (slot 0) plus the one-weapon kit (VS6/BA-basic-attack-slot-0).
    expect(room.combat.fireStates.get(seat0)!.slots).toHaveLength(2);
  });

  it("respawns every enabled car on an arena change", () => {
    const room = readyRoom();
    room.applySetup(setupWith((s) => enable(s, 0, 1, 3)));
    for (const seat of [0, 1, 3]) {
      room.state.players.get(PLAYGROUND_SEAT_IDS[seat]!)!.x = 11;
    }

    const other = ARENA_IDS.find((id) => id !== room.state.arenaId)!;
    room.applySetup(setupWith((s) => ({ ...enable(s, 0, 1, 3), arenaId: other })));

    for (const seat of [0, 1, 3]) {
      expect(room.state.players.get(PLAYGROUND_SEAT_IDS[seat]!)!.x).not.toBe(11);
    }
  });

  it("points controlledSessionId at the driven seat", () => {
    const room = readyRoom();
    room.applySetup(setupWith((s) => enable(s, 2, 5)));
    expect(room.state.controlledSessionId).toBe(PLAYGROUND_SEAT_IDS[2]);
  });
});

describe("enqueueAiInputs (PG70/PG71)", () => {
  interface AiHarness {
    state: PlaygroundState;
    inputQueues: Map<string, InputMessage[]>;
    bots: Map<string, unknown>;
    setState(state: PlaygroundState): void;
    applySetup(setup: PlaygroundSetup): void;
    enqueueAiInputs(): void;
  }

  function readyAiRoom(botEnabled: boolean, seats: number[]): AiHarness {
    const room = new PlaygroundRoom() as unknown as AiHarness;
    room.setState(new PlaygroundState());
    room.state.phase = RoomPhase.MATCH;
    room.state.arenaId = ACTIVE_ARENA_ID;
    const base = defaultPlaygroundSetup();
    room.applySetup({
      ...base,
      botEnabled,
      cars: base.cars.map((c, i) => ({ ...c, enabled: seats.includes(i) })),
      drivenSeat: seats[0]!,
    });
    return room;
  }

  it("queues nothing for the driven seat — that queue is the human's", () => {
    const room = readyAiRoom(false, [0, 1, 2]);
    room.enqueueAiInputs();
    expect(room.inputQueues.get(PLAYGROUND_SEAT_IDS[0]!)).toHaveLength(0);
  });

  it("queues a neutral input for every other enabled seat when the bot is off (PG71)", () => {
    const room = readyAiRoom(false, [0, 1, 2]);
    room.enqueueAiInputs();
    for (const seat of [1, 2]) {
      const queue = room.inputQueues.get(PLAYGROUND_SEAT_IDS[seat]!)!;
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ steer: 0, throttle: 0, fireSlots: 0 });
    }
    expect(room.bots.size).toBe(0);
  });

  it("builds one bot per non-driven enabled seat when the bot is on (PG69)", () => {
    const room = readyAiRoom(true, [0, 1, 2, 3]);
    room.enqueueAiInputs();
    expect([...room.bots.keys()].sort()).toEqual(
      [PLAYGROUND_SEAT_IDS[1]!, PLAYGROUND_SEAT_IDS[2]!, PLAYGROUND_SEAT_IDS[3]!].sort(),
    );
  });

  it("queues nothing at all for a disabled seat", () => {
    const room = readyAiRoom(true, [0, 1]);
    room.enqueueAiInputs();
    expect(room.inputQueues.has(PLAYGROUND_SEAT_IDS[4]!)).toBe(false);
  });

  it("gives each seat a distinct input seq on one tick", () => {
    const room = readyAiRoom(false, [0, 1, 2, 3]);
    room.enqueueAiInputs();
    const seqs = [1, 2, 3].map((s) => room.inputQueues.get(PLAYGROUND_SEAT_IDS[s]!)![0]!.seq);
    expect(new Set(seqs).size).toBe(3);
  });
});

describe("debugBot (PG72)", () => {
  interface DebugHarness {
    state: PlaygroundState;
    bots: Map<string, { currentTargetSessionId: string | undefined }>;
    setState(state: PlaygroundState): void;
    debugBot(): unknown;
  }

  function roomWithBots(targets: Record<number, string | undefined>): DebugHarness {
    const room = new PlaygroundRoom() as unknown as DebugHarness;
    room.setState(new PlaygroundState());
    room.state.controlledSessionId = PLAYGROUND_SEAT_IDS[0]!;
    for (const [seat, target] of Object.entries(targets)) {
      const bot = new HumanController("medium");
      // `currentTargetSessionId` is a getter over a private field; the brain sets it on its first
      // `decide`. Stubbing the getter is what keeps this test about the PICK rather than about the
      // planner.
      Object.defineProperty(bot, "currentTargetSessionId", { get: () => target });
      room.bots.set(PLAYGROUND_SEAT_IDS[Number(seat)]!, bot as never);
    }
    return room;
  }

  it("picks the bot targeting the driven car", () => {
    const room = roomWithBots({ 1: "pg-3", 2: "pg-0", 3: "pg-2" });
    expect(room.debugBot()).toBe(room.bots.get(PLAYGROUND_SEAT_IDS[2]!));
  });

  it("picks the lowest such seat when two are targeting the driven car", () => {
    const room = roomWithBots({ 1: "pg-0", 4: "pg-0" });
    expect(room.debugBot()).toBe(room.bots.get(PLAYGROUND_SEAT_IDS[1]!));
  });

  it("falls back to the first bot seat when nobody is targeting the driven car", () => {
    const room = roomWithBots({ 2: "pg-5", 5: "pg-2" });
    expect(room.debugBot()).toBe(room.bots.get(PLAYGROUND_SEAT_IDS[2]!));
  });

  it("returns undefined with no bots at all", () => {
    const room = roomWithBots({});
    expect(room.debugBot()).toBeUndefined();
  });
});

/**
 * Regression test for the IMPORTANT finding "playground tuning is inert server-side and diverges
 * on the client" (2026-09-22 final review). Before the fix, `MSG_PLAYGROUND_TUNING`'s handler
 * called `setTuning`, which calls shared's `installMode` — but the handler ran inside
 * `scoped(this.modeConfig, ...)`, whose `finally` restored `this.modeConfig` (the OLD bundle) the
 * instant the handler returned, discarding the install. Every later tick then re-entered through
 * its OWN `scoped(this.modeConfig, () => this.tick())`, re-installing the same stale bundle
 * regardless. The room's `modeConfig` field itself never moved, so a tuned value never reached a
 * live tick — measured as "server keeps 90, client uses 999" in the review, which reads as a
 * netcode fault rather than a config one.
 *
 * This drives the REAL handler path: `applyTuningMessage` wrapped in `scoped(room.modeConfig, ...)`
 * exactly as `onCreate`'s `onMessage(MSG_PLAYGROUND_TUNING, ...)` registers it, and a subsequent
 * `room.tick()` wrapped in `scoped(room.modeConfig, ...)` exactly as `setSimulationInterval`'s own
 * callback does. Calling either unscoped (as this file's other tests do for tick()) would not
 * reproduce the bug at all — the module-level bundle would simply stay whatever was last installed,
 * masking the exact defect this test exists to catch.
 */
describe("PlaygroundRoom tuning: a tuned value survives into a SUBSEQUENT tick (IMPORTANT, 2026-09-22)", () => {
  const DRIVEN = PLAYGROUND_SEAT_IDS[0]!;

  interface TuningHarness {
    modeConfig: ModeConfig;
    state: PlaygroundState;
    inputQueues: Map<string, InputMessage[]>;
    setState(state: PlaygroundState): void;
    addCar(sessionId: string, name: string, colorId: number, team: number): PlayerState;
    applyTuningMessage(msg: unknown): void;
    tick(): void;
  }

  function readyRoom(): TuningHarness {
    const room = new PlaygroundRoom() as unknown as TuningHarness;
    room.setState(new PlaygroundState());
    room.state.phase = RoomPhase.MATCH;
    room.state.controlledSessionId = DRIVEN;
    const car = room.addCar(DRIVEN, "Player", 0, 0);
    car.carId = "mirage";
    car.hp = hpOf("mirage");
    // Parked well clear of every arena wall, facing +x, throttle held — a straight acceleration
    // run with nothing else to explain a speed difference between the two configs.
    car.x = 640;
    car.y = 360;
    car.angle = 0;
    return room;
  }

  it("a `drive.baseMaxSpeed` override reaches a tick that runs AFTER the tuning message", () => {
    const room = readyRoom();

    // The shipped ceiling — the number a bugged run cannot get past no matter how long it drives.
    const shippedTopSpeed = scoped(room.modeConfig, () => forwardMaxSpeedOf("mirage" as CarId));
    const shippedBase = scoped(room.modeConfig, () => drive().baseMaxSpeed);

    // The tuning surface caps a positive field at 3x its shipped value (`numberRange` in
    // `tuning-walker.ts`) — this is that cap, the largest override `validateTuning` will accept.
    const tunedBase = shippedBase * 3;

    // The real handler path: `onCreate` wraps `applyTuningMessage` in exactly this scope.
    scoped(room.modeConfig, () => room.applyTuningMessage({ "drive.baseMaxSpeed": tunedBase }));

    // The room's OWN bundle must have moved — proof the fix (a field re-assignment, not just a
    // transient `installMode`) actually happened.
    const tunedTopSpeed = scoped(room.modeConfig, () => forwardMaxSpeedOf("mirage" as CarId));
    expect(tunedTopSpeed).toBeGreaterThan(shippedTopSpeed * 1.4);

    // Now prove a TICK actually reads it, through the exact wrapper `setSimulationInterval` uses.
    // Full throttle, straight ahead, re-centred after every tick so the run measures acceleration
    // toward a top speed rather than a wall collision.
    for (let t = 1; t <= 200; t++) {
      room.inputQueues.get(DRIVEN)?.push({ seq: t, steer: 0, throttle: 1, fireSlots: 0 });
      scoped(room.modeConfig, () => room.tick());
      const player = room.state.players.get(DRIVEN)!;
      player.x = 640;
      player.y = 360;
    }

    const player = room.state.players.get(DRIVEN)!;
    const reachedSpeed = speedOf(player.vx, player.vy);

    // dragRate is untouched by this override, so both configs converge to their own ceiling at the
    // same rate — 200 ticks (6.7s) against roughly a 0.8s time constant is many time constants deep,
    // comfortably converged. A car stuck on the SHIPPED ceiling (the pre-fix bug) tops out at
    // `shippedTopSpeed`; the busted-tuning failure mode reads as this assertion failing with
    // `reachedSpeed` stuck near `shippedTopSpeed` instead of near `tunedTopSpeed`.
    expect(reachedSpeed).toBeGreaterThan((shippedTopSpeed + tunedTopSpeed) / 2);
  });

  it("a SECOND tuning message replaces the first, rather than accumulating on top of it", () => {
    // The gap this closes (2026-09-23): no test drove `applyTuningMessage` twice, so the whole
    // "each blob starts fresh from the room's pristine base" rule — PG13's reject-whole promise,
    // and the reason the handler passes `modeConfigOrDefault(DEFAULT_GAME_MODE)` to
    // `applyOverrides` rather than `this.modeConfig` — was unguarded. Substituting `this.modeConfig`
    // for `base` at that one line makes overrides ACCUMULATE, and every other test in this file
    // still passes: a single blob reads identically either way.
    //
    // Two different roots, so accumulation is visible as "the first blob's change survived the
    // second", not merely as an arithmetic difference in one number.
    const room = readyRoom();
    const shippedTopSpeed = scoped(room.modeConfig, () => forwardMaxSpeedOf("mirage" as CarId));
    const shippedBase = scoped(room.modeConfig, () => drive().baseMaxSpeed);
    const shippedDamage = scoped(room.modeConfig, () => weapons().predator.damage);

    scoped(room.modeConfig, () => room.applyTuningMessage({ "drive.baseMaxSpeed": shippedBase * 3 }));
    expect(scoped(room.modeConfig, () => forwardMaxSpeedOf("mirage" as CarId))).toBeGreaterThan(
      shippedTopSpeed * 1.4,
    );

    scoped(room.modeConfig, () => room.applyTuningMessage({ "weapon.predator.damage": shippedDamage + 7 }));

    // The second blob's change is live...
    expect(scoped(room.modeConfig, () => weapons().predator.damage)).toBe(shippedDamage + 7);
    // ...and the first blob's is GONE — the bundle came from the pristine base, not from the bundle
    // the previous message produced.
    expect(scoped(room.modeConfig, () => drive().baseMaxSpeed)).toBe(shippedBase);
    expect(scoped(room.modeConfig, () => forwardMaxSpeedOf("mirage" as CarId))).toBe(shippedTopSpeed);
    // And the state the client mirrors agrees: it advertises the second blob alone.
    expect(JSON.parse(room.state.tuningJson)).toEqual({ "weapon.predator.damage": shippedDamage + 7 });
  });

  it("an empty blob resets the room all the way back to its pristine base", () => {
    const room = readyRoom();
    const shippedBase = scoped(room.modeConfig, () => drive().baseMaxSpeed);

    scoped(room.modeConfig, () => room.applyTuningMessage({ "drive.baseMaxSpeed": shippedBase * 3 }));
    scoped(room.modeConfig, () => room.applyTuningMessage({}));

    expect(scoped(room.modeConfig, () => drive().baseMaxSpeed)).toBe(shippedBase);
    expect(room.state.tuningJson).toBe("");
  });
});

// Mirror of `practice-room.test.ts`'s "the practice room never installs a bundle process-wide
// (PR10)" — but on the room the rule actually protects. `PracticeRoom` never tunes at all, so a
// source-text guard there catches nothing this room does; `PlaygroundRoom` is the ONE room that
// builds tuned bundles (`applyTuningMessage` -> `applyOverrides`), which is exactly why it is the
// one room `installMode` would be tempting to reach for — "so a tool can see the tuned numbers" —
// and exactly why doing so would be the leak this whole phase (MC39/MC40) removed: `installMode`
// writes the module-level "current bundle" one per PROCESS, not one per room, so a playground
// holding overrides would hand its own numbers to every other room alive in the process, a live
// arena match included. The room instead holds its own `this.modeConfig` and reads config through
// `scoped(this.modeConfig, ...)`, which restores the previous bundle on the way out.
//
// There is no typed way to assert an absence, so this reads the source — against ROOM_CODE,
// comments stripped, so naming `installMode` in a doc comment (as `PracticeRoom`'s own class header
// does, deliberately) cannot fail this. A guard against the specific regression a copy-paste of
// `installMode(this.modeConfig)` into this file would produce, not a proof — an aliased import or
// `room["installMode"]`-style indirection would slip straight through, exactly as the practice-room
// version admits for itself.
describe("the playground room never installs a bundle process-wide (F1, mirrors PR10)", () => {
  it("does not mention installMode anywhere in its module", () => {
    expect(ROOM_CODE).not.toContain("installMode");
  });
});
