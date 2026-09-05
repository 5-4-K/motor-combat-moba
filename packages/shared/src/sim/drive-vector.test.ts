import { describe, expect, it } from "vitest";
import type { ChassisDrive } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { InputMessage } from "../net/input.js";
import { stepDrive } from "./drive.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import type { SimBody } from "./step.js";
import { forwardOf, lateralOf } from "./velocity.js";

const DT = 1 / 30;

/**
 * A fixed chassis, frozen here rather than read from `CAR_TABLE`. These expectations pin the SHAPE
 * of the new integration, not the roster's balance — every car's ratings must stay free to move
 * without any number below moving with them. Same principle as `golden.test.ts`.
 */
const CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 300,
  reverseMaxSpeed: 195,
  accel: 200,
  reverseAccel: 282,
  turnRate: 6.3,
  turnRateAtStop: 3.15,
  coastPerTick: 0.5 ** (1 / (1.0 * 30)), // a 1.0s half-life at 30Hz — tick-count-frozen, not
  // seconds-frozen: this stays correct if a future netcode phase moves TICK_RATE_HZ, because DT
  // above is hardcoded to 1/30 in lockstep with it, not read from config.
  brakeDecel: 500,
});

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function body(over: Partial<SimBody> = {}): SimBody {
  return {
    x: 0, y: 0, angle: 0,
    vx: 0, vy: 0,
    reverseHold: 0,
    angVel: 0,
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
    ...over,
  };
}

describe("vector drive: throttle acts on the forward component", () => {
  it("accelerates along the heading from rest", () => {
    const next = stepDrive(body(), input(0, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(CHASSIS.accel * DT);
    expect(lateralOf(next.vx, next.vy, next.angle)).toBeCloseTo(0);
  });

  it("clamps forward speed to the chassis maximum", () => {
    const next = stepDrive(body({ vx: 295, vy: 0 }), input(0, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(CHASSIS.maxSpeed);
  });

  it("brakes at the chassis flat rate while rolling forward", () => {
    const next = stepDrive(body({ vx: 200, vy: 0 }), input(0, -1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(200 - CHASSIS.brakeDecel * DT);
  });
});

describe("vector drive: coasting is speed-proportional", () => {
  it("sheds a fixed FRACTION per tick, not a fixed amount", () => {
    const fast = stepDrive(body({ vx: 300, vy: 0 }), input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    const slow = stepDrive(body({ vx: 30, vy: 0 }), input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    const fastLoss = 300 - forwardOf(fast.vx, fast.vy, fast.angle);
    const slowLoss = 30 - forwardOf(slow.vx, slow.vy, slow.angle);
    // Ten times the speed sheds ten times the speed. Flat drag would shed the same amount.
    expect(fastLoss / slowLoss).toBeCloseTo(10, 1);
  });

  it("halves the speed over one half-life", () => {
    let b = body({ vx: 300, vy: 0 });
    for (let i = 0; i < 30; i++) b = stepDrive(b, input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(b.vx, b.vy, b.angle)).toBeCloseTo(150, 0);
  });

  it("snaps to true rest inside stopEpsilon rather than creeping forever", () => {
    let b = body({ vx: DRIVE_CONFIG.stopEpsilon / 2, vy: 0 });
    b = stepDrive(b, input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
  });
});

describe("vector drive: steering grip", () => {
  it("at grip 1.0 the velocity follows the nose exactly, leaving no lateral", () => {
    // A car doing 300 that turns hard should still be doing ~300 straight ahead afterwards.
    const next = stepDrive(body({ vx: 300, vy: 0 }), input(1, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(next.angle).toBeGreaterThan(0); // it did turn
    expect(lateralOf(next.vx, next.vy, next.angle)).toBeCloseTo(0);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeGreaterThan(295);
  });

  it("steers at the at-rest rate when stopped", () => {
    const next = stepDrive(body(), input(1, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(next.angle).toBeCloseTo(CHASSIS.turnRateAtStop * DT);
  });
});

describe("vector drive: imposed lateral velocity", () => {
  it("bleeds sideways motion at the flat impact-grip rate", () => {
    const next = stepDrive(body({ vx: 0, vy: 200 }), input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    // Facing +x, so all 200 is lateral. It loses impactGripDecel * dt.
    expect(lateralOf(next.vx, next.vy, next.angle)).toBeCloseTo(
      200 - DRIVE_CONFIG.impactGripDecel * DT,
    );
  });

  it("never overshoots through zero", () => {
    const tiny = DRIVE_CONFIG.impactGripDecel * DT * 0.25;
    const next = stepDrive(body({ vx: 0, vy: tiny }), input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(lateralOf(next.vx, next.vy, next.angle)).toBeCloseTo(0);
  });

  it("bleeds lateral independently of forward, so a shoved car keeps driving", () => {
    const next = stepDrive(body({ vx: 200, vy: 100 }), input(0, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeGreaterThan(200); // still accelerating
    expect(lateralOf(next.vx, next.vy, next.angle)).toBeLessThan(100);    // and still recovering
  });
});

describe("vector drive: reverse", () => {
  it("does not engage reverse until the hold delay elapses at rest", () => {
    let b = body();
    b = stepDrive(b, input(0, -1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(b.vx, b.vy, b.angle)).toBeCloseTo(0);
    expect(b.reverseHold).toBe(1);
  });

  it("reverses once the hold delay is satisfied, clamped to the reverse cap", () => {
    let b = body({ reverseHold: DRIVE_CONFIG.reverseHoldTicks });
    for (let i = 0; i < 200; i++) b = stepDrive(b, input(0, -1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(b.vx, b.vy, b.angle)).toBeCloseTo(-CHASSIS.reverseMaxSpeed);
  });
});
