import type { BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";

/**
 * Signed shortest angle from `from` to `to`, in (-pi, pi].
 *
 * A raw subtraction reads as a near-2*pi turn at the seam, which steers the long way round;
 * `atan2(sin, cos)` wraps it back.
 */
export function signedDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * The bot's current aim error (H44).
 *
 * Held between resamples ON PURPOSE. An error resampled every tick reads as jitter — a machine
 * vibrating — while an error that wanders over `aimErrorDriftTicks` reads as a hand that is not
 * quite on target. The drift is most of what makes the error look human rather than noisy.
 */
export interface AimErrorState {
  offsetRad: number;
  nextResampleTick: number;
}

export function newAimErrorState(): AimErrorState {
  return { offsetRad: 0, nextResampleTick: 0 };
}

/**
 * Advance the aim error. Takes EXACTLY ONE Gaussian sample per call regardless of whether it
 * resamples, so the stream stays aligned across branches (H21).
 *
 * One Gaussian sample is TWO `rng()` calls — `gaussian` is Box-Muller and draws a pair. The count
 * that matters for H21 is that it is the same count on every call, not that it is one; an earlier
 * version of this comment said "exactly one random number", which is wrong in the one file whose
 * subject is how many numbers get drawn.
 */
export function stepAimError(
  state: AimErrorState,
  tick: number,
  profile: BotProfile,
  rng: Rng,
): AimErrorState {
  // Drawn unconditionally, discarded when not resampling: a draw made only on some ticks would make
  // the stream depend on the branch, and two runs of one seed would diverge.
  const sample = gaussian(rng) * profile.aimErrorSigmaRad;
  if (tick < state.nextResampleTick) return state;
  const drift = Math.max(1, profile.aimErrorDriftTicks);
  return { offsetRad: sample, nextResampleTick: tick + drift };
}

/**
 * A standard normal from two uniforms — Box-Muller, one half used.
 *
 * `rng` is the bot's seeded stream (B20); `Math.random` is banned on this path. Two draws every
 * call, always, for the same stream-alignment reason as above.
 */
function gaussian(rng: Rng): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
