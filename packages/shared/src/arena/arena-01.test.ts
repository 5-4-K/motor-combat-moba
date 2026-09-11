import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { SPIKE_CONFIG } from "../config/spike-config.js";
import { pointOutsideBounds } from "../sim/collide.js";
import { ARENA_01 } from "./arena-01.js";
import { boundsOf } from "./bounds.js";
import type { Spawn } from "./types.js";

const bounds = boundsOf(ARENA_01);
const spikes = ARENA_01.obstacles.filter((o) => o.kind === "spike");
const CENTRE_X = ARENA_01.width / 2;
const CENTRE_Y = ARENA_01.height / 2;

/** Gaps between consecutive values, used to prove even spacing without naming the spacing. */
function gaps(values: readonly number[]): number[] {
  return values.slice(1).map((v, i) => v - values[i]!);
}

function sortedY(spawns: readonly Spawn[]): number[] {
  return spawns.map((s) => s.y).sort((a, b) => a - b);
}

describe("ARENA_01 boundary", () => {
  it("is a convex octagon inside the world rect", () => {
    expect(ARENA_01.boundary).toHaveLength(8);
    for (const v of ARENA_01.boundary!) {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.x).toBeLessThanOrEqual(ARENA_01.width);
      expect(v.y).toBeLessThanOrEqual(ARENA_01.height);
    }
  });

  it("wound clockwise, so every normal points at the centre", () => {
    for (const plane of bounds.planes!) {
      expect(plane.nx * CENTRE_X + plane.ny * CENTRE_Y - plane.d).toBeGreaterThan(0);
    }
  });
});

describe("ARENA_01 spike strips", () => {
  // Derived from the boundary rather than hardcoded (Finding 1, 2026-09-11 review): a filter keyed
  // to a literal band coordinate silently returns [] the moment a band moves, and `expect(x).toEqual(
  // y)` on two empty arrays passes. TOP_Y/BOTTOM_Y/LEFT_X/RIGHT_X are the four straight walls' own
  // lines, so a spike is grouped by whichever edge it is actually flush against.
  const boundaryXs = ARENA_01.boundary!.map((v) => v.x);
  const boundaryYs = ARENA_01.boundary!.map((v) => v.y);
  const TOP_Y = Math.min(...boundaryYs);
  const BOTTOM_Y = Math.max(...boundaryYs);
  const LEFT_X = Math.min(...boundaryXs);
  const RIGHT_X = Math.max(...boundaryXs);

  const top = spikes.filter((s) => s.y === TOP_Y);
  const bottom = spikes.filter((s) => s.y + s.h === BOTTOM_Y);
  const left = spikes.filter((s) => s.x === LEFT_X);
  const right = spikes.filter((s) => s.x + s.w === RIGHT_X);

  it("has fourteen of them", () => {
    expect(spikes).toHaveLength(14);
  });

  it("assigns every spike to exactly one wall", () => {
    // Guards the four derived filters above: if a spike sat on a chamfer, or a band's coordinates
    // drifted onto no wall at all, this fails before any filtered test below gets a chance to run on
    // the wrong (possibly empty) set.
    expect(top.length + bottom.length + left.length + right.length).toBe(spikes.length);
  });

  it("makes every one exactly the configured depth", () => {
    for (const s of spikes) {
      expect(Math.min(s.w, s.h)).toBe(SPIKE_CONFIG.depth);
    }
  });

  it("mirrors the top and bottom strips about the vertical centre line", () => {
    expect(top).toHaveLength(4);
    const spanOf = (o: { x: number; w: number }) => [o.x, o.x + o.w] as const;
    const sorted = top.map(spanOf).sort((a, b) => a[0] - b[0]);
    const mirrored = [...sorted]
      .map(([a, b]) => [ARENA_01.width - b, ARENA_01.width - a] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(sorted).toEqual(mirrored);
  });

  it("mirrors the left and right strips about the horizontal centre line", () => {
    expect(left).toHaveLength(3);
    const spanOf = (o: { y: number; h: number }) => [o.y, o.y + o.h] as const;
    const sorted = left.map(spanOf).sort((a, b) => a[0] - b[0]);
    const mirrored = [...sorted]
      .map(([a, b]) => [ARENA_01.height - b, ARENA_01.height - a] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(sorted).toEqual(mirrored);
  });

  it("pairs every left strip with a right strip at the same span", () => {
    expect(left).toHaveLength(3);
    expect(right).toHaveLength(3);
    const spanY = (o: { y: number; h: number }) => `${o.y}-${o.y + o.h}`;
    expect(left.map(spanY).sort()).toEqual(right.map(spanY).sort());
  });

  it("pairs every top strip with a bottom strip at the same span", () => {
    expect(top).toHaveLength(4);
    expect(bottom).toHaveLength(4);
    const spanX = (o: { x: number; w: number }) => `${o.x}-${o.x + o.w}`;
    expect(top.map(spanX).sort()).toEqual(bottom.map(spanX).sort());
  });
});

describe("ARENA_01 shape", () => {
  it("is 1280x720, the client's logical canvas", () => {
    // Not a taste call — at `CAMERA_CONFIG.zoom` of 1 the camera covers exactly this rect, so
    // rescaling it without rescaling the zoom to match breaks `arena-camera.test.ts` on the client.
    // The nearest surviving check before this restore, `fitsViewport`, is an inequality a *smaller*
    // arena would also satisfy — this pins the actual number (Finding 3, 2026-09-11 review).
    expect(ARENA_01.width).toBe(1280);
    expect(ARENA_01.height).toBe(720);
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

  it("leaves an equal gap between each car and its neighbour and the playable edge", () => {
    // Re-based off the playable edges (the top/bottom straight walls of the octagon), not the world
    // rect 0/height, now that the two differ (Finding 3, 2026-09-11 review).
    const boundaryYs = ARENA_01.boundary!.map((v) => v.y);
    const topY = Math.min(...boundaryYs);
    const bottomY = Math.max(...boundaryYs);
    for (const side of [ARENA_01.teamASpawns, ARENA_01.teamBSpawns]) {
      const ys = sortedY(side);
      const spans = [ys[0]! - topY, ...gaps(ys), bottomY - ys[ys.length - 1]!];
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

describe("ARENA_01 spawns", () => {
  const diagonal = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);
  const all = [...ARENA_01.ffaSpawns, ...ARENA_01.teamASpawns, ...ARENA_01.teamBSpawns];

  it("puts every spawn inside the polygon", () => {
    for (const s of all) expect(pointOutsideBounds(s.x, s.y, bounds)).toBe(false);
  });

  it("clears every spike strip by more than a car diagonal", () => {
    expect(spikes.length).toBeGreaterThan(0);
    for (const s of all) {
      for (const box of spikes) {
        const dx = Math.max(box.x - s.x, 0, s.x - (box.x + box.w));
        const dy = Math.max(box.y - s.y, 0, s.y - (box.y + box.h));
        expect(Math.hypot(dx, dy)).toBeGreaterThan(diagonal);
      }
    }
  });
});
