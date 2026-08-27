import { AIM_CONFIG } from "../../config/aim-config.js";
import type { Aabb, Bounds } from "../collide.js";
import { muzzleOffset, wallClipDistance } from "./instances.js";

/** The car doing the locking, as the lock step sees it. */
export interface LockOwner {
  sessionId: string;
  team: 0 | 1;
  x: number;
  y: number;
  angle: number;
}

/** A car that might be locked. Poses only -- validity is decided by the caller and `canDamage`. */
export interface LockTarget {
  sessionId: string;
  team: 0 | 1;
  x: number;
  y: number;
}

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/**
 * Where the shot actually leaves from: the front face of the owner's hull, along its heading.
 *
 * Shared by the line-of-sight ray and by the fired angle (A11a), so the two can never disagree
 * about where the weapon is. The muzzle position itself is never moved by the lock (A11b) -- it is
 * a physical point on the car, and a wide-angle lock that moved it would spawn shots off the side
 * of the hull in open space.
 */
export function muzzleOf(owner: LockOwner): { x: number; y: number } {
  const nose = muzzleOffset();
  return { x: owner.x + Math.cos(owner.angle) * nose, y: owner.y + Math.sin(owner.angle) * nose };
}

/**
 * Signed angle from the car's heading to a target, in degrees, normalised to (-180, 180].
 *
 * Measured from the car CENTRE, not the muzzle: "how far off my nose is this" is a fact about the
 * car's facing, and it is what both the region test and the score are asking. The angle actually
 * FIRED is muzzle-derived instead (A11a) -- the 24 unit offset between the two is a real parallax
 * at close range, and conflating them would miss by about a car length at 100 units and 40 degrees.
 *
 * Normalisation is not decoration: `angle` accumulates as a car spins, so an un-wrapped delta grows
 * without bound and every region test would reject a target sitting straight ahead.
 */
export function signedAngleDegTo(owner: LockOwner, tx: number, ty: number): number {
  const bearing = Math.atan2(ty - owner.y, tx - owner.x);
  let delta = bearing - owner.angle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  return delta * DEG_PER_RAD;
}

/**
 * How good a target is. **Lowest wins** (A5).
 *
 * The distance term is what stops the score being biased toward far targets, which sit near the
 * centreline precisely because they are far. Its coefficient is per WORLD UNIT -- see
 * `AIM_CONFIG.scorePerDistanceUnit` for why the unit is the load-bearing part.
 */
export function lockScore(angleDeg: number, distance: number): number {
  return Math.abs(angleDeg) + distance * AIM_CONFIG.scorePerDistanceUnit;
}

/**
 * The three bounds of the acquisition region, each optionally widened by a pad. Acquisition passes
 * zero pads; retention passes `AIM_CONFIG`'s (A6).
 */
function withinRegion(
  angleDeg: number,
  distance: number,
  conePadDeg: number,
  lateralPadUnits: number,
  rangePadUnits: number,
): boolean {
  const absDeg = Math.abs(angleDeg);
  if (absDeg > AIM_CONFIG.coneDeg + conePadDeg) return false;
  if (distance > AIM_CONFIG.lockRange + rangePadUnits) return false;
  const lateral = distance * Math.sin(absDeg * RAD_PER_DEG);
  return lateral <= AIM_CONFIG.lateralMax + lateralPadUnits;
}

/** Cone AND lateral cap AND lock range (A2). All three, or the region is wrong at one end. */
export function inAcquireRegion(angleDeg: number, distance: number): boolean {
  return withinRegion(angleDeg, distance, 0, 0, 0);
}

/** Acquisition widened by every retention pad. Strictly wider than `inAcquireRegion` (A6). */
export function inRetainRegion(angleDeg: number, distance: number): boolean {
  return withinRegion(
    angleDeg,
    distance,
    AIM_CONFIG.retentionConeDeg,
    AIM_CONFIG.retentionLateralUnits,
    AIM_CONFIG.retentionRangeUnits,
  );
}

/**
 * Can the muzzle see the target centre? Reuses the beam clip's raycast rather than adding a second
 * spelling of "what stops a ray".
 *
 * The ray is cast exactly as far as the TARGET, never to the weapon's range: a wall standing behind
 * an enemy is not cover.
 *
 * A no-op in every shipped match -- `ACTIVE_ARENA_ID` is `arena-01`, whose `obstacles` is `[]` --
 * and built anyway, because switching arenas is deliberately a one-line edit and `arena-02` already
 * exists with obstacles in it. Without this, that one line would silently turn aim assist into
 * lock-through-walls with no targeting code touched.
 *
 * **Wrecks are not cover.** They are never in the candidate list, and they are not obstacles: a
 * wreck is solid to driving but transparent to combat, so shots already pass straight through one
 * without even spending a pierce budget. Treating it as cover would drop the lock for an
 * obstruction that demonstrably does not stop the bullet.
 */
export function hasLineOfSight(
  ox: number,
  oy: number,
  tx: number,
  ty: number,
  obstacles: readonly Aabb[],
  bounds: Bounds,
): boolean {
  const distance = Math.hypot(tx - ox, ty - oy);
  if (distance === 0) return true;
  const angle = Math.atan2(ty - oy, tx - ox);
  return wallClipDistance(ox, oy, angle, distance, obstacles, bounds) >= distance;
}
