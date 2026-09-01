import { TICK_RATE_HZ } from "../constants.js";

/**
 * Deathmatch tuning (M28). Every number here is read by the room and by the client's HUD, so this is
 * networked balance rather than render preference — the same standing as `STATUS_CONFIG`.
 *
 * All four are first-pass values meant to be re-tuned from play, not defended.
 *
 * They sequence deliberately: 3 s of "[name] killed you", then 2 s of respawn countdown, then a
 * return to the field with 1.5 s of protection.
 */
export const DEATHMATCH_CONFIG = Object.freeze({
  /** Match length. Five minutes is long enough for the lead to change hands more than once. */
  matchSeconds: 300,
  /**
   * How long a wreck waits. Long enough to sting, short enough that a death is a setback rather than
   * the spectate sentence Last Standing hands out.
   */
  respawnDelaySeconds: 5,
  /**
   * The MINIMUM spawn-protection window. Not a fixed duration: the phase also has to wait until the
   * car is clear of everyone, so this is a floor and `phaseMaxSeconds` is the ceiling (M23).
   */
  phaseSeconds: 1.5,
  /**
   * The hard cap on protection, past which the car becomes solid whatever it is overlapping.
   *
   * Belt-and-braces rather than load-bearing: parking on a phased car to hold it intangible is weak
   * griefing, because the attacker cannot damage it and is only delaying their own shot.
   */
  phaseMaxSeconds: 3,
} as const);

/**
 * The same durations in whole ticks, derived once and frozen — the pattern `WEAPON_TICKS` and
 * `STATUS_PULSE_TICKS` already set. Deriving per use would round the same number in two places.
 */
export const DEATHMATCH_TICKS = Object.freeze({
  match: Math.round(DEATHMATCH_CONFIG.matchSeconds * TICK_RATE_HZ),
  respawnDelay: Math.round(DEATHMATCH_CONFIG.respawnDelaySeconds * TICK_RATE_HZ),
  phase: Math.round(DEATHMATCH_CONFIG.phaseSeconds * TICK_RATE_HZ),
  phaseMax: Math.round(DEATHMATCH_CONFIG.phaseMaxSeconds * TICK_RATE_HZ),
});
