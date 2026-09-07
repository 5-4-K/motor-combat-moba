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
 * `maneuverTicksLeft: 0` mirrors `bodyFromObservation`, and is a DELIBERATE discard of a field the
 * bot really does know. Copying a genuine `self.maneuverTicksLeft` while fabricating
 * `maneuverSpeed: 0` sent `stepDrive` down its `stepDash` branch with a zero travel speed, so
 * `dashTranslation` returned `{0, 0}` and the bot predicted itself PARKED for the rest of the dash
 * — 8 ticks and roughly 400 units of real travel for `thunderclap` — and then had `stepDash`'s
 * `done` branch write `chassis.maxSpeed * mods.topSpeed` straight into its speed. "I keep driving at
 * the speed I am going" is less wrong than "I stop dead and then teleport to top speed", and it is
 * the same claim `selfPredictor`'s doc makes. Zeroing it also makes `isDashing(body)` false on every
 * predictor body, which is what lets `OBSERVATION_MODIFIERS` raise `topSpeed` safely — see there.
 *
 * `maneuverAngle` is `self.angle` for the same reason as above: inert whenever `maneuverTicksLeft`
 * is 0, which is now always, and filled in only to satisfy `SimBody`'s shape.
 */
export function bodyFromSelf(self: BotSelfView): SimBody {
  return {
    x: self.x, y: self.y, angle: self.angle, speed: self.speed,
    reverseHold: 0,
    angVel: 0,
    shoveX: 0, shoveY: 0,
    authority: 1,
    maneuver: self.maneuver,
    maneuverTicksLeft: 0,
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
 * The modifier set an OBSERVATION is rolled under: neutral except for the THREE channels that would
 * change a car's speed under a held throttle — two switched off, one lifted out of the way.
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
 * - **`topSpeed: BRAIN_CONSTANTS.observationTopSpeedHeadroom`** covers the CLAMP the rolling-forward
 *   branch applies alongside its (now zeroed) engine term: `Math.min(chassis.maxSpeed *
 *   mods.topSpeed, ...)`. Left at 1 it clipped any observed-plus-noise speed above the chassis cap
 *   on the rollout's very first tick — and a car flooring it sits EXACTLY at that cap, which is most
 *   of `fight` and `close`. Measured for Mirage at its 449.5 u/s cap over 45 ticks, a `+25%`
 *   estimation error moved the prediction by 0.00 units and a `+50%` by 0.00, against 168.56 for the
 *   equal `-25%`: at the most common speed in the game `stateEstimationSigma` lost half its range
 *   and every tier was biased toward UNDER-leading. With `accel: 0` this channel can never RAISE a
 *   speed — it is only ever a ceiling, and `reverseFurther`'s use of it needs `throttle: -1` — so
 *   lifting the ceiling out of reach is the only thing it can do, and it restores the symmetry the
 *   set claims. The one other read of `mods.topSpeed` in `sim/drive.ts` is `stepDash`'s exit-speed
 *   handoff, which needs `isDashing(body)`; both `bodyFromObservation` and `bodyFromSelf` pin
 *   `maneuverTicksLeft: 0` and `stepDrive` never re-enters a DASH, so no predictor body can reach it.
 *
 * All three are the sim's OWN multiplier channels (`sim/status/modifiers.ts`), so this is a use of
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
  topSpeed: BRAIN_CONSTANTS.observationTopSpeedHeadroom,
});

/**
 * Step a body `ticks` times through the REAL drive model, holding one input (P3).
 *
 * `stepDrive` plus `driveOf` — the same pair the sim itself resolves at its single production call
 * site — so a prediction and the thing predicted cannot drift apart through a balance edit.
 * Statuses are not modelled: the bot sees that a car is slowed but has no principled way to know the
 * multiplier, and assuming neutral is the conservative direction.
 *
 * `mods` is REQUIRED and deliberately has no default. `NEUTRAL_MODIFIERS` — a genuine car, engine and
 * all — is the right set for a later phase's planner rolling the bot's OWN candidate inputs, where
 * acceleration is exactly the thing being planned, and it is the WRONG set for an observation: two
 * review rounds were spent proving that (see `OBSERVATION_MODIFIERS`, which both production
 * predictors below pass). A default that is correct only for a caller that does not exist yet is a
 * trap, so the compiler asks every call site to choose instead.
 */
export function rollForward(
  body: SimBody,
  carId: CarId,
  input: DriveAction,
  ticks: number,
  mods: Readonly<Modifiers>,
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
 * The steer is DERIVED here, from the noised turn rate, rather than supplied by the caller — which is
 * what makes the turn half of `estimationSigma` reach anything at all. Reconstructing the steer from
 * the raw observation (as `controller.ts` did until the final review's finding 1) let every tier read
 * a curve perfectly and then applied `turnNoise` only to the residual spin, which a steering car has
 * none of: an easy bot read a corner exactly as well as a hard one, and the knob delivered only its
 * speed half. Derived from the noised rate, a sloppy read can misjudge WHETHER a car is steering at
 * all and, near `steerFromObservedTurn`'s threshold, WHICH WAY.
 *
 * THE OBSERVED TURN IS ATTRIBUTED TO EXACTLY ONE CAUSE. Above the threshold the car reads as
 * STEERING, and the rollout sustains that turn for as long as the input is held (`stepDrive` adds a
 * held steer's rotation every tick). Below it, the residual stays a ram's injected spin and decays on
 * the ram half-life. A car spinning from a ram therefore reads as one that meant to turn, and is
 * mispredicted — the design's sanctioned human error (spec P19), kept, not corrected.
 *
 * `throttle: 1` is fixed rather than a parameter: every observation rollout holds it, which is the
 * whole premise `OBSERVATION_MODIFIERS` is built around — the throttle keeps `stepDrive` out of
 * `coast` (drag, which BRAKES: 900 u/s^2, a Mirage seen at 400 u/s covers 82 units in 20 ticks
 * against the ~400 it really travels) while the zeroed `accel` channel keeps it from adding engine.
 * Rolled under that set, so the observed speed is HELD rather than accelerated toward the chassis
 * maximum — see that constant for the measurement.
 */
export function physicsPredictor(
  car: BotCarView,
  angVel: number,
  horizonTicks: number,
  estimationSigma: number,
  rng: Rng,
): PosePredictor {
  // Drawn unconditionally, FIRST, and the SAME count regardless of sigma or of anything derived
  // below (H21): a draw that happened only when sigma was non-zero, or that moved because the steer
  // reconstruction took a different branch, would make the stream depend on the tier or the scene
  // and one seed would stop replaying. Four `rng()` calls — `gaussian` is Box-Muller and draws a
  // PAIR each time. Everything after this line is pure arithmetic over already-drawn values.
  const speedNoise = gaussian(rng) * estimationSigma;
  const turnNoise = gaussian(rng) * estimationSigma;
  const noisyTurn = angVel * (1 + turnNoise);
  const steer = steerFromObservedTurn(noisyTurn, car.carId);
  const spin = steer === 0 ? noisyTurn : 0;
  const observed: BotCarView = { ...car, speed: car.speed * (1 + speedNoise) };
  const poses = rollForward(
    bodyFromObservation(observed, spin), car.carId, { steer, throttle: 1 }, horizonTicks,
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
 * of a pose it never holds. `bodyFromSelf` discards `self.maneuverTicksLeft` to keep that claim true
 * mid-dash: carried through, `stepDash` would have predicted the bot parked for the dash's remaining
 * ticks and then handed it back at exactly the top speed this paragraph says it must not assume.
 *
 * `input` stays a parameter here, unlike on `physicsPredictor`: this is the bot's OWN car, so there
 * is no steer to infer — the caller knows what it is asking about.
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
 * (possibly curving) path `at`. The physics analogue of the textbook closed-form straight-line
 * intercept (`aim.ts` carried one, `interceptPoint`, until R-K1 deleted it unused in 2026-09-07's
 * phase D), which solves the same problem in one shot but only against a straight line — a `PosePredictor`
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
