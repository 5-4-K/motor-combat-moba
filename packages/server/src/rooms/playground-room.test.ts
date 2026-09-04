import { describe, expect, it, vi } from "vitest";
import {
  BOT_SESSION_ID,
  PlayerState,
  PlaygroundState,
  RoomPhase,
  WEAPON_TABLE,
  hpOf,
  type BotDifficulty,
  type CombatEvents,
  type FiredEvent,
  type InputMessage,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../config/bot-profiles.js";
import { HumanController, ViewRing, type BotView } from "../bot/index.js";
import {
  ARENA_BUSY_ERROR,
  PLAYGROUND_BUSY_ERROR,
  PLAYGROUND_LEVEL,
  PlaygroundRoom,
  loadoutOrChassisChanged,
  otherPlaygroundId,
  shouldRefusePlayground,
} from "./PlaygroundRoom.js";
import { shouldRejectSecondArena } from "./singleton-arena.js";

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
    // The tuning store is process-wide: sliders here would re-balance that session next door.
    expect(shouldRefusePlayground([], [{ clients: 1 }])).toBe(true);
  });

  it("refuses when both are busy", () => {
    expect(shouldRefusePlayground([{ clients: 2 }], [{ clients: 1 }])).toBe(true);
  });
});

// `PlaygroundRoom.onCreate` reuses `shouldRejectSecondArena` unchanged to refuse a SECOND playground
// room (PG15): `maxClients = 1` only rejects a second client, so a full room makes `joinOrCreate`
// spin up another one, and the tuning store `setTuning` writes through is process-wide — two
// playground rooms alive at once fight over it, and either closing wipes the survivor's tables.
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

describe("otherPlaygroundId", () => {
  it("flips the human session to the bot and back", () => {
    expect(otherPlaygroundId("abc", "abc")).toBe(BOT_SESSION_ID);
    expect(otherPlaygroundId(BOT_SESSION_ID, "abc")).toBe("abc");
  });

  it("resolves anything else to the human — an unset control field is not a third car", () => {
    expect(otherPlaygroundId("", "abc")).toBe("abc");
  });
});

describe("ARENA_BUSY_ERROR", () => {
  it("names the fix, not the rule", () => {
    expect(ARENA_BUSY_ERROR).toContain("Close the arena first");
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
 * identical ring/events machinery independently, through its own `tick`/`enqueueOpponentInput`/`ctx`,
 * and nothing before this block named `botRing`, `observedFires`, or `stalenessTicks` here either.
 *
 * `readyPlaygroundRoom` skips `onCreate` (its matchmaker queries) and `applySetup` (chassis/loadout
 * wiring this file does not need) — it sets exactly what `tick()` and `enqueueOpponentInput()` read.
 */
describe("Task 8: the view ring and the fired sink actually run outside the harness", () => {
  interface PlaygroundRoomHarness {
    state: PlaygroundState;
    humanSessionId: string;
    inputQueues: Map<string, InputMessage[]>;
    botEvents: CombatEvents;
    setState(state: PlaygroundState): void;
    addCar(sessionId: string, name: string, usedColorIds: number[], team: number): PlayerState;
    tick(): void;
  }

  function readyPlaygroundRoom(difficulty: BotDifficulty): PlaygroundRoomHarness {
    const room = new PlaygroundRoom() as unknown as PlaygroundRoomHarness;
    room.setState(new PlaygroundState());
    // What `onCreate` pins before the sim ever runs (PG6) — nothing else here opens the gate.
    room.state.phase = RoomPhase.MATCH;
    room.state.botEnabled = true;
    room.state.botDifficulty = difficulty;
    room.humanSessionId = "human";
    room.state.controlledSessionId = "human"; // so `otherPlaygroundId` resolves the opponent to the bot

    const human = room.addCar("human", "Player", [], 0);
    const bot = room.addCar(BOT_SESSION_ID, "Bot", [human.colorId], 1);
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
    room.inputQueues.get("human")?.push({ seq: 1, steer: 0, throttle: 0, fireSlots: 0b111 });
    room.tick(); // tick 1: the press resolves, a FiredEvent lands in botEvents, then gets drained.
    room.tick(); // tick 2: the bot's own decide() call should now see it.
    decideSpy.mockRestore();

    const tick2View = seenViews.find((view) => view.tick === 2);
    expect(tick2View).toBeDefined();
    expect(tick2View!.observedFires.length).toBeGreaterThan(0);
    const shot = tick2View!.observedFires.find(
      (fire: FiredEvent) => fire.shooterSessionId === "human",
    );
    expect(shot).toBeDefined();
    expect(shot!.tick).toBe(1);
  });

  it("drains the events bag every tick, so a long playground session cannot grow it without bound", () => {
    const room = readyPlaygroundRoom("medium");

    for (let t = 1; t <= 200; t++) {
      room.inputQueues.get("human")?.push({ seq: t, steer: 0, throttle: 0, fireSlots: 0b111 });
      room.tick();
      expect(room.botEvents.fired.length).toBe(0);
      expect(room.botEvents.damaged.length).toBe(0);
      expect(room.botEvents.killed.length).toBe(0);
    }
  });
});
