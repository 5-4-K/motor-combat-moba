import { describe, expect, it } from "vitest";
import type { ArenaDef } from "@motor-combat-moba/shared";
import { ARENA_COLOR_DEFAULTS, arenaColorsOf, arenaBorderRect } from "./arena-visual.js";

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
