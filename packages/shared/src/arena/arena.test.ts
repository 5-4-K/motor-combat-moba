import { describe, expect, it } from "vitest";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { MAX_PLAYERS } from "../constants.js";
import { ARENA_IDS, ARENAS, getArena, isArenaId } from "./registry.js";
import type { ArenaDef, Spawn } from "./types.js";

/**
 * A car must always have somewhere to be pushed.
 *
 * `resolveWorld` ranks world bounds above obstacles, so an obstacle flush against a wall makes those
 * two rules contradict each other: the obstacle pushes the car out, the boundary clamp shoves it
 * straight back in, and the car ends up permanently embedded in level geometry — a stable fixed
 * point, not a transient overlap. A corridor narrower than the car traps it the same way. See the
 * doc comment on `resolveWorld` in `sim/collide.ts` for the ranking and why it is ordered that way.
 *
 * The floor is the car diagonal rather than its width, so the gap admits a car at any rotation.
 */
const CAR_DIAGONAL = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);

/**
 * Team mode is capped at 3v3 by `canStart`, so each side needs half the roster's worth of spawns.
 * Deliberately *not* `MAX_TEAM_SIZE`, which is 4: that number is lobby swap headroom, not match size,
 * and using it here would demand a fourth spawn per side that no match can ever occupy.
 */
const MIN_TEAM_SPAWNS = MAX_PLAYERS / 2;

/** Spawns keep clear of the walls by the same margin the original arena was authored to. */
const SPAWN_WALL_MARGIN = 80;

const entries = Object.entries(ARENAS) as ReadonlyArray<[string, ArenaDef]>;

function insideObstacle(s: Spawn, arena: ArenaDef): boolean {
  return arena.obstacles.some((o) => s.x > o.x && s.x < o.x + o.w && s.y > o.y && s.y < o.y + o.h);
}

/**
 * Pairs closer than a car diagonal, reported as strings so a failure names the offenders instead of
 * saying `false !== true`. Only sets used *together* are checked: FFA spawns among themselves, and
 * team A plus team B as one set, since those two are occupied in the same match.
 */
function tooCloseTogether(spawns: readonly Spawn[], label: string): string[] {
  const problems: string[] = [];
  for (let i = 0; i < spawns.length; i += 1) {
    for (let j = i + 1; j < spawns.length; j += 1) {
      const a = spawns[i]!;
      const b = spawns[j]!;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < CAR_DIAGONAL) {
        problems.push(`${label} #${i} and #${j} are ${distance.toFixed(1)} apart (< ${CAR_DIAGONAL})`);
      }
    }
  }
  return problems;
}

describe.each(entries)("arena %s", (id, arena) => {
  it("declares the id it is registered under", () => {
    expect(arena.id).toBe(id);
  });

  it("has positive finite bounds", () => {
    expect(Number.isFinite(arena.width)).toBe(true);
    expect(Number.isFinite(arena.height)).toBe(true);
    expect(arena.width).toBeGreaterThan(0);
    expect(arena.height).toBeGreaterThan(0);
  });

  it("keeps every obstacle inside bounds", () => {
    for (const o of arena.obstacles) {
      expect(o.w).toBeGreaterThan(0);
      expect(o.h).toBeGreaterThan(0);
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.x + o.w).toBeLessThanOrEqual(arena.width);
      expect(o.y + o.h).toBeLessThanOrEqual(arena.height);
    }
  });

  it("keeps every obstacle at least a car diagonal clear of the arena boundary", () => {
    const tooClose = arena.obstacles.flatMap((o) => {
      const sides = [
        ["left", o.x],
        ["top", o.y],
        ["right", arena.width - (o.x + o.w)],
        ["bottom", arena.height - (o.y + o.h)],
      ] as const;
      return sides
        .filter(([, gap]) => gap < CAR_DIAGONAL)
        .map(([side, gap]) => `obstacle at {${o.x},${o.y}}: ${side} gap ${gap} < ${CAR_DIAGONAL}`);
    });
    expect(tooClose).toEqual([]);
  });

  it("leaves no corridor between obstacles too narrow for a car", () => {
    // Only a pair overlapping on one axis forms a corridor on the other. A gap of exactly 0 means
    // the two touch, which is one solid mass and perfectly drivable-around — not a trap. A negative
    // gap means they overlap into a single compound shape, which is likewise fine.
    const narrow: string[] = [];
    const obstacles = arena.obstacles;
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

  it("seats a full lobby in every mode", () => {
    expect(arena.ffaSpawns.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
    expect(arena.teamASpawns.length).toBeGreaterThanOrEqual(MIN_TEAM_SPAWNS);
    expect(arena.teamBSpawns.length).toBeGreaterThanOrEqual(MIN_TEAM_SPAWNS);
  });

  it("puts every spawn inside the bounds and clear of obstacles", () => {
    const all = [...arena.ffaSpawns, ...arena.teamASpawns, ...arena.teamBSpawns];
    for (const s of all) {
      expect(s.x).toBeGreaterThan(SPAWN_WALL_MARGIN);
      expect(s.x).toBeLessThan(arena.width - SPAWN_WALL_MARGIN);
      expect(s.y).toBeGreaterThan(SPAWN_WALL_MARGIN);
      expect(s.y).toBeLessThan(arena.height - SPAWN_WALL_MARGIN);
      expect(Number.isFinite(s.angle)).toBe(true);
      expect(insideObstacle(s, arena)).toBe(false);
    }
  });

  it("separates the teams across the halfway line", () => {
    for (const s of arena.teamASpawns) expect(s.x).toBeLessThan(arena.width / 2);
    for (const s of arena.teamBSpawns) expect(s.x).toBeGreaterThan(arena.width / 2);
  });

  it("never stacks two spawns that are occupied in the same match", () => {
    expect(tooCloseTogether(arena.ffaSpawns, "ffa")).toEqual([]);
    expect(tooCloseTogether([...arena.teamASpawns, ...arena.teamBSpawns], "team")).toEqual([]);
  });
});

describe("registry", () => {
  it("resolves every registered id to its own def", () => {
    for (const [id, def] of entries) {
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
