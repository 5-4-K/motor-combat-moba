import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ, turnRateOf } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView } from "../types.js";
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

describe("predicting a car at full lock, against ground truth", () => {
  // The measurement behind the controller's choice of held input (task 4, ruling 2). GROUND TRUTH is
  // the same drive model the sim runs: a Mirage at 400 u/s holding full right lock and the throttle
  // down. Three candidate models are scored against it in world units at 10 / 20 / 30 / 45 ticks:
  //
  //   | model                                             | error at 10/20/30/45 |
  //   |---------------------------------------------------|----------------------|
  //   | `constantVelocityPredictor` (what phase A replaces)| 178 / 342 / 416 / 690|
  //   | `{steer: 0, throttle: 0}`, observed turn as angVel | 48 / 99 / 10 / 91    |
  //   | reconstructed steer, `throttle: 1`, `angVel: 0`    | 0 / 0 / 0 / 0        |
  //
  // The middle row is what the task brief originally specified and is why it was overruled: rolling
  // a target with the throttle CLOSED is not "coasting straight", it is braking. `DRIVE_CONFIG.drag`
  // is 900 u/s^2 (0.32 s to rest), so that model has the car stopped inside 20 ticks having covered
  // ~82 units, against ~400 for even the straight line it was meant to improve on.
  const HORIZONS = [10, 20, 30, 45] as const;
  const car = carAt({ speed: 400 });
  const observed = turnRateOf("mirage");
  const truth = rollForward(
    bodyFromObservation(car, 0), "mirage", { steer: 1, throttle: 1 }, Math.max(...HORIZONS),
  );
  const errorAt = (
    predictor: ReturnType<typeof physicsPredictor>,
    ticksAhead: number,
  ): number => {
    const actual = truth[ticksAhead - 1]!;
    const guess = predictor(ticksAhead);
    return Math.hypot(guess.x - actual.x, guess.y - actual.y);
  };

  it("reproduces the true path almost exactly once the steer is reconstructed", () => {
    const reconstructed = physicsPredictor(
      car, 0, { steer: steerFromObservedTurn(observed, "mirage"), throttle: 1 }, 45, 0, makeRng(11),
    );
    for (const ticks of HORIZONS) expect(errorAt(reconstructed, ticks)).toBeLessThan(1);
  });

  it("beats both the straight line and a throttle-closed rollout at every horizon", () => {
    const reconstructed = physicsPredictor(
      car, 0, { steer: steerFromObservedTurn(observed, "mirage"), throttle: 1 }, 45, 0, makeRng(11),
    );
    const coasting = physicsPredictor(car, observed, { steer: 0, throttle: 0 }, 45, 0, makeRng(11));
    const straight = constantVelocityPredictor(car);
    for (const ticks of HORIZONS) {
      const actual = truth[ticks - 1]!;
      const straightGuess = straight(ticks);
      const straightError = Math.hypot(straightGuess.x - actual.x, straightGuess.y - actual.y);
      expect(errorAt(reconstructed, ticks)).toBeLessThan(errorAt(coasting, ticks));
      expect(errorAt(reconstructed, ticks)).toBeLessThan(straightError);
    }
  });

  it("brings a throttle-closed rollout to a dead stop, which is why it is not the held input", () => {
    const braking = rollForward(bodyFromObservation(car, 0), "mirage", { steer: 0, throttle: 0 }, 20);
    expect(braking.at(-1)!.speed).toBe(0);
    expect(Math.hypot(braking.at(-1)!.x - car.x, braking.at(-1)!.y - car.y)).toBeLessThan(100);
    // The same 20 ticks with the throttle DOWN cover several times as far. Measured against a
    // straight run rather than the full-lock `truth` above, whose 55 u turn radius brings it back
    // past its own start inside this window and makes displacement meaningless.
    const driving = rollForward(bodyFromObservation(car, 0), "mirage", { steer: 0, throttle: 1 }, 20);
    expect(Math.hypot(driving.at(-1)!.x - car.x, driving.at(-1)!.y - car.y)).toBeGreaterThan(250);
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
