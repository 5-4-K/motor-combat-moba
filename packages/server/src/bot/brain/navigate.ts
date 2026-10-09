import { wrapAngle } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import { signedDelta } from "./aim.js";
import type { Push } from "./movement.js";
import type { DriveAction } from "./predict.js";

export type Facing = "nose" | "orbit" | "free";

/** What a situation wants (BB22). The navigator reads nothing else. */
export interface Goal {
  x: number;
  y: number;
  /** Distance to hold from the point; 0 means arrive. */
  range: number;
  facing: Facing;
  reverseOk: boolean;
  /** Ram: never lift off (BB25). */
  forwardOnly?: boolean;
}

export interface NavState {
  /** +1 keeps the target on the +angle side, -1 the other; 0 until an orbit begins (BB27). */
  orbitSide: 1 | -1 | 0;
  /** The latched wheel (BB28). */
  steering: -1 | 0 | 1;
  /** Orbit weave hysteresis: set past the inner edge of the band, cleared past the outer edge (BB24). */
  backingOut: boolean;
}

export function newNavState(): NavState {
  return { orbitSide: 0, steering: 0, backingOut: false };
}

function sign(v: number): -1 | 0 | 1 {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/**
 * Hysteresis on the wheel (BB28): start beyond the deadband, stop inside half of it, and between
 * the two keep the wheel only while the error still has the sign it was held for.
 */
function latch(state: NavState, err: number): -1 | 0 | 1 {
  const dead = BRAIN_CONSTANTS.steerDeadbandRad;
  const mag = Math.abs(err);
  if (mag > dead) state.steering = sign(err);
  else if (mag < dead / 2 || sign(err) !== state.steering) state.steering = 0;
  return state.steering;
}

/** The steering law (BB24–BB27): one `Goal` in, one `DriveAction` out, closed-form on the pose. */
export function steerToward(args: {
  self: { x: number; y: number; angle: number };
  goal: Goal;
  aimOffsetRad: number;
  state: NavState;
}): DriveAction {
  const { self, goal, state } = args;
  const c = BRAIN_CONSTANTS;
  const dx = goal.x - self.x;
  const dy = goal.y - self.y;
  const d = Math.hypot(dx, dy);
  const e = d - goal.range;
  const bearing = Math.atan2(dy, dx);
  // A ram (forwardOnly) cannot reverse, so the tail-steer path never runs under it.
  const canReverse = goal.reverseOk && !goal.forwardOnly;
  let delta = signedDelta(self.angle, bearing);
  let desiredOff = 0;
  let throttle: -1 | 0 | 1;

  if (goal.facing === "nose") {
    delta = wrapAngle(delta + args.aimOffsetRad);
    if (e > c.rangeBandUnits) throttle = 1;
    else if (e < -c.rangeBandUnits) throttle = canReverse ? -1 : 0;
    else throttle = 0;
  } else if (goal.facing === "orbit") {
    // A weave: drive in at an angle across the band, back out nose-on, never stop moving (BB24).
    if (state.orbitSide === 0) state.orbitSide = sign(delta) || 1;
    else if (sign(delta) !== state.orbitSide && Math.abs(delta) > Math.PI / 2) state.orbitSide = state.orbitSide === 1 ? -1 : 1;
    if (e < -c.rangeBandUnits) state.backingOut = true;
    else if (e > c.rangeBandUnits) state.backingOut = false;
    if (state.backingOut) throttle = canReverse ? -1 : 0; // nose on, out across the whole band
    else {
      throttle = 1;
      if (e <= c.rangeBandUnits) desiredOff = state.orbitSide * c.orbitOffsetRad; // in, at an angle
    }
  } else {
    if (d <= c.rangeBandUnits) {
      state.steering = 0;
      return { steer: 0, throttle: goal.forwardOnly ? 1 : 0 };
    }
    if (Math.abs(delta) <= Math.PI / 2 || !canReverse) throttle = 1;
    else {
      throttle = -1;
      delta = signedDelta(self.angle + Math.PI, bearing);
    }
  }

  if (goal.forwardOnly) throttle = 1;
  return { steer: latch(state, delta - desiredOff), throttle };
}

/**
 * The reactive wall layer (BB32): steer toward a push's side while driving forward; back up when
 * the wall is dead ahead. Flips the orbit side when the push comes from the orbit's inside (BB27).
 */
export function avoidWalls(
  self: { angle: number }, action: DriveAction, push: Push | undefined, state: NavState,
): DriveAction {
  if (!push || action.throttle !== 1) return action;
  const len = Math.hypot(push.x, push.y);
  if (len === 0) return action;
  const px = push.x / len;
  const py = push.y / len;
  const hx = Math.cos(self.angle);
  const hy = Math.sin(self.angle);
  const dot = hx * px + hy * py;
  if (dot > 0) return action; // the wall is behind; driving forward already leaves it
  const cross = hx * py - hy * px;
  const steer: -1 | 1 = cross >= 0 ? 1 : -1;
  state.steering = steer;
  if (state.orbitSide !== 0 && state.orbitSide !== steer) state.orbitSide = steer;
  if (Math.abs(cross) < 0.3) return { steer, throttle: -1 };
  return { steer, throttle: 1 };
}
