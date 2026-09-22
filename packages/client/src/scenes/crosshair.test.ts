import { describe, expect, it } from "vitest";
import { CROSSHAIR_STYLE } from "../config/crosshair.js";
import { drawCrosshair } from "./crosshair.js";

/**
 * A duck-typed stand-in for `Phaser.GameObjects.Graphics` — `drawCrosshair` only ever calls these
 * five methods, so a real Graphics (which needs a live scene) is not needed to test it (final-fixes
 * item 7: the outline pass is now an explicit flag, not a colour comparison, and is cheap to pin).
 */
function fakeGraphics() {
  const fillCircleRadii: number[] = [];
  const fillStyleColors: number[] = [];
  return {
    calls: { fillCircleRadii, fillStyleColors },
    clear: () => undefined,
    lineStyle: () => undefined,
    strokeCircle: () => undefined,
    lineBetween: () => undefined,
    fillStyle: (color: number) => {
      fillStyleColors.push(color);
    },
    fillCircle: (_x: number, _y: number, radius: number) => {
      fillCircleRadii.push(radius);
    },
  };
}

describe("drawCrosshair (spec TR32, final-fixes item 7)", () => {
  it("draws the outline pass first, at outlineDotRadius, then the line pass at dotRadius", () => {
    const g = fakeGraphics();
    drawCrosshair(g as never, 10, 20);
    expect(g.calls.fillStyleColors).toEqual([CROSSHAIR_STYLE.outlineColor, CROSSHAIR_STYLE.color]);
    expect(g.calls.fillCircleRadii).toEqual([CROSSHAIR_STYLE.outlineDotRadius, CROSSHAIR_STYLE.dotRadius]);
  });
});
