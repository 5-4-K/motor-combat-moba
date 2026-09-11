import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { SPIKE_CONFIG } from "../config/spike-config.js";
import { pointOutsideBounds } from "../sim/collide.js";
import { ARENA_02 } from "./arena-02.js";
import { boundsOf, playableExtentOf } from "./bounds.js";
import type { Spawn } from "./types.js";

const bounds = boundsOf(ARENA_02);
const spikes = ARENA_02.obstacles.filter((o) => o.kind === "spike");
const CENTRE_X = ARENA_02.width / 2;
const CENTRE_Y = ARENA_02.height / 2;

function sortedY(spawns: readonly Spawn[]): number[] {
  return spawns.map((s) => s.y).sort((a, b) => a - b);
}

describe("ARENA_02 boundary", () => {
  it("is a convex rectangle inset inside the world rect", () => {
    expect(ARENA_02.boundary).toHaveLength(4);
    for (const v of ARENA_02.boundary!) {
      expect(v.x).toBeGreaterThan(0);
      expect(v.y).toBeGreaterThan(0);
      expect(v.x).toBeLessThan(ARENA_02.width);
      expect(v.y).toBeLessThan(ARENA_02.height);
    }
  });

  it("wound clockwise, so every normal points at the centre", () => {
    expect(bounds.planes).toHaveLength(4);
    for (const plane of bounds.planes!) {
      expect(plane.nx * CENTRE_X + plane.ny * CENTRE_Y - plane.d).toBeGreaterThan(0);
    }
  });
});

describe("ARENA_02 spike strips", () => {
  const verts = ARENA_02.boundary ?? [];
  const boundaryXs = verts.map((v) => v.x);
  const boundaryYs = verts.map((v) => v.y);
  const TOP_Y = boundaryYs.length === 0 ? NaN : Math.min(...boundaryYs);
  const BOTTOM_Y = boundaryYs.length === 0 ? NaN : Math.max(...boundaryYs);
  const LEFT_X = boundaryXs.length === 0 ? NaN : Math.min(...boundaryXs);
  const RIGHT_X = boundaryXs.length === 0 ? NaN : Math.max(...boundaryXs);

  const top = spikes.filter((s) => s.y === TOP_Y && s.h === SPIKE_CONFIG.depth);
  const bottom = spikes.filter((s) => s.y + s.h === BOTTOM_Y && s.h === SPIKE_CONFIG.depth);
  const left = spikes.filter((s) => s.x === LEFT_X && s.w === SPIKE_CONFIG.depth);
  const right = spikes.filter((s) => s.x + s.w === RIGHT_X && s.w === SPIKE_CONFIG.depth);

  it("has four of them, one continuous strip per wall", () => {
    expect(spikes).toHaveLength(4);
  });

  it("assigns every spike to exactly one wall", () => {
    expect(top.length + bottom.length + left.length + right.length).toBe(spikes.length);
    expect(top).toHaveLength(1);
    expect(bottom).toHaveLength(1);
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
  });

  it("makes every one exactly the configured depth", () => {
    for (const s of spikes) {
      expect(Math.min(s.w, s.h)).toBe(SPIKE_CONFIG.depth);
    }
  });

  it("runs each strip the full length of its wall", () => {
    const wallW = RIGHT_X - LEFT_X;
    const wallH = BOTTOM_Y - TOP_Y;
    expect(top[0]!.x).toBe(LEFT_X);
    expect(top[0]!.w).toBe(wallW);
    expect(bottom[0]!.x).toBe(LEFT_X);
    expect(bottom[0]!.w).toBe(wallW);
    expect(left[0]!.y).toBe(TOP_Y + SPIKE_CONFIG.depth);
    expect(left[0]!.h).toBe(wallH - 2 * SPIKE_CONFIG.depth);
    expect(right[0]!.y).toBe(TOP_Y + SPIKE_CONFIG.depth);
    expect(right[0]!.h).toBe(wallH - 2 * SPIKE_CONFIG.depth);
  });
});

describe("ARENA_02 shape", () => {
  it("is 1280x720, the client's logical canvas", () => {
    expect(ARENA_02.width).toBe(1280);
    expect(ARENA_02.height).toBe(720);
  });

  it("insets the playable wall-face rect inside that frame", () => {
    expect(playableExtentOf(ARENA_02)).toEqual({ width: 1161, height: 607 });
    expect(playableExtentOf(ARENA_02).width).not.toBe(ARENA_02.width);
  });
});

describe("ARENA_02 team spawns", () => {
  it("puts the two teams on opposite sides, mirrored about the centre line", () => {
    const a = [...new Set(ARENA_02.teamASpawns.map((s) => s.x))];
    const b = [...new Set(ARENA_02.teamBSpawns.map((s) => s.x))];
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!).toBeLessThan(CENTRE_X);
    expect(b[0]!).toBeGreaterThan(CENTRE_X);
    expect(ARENA_02.width - b[0]!).toBe(a[0]!);
  });

  it("faces every car at the other team", () => {
    for (const s of ARENA_02.teamASpawns) expect(Math.cos(s.angle)).toBeCloseTo(1);
    for (const s of ARENA_02.teamBSpawns) expect(Math.cos(s.angle)).toBeCloseTo(-1);
  });

  it("spreads each team down the playable height", () => {
    const boundaryYs = ARENA_02.boundary!.map((v) => v.y);
    const topY = Math.min(...boundaryYs);
    const bottomY = Math.max(...boundaryYs);
    for (const side of [ARENA_02.teamASpawns, ARENA_02.teamBSpawns]) {
      const ys = sortedY(side);
      expect(ys[0]!).toBeGreaterThan(topY);
      expect(ys[ys.length - 1]!).toBeLessThan(bottomY);
      expect(ys[1]!).toBeGreaterThan(ys[0]!);
      expect(ys[2]!).toBeGreaterThan(ys[1]!);
    }
  });
});

describe("ARENA_02 FFA spawns", () => {
  const corners = ARENA_02.ffaSpawns.filter((s) => s.x !== CENTRE_X);
  const midpoints = ARENA_02.ffaSpawns.filter((s) => s.x === CENTRE_X);

  it("offers four corners and the two midpoints of the long walls", () => {
    expect(corners).toHaveLength(4);
    expect(midpoints).toHaveLength(2);
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

describe("ARENA_02 spawns", () => {
  const diagonal = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);
  const all = [...ARENA_02.ffaSpawns, ...ARENA_02.teamASpawns, ...ARENA_02.teamBSpawns];

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
