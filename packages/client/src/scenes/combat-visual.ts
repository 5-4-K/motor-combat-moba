import {
  DEFAULT_PATCH_RATE_HZ,
  DEFAULT_CAR_ID,
  WeaponKind,
  beamShapeAt,
  hpOf,
  isCarId,
  isWeaponId,
  projectileShapeAt,
  weaponDefOf,
  type BeamHitbox,
  type ProjectileHitbox,
  type WorldShape,
} from "@motor-combat-moba/shared";

/**
 * How full a car's hp bar is, in `[0, 1]`.
 *
 * The denominator comes from the car's own `CAR_TABLE` hp, not from a shared maximum: a hexagon at
 * half hp and a rectangle at half hp must both read as half a bar, or the bar tells you about the
 * chassis instead of about the fight. An unrecognised `carId` falls back to the default chassis,
 * the same fallback the sim uses, rather than dividing by an undefined maximum and rendering NaN.
 */
export function hpFraction(hp: number, carId: string): number {
  const max = hpOf(isCarId(carId) ? carId : DEFAULT_CAR_ID);
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, hp / max));
}

/** Bar colour by remaining hp: green, amber under a third, red under a sixth. */
export function hpBarColor(fraction: number): number {
  if (fraction <= 1 / 6) return 0xd94040;
  if (fraction <= 1 / 3) return 0xd9a03a;
  return 0x49c46a;
}

/**
 * How far a shot has travelled since the patch that reported it, for drawing only.
 *
 * Shots arrive at the patch rate (20 Hz) but move at 900 u/s, so a raw draw steps them 45 units at
 * a time. Advancing along the shot's own constant velocity is exact rather than a guess — the
 * server integrates the identical straight line — so this smooths the picture without inventing
 * motion. It is still *only* the picture: hits are decided on the server against the server's
 * positions, and nothing here feeds back into state.
 *
 * Capped at one patch interval so a stalled connection cannot fling a stale shot across the arena
 * while the client waits for the delete that already happened.
 */
export function extrapolateShot(
  x: number,
  y: number,
  angle: number,
  speed: number,
  elapsedMs: number,
): { x: number; y: number } {
  const maxMs = 1000 / DEFAULT_PATCH_RATE_HZ;
  const dt = Math.min(Math.max(elapsedMs, 0), maxMs) / 1000;
  return { x: x + Math.cos(angle) * speed * dt, y: y + Math.sin(angle) * speed * dt };
}

/** A live instance, as it arrives on the wire (`WeaponInstanceState`) — the fields drawing needs. */
export interface DrawableInstance {
  weaponId: string;
  kind: number;
  x: number;
  y: number;
  angle: number;
  extent: number;
}

/** The hitbox radius drawn for an instance whose `weaponId` is not in `WEAPON_TABLE`. */
const UNKNOWN_WEAPON_RADIUS = 3;

/**
 * Extrapolation is capped at one patch interval, so a stalled connection cannot fling a stale
 * instance across the arena while the client waits for the delete that already happened.
 */
function capMs(elapsedMs: number): number {
  return Math.min(Math.max(elapsedMs, 0), 1000 / DEFAULT_PATCH_RATE_HZ);
}

/**
 * What to draw for one live instance, in world space. The silhouette is the weapon's own hitbox
 * (D19), so what a player sees is exactly what can hurt them — and a new weapon needs no art.
 *
 * The branch is the *row's own* `kind` (the wire field, mirroring `WeaponKind`), not the weapon
 * definition's — the row is what a beam actually is at draw time, and by construction
 * (`spawnInstances` in shared) a live instance's `kind` always agrees with its `weaponId`'s
 * definition anyway. An unrecognised `weaponId` still draws something (a small dot) rather than
 * throwing, since a stale or forward-incompatible id must never blank the whole shot layer.
 */
export function instanceDrawShape(instance: DrawableInstance, elapsedMs: number): WorldShape {
  const def = isWeaponId(instance.weaponId) ? weaponDefOf(instance.weaponId) : null;
  if (!def) {
    return { kind: "circle", x: instance.x, y: instance.y, radius: UNKNOWN_WEAPON_RADIUS };
  }

  if (instance.kind === WeaponKind.BEAM) {
    const hitbox = def.hitbox as BeamHitbox;
    const grown = Math.min(def.range, instance.extent + (def.speed * capMs(elapsedMs)) / 1000);
    return beamShapeAt(hitbox, instance.x, instance.y, instance.angle, grown);
  }
  const at = extrapolateShot(instance.x, instance.y, instance.angle, def.speed, elapsedMs);
  return projectileShapeAt(def.hitbox as ProjectileHitbox, at.x, at.y, instance.angle);
}
