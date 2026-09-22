import { beforeEach, describe, expect, it } from "vitest";
import { installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import type { ChassisDrive } from "../config/car-config.js";
import { DRIVE_CONFIG, perTickDecay } from "../config/drive-config.js";
import { TICK_RATE_HZ } from "../constants.js";
import type { InputMessage } from "../net/input.js";
import { stepDrive } from "./drive.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import type { SimBody } from "./step.js";
import { forwardOf, lateralOf, toWorld } from "./velocity.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const DT = 1 / TICK_RATE_HZ;
const DRAG_RATE = 1.0;
// The lateral component takes drag AND grip (see "decays a coasting car ... in both components"
// below), so the steady-state slip angle it settles at is `atan(turnRate / (DRAG_RATE +
// GRIP_RATE))`, not `atan(turnRate / GRIP_RATE)` alone — drag is the extra sideways bleed grip
// shares the vector with, not a separate channel the slip angle can ignore.
const GRIP_RATE = 3;
const CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 200,
  engineAccel: 200,        // maxSpeed * dragRate
  reverseAccel: 80,        // engineAccel * 0.4
  brakeDecel: 500,
  turnRate: 2,
  dragRate: DRAG_RATE,
  dragPerTick: perTickDecay(DRAG_RATE),
  gripPerTick: perTickDecay(GRIP_RATE),
  spinPerTick: 1,
});

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function body(over: Partial<SimBody> = {}): SimBody {
  return {
    x: 0, y: 0, angle: 0,
    vx: 0, vy: 0,
    angVel: 0,
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
    ...over,
  };
}

describe("vector drive: the Unity drag/grip model", () => {
  it("approaches top speed asymptotically instead of clamping to it", () => {
    let b = body({ vx: 0, vy: 0 });
    for (let i = 0; i < TICK_RATE_HZ * 10; i++) b = stepDrive(b, input(0, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    const speed = forwardOf(b.vx, b.vy, b.angle);
    expect(speed).toBeLessThan(CHASSIS.maxSpeed);
    expect(speed).toBeGreaterThan(CHASSIS.maxSpeed * 0.99);
  });

  it("reaches 90% of top speed after ln(10) time constants", () => {
    const ticks = Math.round((Math.log(10) / DRAG_RATE) * TICK_RATE_HZ);
    let b = body({ vx: 0, vy: 0 });
    for (let i = 0; i < ticks; i++) b = stepDrive(b, input(0, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(b.vx, b.vy, b.angle)).toBeCloseTo(CHASSIS.maxSpeed * 0.9, 0);
  });

  it("decays a coasting car by the drag factor every tick, in both components", () => {
    const b0 = body({ ...toWorld(0, 100, 40) });
    const b1 = stepDrive(b0, input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(b1.vx, b1.vy, b1.angle)).toBeCloseTo(100 * CHASSIS.dragPerTick, 9);
    // The lateral component takes drag AND grip.
    expect(lateralOf(b1.vx, b1.vy, b1.angle)).toBeCloseTo(40 * CHASSIS.dragPerTick * CHASSIS.gripPerTick, 9);
  });

  it("scales grip by the `grip` modifier, so a shove can be made to ride longer", () => {
    const b0 = body({ ...toWorld(0, 0, 100) });
    const reeling = stepDrive(b0, input(0, 0), DT, CHASSIS, { ...NEUTRAL_MODIFIERS, grip: 0.6 });
    expect(lateralOf(reeling.vx, reeling.vy, reeling.angle)).toBeCloseTo(
      100 * CHASSIS.dragPerTick * CHASSIS.gripPerTick ** 0.6, 9);

    // `grip: 0` is the Unity "no grip at all" case: drag alone. Out of STATUS_LIMITS' reach for a
    // status, reachable here, and the proof the power form degenerates correctly.
    const puck = stepDrive(b0, input(0, 0), DT, CHASSIS, { ...NEUTRAL_MODIFIERS, grip: 0 });
    expect(lateralOf(puck.vx, puck.vy, puck.angle)).toBeCloseTo(100 * CHASSIS.dragPerTick, 9);
  });

  it("drifts: turning at speed leaves velocity pointing where the car WAS going", () => {
    let b = body({ ...toWorld(0, 150, 0) });
    for (let i = 0; i < 10; i++) b = stepDrive(b, input(1, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(Math.abs(lateralOf(b.vx, b.vy, b.angle))).toBeGreaterThan(1);
  });

  it("settles at the slip angle the two rates predict, holding full lock", () => {
    let b = body({ ...toWorld(0, 150, 0) });
    for (let i = 0; i < TICK_RATE_HZ * 5; i++) b = stepDrive(b, input(1, 1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    const slip = Math.abs(Math.atan2(lateralOf(b.vx, b.vy, b.angle), forwardOf(b.vx, b.vy, b.angle)));
    expect(slip).toBeCloseTo(Math.atan(CHASSIS.turnRate / (DRAG_RATE + GRIP_RATE)), 1);
  });

  it("turns at the same rate stopped as at speed", () => {
    const stopped = stepDrive(body({ vx: 0, vy: 0 }), input(1, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    const rolling = stepDrive(body({ ...toWorld(0, 150, 0) }), input(1, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(stopped.angle).toBeCloseTo(CHASSIS.turnRate * DT, 9);
    expect(rolling.angle).toBeCloseTo(CHASSIS.turnRate * DT, 9);
  });

  it("leaves the steering sense alone while the reverse flip is switched off", () => {
    // `DRIVE_CONFIG.flipSteeringInReverse` is OFF for the tuning pass (see its doc comment): the
    // predicate reads the car-frame forward component, which drift drives negative mid-corner, so
    // it chattered and inverted the steering several times a second. The machinery is kept, so this
    // case reads the knob rather than hard-coding an answer — it stays true whichever way it is set,
    // and it is what will catch the flip silently not working if someone turns it back on without
    // fixing the predicate first.
    const reversing = stepDrive(body({ ...toWorld(0, -50, 0) }), input(1, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    const atRest = stepDrive(body({ vx: 0, vy: 0 }), input(1, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    // At rest the sense is never flipped, whatever the knob says: the flip needs `forward < -reverseEpsilon`.
    expect(atRest.angle).toBeGreaterThan(0);
    if (DRIVE_CONFIG.flipSteeringInReverse) {
      expect(reversing.angle).toBeLessThan(0);
    } else {
      // Same steer input, same sense as going forwards — tank-style absolute steering.
      expect(reversing.angle).toBeGreaterThan(0);
      expect(reversing.angle).toBeCloseTo(atRest.angle, 12);
    }
  });

  it("brakes while rolling forward and reverses once nearly stopped, with no hold delay", () => {
    // FIXED (same root cause as the asymptote/90%/slip cases, and the same fix the coordinator
    // ruled on for those): every command channel — throttle, brake, reverse — goes through the
    // exact drag/command integrator (`commandFactorOf` in drive.ts), not a flat `* DT`. This case
    // originally passed under the old, uniformly-explicit-Euler model (both the model's forcing
    // term AND this test's expectation used flat `* DT`, so they agreed by coincidence). Fixing
    // the model to be tick-rate independent exposed the same flat-`DT` assumption here that was
    // already wrong in the three cases above. `commandFactor` below is `commandFactorOf`'s own
    // formula at `mods.accel: 1` (so `rate === dragRate`), duplicated rather than imported since
    // `commandFactorOf` is drive.ts-private.
    const commandFactor = (1 - CHASSIS.dragPerTick) / CHASSIS.dragRate;
    const braking = stepDrive(body({ ...toWorld(0, 100, 0) }), input(0, -1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(braking.vx, braking.vy, braking.angle)).toBeCloseTo(
      100 * CHASSIS.dragPerTick - CHASSIS.brakeDecel * commandFactor, 9);
    const engaging = stepDrive(body({ vx: 0, vy: 0 }), input(0, -1), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(forwardOf(engaging.vx, engaging.vy, engaging.angle)).toBeCloseTo(-CHASSIS.reverseAccel * commandFactor, 9);
  });

  it("scales drag as a power, so `accel: 0` holds a speed instead of stopping the car", () => {
    const held = stepDrive(body({ ...toWorld(0, 120, 0) }), input(0, 1), DT, CHASSIS,
      { ...NEUTRAL_MODIFIERS, accel: 0 });
    expect(forwardOf(held.vx, held.vy, held.angle)).toBeCloseTo(120, 9);
  });

  it("still settles at maxSpeed under a non-neutral accel, not just at accel: 1 or accel: 0", () => {
    // The one-tick `accel: 0` case above proves the power form holds a speed; it cannot tell a
    // correct `commandFactorOf` from a broken one, because at rest the two halves (decay and
    // command) never disagree — `v` starts at 0, so drag has nothing to act on yet. This steps to
    // STEADY STATE under `accel: 0.5`, where they do: `dragFactorOf` raises `dragPerTick` to the
    // `accel` power, and `commandFactorOf`'s `rate` is `dragRate * accel` — the SAME exponent, on
    // purpose, so halving it halves the decay AND the command coefficient together and the
    // equilibrium (`engineAccel / (dragRate * accel)`... which is `chassis.maxSpeed`, `accel`
    // cancelling out) is invariant to `accel` entirely. This is exactly the property that would
    // break if `commandFactorOf` and `dragFactorOf` were ever "simplified" to use different
    // exponents, or if `commandFactorOf` used `chassis.dragRate` unscaled while `dragFactorOf`
    // kept scaling by `mods.accel`.
    // Twice the ticks of the neutral-`accel` asymptote case above: halving `accel` halves the
    // EFFECTIVE rate too (`dragRate * accel`), so the time constant doubles and the same number of
    // ticks converges only half as far. 20s is still 10 time constants at the halved rate.
    let b = body({ vx: 0, vy: 0 });
    for (let i = 0; i < TICK_RATE_HZ * 20; i++) {
      b = stepDrive(b, input(0, 1), DT, CHASSIS, { ...NEUTRAL_MODIFIERS, accel: 0.5 });
    }
    expect(forwardOf(b.vx, b.vy, b.angle)).toBeCloseTo(CHASSIS.maxSpeed, 1);
  });

  it("keeps its spin while spinFree and erases it the moment control returns", () => {
    const spun = { ...body({ vx: 0, vy: 0 }), angVel: 4 };
    const free = stepDrive(spun, input(0, 0), DT, { ...CHASSIS, spinPerTick: 0.9 },
      { ...NEUTRAL_MODIFIERS, spinFree: true });
    expect(free.angVel).toBeCloseTo(3.6, 9);
    const held = stepDrive(spun, input(0, 0), DT, CHASSIS, NEUTRAL_MODIFIERS);
    expect(held.angVel).toBe(0);
  });
});
