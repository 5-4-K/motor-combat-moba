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
  });

  it("never exceeds forwardMaxSpeedOf(carId) even after sustained throttle", () => {
    const out = drive(rest(), input(0, 1), 1000);
    expect(out.speed).toBeLessThanOrEqual(forwardMaxSpeedOf(CAR_ID));
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

  it("Left steer increases angle (CCW); Right steer decreases it", () => {
    const left = stepDrive(rest(), input(1, 0), DT, CAR_ID);
    const right = stepDrive(rest(), input(-1, 0), DT, CAR_ID);
    expect(left.angle).toBeGreaterThan(0);
    expect(right.angle).toBeLessThan(0);
  });

  it("coasting (throttle 0) reduces |speed| via drag", () => {
    const moving: SimBody = { x: 0, y: 0, angle: 0, speed: 100, reverseHold: 0 };
    const out = stepDrive(moving, input(0, 0), DT, CAR_ID);
    expect(out.speed).toBeLessThan(moving.speed);
    expect(out.speed).toBeGreaterThanOrEqual(0);
  });
});
