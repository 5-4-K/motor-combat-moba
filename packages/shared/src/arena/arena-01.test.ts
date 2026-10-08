import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { ARENA_01 } from "./arena-01.js";
import { playableRectOf } from "./bounds.js";
import { TILE_SIZE } from "./tiles/tile-config.js";
import type { Spawn } from "./types.js";

const spikes = ARENA_01.obstacles.filter((o) => o.kind === "spike");
const CENTRE_X = ARENA_01.width / 2;
const CENTRE_Y = ARENA_01.height / 2;
const floor = playableRectOf(ARENA_01);

/** Gaps between consecutive values, used to prove even spacing without naming the spacing. */
function gaps(values: readonly number[]): number[] {
  return values.slice(1).map((v, i) => v - values[i]!);
}

function sortedY(spawns: readonly Spawn[]): number[] {
  return spawns.map((s) => s.y).sort((a, b) => a - b);
}

describe("ARENA_01 grid", () => {
  it("is a 32 x 18 tile arena with no polygon", () => {
    expect(ARENA_01.tiles?.cols).toBe(32);
    expect(ARENA_01.tiles?.rows).toBe(18);
    expect(ARENA_01.boundary).toBeUndefined();
  });

  it("plays on the 1120 x 640 floor inside a 2-tile side band and a 1-tile end band", () => {
    expect(floor).toEqual({ x: 2 * TILE_SIZE, y: TILE_SIZE, w: 28 * TILE_SIZE, h: 16 * TILE_SIZE });
  });

  it("is mirror-symmetric about both centre lines, tile for tile", () => {
    const g = ARENA_01.tiles!;
    const at = (c: number, r: number) => g.cells[r * g.cols + c];
    for (let r = 0; r < g.rows; r += 1) {
      for (let c = 0; c < g.cols; c += 1) {
        expect(at(c, r)).toBe(at(g.cols - 1 - c, r));
        expect(at(c, r)).toBe(at(c, g.rows - 1 - r));
      }
    }
  });
});

describe("ARENA_01 spike runs", () => {
  const top = spikes.filter((s) => s.y === 0);
  const bottom = spikes.filter((s) => s.y + s.h === ARENA_01.height);
  const left = spikes.filter((s) => s.x === TILE_SIZE && s.w === TILE_SIZE);
  const right = spikes.filter((s) => s.x === 30 * TILE_SIZE && s.w === TILE_SIZE);

  it("has fourteen of them, each on exactly one wall", () => {
    expect(spikes).toHaveLength(14);
    expect(top).toHaveLength(4);
    expect(bottom).toHaveLength(4);
    expect(left).toHaveLength(3);
    expect(right).toHaveLength(3);
  });

  it("is one tile deep", () => {
    for (const s of spikes) expect(Math.min(s.w, s.h)).toBe(TILE_SIZE);
  });
});

describe("ARENA_01 shape", () => {
  it("is 1280x720, the client's logical canvas", () => {
    // Not a taste call — at `CAMERA_CONFIG.zoom` of 1 the camera covers exactly this rect.
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
    const topY = floor.y;
    const bottomY = floor.y + floor.h;
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

  it("puts every spawn on the floor", () => {
    for (const s of all) {
      expect(s.x).toBeGreaterThan(floor.x);
      expect(s.x).toBeLessThan(floor.x + floor.w);
      expect(s.y).toBeGreaterThan(floor.y);
      expect(s.y).toBeLessThan(floor.y + floor.h);
    }
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
