import { describe, expect, it } from "vitest";
import type { ChassisDrive } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { InputMessage } from "../net/input.js";
import { dashSubstepCount, dashTranslation, isDashing, stepDrive } from "./drive.js";
import { ManeuverKind } from "./maneuver.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import type { SimBody } from "./step.js";
import { forwardOf } from "./velocity.js";

const DT = 1 / 30;

/**
 * The drive numbers this suite was recorded against — the chassis that shipped as `rectangle` on
 * 2026-08-29, before per-car acceleration and turn rate existed.
 *
 * Frozen here rather than read from `CAR_TABLE` deliberately: these expectations pin the SHAPE of
 * the integration, not the roster's balance. A car's ratings must be free to move without any
 * number below moving with them.
 */
// NOTE: `golden.test.ts` also declares a `GOLDEN_CHASSIS` with these same first six values but a
// DIFFERENT `coastPerTick` (a 0.35s half-life there, frozen to the pre-rework global, against the
// 1.0s used here). That is deliberate, not a copy-paste drift between the two fixtures — this file's
// suite predates the coast field and was never meant to pin a specific half-life, so 1.0s was picked
// as a convenient round number for this suite's own scenarios. Do not "fix" one to match the other.
const GOLDEN_CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 540,
  reverseMaxSpeed: 351,
  accel: 780,
  reverseAccel: 1100,
  turnRate: 4.2,
  turnRateAtStop: 2.1,
  coastPerTick: 0.5 ** (1 / (1.0 * 30)), // a 1.0s half-life at 30Hz — tick-count-frozen, not
  // seconds-frozen: this stays correct if a future netcode phase moves TICK_RATE_HZ, because DT
  // above is hardcoded to 1/30 in lockstep with it, not read from config.
  brakeDecel: 1600,
});

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function rest(): SimBody {
  return {
    x: 0,
    y: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    reverseHold: 0,
    angVel: 0,
    maneuver: 0,
    maneuverTicksLeft: 0,
    maneuverAngle: 0,
    maneuverSpeed: 0,
  };
}

function drive(body: SimBody, msg: InputMessage, ticks: number): SimBody {
  let next = body;
  for (let i = 0; i < ticks; i++) {
    next = stepDrive(next, msg, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
  }
  return next;
}

/** Forward speed along the car's own nose — the vector-model successor to the old scalar `speed`. */
function fwd(body: SimBody): number {
  return forwardOf(body.vx, body.vy, body.angle);
}

describe("stepDrive", () => {
  it("holds Up from rest: speed increases and x moves along angle (angle 0 -> +x)", () => {
    const out = drive(rest(), input(0, 1), 10);
    expect(fwd(out)).toBeGreaterThan(0);
    expect(out.angle).toBe(0);
    expect(out.x).toBeGreaterThan(0);
    expect(out.y).toBe(0);
  });

  it("reaches (and does not exceed) forwardMaxSpeedOf(carId) after sustained throttle", () => {
    const out = drive(rest(), input(0, 1), 1000);
    expect(fwd(out)).toBeCloseTo(GOLDEN_CHASSIS.maxSpeed);
  });

  it("from high +speed, holding Down brakes the speed down before it goes negative", () => {
    const highSpeed: SimBody = { ...rest(), vx: GOLDEN_CHASSIS.maxSpeed, vy: 0 };
    const out = stepDrive(highSpeed, input(0, -1), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(out)).toBeLessThan(fwd(highSpeed));
    expect(fwd(out)).toBeGreaterThanOrEqual(0);
  });

  it("from rest, holding Down for reverseHoldTicks then more goes negative, clamped to the reverse max", () => {
    const atThreshold = drive(rest(), input(0, -1), DRIVE_CONFIG.reverseHoldTicks);
    expect(fwd(atThreshold)).toBeLessThan(0);

    const held = drive(atThreshold, input(0, -1), 500);
    expect(fwd(held)).toBeLessThan(0);
    expect(Math.abs(fwd(held))).toBeLessThanOrEqual(GOLDEN_CHASSIS.reverseMaxSpeed);
    expect(GOLDEN_CHASSIS.reverseMaxSpeed).toBeCloseTo(
      GOLDEN_CHASSIS.maxSpeed * DRIVE_CONFIG.reverseSpeedRatio,
      9,
    );
    expect(held.reverseHold).toBe(DRIVE_CONFIG.reverseHoldTicks);
  });

  it("accelerates backward at reverseAccel, not the forward accel", () => {
    // Reverse gets its own rate so backing out of a fight is not gated by the forward curve.
    const down = input(0, -1);
    const engaged = drive(rest(), down, DRIVE_CONFIG.reverseHoldTicks);
    expect(fwd(engaged)).toBeLessThan(0);

    const next = stepDrive(engaged, down, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(engaged) - fwd(next)).toBeCloseTo(GOLDEN_CHASSIS.reverseAccel * DT, 6);
  });

  it("brakes through zero into reverse without overshoot, only reverses past the hold threshold, and pins at the cap", () => {
    const down = input(0, -1);
    let body: SimBody = { ...rest(), vx: GOLDEN_CHASSIS.maxSpeed, vy: 0 };
    let sawZero = false;
    let wentNegative = false;

    for (let tick = 0; tick < 25; tick++) {
      body = stepDrive(body, down, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
      const speed = fwd(body);
      if (!sawZero) {
        // Braking phase: speed must reach exactly 0 without ever overshooting negative, and the
        // reverse-hold delay must not start accumulating until the car is actually at rest.
        expect(speed).toBeGreaterThanOrEqual(0);
        expect(body.reverseHold).toBe(0);
        if (speed === 0) sawZero = true;
      } else if (!wentNegative) {
        if (speed < 0) {
          wentNegative = true;
          // Reverse only engages once the hold delay has fully accumulated.
          expect(body.reverseHold).toBe(DRIVE_CONFIG.reverseHoldTicks);
        }
      }
    }

    expect(sawZero).toBe(true);
    expect(wentNegative).toBe(true);

    const pinned = drive(body, down, 500);
    expect(fwd(pinned)).toBe(-GOLDEN_CHASSIS.reverseMaxSpeed);
  });

  it("holding Up from reverse brakes to exactly 0 without overshoot, then accelerates forward", () => {
    const up = input(0, 1);
    let body: SimBody = { ...rest(), vx: -GOLDEN_CHASSIS.reverseMaxSpeed, vy: 0 };
    let sawZero = false;

    for (let tick = 0; tick < 15; tick++) {
      body = stepDrive(body, up, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
      const speed = fwd(body);
      if (!sawZero) {
        expect(speed).toBeLessThanOrEqual(0);
        if (speed === 0) sawZero = true;
      } else {
        expect(speed).toBeGreaterThanOrEqual(0);
      }
    }

    expect(sawZero).toBe(true);
    expect(fwd(body)).toBeGreaterThan(0);
  });

  it("does not re-arm the reverse hold delay when briefly coasting mid-reverse", () => {
    const down = input(0, -1);
    const reversing = drive(rest(), down, DRIVE_CONFIG.reverseHoldTicks + 5);
    expect(fwd(reversing)).toBeLessThan(0);

    // Release Down for exactly one tick.
    const afterCoast = stepDrive(reversing, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(afterCoast.reverseHold).toBe(0);
    expect(fwd(afterCoast)).toBeLessThan(0);

    // Re-press Down: speed must keep getting more negative immediately, never freeze.
    const resumed = stepDrive(afterCoast, down, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(resumed)).toBeLessThan(fwd(afterCoast));
    expect(resumed.reverseHold).toBe(DRIVE_CONFIG.reverseHoldTicks);
  });

  it("Left steer increases angle (CCW); Right steer decreases it", () => {
    const left = stepDrive(rest(), input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const right = stepDrive(rest(), input(-1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(left.angle).toBeGreaterThan(0);
    expect(right.angle).toBeLessThan(0);
  });

  it("turns faster while moving than while stopped (turnRate vs turnRateAtStop)", () => {
    expect(GOLDEN_CHASSIS.turnRate).toBeGreaterThan(GOLDEN_CHASSIS.turnRateAtStop);

    const steerLeft = input(1, 0);
    const stopped = stepDrive(rest(), steerLeft, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const movingBody: SimBody = { ...rest(), vx: 100, vy: 0 };
    const moving = stepDrive(movingBody, steerLeft, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);

    expect(moving.angle).toBeGreaterThan(stopped.angle);
  });

  it("coasting (throttle 0) reduces |speed| via coast from a positive speed", () => {
    const moving: SimBody = { ...rest(), vx: 100, vy: 0 };
    const out = stepDrive(moving, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(out)).toBeLessThan(fwd(moving));
    expect(fwd(out)).toBeGreaterThanOrEqual(0);
  });

  it("coasting (throttle 0) reduces |speed| via coast from a negative speed", () => {
    const movingReverse: SimBody = { ...rest(), vx: -100, vy: 0 };
    const out = stepDrive(movingReverse, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(out)).toBeGreaterThan(fwd(movingReverse));
    expect(fwd(out)).toBeLessThanOrEqual(0);
  });

  it("coasting from a sub-stopEpsilon speed settles to exact rest in one tick", () => {
    const barelyMoving: SimBody = { ...rest(), vx: DRIVE_CONFIG.stopEpsilon / 2, vy: 0 };
    const out = stepDrive(barelyMoving, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(out)).toBe(0);
  });

  it("steers at turnRateAtStop below stopEpsilon and at turnRate above it", () => {
    // stopEpsilon is the band that decides which steering rate applies, so it is sim logic and
    // belongs in config rather than as a literal in drive.ts.
    const crawling: SimBody = { ...rest(), vx: DRIVE_CONFIG.stopEpsilon / 2, vy: 0 };
    const rolling: SimBody = { ...crawling, vx: DRIVE_CONFIG.stopEpsilon * 2 };

    expect(stepDrive(crawling, input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS).angle).toBeCloseTo(
      GOLDEN_CHASSIS.turnRateAtStop * DT,
      9,
    );
    expect(stepDrive(rolling, input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS).angle).toBeCloseTo(
      GOLDEN_CHASSIS.turnRate * DT,
      9,
    );
  });
});

describe("stepDrive: ram knock state", () => {
  it("rotates the car from angVel with no steering input", () => {
    const out = stepDrive({ ...rest(), angVel: 2 }, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(out.angle).toBeCloseTo(2 * DT, 9);
  });

  it("decays angVel toward zero and snaps inside the epsilon", () => {
    const spun = drive({ ...rest(), angVel: 3 }, input(0, 0), 1);
    expect(Math.abs(spun.angVel)).toBeLessThan(3);
    const settled = drive({ ...rest(), angVel: 3 }, input(0, 0), 300);
    expect(settled.angVel).toBe(0);
  });

  it("translates the car from an imposed lateral velocity with no throttle", () => {
    // There is no successor to `shove`: any lateral component of vx/vy IS the imposed motion. A
    // pure lateral component (angle 0, so lateral = vy) with no throttle still displaces the car.
    const out = stepDrive({ ...rest(), vx: 0, vy: -60 }, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(-(60 - DRIVE_CONFIG.impactGripDecel * DT) * DT, 9);
  });

  it("decays an imposed lateral velocity toward zero and snaps to exact rest", () => {
    // `bleedLateral` clamps rather than asymptotes, so this reaches exact 0 with no epsilon needed
    // — unlike the old shove decay, which halved forever and had to be snapped.
    const settled = drive({ ...rest(), vx: 0, vy: 200 }, input(0, 0), 300);
    expect(settled.vx).toBe(0);
    expect(settled.vy).toBe(0);
  });

  it("adds an imposed lateral velocity to the drive velocity rather than replacing it", () => {
    const out = stepDrive({ ...rest(), vx: 300, vy: 150 }, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    // angle 0, so drive motion is +x and the imposed lateral motion is +y. Both must survive.
    expect(out.x).toBeGreaterThan(0);
    expect(out.y).toBeCloseTo((150 - DRIVE_CONFIG.impactGripDecel * DT) * DT, 9);
  });

  it("bleeds spin faster when steering against it than when coasting", () => {
    const coasting = stepDrive({ ...rest(), vx: 200, angVel: 3 }, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const fighting = stepDrive({ ...rest(), vx: 200, angVel: 3 }, input(-1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fighting.angVel).toBeLessThan(coasting.angVel);
  });

  it("does not bleed spin when steering WITH it", () => {
    const coasting = stepDrive({ ...rest(), vx: 200, angVel: 3 }, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const going = stepDrive({ ...rest(), vx: 200, angVel: 3 }, input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(going.angVel).toBe(coasting.angVel);
  });

  it("bleeds spin faster when steering against a NEGATIVE angVel too", () => {
    // Every existing countersteer test above only exercises angVel: 3, so a predicate as loose as
    // `steer < 0` (rather than the actual `steer * angVel < 0`) would pass them all. This mirrors the
    // pair with the sign of angVel flipped and the opposing steer flipped to match.
    const coasting = stepDrive({ ...rest(), vx: 200, angVel: -3 }, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const fighting = stepDrive({ ...rest(), vx: 200, angVel: -3 }, input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(Math.abs(fighting.angVel)).toBeLessThan(Math.abs(coasting.angVel));
  });

  it("does not bleed spin when steering WITH a NEGATIVE angVel", () => {
    const coasting = stepDrive({ ...rest(), vx: 200, angVel: -3 }, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const going = stepDrive({ ...rest(), vx: 200, angVel: -3 }, input(-1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(going.angVel).toBe(coasting.angVel);
  });

  it("adds steering rotation and injected spin rather than one substituting for the other", () => {
    // Every steering test above uses angVel: 0 and every angVel test above uses steer: 0, so a
    // substitutive integrator — e.g. `angle + (angVel !== 0 ? angVel : steer*turnRate) * dt` —
    // passes the entire rest of this file. Isolating each contribution alone and checking the
    // combination equals their sum is the only thing that can catch that.
    const steerOnly = stepDrive({ ...rest(), vx: 200 }, input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const spinOnly = stepDrive({ ...rest(), vx: 200, angVel: 2 }, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const both = stepDrive({ ...rest(), vx: 200, angVel: 2 }, input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);

    // Preconditions: both contributions are individually non-zero, so the sum has teeth.
    expect(steerOnly.angle).not.toBe(0);
    expect(spinOnly.angle).not.toBe(0);

    expect(both.angle).toBeCloseTo(steerOnly.angle + spinOnly.angle, 9);
  });
});

describe("maneuvers (spec S3 / O13)", () => {
  const movingBody: SimBody = { ...rest(), vx: 200, vy: 0 };

  it("DASH translates at maneuverSpeed along maneuverAngle, ignoring inputs, face welded", () => {
    const restingBody = rest();
    const dashing: SimBody = {
      ...restingBody,
      maneuver: ManeuverKind.DASH,
      maneuverTicksLeft: 8,
      maneuverAngle: Math.PI / 2,
      maneuverSpeed: 1600,
    };
    const out = stepDrive(
      dashing,
      { seq: 1, steer: 1, throttle: -1, fireSlots: 0 },
      DT,
      GOLDEN_CHASSIS,
      NEUTRAL_MODIFIERS,
    );
    expect(out.y).toBeCloseTo(restingBody.y + 1600 * DT);
    expect(out.x).toBeCloseTo(restingBody.x);
    expect(out.angle).toBe(Math.PI / 2); // welded, steer ignored
    expect(out.maneuverTicksLeft).toBe(7);
  });

  it("DASH hands the car back at the chassis speed cap on its last tick", () => {
    const lastTick: SimBody = {
      ...rest(),
      maneuver: ManeuverKind.DASH,
      maneuverTicksLeft: 1,
      maneuverAngle: 0,
      maneuverSpeed: 1600,
    };
    const out = stepDrive(lastTick, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(out.maneuver).toBe(ManeuverKind.NONE);
    expect(fwd(out)).toBeCloseTo(GOLDEN_CHASSIS.maxSpeed);
  });

  it("HOLD pins the car and steers at the stopped turn rate", () => {
    const restingBody = rest();
    const held: SimBody = { ...restingBody, vx: 200, vy: 0, maneuver: ManeuverKind.HOLD, maneuverTicksLeft: 10 };
    const out = stepDrive(held, { seq: 1, steer: 1, throttle: 1, fireSlots: 0 }, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(out.x).toBeCloseTo(restingBody.x); // throttle dead
    expect(fwd(out)).toBe(0);
    expect(out.angle).toBeCloseTo(restingBody.angle + GOLDEN_CHASSIS.turnRateAtStop * DT);
    expect(out.maneuverTicksLeft).toBe(9);
  });

  it("CHARGE drives completely normally and only counts down", () => {
    const charging: SimBody = { ...movingBody, maneuver: ManeuverKind.CHARGE, maneuverTicksLeft: 300 };
    const plain = stepDrive(movingBody, input(0, 1), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const out = stepDrive(charging, input(0, 1), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(out.x).toBe(plain.x);
    expect(fwd(out)).toBe(fwd(plain));
    expect(out.maneuverTicksLeft).toBe(299);
  });

  it("fullStop zeroes the forward component while an imposed lateral velocity still moves the car", () => {
    const stunned: SimBody = { ...movingBody, vx: 250, vy: 100 };
    const out = stepDrive(stunned, input(0, 1), DT, GOLDEN_CHASSIS, { ...NEUTRAL_MODIFIERS, fullStop: true });
    expect(fwd(out)).toBe(0);
    // The slam can still push you into a wall: angle 0, so the imposed lateral component (vy: 100)
    // is what survives fullStop, bled at the flat impactGripDecel rate.
    expect(out.y).toBeCloseTo((100 - DRIVE_CONFIG.impactGripDecel * DT) * DT, 9);
  });
});

describe("dash substep helpers (spec C3 / C6)", () => {
  const dashing: SimBody = {
    ...rest(),
    maneuver: ManeuverKind.DASH,
    maneuverTicksLeft: 8,
    maneuverAngle: 0,
    maneuverSpeed: 1600,
  };

  it("recognises a live dash and nothing else", () => {
    expect(isDashing(dashing)).toBe(true);
    // A dash whose duration has run out is not one: `stepDrive` falls through to ordinary driving
    // on exactly this condition, and the substep gate must agree with it or the two disagree about
    // which body is being stepped.
    expect(isDashing({ ...dashing, maneuverTicksLeft: 0 })).toBe(false);
    expect(isDashing({ ...dashing, maneuver: ManeuverKind.HOLD })).toBe(false);
    expect(isDashing({ ...dashing, maneuver: ManeuverKind.CHARGE })).toBe(false);
    expect(isDashing(rest())).toBe(false);
  });

  it("returns the dash displacement for dt, as a delta rather than a position", () => {
    const full = dashTranslation(dashing, DT);
    expect(full.x).toBeCloseTo(1600 * DT, 9);
    expect(full.y).toBeCloseTo(0, 9);

    const sideways = dashTranslation({ ...dashing, maneuverAngle: Math.PI / 2 }, DT);
    expect(sideways.x).toBeCloseTo(0, 9);
    expect(sideways.y).toBeCloseTo(1600 * DT, 9);
  });

  it("splits a quarter-dt translation into exactly a quarter of the travel", () => {
    const quarter = dashTranslation(dashing, DT / 4);
    expect(quarter.x).toBeCloseTo((1600 * DT) / 4, 9);
  });

  it("derives the substep count from distance, so it survives a retune of speed or tick rate", () => {
    // thunderclap: 1600 u/s at 30Hz = 53.3u per tick against a 16u bound -> 4 substeps.
    expect(dashSubstepCount(dashing, DT)).toBe(4);
    // Derived, not hardcoded: halving the speed halves the travel and needs half the substeps.
    expect(dashSubstepCount({ ...dashing, maneuverSpeed: 800 }, DT)).toBe(2);
    // Exactly on the bound is one substep, not two — `ceil` of exactly 1.
    expect(dashSubstepCount({ ...dashing, maneuverSpeed: DRIVE_CONFIG.dashSubstepMaxUnits / DT }, DT)).toBe(1);
  });

  it("never returns fewer than one substep, however slow the dash", () => {
    expect(dashSubstepCount({ ...dashing, maneuverSpeed: 0 }, DT)).toBe(1);
    expect(dashSubstepCount({ ...dashing, maneuverSpeed: 1 }, DT)).toBe(1);
  });
});
