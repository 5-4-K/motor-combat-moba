import { TICK_RATE_HZ } from "../constants.js";

/**
 * The wall spikes: how much they hurt, and what it takes to make them hurt again (AS14–AS18).
 *
 * `depth` is geometry, not balance — it must match the strips `ARENA_01` authors, and
 * `arena-01.test.ts` fails if it drifts.
 */
export const SPIKE_CONFIG = {
  /** Flat, per trigger. Between a Thumper shell (60) and a Roadblock (100); nine kill a Bullseye. */
  damage: 80,
  /** How far a strip protrudes from its wall, in world units. */
  depth: 20,
  /**
   * The speed INTO the surface below which nothing happens, in units/s. Deliberately low against
   * roster top speeds of 190-267: this is the line between "resting against a wall" and "moving
   * into it", not a difficulty dial. Without it, a car parked in a notch would bleed forever.
   */
  triggerSpeed: 25,
  /**
   * How long a car is immune after a hit. Without it a shoved car takes `damage` every tick —
   * thirty times a second. At 750ms this is ~107 HP/s while pinned, so roughly six seconds of
   * sustained pressure kills a Bullseye. Expect playtest to move it.
   */
  retriggerMs: 750,
  /**
   * How long after being rammed or slammed a car's death still credits the pusher (AS21). Past it,
   * a spike death credits nobody.
   */
  shoverCreditMs: 4000,
  /** Contact slack for the overlap test, matching the scale of `RAM_CONFIG.contactPad`. */
  contactPad: 2,
} as const;

/**
 * The millisecond knobs above in ticks, converted ONCE. `Math.ceil` so a window is never short by a
 * rounding — an immunity that expires a tick early is a double hit.
 */
export const SPIKE_TICKS = {
  retrigger: Math.ceil((SPIKE_CONFIG.retriggerMs / 1000) * TICK_RATE_HZ),
  shoverCredit: Math.ceil((SPIKE_CONFIG.shoverCreditMs / 1000) * TICK_RATE_HZ),
} as const;
