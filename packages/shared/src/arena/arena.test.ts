import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { ARENA_01 } from "./arena-01.js";
import { getArena } from "./registry.js";

/**
 * A car must always have somewhere to be pushed.
 *
 * `resolveWorld` ranks world bounds above obstacles, so an obstacle flush against a wall makes
 * those two rules contradict each other: the obstacle pushes the car out, the boundary clamp
 * shoves it straight back in, and the car ends up permanently embedded in level geometry — a
 * stable fixed point, not a transient overlap. A corridor narrower than the car traps it the same
 * way. See the doc comment on `resolveWorld` in `sim/collide.ts` for the ranking and why it is
 * ordered that way.
 *
 * The floor is the car diagonal rather than its width, so the gap admits a car at any rotation.
 */
const CAR_DIAGONAL = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);

describe("arena-01", () => {
  it("is 2400x1600 with 6 obstacles", () => {
    expect(ARENA_01.width).toBe(2400);
    expect(ARENA_01.height).toBe(1600);
    expect(ARENA_01.obstacles).toHaveLength(6);
  });

  it("keeps every obstacle inside bounds", () => {
    for (const o of ARENA_01.obstacles) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.x + o.w).toBeLessThanOrEqual(ARENA_01.width);
      expect(o.y + o.h).toBeLessThanOrEqual(ARENA_01.height);
    }
  });

  it("exposes 6 FFA spawns and 3+3 team spawns, none overlapping an obstacle", () => {
    expect(ARENA_01.ffaSpawns).toHaveLength(6);
    expect(ARENA_01.teamASpawns).toHaveLength(3);
    expect(ARENA_01.teamBSpawns).toHaveLength(3);
    const all = [...ARENA_01.ffaSpawns, ...ARENA_01.teamASpawns, ...ARENA_01.teamBSpawns];
    for (const s of all) {
      expect(s.x).toBeGreaterThan(80);
      expect(s.x).toBeLessThan(ARENA_01.width - 80);
      for (const o of ARENA_01.obstacles) {
        const inside = s.x > o.x && s.x < o.x + o.w && s.y > o.y && s.y < o.y + o.h;
        expect(inside).toBe(false);
      }
    }
    for (const s of ARENA_01.teamASpawns) expect(s.x).toBeLessThan(ARENA_01.width / 2);
    for (const s of ARENA_01.teamBSpawns) expect(s.x).toBeGreaterThan(ARENA_01.width / 2);
  });

  it("keeps every obstacle at least a car diagonal clear of the arena boundary", () => {
    const tooClose = ARENA_01.obstacles.flatMap((o) => {
      const sides = [
        ["left", o.x],
        ["top", o.y],
        ["right", ARENA_01.width - (o.x + o.w)],
        ["bottom", ARENA_01.height - (o.y + o.h)],
      ] as const;
      return sides
        .filter(([, gap]) => gap < CAR_DIAGONAL)
        .map(([side, gap]) => `obstacle at {${o.x},${o.y}}: ${side} gap ${gap} < ${CAR_DIAGONAL}`);
    });
    expect(tooClose).toEqual([]);
  });

  it("leaves no corridor between obstacles too narrow for a car", () => {
    // Only a pair overlapping on one axis forms a corridor on the other. A gap of exactly 0 means
    // the two touch, which is one solid mass and perfectly drivable-around — not a trap.
    const narrow: string[] = [];
    const obstacles = ARENA_01.obstacles;
    for (let i = 0; i < obstacles.length; i += 1) {
      for (let j = i + 1; j < obstacles.length; j += 1) {
        const a = obstacles[i]!;
        const b = obstacles[j]!;
        if (a.y < b.y + b.h && b.y < a.y + a.h) {
          const gap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
          if (gap > 0 && gap < CAR_DIAGONAL) narrow.push(`x corridor ${gap} between #${i} and #${j}`);
        }
        if (a.x < b.x + b.w && b.x < a.x + a.w) {
          const gap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
          if (gap > 0 && gap < CAR_DIAGONAL) narrow.push(`y corridor ${gap} between #${i} and #${j}`);
        }
      }
    }
    expect(narrow).toEqual([]);
  });

});

import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { ARENA_IDS, ARENAS, isArenaId } from "./registry.js";

describe("registry", () => {
  it("resolves every registered id to its own def", () => {
    for (const [id, def] of Object.entries(ARENAS)) {
      expect(getArena(id)).toBe(def);
    }
  });

  it("throws for an unknown arena id", () => {
    expect(() => getArena("nope")).toThrow(/nope/);
  });

  it("refuses prototype keys rather than resolving them", () => {
    expect(isArenaId("__proto__")).toBe(false);
    expect(isArenaId("constructor")).toBe(false);
    expect(() => getArena("toString")).toThrow();
  });

  it("lists exactly the registered ids", () => {
    expect([...ARENA_IDS].sort()).toEqual(Object.keys(ARENAS).sort());
  });

  it("has an ACTIVE_ARENA_ID that is actually registered", () => {
    expect(isArenaId(ACTIVE_ARENA_ID)).toBe(true);
  });
});
