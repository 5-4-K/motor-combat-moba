import type { WeaponDef, WeaponId } from "./weapon-types.js";

/**
 * Every weapon in the game, mirroring `CAR_TABLE`. Balance lives here and nowhere else.
 *
 * `fireball` is the migrated pre-weapon-system shot, carrying its exact numbers: `fireRateHz: 2`
 * became `cooldownMs: 500`, and `lifetimeTicks: 30` became `range: 900` (one second of flight at
 * 900 u/s). Its hitbox is the one deliberate departure from that migration: it shipped as a 3-unit
 * circle, the smallest that kept the old point-hit feel while satisfying "every weapon has a
 * hitbox", and was later widened to 12 so the shot reads on screen — the client draws the hitbox
 * itself, never a sprite. A 24-unit disc is three quarters of a car's 32-unit width.
 *
 * `color` is the one render-only number here besides `name`. It is per weapon on purpose: every
 * car firing a fireball fires the same ember-orange shot. The two shipped colours are picked to be
 * unmistakable for any `COLOR_TABLE` player colour — ember orange leans darker and redder than
 * `Orange`/`Gold`, and no player can be teal — so a shot never reads as somebody's car paint.
 */
export const WEAPON_TABLE = {
  fireball: {
    id: "fireball",
    kind: "projectile",
    name: "Fireball",
    color: "#E8590C",
    unlocksAt: 1,
    damage: 8,
    damageFrequencyMs: 0,
    speed: 900,
    range: 900,
    startUpMs: 0,
    cooldownMs: 500,
    recoveryMs: 0,
    // The system would otherwise ship dark: `fireball` is the only weapon any chassis carries, so
    // leaving it off would put aim assist on the same never-seen-in-play list as beams, multi-pellet
    // volleys and `repeater`. Note the consequence -- every chassis carries `fireball`, so aim assist
    // is universal until a second weapon is authored.
    usesAimAssist: true,
    hitbox: { shape: "circle", radius: 12 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * NO CAR CARRIES THIS WEAPON. It is not in any `CAR_TABLE` loadout and cannot be reached in game —
   * that is by design, not an oversight. `fire.ts`'s stock mechanic (D5) needs a real, multi-stock
   * weapon to prove itself against; `fireball` is deliberately single-stock (D22 ships zero balance
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
    color: "#0CA5B0",
    unlocksAt: 1,
    damage: 5,
    damageFrequencyMs: 0,
    speed: 700,
    range: 700,
    startUpMs: 0,
    cooldownMs: 3000,
    recoveryMs: 5000, // D4's own example: refirable by itself at 3s while other slots wait 5s
    usesAimAssist: false,
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
