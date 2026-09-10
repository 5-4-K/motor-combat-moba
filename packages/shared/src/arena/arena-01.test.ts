import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { SPIKE_CONFIG } from "../config/spike-config.js";
import { pointOutsideBounds } from "../sim/collide.js";
import { ARENA_01 } from "./arena-01.js";
import { boundsOf } from "./bounds.js";

const bounds = boundsOf(ARENA_01);
const spikes = ARENA_01.obstacles.filter((o) => o.kind === "spike");
const CENTRE_X = ARENA_01.width / 2;
const CENTRE_Y = ARENA_01.height / 2;

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
  it("has fourteen of them", () => {
    expect(spikes).toHaveLength(14);
  });

  it("makes every one exactly the configured depth", () => {
    for (const s of spikes) {
      expect(Math.min(s.w, s.h)).toBe(SPIKE_CONFIG.depth);
    }
  });

  it("mirrors the top and bottom strips about the vertical centre line", () => {
    const spanOf = (o: { x: number; w: number }) => [o.x, o.x + o.w] as const;
    const top = spikes.filter((s) => s.y === 54).map(spanOf).sort((a, b) => a[0] - b[0]);
    const mirrored = [...top].map(([a, b]) => [ARENA_01.width - b, ARENA_01.width - a] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(top).toEqual(mirrored);
  });

  it("mirrors the left and right strips about the horizontal centre line", () => {
    const left = spikes.filter((s) => s.x === 74).map((o) => [o.y, o.y + o.h] as const)
      .sort((a, b) => a[0] - b[0]);
    const mirrored = [...left].map(([a, b]) => [ARENA_01.height - b, ARENA_01.height - a] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(left).toEqual(mirrored);
  });

  it("pairs every left strip with a right strip at the same span", () => {
    const spanY = (o: { y: number; h: number }) => `${o.y}-${o.y + o.h}`;
    const left = spikes.filter((s) => s.x === 74).map(spanY).sort();
    const right = spikes.filter((s) => s.x === 1186).map(spanY).sort();
    expect(left).toEqual(right);
  });
});

describe("ARENA_01 spawns", () => {
  const diagonal = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);
  const all = [...ARENA_01.ffaSpawns, ...ARENA_01.teamASpawns, ...ARENA_01.teamBSpawns];

  it("puts every spawn inside the polygon", () => {
    for (const s of all) expect(pointOutsideBounds(s.x, s.y, bounds)).toBe(false);
  });

  it("clears every spike strip by more than a car diagonal", () => {
    for (const s of all) {
      for (const box of spikes) {
        const dx = Math.max(box.x - s.x, 0, s.x - (box.x + box.w));
        const dy = Math.max(box.y - s.y, 0, s.y - (box.y + box.h));
        expect(Math.hypot(dx, dy)).toBeGreaterThan(diagonal);
      }
    }
  });
});
