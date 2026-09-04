import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotView } from "../types.js";
import { activeThreats, acquiringUnnoticed, knownCars, lastKnownAnchor, nearestHeardShot, newPerception, perceive, predictedPose, searchWaypoint, ultIsSpent } from "./perception.js";

function car(overrides: Partial<BotCarView> = {}): BotCarView {
  return {
    sessionId: "them", carId: "mirage", team: 0,
    x: 300, y: 100, angle: 0, speed: 0, hp: 70, maxHp: 70,
    alive: true, phased: false, statuses: [], maneuver: 0,
    ...overrides,
  };
}

function view(overrides: Partial<BotView> = {}): BotView {
  return {
    tick: 0,
    self: {
      sessionId: "me", carId: "bullseye", team: 0,
      x: 100, y: 100, angle: 0, speed: 0, hp: 65, maxHp: 65, alive: true,
      statuses: [], slots: [], switchLockUntilTick: 0, lockTargetSessionId: "",
      maneuver: 0, maneuverTicksLeft: 0,
    },
    others: [], instances: [], arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [], rng: makeRng(3),
    ...overrides,
  };
}

describe("perceive", () => {
  it("does not know a car until its acquire delay has passed", () => {
    const profile = BOT_PROFILES.hard; // acquireTicks 5
    let state = newPerception();
    state = perceive(state, view({ tick: 0, others: [car()] }), profile);
    expect(knownCars(state, 0)).toHaveLength(0);
    for (let tick = 1; tick <= 5; tick++) {
      state = perceive(state, view({ tick, others: [car()] }), profile);
    }
    expect(knownCars(state, 5)).toHaveLength(1);
  });

  it("never notices a car beyond the awareness radius", () => {
    const profile = BOT_PROFILES.easy; // 520 units
    let state = newPerception();
    for (let tick = 0; tick < 40; tick++) {
      state = perceive(state, view({ tick, others: [car({ x: 1000 })] }), profile);
    }
    expect(knownCars(state, 40)).toHaveLength(0);
  });

  it("never notices a car inside the rear blind arc", () => {
    const profile = BOT_PROFILES.easy; // rearBlindHalfAngleRad 1.05
    let state = newPerception();
    // Self faces +x at the origin-ish; a car directly behind is at a bearing of pi.
    for (let tick = 0; tick < 40; tick++) {
      state = perceive(state, view({ tick, others: [car({ x: -100, y: 100 })] }), profile);
    }
    expect(knownCars(state, 40)).toHaveLength(0);
  });

  it("forgets a car once it has been out of sight for memoryTicks", () => {
    const profile = BOT_PROFILES.easy; // memoryTicks 15
    let state = newPerception();
    for (let tick = 0; tick <= 20; tick++) {
      state = perceive(state, view({ tick, others: [car({ x: 300 })] }), profile);
    }
    expect(knownCars(state, 20)).toHaveLength(1);
    for (let tick = 21; tick <= 40; tick++) {
      state = perceive(state, view({ tick, others: [] }), profile);
    }
    expect(knownCars(state, 40)).toHaveLength(0);
  });

  it("caps the tracked threat list at the tier's limit", () => {
    const profile = BOT_PROFILES.easy; // trackedThreatLimit 1
    const instances = [0, 1, 2].map((i) => ({
      id: `i${i}`, ownerSessionId: "them", weaponId: "predator" as const,
      x: 400 + i * 10, y: 100, angle: Math.PI,
    }));
    let state = newPerception();
    for (let tick = 0; tick < 20; tick++) {
      state = perceive(state, view({ tick, instances }), profile);
    }
    expect(state.threats.size).toBeLessThanOrEqual(1);
  });

  it("remembers who fired what, so an ult can be tracked (H22)", () => {
    let state = newPerception();
    state = perceive(
      state,
      view({
        tick: 10,
        observedFires: [{
          tick: 10, shooterSessionId: "them", carId: "bullseye",
          weaponId: "lance", slot: 2, pressId: "them#10#2",
        }],
      }),
      BOT_PROFILES.hard,
    );
    expect(ultIsSpent(state, "them", "lance", 40, 480)).toBe(true);
    expect(ultIsSpent(state, "them", "lance", 600, 480)).toBe(false);
  });

  it("marks a shot on a collision course as a threat", () => {
    const profile = BOT_PROFILES.hard;
    let state = newPerception();
    // A predator at (400,100) heading -x, straight at self at (100,100).
    const instances = [{
      id: "shot", ownerSessionId: "them", weaponId: "predator" as const,
      x: 400, y: 100, angle: Math.PI,
    }];
    for (let tick = 0; tick < 10; tick++) {
      state = perceive(state, view({ tick, instances }), profile);
    }
    expect(activeThreats(state, 9).length).toBeGreaterThan(0);
  });

  it("ignores a shot that will pass well wide", () => {
    const profile = BOT_PROFILES.hard;
    let state = newPerception();
    const instances = [{
      id: "wide", ownerSessionId: "them", weaponId: "predator" as const,
      x: 400, y: 600, angle: Math.PI,
    }];
    for (let tick = 0; tick < 10; tick++) {
      state = perceive(state, view({ tick, instances }), profile);
    }
    expect(activeThreats(state, 9)).toHaveLength(0);
  });

  it("treats an attached beam aimed at the bot as a threat (G17)", () => {
    const profile = BOT_PROFILES.hard;
    let state = newPerception();
    const instances = [{
      id: "beam", ownerSessionId: "them", weaponId: "afterburner" as const,
      x: 400, y: 100, angle: Math.PI,
    }];
    for (let tick = 0; tick < 10; tick++) {
      state = perceive(state, view({ tick, instances }), profile);
    }
    expect(activeThreats(state, 9).length).toBeGreaterThan(0);
  });
});

describe("hunt cues (G12, G13)", () => {
  it("predicts last-known along last seen velocity, not the frozen spot", () => {
    let state = newPerception();
    const profile = { ...BOT_PROFILES.hard, acquireTicks: 0 };
    const moving = car({ x: 300, y: 100, angle: 0, speed: 300 });
    state = perceive(state, view({ tick: 0, others: [moving] }), profile);
    const known = [...state.cars.values()][0]!;
    const pose = predictedPose(known, 30); // 1 second later at 30 Hz
    expect(pose.x).toBeCloseTo(300 + 300, 5);
    expect(pose.y).toBeCloseTo(100, 5);
  });

  it("does not treat an unnoticed car as last-known (G13)", () => {
    const profile = BOT_PROFILES.hard; // acquireTicks 5
    let state = newPerception();
    state = perceive(state, view({ tick: 0, others: [car()] }), profile);
    expect(acquiringUnnoticed(state, 0)).toBe(true);
    expect(lastKnownAnchor(state, 0)).toBeUndefined();
  });

  it("anchors on a noticed car that has left awareness", () => {
    const profile = { ...BOT_PROFILES.hard, acquireTicks: 0, memoryTicks: 90 };
    let state = newPerception();
    state = perceive(state, view({ tick: 0, others: [car({ x: 400, y: 200 })] }), profile);
    state = perceive(state, view({ tick: 1, others: [] }), profile);
    const anchor = lastKnownAnchor(state, 1);
    expect(anchor).toEqual({ x: 400, y: 200 });
  });

  it("hears the nearest foreign instance", () => {
    const heard = nearestHeardShot(
      { sessionId: "me", x: 100, y: 100 },
      [
        { id: "far", ownerSessionId: "them", weaponId: "predator", x: 800, y: 100, angle: 0 },
        { id: "near", ownerSessionId: "them", weaponId: "predator", x: 200, y: 100, angle: 0 },
        { id: "mine", ownerSessionId: "me", weaponId: "predator", x: 110, y: 100, angle: 0 },
      ],
    );
    expect(heard).toEqual({ x: 200, y: 100 });
  });

  it("search waypoints are the four quadrants, never the centre", () => {
    const arena = { width: 1280, height: 720 };
    const points = [0, 1, 2, 3].map((i) => searchWaypoint(i, arena));
    for (const p of points) {
      expect(p.x).not.toBe(arena.width / 2);
      expect(p.y).not.toBe(arena.height / 2);
    }
    expect(points[0]).toEqual({ x: 320, y: 180 });
    expect(searchWaypoint(4, arena)).toEqual(points[0]);
  });
});
