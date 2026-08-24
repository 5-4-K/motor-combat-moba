import { describe, expect, it } from "vitest";
import { forwardMaxSpeedOf, reverseMaxSpeedOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { InputMessage } from "../net/input.js";
import { stepDrive } from "./drive.js";
import type { SimBody } from "./step.js";

const CAR_ID = "rectangle";
const DT = 1 / 30;

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fire: false };
}

function rest(): SimBody {
  return { x: 0, y: 0, angle: 0, speed: 0, reverseHold: 0 };
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
    const highSpeed: SimBody = { x: 0, y: 0, angle: 0, speed: forwardMaxSpeedOf(CAR_ID), reverseHold: 0 };
    const out = stepDrive(highSpeed, input(0, -1), DT, CAR_ID);
    expect(out.speed).toBeLessThan(highSpeed.speed);
    expect(out.speed).toBeGreaterThanOrEqual(0);
  });

  it("from rest, holding Down for reverseHoldTicks then more goes negative, clamped to half forward max", () => {
    const atThreshold = drive(rest(), input(0, -1), DRIVE_CONFIG.reverseHoldTicks);
    expect(atThreshold.speed).toBeLessThan(0);

    const held = drive(atThreshold, input(0, -1), 500);
    expect(held.speed).toBeLessThan(0);
    expect(Math.abs(held.speed)).toBeLessThanOrEqual(reverseMaxSpeedOf(CAR_ID));
    expect(reverseMaxSpeedOf(CAR_ID)).toBe(forwardMaxSpeedOf(CAR_ID) / 2);
  });

  it("brakes through zero into reverse without overshoot, only reverses past the hold threshold, and pins at the cap", () => {
    const down = input(0, -1);
    let body: SimBody = { x: 0, y: 0, angle: 0, speed: forwardMaxSpeedOf(CAR_ID), reverseHold: 0 };
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
    let body: SimBody = { x: 0, y: 0, angle: 0, speed: -reverseMaxSpeedOf(CAR_ID), reverseHold: 0 };
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
    const movingBody: SimBody = { x: 0, y: 0, angle: 0, speed: 100, reverseHold: 0 };
    const moving = stepDrive(movingBody, steerLeft, DT, CAR_ID);

    expect(moving.angle).toBeGreaterThan(stopped.angle);
  });

  it("coasting (throttle 0) reduces |speed| via drag from a positive speed", () => {
    const moving: SimBody = { x: 0, y: 0, angle: 0, speed: 100, reverseHold: 0 };
    const out = stepDrive(moving, input(0, 0), DT, CAR_ID);
    expect(out.speed).toBeLessThan(moving.speed);
    expect(out.speed).toBeGreaterThanOrEqual(0);
  });

  it("coasting (throttle 0) reduces |speed| via drag from a negative speed", () => {
    const movingReverse: SimBody = { x: 0, y: 0, angle: 0, speed: -100, reverseHold: 0 };
    const out = stepDrive(movingReverse, input(0, 0), DT, CAR_ID);
    expect(out.speed).toBeGreaterThan(movingReverse.speed);
    expect(out.speed).toBeLessThanOrEqual(0);
  });
});
