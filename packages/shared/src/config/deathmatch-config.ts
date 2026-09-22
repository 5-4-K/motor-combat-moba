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
export type DeathmatchConfig = typeof DEATHMATCH_CONFIG;

export const DEATHMATCH_CONFIG = Object.freeze({
  /** Match length. Three minutes keeps a match tight enough to stay urgent end to end. */
  matchSeconds: 180,
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

/** The four deathmatch durations, in the integer ticks the sim actually counts. */
export interface DeathmatchTicks {
  match: number;
  respawnDelay: number;
  phase: number;
  phaseMax: number;
}

/**
 * The same durations in whole ticks — the pattern `WEAPON_TICKS` and `STATUS_PULSE_TICKS` already
 * set. Deriving per use would round the same number in two places.
 */
export function resolveDeathmatchTicks(
  deathmatch: DeathmatchConfig = DEATHMATCH_CONFIG,
): DeathmatchTicks {
  return {
    match: Math.round(deathmatch.matchSeconds * TICK_RATE_HZ),
    respawnDelay: Math.round(deathmatch.respawnDelaySeconds * TICK_RATE_HZ),
    phase: Math.round(deathmatch.phaseSeconds * TICK_RATE_HZ),
    phaseMax: Math.round(deathmatch.phaseMaxSeconds * TICK_RATE_HZ),
  };
}

/** Resolved once at module load, mirroring `WEAPON_TICKS`. */
export const DEATHMATCH_TICKS: DeathmatchTicks = Object.freeze(resolveDeathmatchTicks());
