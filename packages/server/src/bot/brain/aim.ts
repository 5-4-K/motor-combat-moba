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
 * Advance the aim error. Draws EXACTLY ONE random number per call regardless of whether it
 * resamples, so the stream stays aligned across branches (H21).
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

export interface LeadTarget {
  x: number;
  y: number;
  speed: number;
  angle: number;
}

/**
 * Where to aim so a shot of `projectileSpeed` meets a target moving at its current velocity (H44).
 *
 * `leadFactor` is the FRACTION of the correct lead the bot actually applies: 0 shoots at where the
 * target is now (a beginner), 1 solves the intercept (UT's "Adept" gate). It is the largest single
 * skill gap on this roster — cars top out at 320-450 u/s while `magmablast` flies at 600 and
 * `thumper` at 450, so a bot that does not lead cannot hit a moving Mirage with either.
 *
 * Falls back to the target's own position when no intercept exists — a shot slower than its target,
 * or a `speed: 0` maneuver row — rather than returning a point behind the shooter.
 */
export function interceptPoint(
  from: { x: number; y: number },
  target: LeadTarget,
  projectileSpeed: number,
  leadFactor: number,
): { x: number; y: number } {
  const here = { x: target.x, y: target.y };
  if (leadFactor <= 0 || projectileSpeed <= 0 || target.speed === 0) return here;

  const vx = Math.cos(target.angle) * target.speed;
  const vy = Math.sin(target.angle) * target.speed;
  const rx = target.x - from.x;
  const ry = target.y - from.y;

  // |r + v*t| = s*t  ->  (v.v - s^2) t^2 + 2 (r.v) t + r.r = 0
  const a = vx * vx + vy * vy - projectileSpeed * projectileSpeed;
  const b = 2 * (rx * vx + ry * vy);
  const c = rx * rx + ry * ry;

  let t: number;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-6) return here;
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return here;
    const root = Math.sqrt(disc);
    const t1 = (-b - root) / (2 * a);
    const t2 = (-b + root) / (2 * a);
    const positives = [t1, t2].filter((v) => v > 0);
    if (positives.length === 0) return here;
    t = Math.min(...positives);
  }
  if (!Number.isFinite(t) || t <= 0) return here;

  return { x: target.x + vx * t * leadFactor, y: target.y + vy * t * leadFactor };
}
