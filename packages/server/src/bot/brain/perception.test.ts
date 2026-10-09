import { TICK_RATE_HZ, weaponDefOf, type WeaponId } from "@motor-combat-moba/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { RESOLVED_BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotView } from "../types.js";
import { activeThreats, acquiringUnnoticed, knownCars, lastKnownAnchor, nearestHeardShot, newPerception, observedAngVelOf, perceive, predictedPose, readinessOf, searchWaypoint, threatEtaTicks, ultIsSpent } from "./perception.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

function car(overrides: Partial<BotCarView> = {}): BotCarView {
  return {
    sessionId: "them", carId: "mirage", team: 0,
    x: 300, y: 100, angle: 0, vx: 0, vy: 0, hp: 70, maxHp: 70,
    alive: true, phased: false, statuses: [], maneuver: 0,
    ...overrides,
  };
}

function view(overrides: Partial<BotView> = {}): BotView {
  return {
    tick: 0,
    self: {
      sessionId: "me", carId: "bullseye", team: 0,
      x: 100, y: 100, angle: 0, vx: 0, vy: 0, hp: 65, maxHp: 65, alive: true,
      statuses: [], slots: [], switchLockUntilTick: 0,
      maneuver: 0, maneuverTicksLeft: 0,
    },
    others: [], instances: [], arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [], rng: makeRng(3),
    ...overrides,
  };
}

describe("perceive", () => {
  it("does not know a car until its acquire delay has passed", () => {
    const profile = RESOLVED_BOT_PROFILES.hard;
    const acquire = profile.acquireTicks; // resolved from its authored ms at this tick rate
    let state = newPerception();
    state = perceive(state, view({ tick: 0, others: [car()] }), profile);
    expect(knownCars(state, 0)).toHaveLength(0);
    for (let tick = 1; tick <= acquire; tick++) {
      state = perceive(state, view({ tick, others: [car()] }), profile);
    }
    expect(knownCars(state, acquire)).toHaveLength(1);
  });

  it("never notices a car beyond the awareness radius", () => {
    const profile = RESOLVED_BOT_PROFILES.easy; // 520 units
    let state = newPerception();
    for (let tick = 0; tick < 40; tick++) {
      state = perceive(state, view({ tick, others: [car({ x: 1000 })] }), profile);
    }
    expect(knownCars(state, 40)).toHaveLength(0);
  });

  it("never notices a car inside the rear blind arc", () => {
    const profile = RESOLVED_BOT_PROFILES.easy; // rearBlindHalfAngleRad 1.05
    let state = newPerception();
    // Self faces +x at the origin-ish; a car directly behind is at a bearing of pi.
    for (let tick = 0; tick < 40; tick++) {
      state = perceive(state, view({ tick, others: [car({ x: -100, y: 100 })] }), profile);
    }
    expect(knownCars(state, 40)).toHaveLength(0);
  });

  it("forgets a car once it has been out of sight for memoryTicks", () => {
    const profile = RESOLVED_BOT_PROFILES.easy;
    // Seen long enough to be acquired, then unseen past `memoryTicks` — both resolved from their
    // authored ms at this tick rate, so the case is the same wall-clock story at any rate.
    const seenUntil = profile.acquireTicks + 5;
    const goneBy = seenUntil + profile.memoryTicks + 5;
    let state = newPerception();
    for (let tick = 0; tick <= seenUntil; tick++) {
      state = perceive(state, view({ tick, others: [car({ x: 300 })] }), profile);
    }
    expect(knownCars(state, seenUntil)).toHaveLength(1);
    for (let tick = seenUntil + 1; tick <= goneBy; tick++) {
      state = perceive(state, view({ tick, others: [] }), profile);
    }
    expect(knownCars(state, goneBy)).toHaveLength(0);
  });

  it("caps the tracked threat list at the tier's limit", () => {
    const profile = RESOLVED_BOT_PROFILES.easy; // trackedThreatLimit 1
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
      RESOLVED_BOT_PROFILES.hard,
    );
    expect(ultIsSpent(state, "them", "lance", 40, 480)).toBe(true);
    expect(ultIsSpent(state, "them", "lance", 600, 480)).toBe(false);
  });

  it("marks a shot on a collision course as a threat", () => {
    const profile = RESOLVED_BOT_PROFILES.hard;
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
    const profile = RESOLVED_BOT_PROFILES.hard;
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
    const profile = RESOLVED_BOT_PROFILES.hard;
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
    const profile = { ...RESOLVED_BOT_PROFILES.hard, acquireTicks: 0 };
    const moving = car({ x: 300, y: 100, angle: 0, vx: 300, vy: 0 });
    state = perceive(state, view({ tick: 0, others: [moving] }), profile);
    const known = [...state.cars.values()][0]!;
    const pose = predictedPose(known, TICK_RATE_HZ); // 1 second later
    expect(pose.x).toBeCloseTo(300 + 300, 5);
    expect(pose.y).toBeCloseTo(100, 5);
  });

  it("does not treat an unnoticed car as last-known (G13)", () => {
    const profile = RESOLVED_BOT_PROFILES.hard; // acquireTicks 5
    let state = newPerception();
    state = perceive(state, view({ tick: 0, others: [car()] }), profile);
    expect(acquiringUnnoticed(state, 0)).toBe(true);
    expect(lastKnownAnchor(state, 0)).toBeUndefined();
  });

  it("anchors on a noticed car that has left awareness", () => {
    const profile = { ...RESOLVED_BOT_PROFILES.hard, acquireTicks: 0, memoryTicks: 90 };
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

  it("refreshes a known car when it dies so memory cannot stay alive (S12)", () => {
    const profile = { ...RESOLVED_BOT_PROFILES.hard, acquireTicks: 0 };
    let state = newPerception();
    state = perceive(state, view({ tick: 0, others: [car({ alive: true })] }), profile);
    expect(knownCars(state, 0)[0]?.alive).toBe(true);
    state = perceive(state, view({ tick: 1, others: [car({ alive: false })] }), profile);
    expect(state.cars.get("them")?.car.alive).toBe(false);
  });
});

describe("observedAngVelOf", () => {
  it("is 0 for a car seen only once", () => {
    let state = newPerception();
    state = perceive(state, view({ tick: 0, others: [car({ x: 100, y: 100, angle: 0 })] }), RESOLVED_BOT_PROFILES.hard);
    expect(observedAngVelOf(state, "them")).toBe(0);
  });

  it("measures a turn from two observed poses", () => {
    let state = newPerception();
    state = perceive(state, view({ tick: 0, others: [car({ x: 100, y: 100, angle: 0 })] }), RESOLVED_BOT_PROFILES.hard);
    state = perceive(state, view({ tick: 1, others: [car({ x: 100, y: 100, angle: 0.2 })] }), RESOLVED_BOT_PROFILES.hard);
    // 0.2 rad in one tick == 0.2 * TICK_RATE_HZ rad/s.
    expect(observedAngVelOf(state, "them")).toBeCloseTo(0.2 * TICK_RATE_HZ, 3);
  });

  it("takes the short way round the seam rather than reading a near-full turn", () => {
    let state = newPerception();
    state = perceive(
      state,
      view({ tick: 0, others: [car({ x: 100, y: 100, angle: Math.PI - 0.05 })] }),
      RESOLVED_BOT_PROFILES.hard,
    );
    state = perceive(
      state,
      view({ tick: 1, others: [car({ x: 100, y: 100, angle: -Math.PI + 0.05 })] }),
      RESOLVED_BOT_PROFILES.hard,
    );
    // 0.1 rad across the seam in one tick, not 2*pi - 0.1.
    expect(Math.abs(observedAngVelOf(state, "them"))).toBeCloseTo(0.1 * TICK_RATE_HZ, 3);
  });
});

describe("readinessOf", () => {
  it("assumes a weapon never seen fired is loaded", () => {
    const state = newPerception();
    expect(readinessOf(state, "them", "predator", 100, RESOLVED_BOT_PROFILES.hard)).toBe(1);
  });

  it("treats a weapon seen fired one tick ago as spent", () => {
    const state = newPerception();
    state.firedSeenTick.set("them:lance", 100);
    expect(readinessOf(state, "them", "lance", 101, RESOLVED_BOT_PROFILES.hard)).toBeLessThan(0.1);
  });

  it("recovers to loaded once the cooldown has elapsed", () => {
    const state = newPerception();
    state.firedSeenTick.set("them:predator", 100);
    // predator: 1000 ms == one second of ticks.
    expect(readinessOf(state, "them", "predator", 101 + TICK_RATE_HZ, RESOLVED_BOT_PROFILES.hard)).toBe(1);
  });

  it("forgets a sighting older than memoryTicks, so a casual loses track", () => {
    const state = newPerception();
    state.firedSeenTick.set("them:lance", 0);
    const easy = readinessOf(state, "them", "lance", 60, RESOLVED_BOT_PROFILES.easy);
    // lance is a 16 s gun: 60 ticks in it is genuinely still recharging, but easy's 15-tick memory
    // has dropped the sighting, so easy believes it is loaded. That gap IS the tier difference.
    expect(easy).toBe(1);
    expect(readinessOf(state, "them", "lance", 60, RESOLVED_BOT_PROFILES.hard)).toBeLessThan(1);
  });
});

describe("reacting is a timing fact (BB19)", () => {
  // `view()` puts `self` at x 100, y 100. ETA in ticks = distance / speed * TICK_RATE_HZ.
  // Easy's dodgeHorizonTicks equals its dodgeReactionTicks, so a shot only registers as a threat
  // for easy inside horizon + the lateral slack (~3 ticks at predator speed): "far" is therefore
  // just beyond easy's reaction time, not far beyond it. The near shot sits between hard's and easy's.
  const SELF = { x: 100, y: 100 };
  // Read inside a test, never at module scope: the weapon accessor needs the mode beforeEach installs.
  const geometry = () => {
    const speed = weaponDefOf("predator").speed;
    const easyTicks = RESOLVED_BOT_PROFILES.easy.dodgeReactionTicks;
    const hardTicks = RESOLVED_BOT_PROFILES.hard.dodgeReactionTicks;
    return {
      speed,
      farX: SELF.x + (speed * (easyTicks + 2)) / TICK_RATE_HZ,
      nearX: SELF.x + (speed * ((hardTicks + easyTicks) / 2)) / TICK_RATE_HZ,
    };
  };
  const shot = (x: number, weaponId: WeaponId = "predator") => ({
    id: "s1", ownerSessionId: "them", weaponId, x, y: SELF.y, angle: Math.PI,
  });

  it("a shot with time to react to is reacted to by every tier; a near one only by the quick", () => {
    const { farX, nearX } = geometry();
    for (const tier of ["easy", "medium", "hard"] as const) {
      const far = perceive(newPerception(), view({ instances: [shot(farX)] }), RESOLVED_BOT_PROFILES[tier]);
      expect(far.threats.get("s1")?.reacting).toBe(true);
    }
    expect(perceive(newPerception(), view({ instances: [shot(nearX)] }), RESOLVED_BOT_PROFILES.easy).threats.get("s1")?.reacting).toBe(false);
    expect(perceive(newPerception(), view({ instances: [shot(nearX)] }), RESOLVED_BOT_PROFILES.hard).threats.get("s1")?.reacting).toBe(true);
  });
  it("draws no rng", () => {
    const { farX } = geometry();
    let draws = 0;
    const rng = () => { draws += 1; return 0.5; };
    perceive(newPerception(), view({ instances: [shot(farX)], rng }), RESOLVED_BOT_PROFILES.hard);
    expect(draws).toBe(0);
  });
  it("threatEtaTicks is distance over speed, and 0 for a speedless weapon", () => {
    const { speed } = geometry();
    expect(weaponDefOf("wildcharge").speed).toBe(0);
    expect(threatEtaTicks(SELF, shot(SELF.x + speed))).toBeCloseTo(TICK_RATE_HZ, 6);
    expect(threatEtaTicks({ x: 0, y: 0 }, shot(500, "wildcharge"))).toBe(0);
  });
});
