import {
  NEUTRAL_MODIFIERS, TICK_RATE_HZ, driveOf, stepDrive, turnRateOf,
  type CarId, type Modifiers, type SimBody,
} from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
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
 * A `SimBody` for the bot's OWN car. The POSE fields — `x`, `y`, `angle`, `speed`, `maneuver` and
 * `maneuverTicksLeft` — come straight off the bot's own HUD and are exact, not inferred. The four
 * ram-state fields (`authority`, `shoveX`, `shoveY`, `reverseHold`) are not on `BotSelfView` at
 * all, so they are assumed neutral here exactly as they are for an observed car in
 * `bodyFromObservation` — this function does not read them off anything.
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
 * Which way a car observed turning at `angVel` rad/s must be HOLDING its wheel (P18).
 *
 * There is nothing to solve for here but a sign and a threshold, because the sim has no partial
 * steer: `stepDrive` reads `-1 | 0 | 1` and nothing else, so a car that is turning under its own
 * input is at FULL lock, and its observed turn rate lands on `turnRateOf(carId)` almost exactly
 * (measured for Mirage: `observedAngVelOf` reads 8.19 against a `turnRateOf` of 8.19). The
 * threshold is `BRAIN_CONSTANTS.fullLockAngVelFraction` of that chassis's own full-lock rate — a
 * half, which sits clear of both cases with room to spare and scales per chassis instead of pinning
 * one absolute rate across a roster whose rates differ by 30%.
 *
 * This is what makes a rollout track a turning car at all. The rate itself cannot be fed into the
 * rollout as a free-running `angVel` and left there: `stepDrive` decays an uncommanded `angVel`
 * toward zero, so an observed turn reproduced that way straightens out over a horizon, while a car
 * that is genuinely steering keeps turning for as long as it holds the wheel. Reconstructing the
 * INPUT is what sustains the arc.
 *
 * Below the threshold the residual is NOT steering — it is the spin a ram injected — and the caller
 * is expected to feed it back as `angVel` instead, where `stepDrive`'s decay is the correct model.
 */
export function steerFromObservedTurn(angVel: number, carId: CarId): -1 | 0 | 1 {
  const threshold = turnRateOf(carId) * BRAIN_CONSTANTS.fullLockAngVelFraction;
  if (Math.abs(angVel) < threshold) return 0;
  return angVel > 0 ? 1 : -1;
}

/**
 * The modifier set an OBSERVATION is rolled under: neutral except that both of the channels that
 * would CHANGE a car's speed under a held throttle are switched off.
 *
 * This is what turns "hold the throttle down" into "hold the SPEED you were seen at". Both
 * production call sites (`physicsPredictor` and `selfPredictor`, built in `controller.ts`'s `plan()`)
 * pass `throttle: 1`, which sends `stepDrive` through `nextSpeed` into `accelerateForward` and
 * nowhere else — never `coast` (drag), never `brakeOrReverse`. `accelerateForward` has exactly two
 * branches, and this set zeroes the one term each one would move the speed by:
 *
 * - **`accel: 0`** covers the ROLLING-FORWARD branch (`speed >= -stopEpsilon`), which adds
 *   `chassis.accel * mods.accel * dt`. Zeroed, the engine contributes nothing and the observed speed
 *   is held.
 * - **`brakeDecel: 0`** covers the ROLLING-BACKWARD branch (`speed < -stopEpsilon`), which is
 *   `Math.min(0, speed + DRIVE_CONFIG.brakeDecel * mods.brakeDecel * dt)` — a held throttle brakes a
 *   reversing car toward a dead stop. Zeroed, a reversing car keeps reversing at the speed it was
 *   seen at. This channel is unreachable here for anything but a car already rolling backward: the
 *   sim reads `mods.brakeDecel` in exactly two places (`sim/drive.ts`), and the other one is inside
 *   `brakeOrReverse`, which only `throttle: -1` can enter — no production predictor passes that.
 *
 * Both are the sim's OWN multiplier channels (`sim/status/modifiers.ts`), so this is a use of
 * `stepDrive`, not a hack around it. Rotation and translation still integrate through the real drive
 * model in both directions.
 *
 * It exists because a bot cannot see another car's throttle. Rolling every observed target with the
 * engine ON assumes each one is flooring it toward its chassis maximum, which systematically
 * OVER-leads; leaving `brakeDecel` live assumes every reversing car is about to stop dead, which
 * systematically UNDER-leads by even more. Measured for a Mirage against an independently integrated
 * ground truth, the error in world units at 20 / 45 / 90 ticks is
 *
 *   | observed speed   | steer | engine on    | `accel: 0` alone | this set | constant velocity |
 *   |------------------|-------|--------------|------------------|----------|-------------------|
 *   | -292.2 (rev cap) | 0     | 292/910/2023 |   173/416/854    |  0/0/0   |     0/  0/   0    |
 *   | -292.2 (rev cap) | 1     | 108/102/ 106 |    45/ 30/ 38    |  0/0/0   |   222/448/ 896    |
 *   | -150             | 0     | 260/759/1658 |    95/220/445    |  0/0/0   |     0/  0/   0    |
 *   | -150             | 1     |  97/ 89/  94 |    19/ 10/ 14    |  0/0/0   |   114/230/ 460    |
 *   | 0 (stunned)      | 0     | 209/584/1258 |     0/  0/  0    |  0/0/0   |     0/  0/   0    |
 *   | 0 (stunned)      | 1     |  81/ 71/  77 |     0/  0/  0    |  0/0/0   |     0/  0/   0    |
 *   | 150              | 1     |  53/ 41/  48 |     0/  0/  0    |  0/0/0   |   114/230/ 460    |
 *   | 250              | 1     |  31/ 21/  27 |     0/  0/  0    |  0/0/0   |   190/384/ 767    |
 *   | 449.5 (top)      | 1     |   0/  0/   0 |     0/  0/  0    |  0/0/0   |   342/690/1379    |
 *
 * The stationary row is the one that motivated `accel: 0`: a target `stunned` by `roadblock`,
 * `thunderclap` or the hard slam carries `fullStop` + `immobilised` and CANNOT move — which is the
 * exact condition `classifySituation` gates `punish` on. An engine-on rollout put the aim point
 * hundreds of units past it, every slot's `value` read ~0 against `targetAt(ahead)`, and
 * `minShotValueFraction` made the bot decline a free shot on a helpless car. This set holds it
 * still, which is what a person sees.
 *
 * The reverse-cap row is the same failure with the sign flipped, and it is LARGER: 416 units short
 * at 45 ticks against the 584 that motivated `accel: 0`, and 854 over the full 90-tick horizon
 * `BRAIN_CONSTANTS.predictionHorizonTicks` actually rolls. It is not an exotic scene —
 * `movement.ts` makes `throttle: -1` routine `fight` behaviour inside the bot's preferred range and
 * `humanize.ts` has a panic-reverse, and `selfPredictor` runs under this same set, so a bot backing
 * off would otherwise predict its OWN `meAt` as nearly stationary and mis-read `danger`.
 *
 * It is also the honest statement of what a human reads off the screen — a speed and a turn, held —
 * and it dominates constant velocity everywhere a car is turning while tying it where one is not.
 */
export const OBSERVATION_MODIFIERS: Readonly<Modifiers> = Object.freeze({
  ...NEUTRAL_MODIFIERS,
  accel: 0,
  brakeDecel: 0,
});

/**
 * Step a body `ticks` times through the REAL drive model, holding one input (P3).
 *
 * `stepDrive` plus `driveOf` — the same pair the sim itself resolves at its single production call
 * site — so a prediction and the thing predicted cannot drift apart through a balance edit.
 * Statuses are not modelled: the bot sees that a car is slowed but has no principled way to know the
 * multiplier, and assuming neutral is the conservative direction.
 *
 * `mods` defaults to `NEUTRAL_MODIFIERS` — a genuine car, engine and all — because a later phase's
 * planner rolls the bot's OWN candidate inputs, where acceleration is exactly the thing being
 * planned. The two OBSERVATION-based predictors below pass `OBSERVATION_MODIFIERS` instead; see its
 * doc comment for why.
 */
export function rollForward(
  body: SimBody,
  carId: CarId,
  input: DriveAction,
  ticks: number,
  mods: Readonly<Modifiers> = NEUTRAL_MODIFIERS,
): SimBody[] {
  const dt = 1 / TICK_RATE_HZ;
  const chassis = driveOf(carId);
  const out: SimBody[] = [];
  let current = body;
  for (let i = 0; i < ticks; i++) {
    current = stepDrive(current, { seq: 0, ...input, fireSlots: 0 }, dt, chassis, mods);
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
    const body = poses[Math.min(Math.max(Math.round(ticksAhead), 1), poses.length) - 1]!;
    return { x: body.x, y: body.y, angle: body.angle };
  };
}

/**
 * A `PosePredictor` backed by real physics — the phase-A replacement for
 * `constantVelocityPredictor` behind the same seam.
 *
 * `estimationSigma` perturbs the OBSERVED speed and turn rate before the rollout runs (P20): reading
 * exact `speed` off another car every tick is the one place a bot sees more precisely than a person,
 * who eyeballs it, and this is the tier knob that answers that. The clamp past the horizon is shared
 * with `selfPredictor` via `clampedPredictor`, so the noise applies only to the rollout's INPUT, never
 * to how a caller's `ticksAhead` is resolved against it.
 *
 * Rolled under `OBSERVATION_MODIFIERS`, so the observed speed is HELD rather than accelerated toward
 * the chassis maximum — see that constant for the measurement.
 */
export function physicsPredictor(
  car: BotCarView,
  angVel: number,
  input: DriveAction,
  horizonTicks: number,
  estimationSigma: number,
  rng: Rng,
): PosePredictor {
  // Drawn unconditionally, and the SAME count regardless of sigma (H21): a draw that happened only
  // when sigma was non-zero would make the stream depend on the tier, and one seed would stop
  // replaying across a profile edit.
  const speedNoise = gaussian(rng) * estimationSigma;
  const turnNoise = gaussian(rng) * estimationSigma;
  const observed: BotCarView = { ...car, speed: car.speed * (1 + speedNoise) };
  const poses = rollForward(
    bodyFromObservation(observed, angVel * (1 + turnNoise)), car.carId, input, horizonTicks,
    OBSERVATION_MODIFIERS,
  );
  return clampedPredictor(poses, { x: car.x, y: car.y, angle: car.angle });
}

/** Box-Muller, one half used. Two draws every call, always — same contract as `aim.ts`'s. */
function gaussian(rng: Rng): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * `physicsPredictor`'s sibling for the bot's OWN car (P17): same rollout, same past-the-horizon
 * clamp, but no estimation noise and no `rng` parameter at all — every field of `self` is on the
 * bot's own HUD, so a bot reads itself exactly. `controller.ts` passes this as the `meAt` argument of
 * `dangerEvAgainst` (`solution.ts`).
 *
 * Also rolled under `OBSERVATION_MODIFIERS`, and for the same reason: a bot reads its own speed off
 * its HUD, not its own future throttle. Predicting itself accelerating to top speed would mis-read
 * its own exposure — it would place itself somewhere it has not decided to go and score the danger
 * of a pose it never holds.
 */
export function selfPredictor(
  self: BotSelfView,
  input: DriveAction,
  horizonTicks: number,
): PosePredictor {
  const poses = rollForward(
    bodyFromSelf(self), self.carId, input, horizonTicks, OBSERVATION_MODIFIERS,
  );
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
