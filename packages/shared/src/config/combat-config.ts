export const COMBAT_CONFIG = {
  hpPerRating: 10,
  collisionDamagePerStrength: 1,
  ramDotThreshold: 0.5,
  collisionDamageCooldownTicks: 15,
  /**
   * How many world units each car hull is inflated by when testing for a **ram** contact.
   *
   * A ram has to be detected as contact, not as interpenetration. Collision resolution runs before
   * combat and pushes a car out to *exactly* the separation boundary, so two cars that just crashed
   * end the tick touching at a measured gap of 0 — a strict overlap test is false on every single
   * tick of a real ram, and ramming would silently never deal damage.
   *
   * This is the tolerance that turns "touching" into "in contact". It is kept small: the cars
   * rebound to a 2-8 unit gap on the ticks after impact, and a pad large enough to reach those
   * would deal damage for near-misses.
   */
  ramContactPad: 1,
} as const;
