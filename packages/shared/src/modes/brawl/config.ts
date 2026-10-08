import type { ModeOverrides } from "../merge.js";

/**
 * Brawl's differences from the base (`modes/base.ts`). Empty: Brawl plays the common defaults.
 * The basic attack is off (base value); turrets still draw because the carried turret weapons
 * (each chassis's slot-1 weapon, plus roadblock) light `carHasTurretWeapon` on their own.
 */
export const BRAWL_OVERRIDES: ModeOverrides = {};
