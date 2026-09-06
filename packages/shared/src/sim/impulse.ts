import { ramReferenceMass } from "../config/car-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import type { SimBody } from "./step.js";

/**
 * One push, fully resolved — and the ONLY way anything outside the drive model changes a car's
 * velocity.
 *
 * Ram and weapons derive their impulses completely differently: ram grades one from relative
 * closing speed, a side bonus, mass and a falloff stack, while a weapon reads fixed numbers off its
 * own row. Neither of those derivations lives here. What lives here is how an impulse LANDS, which
 * is the only part they share — so ram feel and weapon feel stay independently tunable while a fix
 * to the physics benefits both. See spec principle D.
 */
export interface Impulse {
  /** Unit vector: the direction the victim is pushed. */
  dirX: number;
  dirY: number;
  /** Magnitude as a Δv in u/s, BEFORE the victim's mass is divided out. */
  speed: number;
  /** Torque scale from the lever arm. 0 = a clean punt with no rotation. */
  spin: number;
  /** Does the victim's mass reduce the displacement? */
  massScaled: boolean;
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
 * How far this impulse displaces a car of this mass, relative to an average chassis.
 *
 * The single place victim mass enters the maths. Clamped at both ends so neither the heaviest nor
 * the lightest chassis degenerates — and read through `ramReferenceMass()` rather than recomputed,
 * so playground tuning of `massPerRating` moves it too.
 *
 * `massScaled: false` opts out entirely: the hard slam punts every chassis identically, which is
 * the designer's escape hatch from physics that spec principle C exists to grant.
 */
function massFactorOf(mass: number, massScaled: boolean): number {
  if (!massScaled || mass <= 0) return 1;
  return clamp(ramReferenceMass() / mass, RAM_CONFIG.massFactorMin, RAM_CONFIG.massFactorMax);
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
export function applyImpulse(body: SimBody, mass: number, imp: Impulse): SimBody {
  const dv = imp.speed * massFactorOf(mass, imp.massScaled);

  const vx = body.vx + imp.dirX * dv;
  const vy = body.vy + imp.dirY * dv;

  return { ...body, vx, vy, angVel: nextSpin(body, mass, imp, dv) };
}

/**
 * Torque from a recovered contact point, in the victim's local frame.
 *
 * The 2D cross product of the lever arm with the force is the torque term a real impulse solver
 * would produce, evaluated at one point instead of over a manifold. It behaves correctly by
 * construction rather than by tuning: a dead-centre hit puts lever and force on the same line, so
 * the cross product is zero and there is no spin.
 */
function nextSpin(body: SimBody, mass: number, imp: Impulse, dv: number): number {
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
  const inertia = Math.max(1, mass * RAM_CONFIG.inertiaCoefficient);
  const spin = (torque / inertia) * RAM_CONFIG.spinScale * imp.spin;
  return clamp(body.angVel + spin, -RAM_CONFIG.spinMaxRate, RAM_CONFIG.spinMaxRate);
}

/**
 * The reaction the ATTACKER takes — Newton's third law, and the reason mass finally matters on
 * offence.
 *
 * The impulse is shared but Δv is `J/m`, so a heavy Bastion ramming a light Bullseye barely slows
 * while the reverse bounces the Bullseye off hard. That asymmetry is the whole of it; nothing here
 * is tuned. `SLAM_CONFIG.selfKeepFactor` used to hand-approximate this for slams alone.
 *
 * Carries no uncontrol and no spin: being the attacker is not being rammed, and the attacker's own
 * lever arm is a separate question this design does not answer (spec P16).
 */
export function reactionOf(imp: Impulse): Impulse {
  return { ...imp, dirX: -imp.dirX, dirY: -imp.dirY, spin: 0, uncontrolTicks: 0, massScaled: true };
}
