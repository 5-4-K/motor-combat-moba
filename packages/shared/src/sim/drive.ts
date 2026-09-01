import type { ChassisDrive } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { RAM_CONFIG, RAM_DECAY } from "../config/ram-config.js";
import type { InputMessage } from "../net/input.js";
import { ManeuverKind, NO_MANEUVER } from "./maneuver.js";
import type { Modifiers } from "./status/modifiers.js";
import type { SimBody } from "./step.js";

/**
 * Arcade drive: steering, throttle/brake/reverse, and world translation for one tick. Pure.
 *
 * `mods` are the car's status multipliers. They scale the drive CONSTANTS — the turn rate, the
 * engine's push, the brake, the speed caps — and change nothing about the integration itself: the
 * drive model is the same three lines it was, read with different numbers. At `NEUTRAL_MODIFIERS`
 * every product is a multiplication by 1 and this function is arithmetically identical to its
 * pre-status self, which is the property `golden.test.ts` pins.
 *
 * **Drag is the one constant no channel scales.** Braking is scalable in principle (no row fades it
 * today — `overheated` did until the 2026-09-01 overhaul made it a pure burn), but drag is what a
 * car does with no input at all, and a car that would not slow down even off the
 * throttle has stopped being a car. `STATUS_LIMITS.brakeDecel.min` keeps scaled braking above drag
 * for the same reason: the brake pedal must always beat lifting off, or the control reads as broken
 * rather than degraded.
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
  if (isDashing(body)) {
    return stepDash(body, dt, chassis, mods);
  }
  if (body.maneuver === ManeuverKind.HOLD && body.maneuverTicksLeft > 0) {
    return stepHold(body, input, dt, chassis, mods);
  }
  const maneuverNext = tickCharge(body);

  const baseTurnRate = isMoving(body.speed) ? chassis.turnRate : chassis.turnRateAtStop;
  const turnRate = baseTurnRate * mods.turnRate;
  // `steeringLocked` kills the driver's input, never the injected spin below: a stunned car that is
  // rammed still tumbles, which is the whole reason the two terms are added rather than multiplied.
  const steer = mods.steeringLocked ? 0 : input.steer;
  // Steering is scaled by authority; injected spin is not. Both are ADDED into one rotation, which
  // is what makes countersteering free: the integrator does not know why angVel is high, so steering
  // the other way simply subtracts from the same sum.
  //
  // `mods.turnRate` multiplies alongside `authority` rather than replacing it: they answer different
  // questions ("how sharply does this car turn" vs "how much of your steering is reaching the road
  // right now"), they decay on different clocks, and a rattled car mid-ram should be both.
  const angle = body.angle + (steer * turnRate * body.authority + body.angVel) * dt;

  // `immobilised` zeroes the THROTTLE, not the car: braking, drag and any standing knock all still
  // resolve, and speed bleeds off through drag rather than snapping to 0 — an instant stop at speed
  // reads as hitting an invisible wall, not as being stunned.
  const throttle = mods.immobilised ? 0 : input.throttle;
  const { speed, reverseHold } = nextSpeed(body.speed, body.reverseHold, throttle, dt, chassis, mods);

  // `fullStop` forces speed to 0 AFTER `nextSpeed` has run — the "total stop" half of the new stun
  // (O6). It never touches `body.shoveX/shoveY` below, so a slammed car still slides: applied here
  // rather than upstream, the throttle/brake/drag maths still run (so nothing downstream sees a
  // discontinuous derivative), only the result is discarded.
  const held = mods.fullStop ? { speed: 0, reverseHold: 0 } : { speed, reverseHold };

  // cos/sin are not guaranteed bit-identical across JS engines (server V8 vs. client browser
  // engine), so replayed positions can drift by an ULP or two. That's fine here: Task 4
  // reconciles client prediction against authoritative server state rather than trusting
  // bit-exact replay, so this is not a desync-checksum-safe function.
  //
  // Shove is added to the drive velocity, never substituted for it: a car that is both driving and
  // knocked does both. At `shoveX/shoveY` of 0 this is arithmetically identical to the pre-ram
  // model, which `golden.test.ts` pins.
  const x = body.x + (Math.cos(angle) * held.speed + body.shoveX) * dt;
  const y = body.y + (Math.sin(angle) * held.speed + body.shoveY) * dt;

  return {
    x,
    y,
    angle,
    speed: held.speed,
    reverseHold: held.reverseHold,
    // `steer`, not `input.steer`: a driver whose wheel is locked cannot countersteer out of a spin
    // either, so the fast decay has to be gated by the same value the rotation above used.
    angVel: nextAngVel(body.angVel, steer),
    shoveX: decayShove(body.shoveX),
    shoveY: decayShove(body.shoveY),
    authority: recoverAuthority(body.authority),
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
  return {
    x: Math.cos(body.maneuverAngle) * body.maneuverSpeed * dt,
    y: Math.sin(body.maneuverAngle) * body.maneuverSpeed * dt,
  };
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
 * DASH: scripted translation. Inputs are ignored; knock decay still runs; the face is welded.
 *
 * Everything here except the two position lines is PER-TICK and must run exactly once —
 * `maneuverTicksLeft - 1`, the `done` exit-speed handoff, `decayShove`, `recoverAuthority`,
 * `nextAngVel`. That is why `stepSim` re-walks the position itself rather than calling this N
 * times: four substeps of this function would burn the dash's duration and decay a knock four
 * times as fast. This still applies the FULL `dt` translation, so `stepDrive` on its own is
 * arithmetically what it always was.
 */
function stepDash(body: SimBody, dt: number, chassis: ChassisDrive, mods: Readonly<Modifiers>): SimBody {
  const ticksLeft = body.maneuverTicksLeft - 1;
  const done = ticksLeft <= 0;
  const step = dashTranslation(body, dt);
  return {
    x: body.x + step.x,
    y: body.y + step.y,
    angle: body.maneuverAngle,
    // Hand the car back already rolling at its cap — a dash that exits frozen reads as a stall.
    speed: done ? chassis.maxSpeed * mods.topSpeed : body.speed,
    reverseHold: 0,
    angVel: nextAngVel(body.angVel, 0),
    shoveX: decayShove(body.shoveX),
    shoveY: decayShove(body.shoveY),
    authority: recoverAuthority(body.authority),
    maneuver: done ? ManeuverKind.NONE : ManeuverKind.DASH,
    maneuverTicksLeft: done ? 0 : ticksLeft,
    maneuverAngle: done ? 0 : body.maneuverAngle,
    maneuverSpeed: done ? 0 : body.maneuverSpeed,
  };
}

/** HOLD: the engine is dead but the wheel is not. Speed forced to 0; shove still displaces. */
function stepHold(
  body: SimBody,
  input: InputMessage,
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): SimBody {
  const steer = mods.steeringLocked ? 0 : input.steer;
  const angle = body.angle + (steer * chassis.turnRateAtStop * mods.turnRate * body.authority + body.angVel) * dt;
  const ticksLeft = body.maneuverTicksLeft - 1;
  const done = ticksLeft <= 0;
  return {
    x: body.x + body.shoveX * dt,
    y: body.y + body.shoveY * dt,
    angle,
    speed: 0,
    reverseHold: 0,
    angVel: nextAngVel(body.angVel, steer),
    shoveX: decayShove(body.shoveX),
    shoveY: decayShove(body.shoveY),
    authority: recoverAuthority(body.authority),
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
  const next = angVel * (fighting ? RAM_DECAY.counterSteer : RAM_DECAY.spin);
  return Math.abs(next) < RAM_CONFIG.spinEpsilon ? 0 : next;
}

function decayShove(component: number): number {
  const next = component * RAM_DECAY.shove;
  return Math.abs(next) < RAM_CONFIG.shoveEpsilon ? 0 : next;
}

/**
 * Authority climbs back toward full control: it is the GAP to 1 that halves, not the value itself.
 * Snapped to exactly 1 inside the epsilon so a car is never left permanently a hair below full
 * steering — exponential recovery never actually arrives.
 */
function recoverAuthority(authority: number): number {
  const next = 1 - (1 - authority) * RAM_DECAY.authority;
  return 1 - next < RAM_CONFIG.authorityEpsilon ? 1 : next;
}

/** Outside the `stopEpsilon` band the car counts as rolling, in whichever direction. */
function isMoving(speed: number): boolean {
  return Math.abs(speed) > DRIVE_CONFIG.stopEpsilon;
}

function nextSpeed(
  speed: number,
  reverseHold: number,
  throttle: InputMessage["throttle"],
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): { speed: number; reverseHold: number } {
  if (throttle === 1) {
    return { speed: accelerateForward(speed, dt, chassis, mods), reverseHold: 0 };
  }
  if (throttle === -1) {
    return brakeOrReverse(speed, reverseHold, dt, chassis, mods);
  }
  return { speed: coast(speed, dt), reverseHold: 0 };
}

/**
 * Up: brake toward 0 while rolling backward, otherwise accelerate forward, clamped to the car's
 * forward max.
 *
 * The cap is the car's rating scaled by `mods.topSpeed`, and it CLAMPS rather than merely limiting
 * growth: a car doing 260 that is slowed to a cap of 200 drops to 200 on the next throttled tick.
 * That is abrupt on purpose. The alternative — letting a car hold a speed its engine may no longer
 * reach — means a slow does nothing at all to whoever was already at top speed, which is precisely
 * the car it was aimed at. Off the throttle, drag brings the same car down smoothly; the snap only
 * happens while the driver is actively asking for more.
 */
function accelerateForward(
  speed: number,
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): number {
  if (speed < -DRIVE_CONFIG.stopEpsilon) {
    return Math.min(0, speed + DRIVE_CONFIG.brakeDecel * mods.brakeDecel * dt);
  }
  return Math.min(
    chassis.maxSpeed * mods.topSpeed,
    speed + chassis.accel * mods.accel * dt,
  );
}

/**
 * Down: brake toward 0 at `brakeDecel` while rolling forward. Once already reversing, keep
 * accelerating backward at `reverseAccel` without re-arming the hold delay. Only at rest does
 * reverseHold accumulate toward reverseHoldTicks before reverse engages, clamped to the car's
 * reverse max.
 */
function brakeOrReverse(
  speed: number,
  reverseHold: number,
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): { speed: number; reverseHold: number } {
  if (speed > DRIVE_CONFIG.stopEpsilon) {
    // Still rolling forward — brake toward 0 first.
    return {
      speed: Math.max(0, speed - DRIVE_CONFIG.brakeDecel * mods.brakeDecel * dt),
      reverseHold: 0,
    };
  }
  if (speed < -DRIVE_CONFIG.stopEpsilon) {
    // Already reversing — keep accelerating; do not re-arm the hold delay.
    return { speed: reverseFurther(speed, dt, chassis, mods), reverseHold: DRIVE_CONFIG.reverseHoldTicks };
  }
  // At rest: accumulate toward the reverse threshold. Clamped so the uint16-networked field
  // stays idempotent at the threshold instead of growing unbounded (and eventually truncating
  // on the wire) while reverse is held.
  const heldTicks = Math.min(reverseHold + 1, DRIVE_CONFIG.reverseHoldTicks);
  if (heldTicks < DRIVE_CONFIG.reverseHoldTicks) {
    return { speed, reverseHold: heldTicks };
  }
  return { speed: reverseFurther(speed, dt, chassis, mods), reverseHold: heldTicks };
}

/**
 * One tick of backward acceleration, pinned at the car's reverse cap.
 *
 * Reverse is scaled by the same two channels as forward — a slow that left reverse untouched would
 * make backing away the fastest way out of it.
 */
function reverseFurther(
  speed: number,
  dt: number,
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): number {
  return Math.max(
    -chassis.reverseMaxSpeed * mods.topSpeed,
    speed - chassis.reverseAccel * mods.accel * dt,
  );
}

/** No throttle: drag pulls speed toward 0 from either direction. */
function coast(speed: number, dt: number): number {
  if (speed > DRIVE_CONFIG.stopEpsilon) return Math.max(0, speed - DRIVE_CONFIG.drag * dt);
  if (speed < -DRIVE_CONFIG.stopEpsilon) return Math.min(0, speed + DRIVE_CONFIG.drag * dt);
  return 0; // inside the band: snap to true rest
}
