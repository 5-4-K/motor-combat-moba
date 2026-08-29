import { describe, expect, it } from "vitest";
import type { InputMessage } from "../net/input.js";
import { resolveWorld } from "./collide.js";
import { stepDrive } from "./drive.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import type { SimBody } from "./step.js";

/**
 * Behaviour frozen from the implementation as it stood on 2026-08-29, before ram CC was added.
 *
 * The ram work adds `angVel`, `shoveX`, `shoveY`, and `authority` to `SimBody` as terms that are
 * ADDED to the existing integration, never substituted into it. At neutral state those terms
 * contribute exactly zero, so every number below must survive the change untouched. If one of these
 * moves, the additive property has been broken and the change is wrong — do not re-record them.
 *
 * Only the `body()` fixture below may gain the new fields (at neutral values). No expectation here
 * may be edited.
 */
const DT = 1 / 30;
const CAR_ID = "mirage";

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function body(over: Partial<SimBody> = {}): SimBody {
  return {
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    reverseHold: 0,
    angVel: 0,
    shoveX: 0,
    shoveY: 0,
    authority: 1,
    ...over,
  };
}

function drive(start: SimBody, msg: InputMessage, ticks: number): SimBody {
  let next = start;
  // `NEUTRAL_MODIFIERS`, and only ever that: the status work adds a fifth argument whose
  // neutral value multiplies every drive constant by exactly 1. Every number below must survive
  // that unchanged, the same contract the ram fields are held to above. If one of these moves,
  // the multiplicative property has been broken and the change is wrong — do not re-record them.
  for (let i = 0; i < ticks; i++) next = stepDrive(next, msg, DT, CAR_ID, NEUTRAL_MODIFIERS);
  return next;
}

function expectPose(actual: SimBody, x: number, y: number, angle: number, speed: number): void {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
  expect(actual.angle).toBeCloseTo(angle, 9);
  expect(actual.speed).toBeCloseTo(speed, 9);
}

describe("golden: stepDrive is unchanged by the ram work", () => {
  it("accelerates straight for 10 ticks", () => {
    expectPose(drive(body(), input(0, 1), 10), 47.6666666667, 0, 0, 260);
  });

  it("accelerates while turning right for 10 ticks", () => {
    expectPose(drive(body(), input(1, 1), 10), 27.434465046, 35.5795364692, 1.33, 260);
  });

  it("turns left under throttle for 25 ticks, capped at top speed", () => {
    expectPose(drive(body(), input(-1, 1), 25), -131.5066473051, -136.8263554597, -3.43, 540);
  });

  it("coasts from 300 for 8 ticks", () => {
    expectPose(drive(body({ speed: 300 }), input(0, 0), 8), 44, 0, 0, 60);
  });

  it("brakes from 300 to rest in 6 ticks", () => {
    expectPose(drive(body({ speed: 300 }), input(0, -1), 6), 23.3333333333, 0, 0, 0);
  });

  it("engages reverse from rest after the hold delay", () => {
    const out = drive(body(), input(0, -1), 12);
    expectPose(out, -78.4, 0, 0, -351);
    expect(out.reverseHold).toBe(2);
  });

  it("accelerates and turns from a non-zero heading", () => {
    expectPose(drive(body({ angle: 0.7 }), input(1, 1), 15), -45.2471561479, 79.1894268095, 2.73, 390);
  });
});

describe("golden: resolveWorld is unchanged by the ram work", () => {
  const bounds = { width: 1000, height: 800 };

  it("bounces off the left wall", () => {
    const out = resolveWorld(body({ x: 10, y: 400, speed: 200, angle: Math.PI }), [], [], bounds);
    expectPose(out, 24, 400, Math.PI, -70);
  });

  it("reflects off both walls at a corner", () => {
    const out = resolveWorld(body({ x: 5, y: 4, speed: 150, angle: Math.PI * 1.25 }), [], [], bounds);
    expectPose(out, 28.2842712475, 28.2842712475, 3.926990817, 84.1875);
  });

  it("separates from another car", () => {
    const other = { x: 530, y: 400, angle: 0, w: 48, h: 32 };
    const out = resolveWorld(body({ x: 500, y: 400, speed: 250, angle: 0 }), [other], [], bounds);
    expectPose(out, 482, 400, 0, -87.5);
  });

  it("separates from an obstacle", () => {
    const obstacle = { x: 320, y: 290, w: 60, h: 60 };
    const out = resolveWorld(body({ x: 300, y: 300, speed: 180, angle: 0.4 }), [], [obstacle], bounds);
    expectPose(out, 291.663842667, 300, 0.4, -90.997064641);
  });

  it("leaves a free body untouched", () => {
    const out = resolveWorld(body({ x: 500, y: 400, speed: 100, angle: 1.1 }), [], [], bounds);
    expectPose(out, 500, 400, 1.1, 100);
  });
});
