import { CAR_TABLE } from "./car-config.js";
import type { CarId } from "./types.js";
import type { WeaponId } from "./weapon-types.js";

/**
 * How many weapon slots any chassis may present. The server rejects a fire on a slot at or beyond
 * this index, and the HUD draws at most this many boxes.
 */
export const WEAPON_SLOT_CONFIG = { maxWeaponSlots: 3 } as const;

/** Cars already warned about, so an over-long loadout logs once rather than once per tick. */
const warned = new Set<string>();

/**
 * A car's loadout, capped at the slot limit. A car listing more weapons than slots is a config
 * mistake worth surfacing but not worth crashing over: the extras can never be selected or drawn,
 * so they are dropped with one warning naming the car.
 */
export function slotsFrom(carId: string, weapons: readonly WeaponId[]): readonly WeaponId[] {
  const max = WEAPON_SLOT_CONFIG.maxWeaponSlots;
  if (weapons.length <= max) return weapons;
  if (!warned.has(carId)) {
    warned.add(carId);
    console.warn(
      `[weapons] car "${carId}" lists ${weapons.length} weapons but maxWeaponSlots is ${max}; ` +
        `ignoring: ${weapons.slice(max).join(", ")}`,
    );
  }
  return weapons.slice(0, max);
}

export function slotsOf(carId: CarId): readonly WeaponId[] {
  return slotsFrom(carId, CAR_TABLE[carId].weapons);
}
