import type { ChassisDrive } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import type { InputMessage } from "../net/input.js";
import { ManeuverKind, NO_MANEUVER } from "./maneuver.js";
import type { Modifiers } from "./status/modifiers.js";
import type { SimBody } from "./step.js";
import { forwardOf, lateralOf, toWorld } from "./velocity.js";

/**
 * Arcade drive: steering, throttle/brake/reverse, and world translation for one tick. Pure.
 *
 * The drive-model stage of the Unity physics port replaced the old accel-clamp-and-coast trio
 * with one always-on exponential drag rate: top speed is an
 * equilibrium (`engineAccel / dragRate`) rather than a clamp, and one number sets top speed,
 * wind-up and roll together (U4). A separate global rate bleeds the LATERAL velocity component —
 * the gap between where the car points and where it is going is the drift — and yaw rate is
 * speed-independent.
 *
 * `mods` are the car's status multipliers. They scale the drive CONSTANTS — the turn rate, the
 * engine's push, the brake, the drag and grip rates — and change nothing about the integration
 * itself. At `NEUTRAL_MODIFIERS` every product is a multiplication by 1 and this function is
 * arithmetically identical to its neutral self, which is the property `golden.test.ts` pins.
 *
 * `chassis` is this car's resolved drive numbers (`driveOf`). The sim is handed them rather than
 * looking them up, so the integration below has no knowledge of the roster at all, and reads no
 * module-level rate of its own — every rate reaches it through `chassis`.
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

  // 1. The engine command, decided on the velocity the car carried INTO the tick, as Unity's
  //    `DrivePhysics.DriveForce` reads `body.linearVelocity` before its own drag step.
  const throttle = mods.immobilised ? 0 : input.throttle;
  const command = engineCommandOf(forwardOf(body.vx, body.vy, body.angle), throttle, chassis, mods);

  // 2. Drag, on the WHOLE vector. This is the only thing slowing a car down: there is no separate
  //    coast branch, because the throttle does not switch drag off in a real car either.
  const drag = dragFactorOf(chassis, mods);
  let forward = forwardOf(body.vx, body.vy, body.angle) * drag;
  let lateral = lateralOf(body.vx, body.vy, body.angle) * drag;

  // 3. Grip: the sideways component alone, scaled by the car's own grip modifier. Whatever
  //    survives is the drift.
  lateral *= gripFactorOf(chassis, mods);

  // 4. Yaw. Steering SETS the rate (U16) — it is not added to a separate spin channel — so an
  //    injected ram spin lives exactly as long as `spinFree` does.
  const steer = mods.steeringLocked ? 0 : input.steer;
  const angVel = mods.spinFree
    ? nextSpinOf(body.angVel, chassis)
    : steer * chassis.turnRate * mods.turnRate * steerSenseOf(forward);
  const angle = body.angle + angVel * dt;

  // 5. Integrate. Drag and the command are solved TOGETHER over this tick, not in sequence: `forward`
  //    above is already `v * drag` (the decay half of the closed form for `dv/dt = a - k*v`), and
  //    `commandFactorOf` supplies the matching forcing half, so the pair is exact rather than an
  //    explicit-Euler add-on — see that function for why the difference matters.
  forward += command * commandFactorOf(chassis, mods, dt, drag);
  if (mods.fullStop || atRest(forward, lateral, throttle)) {
    forward = 0;
    lateral = 0;
  }

  // Recomposed at the OLD angle on purpose: rotating the car must not rotate its velocity. The gap
  // the rotation opens is read as lateral velocity on the NEXT tick, and that gap is the drift.
  const v = toWorld(body.angle, forward, lateral);

  return {
    x: body.x + v.vx * dt,
    y: body.y + v.vy * dt,
    angle,
    vx: v.vx,
    vy: v.vy,
    // Dead field until Task 4 deletes it from `SimBody`/`PlayerState` (car-physics-port stage 1
    // Task 4) — nothing here computes a meaningful reverse-hold delay any more, since reverse now
    // engages the moment the driver holds Down below `reverseEpsilon` (see `engineCommandOf`).
    reverseHold: 0,
    angVel,
    ...maneuverNext,
  };
}

/** Throttle, brake and reverse as one signed acceleration. Unity's `DrivePhysics.DriveForce`. */
function engineCommandOf(
  forward: number,
  throttle: InputMessage["throttle"],
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
): number {
  if (throttle === 1) return chassis.engineAccel * mods.topSpeed * mods.accel;
  if (throttle === -1) {
    return forward > DRIVE_CONFIG.reverseEpsilon
      ? -chassis.brakeDecel * mods.brakeDecel
      : -chassis.reverseAccel * mods.topSpeed * mods.accel;
  }
  return 0;
}

/**
 * The drag factor for this tick, with the `accel` channel applied as a POWER (U36).
 *
 * `exp(-k·m·dt)` is `exp(-k·dt)^m`, so this is exact. Multiplying `dragPerTick` by the modifier
 * instead would be a different function entirely — and at `mods.accel` of 0 it would stop the car
 * dead rather than remove its drag, which is precisely backwards.
 */
function dragFactorOf(chassis: ChassisDrive, mods: Readonly<Modifiers>): number {
  return mods.accel === 1 ? chassis.dragPerTick : Math.pow(chassis.dragPerTick, mods.accel);
}

/**
 * The factor the engine command is multiplied by over one tick.
 *
 * Drag and the command are solved TOGETHER, not in sequence: `dv/dt = a - k*v` integrates over one
 * tick to `v * exp(-k*dt) + (a/k) * (1 - exp(-k*dt))`, and this is that second term's coefficient.
 * Adding `command * dt` instead would be explicit Euler, whose own fixed point is `a*dt/(1-decay)`
 * — 1.7% above `engineAccel / dragRate` at 30 Hz and a DIFFERENT number at 60 Hz, which would cost
 * both the asymptotic top speed and the tick-rate independence the whole model is built on (U7).
 *
 * `k` is the EFFECTIVE rate `dragRate * mods.accel` — the same effective rate `dragFactorOf` raises
 * `dragPerTick` to via the power form, so the two halves agree on what "drag" means this tick.
 *
 * `k === 0` (an observation modifier can zero `accel`) is `0/0` in the closed form; its limit as
 * `k -> 0` is exactly `dt`, which is also the physically right answer — no drag at all is plain
 * Euler, `drag` is 1, and the two agree there too.
 */
function commandFactorOf(
  chassis: ChassisDrive,
  mods: Readonly<Modifiers>,
  dt: number,
  drag: number,
): number {
  const rate = chassis.dragRate * mods.accel;
  return rate > 0 ? (1 - drag) / rate : dt;
}

/**
 * The lateral grip factor for this tick, with the `grip` channel applied the same way (spec §5).
 *
 * The channel is what separates a driver's drift from a victim's ride: `lateralGripRate` says how
 * loose the car is in a corner, and a status — `reeling` is the only one today — says how much of
 * that grip a car currently has. `grip: 0` degenerates to no grip at all, which is Unity's flag.
 */
function gripFactorOf(chassis: ChassisDrive, mods: Readonly<Modifiers>): number {
  return mods.grip === 1 ? chassis.gripPerTick : Math.pow(chassis.gripPerTick, mods.grip);
}

/** -1 once the car is genuinely travelling backwards and the flip is on. Unity's `YawRate` sense. */
function steerSenseOf(forward: number): number {
  return DRIVE_CONFIG.flipSteeringInReverse && forward < -DRIVE_CONFIG.reverseEpsilon ? -1 : 1;
}

/** Injected spin, decaying on its own while nothing holds the yaw. */
function nextSpinOf(angVel: number, chassis: ChassisDrive): number {
  const next = angVel * chassis.spinPerTick;
  return Math.abs(next) < RAM_CONFIG.spinEpsilon ? 0 : next;
}

/**
 * Exponential decay never reaches zero, so a car with no input would creep forever a hair above
 * rest. Only with the throttle neutral: a car held against a wall is not at rest, it is pushing.
 */
function atRest(forward: number, lateral: number, throttle: InputMessage["throttle"]): boolean {
  return throttle === 0 && Math.hypot(forward, lateral) < DRIVE_CONFIG.stopEpsilon;
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
 * `maneuverTicksLeft - 1`, the `done` exit-speed handoff, the spin decay. That is why `stepSim`
 * re-walks the position itself rather than calling this N times: four substeps of this function
 * would burn the dash's duration four times as fast. This still applies the FULL `dt` translation,
 * so `stepDrive` on its own is arithmetically what it always was.
 *
 * `vx`/`vy` are neither bled nor driven for the dash's whole duration — frozen mid-dash, since
 * `dashTranslation` supplies the motion directly from `maneuverAngle`/`maneuverSpeed` rather than
 * from the velocity — and then overwritten wholesale on the exit tick (see the `done` branch
 * below).
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
    angVel: nextSpinOf(body.angVel, chassis),
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
  // Only the rate symbol and the decay helper change here (there is no at-rest turn rate any
  // more, and injected spin decays through `nextSpinOf` instead of the deleted `nextAngVel`).
  const angle = body.angle + (steer * chassis.turnRate * mods.turnRate + body.angVel) * dt;
  const ticksLeft = body.maneuverTicksLeft - 1;
  const done = ticksLeft <= 0;

  // Lateral now bleeds through the same drag-then-grip model the ordinary branch uses, not the
  // flat `impactGripDecel` rate `bleedLateral` used to apply here: `DRIVE_CONFIG.impactGripDecel`
  // is on Task 6's deletion list, so leaving HOLD reading it would be a build break two tasks out,
  // and one grip model for the whole car is the point of this port anyway.
  const lateral = lateralOf(body.vx, body.vy, body.angle) * dragFactorOf(chassis, mods) * gripFactorOf(chassis, mods);
  const v = toWorld(angle, 0, lateral);

  return {
    x: body.x + v.vx * dt,
    y: body.y + v.vy * dt,
    angle,
    vx: v.vx,
    vy: v.vy,
    reverseHold: 0,
    angVel: nextSpinOf(body.angVel, chassis),
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
