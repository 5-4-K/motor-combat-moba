import type Phaser from "phaser";
import { turret, wrapAngle } from "@motor-combat-moba/shared";
import { TURRET_FALLBACK, TURRET_VISUAL } from "../config/turret-visual.js";

/**
 * The turret's drawn long edge, world units: `lengthUnits` times the row's numeric `scale` (TR42).
 * `lengthUnits` defaults to the shipped `TURRET_VISUAL.lengthUnits`; a playground room hands in its
 * resolved length instead — the global knob times that car's multiplier (TR60).
 */
export function turretDisplayLength(
  scale: "fit" | number,
  lengthUnits: number = TURRET_VISUAL.lengthUnits,
): number {
  return scale === "fit" ? lengthUnits : lengthUnits * scale;
}

/**
 * The drawn turret chases the networked one at the turret's own turn rate — what the sim does between
 * patches (spec TR42). A gap wider than a quarter turn is a respawn or a lost patch, not a turn, so it
 * snaps. The rate is read from `turret()` on every call, never cached at module load, so a
 * playground turn-rate retune reaches the drawn turret the frame the tuning store takes it (TR59).
 */
export function easeTurretAngle(shown: number, target: number, dtSeconds: number): number {
  const delta = wrapAngle(target - shown);
  if (Math.abs(delta) > TURRET_VISUAL.snapAboveRad) return target;
  const max = ((turret().turnRateDegPerSec * Math.PI) / 180) * dtSeconds;
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
  const barrel = turret().defaultOffset;
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
