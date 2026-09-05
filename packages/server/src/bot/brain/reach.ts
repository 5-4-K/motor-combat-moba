import { slotsOf, weaponDefOf, type CarId, type WeaponId } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";

/**
 * The range a player aims with (S10): lock reach for aim-assist, authored range otherwise,
 * contact trigger for a dash/charge that travels nowhere.
 */
export function weaponReachOf(weaponId: WeaponId): number {
  const def = weaponDefOf(weaponId);
  if (def.usesAimAssist && def.aimRangeUnits !== undefined && def.aimRangeUnits > 0) {
    return def.aimRangeUnits;
  }
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
