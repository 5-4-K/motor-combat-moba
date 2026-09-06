import type { ChassisDrive } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { RAM_CONFIG, ramDecay } from "../config/ram-config.js";
import type { InputMessage } from "../net/input.js";
import { ManeuverKind, NO_MANEUVER } from "./maneuver.js";
import type { Modifiers } from "./status/modifiers.js";
import type { SimBody } from "./step.js";
import { forwardOf, lateralOf, toWorld } from "./velocity.js";

/**
 * Arcade drive: steering, throttle/brake/reverse, and world translation for one tick. Pure.
 *
 * `mods` are the car's status multipliers. They scale the drive CONSTANTS — the turn rate, the
 * engine's push, the brake, the speed caps — and change nothing about the integration itself: the
 * drive model is the same three lines it was, read with different numbers. At `NEUTRAL_MODIFIERS`
 * every product is a multiplication by 1 and this function is arithmetically identical to its
 * pre-status self, which is the property `golden.test.ts` pins.
 *
 * **Coast is the one constant no channel scales.** Braking is scalable in principle (no row fades it
 * today — `overheated` did until the 2026-09-01 overhaul made it a pure burn), but coasting is what a
 * car does with no input at all, and a car that would not slow down even off the
 * throttle has stopped being a car. `STATUS_LIMITS.brakeDecel.min` keeps scaled braking above the
 * chassis's proportional coast for the same reason: the brake pedal must always beat lifting off, or
 * the control reads as broken rather than degraded.
 *
 * `chassis` is this car's resolved drive numbers (`driveOf`). The sim is handed them rather than
 * looking them up, so the integration below has no knowledge of the roster at all.
 */
export function stepDrive(
  body: SimBody,
  input: InputMessage,
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): SimBody {
  if (isDashing(body)) return stepDash(body, dt, chassis, mods);
  if (body.maneuver === ManeuverKind.HOLD && body.maneuverTicksLeft > 0) {
    return stepHold(body, input, dt, chassis, mods);
  }
  const maneuverNext = tickCharge(body);

  const forward = forwardOf(body.vx, body.vy, body.angle);
  const lateral = lateralOf(body.vx, body.vy, body.angle);

  const baseTurnRate = isMoving(forward) ? chassis.turnRate : chassis.turnRateAtStop;
  const turnRate = baseTurnRate * mods.turnRate;
  // `steeringLocked` kills the driver's input, never the injected spin below: a stunned car that is
  // rammed still tumbles, which is the whole reason the two terms are added rather than multiplied.
  const steer = mods.steeringLocked ? 0 : input.steer;
  // Steering and injected spin are ADDED into one rotation, which is what makes countersteering
  // free: the integrator does not know why angVel is high, so steering the other way subtracts
  // from the same sum. `authority` used to scale the steer term; it has no successor yet, so a
  // rammed car keeps full steering. Stage 3b's `reeling` status is meant to scale `mods.turnRate`
  // in its place, but that status does not exist yet.
  const angle = body.angle + (steer * turnRate + body.angVel) * dt;

  // `immobilised` zeroes the THROTTLE, not the car: braking, coast and any standing knock all still
  // resolve, and the forward component bleeds off through coast rather than snapping to 0 — an
  // instant stop at speed reads as hitting an invisible wall, not as being stunned.
  const throttle = mods.immobilised ? 0 : input.throttle;
  const stepped = nextForward(forward, body.reverseHold, throttle, dt, chassis, mods);
  const heldForward = mods.fullStop ? 0 : stepped.forward;
  const reverseHold = mods.fullStop ? 0 : stepped.reverseHold;

  // Imposed sideways motion bleeds at a FLAT rate — a saturated tyre delivers a roughly constant
  // force — while the forward component above decays proportionally. The two axes are independent
  // by construction; see the spec on why one friction circle cannot serve both.
  const nextLateral = bleedLateral(lateral, dt);

  // `steeringGrip` decides how much of this tick's rotation the velocity follows. At 1 the velocity
  // is rebuilt entirely in the NEW heading (on rails). At 0 it is rebuilt in the OLD one, so the
  // nose turns and the car keeps sliding the way it was already going.
  const velocityAngle = body.angle + (angle - body.angle) * DRIVE_CONFIG.steeringGrip;
  const v = toWorld(velocityAngle, heldForward, nextLateral);

  return {
    x: body.x + v.vx * dt,
    y: body.y + v.vy * dt,
    angle,
    vx: v.vx,
    vy: v.vy,
    reverseHold,
    angVel: nextAngVel(body.angVel, steer),
    ...maneuverNext,
  };
}

/**
 * Is this body in a live DASH? Exactly the condition `stepDrive` branches on above, named once so
 * the substep gate in `stepSim` and the drive branch here can never drift apart.
 */
export function isDashing(body: SimBody): boolean {
  return body.maneuver === ManeuverKind.DASH && body.maneuverTicksLeft > 0;
}

/**
 * The displacement a dash covers in `dt` seconds — a DELTA, not a position.
 *
 * Factored out of `stepDash` so `stepSim` can apply it N times at `dt / N` without also re-running
 * the per-tick bookkeeping around it (C6). One place computes the dash's motion, so a substepped
 * walk and a single full-`dt` step can never disagree about direction or speed.
 */
export function dashTranslation(body: SimBody, dt: number): { x: number; y: number } {
  const v = toWorld(body.maneuverAngle, body.maneuverSpeed, 0);
  return { x: v.vx * dt, y: v.vy * dt };
}

/**
 * How many collision checks this tick of dash needs: enough that no single translation exceeds
 * `DRIVE_CONFIG.dashSubstepMaxUnits`.
 *
 * DERIVED from distance rather than hardcoded (C3), so the value stays correct if
 * `thunderclap.speed`, `TICK_RATE_HZ` or the hull dimensions are ever retuned — including by a
 * later rescale of the dash itself. At 1600 u/s and 30Hz that is 53.3u against a 16u bound: 4.
 */
export function dashSubstepCount(body: SimBody, dt: number): number {
  const travel = Math.abs(body.maneuverSpeed) * dt;
  return Math.max(1, Math.ceil(travel / DRIVE_CONFIG.dashSubstepMaxUnits));
}

/**
 * DASH: scripted translation. Inputs are ignored; injected spin decay still runs; the face is
 * welded.
 *
 * Everything here except the two position lines is PER-TICK and must run exactly once —
 * `maneuverTicksLeft - 1`, the `done` exit-speed handoff, `nextAngVel`. That is why `stepSim`
 * re-walks the position itself rather than calling this N times: four substeps of this function
 * would burn the dash's duration four times as fast. This still applies the FULL `dt` translation,
 * so `stepDrive` on its own is arithmetically what it always was.
 *
 * `vx`/`vy` are neither bled nor driven for the dash's whole duration — frozen mid-dash, since
 * `dashTranslation` supplies the motion directly from `maneuverAngle`/`maneuverSpeed` rather than
 * from the velocity — and then overwritten wholesale on the exit tick (see the `done` branch
 * below). Before the vector-drive rework a knock's `shoveX`/`shoveY` kept decaying on its own
 * half-life the whole time a dash ran; there is no analogous in-dash decay to preserve now that
 * velocity is one field, so this is a real behavioural change, not a pure rename. `endDash` in
 * `ram-bridge.ts` documents its own bridge-side discard the same way.
 */
function stepDash(body: SimBody, dt: number, chassis: ChassisDrive, mods: Readonly<Modifiers>): SimBody {
  const ticksLeft = body.maneuverTicksLeft - 1;
  const done = ticksLeft <= 0;
  const step = dashTranslation(body, dt);
  return {
    x: body.x + step.x,
    y: body.y + step.y,
    angle: body.maneuverAngle,
    reverseHold: 0,
    angVel: nextAngVel(body.angVel, 0),
    // Hand the car back already rolling at its cap — a dash that exits frozen reads as a stall.
    ...(done
      ? toWorld(body.maneuverAngle, chassis.maxSpeed * mods.topSpeed, 0)
      : { vx: body.vx, vy: body.vy }),
    maneuver: done ? ManeuverKind.NONE : ManeuverKind.DASH,
    maneuverTicksLeft: done ? 0 : ticksLeft,
    maneuverAngle: done ? 0 : body.maneuverAngle,
    maneuverSpeed: done ? 0 : body.maneuverSpeed,
  };
}

/** HOLD: the engine is dead but the wheel is not. Forward forced to 0; imposed lateral still displaces. */
function stepHold(
  body: SimBody,
  input: InputMessage,
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): SimBody {
  const steer = mods.steeringLocked ? 0 : input.steer;
  const angle = body.angle + (steer * chassis.turnRateAtStop * mods.turnRate + body.angVel) * dt;
  const ticksLeft = body.maneuverTicksLeft - 1;
  const done = ticksLeft <= 0;

  const lateral = bleedLateral(lateralOf(body.vx, body.vy, body.angle), dt);
  const v = toWorld(angle, 0, lateral);

  return {
    x: body.x + v.vx * dt,
    y: body.y + v.vy * dt,
    angle,
    vx: v.vx,
    vy: v.vy,
    reverseHold: 0,
    angVel: nextAngVel(body.angVel, steer),
    maneuver: done ? ManeuverKind.NONE : ManeuverKind.HOLD,
    maneuverTicksLeft: done ? 0 : ticksLeft,
    maneuverAngle: 0,
    maneuverSpeed: 0,
  };
}

/** CHARGE only counts down here; its rules live in the contact pass. Also normalises stale kinds. */
function tickCharge(body: SimBody): Pick<SimBody, "maneuver" | "maneuverTicksLeft" | "maneuverAngle" | "maneuverSpeed"> {
  if (body.maneuver !== ManeuverKind.CHARGE || body.maneuverTicksLeft <= 0) return { ...NO_MANEUVER };
  const ticksLeft = body.maneuverTicksLeft - 1;
  if (ticksLeft <= 0) return { ...NO_MANEUVER };
  return { maneuver: ManeuverKind.CHARGE, maneuverTicksLeft: ticksLeft, maneuverAngle: 0, maneuverSpeed: 0 };
}

/**
 * Injected spin decays on its own, and decays FASTER while the player steers against it.
 *
 * Without that second rate, steering could only offset the visible rotation while the underlying
 * spin ran its full course, so recovery time would be fixed by decay alone and skill could not
 * shorten a knock. This is the one line that makes reading the spin direction worth anything.
 */
function nextAngVel(angVel: number, steer: InputMessage["steer"]): number {
  const fighting = steer * angVel < 0;
  const decay = ramDecay();
  const next = angVel * (fighting ? decay.counterSteer : decay.spin);
  return Math.abs(next) < RAM_CONFIG.spinEpsilon ? 0 : next;
}

/** Outside the `stopEpsilon` band the car counts as rolling, in whichever direction. */
function isMoving(forward: number): boolean {
  return Math.abs(forward) > DRIVE_CONFIG.stopEpsilon;
}

function nextForward(
  forward: number,
  reverseHold: number,
  throttle: InputMessage["throttle"],
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): { forward: number; reverseHold: number } {
  if (throttle === 1) {
    return { forward: accelerateForward(forward, dt, chassis, mods), reverseHold: 0 };
  }
  if (throttle === -1) {
    return brakeOrReverse(forward, reverseHold, dt, chassis, mods);
  }
  return { forward: coast(forward, chassis), reverseHold: 0 };
}

/**
 * Up: brake toward 0 while rolling backward, otherwise accelerate forward, clamped to the car's
 * forward max.
 *
 * The cap is the car's rating scaled by `mods.topSpeed`, and it CLAMPS rather than merely limiting
 * growth: a car doing 260 that is slowed to a cap of 200 drops to 200 on the next throttled tick.
 * That is abrupt on purpose. The alternative — letting a car hold a speed its engine may no longer
 * reach — means a slow does nothing at all to whoever was already at top speed, which is precisely
 * the car it was aimed at. Off the throttle, coasting brings the same car down smoothly; the snap
 * only happens while the driver is actively asking for more.
 *
 * **Since the 2026-09-06 vector-drive rework, this clamp also caps externally imposed forward
 * motion, not only the driver's own acceleration** — the pre-rework model never did this, because
 * `shove` was a field this function never touched. A rear-end or head-on ram now adds its knock
 * straight into `vx`/`vy` (`ram-bridge.ts`), and if that pushes the forward component above this
 * cap, the very next throttled tick snaps it back down here — the same abruptness described above,
 * but now applied to a knock the victim did not ask for rather than only to a driver's own
 * over-throttling. Whether a ram's forward push should be exempt from this clamp is stage 2's
 * design question (`applyImpulse`), not answered by this function. See `combat-model.md`'s
 * Ramming section for the resulting near-inertness of head-on/rear-end rams.
 */
function accelerateForward(
  forward: number,
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): number {
  if (forward < -DRIVE_CONFIG.stopEpsilon) {
    return Math.min(0, forward + chassis.brakeDecel * mods.brakeDecel * dt);
  }
  return Math.min(
    chassis.maxSpeed * mods.topSpeed,
    forward + chassis.accel * mods.accel * dt,
  );
}

/**
 * Down: brake toward 0 at `brakeDecel` while rolling forward. Once already reversing, keep
 * accelerating backward at `reverseAccel` without re-arming the hold delay. Only at rest does
 * reverseHold accumulate toward reverseHoldTicks before reverse engages, clamped to the car's
 * reverse max.
 */
function brakeOrReverse(
  forward: number,
  reverseHold: number,
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): { forward: number; reverseHold: number } {
  if (forward > DRIVE_CONFIG.stopEpsilon) {
    // Still rolling forward — brake toward 0 first.
    return {
      forward: Math.max(0, forward - chassis.brakeDecel * mods.brakeDecel * dt),
      reverseHold: 0,
    };
  }
  if (forward < -DRIVE_CONFIG.stopEpsilon) {
    // Already reversing — keep accelerating; do not re-arm the hold delay.
    return { forward: reverseFurther(forward, dt, chassis, mods), reverseHold: DRIVE_CONFIG.reverseHoldTicks };
  }
  // At rest: accumulate toward the reverse threshold. Clamped so the uint16-networked field
  // stays idempotent at the threshold instead of growing unbounded (and eventually truncating
  // on the wire) while reverse is held.
  const heldTicks = Math.min(reverseHold + 1, DRIVE_CONFIG.reverseHoldTicks);
  if (heldTicks < DRIVE_CONFIG.reverseHoldTicks) {
    return { forward, reverseHold: heldTicks };
  }
  return { forward: reverseFurther(forward, dt, chassis, mods), reverseHold: heldTicks };
}

/**
 * One tick of backward acceleration, pinned at the car's reverse cap.
 *
 * Reverse is scaled by the same two channels as forward — a slow that left reverse untouched would
 * make backing away the fastest way out of it.
 */
function reverseFurther(
  forward: number,
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): number {
  return Math.max(
    -chassis.reverseMaxSpeed * mods.topSpeed,
    forward - chassis.reverseAccel * mods.accel * dt,
  );
}

/** No throttle: the forward component decays by a fixed FRACTION per tick. */
function coast(forward: number, chassis: ChassisDrive): number {
  const next = forward * chassis.coastPerTick;
  // Proportional decay is asymptotic and never actually reaches zero. `stopEpsilon` is what stops
  // a coasting car creeping forever a hair above rest.
  return Math.abs(next) <= DRIVE_CONFIG.stopEpsilon ? 0 : next;
}

/** Imposed sideways motion, bled toward zero at a flat rate and never overshot through it. */
function bleedLateral(lateral: number, dt: number): number {
  const drop = DRIVE_CONFIG.impactGripDecel * dt;
  if (lateral > 0) return Math.max(0, lateral - drop);
  if (lateral < 0) return Math.min(0, lateral + drop);
  return 0;
}
