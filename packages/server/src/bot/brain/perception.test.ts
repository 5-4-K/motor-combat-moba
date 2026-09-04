import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotView } from "../types.js";
import { activeThreats, knownCars, newPerception, perceive, ultIsSpent } from "./perception.js";

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
});
