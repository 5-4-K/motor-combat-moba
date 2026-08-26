import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../arena/arena-01.js";
import { WEAPON_CONFIG } from "../config/weapon-config.js";
import { MS_PER_TICK, TICK_RATE_HZ } from "../constants.js";
import { carHullOf } from "./context.js";
import {
  canDamage,
  projectileExpired,
  projectileHitsCar,
  projectileHitsObstacle,
  stepProjectile,
  type Proj,
} from "./projectiles.js";

const DT = MS_PER_TICK / 1000;
const BOUNDS = { width: ARENA_01.width, height: ARENA_01.height };

/**
 * A box for the obstacle tests to fire at. Authored here rather than borrowed from `ARENA_01`,
 * which ships empty: obstacle collision is still live behaviour that other arenas rely on, and a
 * sim test should not go dark because the arena the game happens to ship was refurnished.
 * Positioned clear of the fixtures default spawn at {100,100} and of every wall.
 */
const TEST_BOX = { x: 600, y: 300, w: 240, h: 120 };

function shot(over: Partial<Proj> = {}): Proj {
  return {
    id: "p1",
    ownerSessionId: "a",
    x: 100,
    y: 100,
    angle: 0,
    speed: WEAPON_CONFIG.projectileSpeed,
    spawnTick: 0,
    alive: true,
    ...over,
  };
}

describe("stepProjectile", () => {
  it("covers projectileSpeed units in one second of ticks", () => {
    let p = shot();
    for (let i = 0; i < TICK_RATE_HZ; i++) p = stepProjectile(p, DT);
    expect(p.x).toBeCloseTo(100 + WEAPON_CONFIG.projectileSpeed, 6);
    expect(p.y).toBeCloseTo(100, 6);
  });

  it("flies along its angle", () => {
    const p = stepProjectile(shot({ angle: Math.PI / 2 }), DT);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(100 + WEAPON_CONFIG.projectileSpeed * DT, 6);
  });

  it("does not mutate the input", () => {
    const p = shot();
    stepProjectile(p, DT);
    expect(p.x).toBe(100);
  });

  it("carries identity and spawn tick through", () => {
    const p = stepProjectile(shot({ id: "x-7", ownerSessionId: "b", spawnTick: 12 }), DT);
    expect(p.id).toBe("x-7");
    expect(p.ownerSessionId).toBe("b");
    expect(p.spawnTick).toBe(12);
  });
});

describe("projectileHitsObstacle", () => {
  it("is false in open arena", () => {
    expect(projectileHitsObstacle(shot(), [TEST_BOX], BOUNDS)).toBe(false);
  });

  it("is true inside an obstacle", () => {
    const box = TEST_BOX;
    const p = shot({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
    expect(projectileHitsObstacle(p, [box], BOUNDS)).toBe(true);
  });

  it("is true past each arena edge", () => {
    expect(projectileHitsObstacle(shot({ x: -1 }), [], BOUNDS)).toBe(true);
    expect(projectileHitsObstacle(shot({ y: -1 }), [], BOUNDS)).toBe(true);
    expect(projectileHitsObstacle(shot({ x: BOUNDS.width + 1 }), [], BOUNDS)).toBe(true);
    expect(projectileHitsObstacle(shot({ y: BOUNDS.height + 1 }), [], BOUNDS)).toBe(true);
  });

  it("kills a shot flown into the nearest wall", () => {
    let p = shot({ x: 100, y: 100, angle: Math.PI });
    let ticks = 0;
    while (!projectileHitsObstacle(p, [TEST_BOX], BOUNDS) && ticks < 100) {
      p = stepProjectile(p, DT);
      ticks++;
    }
    expect(ticks).toBeLessThan(100);
    expect(p.x).toBeLessThan(0);
  });
});

describe("projectileHitsCar", () => {
  it("hits a car centred on the shot", () => {
    expect(projectileHitsCar(shot({ x: 500, y: 500 }), carHullOf(500, 500, 0))).toBe(true);
  });

  it("misses a car the shot flies past", () => {
    expect(projectileHitsCar(shot({ x: 500, y: 600 }), carHullOf(500, 500, 0))).toBe(false);
  });

  it("respects the car's rotation", () => {
    // 20 units along +y is outside a 48x32 hull at angle 0 (half-height 16), and inside the same
    // hull turned 90 degrees, where +y is now the long axis (half-length 24).
    expect(projectileHitsCar(shot({ x: 500, y: 520 }), carHullOf(500, 500, 0))).toBe(false);
    expect(projectileHitsCar(shot({ x: 500, y: 520 }), carHullOf(500, 500, Math.PI / 2))).toBe(true);
  });
});

describe("projectileExpired", () => {
  it("is false before the lifetime elapses", () => {
    expect(projectileExpired(shot({ spawnTick: 10 }), 39, WEAPON_CONFIG.lifetimeTicks)).toBe(false);
  });

  it("is true on the lifetime tick", () => {
    expect(projectileExpired(shot({ spawnTick: 10 }), 40, WEAPON_CONFIG.lifetimeTicks)).toBe(true);
  });
});

describe("canDamage", () => {
  it("never lets a shot damage its own shooter", () => {
    expect(canDamage("a", 0, "a", 0, "ffa")).toBe(false);
    expect(canDamage("a", 0, "a", 0, "team")).toBe(false);
  });

  it("damages anyone else in ffa, including a same-team id", () => {
    expect(canDamage("a", 0, "b", 0, "ffa")).toBe(true);
    expect(canDamage("a", 0, "b", 1, "ffa")).toBe(true);
  });

  it("spares teammates in team mode", () => {
    expect(canDamage("a", 0, "b", 0, "team")).toBe(false);
  });

  it("damages enemies in team mode", () => {
    expect(canDamage("a", 0, "b", 1, "team")).toBe(true);
    expect(canDamage("a", 1, "b", 0, "team")).toBe(true);
  });
});
