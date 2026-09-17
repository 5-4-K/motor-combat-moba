import { slotsOf, weaponDefOf, type CarId, type WeaponId } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";

/**
 * The range a player aims with (S10): the weapon's authored range, or the contact trigger for a
 * dash/charge that travels nowhere.
 *
 * This used to prefer a shorter `aimRangeUnits` for the rows that carried one — the reach a lock
 * would actually point a shot over, which for `predator` was 800 against a 1800 unit `range`. With
 * targeting gone the authored range is the only reach there is, so three rows (`predator`,
 * `magmablast`, `thumper`) now report a LONGER reach to the brain than they did. That is honest
 * about where a shot can travel, not about where one is likely to land: `solve`'s quadrature over
 * `aimSigmaRad` is what prices the miss at distance, and it always did the work for every
 * unassisted row.
 */
export function weaponReachOf(weaponId: WeaponId): number {
  const def = weaponDefOf(weaponId);
  if (def.range > 0) return def.range;
  return BRAIN_CONSTANTS.contactTriggerUnits;
}

/** Chassis default kit, plus weapons this bot has actually seen them fire (S11). */
export function kitWeaponIds(
  carId: CarId,
  extraWeaponIds: readonly WeaponId[] = [],
): WeaponId[] {
  const seen = new Set<WeaponId>(slotsOf(carId));
  for (const id of extraWeaponIds) seen.add(id);
  return [...seen];
}

export function kitReachOf(
  carId: CarId,
  extraWeaponIds: readonly WeaponId[] = [],
): { shortest: number; longest: number } {
  const ids = kitWeaponIds(carId, extraWeaponIds);
  let shortest = Infinity;
  let longest = 0;
  for (const id of ids) {
    const reach = weaponReachOf(id);
    shortest = Math.min(shortest, reach);
    longest = Math.max(longest, reach);
  }
  if (!Number.isFinite(shortest)) return { shortest: 0, longest: 0 };
  return { shortest, longest };
}
