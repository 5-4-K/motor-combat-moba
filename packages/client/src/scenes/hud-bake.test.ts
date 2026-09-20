import { describe, expect, it } from "vitest";
import { HUD_BAKE_SCALE, sameCommands } from "./hud-bake.js";

describe("sameCommands", () => {
  it("reads two identical buffers as the same picture", () => {
    expect(sameCommands([4, 0xffb45a, 0.5, 9, 10, 20, 8], [4, 0xffb45a, 0.5, 9, 10, 20, 8])).toBe(true);
    expect(sameCommands([], [])).toBe(true);
  });

  it("catches a single changed value anywhere — an alpha, a coordinate, a flag", () => {
    const base = [4, 0xffb45a, 0.5, 9, 10, 20, 8, false];
    for (let i = 0; i < base.length; i += 1) {
      const moved = [...base];
      moved[i] = typeof moved[i] === "boolean" ? !moved[i] : (moved[i] as number) + 0.01;
      expect(sameCommands(base, moved)).toBe(false);
    }
  });

  it("catches a command added or dropped, even when the shared prefix matches", () => {
    expect(sameCommands([1, 2, 3], [1, 2, 3, 4])).toBe(false);
    expect(sameCommands([1, 2, 3, 4], [1, 2, 3])).toBe(false);
  });

  it("never reads a fresh buffer as the empty one a new scene starts from", () => {
    // `hudBakedCommands` starts as `[]`, so the first frame that draws anything must bake.
    expect(sameCommands([4, 0, 1], [])).toBe(false);
  });

  it("fails SAFE on values it cannot compare: two equal-looking objects are not the same", () => {
    // Were Phaser ever to push an object per command the HUD would re-bake every frame — the
    // optimisation lost, the picture still right. Reading them as equal would freeze the HUD.
    expect(sameCommands([{ x: 1 }], [{ x: 1 }])).toBe(false);
  });
});

describe("HUD_BAKE_SCALE", () => {
  it("supersamples, because a render texture is not multisampled", () => {
    expect(HUD_BAKE_SCALE).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(HUD_BAKE_SCALE)).toBe(true);
  });
});
