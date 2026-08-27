import type { WeaponDef, WeaponId } from "./weapon-types.js";

/**
 * Every weapon in the game, mirroring `CAR_TABLE`. Balance lives here and nowhere else.
 *
 * `cannon` is the migrated pre-weapon-system shot, carrying its exact numbers: `fireRateHz: 2`
 * became `cooldownMs: 500`, and `lifetimeTicks: 30` became `range: 900` (one second of flight at
 * 900 u/s). Its 3-unit circle is the smallest hitbox that keeps the old point-hit feel while
 * satisfying "every weapon has a hitbox".
 */
export const WEAPON_TABLE = {
  cannon: {
    id: "cannon",
    kind: "projectile",
    name: "Cannon",
    unlocksAt: 1,
    damage: 8,
    damageFrequencyMs: 0,
    speed: 900,
    range: 900,
    startUpMs: 0,
    cooldownMs: 500,
    recoveryMs: 0,
    hitbox: { shape: "circle", radius: 3 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * NO CAR CARRIES THIS WEAPON. It is not in any `CAR_TABLE` loadout and cannot be reached in game —
   * that is by design, not an oversight. `fire.ts`'s stock mechanic (D5) needs a real, multi-stock
   * weapon to prove itself against; `cannon` is deliberately single-stock (D22 ships zero balance
   * change), so there was nothing in the table the stock tests could exercise honestly. `repeater`
   * exists purely as that live proof and as the reference example for whoever authors the first
   * multi-stock weapon actually placed in a loadout. `cooldownMs`/`stock` below are the spec's D5
   * worked example transcribed verbatim: three stocks, a three-second recharge. Do not delete this
   * just because nothing spawns it.
   */
  repeater: {
    id: "repeater",
    kind: "projectile",
    name: "Repeater",
    unlocksAt: 1,
    damage: 5,
    damageFrequencyMs: 0,
    speed: 700,
    range: 700,
    startUpMs: 0,
    cooldownMs: 3000,
    recoveryMs: 5000, // D4's own example: refirable by itself at 3s while other slots wait 5s
    hitbox: { shape: "circle", radius: 3 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
    stock: { max: 3, refireDelayMs: 100 },
  },
} as const satisfies Record<WeaponId, WeaponDef>;

/**
 * Own-property check, deliberately not `value in WEAPON_TABLE`: `in` walks the prototype chain, so
 * inherited names like `"constructor"` would pass as weapon ids and resolve to undefined stats.
 * Same rule as `isCarId`.
 */
export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WEAPON_TABLE, value);
}

export function weaponDefOf(id: WeaponId): WeaponDef {
  return WEAPON_TABLE[id];
}

/** @deprecated Superseded by `WEAPON_TABLE`; removed once `combat.ts` stops reading it. */
export const WEAPON_CONFIG = {
  damage: 8,
  fireRateHz: 2,
  projectileSpeed: 900,
  lifetimeTicks: 30,
} as const;
