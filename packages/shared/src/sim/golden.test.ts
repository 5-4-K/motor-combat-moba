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
// NOTE: `drive.test.ts` also declares a `GOLDEN_CHASSIS` with these same first six values but a
// DIFFERENT `coastPerTick` (a 1.0s half-life there, picked as a round number for that suite's own
// scenarios, against the pre-rework 0.35s frozen here). Both are deliberately independent fixtures
// that happen to share a name — not a copy-paste drift, and not a bug in either file. Do not "fix"
// one to match the other.
const GOLDEN_CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 540,
  reverseMaxSpeed: 351,
  accel: 780,
  reverseAccel: 1100,
  turnRate: 4.2,
  turnRateAtStop: 2.1,
  coastPerTick: 0.5 ** (1 / (0.35 * 30)), // the pre-rework 0.35s half-life, frozen — tick-count-
  // frozen, not seconds-frozen: stays correct if a future netcode phase moves TICK_RATE_HZ, since
  // DT above is hardcoded to 1/30 in lockstep with it, not read from config.
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
 * `speed` (negative meant reversing there too). `lateral` defaults to 0, which is exact for every
 * `stepDrive` case below: `steeringGrip` is 1.0 ("on rails"), so driven velocity always stays
 * aligned with the nose and the old scalar model's inability to represent a lateral component was
 * never a limitation there.
 *
 * `resolveWorld` is different since stage 2 Task 1: `applyContact` now hands back the WHOLE
 * reflected vector instead of discarding it and rebuilding a scalar along the unchanged heading, so
 * a contact whose push normal is not collinear with the car's velocity leaves real lateral motion
 * behind. Two of the four `resolveWorld` cases below are dead-on (normal exactly anti-parallel to
 * velocity) and still land on lateral 0 for that reason, not because the field is unconditionally
 * zero; the other two pass their hand-derived lateral value explicitly. See the comment on that
 * describe block for the derivations.
 */
function expectPose(
  actual: SimBody,
  x: number,
  y: number,
  angle: number,
  forward: number,
  lateral = 0,
): void {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
  expect(actual.angle).toBeCloseTo(angle, 9);
  expect(forwardOf(actual.vx, actual.vy, actual.angle)).toBeCloseTo(forward, 9);
  expect(lateralOf(actual.vx, actual.vy, actual.angle)).toBeCloseTo(lateral, 9);
}

describe("golden: stepDrive against the vector-drive rework", () => {
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

describe("golden: resolveWorld against the vector-drive rework", () => {
  const bounds = { width: 1000, height: 800 };
  // Filler for every case below that resolves against bounds/obstacles only, or where the mass
  // split is not what the case is pinning: those code paths never consult `selfMass` (obstacles and
  // bounds always take `OBSTACLE_SHARE`, 1), so any positive number reproduces the same numbers the
  // pre-mass-split fixture pinned. Real roster masses appear ONLY in "separates from another car"
  // below, which is the one case this block exists to pin the mass split against.
  const FILLER_MASS = 480;

  // REFIXTURED for stage 2 Task 1 (2026-09-06): `applyContact` no longer discards the reflected
  // direction and rebuilds a scalar along the unchanged heading — it now hands back the whole
  // reflected `vx`/`vy` — and `DRIVE_CONFIG.restitution` dropped 0.35 -> 0.15. Positions are
  // untouched (the push/MTV math never looked at velocity, only geometry), but every `forward`
  // value below is a fresh hand-derivation, not a copy of the previous fixture.
  //
  // The rule, from `applyContact`'s own doc comment, with `n` the unit push direction:
  //
  //   if dot(v, n) < 0:  v' = v - (1 + restitution) * dot(v, n) * n
  //
  // Two of the four contact cases below hit dead-on — the push normal is exactly anti-parallel to
  // the car's heading (a car driving straight into a wall or straight into another car ahead of
  // it) — so the reflected vector stays collinear with the original heading and the whole thing
  // collapses to the familiar scalar bounce `forward' = -restitution * forward`:
  //   - "bounces off the left wall": forward 200 -> -(200 * 0.15) = -30.
  //   - "separates from another car": push resolves along x only (n = (-1, 0)), and the car's
  //     velocity is already pure +x, so forward 250 -> -(250 * 0.15) = -37.5. This one is
  //     UNAFFECTED by the mass split below: `applyContact`'s normal `n` is `push / |push|`, and
  //     scaling `push` by `share` before that division cancels out of the unit vector, so the
  //     reflection math never sees `share` at all — only the POSITION half of this case moves.
  //
  // The corner case is a second axis-aligned double contact (x then y, `resolveBounds` applies one
  // `applyContact` per violated axis) that ALSO happens to stay collinear with the heading, by the
  // fixture's own symmetry rather than because the hit is dead-on:
  //   - "reflects off both walls at a corner": at 1.25π, vx = vy = 150*cos(1.25π) = -75√2. The
  //     x-contact (n=(1,0)) leaves vx' = -restitution*vx = 11.25√2 and vy untouched; the y-contact
  //     (n=(0,1)) then leaves vy' = -restitution*vy = 11.25√2 too (same algebra, vy was still -75√2
  //     going in). Final v = (11.25√2, 11.25√2) points exactly opposite the original heading
  //     (cos, sin)(1.25π) = (-√2/2, -√2/2) — same line, flipped sign — because the fixture starts
  //     the car's velocity already at 45°, matching the corner's own symmetry, so lateral is still
  //     0 here: forward = v . (cos, sin)(1.25π) = 11.25√2 * (-√2/2) * 2 = -22.5.
  //
  // The obstacle case is genuinely off-axis, and this is the one case in the block that needs its
  // `lateral` argument spelled out rather than defaulting to 0:
  //   - "separates from an obstacle": the MTV here is a single contact along world -x (n = (-1, 0),
  //     matching the unchanged push that put x at 291.663842667), while the car's heading is 0.4
  //     rad — off-axis from the wall normal. vx = 180cos(0.4) = 165.7909789205193,
  //     vy = 180sin(0.4) = 70.09530161555709. Only vx reflects (n has no y component):
  //     vx' = -0.15 * vx = -24.868646838077897, vy' = vy UNCHANGED. Re-projected onto the car's
  //     frame: forward = vx'*cos(0.4) + vy'*sin(0.4) = 4.390855582568385, and
  //     lateral = -vx'*sin(0.4) + vy'*cos(0.4) = 74.24635540810061 — a large, genuinely nonzero
  //     lateral component, which is the whole point of this task: the car's forward-moving y-ish
  //     motion rides straight through a contact whose normal never touched it.
  //
  // REFIXTURED AGAIN for stage 2 Task 2 (2026-09-06): `others` widened to `CarObstacle[]` and
  // `resolveWorld` gained `selfMass`. "separates from another car" now runs mirage (480, real
  // `massOf("mirage")`) against bastion (900, real `massOf("bastion")`) instead of an implicit,
  // pre-split full push, and its POSITION — forward is untouched, per the note above — moves with
  // it: `shareOf(480, 900) = 900 / (480 + 900) = 900 / 1380 = 0.6521739130434783`. The MTV depth is
  // unchanged from the pre-split fixture (18 units: the cars' half-widths sum to 48, their centres
  // sit 30 apart, `48 - 30 = 18`), so mirage now takes `18 * 0.6521739130434783 = 11.73913043...`
  // of it instead of the whole 18: `x' = 500 - 11.739130434782608 = 488.2608695652174` (exact
  // value `500 - 270/23`). Every other case below resolves against bounds or an obstacle, neither
  // of which yields — `OBSTACLE_SHARE` is 1 unconditionally — so their positions and the mass
  // passed in are unrelated; `FILLER_MASS` above documents that.
  it("bounces off the left wall", () => {
    const out = resolveWorld(bodyAt(10, 400, Math.PI, 200), [], [], bounds, FILLER_MASS);
    expectPose(out, 24, 400, Math.PI, -30);
  });

  it("reflects off both walls at a corner", () => {
    const out = resolveWorld(bodyAt(5, 4, Math.PI * 1.25, 150), [], [], bounds, FILLER_MASS);
    expectPose(out, 28.2842712475, 28.2842712475, 3.926990817, -22.5);
  });

  it("separates from another car", () => {
    // mirage (480) driving into a stationary bastion (900) — real roster masses, not filler, since
    // this is the one case in this block pinning the mass split rather than merely surviving it.
    const other = { hull: { x: 530, y: 400, angle: 0, w: 48, h: 32 }, mass: 900 };
    const out = resolveWorld(bodyAt(500, 400, 0, 250), [other], [], bounds, 480);
    expectPose(out, 488.2608695652174, 400, 0, -37.5);
  });

  it("separates from an obstacle", () => {
    const obstacle = { x: 320, y: 290, w: 60, h: 60 };
    const out = resolveWorld(bodyAt(300, 300, 0.4, 180), [], [obstacle], bounds, FILLER_MASS);
    expectPose(out, 291.663842667, 300, 0.4, 4.390855582568385, 74.24635540810061);
  });

  it("leaves a free body untouched", () => {
    const out = resolveWorld(bodyAt(500, 400, 1.1, 100), [], [], bounds, FILLER_MASS);
    expectPose(out, 500, 400, 1.1, 100);
  });
});
