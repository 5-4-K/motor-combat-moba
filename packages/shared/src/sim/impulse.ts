import { inertiaRadiusSquared, RAM_CONFIG } from "../config/ram-config.js";
import { SLAM_CONFIG } from "../config/slam-config.js";
import type { SimBody } from "./step.js";

/**
 * One push, fully resolved.
 *
 * **Its only production caller is the slam path** (`ram-bridge.ts`'s slams loop, assembling
 * `wildcharge`'s `ImpulseDef`). The 2026-09-18 Unity ram port (spec §7.4) took ordinary ramming off
 * it entirely: a ram is no longer a push to be applied but a `RamResolution` the bridge writes onto
 * both cars directly, because Unity's "set, don't add" semantics — the attacker stops dead, the
 * victim's velocity is replaced on a head-on — cannot be said in a struct whose whole meaning is
 * "add this to what you had".
 *
 * That leaves this file describing one derivation rather than reconciling two. A weapon reads fixed
 * numbers off its own row; what lives here is how those numbers LAND. See spec principle D.
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
   * Does the victim's `ramDefence` reduce the displacement? Renamed from `massScaled` by the
   * 2026-09-06 car-physics rework's stage 3 (name-only at first — the divisor was still literally
   * MASS at that point), which then made the divisor `ramDefence` (`defenceFactorOf`, below) so the
   * name finally matches the maths.
   *
   * `wildcharge`'s slam — the one production impulse left — authors it `false`, which is principle
   * C's escape hatch: a hard slam punts every chassis identically. So `true` is reachable only
   * through this file's own tests today. It stays in the type because it is the `ImpulseDef` seam's
   * knob, not because something currently turns it on.
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
  // assignment, so a slam used to zero out a spinning victim outright. A non-zero spin likewise
  // accumulates rather than replaces below (`clamp(body.angVel + spin, ...)`), so a car already
  // spinning from an earlier hit keeps that spin on top of whatever a fresh impulse adds. Both were
  // adopted when every push routed through one shared applier; the Unity ram port took ordinary rams
  // off this path, so both now describe the slam alone. See `impulse.test.ts`'s
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
  // The divisor is `ramDefence` (30-90) rather than the `mass` (300-900) it was until the 2026-09-06
  // car-physics rework's stage 3 — a ~10x smaller denominator, which briefly left an impulse
  // saturating `RAM_CONFIG.spinMaxRate` outright. That was fixed in the CONFIG, not here: that
  // rework's stage 3 re-pitched the scale 100 -> 12.5 by measurement (spec P25b). No compensating
  // factor belongs in this function — the equation is the physics and the constants are the balance,
  // and blending the two is what makes a "spin feels wrong" report unanswerable.
  //
  // Two of those constants moved under this line in the 2026-09-18 Unity ram port and neither moved
  // its VALUE. `inertiaRadiusSquared()` is `RAM_CONFIG.inertiaCoefficient` derived from the hull
  // rather than authored beside it (spec U29): the deleted constant was literally
  // `(carWidth² + carHeight²) / 12`, so this is a rename. `SLAM_CONFIG.spinScale` is
  // `RAM_CONFIG.spinScale`'s shipped 12.5, moved because the ram's knob was re-pitched to 0.3 for a
  // DIFFERENT formula shape — the ram divides by the inertia term alone, this divides by
  // `ramDefence` times it — and leaving the slam on it would have cut `wildcharge`'s spin 41x
  // without anyone authoring that. See `SLAM_CONFIG.spinScale`'s own comment.
  const inertia = Math.max(1, ramDefence * inertiaRadiusSquared());
  const spin = (torque / inertia) * SLAM_CONFIG.spinScale * imp.spin;
  return clamp(body.angVel + spin, -RAM_CONFIG.spinMaxRate, RAM_CONFIG.spinMaxRate);
}
