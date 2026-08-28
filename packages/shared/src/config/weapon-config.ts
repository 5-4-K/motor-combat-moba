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
 *
 * `damage` is what the weapon deals from a chassis at `COMBAT_CONFIG.attackBaseline` — an *average*
 * car, not every car. `damageFor` (`sim/damage.ts`) moves it +/-50% with the firing chassis's
 * `attack` rating. Fireball's 50 is solved, not chosen: an average chassis has 500 hull HP and
 * fireball fires twice a second, so 50 is the number that makes an average-vs-average kill take the
 * design target of 5 seconds. `splinter`'s 30 is solved from its own recharge rather than from
 * `fireball`: 30 damage per 400 ms is 75 sustained DPS, three quarters of the anchor, which is where
 * a 1.2x `attack` chassis wants its go-to. See `docs/superpowers/specs/2026-08-29-weapon-roster-design.md`.
 */
export const WEAPON_TABLE = {
  fireball: {
    id: "fireball",
    kind: "projectile",
    name: "Fireball",
    color: "#E8590C",
    unlocksAt: 1,
    damage: 50,
    damageFrequencyMs: 0,
    speed: 900,
    range: 900,
    startUpMs: 0,
    cooldownMs: 500,
    recoveryMs: 0,
    // The system would otherwise ship dark: `fireball` is the only weapon any chassis carries, so
    // leaving it off would put aim assist on the same never-seen-in-play list as beams, multi-pellet
    // volleys and `splinter`. Note the consequence -- every chassis carries `fireball`, so aim assist
    // is universal until a second weapon is authored.
    usesAimAssist: true,
    hitbox: { shape: "circle", radius: 12 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
  },
  /**
   * Oval's slot 1, and the table's only multi-stock weapon. It replaced `repeater`, which held this
   * reference role while carried by no car; a reachable reference is strictly better, because stock
   * bugs now surface in matches instead of only in `fire.test.ts`.
   *
   * `cooldownMs: 400` is the entire design and is not a knob to round off. One dart per 400 ms
   * sustains 75 DPS; dumping all three puts 90 damage out in 260 ms and then leaves a 1.2 s dry
   * spell at 62 DPS across the cycle. So tapping wins the long fight and dumping wins the moment,
   * which is the trigger discipline the weapon exists to ask for. At the 1.7 s first drafted for it
   * the weapon sustains 18 DPS against `fireball`'s 100 and is not a viable slot 1.
   */
  splinter: {
    id: "splinter",
    kind: "projectile",
    name: "Splinter",
    color: "#0CA5B0",
    unlocksAt: 1,
    damage: 30,
    damageFrequencyMs: 0,
    speed: 1100,
    range: 850, // >= AIM_CONFIG.lockRange (400), required for usesAimAssist
    startUpMs: 0,
    cooldownMs: 400, // 2.5 Hz, clear of the 1.25 Hz aim-assist cliff by 100%
    recoveryMs: 0, // a go-to never gates another slot (L5)
    usesAimAssist: true,
    hitbox: { shape: "circle", radius: 5 },
    pierce: 0,
    volley: { volleys: 1, volleyIntervalMs: 0, pelletsPerVolley: 1, spreadAngleDeg: 0 },
    stock: { max: 3, refireDelayMs: 130 },
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
