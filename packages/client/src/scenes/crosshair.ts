import type Phaser from "phaser";
import { CROSSHAIR_STYLE as C } from "../config/crosshair.js";

/** Circle, centre dot, four arms running from near the dot out past the circle (spec TR32). */
export function drawCrosshair(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.clear();
  const reach = C.radius + C.armOverhang;
  for (const [width, color] of [
    [C.outlineWidth, C.outlineColor],
    [C.lineWidth, C.color],
  ] as const) {
    g.lineStyle(width, color, 1);
    g.strokeCircle(x, y, C.radius);
    g.lineBetween(x + C.armGap, y, x + reach, y);
    g.lineBetween(x - C.armGap, y, x - reach, y);
    g.lineBetween(x, y + C.armGap, x, y + reach);
    g.lineBetween(x, y - C.armGap, x, y - reach);
    g.fillStyle(color, 1);
    g.fillCircle(x, y, color === C.outlineColor ? C.dotRadius + 1 : C.dotRadius);
  }
}
