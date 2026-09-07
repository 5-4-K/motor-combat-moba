import { describe, expect, it } from "vitest";
import {
  DRIVE_CONFIG, ManeuverKind, NEUTRAL_MODIFIERS, TICK_RATE_HZ, driveOf, forwardOf,
  turnRateAtStopOf, turnRateOf,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView, BotView } from "../types.js";
import { newPerception, observedAngVelOf, perceive } from "./perception.js";
import {
  bodyFromObservation, bodyFromSelf, interceptTicks, physicsPredictor, rollForward,
  selfPredictor, steerFromObservedTurn,
} from "./predict.js";
import { constantVelocityPredictor } from "./solution.js";

/**
 * `speed` is still accepted as an OVERRIDE and resolved here to `vx`/`vy` along the (possibly also
 * overridden) `angle`.
 *
 * The car-physics rework replaced the view's scalar `speed` with a world velocity, and every scene
 * in this file means "travelling at N along its nose" when it writes `speed: N` — so the conversion
 * belongs in one place rather than at each of the thirty-odd call sites, where spelling it out would
 * bury what each scene is actually about. Pass `vx`/`vy` directly for the rare scene that wants a
 * car sliding across its own nose; the two forms compose, with `speed` applied last.
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

/** The `speed` override behaves exactly as it does in `carAt` above — see there. */
function selfAt(over: Partial<BotSelfView> & { speed?: number } = {}): BotSelfView {
  const { speed, ...rest } = over;
  const self: BotSelfView = {
    sessionId: "me", carId: "mirage", team: 0, x: 0, y: 0, angle: 0, vx: 300, vy: 0,
    hp: 70, maxHp: 70, alive: true, statuses: [], slots: [], switchLockUntilTick: 0,
    lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0, ...rest,
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
    // landed on 40-50 units. That knob no longer exists. Coast is now per-car and PROPORTIONAL
    // (`CarDef.coastHalfLifeSeconds` -> `ChassisDrive.coastPerTick`), and Mirage's half-life is 36
    // ticks — so a full second of coasting sheds barely half the speed and covers 225.7 units, most
    // of the 300 a held speed would. A heavy car that carries its momentum is the whole point of
    // the 2026-09-06 heavy-car pass, so this is the pass landing, not a regression.
    expect(poses.at(-1)!.x).toBeGreaterThan(200);
    expect(poses.at(-1)!.x).toBeLessThan(250);
    expect(Math.abs(poses.at(-1)!.y)).toBeLessThan(1);
    // Still DECAYING, just gently: below the 300 it started at, well above rest.
    const end = forwardOf(poses.at(-1)!.vx, poses.at(-1)!.vy, poses.at(-1)!.angle);
    expect(end).toBeLessThan(300);
    expect(end).toBeGreaterThan(100);
  });

  it("curves a car that was observed turning, without any input", () => {
    const straight = rollForward(
      bodyFromObservation(carAt(), 0), "mirage", { steer: 0, throttle: 0 }, 15, NEUTRAL_MODIFIERS,
    );
    const turning = rollForward(
      bodyFromObservation(carAt(), 3), "mirage", { steer: 0, throttle: 0 }, 15, NEUTRAL_MODIFIERS,
    );
    expect(Math.abs(turning.at(-1)!.y)).toBeGreaterThan(Math.abs(straight.at(-1)!.y));
  });

  it("returns one pose per tick", () => {
    const poses = rollForward(
      bodyFromObservation(carAt(), 0), "mirage", { steer: 0, throttle: 0 }, 12, NEUTRAL_MODIFIERS,
    );
    expect(poses).toHaveLength(12);
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
  const HORIZONS = [10, 20, 45, 90] as const;
  const LONGEST = Math.max(...HORIZONS);
  const dt = 1 / TICK_RATE_HZ;

  /**
   * One tick: `angle += steer * rate / TICK_RATE_HZ`, then `x/y += cos/sin(angle) * speed / HZ`.
   * `rate` is the chassis's STOPPED turn rate below `DRIVE_CONFIG.stopEpsilon`, because that is the
   * branch `stepDrive`'s `isMoving` takes -- a stationary car still turns, it just does not travel.
   *
   * A NEGATIVE `speed` needs no special case and gets none: `stepDrive`'s translation is the same
   * `cos/sin(angle) * speed` line, so a reversing car walks backward along its heading while its
   * nose still rotates the way the wheel is turned, and `Math.abs` on the `isMoving` test above
   * matches the sim's own. That is what makes this a usable truth for the reversing scenes.
   */
  function truthPath(speed: number, steer: -1 | 0 | 1, carId: "mirage", ticks: number) {
    const rate = Math.abs(speed) > DRIVE_CONFIG.stopEpsilon
      ? turnRateOf(carId)
      : turnRateAtStopOf(carId);
    let x = 0;
    let y = 0;
    let angle = 0;
    const out: { x: number; y: number; angle: number }[] = [];
    for (let i = 0; i < ticks; i++) {
      angle += steer * rate * dt;
      x += Math.cos(angle) * speed * dt;
      y += Math.sin(angle) * speed * dt;
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

  // Mirage's resolved drive numbers, so the two extreme rows below are the chassis's REAL caps
  // rather than round numbers near them. `maxSpeed` is 449.5 and `reverseMaxSpeed` is 292.175 at
  // today's `DRIVE_CONFIG`; derived rather than typed so a speed retune moves the scene with it.
  const MIRAGE = driveOf("mirage");

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
    { speed: -MIRAGE.reverseMaxSpeed, steer: 0, label: "reversing at the cap, straight" },
    { speed: -MIRAGE.reverseMaxSpeed, steer: 1, label: "reversing at the cap, wheel over" },
    { speed: -150, steer: 0, label: "reversing, straight" },
    { speed: -150, steer: 1, label: "reversing, wheel over" },
    { speed: 0, steer: 0, label: "stunned, wheel straight" },
    { speed: 0, steer: 1, label: "stunned, wheel over" },
    { speed: 150, steer: 0, label: "crawling, straight" },
    { speed: 150, steer: 1, label: "crawling, full lock" },
    { speed: 250, steer: 0, label: "mid speed, straight" },
    { speed: 250, steer: 1, label: "mid speed, full lock" },
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

  it("holds a REVERSING car's speed, which zeroing the engine alone does not", () => {
    // Fix round 2, finding A -- the residual the previous round documented instead of fixing.
    // `accel: 0` alone does nothing for a car already rolling backward, because
    // `accelerateForward`'s `speed < -stopEpsilon` branch brakes at `brakeDecel`, not `accel`: a
    // Mirage at its 292.175 u/s reverse cap is zeroed in ~5.5 ticks and the rest of the horizon is
    // spent parked. `OBSERVATION_MODIFIERS` zeroes BOTH channels, so the observed reverse is held.
    //
    // Measured error against `truthPath`, in world units at 20 / 45 / 90 ticks:
    //   reverse cap, straight   -- `accel: 0` alone 173 / 416 / 854, this set 0 / 0 / 0
    //   reverse cap, wheel over -- `accel: 0` alone  45 /  30 /  38, this set 0 / 0 / 0
    //   -150, straight          -- `accel: 0` alone  95 / 220 / 445, this set 0 / 0 / 0
    //   -150, wheel over        -- `accel: 0` alone  19 /  10 /  14, this set 0 / 0 / 0
    // The straight rows are the damaging ones: 854 units short at the horizon the controller
    // actually rolls, against the 584 the stationary over-lead was worth at 45 ticks.
    const ENGINE_OFF_ONLY = Object.freeze({ ...NEUTRAL_MODIFIERS, accel: 0 });
    const reversing = SCENES.filter((scene) => scene.speed < 0);
    expect(reversing).toHaveLength(4);
    for (const scene of reversing) {
      const truth = truthPath(scene.speed, scene.steer, "mirage", LONGEST);
      const engineOffOnly = rollForward(
        bodyFromObservation(carAt({ speed: scene.speed }), 0), "mirage",
        { steer: scene.steer, throttle: 1 }, LONGEST, ENGINE_OFF_ONLY,
      );
      const held = shipped(scene.speed, scene.steer);
      for (const ticks of HORIZONS) {
        expect(errorAt(truth, held(ticks), ticks), `${scene.label} @${ticks}`).toBeLessThan(1);
        expect(errorAt(truth, engineOffOnly[ticks - 1]!, ticks), `${scene.label} @${ticks}`)
          .toBeGreaterThan(errorAt(truth, held(ticks), ticks));
      }
      // And it decays to a dead stop, which is the whole shape of the error -- not a small offset.
      expect(forwardOf(engineOffOnly.at(-1)!.vx, engineOffOnly.at(-1)!.vy,
        engineOffOnly.at(-1)!.angle), scene.label).toBe(0);
      expect(held(LONGEST), scene.label).not.toEqual(
        { x: engineOffOnly.at(-1)!.x, y: engineOffOnly.at(-1)!.y, angle: engineOffOnly.at(-1)!.angle },
      );
    }
    // Worst case, spelled out: the straight run at the reverse cap lands car lengths short over the
    // horizon the controller rolls (`BRAIN_CONSTANTS.predictionHorizonTicks`).
    const capStraight = SCENES.find((s) => s.speed < 0 && s.steer === 0)!;
    const stopped = rollForward(
      bodyFromObservation(carAt({ speed: capStraight.speed }), 0), "mirage",
      { steer: 0, throttle: 1 }, LONGEST, ENGINE_OFF_ONLY,
    );
    // RE-PINNED at the 2026-09-07 merge: 800 -> 400. Nothing about the SHAPE of this error changed
    // — an engine-off-only rollout still decays a reversing car to a dead stop while the truth keeps
    // reversing — but the heavy-car pass cut Mirage's reverse cap from 292.2 to 173.55 u/s, so the
    // gap that opens over the horizon scales with it: 493 units where it used to be 876.
    expect(errorAt(truthPath(capStraight.speed, 0, "mirage", LONGEST), stopped[LONGEST - 1]!, LONGEST))
      .toBeGreaterThan(400);
  });

  it("beats a straight line wherever the target turns, and never loses where it does not", () => {
    // `constantVelocityPredictor` is exactly right for a car going straight (it IS the same
    // integration) and diverges without bound once one turns: 114 / 230 units at 150 u/s, 190 / 384
    // at 250 u/s and 222 / 448 at the reverse cap, at 20 / 45 ticks. It also handles the stunned car
    // correctly, which the engine-on rollout does not -- the honest reading is that phase A's win is
    // the TURNING case plus never being worse elsewhere, not a win everywhere.
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
          expect(straightError, `${scene.label} @${ticks}`).toBeGreaterThan(10);
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
    const car = carAt({ speed: driveOf("mirage").maxSpeed });
    const dx = (sigma: number, draw: number) =>
      physicsPredictor(car, 0, 45, sigma, rngGiving(draw))(45).x
        - physicsPredictor(car, 0, 45, 0, rngGiving(draw))(45).x;
    const over = dx(0.25, 1);
    const under = dx(0.25, -1);
    expect(over).toBeGreaterThan(100); // it was 0.00
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
