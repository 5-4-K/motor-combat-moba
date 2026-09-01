import { msToTicks } from "./weapon-ticks.js";

/**
 * Aim assist geometry and feel. Every number here is global: a weapon opts in with a boolean
 * (`usesAimAssist`) and inherits all of this (A1).
 *
 * **Why one lock per car and not one per slot.** Per-slot locks with per-weapon cones are more
 * expressive, but cost up to three lock state machines per car, three brackets needing slot tags in
 * the HUD and in spectate, three commit/retention timers driven by a single per-car engagement
 * clock, and three runs of every "release on target death" cleanup path. All three chassis carry
 * exactly one slot today. If a second aim-assist weapon ever needs its own cone, the migration is
 * additive: this block moves onto the weapon def and the lock splits per slot.
 *
 * **What the two region bounds are for.** Neither survives alone in this arena.
 * A pure cone's half-width scales with distance -- at 20 degrees that is 0.36x, so 327 units at
 * magmablast's 900 unit range, a 654 unit wide region inside a 1280 unit wide arena.
 * A pure lateral lane has the mirror-image flaw: its ANGULAR width collapses with distance and
 * explodes near the car, so a 120 unit lane accepts a target 13 units ahead sitting 83 degrees off
 * the nose. Cars still collide and brawl at contact range, so cars spend much of a match at exactly
 * that range, and the lock is ambient -- the trigger cannot override it. Intersected, the cone
 * governs contact range and the cap governs long range, crossing over at `lateralMax / tan(coneDeg)`,
 * about 330 u.
 */
export const AIM_CONFIG = {
  /** Half-angle of the acquisition cone, degrees. Validated strictly inside 0-90. */
  coneDeg: 20,
  /** Maximum perpendicular offset from the car's centreline, world units. */
  lateralMax: 120,
  /**
   * Maximum distance to a lockable target, world units. Deliberately its own number and well below
   * any weapon's `range` (A3).
   *
   * The lock aims where the target IS, with no lead. Displacement during flight is
   * `(targetSpeed / projectileSpeed) * distance`; at mirage's 576 top speed over magmablast's 900
   * that is `0.64 * distance` against a tolerance of about 28 units (half a car's 32 unit width plus
   * magmablast's 12 unit hitbox), so a full-speed crosser is only hittable inside roughly 44 units.
   * Inheriting a 900 unit weapon range would make the far half of every lock acquire reliably and
   * miss reliably -- a strong-looking snap that whiffs, which reads as a broken system rather than
   * as a skill boundary.
   */
  lockRange: 400,

  /**
   * Retention pads. An already-locked target is held while it stays inside every acquisition bound
   * widened by its own pad (A6).
   *
   * All THREE are padded, not just the angle. Padding only the cone -- the natural reading of
   * "retain within cone + 5 degrees" -- does nothing at long range, where the lateral cap is the
   * binding constraint: a target 400 units out crosses the lane edge at 17.5 degrees, nowhere near
   * the 20 degree cone, so it would exit with zero hysteresis and strobe exactly as the pad exists
   * to prevent. Kept small; wider retention starts to feel like an aimbot.
   */
  retentionConeDeg: 5,
  retentionLateralUnits: 30,
  retentionRangeUnits: 60,

  /**
   * The distance term's weight, **per world unit** (A5).
   *
   * The unit matters more than the digit. This game has no metres -- the world is in units and cars
   * are 48 x 32 -- so a coefficient written as 0.4 "per metre" scores a target at 400 units at 160,
   * against an angle term that maxes at 20. The angle becomes noise and the result is "always
   * nearest target", not a scoring system. 0.04 makes the two terms comparable across `lockRange`.
   * This is the lever for how close-range the game feels.
   */
  scorePerDistanceUnit: 0.04,
  /** How much better (lower) a rival's score must be to steal the lock. 0.25 = 25% better. */
  stealMarginFraction: 0.25,

  /** Minimum time on a target before it may be stolen away. */
  commitMs: 400,
  /**
   * How long after the last fire press the lock keeps its INCUMBENCY (A8).
   *
   * Lapsing does not unlock: release and re-acquisition resolve in the same pass, so the bracket
   * never blanks for a frame. What lapses is the steal margin and the commit timer, so the next
   * evaluation simply picks the best-scoring target. That is what splits weapons into two classes --
   * faster than `1000 / lockTimeoutMs` holds locks and the margin governs; slower re-picks the best
   * target every shot. 800 ms puts the cliff at 1.25 Hz, clear of `magmablast`'s 1.67 Hz -- the
   * fastest aim-assisted weapon in the roster today. At the 600 ms this was first drafted at, the
   * cliff sat at 1.67 Hz and the only shipped weapon landed inside the unstable band its own guard
   * test rejects.
   */
  lockTimeoutMs: 800,
  /** How long a target may be out of sight before the lock is released. */
  losGraceMs: 300,
} as const;

/** `AIM_CONFIG`'s three durations, in the integer ticks the sim actually counts. */
export interface AimTicks {
  commit: number;
  lockTimeout: number;
  losGrace: number;
}

/**
 * Derived once at module load and frozen, exactly as `WEAPON_TICKS` is: server and client both
 * import shared's built `dist`, so both compute identical counts or neither does.
 */
export const AIM_TICKS: Readonly<AimTicks> = Object.freeze({
  commit: msToTicks(AIM_CONFIG.commitMs),
  lockTimeout: msToTicks(AIM_CONFIG.lockTimeoutMs),
  losGrace: msToTicks(AIM_CONFIG.losGraceMs),
});
