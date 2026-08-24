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
