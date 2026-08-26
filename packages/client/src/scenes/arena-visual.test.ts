import { describe, expect, it } from "vitest";
import type { ArenaDef } from "@motor-combat-moba/shared";
import { ARENA_COLOR_DEFAULTS, arenaColorsOf } from "./arena-visual.js";

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
