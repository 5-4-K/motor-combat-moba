import { describe, expect, it } from "vitest";
import { ARENA_01 } from "./arena-01.js";
import type { Spawn } from "./types.js";

/**
 * `ARENA_01` is the arena the game plays, and it is authored to one rule the generic contract in
 * `arena.test.ts` cannot express: the whole thing is on screen at once. That makes it a plain
 * rectangle with nothing in it, and it makes every spawn a deliberate position rather than a
 * plausible one — with no cover to break sightlines, an off-centre spawn is a free advantage.
 *
 * These assert the *properties* the layout was authored for — symmetry, even spacing, facing the
 * fight — rather than restating the coordinate table, so a future re-scale that keeps the shape
 * keeps the suite green.
 */
const CENTRE_X = ARENA_01.width / 2;
const CENTRE_Y = ARENA_01.height / 2;

/** Gaps between consecutive values, used to prove even spacing without naming the spacing. */
function gaps(values: readonly number[]): number[] {
  return values.slice(1).map((v, i) => v - values[i]!);
}

function sortedY(spawns: readonly Spawn[]): number[] {
  return spawns.map((s) => s.y).sort((a, b) => a - b);
}

describe("ARENA_01 shape", () => {
  it("is a rectangle wider than it is tall", () => {
    expect(ARENA_01.width).toBe(1280);
    expect(ARENA_01.height).toBe(720);
    expect(ARENA_01.width).toBeGreaterThan(ARENA_01.height);
  });

  it("is completely open", () => {
    expect(ARENA_01.obstacles).toEqual([]);
  });
});

describe("ARENA_01 team spawns", () => {
  it("puts the two teams on opposite sides, mirrored about the centre line", () => {
    const a = [...new Set(ARENA_01.teamASpawns.map((s) => s.x))];
    const b = [...new Set(ARENA_01.teamBSpawns.map((s) => s.x))];
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!).toBeLessThan(CENTRE_X);
    expect(b[0]!).toBeGreaterThan(CENTRE_X);
    expect(ARENA_01.width - b[0]!).toBe(a[0]!);
  });

  it("leaves an equal gap between each car and its neighbour and the wall", () => {
    for (const side of [ARENA_01.teamASpawns, ARENA_01.teamBSpawns]) {
      const ys = sortedY(side);
      const spans = [ys[0]!, ...gaps(ys), ARENA_01.height - ys[ys.length - 1]!];
      expect(new Set(spans).size).toBe(1);
    }
  });

  it("faces every car at the other team", () => {
    for (const s of ARENA_01.teamASpawns) expect(Math.cos(s.angle)).toBeCloseTo(1);
    for (const s of ARENA_01.teamBSpawns) expect(Math.cos(s.angle)).toBeCloseTo(-1);
  });
});

describe("ARENA_01 FFA spawns", () => {
  const corners = ARENA_01.ffaSpawns.filter((s) => s.x !== CENTRE_X);
  const midpoints = ARENA_01.ffaSpawns.filter((s) => s.x === CENTRE_X);

  it("offers four corners and the two midpoints of the long walls", () => {
    expect(corners).toHaveLength(4);
    expect(midpoints).toHaveLength(2);
    // Four corners means all four combinations of the two inset x values and the two inset y values.
    expect(new Set(corners.map((s) => `${s.x},${s.y}`)).size).toBe(4);
    expect(new Set(corners.map((s) => s.x)).size).toBe(2);
    expect(new Set(corners.map((s) => s.y)).size).toBe(2);
  });

  it("insets every spawn from the walls by the same margin", () => {
    const insets = ARENA_01.ffaSpawns.flatMap((s) => [
      Math.min(s.x, ARENA_01.width - s.x),
      Math.min(s.y, ARENA_01.height - s.y),
    ]);
    // Every spawn sits one margin from its nearest wall on each axis, except the two midpoints,
    // whose x inset is half the arena. Dropping those leaves a single margin.
    expect(new Set(insets.filter((i) => i !== CENTRE_X)).size).toBe(1);
  });

  it("turns each corner car to face across the arena", () => {
    for (const s of corners) {
      const toCentre = Math.sign(CENTRE_X - s.x);
      expect(Math.sign(Math.cos(s.angle))).toBe(toCentre);
      expect(Math.sin(s.angle)).toBeCloseTo(0);
    }
  });

  it("turns the two midpoint cars to face each other", () => {
    for (const s of midpoints) {
      const toCentre = Math.sign(CENTRE_Y - s.y);
      expect(Math.sign(Math.sin(s.angle))).toBe(toCentre);
      expect(Math.cos(s.angle)).toBeCloseTo(0);
    }
  });
});
