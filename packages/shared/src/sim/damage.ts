import { CAR_TABLE } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { weaponDefOf } from "../config/weapon-config.js";
import type { CarId } from "../config/types.js";
import type { WeaponId } from "../config/weapon-types.js";

/**
 * The only place hp is ever reduced. Every damage source — projectiles, rams, anything a later
 * balance pass adds — routes through here, so a buff, a shield, or a damage cap is one edit rather
 * than a hunt through the tick. Nothing else may subtract from `PlayerState.hp`.
 *
 * Pure and clamped at both ends: hp never goes negative (0 is the wreck threshold the win check
 * reads), and a negative `amount` is dropped rather than healing, so a bad config number cannot
 * turn a weapon into a repair kit.
 */
export function applyDamage(hp: number, amount: number): number {
  if (amount <= 0) return hp;
  return Math.max(0, hp - amount);
}

/**
 * What one hit of `weaponDamage` costs when fired by a chassis with this `attack` rating.
 *
 * The single definition of "how much does this hurt", as `applyDamage` above is the single
 * definition of "hp goes down". A later balance term — a level scalar, a per-weapon scaling
 * coefficient — enters here and nowhere else.
 *
 * Rounded here rather than at the point of impact, so an integer reaches `applyDamage` and a
 * piercing shot deals the identical number to every car it passes through. Floored at 0 so an
 * out-of-range rating cannot produce a negative amount.
 */
export function damageFor(attack: number, weaponDamage: number): number {
  const scale = 1 + (attack - COMBAT_CONFIG.attackBaseline) * COMBAT_CONFIG.damagePerAttack;
  return Math.max(0, Math.round(weaponDamage * scale));
}

/** `damageFor` with both lookups done: what this chassis deals with this weapon. */
export function weaponDamageOf(carId: CarId, weaponId: WeaponId): number {
  return damageFor(CAR_TABLE[carId].attack, weaponDefOf(weaponId).damage);
}
