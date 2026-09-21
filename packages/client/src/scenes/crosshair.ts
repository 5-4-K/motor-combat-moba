import type Phaser from "phaser";
import { CROSSHAIR_STYLE as C } from "../config/crosshair.js";

/** One pass of the crosshair: the dark outline first, the white line on top of it. `outline` is an
 *  explicit flag rather than comparing `color` against `C.outlineColor` (final-fixes item 7) — a
 *  future style sharing a colour between the two passes must not silently pick the wrong dot size. */
const PASSES = [
  { width: C.outlineWidth, color: C.outlineColor, outline: true },
  { width: C.lineWidth, color: C.color, outline: false },
] as const;

/** Circle, centre dot, four arms running from near the dot out past the circle (spec TR32). */
export function drawCrosshair(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.clear();
  const reach = C.radius + C.armOverhang;
  for (const { width, color, outline } of PASSES) {
    g.lineStyle(width, color, 1);
    g.strokeCircle(x, y, C.radius);
    g.lineBetween(x + C.armGap, y, x + reach, y);
    g.lineBetween(x - C.armGap, y, x - reach, y);
    g.lineBetween(x, y + C.armGap, x, y + reach);
    g.lineBetween(x, y - C.armGap, x, y - reach);
    g.fillStyle(color, 1);
    g.fillCircle(x, y, outline ? C.outlineDotRadius : C.dotRadius);
  }
}
