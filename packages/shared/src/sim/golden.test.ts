import { describe, expect, it } from "vitest";
import type { ChassisDrive } from "../config/car-config.js";
import type { InputMessage } from "../net/input.js";
import { resolveWorld } from "./collide.js";
import { stepDrive } from "./drive.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import type { SimBody } from "./step.js";
import { forwardOf, lateralOf, toWorld } from "./velocity.js";

/**
 * Behaviour frozen against `stepDrive`'s vector-velocity integration (stage 1 of the car-physics
 * rework, 2026-09-06). This suite originally pinned the pre-ram-CC drive on 2026-08-29 against a
 * scalar `SimBody.speed` (a magnitude along the heading, with a separate `shoveX`/`shoveY` knockback
 * vector and an `authority` scalar bolted alongside it). Stage 1 deleted all of that in favour of a
 * true 2D `vx`/`vy`, so this fixture is refixtured here BY DESIGN — see the brief for why that is a
 * cost worth naming rather than a free rebase.
 *
 * The shape being pinned has not changed: full throttle, turning, braking, reverse, and wall/obstacle
 * contact still integrate exactly the way they did before, and every case below that does not touch
 * coasting is numerically IDENTICAL to the pre-rework fixture (hand-verified, not assumed — see the
 * task report). Only the "coasts from 300" case moved, because stage 1 deliberately changed coasting
 * from a flat per-tick deceleration to a proportional per-tick decay; see the comment on that case.
 *
 * `angVel` is a real additive term from the ram work, unrelated to this rework: at 0 it contributes
 * nothing, so it stays neutral in `body()` below and every number here is unaffected by it, the same
 * contract this suite has held since the ram work landed.
 *
 * These numbers are pinned against `GOLDEN_CHASSIS`, a frozen fixture, not against a car in
 * `CAR_TABLE`. Retuning the roster therefore cannot move them, and a future balance edit has no
 * excuse to. If one of these moves without a deliberate, understood change to the integration itself,
 * the integration broke — do not re-record them.
 */
const DT = 1 / 30;

/**
 * The drive numbers this suite was recorded against — the chassis that shipped as `rectangle` on
 * 2026-08-29, before per-car acceleration and turn rate existed.
 *
 * Frozen here rather than read from `CAR_TABLE` deliberately: these expectations pin the SHAPE of
 * the integration, not the roster's balance. A car's ratings must be free to move without any
 * number below moving with them.
 *
 * The six original values are untouched. `coastPerTick` and `brakeDecel` are the two fields
 * `ChassisDrive` gained for the vector rework; both are frozen to the PRE-rework globals rather than
 * read from today's `DRIVE_CONFIG`/`CAR_TABLE`, for the same reason the original six are frozen: a
 * future retune of coasting or braking must not silently move this suite.
 */
const GOLDEN_CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 540,
  reverseMaxSpeed: 351,
  accel: 780,
  reverseAccel: 1100,
  turnRate: 4.2,
  turnRateAtStop: 2.1,
  coastPerTick: 0.5 ** (1 / (0.35 * 30)), // the pre-rework 0.35s half-life, frozen
  brakeDecel: 1600, // the pre-rework global, frozen
});

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function body(over: Partial<SimBody> = {}): SimBody {
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
    ...over,
  };
}

/**
 * A body whose entire velocity is a signed magnitude along its own heading, zero lateral — exactly
 * the shape the pre-rework scalar `speed` field could represent and nothing else. Every fixture below
 * that used to write `{ speed, angle }` now goes through this, so the historical intent ("this car is
 * doing X along its nose") survives the switch to a raw `vx`/`vy` pair unchanged.
 */
function bodyAt(x: number, y: number, angle: number, forward: number): SimBody {
  return body({ x, y, angle, ...toWorld(angle, forward, 0) });
}

function drive(start: SimBody, msg: InputMessage, ticks: number): SimBody {
  let next = start;
  // `NEUTRAL_MODIFIERS`, and only ever that: the status work adds a fifth argument whose
  // neutral value multiplies every drive constant by exactly 1. Every number below must survive
  // that unchanged, the same contract the ram fields are held to above. If one of these moves,
  // the multiplicative property has been broken and the change is wrong — do not re-record them.
  for (let i = 0; i < ticks; i++) next = stepDrive(next, msg, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
  return next;
}

/**
 * `forward` is the signed component along the heading — the direct successor to the old scalar
 * `speed` (negative meant reversing there too). Every case below also pins lateral at exactly 0: the
 * old scalar model had no way to represent a lateral component at all, so asserting it here is not a
 * new requirement, just the first time it can be stated explicitly now that `vx`/`vy` could in
 * principle carry one.
 */
function expectPose(actual: SimBody, x: number, y: number, angle: number, forward: number): void {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
  expect(actual.angle).toBeCloseTo(angle, 9);
  expect(forwardOf(actual.vx, actual.vy, actual.angle)).toBeCloseTo(forward, 9);
  expect(lateralOf(actual.vx, actual.vy, actual.angle)).toBeCloseTo(0, 9);
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
    // CHANGED from the pre-rework fixture (44, 60): coasting is now a proportional per-tick decay
    // (`forward * coastPerTick`) rather than a flat per-tick deceleration, and a proportional decay
    // sheds much less of a fast car's speed than a flat one did — hand-verified against
    // `300 * coastPerTick^8` before being recorded here, see the task report.
    expectPose(drive(bodyAt(0, 0, 0, 300), input(0, 0), 8), 60.1220120215, 0, 0, 176.9151673346);
  });

  it("brakes from 300 to rest in 6 ticks", () => {
    expectPose(drive(bodyAt(0, 0, 0, 300), input(0, -1), 6), 23.3333333333, 0, 0, 0);
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

  // Every case in this block records the SAME numbers the pre-rework fixture pinned. That is not a
  // paste — it is what the code actually produces, verified against the pre-rework values digit for
  // digit (see the task report) — and it is expected: `applyContact` reflects the full `vx`/`vy` and
  // then discards everything but the magnitude, re-projecting onto the UNCHANGED heading (stage 2
  // restores whole-vector reflection). Every body below starts with velocity already aligned to its
  // heading (via `bodyAt`, the only shape the old scalar model could ever produce), so the discard
  // throws away nothing this suite can see: reflecting a heading-aligned vector and then collapsing it
  // to a signed scalar along that same heading is bit-for-bit what the old scalar-model arithmetic
  // already did. A car carrying genuine externally-imposed lateral velocity (a ram shove) WOULD see
  // this contact resolution move under stage 1 — `drive-vector.test.ts` and the ram suites cover that
  // shape, not this one — and WILL move again once stage 2 lands whole-vector reflection.
  it("bounces off the left wall", () => {
    const out = resolveWorld(bodyAt(10, 400, Math.PI, 200), [], [], bounds);
    expectPose(out, 24, 400, Math.PI, -70);
  });

  it("reflects off both walls at a corner", () => {
    const out = resolveWorld(bodyAt(5, 4, Math.PI * 1.25, 150), [], [], bounds);
    expectPose(out, 28.2842712475, 28.2842712475, 3.926990817, 84.1875);
  });

  it("separates from another car", () => {
    const other = { x: 530, y: 400, angle: 0, w: 48, h: 32 };
    const out = resolveWorld(bodyAt(500, 400, 0, 250), [other], [], bounds);
    expectPose(out, 482, 400, 0, -87.5);
  });

  it("separates from an obstacle", () => {
    const obstacle = { x: 320, y: 290, w: 60, h: 60 };
    const out = resolveWorld(bodyAt(300, 300, 0.4, 180), [], [obstacle], bounds);
    expectPose(out, 291.663842667, 300, 0.4, -90.997064641);
  });

  it("leaves a free body untouched", () => {
    const out = resolveWorld(bodyAt(500, 400, 1.1, 100), [], [], bounds);
    expectPose(out, 500, 400, 1.1, 100);
  });
});
