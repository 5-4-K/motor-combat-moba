import { describe, expect, it } from "vitest";
import {
  DRIVE_CONFIG, NEUTRAL_MODIFIERS, TICK_RATE_HZ, driveOf, turnRateAtStopOf, turnRateOf,
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

function carAt(over: Partial<BotCarView> = {}): BotCarView {
  return {
    sessionId: "them", carId: "mirage", team: 1, x: 0, y: 0, angle: 0, speed: 300,
    hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0, ...over,
  };
}

function selfAt(over: Partial<BotSelfView> = {}): BotSelfView {
  return {
    sessionId: "me", carId: "mirage", team: 0, x: 0, y: 0, angle: 0, speed: 300,
    hp: 70, maxHp: 70, alive: true, statuses: [], slots: [], switchLockUntilTick: 0,
    lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0, ...over,
  };
}

describe("rollForward", () => {
  it("carries a straight-line car forward, brought to rest by drag", () => {
    const body = bodyFromObservation(carAt(), 0);
    const poses = rollForward(body, "mirage", { steer: 0, throttle: 0 }, TICK_RATE_HZ);
    // DRIVE_CONFIG.drag (900 u/s^2) is steep enough that a coasting 300 u/s car is fully stopped
    // well inside one second (~10 ticks), so a full second of rollout lands on a small, fixed
    // distance rather than "most of 300 units" -- it still moves forward, and stays there once
    // stopped, which is what this checks.
    expect(poses.at(-1)!.x).toBeGreaterThan(40);
    expect(poses.at(-1)!.x).toBeLessThan(50);
    expect(Math.abs(poses.at(-1)!.y)).toBeLessThan(1);
  });

  it("curves a car that was observed turning, without any input", () => {
    const straight = rollForward(
      bodyFromObservation(carAt(), 0), "mirage", { steer: 0, throttle: 0 }, 15,
    );
    const turning = rollForward(
      bodyFromObservation(carAt(), 3), "mirage", { steer: 0, throttle: 0 }, 15,
    );
    expect(Math.abs(turning.at(-1)!.y)).toBeGreaterThan(Math.abs(straight.at(-1)!.y));
  });

  it("returns one pose per tick", () => {
    const poses = rollForward(bodyFromObservation(carAt(), 0), "mirage", { steer: 0, throttle: 0 }, 12);
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
      bodyFromObservation(car, observed), "mirage", { steer: 0, throttle: 1 }, 45,
    );
    const asSteer = rollForward(
      bodyFromObservation(car, 0), "mirage",
      { steer: steerFromObservedTurn(observed, "mirage"), throttle: 1 }, 45,
    );
    expect(turned(asSteer)).toBeGreaterThan(turned(asSpin) * 2);
  });
});

describe("physicsPredictor", () => {
  it("beats a straight line for a turning car", () => {
    const turning = carAt({ speed: 400 });
    const predictor = physicsPredictor(turning, 4, { steer: 0, throttle: 1 }, 20, 0, makeRng(1));
    const predicted = predictor(20);
    const straight = {
      x: turning.x + Math.cos(turning.angle) * turning.speed * (20 / TICK_RATE_HZ),
      y: turning.y + Math.sin(turning.angle) * turning.speed * (20 / TICK_RATE_HZ),
    };
    // A car turning at 4 rad/s is nowhere near the straight-line point 20 ticks out.
    expect(Math.hypot(predicted.x - straight.x, predicted.y - straight.y)).toBeGreaterThan(50);
  });

  it("clamps past its horizon rather than extrapolating off the end", () => {
    const predictor = physicsPredictor(carAt(), 0, { steer: 0, throttle: 0 }, 10, 0, makeRng(2));
    expect(predictor(50)).toEqual(predictor(10));
  });

  it("resolves a sub-one-tick ask to the FIRST rolled pose, not a negative index", () => {
    // Math.round(0.3) is 0, so a naive `poses[Math.round(ticksAhead) - 1]` reads poses[-1]
    // (undefined) and throws on `.x`. Any ticksAhead in (0, 1) must clamp UP to one tick ahead,
    // the same way past-the-horizon clamps DOWN to the last pose.
    const predictor = physicsPredictor(carAt(), 0, { steer: 0, throttle: 1 }, 10, 0, makeRng(3));
    expect(predictor(0.3)).toEqual(predictor(1));
  });
});

describe("selfPredictor", () => {
  it("clamps past its horizon, same as physicsPredictor", () => {
    const predictor = selfPredictor(selfAt(), { steer: 0, throttle: 0 }, 10);
    expect(predictor(50)).toEqual(predictor(10));
  });

  it("curves a self observed mid-turn, same as physicsPredictor does for others", () => {
    // bodyFromSelf reads angVel off nothing (self has no angVel field) -- but a self mid-dash still
    // has maneuver state to roll forward under input, so drive steer/throttle to get a curve instead.
    const straight = rollForward(bodyFromSelf(selfAt()), "mirage", { steer: 0, throttle: 0 }, 15);
    const turning = rollForward(bodyFromSelf(selfAt()), "mirage", { steer: 1, throttle: 1 }, 15);
    expect(Math.abs(turning.at(-1)!.y)).toBeGreaterThan(Math.abs(straight.at(-1)!.y));

    const straightPredictor = selfPredictor(selfAt(), { steer: 0, throttle: 0 }, 15);
    const turningPredictor = selfPredictor(selfAt(), { steer: 1, throttle: 1 }, 15);
    expect(Math.abs(turningPredictor(15).y)).toBeGreaterThan(Math.abs(straightPredictor(15).y));
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
  // they are not a corner case: `movement.ts` makes `throttle: -1` routine `fight` behaviour inside
  // the bot's preferred range and `humanize.ts` has a panic-reverse, so both the target predictor
  // and `selfPredictor` meet a car rolling backward constantly. `accelerateForward`'s
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

  const shipped = (speed: number, steer: -1 | 0 | 1) => physicsPredictor(
    carAt({ speed }), 0, { steer, throttle: 1 }, LONGEST, 0, makeRng(11),
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
        { steer: scene.steer, throttle: 1 }, LONGEST,
      );
      const held = shipped(scene.speed, scene.steer);
      for (const ticks of HORIZONS) {
        expect(errorAt(truth, held(ticks), ticks), `${scene.label} @${ticks}`)
          .toBeLessThanOrEqual(errorAt(truth, engineOn[ticks - 1]!, ticks));
      }
      // And where it is wrong, it is wrong by car lengths, not by rounding.
      if (scene.speed < 300) {
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
      expect(engineOffOnly.at(-1)!.speed, scene.label).toBe(0);
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
    expect(errorAt(truthPath(capStraight.speed, 0, "mirage", LONGEST), stopped[LONGEST - 1]!, LONGEST))
      .toBeGreaterThan(800);
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

  it("brings a throttle-closed rollout to a dead stop, which is why it is not the held input", () => {
    // The OTHER way to get this wrong, and the one the task brief originally specified. Rolling a
    // target with the throttle CLOSED is not "coasting straight", it is braking: `DRIVE_CONFIG.drag`
    // is 900 u/s^2, 0.32 s to rest.
    const car = carAt({ speed: 400 });
    const braking = rollForward(bodyFromObservation(car, 0), "mirage", { steer: 0, throttle: 0 }, 20);
    expect(braking.at(-1)!.speed).toBe(0);
    expect(Math.hypot(braking.at(-1)!.x - car.x, braking.at(-1)!.y - car.y)).toBeLessThan(100);
    // 20 ticks of a held 400 u/s is 266 units; the braking rollout covers 82. Measured error 184.
    expect(errorAt(truthPath(400, 0, "mirage", 20), braking[19]!, 20)).toBeGreaterThan(150);
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
      { steer, throttle: 1 }, 4,
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
    const predictor = physicsPredictor(carAt(), 0, { steer: 0, throttle: 0 }, 30, 0, makeRng(4));
    expect(interceptTicks({ x: 0, y: 0 }, predictor, 600, 30)).toBe(0);
  });

  it("returns ~TICK_RATE_HZ ticks for a 600u target at 600 u/s against a stationary predictor", () => {
    const stationary = () => ({ x: 600, y: 0, angle: 0 });
    const ticks = interceptTicks({ x: 0, y: 0 }, stationary, 600, TICK_RATE_HZ * 2);
    expect(ticks).toBeCloseTo(TICK_RATE_HZ, 0);
  });

  it("returns 0 for a non-positive projectile speed", () => {
    const predictor = physicsPredictor(carAt(), 0, { steer: 0, throttle: 0 }, 30, 0, makeRng(5));
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
  it("perturbs the prediction, and a tighter sigma perturbs it less", () => {
    const car = carAt({ speed: 400 });
    const at = (sigma: number) => physicsPredictor(
      car, 0, { steer: 0, throttle: 1 }, 20, sigma, makeRng(9),
    )(20);
    const truth = physicsPredictor(car, 0, { steer: 0, throttle: 1 }, 20, 0, makeRng(9))(20);
    const sloppy = at(0.25);
    const sharp = at(0.03);
    const err = (p: { x: number; y: number }) => Math.hypot(p.x - truth.x, p.y - truth.y);
    expect(err(sloppy)).toBeGreaterThan(err(sharp));
  });

  it("draws the same number of rng calls whether sigma is zero or not (H21)", () => {
    let calls = 0;
    const counting = () => { calls += 1; return 0.5; };
    physicsPredictor(carAt(), 0, { steer: 0, throttle: 0 }, 5, 0, counting);
    const withZero = calls;
    calls = 0;
    physicsPredictor(carAt(), 0, { steer: 0, throttle: 0 }, 5, 0.2, counting);
    expect(calls).toBe(withZero);
  });
});
