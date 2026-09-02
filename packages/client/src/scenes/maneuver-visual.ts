import { ManeuverKind, weaponDefOf } from "@motor-combat-moba/shared";

/**
 * Pure derivations behind two render-only reads of `PlayerState.maneuver` (spec S3, S6): the wild
 * charge outline and the thunderclap dash streak. Both are cosmetic — they never feed back into the
 * sim — and both are visible to spectators, because `maneuver` is networked in full.
 *
 * `ArenaScene` keeps only the Phaser calls; everything here is testable without a browser.
 */

/**
 * Wild Charge's own colour, READ from the weapon table rather than repeated as a literal here.
 *
 * It was a hardcoded `0xd9a814` until 2026-09-02, on the reasoning that "the outline is nowhere else
 * on screen, so it needs no lookup table". That is true of the outline and false of the colour: the
 * same hex is also the weapon's HUD slot and its row in the players' guide, and a copy meant the
 * 2026-09-02 recolour would have moved those two while leaving the outline gold — with the suite
 * green, because the test asserted the literal. Derived, the two cannot drift again.
 *
 * `wildcharge` spawns no instance, so this is the ONLY place its colour reaches the world.
 */
const CHARGE_OUTLINE_COLOR = Number.parseInt(weaponDefOf("wildcharge").color.slice(1), 16);
const CHARGE_OUTLINE_WIDTH = 3;

export interface ManeuverOutlineStyle {
  color: number;
  width: number;
}

/**
 * The stroke style for the outline drawn around a charging car's hull footprint, or `null` when it
 * should not be drawn. Only `ManeuverKind.CHARGE` gets one — `DASH` gets the ghost trail below
 * instead, and `NONE`/`HOLD` (and any unrecognised wire value) get nothing.
 */
export function maneuverOutline(maneuver: number): ManeuverOutlineStyle | null {
  if (maneuver !== ManeuverKind.CHARGE) return null;
  return { color: CHARGE_OUTLINE_COLOR, width: CHARGE_OUTLINE_WIDTH };
}

/** Alpha of each ghost hull outline trailed behind a dashing car, nearest the car first. */
const DASH_GHOST_ALPHAS = [0.28, 0.16, 0.07] as const;

export function dashGhostAlphas(): readonly number[] {
  return DASH_GHOST_ALPHAS;
}

/** World units behind the car's centre for each ghost, in the same order as `dashGhostAlphas`. */
const DASH_GHOST_SPACING = 18;

export function dashGhostOffsets(): readonly number[] {
  return DASH_GHOST_ALPHAS.map((_alpha, index) => (index + 1) * DASH_GHOST_SPACING);
}

/** A car pose, in the same `{x, y, angle}` shape `hpBarPoints` already takes. */
export interface HullPose {
  x: number;
  y: number;
  angle: number;
}

/**
 * The four world-space corners of a car's hull footprint at `pose`, so a stroked rect can turn with
 * the car. Follows the same "+x forward, rotate at draw time" convention as `hpBarPoints` and
 * `drawCar`'s own `?debug=1` box, so the charge outline and the dash ghosts land exactly on the OBB
 * the sim collides with rather than on some other rectangle a reader would have to reconcile.
 */
export function hullOutlinePoints(
  pose: HullPose,
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const hw = width / 2;
  const hh = height / 2;
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  const corners = [
    { x: hw, y: hh },
    { x: hw, y: -hh },
    { x: -hw, y: -hh },
    { x: -hw, y: hh },
  ];
  return corners.map((p) => ({
    x: pose.x + c * p.x - s * p.y,
    y: pose.y + s * p.x + c * p.y,
  }));
}

/**
 * The pose of one dash ghost: `offset` units behind the car along `-maneuverAngle`, the direction the
 * dash travels from. Rotation matches the car's own hull, not a recomputed one — `stepDrive`'s
 * `tickDash` welds `angle` to `maneuverAngle` for the whole dash (see `sim/drive.ts`), so the pose
 * passed in already carries the right rotation and this only needs to translate it backwards.
 */
export function dashGhostPose(pose: HullPose, maneuverAngle: number, offset: number): HullPose {
  return {
    x: pose.x - Math.cos(maneuverAngle) * offset,
    y: pose.y - Math.sin(maneuverAngle) * offset,
    angle: pose.angle,
  };
}
