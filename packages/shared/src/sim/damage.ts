import { CAR_TABLE } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { weaponDefOf } from "../config/weapon-config.js";
import type { CarId } from "../config/types.js";
import type { WeaponId } from "../config/weapon-types.js";

/**
 * The only place hp is ever reduced. Every damage source — projectiles, anything a later balance
 * pass adds — routes through here, so a buff, a shield, or a damage cap is one edit rather than a
 * hunt through the tick. Nothing else may subtract from `PlayerState.hp`.
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
  // `damagePerAttack` (0.01) is not exactly representable in IEEE-754, so the accumulated error can
  // push the product just under a .5 boundary at some ratings, rounding down where exact
  // percentage arithmetic rounds up. Normalising through a fixed-precision string before rounding
  // removes that error; see damage.test.ts's exactness sweep.
  return Math.max(0, Math.round(Number((weaponDamage * scale).toFixed(6))));
}

/** `damageFor` with both lookups done: what this chassis deals with this weapon. */
export function weaponDamageOf(carId: CarId, weaponId: WeaponId): number {
  return damageFor(CAR_TABLE[carId].attack, weaponDefOf(weaponId).damage);
}

/**
 * `amount` seen through one buff/debuff channel — `damageDealt` on the way out, `damageTaken` on
 * the way in. The only place an effect is ever allowed to change a hit's size.
 *
 * Rounded to a whole number here, exactly as `damageFor` is and for the same reason: an integer must
 * reach `applyDamage`, so a piercing shot deals the identical number to every car it passes through
 * and the HUD never shows a fractional hp. The fixed-precision normalisation is `damageFor`'s too —
 * multipliers like 1.3 are not exactly representable, and without it a product landing a hair under
 * a .5 boundary rounds the wrong way at some magnitudes.
 *
 * A non-finite or negative multiplier is ignored rather than obeyed: a bad config number should cost
 * a buff its effect, never turn a weapon into a repair kit or NaN a car's hp. `applyDamage` refuses
 * negatives downstream as well, so this is the belt to its braces.
 */
export function scaleDamage(amount: number, multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier < 0) return amount;
  return Math.max(0, Math.round(Number((amount * multiplier).toFixed(6))));
}
