import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { ARENA_02 } from "./arena-02.js";
import { playableExtentOf, playableRectOf } from "./bounds.js";
import { TILE_SIZE } from "./tiles/tile-config.js";
import type { Spawn } from "./types.js";

const spikes = ARENA_02.obstacles.filter((o) => o.kind === "spike");
const CENTRE_X = ARENA_02.width / 2;
const CENTRE_Y = ARENA_02.height / 2;
const floor = playableRectOf(ARENA_02);

/** Gaps between consecutive values, used to prove even spacing without naming the spacing. */
function gaps(values: readonly number[]): number[] {
  return values.slice(1).map((v, i) => v - values[i]!);
}

function sortedY(spawns: readonly Spawn[]): number[] {
  return spawns.map((s) => s.y).sort((a, b) => a - b);
}

describe("ARENA_02 grid", () => {
  it("is a 32 x 18 tile arena with no polygon", () => {
    expect(ARENA_02.tiles?.cols).toBe(32);
    expect(ARENA_02.tiles?.rows).toBe(18);
    expect(ARENA_02.boundary).toBeUndefined();
  });

  it("plays on the 1200 x 640 floor inside a one-tile spike ring", () => {
    expect(floor).toEqual({ x: TILE_SIZE, y: TILE_SIZE, w: 30 * TILE_SIZE, h: 16 * TILE_SIZE });
    expect(playableExtentOf(ARENA_02)).toEqual({ width: 1200, height: 640 });
  });

  it("is mirror-symmetric about both centre lines in behaviour, tile for tile", () => {
    const g = ARENA_02.tiles!;
    const at = (c: number, r: number) => g.cells[r * g.cols + c]!.tile;
    for (let r = 0; r < g.rows; r += 1) {
      for (let c = 0; c < g.cols; c += 1) {
        expect(at(c, r)).toBe(at(g.cols - 1 - c, r));
        expect(at(c, r)).toBe(at(c, g.rows - 1 - r));
      }
    }
  });

  it("turns the side art 90° clockwise and leaves the top and bottom rows as authored", () => {
    const g = ARENA_02.tiles!;
    const rotation = (c: number, r: number) => g.cells[r * g.cols + c]!.base?.rotation;
    for (let c = 0; c < g.cols; c += 1) {
      expect(rotation(c, 0)).toBe(0);
      expect(rotation(c, g.rows - 1)).toBe(0);
    }
    for (let r = 1; r < g.rows - 1; r += 1) {
      for (const c of [0, g.cols - 1]) expect(rotation(c, r)).toBe(90);
    }
  });

  it("wears wooden spike teeth on every spike edge that faces the floor", () => {
    const teeth = ARENA_02.tiles!.cells.flatMap((cell) => cell.overlays.map((o) => o.art));
    expect(teeth.length).toBe(2 * 30 + 2 * 16);
    expect(new Set(teeth)).toEqual(new Set(["wooden-spike"]));
  });
});

describe("ARENA_02 spike ring", () => {
  const top = spikes.filter((s) => s.y === 0 && s.h === TILE_SIZE);
  const bottom = spikes.filter((s) => s.y === 17 * TILE_SIZE && s.h === TILE_SIZE);
  const left = spikes.filter((s) => s.x === 0 && s.w === TILE_SIZE);
  const right = spikes.filter((s) => s.x === 31 * TILE_SIZE && s.w === TILE_SIZE);

  it("has four strips, one continuous run per wall", () => {
    expect(spikes).toHaveLength(4);
    expect(top).toHaveLength(1);
    expect(bottom).toHaveLength(1);
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
  });

  it("runs each strip the full length of the floor it borders", () => {
    for (const s of [...top, ...bottom]) expect({ x: s.x, w: s.w }).toEqual({ x: floor.x, w: floor.w });
    for (const s of [...left, ...right]) expect({ y: s.y, h: s.h }).toEqual({ y: floor.y, h: floor.h });
  });

  it("hurts from every face", () => {
    for (const s of spikes) expect(s.damageFaces).toBeUndefined();
  });
});

describe("ARENA_02 shape", () => {
  it("is 1280x720, the client's logical canvas", () => {
    expect(ARENA_02.width).toBe(1280);
    expect(ARENA_02.height).toBe(720);
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

  it("leaves an equal gap between each car and its neighbour and the playable edge", () => {
    const topY = floor.y;
    const bottomY = floor.y + floor.h;
    for (const side of [ARENA_02.teamASpawns, ARENA_02.teamBSpawns]) {
      const ys = sortedY(side);
      const spans = [ys[0]! - topY, ...gaps(ys), bottomY - ys[ys.length - 1]!];
      expect(new Set(spans).size).toBe(1);
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
