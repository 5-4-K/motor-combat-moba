import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import { stepSim, type SimBody, type StepContext } from "./step.js";
import type { InputMessage } from "../net/input.js";

const DT = MS_PER_TICK / 1000;
const UP: InputMessage = { seq: 1, steer: 0, throttle: 1, fireSlots: 0 };

const EMPTY_ARENA: StepContext = {
  carId: "mirage",
  others: [],
  obstacles: [],
  bounds: { width: 800, height: 600 },
  modifiers: NEUTRAL_MODIFIERS,
};

function drive(body: SimBody, ctx: StepContext, ticks: number): SimBody {
  let next = body;
  for (let i = 0; i < ticks; i++) {
    next = stepSim(next, UP, DT, ctx);
  }
  return next;
}

describe("stepSim", () => {
  it("moves a car forward when Up is held from rest on an empty arena", () => {
    const body: SimBody = {
      x: 100,
      y: 300,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };

    const out = stepSim(body, UP, DT, EMPTY_ARENA);

    expect(out.x).toBeGreaterThan(body.x);
    expect(out.y).toBe(body.y);
    expect(out.speed).toBeGreaterThan(0);
    // Pure: the caller's body is untouched.
    expect(body).toEqual({
      x: 100,
      y: 300,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    });
  });

  it("stops the car at an obstacle it would otherwise have driven through", () => {
    const obstacle = { x: 400, y: 0, w: 60, h: 600 };
    const start: SimBody = {
      x: 100,
      y: 300,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };

    const unobstructed = drive(start, EMPTY_ARENA, 60);
    const blocked = drive(start, { ...EMPTY_ARENA, obstacles: [obstacle] }, 60);

    // Without the obstacle the car is well past it; with it, the hull never crosses the near face.
    expect(unobstructed.x).toBeGreaterThan(obstacle.x);
    expect(blocked.x).toBeGreaterThan(start.x);
    expect(blocked.x + DRIVE_CONFIG.carWidth / 2).toBeLessThanOrEqual(obstacle.x);
  });

  it("keeps a car driving at a wall inside the arena bounds", () => {
    const start: SimBody = {
      x: 700,
      y: 300,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };

    const out = drive(start, EMPTY_ARENA, 60);

    expect(out.x).toBeGreaterThan(start.x);
    expect(out.x + DRIVE_CONFIG.carWidth / 2).toBeLessThanOrEqual(EMPTY_ARENA.bounds.width);
  });
});
