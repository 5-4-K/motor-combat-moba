import { describe, expect, it } from "vitest";
import { boundsOf, playableExtentOf, playablePlanesOf, playableRectOf } from "./bounds.js";
import { compileTileArena } from "./tiles/compile.js";
import { TILE_SIZE } from "./tiles/tile-config.js";
import { ARENA_01 } from "./arena-01.js";
import { ARENA_02 } from "./arena-02.js";
import type { ArenaDef } from "./types.js";

/**
 * Arena-03 as it stood before it became a tile arena (CQ37–CQ40): a hand-written 1280 × 2160 polygon
 * with eight-point boundary (100 u chamfers) and two 20 u spike strips. Kept as a fixture so the
 * polygon, chamfer and strip behaviour stays covered now that no shipped arena exercises it.
 */
const POLYGON_FIXTURE: ArenaDef = {
  id: "arena-03",
  displayName: "Polygon fixture",
  width: 1280,
  height: 2160,
  palette: { floor: "#2b2f35", obstacle: "#4b5362", border: "#1a1d22" },
  boundary: [
    { x: 100, y: 0 },
    { x: 1180, y: 0 },
    { x: 1280, y: 100 },
    { x: 1280, y: 2060 },
    { x: 1180, y: 2160 },
    { x: 100, y: 2160 },
    { x: 0, y: 2060 },
    { x: 0, y: 100 },
  ],
  zone: { x: 640, y: 1080, radius: 150 },
  obstacles: [
    { x: 200, y: 480, w: 100, h: 100 },
    { x: 980, y: 480, w: 100, h: 100 },
    { x: 200, y: 1580, w: 100, h: 100 },
    { x: 980, y: 1580, w: 100, h: 100 },
    { x: 590, y: 660, w: 100, h: 60 },
    { x: 590, y: 1440, w: 100, h: 60 },
    { x: 330, y: 850, w: 120, h: 60 },
    { x: 830, y: 850, w: 120, h: 60 },
    { x: 330, y: 1250, w: 120, h: 60 },
    { x: 830, y: 1250, w: 120, h: 60 },
    { x: 0, y: 760, w: 20, h: 640, kind: "spike" },
    { x: 1260, y: 760, w: 20, h: 640, kind: "spike" },
  ],
  ffaSpawns: [
    { x: 460, y: 2040, angle: -Math.PI / 2 },
    { x: 640, y: 2040, angle: -Math.PI / 2 },
    { x: 820, y: 2040, angle: -Math.PI / 2 },
    { x: 460, y: 120, angle: Math.PI / 2 },
    { x: 640, y: 120, angle: Math.PI / 2 },
    { x: 820, y: 120, angle: Math.PI / 2 },
  ],
  teamASpawns: [
    { x: 460, y: 2040, angle: -Math.PI / 2 },
    { x: 640, y: 2040, angle: -Math.PI / 2 },
    { x: 820, y: 2040, angle: -Math.PI / 2 },
  ],
  teamBSpawns: [
    { x: 820, y: 120, angle: Math.PI / 2 },
    { x: 640, y: 120, angle: Math.PI / 2 },
    { x: 460, y: 120, angle: Math.PI / 2 },
  ],
};

describe("boundsOf", () => {
  it("gives an arena with no polygon no planes at all", () => {
    const bounds = boundsOf({ width: 800, height: 600 });
    expect(bounds).toEqual({ width: 800, height: 600 });
    expect(bounds.planes).toBeUndefined();
  });

  it("carries the width and height of a polygon arena unchanged", () => {
    const bounds = boundsOf(POLYGON_FIXTURE);
    expect(bounds.width).toBe(POLYGON_FIXTURE.width);
    expect(bounds.height).toBe(POLYGON_FIXTURE.height);
  });
});

describe("playableExtentOf", () => {
  it("measures arena-01's tile floor, not the image frame", () => {
    // The floor tiles' own rect: x 40-1240, y 40-680. Deliberately NOT `width`/`height`, which
    // are the frame the walls are drawn in and the camera's bounds.
    expect(playableExtentOf(ARENA_01)).toEqual({ width: 1200, height: 640 });
    expect(playableExtentOf(ARENA_01).width).not.toBe(ARENA_01.width);
  });

  it("measures arena-02's tile floor inside its spike ring the same way", () => {
    expect(playableExtentOf(ARENA_02)).toEqual({ width: 1200, height: 640 });
    expect(playableExtentOf(ARENA_02).width).not.toBe(ARENA_02.width);
  });

  it("falls back to width and height for an arena with no boundary", () => {
    expect(playableExtentOf({ width: 800, height: 600 })).toEqual({
      width: 800,
      height: 600,
    });
  });
});

describe("tile arenas (TA30, TA31)", () => {
  const SPAWN = { x: 120, y: 100, angle: 0 };
  const tile = compileTileArena({
    id: "t",
    rows: ["######", "##...#", "##...#", "######"],
    ffaSpawns: [SPAWN],
    teamASpawns: [SPAWN],
    teamBSpawns: [SPAWN],
  });

  it("measures the playable rect as the bounding box of the non-solid cells", () => {
    expect(playableRectOf(tile)).toEqual({ x: 2 * TILE_SIZE, y: TILE_SIZE, w: 3 * TILE_SIZE, h: 2 * TILE_SIZE });
    expect(playableExtentOf(tile)).toEqual({ width: 3 * TILE_SIZE, height: 2 * TILE_SIZE });
  });

  it("gives the bot the four planes of that rect, every normal pointing inward", () => {
    const planes = playablePlanesOf(tile)!;
    expect(planes).toHaveLength(4);
    const cx = 3.5 * TILE_SIZE;
    const cy = 2 * TILE_SIZE;
    for (const p of planes) expect(p.nx * cx + p.ny * cy - p.d).toBeGreaterThan(0);
    const onSomePlane = (x: number, y: number) =>
      planes.some((p) => Math.abs(p.nx * x + p.ny * y - p.d) < 1e-9);
    expect(onSomePlane(2 * TILE_SIZE, cy)).toBe(true);
    expect(onSomePlane(5 * TILE_SIZE, cy)).toBe(true);
    expect(onSomePlane(cx, TILE_SIZE)).toBe(true);
    expect(onSomePlane(cx, 3 * TILE_SIZE)).toBe(true);
  });

  it("keeps a plain rectangle plane-less, and a polygon arena on its own planes", () => {
    expect(playablePlanesOf({ width: 100, height: 50 })).toBeUndefined();
    expect(playablePlanesOf(POLYGON_FIXTURE)).toEqual(boundsOf(POLYGON_FIXTURE).planes);
    expect(playableRectOf({ width: 100, height: 50 })).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
});
