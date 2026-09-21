import type Phaser from "phaser";
import { TURRET_CONFIG, wrapAngle } from "@motor-combat-moba/shared";
import { TURRET_FALLBACK, TURRET_VISUAL } from "../config/turret-visual.js";

const RATE = (TURRET_CONFIG.turnRateDegPerSec * Math.PI) / 180;

/** The turret's drawn long edge, world units: `TURRET_VISUAL.lengthUnits` times the row's numeric `scale` (TR42). */
export function turretDisplayLength(scale: "fit" | number): number {
  return scale === "fit" ? TURRET_VISUAL.lengthUnits : TURRET_VISUAL.lengthUnits * scale;
}

/**
 * The drawn turret chases the networked one at the turret's own turn rate — what the sim does between
 * patches (spec TR42). A gap wider than a quarter turn is a respawn or a lost patch, not a turn, so it
 * snaps.
 */
export function easeTurretAngle(shown: number, target: number, dtSeconds: number): number {
  const delta = wrapAngle(target - shown);
  if (Math.abs(delta) > Math.PI / 2) return target;
  const max = RATE * dtSeconds;
  return Math.abs(delta) <= max ? target : wrapAngle(shown + Math.sign(delta) * max);
}

/**
 * The procedural turret, pivot at (`x`, `y`) and barrel along +x: what a car draws when neither of
 * its turret keys resolves. Shared by `ArenaScene` and `?dev=assets` so the tool's "procedural" is the
 * arena's. `import type` only, so this module stays loadable from a node test.
 */
export function drawProceduralTurret(
  gfx: Phaser.GameObjects.Graphics,
  fill: number,
  x = 0,
  y = 0,
): Phaser.GameObjects.Graphics {
  const f = TURRET_FALLBACK;
  const barrel = TURRET_CONFIG.defaultOffset;
  gfx.fillStyle(fill, 1);
  gfx.lineStyle(f.outlineWidth, f.outlineColor, f.outlineAlpha);
  gfx.fillRect(x, y - f.barrelWidth / 2, barrel, f.barrelWidth);
  gfx.strokeRect(x, y - f.barrelWidth / 2, barrel, f.barrelWidth);
  const left = x - f.blockWidth / 2;
  const top = y - f.blockHeight / 2;
  gfx.fillRoundedRect(left, top, f.blockWidth, f.blockHeight, f.blockRadius);
  gfx.strokeRoundedRect(left, top, f.blockWidth, f.blockHeight, f.blockRadius);
  return gfx;
}
