import {
  NEUTRAL_MODIFIERS, TICK_RATE_HZ, driveOf, stepDrive,
  type CarId, type SimBody,
} from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import type { BotCarView, BotSelfView } from "../types.js";
import type { PosePredictor } from "./solution.js";

/** The two axes a rollout candidate varies. Matches `InputMessage`'s complete action space. */
export interface DriveAction {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
}

/**
 * A `SimBody` for ANOTHER car, from what a bot may legitimately see (P17, P5).
 *
 * `x`, `y`, `angle`, `speed` and `maneuver` are drawn on screen and come straight off `BotCarView`.
 * `angVel` is INFERRED from two observed poses. `authority`, `shoveX/Y` and `reverseHold` are not
 * numbers a human reads at all, so they are assumed neutral.
 *
 * `maneuverTicksLeft: 0` means `isDashing(body)` (`maneuver === ManeuverKind.DASH &&
 * maneuverTicksLeft > 0`) is always false here, so `maneuverAngle` is never actually read by
 * `stepDrive` for an observation — `car.angle` is filled in only to satisfy `SimBody`'s shape, not
 * because it is a meaningful guess at the observed car's dash heading.
 *
 * That last assumption is reliably WRONG for a few hundred milliseconds after a ram (P19), when
 * authority is suppressed and shove is still decaying. Bots therefore mispredict cars that have just
 * been hit — which is what a person does too, and is kept rather than corrected.
 */
export function bodyFromObservation(car: BotCarView, angVel: number): SimBody {
  return {
    x: car.x, y: car.y, angle: car.angle, speed: car.speed,
    reverseHold: 0,
    angVel,
    shoveX: 0, shoveY: 0,
    authority: 1,
    maneuver: car.maneuver,
    maneuverTicksLeft: 0,
    maneuverAngle: car.angle,
    maneuverSpeed: 0,
  };
}

/**
 * A `SimBody` for the bot's OWN car. Every field here is on its own HUD, so none is inferred.
 *
 * `maneuverSpeed: 0` mirrors `bodyFromObservation`: even though `self.maneuverTicksLeft` can be
 * genuinely positive (this bot mid-dash), nothing in the bot brain reads a dash's actual travel
 * speed today, so the rollout does not model one. `maneuverAngle` is `self.angle` for the same
 * reason as above — inert whenever `maneuverTicksLeft` is 0, and not a claim of precision when it
 * is not.
 */
export function bodyFromSelf(self: BotSelfView): SimBody {
  return {
    x: self.x, y: self.y, angle: self.angle, speed: self.speed,
    reverseHold: 0,
    angVel: 0,
    shoveX: 0, shoveY: 0,
    authority: 1,
    maneuver: self.maneuver,
    maneuverTicksLeft: self.maneuverTicksLeft,
    maneuverAngle: self.angle,
    maneuverSpeed: 0,
  };
}

/**
 * Step a body `ticks` times through the REAL drive model, holding one input (P3).
 *
 * `stepDrive` plus `driveOf` — the same pair the sim itself resolves at its single production call
 * site — so a prediction and the thing predicted cannot drift apart through a balance edit.
 * Statuses are not modelled: the bot sees that a car is slowed but has no principled way to know the
 * multiplier, and assuming neutral is the conservative direction.
 */
export function rollForward(
  body: SimBody,
  carId: CarId,
  input: DriveAction,
  ticks: number,
): SimBody[] {
  const dt = 1 / TICK_RATE_HZ;
  const chassis = driveOf(carId);
  const out: SimBody[] = [];
  let current = body;
  for (let i = 0; i < ticks; i++) {
    current = stepDrive(current, { seq: 0, ...input, fireSlots: 0 }, dt, chassis, NEUTRAL_MODIFIERS);
    out.push(current);
  }
  return out;
}

/**
 * Shared by `physicsPredictor` and `selfPredictor`: clamp past the horizon rather than
 * extrapolating — a caller asking beyond what was rolled gets the last real pose, never a straight
 * line grafted onto a curve.
 */
function clampedPredictor(
  poses: readonly SimBody[],
  fallback: { x: number; y: number; angle: number },
): PosePredictor {
  return (ticksAhead) => {
    if (ticksAhead <= 0 || poses.length === 0) {
      return fallback;
    }
    const body = poses[Math.min(Math.round(ticksAhead), poses.length) - 1]!;
    return { x: body.x, y: body.y, angle: body.angle };
  };
}

/**
 * A `PosePredictor` backed by real physics — the phase-A replacement for
 * `constantVelocityPredictor` behind the same seam.
 */
export function physicsPredictor(
  car: BotCarView,
  angVel: number,
  input: DriveAction,
  horizonTicks: number,
): PosePredictor {
  const poses = rollForward(bodyFromObservation(car, angVel), car.carId, input, horizonTicks);
  return clampedPredictor(poses, { x: car.x, y: car.y, angle: car.angle });
}

/**
 * `physicsPredictor`'s sibling for the bot's OWN car (P17): same rollout, same past-the-horizon
 * clamp, but no estimation noise and no `rng` parameter at all — every field of `self` is on the
 * bot's own HUD, so a bot reads itself exactly. A later task passes this as the `meAt` argument of
 * `dangerEvAgainst` (`solution.ts`).
 */
export function selfPredictor(
  self: BotSelfView,
  input: DriveAction,
  horizonTicks: number,
): PosePredictor {
  const poses = rollForward(bodyFromSelf(self), self.carId, input, horizonTicks);
  return clampedPredictor(poses, { x: self.x, y: self.y, angle: self.angle });
}

/**
 * How many ticks ahead to aim a shot of speed `projectileSpeed`, against a target following the
 * (possibly curving) path `at`. The physics analogue of `aim.ts`'s closed-form `interceptPoint`,
 * which solves the same problem in one shot but only against a straight line — a `PosePredictor`
 * backed by real physics has no closed form, so this converges it instead with fixed-point
 * iteration: guess a time, see where the target is then, refine the guess from that distance, repeat.
 *
 * `BRAIN_CONSTANTS.interceptFixedPointRounds` rounds, not a loop to a tolerance — the solver may
 * draw no `rng()` calls and must do bounded, predictable work every tick (H21).
 */
export function interceptTicks(
  from: { x: number; y: number },
  at: PosePredictor,
  projectileSpeed: number,
  maxTicks: number,
): number {
  if (projectileSpeed <= 0) return 0;
  let t = 0;
  for (let round = 0; round < BRAIN_CONSTANTS.interceptFixedPointRounds; round++) {
    const p = at(t);
    const distance = Math.hypot(p.x - from.x, p.y - from.y);
    t = Math.min(maxTicks, Math.max(0, Math.round((distance / projectileSpeed) * TICK_RATE_HZ)));
  }
  return t;
}
