import { describe, expect, it } from "vitest";
import { ARENA_02, type ArenaDef } from "@motor-combat-moba/shared";
import {
  ARENA_COLOR_DEFAULTS,
  arenaBorderRect,
  arenaColorsOf,
  arenaDecoration,
  boundaryGaps,
  drawableObstacles,
  markingsCircleVisible,
  spikeStrips,
} from "./arena-visual.js";

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

const bare: ArenaDef = {
  id: "test",
  displayName: "Test arena",
  width: 100,
  height: 100,
  obstacles: [],
  ffaSpawns: [],
  teamASpawns: [],
  teamBSpawns: [],
};

describe("arenaColorsOf", () => {
  it("falls back to the client defaults when the arena declares no palette", () => {
    expect(arenaColorsOf(bare)).toEqual(ARENA_COLOR_DEFAULTS);
  });

  it("converts a declared palette to Phaser colour integers", () => {
    const colors = arenaColorsOf({
      ...bare,
      palette: { floor: "#d8cfc4", obstacle: "#6b5b4b", border: "#2f2a26" },
    });
    expect(colors).toEqual({ floor: 0xd8cfc4, obstacle: 0x6b5b4b, border: 0x2f2a26 });
  });

  it("falls back per channel when a hex string is malformed", () => {
    const colors = arenaColorsOf({
      ...bare,
      palette: { floor: "not-a-colour", obstacle: "#6b5b4b", border: "" },
    });
    expect(colors.floor).toBe(ARENA_COLOR_DEFAULTS.floor);
    expect(colors.obstacle).toBe(0x6b5b4b);
    expect(colors.border).toBe(ARENA_COLOR_DEFAULTS.border);
  });
});

describe("arenaBorderRect", () => {
  const arena = { width: 1280, height: 720 };

  /**
   * The border used to be stroked on the arena bounds themselves, which puts half its width outside
   * the world. That was invisible while the camera roamed a world larger than the view; now that the
   * camera ends exactly at the arena edge, the outer half is clipped on all four sides and the
   * border renders half thickness. Insetting by half the stroke width puts the whole line inside.
   */
  it("insets the stroke so its outer edge lands on the arena bounds", () => {
    const r = arenaBorderRect(arena, 4);
    expect(r.x - 2).toBe(0);
    expect(r.y - 2).toBe(0);
    expect(r.x + r.w + 2).toBe(arena.width);
    expect(r.y + r.h + 2).toBe(arena.height);
  });

  it("is the arena itself when there is no stroke to inset", () => {
    expect(arenaBorderRect(arena, 0)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });
});

describe("arenaDecoration", () => {
  it("draws markings and border for a procedural arena", () => {
    expect(arenaDecoration(false, false)).toMatchObject({ drawMarkings: true, drawBorder: true });
  });

  it("draws neither over a floor sprite", () => {
    expect(arenaDecoration(true, false)).toMatchObject({ drawMarkings: false, drawBorder: false });
  });

  it("draws nothing procedural over a tile arena's bake (TA26)", () => {
    expect(arenaDecoration(true, true)).toEqual({ drawMarkings: false, drawBorder: false, drawObstacles: false });
  });

  it("still fills ordinary obstacles on a non-tile arena, art or not", () => {
    expect(arenaDecoration(true, false).drawObstacles).toBe(true);
    expect(arenaDecoration(false, false)).toEqual({ drawMarkings: true, drawBorder: true, drawObstacles: true });
  });
});

describe("drawableObstacles", () => {
  it("keeps ordinary blocks and drops wall-mounted ones", () => {
    expect(drawableObstacles([{ kind: "spike" }, {}, { kind: "spike" }])).toEqual([{}]);
  });
});

describe("art-less arena extras (CQ49–CQ51)", () => {
  it("draws every spike obstacle, teeth pointing into the playable side", () => {
    const strips = spikeStrips(POLYGON_FIXTURE);
    expect(strips).toHaveLength(2);
    const left = strips.find((s) => s.x === 0)!;
    // every tooth apex is inward (x > strip's inner face - tolerance)
    for (const t of left.teeth) expect(Math.max(t[0], t[2], t[4])).toBeGreaterThan(left.x + left.w - 1);
  });
  it("fills the four chamfer triangles of a polygon arena", () => {
    const gaps = boundaryGaps(POLYGON_FIXTURE);
    expect(gaps).toHaveLength(4);
    for (const g of gaps) expect(g).toHaveLength(3);
  });
  it("skips the centre circle only when a zone exists", () => {
    expect(markingsCircleVisible(POLYGON_FIXTURE)).toBe(false);
    expect(markingsCircleVisible(ARENA_02)).toBe(true);
  });
});
