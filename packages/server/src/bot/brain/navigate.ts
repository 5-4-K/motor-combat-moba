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
}

export function newNavState(): NavState {
  return { orbitSide: 0, steering: 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function sign(v: number): -1 | 0 | 1 {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Hysteresis on the wheel: start beyond the deadband, stop inside half of it (BB28). */
function latch(state: NavState, err: number): -1 | 0 | 1 {
  const dead = BRAIN_CONSTANTS.steerDeadbandRad;
  if (Math.abs(err) > dead) state.steering = sign(err);
  else if (Math.abs(err) < dead / 2) state.steering = 0;
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
  let delta = signedDelta(self.angle, bearing);
  let desiredOff = 0;
  let throttle: -1 | 0 | 1;

  if (goal.facing === "nose") {
    delta = wrapAngle(delta + args.aimOffsetRad);
    if (e > c.rangeBandUnits) throttle = 1;
    else if (e < -c.rangeBandUnits) {
      if (goal.reverseOk) throttle = -1;
      else {
        throttle = 1;
        if (state.orbitSide === 0) state.orbitSide = sign(delta) || 1;
        desiredOff = state.orbitSide * 2 * c.orbitOffsetRad;
      }
    } else throttle = 0;
  } else if (goal.facing === "orbit") {
    throttle = 1;
    if (state.orbitSide === 0) state.orbitSide = sign(delta) || 1;
    else if (sign(delta) !== state.orbitSide && Math.abs(delta) > Math.PI / 2) state.orbitSide = state.orbitSide === 1 ? -1 : 1;
    const k = clamp(e / c.rangeBandUnits, -1, 1);
    desiredOff = state.orbitSide * c.orbitOffsetRad * (1 - k);
  } else {
    if (d <= c.rangeBandUnits) {
      state.steering = 0;
      return { steer: 0, throttle: goal.forwardOnly ? 1 : 0 };
    }
    if (Math.abs(delta) <= Math.PI / 2 || !goal.reverseOk) throttle = 1;
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
