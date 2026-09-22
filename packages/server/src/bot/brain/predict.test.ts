import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import {
  DRIVE_CONFIG, ManeuverKind, NEUTRAL_MODIFIERS, TICK_RATE_HZ, driveOf, forwardOf, speedOf, stepDrive,
  turnRateOf, type SimBody,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView, BotView } from "../types.js";
import { newPerception, observedAngVelOf, perceive } from "./perception.js";
import {
  OBSERVATION_MODIFIERS, bodyFromObservation, bodyFromSelf, interceptTicks, physicsPredictor,
  rollForward, selfPredictor, steerFromObservedTurn,
} from "./predict.js";
import { constantVelocityPredictor } from "./solution.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));
// Also installed directly, synchronously, at module scope: fixture constants below (and
// some describe bodies) read config during test COLLECTION, which happens once, before any
// beforeEach hook ever fires.
installMode(modeConfigOf(DEFAULT_GAME_MODE));

/**
 * `speed` is still accepted as an OVERRIDE and resolved here to `vx`/`vy` along the (possibly also
 * overridden) `angle`.
 *
 * The car-physics rework replaced the view's scalar `speed` with a world velocity, and every scene
 * in this file means "travelling at N along its nose" when it writes `speed: N` — so the conversion
 * belongs in one place rather than at each of the thirty-odd call sites, where spelling it out would
 * bury what each scene is actually about. Pass `vx`/`vy` directly for the rare scene that wants a
 * car sliding across its own nose; the two forms compose, with `speed` applied last.
 *
 * ANNOTATED, stage 5 Task 9 (2026-09-19): both defaults below carry `vx: 300`, the same stale literal
 * that caused a real bug in `duel.fixture.ts` (see its `BOT_START` comment) once this port's stage 5
 * Task 5 tuning pass pushed the roster's top speeds below it (mirage 283.5 today). It is NOT
 * derived here for the same reason: these two factories feed `predict.ts`'s pose-and-velocity math
 * directly, never through `stepDrive`, so nothing here decelerates a scene toward a chassis cap the
 * way the fixture's closed loop did — the literal is inert with respect to that bug class. Left as a
 * plain default rather than derived from `driveOf("mirage").maxSpeed`, because dozens of scenes in
 * this file build on `carAt()`/`selfAt()` and re-deriving the shared default would need each one
 * re-verified against its own assertions, which is more churn than this value is currently buying
 * anyone. Flagging it here so the next reader does not mistake "the same literal" for "the same bug".
 */
function carAt(over: Partial<BotCarView> & { speed?: number } = {}): BotCarView {
  const { speed, ...rest } = over;
  const car: BotCarView = {
    sessionId: "them", carId: "mirage", team: 1, x: 0, y: 0, angle: 0, vx: 300, vy: 0,
    hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0, ...rest,
  };
  if (speed === undefined) return car;
  return { ...car, vx: Math.cos(car.angle) * speed, vy: Math.sin(car.angle) * speed };
}

/** The `speed` override behaves exactly as it does in `carAt` above — see there, including the
 * stale-`vx: 300` note. */
function selfAt(over: Partial<BotSelfView> & { speed?: number } = {}): BotSelfView {
  const { speed, ...rest } = over;
  const self: BotSelfView = {
    sessionId: "me", carId: "mirage", team: 0, x: 0, y: 0, angle: 0, vx: 300, vy: 0,
    hp: 70, maxHp: 70, alive: true, statuses: [], slots: [], switchLockUntilTick: 0,
    maneuver: 0, maneuverTicksLeft: 0, ...rest,
  };
  if (speed === undefined) return self;
  return { ...self, vx: Math.cos(self.angle) * speed, vy: Math.sin(self.angle) * speed };
}

/**
 * An `Rng` that makes `predict.ts`'s `gaussian` return exactly `draw`, twice.
 *
 * `gaussian` is Box-Muller — `sqrt(-2 ln u1) * cos(2*PI*u2)`, two `rng()` calls per gaussian and
 * therefore FOUR per `physicsPredictor` (H21). Feeding it `u1 = exp(-draw^2 / 2)` makes the
 * magnitude `|draw|`, and a `u2` of 0 or 0.5 makes `cos` exactly +1 or -1 — so the estimation error
 * is a chosen number rather than whatever a seed happened to produce. Both gaussians receive the
 * same value, which is why the tests below drive one axis at a time: `angVel: 0` to isolate the
 * speed read, a scene whose speed error does not matter to isolate the turn read.
 */
function rngGiving(draw: number): () => number {
  const seq = [Math.exp(-(draw * draw) / 2), draw >= 0 ? 0 : 0.5];
  let i = 0;
  return () => seq[i++ % seq.length]!;
}

describe("rollForward", () => {
  it("carries a straight-line car forward, coasting off only slowly", () => {
    const body = bodyFromObservation(carAt(), 0);
    const poses = rollForward(body, "mirage", { steer: 0, throttle: 0 }, TICK_RATE_HZ, NEUTRAL_MODIFIERS);
    // RE-PINNED at the 2026-09-07 merge of the car-physics rework, and the claim INVERTED with it.
    // This used to read "brought to rest by drag": the global `DRIVE_CONFIG.drag` was 900 u/s^2,
    // steep enough to stop a coasting 300 u/s car inside ~10 ticks, so a full second of rollout
    // landed on 40-50 units. That knob no longer exists. Coast was then per-car and PROPORTIONAL
    // (`CarDef.coastHalfLifeSeconds` -> `ChassisDrive.coastPerTick`), Mirage's half-life 36 ticks —
    // so a full second of coasting shed barely half the speed and covered 225.7 units, most of the
    // 300 a held speed would. A heavy car that carries its momentum is the whole point of the
    // 2026-09-06 heavy-car pass, so that was the pass landing, not a regression.
    //
    // RE-PINNED, STAGE 5 TASK 8 (2026-09-19): a STALE NUMBER, not a bot regression — this case
    // exercises `rollForward`/`stepDrive` directly, under `NEUTRAL_MODIFIERS`, with no bot decision
    // code anywhere in it. The 2026-09-18 Unity drive-model port deleted `coastHalfLifeSeconds` and
    // `coastPerTick`, folding coast into the one always-on `dragRate` (U4), which is a real, per-car
    // number (`dragRateOf("mirage")`, 1.2848) rather than the old proportional half-life — and it
    // moved AGAIN, unrelated to this port, when stage 5 Task 5 raised `baseMaxSpeed`/`speedPerRating`
    // 1.5x on 2026-09-19 (`dragRate` itself is untouched by that raise, but the position integral
    // below is measured against the CURRENT chassis, not the port-era one this comment last cited).
    // Re-derived directly against built shared (`driveOf("mirage")`, `stepDrive` stepped by hand):
    // Mirage's coasting speed now halves in `Math.log(2) / dragRateOf("mirage")` ≈ 16.2 ticks (still
    // ~16, not the pre-port 36), and a full second (30 ticks, ~1.85 half-lives) of coasting from
    // 300 u/s lands the position at 165.298 units and the residual forward speed at 83.012 u/s —
    // both measured exactly via `driveOf`/`stepDrive`, not eyeballed.
    expect(poses.at(-1)!.x).toBeGreaterThan(150);
    expect(poses.at(-1)!.x).toBeLessThan(180);
    expect(Math.abs(poses.at(-1)!.y)).toBeLessThan(1);
    // Still DECAYING, just gently: below the 300 it started at, well above rest.
    const end = forwardOf(poses.at(-1)!.vx, poses.at(-1)!.vy, poses.at(-1)!.angle);
    expect(end).toBeLessThan(120);
    expect(end).toBeGreaterThan(50);
  });

  it("curves a car that was observed turning, without any input, under spinFree", () => {
    // RE-DERIVED, STAGE 5 TASK 8 (2026-09-19). This used to run under plain `NEUTRAL_MODIFIERS` with
    // `steer: 0`, which is now a STALE assumption, not a bot regression: under U16 ("steering SETS
    // the rate", `drive.ts`) an ordinary tick with `steer: 0` and `mods.spinFree` false SETS `angVel`
    // to exactly 0 every tick, unconditionally overwriting whatever spin the body was handed —
    // `channels.test.ts` pins this exact behaviour ("erases it the moment control returns"). A car
    // cannot be "observed turning, without any input" under the CURRENT sim unless something grants
    // it `spinFree` — that is what lets injected spin decay instead of being reset, and it is
    // production behaviour, not a test-only escape hatch: `physicsPredictor`'s below-threshold branch
    // (a residual ram spin) now does exactly this (see `predict.ts`'s doc comment on that function,
    // fixed alongside this test in the same commit). Rolling with `spinFree: true` is therefore the
    // faithful way to ask this question under the ported physics.
    const spinFreeMods = { ...NEUTRAL_MODIFIERS, spinFree: true };
    const straight = rollForward(
      bodyFromObservation(carAt(), 0), "mirage", { steer: 0, throttle: 0 }, 15, spinFreeMods,
    );
    const turning = rollForward(
      bodyFromObservation(carAt(), 3), "mirage", { steer: 0, throttle: 0 }, 15, spinFreeMods,
    );
    expect(Math.abs(turning.at(-1)!.y)).toBeGreaterThan(Math.abs(straight.at(-1)!.y));
  });

  it("returns one pose per tick", () => {
    const poses = rollForward(
      bodyFromObservation(carAt(), 0), "mirage", { steer: 0, throttle: 0 }, 12, NEUTRAL_MODIFIERS,
    );
    expect(poses).toHaveLength(12);
  });

  it("rolls an observed car at the speed it was seen at, under OBSERVATION_MODIFIERS", () => {
    // The Unity drive port's whole case for `OBSERVATION_MODIFIERS` in one number: `accel: 0`
    // zeroes the engine command AND flattens `dragFactorOf`'s exponent to 1 (`dragPerTick ** 0`),
    // so a held throttle neither adds nor sheds speed. The observed speed comes back exact.
    const seen = 150;
    const rolled = rollForward(
      bodyFromObservation(carAt({ speed: seen }), 0), "mirage",
      { steer: 0, throttle: 1 }, 45, OBSERVATION_MODIFIERS,
    );
    expect(speedOf(rolled.at(-1)!.vx, rolled.at(-1)!.vy)).toBeCloseTo(seen, 6);
  });
});

describe("steerFromObservedTurn", () => {
  const fullLock = (carId: "mirage" | "bastion") => turnRateOf(carId);
  const threshold = (carId: "mirage" | "bastion") =>
    turnRateOf(carId) * BRAIN_CONSTANTS.fullLockAngVelFraction;

  it("reads a car at full lock as steering, in both directions", () => {
    expect(steerFromObservedTurn(fullLock("mirage"), "mirage")).toBe(1);
    expect(steerFromObservedTurn(-fullLock("mirage"), "mirage")).toBe(-1);
  });

  it("reads a slow residual turn as NOT steering", () => {
    // A ram's injected spin decaying away, well under half a full lock: this is the case the
    // controller must attribute to `angVel` and let `stepDrive` decay, not to a held wheel.
    expect(steerFromObservedTurn(threshold("mirage") * 0.5, "mirage")).toBe(0);
    expect(steerFromObservedTurn(-threshold("mirage") * 0.5, "mirage")).toBe(0);
    expect(steerFromObservedTurn(0, "mirage")).toBe(0);
  });

  it("counts a rate EXACTLY on the threshold as steering", () => {
    // "At least half" -- the boundary belongs to the steering side, so a car whose observed rate
    // lands precisely on it is not silently dropped to 0.
    expect(steerFromObservedTurn(threshold("mirage"), "mirage")).toBe(1);
    expect(steerFromObservedTurn(-threshold("mirage"), "mirage")).toBe(-1);
  });

  it("keys the threshold to the chassis, so a slower-turning car clears it sooner", () => {
    // Bastion's full lock (6.30 rad/s) is below Mirage's (8.19), so its threshold is lower too --
    // one absolute rate would read a slow chassis's genuine full lock as noise.
    expect(threshold("bastion")).toBeLessThan(threshold("mirage"));
    const between = (threshold("bastion") + threshold("mirage")) / 2;
    expect(steerFromObservedTurn(between, "bastion")).toBe(1);
    expect(steerFromObservedTurn(between, "mirage")).toBe(0);
  });

  it("reconstructing the input sustains a turn that a free-running angVel lets decay", () => {
    // The whole reason this function exists. `stepDrive` adds a held steer's rotation to `angle`
    // every tick (`steer * turnRate * authority`) but DECAYS an uncommanded `angVel` toward zero,
    // so an observed full-lock turn reproduced as `angVel` alone straightens out over a horizon,
    // while the same turn fed back as a held wheel keeps arcing for as long as it is held.
    const car = carAt({ speed: 400 });
    const observed = turnRateOf("mirage");
    const turned = (poses: { angle: number }[]) => Math.abs(poses.at(-1)!.angle - car.angle);
    const asSpin = rollForward(
      bodyFromObservation(car, observed), "mirage", { steer: 0, throttle: 1 }, 45, NEUTRAL_MODIFIERS,
    );
    const asSteer = rollForward(
      bodyFromObservation(car, 0), "mirage",
      { steer: steerFromObservedTurn(observed, "mirage"), throttle: 1 }, 45, NEUTRAL_MODIFIERS,
    );
    expect(turned(asSteer)).toBeGreaterThan(turned(asSpin) * 2);
  });
});

describe("a car that is SLIDING, not driving (car-physics merge, 2026-09-07)", () => {
  // THE CASE THE TWO BRANCHES HAD TO BE COMBINED FOR, and the only one nothing else covers.
  //
  // `truthPath` above is a fair ground truth precisely because it assumes a car travels along its
  // nose — which WAS true for a DRIVEN car while `DRIVE_CONFIG.steeringGrip` was 1. That knob is
  // deleted as of the 2026-09-18 Unity drive-model port, so a driven car now drifts too and this
  // file's ground truth is approximate for a turning car as well; that is part of why this suite is
  // red, and stage 5's `bot-tuner` pass owns it. It was never true for a car
  // carrying imposed lateral velocity: a rammed car, or one shoved by a slam. That car is exactly
  // what the bot brain was blind to before the rework, because it reconstructed velocity as
  // `cos(angle) * speed` and a scalar speed cannot represent motion across the nose at all.
  //
  // The brain's prediction layer arrived on `development/main` written against that scalar; the
  // vector velocity arrived on `feature/car-physics-rework`. Neither branch could test this — one
  // had the predictor without the velocity, the other the velocity without the predictor. This is
  // the test that says the merge actually joined them.
  const HORIZON = 45;

  /** Nose along +x, but travelling mostly sideways: 60 u/s forward, 200 u/s to the car's left. */
  const sliding: SimBody = {
    x: 300, y: 360, angle: 0, vx: 60, vy: 200,
    angVel: 0, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
  };

  /** Where the REAL sim puts that car, rolled under the same set the predictor assumes. */
  function truth(): SimBody {
    let b = sliding;
    for (let i = 0; i < HORIZON; i++) {
      b = stepDrive(b, { seq: i, steer: 0, throttle: 1, fireSlots: 0 }, 1 / TICK_RATE_HZ,
        driveOf("mirage"), OBSERVATION_MODIFIERS);
    }
    return b;
  }

  function viewOf(b: SimBody): BotCarView {
    return carAt({ x: b.x, y: b.y, angle: b.angle, vx: b.vx, vy: b.vy });
  }

  it("predicts it EXACTLY, because the rollout reads the real velocity vector", () => {
    // Rolled under the predictor's own modifier set, so the throttle assumption cancels and the
    // only variable left is how the velocity was read. Nothing is approximated here: the bot runs
    // the same `stepDrive` the sim does, over the same numbers, so it should agree to the bit.
    const end = truth();
    const guess = physicsPredictor(viewOf(sliding), 0, HORIZON, 0, makeRng(1))(HORIZON);
    expect(Math.hypot(guess.x - end.x, guess.y - end.y)).toBeLessThan(1e-3);
  });

  it("and the pre-rework scalar read would have been 62.68 units wrong — more than a car length", () => {
    // What `cos(angle) * speed` would have produced: the forward component kept, the 200 u/s of
    // lateral motion silently discarded. Pinned as a REGRESSION GUARD -- if someone reintroduces a
    // scalar reconstruction anywhere on this path, this is the assertion that fails and names why.
    //
    // RE-DERIVED, STAGE 5 TASK 8 (2026-09-19): a STALE NUMBER, not a bot regression — 76.67 was
    // measured against Mirage's chassis at an earlier point in the physics port; stage 5 Task 5's
    // 2026-09-19 speed/turn-rate raise moved `driveOf("mirage")` again, and this guard's exact figure
    // moves with it by construction (it is a function of the chassis, not an independent fact). The
    // property this guard exists to catch — a scalar reconstruction discarding lateral motion reads
    // meaningfully wrong, more than a car length (`DRIVE_CONFIG.carHeight`, 40) — still holds, at a
    // re-measured 62.6846927874405.
    const end = truth();
    const forward = forwardOf(sliding.vx, sliding.vy, sliding.angle);
    const asScalarWould = viewOf({
      ...sliding, vx: Math.cos(sliding.angle) * forward, vy: Math.sin(sliding.angle) * forward,
    });
    const guess = physicsPredictor(asScalarWould, 0, HORIZON, 0, makeRng(1))(HORIZON);
    const error = Math.hypot(guess.x - end.x, guess.y - end.y);
    expect(error).toBeGreaterThan(DRIVE_CONFIG.carHeight);
    expect(error).toBeCloseTo(62.6846927874405, 1);
  });
});

describe("physicsPredictor", () => {
  it("beats a straight line for a turning car", () => {
    const turning = carAt({ speed: 400 });
    const predictor = physicsPredictor(turning, 4, 20, 0, makeRng(1));
    const predicted = predictor(20);
    const straight = {
      x: turning.x + turning.vx * (20 / TICK_RATE_HZ),
      y: turning.y + turning.vy * (20 / TICK_RATE_HZ),
    };
    // A car turning at 4 rad/s is nowhere near the straight-line point 20 ticks out.
    expect(Math.hypot(predicted.x - straight.x, predicted.y - straight.y)).toBeGreaterThan(50);
  });

  it("clamps past its horizon rather than extrapolating off the end", () => {
    const predictor = physicsPredictor(carAt(), 0, 10, 0, makeRng(2));
    expect(predictor(50)).toEqual(predictor(10));
  });

  it("resolves a sub-one-tick ask to the FIRST rolled pose, not a negative index", () => {
    // Math.round(0.3) is 0, so a naive `poses[Math.round(ticksAhead) - 1]` reads poses[-1]
    // (undefined) and throws on `.x`. Any ticksAhead in (0, 1) must clamp UP to one tick ahead,
    // the same way past-the-horizon clamps DOWN to the last pose.
    const predictor = physicsPredictor(carAt(), 0, 10, 0, makeRng(3));
    expect(predictor(0.3)).toEqual(predictor(1));
  });
});

describe("selfPredictor", () => {
  it("clamps past its horizon, same as physicsPredictor", () => {
    const predictor = selfPredictor(selfAt(), { steer: 0, throttle: 0 }, 10);
    expect(predictor(50)).toEqual(predictor(10));
  });

  it("curves a self observed mid-turn, same as physicsPredictor does for others", () => {
    // bodyFromSelf reads angVel off nothing (self has no angVel field), and it deliberately drops
    // the maneuver state too (finding 3), so there is nothing on a self body that curves on its own:
    // drive steer/throttle to get a curve instead.
    const straight = rollForward(
      bodyFromSelf(selfAt()), "mirage", { steer: 0, throttle: 0 }, 15, NEUTRAL_MODIFIERS,
    );
    const turning = rollForward(
      bodyFromSelf(selfAt()), "mirage", { steer: 1, throttle: 1 }, 15, NEUTRAL_MODIFIERS,
    );
    expect(Math.abs(turning.at(-1)!.y)).toBeGreaterThan(Math.abs(straight.at(-1)!.y));

    const straightPredictor = selfPredictor(selfAt(), { steer: 0, throttle: 0 }, 15);
    const turningPredictor = selfPredictor(selfAt(), { steer: 1, throttle: 1 }, 15);
    expect(Math.abs(turningPredictor(15).y)).toBeGreaterThan(Math.abs(straightPredictor(15).y));
  });
});

describe("bodyFromSelf mid-dash", () => {
  it("discards a live dash instead of predicting the bot parked (final review, finding 3)", () => {
    // `bodyFromSelf` used to copy a genuine `self.maneuverTicksLeft` while fabricating
    // `maneuverSpeed: 0`, so `stepDrive` took its `stepDash` branch and `dashTranslation` returned
    // `{0, 0}`: the bot predicted ITSELF standing still for the rest of the dash (thunderclap:
    // 8 ticks, ~400 units of real travel) and then had `stepDash`'s `done` branch write
    // `chassis.maxSpeed * mods.topSpeed` straight into its speed — both halves contradicting
    // `selfPredictor`'s own doc comment. Zeroing the field is also what keeps `isDashing` false on
    // every predictor body, which is what makes `OBSERVATION_MODIFIERS`'s raised `topSpeed` safe.
    const dashing = selfAt({ maneuver: ManeuverKind.DASH, maneuverTicksLeft: 8, speed: 400 });
    expect(bodyFromSelf(dashing).maneuverTicksLeft).toBe(0);
    // 8 ticks of a held 400 u/s is 106.67 units, which is what it now predicts. It was 0.00.
    expect(selfPredictor(dashing, { steer: 0, throttle: 1 }, 8)(8).x)
      .toBeCloseTo((400 * 8) / TICK_RATE_HZ, 6);
  });
});

describe("predicting an observed car, against an independent ground truth", () => {
  // The measurement behind the controller's choice of held input (task 4, ruling 2; fix round 1,
  // finding 1). GROUND TRUTH here is `truthPath` below -- a local integrator that calls NEITHER
  // `stepDrive` NOR `rollForward` NOR any predictor. An earlier version of this suite scored the
  // shipped model against `rollForward` run with the same inputs, which is an identity: it could
  // not fail for any implementation, so a systematic over-lead shipped straight past it.
  //
  // `truthPath` is the behaviour of a car that HOLDS the speed and the steer it was seen at,
  // integrated in `stepDrive`'s own order (rotate, then translate). That is exactly what a person
  // reads off the screen, and it is the claim the shipped model makes.
  //
  // RE-DERIVED, STAGE 5 TASK 8 (2026-09-19). `truthPath` used to assume the velocity vector rotates
  // WITH the heading every tick — `x/y += cos/sin(angle) * speed`, angle already advanced — which is
  // exactly the pre-port `steeringGrip: 1.0` model (nose welds velocity). Under the Unity drive
  // model that assumption is now FALSE for any `steer !== 0` scene: `stepDrive` recomposes the
  // velocity at the OLD (pre-rotation) angle every tick (`drive.ts`'s own comment: "rotating the car
  // must not rotate its velocity"), so the heading and the velocity vector drift apart — that IS the
  // slip this port added, and it is large enough now (stage 5 Task 5's turn-rate raise put Mirage's
  // steady-state slip at ~36°) that the old assumption was off by tens to hundreds of units, not a
  // rounding error (measured before this fix: up to 164 units at `steer: 1`, 90 ticks). That is a
  // stale GROUND-TRUTH MODEL, not a bot regression: `physicsPredictor` reuses the real `stepDrive`
  // unchanged, so it was always correct; this helper's independent reference was not.
  //
  // Re-derived from the model's own documented equations (`drive.ts`, `DRIVE_CONFIG.lateralGripRate`),
  // NOT by calling `stepDrive`/`rollForward` — that would make this an identity again, the exact
  // defect the comment above already warns about. Under `OBSERVATION_MODIFIERS` (`accel: 0`) the
  // engine command is always 0 and drag is always the identity (`dragFactorOf` raises `dragPerTick`
  // to the power of `mods.accel`, i.e. to the power 0), so the only things that move the (forward,
  // lateral) pair tick to tick are: grip decaying the lateral half, and the heading advancing by a
  // FIXED `steer * turnRateOf(carId) * dt` every tick while the recomposed velocity keeps pointing
  // along the angle it was BUILT at. That is a linear, time-invariant recurrence — decay the lateral
  // half, then rotate the frame by `-delta` — solvable by hand as a 2x2 matrix update with no
  // `stepDrive` call anywhere in it. Verified independently (both derivations, arrived at from the
  // documented equations rather than from each other) to agree with the real `stepDrive` to
  // ~1e-14 across every scene and horizon below, which is what makes it trustworthy as ground truth
  // rather than a second copy of the thing under test.
  const HORIZONS = [10, 20, 45, 90] as const;
  const LONGEST = Math.max(...HORIZONS);
  const dt = 1 / TICK_RATE_HZ;

  /**
   * One tick, in the (forward, lateral) frame `OBSERVATION_MODIFIERS` puts the car in: no engine,
   * no drag, only grip (on lateral) and the heading's steady rotation. `delta` is the FIXED per-tick
   * yaw (`steer * turnRateOf(carId) * dt` — yaw is speed-independent under the Unity model, so this
   * is a true constant, not a stopped-vs-moving branch).
   *
   * A NEGATIVE `speed` needs no special case and gets none: the recurrence is linear in the initial
   * (forward, lateral) pair, so a reversing car walks backward along whatever the drift produces,
   * exactly as `stepDrive` does.
   */
  function truthPath(speed: number, steer: -1 | 0 | 1, carId: "mirage", ticks: number) {
    const chassis = driveOf(carId);
    const grip = chassis.gripPerTick;
    const delta = steer * turnRateOf(carId) * dt;
    let forward = speed;
    let lateral = 0;
    let angle = 0;
    let x = 0;
    let y = 0;
    const out: { x: number; y: number; angle: number }[] = [];
    for (let i = 0; i < ticks; i++) {
      // Drag is the identity under `accel: 0`; grip still bleeds the lateral half every tick.
      const f = forward;
      const l = lateral * grip;
      // Recomposed at the OLD angle, same as `stepDrive`'s own step 5 — the car's nose has not
      // rotated yet as far as this tick's translation is concerned.
      const vx = Math.cos(angle) * f - Math.sin(angle) * l;
      const vy = Math.sin(angle) * f + Math.cos(angle) * l;
      x += vx * dt;
      y += vy * dt;
      angle += delta;
      // Next tick decomposes that same (f, l) pair against the NEW angle — a rotation by `-delta`
      // relative to the frame it was built in, which is exactly where the drift comes from.
      forward = f * Math.cos(delta) + l * Math.sin(delta);
      lateral = -f * Math.sin(delta) + l * Math.cos(delta);
      out.push({ x, y, angle });
    }
    return out;
  }

  const errorAt = (
    truth: readonly { x: number; y: number }[],
    guess: { x: number; y: number },
    ticksAhead: number,
  ): number => {
    const actual = truth[ticksAhead - 1]!;
    return Math.hypot(guess.x - actual.x, guess.y - actual.y);
  };

  // Mirage's resolved drive numbers, so the rows below are FRACTIONS OF the chassis's real caps
  // rather than round numbers that happen to sit near them. `maxSpeed` is 189.03.
  //
  // `reverseMaxSpeed` is gone from `ChassisDrive` (the Unity drive-model port, car-physics-port
  // stage 1 Task 3): there is no separately-authored reverse top speed any more, only the emergent
  // equilibrium `reverseAccel / dragRate` — computed below as `REVERSE_MAX_SPEED`, since it is not
  // a field this table can read off `driveOf` directly. It is 113.418 for Mirage today (122.8695
  // under the pre-port `forwardMaxSpeedOf * reverseSpeedRatio` model this comment used to cite;
  // 449.5 * 0.65 = 292.175 when this table was first written, 267 * 0.65 = 173.55 after the
  // 2026-09-06 heavy-car pass) — a real, different number under a genuinely different formula, not
  // a retune.
  //
  // The middle rows became cap-relative on 2026-09-16 for the reason the two extremes always were:
  // typed as 150 and 250 they described a "crawling" car at 79% of the cap and a "mid speed" car
  // 32% ABOVE it — an observation the sim cannot produce, silently measuring the rollout's clamp
  // instead of the scene each label names. The fractions reproduce what those figures meant against
  // the 449.5 cap they were authored for (150/449.5 ~= 1/3, 250/449.5 ~= 5/9, -150/292.175 ~= 0.51).
  const MIRAGE = driveOf("mirage");
  const REVERSE_MAX_SPEED = MIRAGE.reverseAccel / MIRAGE.dragRate;

  // Every scene a bot actually faces, not just the one the model reproduces by construction -- the
  // old suite was full lock AND full speed in every case, which is why the over-lead walked
  // through it. The stationary rows are the important ones: a target `stunned` by `roadblock`,
  // `thunderclap` or the hard slam carries `fullStop` + `immobilised` and cannot move at all, and
  // that is the exact condition `classifySituation` gates `punish` on.
  //
  // The REVERSING rows are the same question with the sign flipped (fix round 2, finding A), and
  // they are not a corner case: `throttle: -1` is a third of `planner.ts`'s `ALL_ACTIONS` and is
  // what the range term picks inside the bot's preferred standoff (the `panic-reverse` blunder this
  // used to cite alongside it was deleted by P41), so both the target predictor and `selfPredictor`
  // meet a car rolling backward constantly. `accelerateForward`'s
  // rolling-backward branch is `brakeDecel`, not `accel`, which is why zeroing one channel was not
  // enough -- see `OBSERVATION_MODIFIERS`.
  const SCENES: readonly { speed: number; steer: -1 | 0 | 1; label: string }[] = [
    { speed: -REVERSE_MAX_SPEED, steer: 0, label: "reversing at the cap, straight" },
    { speed: -REVERSE_MAX_SPEED, steer: 1, label: "reversing at the cap, wheel over" },
    { speed: -REVERSE_MAX_SPEED * 0.51, steer: 0, label: "reversing, straight" },
    { speed: -REVERSE_MAX_SPEED * 0.51, steer: 1, label: "reversing, wheel over" },
    { speed: 0, steer: 0, label: "stunned, wheel straight" },
    { speed: 0, steer: 1, label: "stunned, wheel over" },
    { speed: MIRAGE.maxSpeed / 3, steer: 0, label: "crawling, straight" },
    { speed: MIRAGE.maxSpeed / 3, steer: 1, label: "crawling, full lock" },
    { speed: (MIRAGE.maxSpeed * 5) / 9, steer: 0, label: "mid speed, straight" },
    { speed: (MIRAGE.maxSpeed * 5) / 9, steer: 1, label: "mid speed, full lock" },
    // The chassis MAXIMUM, not a round number below it (fix round 2, finding B). This row exists to
    // pin the one case an engine-on rollout gets right by accident, and that is only true AT the
    // cap: at 400 an engine-on rollout is still 32 units out at 20 ticks. It was 400 while
    // `OBSERVATION_MODIFIERS`'s table quoted 449.5 for the same row, and the two now agree.
    { speed: MIRAGE.maxSpeed, steer: 0, label: "top speed, straight" },
    { speed: MIRAGE.maxSpeed, steer: 1, label: "top speed, full lock" },
  ];

  // The steer is no longer handed in: `physicsPredictor` DERIVES it from the observed turn rate
  // (final review, finding 1), so a scene that wants a car at full lock has to be described the way
  // a bot actually meets one — as an observed `angVel`. Full lock is exactly what
  // `steerFromObservedTurn` reconstructs from `turnRateOf(carId)`, and at sigma 0 there is no noise
  // to move it, so every row below rolls the steer its label names. Verified by the assertions
  // themselves: the turning rows score against a `truthPath` integrated at that same steer.
  const shipped = (speed: number, steer: -1 | 0 | 1) => physicsPredictor(
    carAt({ speed }), steer * turnRateOf("mirage"), LONGEST, 0, makeRng(11),
  );

  it("holds the observed speed, landing on the true path at every horizon and every speed", () => {
    for (const scene of SCENES) {
      const truth = truthPath(scene.speed, scene.steer, "mirage", LONGEST);
      const predictor = shipped(scene.speed, scene.steer);
      for (const ticks of HORIZONS) {
        // Deliberately generous: the claim is "on the path", not a digit-for-digit pin. Measured at
        // 0.00 world units for every row of this table, out to 90 ticks.
        expect(errorAt(truth, predictor(ticks), ticks), `${scene.label} @${ticks}`).toBeLessThan(1);
      }
    }
  });

  it("keeps a STATIONARY target inside its own hull, at every horizon", () => {
    // The regression this suite exists for. With the engine modelled on, a stunned car was
    // predicted hundreds of units downrange: `marchOne` scored every slot against empty floor,
    // `minShotValueFraction` declined the free shot, and `fight` steered the nose off the real car.
    // A hull is the honest bar -- a shot aimed anywhere inside it hits.
    const hullRadius = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2;
    for (const steer of [0, 1] as const) {
      const predictor = shipped(0, steer);
      for (const ticks of HORIZONS) {
        const guess = predictor(ticks);
        expect(Math.hypot(guess.x, guess.y), `steer ${steer} @${ticks}`).toBeLessThan(hullRadius);
      }
    }
  });

  it("beats an engine-on rollout, worst of all where the target cannot move", () => {
    // `accel: 1` is what `rollForward`'s DEFAULT modifiers give -- a genuine car flooring it. Right
    // for planning the bot's OWN inputs, wrong for an observation, because a bot cannot see a
    // throttle. Measured error in world units at 20 / 45 ticks: 209 / 584 for the stunned car going
    // straight, 81 / 71 for the stunned car with the wheel over, 53 / 41 at 150 u/s, 31 / 21 at
    // 250 u/s, and 292 / 910 at the reverse cap going straight -- shrinking to nothing only AT the
    // chassis maximum, the one row an engine-on rollout gets right by accident.
    for (const scene of SCENES) {
      const truth = truthPath(scene.speed, scene.steer, "mirage", LONGEST);
      const engineOn = rollForward(
        bodyFromObservation(carAt({ speed: scene.speed }), 0), "mirage",
        { steer: scene.steer, throttle: 1 }, LONGEST, NEUTRAL_MODIFIERS,
      );
      const held = shipped(scene.speed, scene.steer);
      for (const ticks of HORIZONS) {
        // `+ 1e-9` since the 2026-09-07 merge. On the top-speed row BOTH rollouts are exact and
        // the comparison is 0 against 0 — but the vector drive rebuilds the velocity through
        // `toWorld`'s cos/sin every tick where the scalar model carried a magnitude along the
        // heading, so the shipped set lands 1.07e-14 from the truth instead of dead on it. A strict
        // `<=` was reading one ULP of rounding as "worse than engine-on". The epsilon is far below
        // any distance this test is about (the smallest real gap it pins is 10 units).
        expect(errorAt(truth, held(ticks), ticks), `${scene.label} @${ticks}`)
          .toBeLessThanOrEqual(errorAt(truth, engineOn[ticks - 1]!, ticks) + 1e-9);
      }
      // And where it is wrong, it is wrong by car lengths, not by rounding.
      //
      // CAP-RELATIVE since the 2026-09-07 merge, where it was an absolute `scene.speed < 300`.
      // The guard exists to exclude the one row an engine-on rollout gets right by accident — the
      // row AT the chassis maximum — and 300 named that correctly only while Mirage's cap was
      // 449.5. The car-physics rework's heavy-car pass cut it to 267, which put the `250` row at
      // 94% of the cap: an engine-on rollout is 1.1 units out there, not the >10 this asserts, for
      // exactly the accidental reason the cap row is excluded for. Written against the cap, the
      // guard keeps meaning what it says through the next speed retune as well.
      if (scene.speed < MIRAGE.maxSpeed * 0.9) {
        expect(errorAt(truth, engineOn[44]!, 45), `${scene.label} @45`).toBeGreaterThan(10);
      }
    }
  });

  it("holds a REVERSING car's speed", () => {
    // REWRITTEN, STAGE 5 TASK 8 (2026-09-19), FIX ROUND 1 — a STALE TEST, not a bot regression. This
    // used to measure a real gap between `accel: 0` alone and `OBSERVATION_MODIFIERS` (`accel: 0,
    // brakeDecel: 0` together) for a reversing car, citing an `accelerateForward` function whose
    // `speed < -stopEpsilon` branch braked at `brakeDecel` regardless of the commanded throttle. That
    // function is not the current model: `drive.ts`'s `engineCommandOf` reads `brakeDecel` ONLY on
    // `throttle: -1`, never on `throttle: 1` — and every observation rollout (this file's `shipped`,
    // `rollForward`'s own production callers) holds `throttle: 1` always, exactly as `predict.ts`'s
    // `OBSERVATION_MODIFIERS` doc comment now states outright ("no production predictor passes
    // `throttle: -1`, and the engine-command table gives the brake no other path"). So for every
    // scene `rollForward` can actually reach, `accel: 0` alone and `OBSERVATION_MODIFIERS` compute
    // the SAME thing — the old comparison was measuring a code path this file's own tests never
    // execute, which is why it could never pass again.
    //
    // A fix round 1 finding: an earlier draft of this rewrite tried to turn that fact into a second
    // assertion (`accel`-only rollout equals a fresh `OBSERVATION_MODIFIERS` one). That is TRUE BY
    // CONSTRUCTION given `engineCommandOf` never reads `brakeDecel` on `throttle: 1` — two mods
    // objects that differ only in a field the code path never touches are equal for any input, which
    // is a fact about `stepDrive`'s own structure (properly a `drive.test.ts`/`channels.test.ts`
    // concern in shared), not something this file's own inputs could ever fail to demonstrate.
    // Dropped rather than kept for appearances; the one assertion below is the actual, falsifiable
    // property this test is named for.
    const reversing = SCENES.filter((scene) => scene.speed < 0);
    expect(reversing).toHaveLength(4);
    for (const scene of reversing) {
      const truth = truthPath(scene.speed, scene.steer, "mirage", LONGEST);
      const held = shipped(scene.speed, scene.steer);
      for (const ticks of HORIZONS) {
        // The property this test is actually named for: a reversing car's observed speed is held,
        // not decayed toward rest or accelerated toward the chassis maximum.
        expect(errorAt(truth, held(ticks), ticks), `${scene.label} @${ticks}`).toBeLessThan(1);
      }
    }
  });

  it("beats a straight line wherever the target turns, and never loses where it does not", () => {
    // `constantVelocityPredictor` is exactly right for a car going straight (it IS the same
    // integration) and diverges without bound once one turns. It also handles the stunned car
    // correctly, which the engine-on rollout does not -- the honest reading is that phase A's win is
    // the TURNING case plus never being worse elsewhere, not a win everywhere.
    //
    // RE-DERIVED, STAGE 5 TASK 8 (2026-09-19): the flat ">10 units" floor is a STALE NUMBER, not a
    // bot regression — it was measured against the pre-port `truthPath` (see that function's own
    // 2026-09-19 comment), whose driftless circular arc swings away from a straight line much faster
    // than the real, drift-carrying trajectory does. Re-measured against the corrected `truthPath`,
    // every turning scene still clears 10 units by 20 ticks (smallest measured 19.69), but AT 10
    // TICKS specifically four of the eight now read single digits (3.68-7.22) simply because a
    // quarter-second of real drift has not yet swung the true path as far from a straight line as
    // the old ground truth assumed — the one row that still clears 10 at that horizon (top speed,
    // full lock, 12.04) does so only because top speed itself is what is large, not the divergence
    // rate. The floor is now tick-scaled rather than flat: 10 ticks asks for the smallest margin
    // that still clears every measured row (>2, all eight sit at 3.68 or above), 20+ ticks keeps the
    // original >10 (all eight sit at 19.69 or above there).
    for (const scene of SCENES) {
      const truth = truthPath(scene.speed, scene.steer, "mirage", LONGEST);
      const straight = constantVelocityPredictor(carAt({ speed: scene.speed }));
      const held = shipped(scene.speed, scene.steer);
      for (const ticks of HORIZONS) {
        const straightError = errorAt(truth, straight(ticks), ticks);
        expect(errorAt(truth, held(ticks), ticks), `${scene.label} @${ticks}`)
          .toBeLessThanOrEqual(straightError + 1);
        // `!== 0`, not `> 0`: a car reversing round a corner leaves a straight line just as fast as
        // one driving round it, and the reversing rows would otherwise assert nothing here.
        if (scene.steer !== 0 && scene.speed !== 0) {
          const floor = ticks <= 10 ? 2 : 10;
          expect(straightError, `${scene.label} @${ticks}`).toBeGreaterThan(floor);
        }
      }
    }
  });

  it("still lands a throttle-closed rollout SHORT, which is why it is not the held input", () => {
    // The OTHER way to get this wrong, and the one the task brief originally specified: rolling an
    // observed target with the throttle CLOSED rather than held.
    //
    // RE-PINNED at the 2026-09-07 merge, and this is the test the car-physics rework cost the most.
    // It used to assert a DEAD STOP: `DRIVE_CONFIG.drag` was 900 u/s^2, 0.32 s to rest, so a
    // throttle-closed rollout covered 82 units against the 266 a held 400 u/s really travels — a
    // 184-unit error that made "hold the throttle" obviously right. The rework deleted that knob for
    // per-car proportional coast, and at Mirage's 36-tick half-life the same rollout now covers
    // 219.2 units and is still doing 272 u/s at the end. The error is ~47 units, not 184.
    //
    // THE DIRECTION IS UNCHANGED and that is what this still pins: a throttle-closed rollout lands
    // SHORT of the truth, so it is still the wrong input to hold and `OBSERVATION_MODIFIERS` is
    // still the right set. But the margin it wins by shrank roughly four-fold, which is a fact
    // about `OBSERVATION_MODIFIERS`'s justification that its own doc comment now overstates.
    const car = carAt({ speed: 400 });
    const braking = rollForward(
      bodyFromObservation(car, 0), "mirage", { steer: 0, throttle: 0 }, 20, NEUTRAL_MODIFIERS,
    );
    const end = forwardOf(braking.at(-1)!.vx, braking.at(-1)!.vy, braking.at(-1)!.angle);
    expect(end).toBeLessThan(400);
    expect(end).toBeGreaterThan(0);
    // Short of the 266 units a held 400 u/s covers, and short of the truth by a real margin.
    expect(Math.hypot(braking.at(-1)!.x - car.x, braking.at(-1)!.y - car.y)).toBeLessThan(266);
    expect(errorAt(truthPath(400, 0, "mirage", 20), braking[19]!, 20)).toBeGreaterThan(30);
  });
});

describe("reading a turn off two observed poses, end to end", () => {
  // The observation step this phase actually adds, exercised through the REAL
  // `perceive` -> `observedAngVelOf` -> `steerFromObservedTurn` chain rather than by handing
  // `turnRateOf("mirage")` in as a given. Two consecutive poses off a rolled path are all a bot
  // ever gets, and this is the only place that claim is tested end to end.
  const profile = BOT_PROFILES.hard;

  function observedTurnOf(steer: -1 | 0 | 1): number {
    const path = rollForward(
      bodyFromObservation(carAt({ x: 400, y: 0, speed: 400 }), 0), "mirage",
      { steer, throttle: 1 }, 4, NEUTRAL_MODIFIERS,
    );
    const state = newPerception();
    const viewAt = (tick: number, pose: { x: number; y: number; angle: number }): BotView => ({
      tick,
      self: selfAt({ speed: 0 }),
      others: [carAt({ x: pose.x, y: pose.y, angle: pose.angle, speed: 400 })],
      instances: [],
      arena: { width: 4000, height: 3000, obstacles: [] },
      observedFires: [],
      rng: makeRng(1),
    });
    perceive(state, viewAt(0, path[0]!), profile);
    perceive(state, viewAt(1, path[1]!), profile);
    return observedAngVelOf(state, "them");
  }

  it("recovers full lock from two poses of a real rolled path", () => {
    const observed = observedTurnOf(1);
    expect(observed).toBeCloseTo(turnRateOf("mirage"), 3);
    expect(steerFromObservedTurn(observed, "mirage")).toBe(1);
  });

  it("recovers the other direction, and reads a coasting car as not steering", () => {
    expect(observedTurnOf(-1)).toBeCloseTo(-turnRateOf("mirage"), 3);
    expect(steerFromObservedTurn(observedTurnOf(-1), "mirage")).toBe(-1);
    expect(observedTurnOf(0)).toBeCloseTo(0, 6);
    expect(steerFromObservedTurn(observedTurnOf(0), "mirage")).toBe(0);
  });
});

describe("interceptTicks", () => {
  it("returns ~0 for a co-located target", () => {
    const predictor = physicsPredictor(carAt(), 0, 30, 0, makeRng(4));
    expect(interceptTicks({ x: 0, y: 0 }, predictor, 600, 30)).toBe(0);
  });

  it("returns ~TICK_RATE_HZ ticks for a 600u target at 600 u/s against a stationary predictor", () => {
    const stationary = () => ({ x: 600, y: 0, angle: 0 });
    const ticks = interceptTicks({ x: 0, y: 0 }, stationary, 600, TICK_RATE_HZ * 2);
    expect(ticks).toBeCloseTo(TICK_RATE_HZ, 0);
  });

  it("returns 0 for a non-positive projectile speed", () => {
    const predictor = physicsPredictor(carAt(), 0, 30, 0, makeRng(5));
    expect(interceptTicks({ x: 0, y: 0 }, predictor, 0, 30)).toBe(0);
  });

  it("converges past the naive single-round guess for a target receding from the shooter", () => {
    // A predictor whose position genuinely CHANGES with ticksAhead: moving straight away from the
    // shooter at half the projectile's speed. Each fixed-point round re-measures distance against
    // where the target will be by then, which is farther out than "now" -- so the converged answer
    // must overshoot distance-now/projectileSpeed, the naive first-round guess. If the solver were
    // only doing one round (or the loop were a no-op), this would fail.
    const projectileSpeed = 600;
    const startDistance = 300;
    const recedingSpeed = 300; // u/s, well under projectileSpeed so the iteration converges
    const receding = (ticksAhead: number) => ({
      x: startDistance + (recedingSpeed * ticksAhead) / TICK_RATE_HZ,
      y: 0,
      angle: 0,
    });
    const naiveTicks = Math.round((startDistance / projectileSpeed) * TICK_RATE_HZ);
    const maxTicks = TICK_RATE_HZ * 2;
    const converged = interceptTicks({ x: 0, y: 0 }, receding, projectileSpeed, maxTicks);
    expect(converged).toBeGreaterThan(naiveTicks);
    expect(converged).toBeLessThan(maxTicks);
  });
});

describe("state estimation noise (P20)", () => {
  it("perturbs the SPEED read, and a tighter sigma perturbs it less", () => {
    // `angVel: 0`, so this is the speed half of the knob alone; the two tests below are the turn
    // half, which had no coverage here at all until the final review's finding 1.
    const car = carAt({ speed: 400 });
    const at = (sigma: number) => physicsPredictor(car, 0, 20, sigma, makeRng(9))(20);
    const truth = physicsPredictor(car, 0, 20, 0, makeRng(9))(20);
    const sloppy = at(0.25);
    const sharp = at(0.03);
    const err = (p: { x: number; y: number }) => Math.hypot(p.x - truth.x, p.y - truth.y);
    expect(err(sloppy)).toBeGreaterThan(err(sharp));
  });

  it("perturbs a residual SPIN too, and a tighter sigma perturbs it less", () => {
    // The TURNING counterpart the speed-only test above was missing (final review, finding 1): with
    // `angVel: 0` there is no turn to get wrong, so that test only ever exercised half the knob.
    //
    // BELOW `steerFromObservedTurn`'s threshold is where the turn read scales CONTINUOUSLY: the
    // residual is a ram's injected spin and the noised rate is fed straight back as `angVel`. Above
    // the threshold the read is quantised to a -1/0/1 steer, so moderate noise there changes nothing
    // at all and the noise acts only by moving the read ACROSS the threshold — the test below.
    const car = carAt({ speed: 400 });
    const spin = 3; // rad/s, under Mirage's 4.095 threshold: a ram's residual, not a held wheel
    const truth = physicsPredictor(car, spin, 20, 0, rngGiving(-1))(20);
    const err = (sigma: number) => {
      const guess = physicsPredictor(car, spin, 20, sigma, rngGiving(-1))(20);
      return Math.hypot(guess.x - truth.x, guess.y - truth.y);
    };
    // Measured: 8.80 world units at hard's sigma, 71.70 at easy's.
    expect(err(0.03)).toBeGreaterThan(0);
    expect(err(0.25)).toBeGreaterThan(err(0.03) * 2);
  });

  it("lets a sloppy read miss a curve entirely, and even read it backwards", () => {
    // THE POINT of finding 1. The steer is reconstructed from the NOISED turn rate, inside
    // `physicsPredictor`, after the draws — not from the raw observation out in `controller.ts`,
    // where every tier read a curve perfectly and `turnNoise` only ever multiplied a residual spin
    // that a steering car does not have. A car at full lock, read by a bot whose estimate falls far
    // enough short, must stop reading as a car that is steering at all; read short enough to change
    // sign, it must arc the OTHER way.
    const full = turnRateOf("mirage");
    const car = carAt({ speed: 400 });
    // `rngGiving(-1)` makes the turn estimate `full * (1 - sigma)`, so sigma is exactly how far the
    // read falls short. The steering threshold is half of full lock.
    const turnedBy = (sigma: number) =>
      physicsPredictor(car, full, 20, sigma, rngGiving(-1))(20).angle - car.angle;

    // A sharp read holds the wheel over for the whole horizon: 5.46 rad in 20 ticks.
    expect(turnedBy(0.03)).toBeCloseTo(full * (20 / TICK_RATE_HZ), 6);
    // A read 60% low lands at 0.4 of full lock, under the threshold, so the arc collapses to a
    // decaying spin — measured 1.25 rad against the sharp read's 5.46.
    expect(turnedBy(0.6)).toBeGreaterThan(0);
    expect(turnedBy(0.6)).toBeLessThan(turnedBy(0.03) / 4);
    // A read 160% low is a SIGN flip: -0.6 of full lock, back over the threshold the other way, so
    // the bot leads the corner the target is NOT taking. A steer reconstructed from the raw
    // observation could not produce this at any sigma, which is the whole defect.
    expect(turnedBy(1.6)).toBeCloseTo(-turnedBy(0.03), 6);
  });

  it("reads either side of the steering threshold, by how far the estimate falls short", () => {
    // The threshold case. `steerFromObservedTurn` splits at `fullLockAngVelFraction` (a half), so a
    // read of full lock that falls exactly half short sits ON the boundary; these two sigmas bracket
    // it by a hundredth each way rather than betting on floating-point equality.
    const full = turnRateOf("mirage");
    const car = carAt({ speed: 400 });
    const turnedBy = (sigma: number) =>
      physicsPredictor(car, full, 20, sigma, rngGiving(-1))(20).angle - car.angle;
    // 0.51 of full lock — just OVER the bar, so it reads as a held wheel and arcs the full amount.
    expect(turnedBy(0.49)).toBeCloseTo(full * (20 / TICK_RATE_HZ), 6);
    // 0.49 of full lock — just UNDER, so it reads as a spin and decays instead. Measured 1.53 rad.
    expect(turnedBy(0.51)).toBeGreaterThan(0);
    expect(turnedBy(0.51)).toBeLessThan(turnedBy(0.49) / 3);
  });

  it("moves the prediction as far for a positive speed error as for the equal negative one, AT THE CAP", () => {
    // Final review, finding 2. `OBSERVATION_MODIFIERS` used to leave `topSpeed: 1`, so
    // `accelerateForward`'s `Math.min(chassis.maxSpeed * mods.topSpeed, ...)` clipped every
    // observed-plus-noise speed above the chassis cap on the rollout's FIRST tick. A car flooring it
    // sits exactly at that cap — which is most of `fight` and `close` — so at the most common speed
    // in the game the knob lost half its range and every tier was biased toward UNDER-leading.
    //
    // Measured for Mirage at its 449.5 u/s cap over 45 ticks, dx against the sigma-0 rollout:
    //   BEFORE: +25% 0.00, +50% 0.00, -25% -168.56
    //   AFTER:  +25% +168.56, +50% +337.13, -25% -168.56
    // At 250 u/s the pair was already symmetric at +-93.75 either way, which is what said the defect
    // was the CLAMP and not the noise.
    //
    // The `over` bound is DERIVED since 2026-09-16 rather than the typed 100 it was: a sigma-0.25
    // over-read at the cap displaces the prediction by exactly `maxSpeed * 0.25 * horizonSeconds`
    // WHEN NOTHING CLAMPS IT, which is the property under test, so the clean statement is that it
    // lands on that figure rather than that it clears some round number below it. The typed 100 was
    // 0.1% under the value it was guarding at the time it was written, and the 2026-09-16 speed cut
    // (267 -> 189.03) took the true figure to 70.89 and failed it.
    const cap = driveOf("mirage").maxSpeed;
    const car = carAt({ speed: cap });
    const dx = (sigma: number, draw: number) =>
      physicsPredictor(car, 0, 45, sigma, rngGiving(draw))(45).x
        - physicsPredictor(car, 0, 45, 0, rngGiving(draw))(45).x;
    const over = dx(0.25, 1);
    const under = dx(0.25, -1);
    expect(over).toBeCloseTo(cap * 0.25 * (45 / TICK_RATE_HZ), 6); // it was 0.00
    expect(over).toBeCloseTo(-under, 6);
    // And it keeps scaling past the cap rather than saturating at it.
    expect(dx(0.5, 1)).toBeCloseTo(over * 2, 6);
  });

  it("draws the same number of rng calls whether sigma is zero or not (H21)", () => {
    let calls = 0;
    const counting = () => { calls += 1; return 0.5; };
    physicsPredictor(carAt(), 0, 5, 0, counting);
    const withZero = calls;
    // FOUR, not two: `gaussian` is Box-Muller and draws a PAIR, and there are two gaussians. Pinned
    // outright because the count had drifted into three comments as "two" (final review, finding 4).
    expect(withZero).toBe(4);
    calls = 0;
    physicsPredictor(carAt(), 0, 5, 0.2, counting);
    expect(calls).toBe(withZero);
    // And the steer reconstruction moved INSIDE the predictor by finding 1 draws nothing of its own:
    // a turning observation, which takes a different branch, still draws exactly four.
    calls = 0;
    physicsPredictor(carAt(), turnRateOf("mirage"), 5, 0.2, counting);
    expect(calls).toBe(withZero);
  });
});
