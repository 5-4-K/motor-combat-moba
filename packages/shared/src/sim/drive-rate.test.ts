import { describe, expect, it } from "vitest";
import type { ChassisDrive } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { stepDrive } from "./drive.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import { speedOf } from "./velocity.js";

/**
 * Proof of U7: every per-tick factor lives on `ChassisDrive`, resolved once from a per-second rate
 * (`perTickDecay`), never inside `stepDrive` itself. This is what makes raising `TICK_RATE_HZ` a
 * config change rather than a rebalance — `stepDrive` reads no module-level rate of its own, so a
 * chassis resolved at a different tick rate is a different `ChassisDrive`, not a different function.
 *
 * The same chassis resolved at an arbitrary tick rate — exactly what `resolveChassisDrive` does.
 */
function chassisAt(hz: number): ChassisDrive {
  const dragRate = 1.0;
  return {
    maxSpeed: 200,
    engineAccel: 200,
    reverseAccel: 80,
    brakeDecel: 500,
    turnRate: 2,
    dragRate,
    dragPerTick: Math.exp(-dragRate / hz),
    gripPerTick: Math.exp(-DRIVE_CONFIG.lateralGripRate / hz),
    spinPerTick: 1,
  };
}

function run(hz: number, ticks: number) {
  let b = {
    x: 0,
    y: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    angVel: 0,
    maneuver: 0,
    maneuverTicksLeft: 0,
    maneuverAngle: 0,
    maneuverSpeed: 0,
  };
  for (let i = 0; i < ticks; i++) {
    b = stepDrive(b, { seq: 0, steer: 1, throttle: 1, fireSlots: 0 }, 1 / hz, chassisAt(hz), NEUTRAL_MODIFIERS);
  }
  return b;
}

describe("the drive model is tick-rate independent", () => {
  it("puts a car in the same place after one second at 30 Hz and at 60 Hz", () => {
    const slow = run(30, 30);
    const fast = run(60, 60);
    // Euler integration is not exact, so this is a tolerance, not an equality: a car covering ~180
    // units in that second must land within a tenth of a hull length of itself.
    expect(Math.hypot(fast.x - slow.x, fast.y - slow.y)).toBeLessThan(DRIVE_CONFIG.carWidth / 10);
    expect(fast.angle).toBeCloseTo(slow.angle, 6);
    expect(speedOf(fast.vx, fast.vy)).toBeCloseTo(speedOf(slow.vx, slow.vy), 0);
  });
});
