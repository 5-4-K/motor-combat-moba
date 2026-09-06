import { RAM_CONFIG } from "../config/ram-config.js";
import type { SimBody } from "./step.js";

/**
 * One push, fully resolved — and the ONLY way anything outside the drive model changes a car's
 * velocity.
 *
 * Ram and weapons derive their impulses completely differently: since stage 3 Task 2 (the ram
 * contest, spec R2-R7), ram grades one from a contest between both cars' `ramAttack`/`ramDefence` —
 * each car's own drive-in plus a defence term, shared out and adjusted for the struck face
 * (`sim/ram.ts`'s `pushOf`/`impactOn`) — while a weapon reads fixed numbers off its own row. Neither
 * of those derivations lives here. What lives here is how an impulse LANDS, which is the only part
 * they share — so ram feel and weapon feel stay independently tunable while a fix to the physics
 * benefits both. See spec principle D.
 */
export interface Impulse {
  /** Unit vector: the direction the victim is pushed. */
  dirX: number;
  dirY: number;
  /** Magnitude as a Δv in u/s, BEFORE the victim's `ramDefence` is divided out. */
  speed: number;
  /** Torque scale from the lever arm. 0 = a clean punt with no rotation. */
  spin: number;
  /**
   * Does the victim's `ramDefence` reduce the displacement? Renamed from `massScaled` in Task 2
   * (name-only then — the divisor was still literally MASS at that point); Task 3 is what makes the
   * divisor `ramDefence` (`defenceFactorOf`, below) so the name finally matches the maths. The
   * contest's own ram/slam impulses always author this `false` regardless (`impactOn` in `ram.ts`
   * already divided by the victim's `ramDefence` itself, so a second division here would double-charge
   * it); `true` is reachable only through this file's own tests today, now that Task 3 deletes
   * `reactionOf` — the one production path that used to force it.
   */
  defenceScaled: boolean;
  /** How long the victim is left reeling, in TICKS (already converted). */
  uncontrolTicks: number;
  /** World-space contact point, for the lever arm. */
  contactX: number;
  contactY: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * How far this impulse displaces a car of this solidity.
 *
 * The single place `ramDefence` divides a push out. `defenceScaled: false` opts out entirely: a hard
 * slam punts every chassis identically, which is the designer's escape hatch spec principle C grants
 * (R10).
 *
 * There are no clamps here. `massFactorMin`/`massFactorMax` are deleted (spec P19): they existed to
 * stop a mass ratio degenerating, and both roster extremes clipped against them anyway, so part of
 * what the stat did was being discarded.
 */
function defenceFactorOf(ramDefence: number, defenceScaled: boolean): number {
  if (!defenceScaled || ramDefence <= 0) return 1;
  return 1 / ramDefence;
}

/**
 * Apply one impulse to one body: velocity and spin only.
 *
 * Deliberately does NOT apply the `reeling` status. A status is not `SimBody` state, and this
 * function is pure sim maths shared by both halves of the lockstep; the caller reads
 * `imp.uncontrolTicks` and applies the status server-side.
 *
 * The victim's forward momentum is robbed for free: whatever component of `dir` opposes the
 * victim's heading reduces its forward speed by ordinary vector addition, and whatever is
 * perpendicular becomes the slide. Only a perfectly perpendicular hit leaves forward speed
 * untouched, which is correct.
 */
export function applyImpulse(body: SimBody, ramDefence: number, imp: Impulse): SimBody {
  const dv = imp.speed * defenceFactorOf(ramDefence, imp.defenceScaled);

  const vx = body.vx + imp.dirX * dv;
  const vy = body.vy + imp.dirY * dv;

  return { ...body, vx, vy, angVel: nextSpin(body, ramDefence, imp, dv) };
}

/**
 * Torque from a recovered contact point, in the victim's local frame.
 *
 * The 2D cross product of the lever arm with the force is the torque term a real impulse solver
 * would produce, evaluated at one point instead of over a manifold. It behaves correctly by
 * construction rather than by tuning: a dead-centre hit puts lever and force on the same line, so
 * the cross product is zero and there is no spin.
 */
function nextSpin(body: SimBody, ramDefence: number, imp: Impulse, dv: number): number {
  // A zero-spin impulse PRESERVES the victim's existing rotation rather than cancelling it — this is
  // an early return, not an assignment to 0. That is a deliberate change from the pre-`Impulse` slam
  // path, which did `player.angVel = knock.angVel` with `knock.angVel === 0` for a slam: an
  // assignment, so a slam used to zero out a spinning victim outright. Ordinary-ram spin likewise
  // changed from replace to accumulate below (`clamp(body.angVel + spin, ...)`), so a car already
  // spinning from an earlier hit keeps that spin on top of whatever a fresh impulse adds. Both follow
  // from routing every push through one shared applier; see `impulse.test.ts`'s
  // `"preserves the victim's existing spin when the impulse asks for none"`.
  if (imp.spin === 0) return body.angVel;

  const cos = Math.cos(-body.angle);
  const sin = Math.sin(-body.angle);
  const dx = imp.contactX - body.x;
  const dy = imp.contactY - body.y;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  const fx = (imp.dirX * cos - imp.dirY * sin) * dv;
  const fy = (imp.dirX * sin + imp.dirY * cos) * dv;

  const torque = rx * fy - ry * fx;
  // The divisor is `ramDefence` (30-90) rather than the `mass` (300-900) it was until stage 3 Task 3
  // — a ~10x smaller denominator, which briefly left an ordinary flank ram saturating
  // `RAM_CONFIG.spinMaxRate` outright. That is fixed in the CONFIG, not here: stage 3 Task 4
  // re-pitched `spinScale` 100 -> 10 by measurement (spec P25b), and the hardest ram the roster can
  // produce now measures 5.95 rad/s against the 6.0 ceiling. No compensating factor belongs in this
  // function — the equation is the physics and the constants are the balance, and blending the two
  // is what makes a "spin feels wrong" report unanswerable.
  const inertia = Math.max(1, ramDefence * RAM_CONFIG.inertiaCoefficient);
  const spin = (torque / inertia) * RAM_CONFIG.spinScale * imp.spin;
  return clamp(body.angVel + spin, -RAM_CONFIG.spinMaxRate, RAM_CONFIG.spinMaxRate);
}
