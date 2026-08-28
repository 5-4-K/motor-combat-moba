export const COMBAT_CONFIG = {
  /** Hull HP per point of the `hp` rating. Ratings are 0-100, so hull HP runs 0-1000. */
  hpPerRating: 10,
  /**
   * The `attack` rating an "average" chassis carries, and the pivot `damageFor` measures from. A car
   * at exactly this rating deals a weapon's `damage` verbatim — which is what makes the number in
   * `WEAPON_TABLE` readable as damage rather than as an opaque base.
   */
  attackBaseline: 50,
  /**
   * Fractional damage change per point of `attack` away from `attackBaseline`. At 0.01 the full
   * 0-100 rating range spans 0.5x to 1.5x.
   *
   * Multiplicative, not additive, and that is load-bearing: a FLAT bonus would be collected once per
   * shot and so pay out in proportion to fire rate, quietly making `attack` a fire-rate stat — a
   * three-stock weapon like `splinter` would bank it three times per volley. A percentage gives a
   * fast weapon and a slow weapon the same proportional gain, so `attack` means the same thing
   * whatever is in the slot.
   */
  damagePerAttack: 0.01,
} as const;
