import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView } from "../types.js";
import {
  bodyFromObservation, bodyFromSelf, interceptTicks, physicsPredictor, rollForward,
  selfPredictor,
} from "./predict.js";

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
