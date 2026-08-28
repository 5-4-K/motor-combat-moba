import { describe, expect, it } from "vitest";
import { forwardMaxSpeedOf, reverseMaxSpeedOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import type { InputMessage } from "../net/input.js";
import { stepDrive } from "./drive.js";
import type { SimBody } from "./step.js";

const CAR_ID = "rectangle";
const DT = 1 / 30;

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function rest(): SimBody {
  return { x: 0, y: 0, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0, authority: 1 };
}

function drive(body: SimBody, msg: InputMessage, ticks: number): SimBody {
  let next = body;
  for (let i = 0; i < ticks; i++) {
    next = stepDrive(next, msg, DT, CAR_ID);
  }
  return next;
}

describe("stepDrive", () => {
  it("holds Up from rest: speed increases and x moves along angle (angle 0 -> +x)", () => {
    const out = drive(rest(), input(0, 1), 10);
    expect(out.speed).toBeGreaterThan(0);
    expect(out.angle).toBe(0);
    expect(out.x).toBeGreaterThan(0);
    expect(out.y).toBe(0);
  });

  it("reaches (and does not exceed) forwardMaxSpeedOf(carId) after sustained throttle", () => {
    const out = drive(rest(), input(0, 1), 1000);
    expect(out.speed).toBeCloseTo(forwardMaxSpeedOf(CAR_ID));
  });

  it("from high +speed, holding Down brakes the speed down before it goes negative", () => {
    const highSpeed: SimBody = {
      x: 0,
      y: 0,
      angle: 0,
      speed: forwardMaxSpeedOf(CAR_ID),
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const out = stepDrive(highSpeed, input(0, -1), DT, CAR_ID);
    expect(out.speed).toBeLessThan(highSpeed.speed);
    expect(out.speed).toBeGreaterThanOrEqual(0);
  });

  it("from rest, holding Down for reverseHoldTicks then more goes negative, clamped to the reverse max", () => {
    const atThreshold = drive(rest(), input(0, -1), DRIVE_CONFIG.reverseHoldTicks);
    expect(atThreshold.speed).toBeLessThan(0);

    const held = drive(atThreshold, input(0, -1), 500);
    expect(held.speed).toBeLessThan(0);
    expect(Math.abs(held.speed)).toBeLessThanOrEqual(reverseMaxSpeedOf(CAR_ID));
    expect(reverseMaxSpeedOf(CAR_ID)).toBeCloseTo(
      forwardMaxSpeedOf(CAR_ID) * DRIVE_CONFIG.reverseSpeedRatio,
      9,
    );
    expect(held.reverseHold).toBe(DRIVE_CONFIG.reverseHoldTicks);
  });

  it("accelerates backward at reverseAccel, not the forward accel", () => {
    // Reverse gets its own rate so backing out of a fight is not gated by the forward curve.
    const down = input(0, -1);
    const engaged = drive(rest(), down, DRIVE_CONFIG.reverseHoldTicks);
    expect(engaged.speed).toBeLessThan(0);

    const next = stepDrive(engaged, down, DT, CAR_ID);
    expect(engaged.speed - next.speed).toBeCloseTo(DRIVE_CONFIG.reverseAccel * DT, 6);
  });

  it("brakes through zero into reverse without overshoot, only reverses past the hold threshold, and pins at the cap", () => {
    const down = input(0, -1);
    let body: SimBody = {
      x: 0,
      y: 0,
      angle: 0,
      speed: forwardMaxSpeedOf(CAR_ID),
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    let sawZero = false;
    let wentNegative = false;

    for (let tick = 0; tick < 25; tick++) {
      body = stepDrive(body, down, DT, CAR_ID);
      if (!sawZero) {
        // Braking phase: speed must reach exactly 0 without ever overshooting negative, and the
        // reverse-hold delay must not start accumulating until the car is actually at rest.
        expect(body.speed).toBeGreaterThanOrEqual(0);
        expect(body.reverseHold).toBe(0);
        if (body.speed === 0) sawZero = true;
      } else if (!wentNegative) {
        if (body.speed < 0) {
          wentNegative = true;
          // Reverse only engages once the hold delay has fully accumulated.
          expect(body.reverseHold).toBe(DRIVE_CONFIG.reverseHoldTicks);
        }
      }
    }

    expect(sawZero).toBe(true);
    expect(wentNegative).toBe(true);

    const pinned = drive(body, down, 500);
    expect(pinned.speed).toBe(-reverseMaxSpeedOf(CAR_ID));
  });

  it("holding Up from reverse brakes to exactly 0 without overshoot, then accelerates forward", () => {
    const up = input(0, 1);
    let body: SimBody = {
      x: 0,
      y: 0,
      angle: 0,
      speed: -reverseMaxSpeedOf(CAR_ID),
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    let sawZero = false;

    for (let tick = 0; tick < 15; tick++) {
      body = stepDrive(body, up, DT, CAR_ID);
      if (!sawZero) {
        expect(body.speed).toBeLessThanOrEqual(0);
        if (body.speed === 0) sawZero = true;
      } else {
        expect(body.speed).toBeGreaterThanOrEqual(0);
      }
    }

    expect(sawZero).toBe(true);
    expect(body.speed).toBeGreaterThan(0);
  });

  it("does not re-arm the reverse hold delay when briefly coasting mid-reverse", () => {
    const down = input(0, -1);
    const reversing = drive(rest(), down, DRIVE_CONFIG.reverseHoldTicks + 5);
    expect(reversing.speed).toBeLessThan(0);

    // Release Down for exactly one tick.
    const afterCoast = stepDrive(reversing, input(0, 0), DT, CAR_ID);
    expect(afterCoast.reverseHold).toBe(0);
    expect(afterCoast.speed).toBeLessThan(0);

    // Re-press Down: speed must keep getting more negative immediately, never freeze.
    const resumed = stepDrive(afterCoast, down, DT, CAR_ID);
    expect(resumed.speed).toBeLessThan(afterCoast.speed);
    expect(resumed.reverseHold).toBe(DRIVE_CONFIG.reverseHoldTicks);
  });

  it("Left steer increases angle (CCW); Right steer decreases it", () => {
    const left = stepDrive(rest(), input(1, 0), DT, CAR_ID);
    const right = stepDrive(rest(), input(-1, 0), DT, CAR_ID);
    expect(left.angle).toBeGreaterThan(0);
    expect(right.angle).toBeLessThan(0);
  });

  it("turns faster while moving than while stopped (turnRate vs turnRateAtStop)", () => {
    expect(DRIVE_CONFIG.turnRate).toBeGreaterThan(DRIVE_CONFIG.turnRateAtStop);

    const steerLeft = input(1, 0);
    const stopped = stepDrive(rest(), steerLeft, DT, CAR_ID);
    const movingBody: SimBody = {
      x: 0,
      y: 0,
      angle: 0,
      speed: 100,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const moving = stepDrive(movingBody, steerLeft, DT, CAR_ID);

    expect(moving.angle).toBeGreaterThan(stopped.angle);
  });

  it("coasting (throttle 0) reduces |speed| via drag from a positive speed", () => {
    const moving: SimBody = {
      x: 0,
      y: 0,
      angle: 0,
      speed: 100,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const out = stepDrive(moving, input(0, 0), DT, CAR_ID);
    expect(out.speed).toBeLessThan(moving.speed);
    expect(out.speed).toBeGreaterThanOrEqual(0);
  });

  it("coasting (throttle 0) reduces |speed| via drag from a negative speed", () => {
    const movingReverse: SimBody = {
      x: 0,
      y: 0,
      angle: 0,
      speed: -100,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const out = stepDrive(movingReverse, input(0, 0), DT, CAR_ID);
    expect(out.speed).toBeGreaterThan(movingReverse.speed);
    expect(out.speed).toBeLessThanOrEqual(0);
  });

  it("coasting from a sub-stopEpsilon speed settles to exact rest in one tick", () => {
    const barelyMoving: SimBody = {
      x: 0,
      y: 0,
      angle: 0,
      speed: DRIVE_CONFIG.stopEpsilon / 2,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const out = stepDrive(barelyMoving, input(0, 0), DT, CAR_ID);
    expect(out.speed).toBe(0);
  });

  it("steers at turnRateAtStop below stopEpsilon and at turnRate above it", () => {
    // stopEpsilon is the band that decides which steering rate applies, so it is sim logic and
    // belongs in config rather than as a literal in drive.ts.
    const crawling: SimBody = {
      x: 0,
      y: 0,
      angle: 0,
      speed: DRIVE_CONFIG.stopEpsilon / 2,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const rolling: SimBody = { ...crawling, speed: DRIVE_CONFIG.stopEpsilon * 2 };

    expect(stepDrive(crawling, input(1, 0), DT, CAR_ID).angle).toBeCloseTo(
      DRIVE_CONFIG.turnRateAtStop * DT,
      9,
    );
    expect(stepDrive(rolling, input(1, 0), DT, CAR_ID).angle).toBeCloseTo(
      DRIVE_CONFIG.turnRate * DT,
      9,
    );
  });
});

describe("stepDrive: ram knock state", () => {
  it("rotates the car from angVel with no steering input", () => {
    const out = stepDrive({ ...rest(), angVel: 2 }, input(0, 0), DT, CAR_ID);
    expect(out.angle).toBeCloseTo(2 * DT, 9);
  });

  it("decays angVel toward zero and snaps inside the epsilon", () => {
    const spun = drive({ ...rest(), angVel: 3 }, input(0, 0), 1);
    expect(Math.abs(spun.angVel)).toBeLessThan(3);
    const settled = drive({ ...rest(), angVel: 3 }, input(0, 0), 300);
    expect(settled.angVel).toBe(0);
  });

  it("translates the car from shove with no throttle", () => {
    const out = stepDrive({ ...rest(), shoveX: 120, shoveY: -60 }, input(0, 0), DT, CAR_ID);
    expect(out.x).toBeCloseTo(120 * DT, 9);
    expect(out.y).toBeCloseTo(-60 * DT, 9);
  });

  it("decays shove toward zero and snaps inside the epsilon", () => {
    const settled = drive({ ...rest(), shoveX: 200, shoveY: 200 }, input(0, 0), 300);
    expect(settled.shoveX).toBe(0);
    expect(settled.shoveY).toBe(0);
  });

  it("adds shove to drive velocity rather than replacing it", () => {
    const out = stepDrive({ ...rest(), speed: 300, shoveY: 150 }, input(0, 0), DT, CAR_ID);
    // angle 0, so drive motion is +x and the shove is +y. Both must survive.
    expect(out.x).toBeGreaterThan(0);
    expect(out.y).toBeCloseTo(150 * DT, 9);
  });

  it("scales steering by authority", () => {
    const full = stepDrive({ ...rest(), speed: 200 }, input(1, 0), DT, CAR_ID);
    const half = stepDrive({ ...rest(), speed: 200, authority: 0.5 }, input(1, 0), DT, CAR_ID);
    expect(half.angle).toBeCloseTo(full.angle * 0.5, 9);
  });

  it("does NOT scale throttle by authority — a knocked player can always drive out", () => {
    const full = stepDrive(rest(), input(0, 1), DT, CAR_ID);
    const crushed = stepDrive({ ...rest(), authority: RAM_CONFIG.authorityFloor }, input(0, 1), DT, CAR_ID);
    expect(crushed.speed).toBe(full.speed);
  });

  it("does NOT scale braking by authority", () => {
    const full = stepDrive({ ...rest(), speed: 300 }, input(0, -1), DT, CAR_ID);
    const crushed = stepDrive({ ...rest(), speed: 300, authority: RAM_CONFIG.authorityFloor }, input(0, -1), DT, CAR_ID);
    expect(crushed.speed).toBe(full.speed);
  });

  it("recovers authority back toward 1 and snaps at full control", () => {
    const one = drive({ ...rest(), authority: 0.35 }, input(0, 0), 1);
    expect(one.authority).toBeGreaterThan(0.35);
    expect(one.authority).toBeLessThan(1);
    const settled = drive({ ...rest(), authority: 0.35 }, input(0, 0), 300);
    expect(settled.authority).toBe(1);
  });

  it("bleeds spin faster when steering against it than when coasting", () => {
    const coasting = stepDrive({ ...rest(), speed: 200, angVel: 3 }, input(0, 0), DT, CAR_ID);
    const fighting = stepDrive({ ...rest(), speed: 200, angVel: 3 }, input(-1, 0), DT, CAR_ID);
    expect(fighting.angVel).toBeLessThan(coasting.angVel);
  });

  it("does not bleed spin when steering WITH it", () => {
    const coasting = stepDrive({ ...rest(), speed: 200, angVel: 3 }, input(0, 0), DT, CAR_ID);
    const going = stepDrive({ ...rest(), speed: 200, angVel: 3 }, input(1, 0), DT, CAR_ID);
    expect(going.angVel).toBe(coasting.angVel);
  });
});
