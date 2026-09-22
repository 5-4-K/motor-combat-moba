import { beforeEach, describe, expect, it } from "vitest";
import { installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import type { ChassisDrive } from "../config/car-config.js";
import { DRIVE_CONFIG, perTickDecay } from "../config/drive-config.js";
import { MS_PER_TICK } from "../constants.js";
import type { InputMessage } from "../net/input.js";
import { dashSubstepCount, dashTranslation, isDashing, stepDrive } from "./drive.js";
import { ManeuverKind } from "./maneuver.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import type { SimBody } from "./step.js";
import { forwardOf } from "./velocity.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/**
 * DERIVED, never typed. This file's own fixture builds its per-tick factors with `perTickDecay`,
 * which divides by `TICK_RATE_HZ`; a hardcoded `1 / 30` beside them made this the one fixture in the
 * suite mixing the two, and the netcode rewrite's phase 1 moves `TICK_RATE_HZ` to 60.
 */
const DT = MS_PER_TICK / 1000;

/**
 * The drive numbers this suite was recorded against.
 *
 * Frozen here rather than read from `CAR_TABLE` deliberately: these expectations pin the SHAPE of
 * the integration, not the roster's balance. A car's ratings must be free to move without any
 * number below moving with them.
 *
 * REFIXTURED for the Unity drive-model port (car-physics-port stage 1 Task 3): the old six-field
 * `ChassisDrive` (`maxSpeed`, `reverseMaxSpeed`, `accel`, `reverseAccel`, `turnRate`,
 * `turnRateAtStop`) plus `coastPerTick`/`brakeDecel` is gone. This file's own fixture used to differ
 * from `golden.test.ts`'s only by `coastPerTick`'s half-life (1.0s here, 0.35s there) — that axis no
 * longer exists (there is no `coastPerTick` field at all now), so the two fixtures coincide on every
 * field below. That is not a copy-paste drift: it is the distinguishing axis disappearing.
 */
const GOLDEN_CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 200,
  engineAccel: 200,
  reverseAccel: 80,
  brakeDecel: 500,
  turnRate: 2,
  dragRate: 1,
  dragPerTick: perTickDecay(1),
  gripPerTick: perTickDecay(7),
  spinPerTick: 1,
});

/**
 * The exact-integrator command factor at `mods.accel: 1` (so the effective rate is just
 * `dragRate`), duplicated from drive.ts's own `commandFactorOf` since that helper is
 * drive.ts-private. Every command channel (throttle, brake, reverse) is scaled by this over one
 * tick, not by `DT` — see `commandFactorOf`'s own doc comment for why a flat `DT` multiply is the
 * wrong integrator and would depend on tick rate.
 */
const COMMAND_FACTOR = (1 - GOLDEN_CHASSIS.dragPerTick) / GOLDEN_CHASSIS.dragRate;

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

  it("approaches forwardMaxSpeedOf(carId) after sustained throttle (asymptotic, not a clamp)", () => {
    // `stepDrive` solves drag and the command TOGETHER over each tick (`commandFactorOf`), which is
    // the exact closed form for `dv/dt = a - k*v` — its fixed point is exactly the CONTINUOUS
    // equilibrium `engineAccel / dragRate` (`chassis.maxSpeed`), not a discretization-biased number
    // above it, and that holds at any tick rate (U7).
    const out = drive(rest(), input(0, 1), 1000);
    expect(fwd(out)).toBeCloseTo(GOLDEN_CHASSIS.maxSpeed, 6);
  });

  it("from high +speed, holding Down brakes the speed down before it goes negative", () => {
    const highSpeed: SimBody = { ...rest(), vx: GOLDEN_CHASSIS.maxSpeed, vy: 0 };
    const out = stepDrive(highSpeed, input(0, -1), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(out)).toBeLessThan(fwd(highSpeed));
    expect(fwd(out)).toBeGreaterThanOrEqual(0);
  });

  // DELETED: "from rest, holding Down for reverseHoldTicks then more goes negative, clamped to the
  // reverse max" and "brakes through zero into reverse without overshoot, only reverses past the
  // hold threshold, and pins at the cap" and "does not re-arm the reverse hold delay when briefly
  // coasting mid-reverse" — all three pinned `DRIVE_CONFIG.reverseHoldTicks` gating. The Unity port
  // has no hold delay at all: `engineCommandOf` reverses the instant `forward` is at or below
  // `reverseEpsilon`, on the very first tick Down is held. There is also no reverse CLAMP any more
  // — reverse top speed is the equilibrium `reverseAccel / dragRate`, approached asymptotically like
  // the forward one, never pinned exactly. `SimBody.reverseHold` was deleted outright by this port's
  // Task 4; this file stops exercising the ceremony rather than asserting it.

  it("accelerates backward at reverseAccel, not the forward accel, from the first tick Down is held", () => {
    // Reverse gets its own rate so backing out of a fight is not gated by the forward curve, and
    // (unlike the pre-port model) it is available immediately from rest — no hold delay to satisfy.
    const down = input(0, -1);
    const engaged = stepDrive(rest(), down, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(engaged)).toBeLessThan(0);
    // Exact-integrator command factor, not a flat `* DT` (see `COMMAND_FACTOR`'s own comment).
    expect(fwd(engaged)).toBeCloseTo(-GOLDEN_CHASSIS.reverseAccel * COMMAND_FACTOR, 9);
  });

  it("brakes from a forward speed into reverse, settling near its own reverse equilibrium", () => {
    // The brake command is FLAT (`-brakeDecel * mods.brakeDecel`, not proportional to `forward`)
    // and nothing in `stepDrive` clamps the crossing, unlike the deleted `accelerateForward`'s
    // `Math.max(0, ...)`: a car whose forward speed is smaller than one tick's brake magnitude
    // steps straight past 0 into reverse in a single tick. This case checks the shape (monotonic
    // braking, then a negative settle) rather than an exact zero-crossing that the model no longer
    // guarantees.
    const down = input(0, -1);
    let body: SimBody = { ...rest(), vx: GOLDEN_CHASSIS.maxSpeed, vy: 0 };
    let prev = fwd(body);
    for (let tick = 0; tick < 25 && prev > 0; tick++) {
      body = stepDrive(body, down, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
      const speed = fwd(body);
      expect(speed).toBeLessThan(prev);
      prev = speed;
    }
    expect(fwd(body)).toBeLessThan(0);

    const pinned = drive(body, down, 500);
    // The exact integrator's fixed point is the CONTINUOUS equilibrium, `reverseAccel / dragRate`
    // — 500 ticks lands within ~5e-5 of it (measured), not closer, since `atRest` never fires while
    // throttle is held and the approach stays asymptotic rather than snapping.
    expect(fwd(pinned)).toBeCloseTo(-GOLDEN_CHASSIS.reverseAccel / GOLDEN_CHASSIS.dragRate, 3);
  });

  it("holding Up from reverse brings the car back through zero and on to accelerating forward", () => {
    const up = input(0, 1);
    const reverseEquilibrium = -GOLDEN_CHASSIS.reverseAccel / GOLDEN_CHASSIS.dragRate;
    let body: SimBody = { ...rest(), vx: reverseEquilibrium, vy: 0 };
    for (let tick = 0; tick < 15; tick++) body = stepDrive(body, up, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(body)).toBeGreaterThan(0);
  });

  it("Left steer increases angle (CCW); Right steer decreases it", () => {
    const left = stepDrive(rest(), input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const right = stepDrive(rest(), input(-1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(left.angle).toBeGreaterThan(0);
    expect(right.angle).toBeLessThan(0);
  });

  // DELETED: "turns faster while moving than while stopped (turnRate vs turnRateAtStop)" and
  // "steers at turnRateAtStop below stopEpsilon and at turnRate above it" — there is no at-rest turn
  // rate any more (U-model yaw is speed-independent), so both premises are now false rather than
  // merely unpinned.

  it("coasting (throttle 0) reduces |speed| via drag from a positive speed", () => {
    const moving: SimBody = { ...rest(), vx: 100, vy: 0 };
    const out = stepDrive(moving, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(out)).toBeLessThan(fwd(moving));
    expect(fwd(out)).toBeGreaterThanOrEqual(0);
    expect(fwd(out)).toBeCloseTo(100 * GOLDEN_CHASSIS.dragPerTick, 9);
  });

  it("coasting (throttle 0) reduces |speed| via drag from a negative speed", () => {
    const movingReverse: SimBody = { ...rest(), vx: -100, vy: 0 };
    const out = stepDrive(movingReverse, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(out)).toBeGreaterThan(fwd(movingReverse));
    expect(fwd(out)).toBeLessThanOrEqual(0);
    expect(fwd(out)).toBeCloseTo(-100 * GOLDEN_CHASSIS.dragPerTick, 9);
  });

  it("coasting from a sub-stopEpsilon speed settles to exact rest in one tick", () => {
    const barelyMoving: SimBody = { ...rest(), vx: DRIVE_CONFIG.stopEpsilon / 2, vy: 0 };
    const out = stepDrive(barelyMoving, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(out)).toBe(0);
  });
});

describe("stepDrive: ram knock state", () => {
  // DELETED: "rotates the car from angVel with no steering input", "decays angVel toward zero and
  // snaps inside the epsilon", the four countersteer-differential cases, and "adds steering
  // rotation and injected spin rather than one substituting for the other" — all of them pinned the
  // pre-port model where steering ADDED to an independently-decaying `angVel`. The Unity port makes
  // steering SET the yaw rate: outside `mods.spinFree`, an injected spin is overwritten by the
  // steering term on the very next tick rather than decaying alongside it, and countersteering no
  // longer has a differential decay rate to test (`spinPerTick` is the only decay knob left, and it
  // does not read `steer` at all). `drive-vector.test.ts` now covers this shape directly (see
  // "keeps its spin while spinFree and erases it the moment control returns").

  it("translates the car from an imposed lateral velocity with no throttle", () => {
    // There is no successor to `shove`: any lateral component of vx/vy IS the imposed motion. A
    // pure lateral component (angle 0, so lateral = vy) with no throttle still displaces the car,
    // now decayed by drag-then-grip instead of the old flat impactGripDecel bleed.
    const out = stepDrive({ ...rest(), vx: 0, vy: -60 }, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const expectedLateral = -60 * GOLDEN_CHASSIS.dragPerTick * GOLDEN_CHASSIS.gripPerTick;
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(expectedLateral * DT, 9);
  });

  it("decays an imposed lateral velocity toward zero and snaps to exact rest", () => {
    const settled = drive({ ...rest(), vx: 0, vy: 200 }, input(0, 0), 300);
    expect(settled.vx).toBe(0);
    expect(settled.vy).toBe(0);
  });

  it("adds an imposed lateral velocity to the drive velocity rather than replacing it", () => {
    const out = stepDrive({ ...rest(), vx: 300, vy: 150 }, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    // angle 0, so drive motion is +x and the imposed lateral motion is +y. Both must survive.
    expect(out.x).toBeGreaterThan(0);
    const expectedLateral = 150 * GOLDEN_CHASSIS.dragPerTick * GOLDEN_CHASSIS.gripPerTick;
    expect(out.y).toBeCloseTo(expectedLateral * DT, 9);
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

  it("HOLD pins the car and steers at the turn rate (there is no separate at-rest rate any more)", () => {
    const restingBody = rest();
    const held: SimBody = { ...restingBody, vx: 200, vy: 0, maneuver: ManeuverKind.HOLD, maneuverTicksLeft: 10 };
    const out = stepDrive(held, { seq: 1, steer: 1, throttle: 1, fireSlots: 0 }, DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(out.x).toBeCloseTo(restingBody.x); // throttle dead
    expect(fwd(out)).toBe(0);
    expect(out.angle).toBeCloseTo(restingBody.angle + GOLDEN_CHASSIS.turnRate * DT);
    expect(out.maneuverTicksLeft).toBe(9);
  });

  /**
   * The coverage hole that let HOLD keep the pre-port yaw line through the whole drive-model port.
   *
   * Every HOLD case in this file entered the branch with `angVel: 0`, where "steering sets the rate"
   * and "steering is added to the rate already there" are the same arithmetic. Under U16 the ordinary
   * branch WRITES the steering rate into `angVel` every tick, so by the second tick of any hold
   * entered while turning the two disagree by a factor of two — and `lance` (Bullseye) is a shipped
   * ~2.2 s `holdsDuringFire` beam, so this was reachable in a live match.
   */
  describe("HOLD yaw is the steering rate, never the steering rate plus the rate already there", () => {
    /** A car mid-hold that entered it already turning: `angVel` carries last tick's steering rate. */
    function holding(over: Partial<SimBody> = {}): SimBody {
      return {
        ...rest(),
        angVel: GOLDEN_CHASSIS.turnRate,
        maneuver: ManeuverKind.HOLD,
        maneuverTicksLeft: 10,
        ...over,
      };
    }

    it("turns at exactly the turn rate while steering, not twice it", () => {
      const out = stepDrive(holding(), input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
      expect(out.angVel).toBeCloseTo(GOLDEN_CHASSIS.turnRate, 9);
      expect(out.angle).toBeCloseTo(GOLDEN_CHASSIS.turnRate * DT, 9);
    });

    it("stops turning the tick the key is released, rather than coasting on at full rate", () => {
      const out = stepDrive(holding(), input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
      expect(out.angVel).toBe(0);
      expect(out.angle).toBe(0);
    });

    it("does not rotate at all under steeringLocked, whatever rate it entered the hold carrying", () => {
      const out = stepDrive(holding(), input(1, 0), DT, GOLDEN_CHASSIS, {
        ...NEUTRAL_MODIFIERS,
        steeringLocked: true,
      });
      expect(out.angVel).toBe(0);
      expect(out.angle).toBe(0);
    });

    it("scales with mods.turnRate, the same channel the ordinary branch reads", () => {
      const out = stepDrive(holding(), input(1, 0), DT, GOLDEN_CHASSIS, { ...NEUTRAL_MODIFIERS, turnRate: 0.4 });
      expect(out.angVel).toBeCloseTo(GOLDEN_CHASSIS.turnRate * 0.4, 9);
    });

    it("hands the yaw back to the spin channel under spinFree, exactly as the ordinary branch does", () => {
      const spun = { ...holding(), angVel: 4 };
      const out = stepDrive(spun, input(1, 0), DT, { ...GOLDEN_CHASSIS, spinPerTick: 0.9 }, {
        ...NEUTRAL_MODIFIERS,
        spinFree: true,
      });
      expect(out.angVel).toBeCloseTo(3.6, 9);
    });
  });

  it("HOLD recomposes its imposed slide at the OLD angle, so steering does not steer the slide", () => {
    // `vy: 100` at `angle: 0` is a pure lateral velocity (100 u/s to the car's left). Rebuilt at the
    // OLD angle it stays pointing along +y and `vx` stays exactly 0; rebuilt at the NEW angle — the
    // pre-fix behaviour — the slide rotates with the wheel and `vx` picks up `-lateral * sin(angle)`.
    const held: SimBody = { ...rest(), vy: 100, maneuver: ManeuverKind.HOLD, maneuverTicksLeft: 10 };
    const out = stepDrive(held, input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const bled = 100 * GOLDEN_CHASSIS.dragPerTick * GOLDEN_CHASSIS.gripPerTick;
    expect(out.vx).toBe(0);
    expect(out.vy).toBeCloseTo(bled, 9);
    expect(out.x).toBe(0);
    // Read in the car's NEW frame the slide is now partly forward — that gap IS the drift.
    expect(fwd(out)).toBeCloseTo(bled * Math.sin(out.angle), 9);
  });

  it("HOLD honours fullStop, so a stunned car mid-hold does not slide either", () => {
    const held: SimBody = { ...rest(), vy: 100, maneuver: ManeuverKind.HOLD, maneuverTicksLeft: 10 };
    const out = stepDrive(held, input(0, 0), DT, GOLDEN_CHASSIS, { ...NEUTRAL_MODIFIERS, fullStop: true });
    expect(out.vx).toBe(0);
    expect(out.vy).toBe(0);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it("CHARGE drives completely normally and only counts down", () => {
    const charging: SimBody = { ...movingBody, maneuver: ManeuverKind.CHARGE, maneuverTicksLeft: 300 };
    const plain = stepDrive(movingBody, input(0, 1), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    const out = stepDrive(charging, input(0, 1), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(out.x).toBe(plain.x);
    expect(fwd(out)).toBe(fwd(plain));
    expect(out.maneuverTicksLeft).toBe(299);
  });

  it("fullStop zeroes BOTH the forward and the lateral component every tick", () => {
    // CHANGED from the pre-port model: `stepDrive`'s ordinary branch now zeroes `forward` AND
    // `lateral` together under `fullStop` (see the brief's Step 4 code, used verbatim) — a stunned
    // car pushed sideways by a slam no longer slides at all. Before this task, `fullStop` zeroed
    // only the forward component and left an imposed lateral velocity to bleed off on its own; see
    // the task report for the doc/behaviour note this leaves for `packages/shared/CLAUDE.md`.
    const stunned: SimBody = { ...movingBody, vx: 250, vy: 100 };
    const out = stepDrive(stunned, input(0, 1), DT, GOLDEN_CHASSIS, { ...NEUTRAL_MODIFIERS, fullStop: true });
    expect(fwd(out)).toBe(0);
    expect(out.x).toBeCloseTo(stunned.x, 9);
    expect(out.y).toBeCloseTo(stunned.y, 9);
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
