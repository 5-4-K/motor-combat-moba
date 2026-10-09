import { describe, expect, it } from "vitest";
import { SPIKE_STRIP_COLOR, type ArenaColors } from "../scenes/arena-visual.js";
import type { BakeStamp } from "../scenes/tile-bake.js";
import { resolveTileDraw } from "./tile-art.js";

const colors = { floor: 0x111111, obstacle: 0x222222, border: 0x333333 } as ArenaColors;
const none = { exists: () => false };
const all = { exists: () => true };

function stamp(patch: Partial<BakeStamp>): BakeStamp {
  return { col: 0, row: 0, art: "checker-plate", rotation: 0, overlay: false, solid: true, hazard: null, ...patch };
}
const floor = stamp({ art: "metal-plate", solid: false });
const wall = stamp({});
const spike = stamp({ hazard: "spike" });
const teeth = stamp({ art: "spike-teeth", hazard: "spike", overlay: true });

describe("resolveTileDraw (TA25, TC33)", () => {
  it("draws the texture when it loaded", () => {
    expect(resolveTileDraw(all, wall, colors)).toEqual({ kind: "texture", key: "arena.common.tile.checker-plate" });
    expect(resolveTileDraw(all, teeth, colors)).toEqual({ kind: "texture", key: "arena.common.tile.spike-teeth" });
  });

  it("falls back by behaviour, not art id, when it did not", () => {
    expect(resolveTileDraw(none, floor, colors)).toEqual({ kind: "fill", color: 0x111111 });
    expect(resolveTileDraw(none, spike, colors)).toEqual({ kind: "fill", color: SPIKE_STRIP_COLOR });
    expect(resolveTileDraw(none, wall, colors)).toEqual({ kind: "fill", color: 0x222222 });
    expect(resolveTileDraw(none, teeth, colors)).toEqual({ kind: "teeth" });
  });

  it("draws a non-solid cell with no art as floor, whatever textures exist", () => {
    expect(resolveTileDraw(all, stamp({ art: null, solid: false }), colors)).toEqual({ kind: "fill", color: 0x111111 });
  });
});
