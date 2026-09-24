import { describe, expect, it } from "vitest";
import { ARENA_02, ARENA_03, type ArenaDef } from "@motor-combat-moba/shared";
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

const bare: ArenaDef = {
  id: "test",
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
    expect(arenaDecoration(false)).toEqual({ drawMarkings: true, drawBorder: true });
  });

  it("draws neither over a floor sprite", () => {
    expect(arenaDecoration(true)).toEqual({ drawMarkings: false, drawBorder: false });
  });
});

describe("drawableObstacles", () => {
  it("keeps ordinary blocks and drops wall-mounted ones", () => {
    expect(drawableObstacles([{ kind: "spike" }, {}, { kind: "spike" }])).toEqual([{}]);
  });
});

describe("art-less arena extras (CQ49–CQ51)", () => {
  it("draws every spike obstacle, teeth pointing into the playable side", () => {
    const strips = spikeStrips(ARENA_03);
    expect(strips).toHaveLength(2);
    const left = strips.find((s) => s.x === 0)!;
    // every tooth apex is inward (x > strip's inner face - tolerance)
    for (const t of left.teeth) expect(Math.max(t[0], t[2], t[4])).toBeGreaterThan(left.x + left.w - 1);
  });
  it("fills the four chamfer triangles of arena-03", () => {
    const gaps = boundaryGaps(ARENA_03);
    expect(gaps).toHaveLength(4);
    for (const g of gaps) expect(g).toHaveLength(3);
  });
  it("finds no gaps on a boundary equal to its frame, and skips the centre circle only when a zone exists", () => {
    expect(markingsCircleVisible(ARENA_03)).toBe(false);
    expect(markingsCircleVisible(ARENA_02)).toBe(true);
  });
});
