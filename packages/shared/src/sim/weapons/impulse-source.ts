import type { WeaponDef } from "../../config/weapon-types.js";
import type { WeaponInstance } from "./instances.js";

/**
 * Where a `direction: "radial"` impulse pushes AWAY from (or, for a negative `speed`, pulls TOWARD).
 *
 * The source is derived from the weapon's own geometry and never authored on the row
 * (`ImpulseDef.direction`'s doc). Pure: it reads the resolved instance def, the instance and the
 * victim's position, and returns a point.
 *
 * - A projectile, or any explosion: the instance's own position — the muzzle for a shot, the blast
 *   centre for a burst.
 * - A beam with a `disc` hitbox (an aura): its centre, which is the instance origin.
 * - A beam with a rect, cone or bar hitbox: the PERPENDICULAR FOOT of the victim on the beam's fire
 *   axis — the point on the line through the origin along `angle` closest to the victim. The
 *   projection is deliberately UNCLAMPED (a victim beside or behind the origin still has a foot):
 *   the line is the geometry that matters for a centreline pull, and clamping would turn a lateral
 *   pull into a diagonal one near the origin. A negative `speed` against this source therefore pulls
 *   a caught car straight onto the beam's centreline.
 *
 * `def` is the def `instanceDefOf(instance.weaponId, instance.isExplosion)` returns, passed in so a
 * caller that has already resolved it does not pay for a second lookup.
 */
export function radialSourceOf(
  def: WeaponDef,
  instance: WeaponInstance,
  victimX: number,
  victimY: number,
): { x: number; y: number } {
  if (instance.isExplosion || def.kind !== "beam" || def.hitbox.shape === "disc") {
    return { x: instance.x, y: instance.y };
  }
  const dirX = Math.cos(instance.angle);
  const dirY = Math.sin(instance.angle);
  const along = (victimX - instance.x) * dirX + (victimY - instance.y) * dirY;
  return { x: instance.x + along * dirX, y: instance.y + along * dirY };
}
