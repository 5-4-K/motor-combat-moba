import { describe, expect, it } from "vitest";
import { SPIKE_STRIP_COLOR, type ArenaColors } from "../scenes/arena-visual.js";
import { resolveTileDraw } from "./tile-art.js";

const colors = { floor: 0x111111, obstacle: 0x222222, border: 0x333333 } as ArenaColors;
const none = { exists: () => false };
const all = { exists: () => true };

describe("resolveTileDraw (TA25)", () => {
  it("draws the texture when it loaded", () => {
    expect(resolveTileDraw(all, "wall", colors)).toEqual({ kind: "texture", key: "arena.common.tile.wall" });
  });

  it("falls back to the palette when it did not", () => {
    expect(resolveTileDraw(none, "floor", colors)).toEqual({ kind: "fill", color: 0x111111 });
    expect(resolveTileDraw(none, "wall", colors)).toEqual({ kind: "fill", color: 0x222222 });
    expect(resolveTileDraw(none, "spike", colors)).toEqual({ kind: "fill", color: SPIKE_STRIP_COLOR });
    expect(resolveTileDraw(none, "spike-teeth", colors)).toEqual({ kind: "teeth" });
  });

  it("falls back to the obstacle colour for an art id it does not know", () => {
    expect(resolveTileDraw(none, "mystery", colors)).toEqual({ kind: "fill", color: 0x222222 });
  });
});
