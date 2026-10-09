import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import { avoidWalls, newNavState, steerToward, type Goal } from "./navigate.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const at = (x: number, y: number, angle = 0) => ({ x, y, angle });
const goal = (over: Partial<Goal>): Goal => ({ x: 0, y: 0, range: 0, facing: "nose", reverseOk: true, ...over });
const band = BRAIN_CONSTANTS.rangeBandUnits;

describe("steerToward: nose (BB24, BB25)", () => {
  it("drives at a far target and steers toward it", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 500, y: 200, range: 100 }), aimOffsetRad: 0, state: newNavState() });
    expect(out.throttle).toBe(1);
    expect(out.steer).toBe(1); // target at +atan2(200,500): steer +1 raises the heading toward it
  });
  it("lifts off inside the band and holds the wheel straight when aligned", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 300, y: 0, range: 300 }), aimOffsetRad: 0, state: newNavState() });
    expect(out).toEqual({ steer: 0, throttle: 0 });
  });
  it("reverses when too close and reversing is allowed, nose still on", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 100, y: 0, range: 300 }), aimOffsetRad: 0, state: newNavState() });
    expect(out).toEqual({ steer: 0, throttle: -1 });
  });
  it("holds still when too close and reversing is not allowed", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 100, y: 0, range: 300, reverseOk: false }), aimOffsetRad: 0, state: newNavState() });
    expect(out).toEqual({ steer: 0, throttle: 0 });
  });
  it("forwardOnly too close still drives forward, nose on", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 100, y: 0, range: 300, forwardOnly: true }), aimOffsetRad: 0, state: newNavState() });
    expect(out).toEqual({ steer: 0, throttle: 1 });
  });
  it("the realised aim offset wanders the nose", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 500, y: 0, range: 100 }), aimOffsetRad: 0.2, state: newNavState() });
    expect(out.steer).toBe(1);
  });
  it("forwardOnly never lifts off", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 10, y: 0, range: 0, forwardOnly: true }), aimOffsetRad: 0, state: newNavState() });
    expect(out.throttle).toBe(1);
  });
});

describe("steerToward: orbit (BB24, BB27)", () => {
  it("keeps the pedal down and turns away so the target drifts off the nose", () => {
    const state = newNavState();
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 300, y: 1, range: 300, facing: "orbit" }), aimOffsetRad: 0, state });
    expect(out.throttle).toBe(1);
    expect(state.orbitSide).toBe(1);
    expect(out.steer).toBe(-1); // desired offset +0.45, current ~0: error negative
  });
  it("backs out nose-on when too close and reversing is allowed", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 100, y: 1, range: 300, facing: "orbit" }), aimOffsetRad: 0, state: newNavState() });
    expect(out).toEqual({ steer: 0, throttle: -1 });
  });
  it("lifts off when too close and reversing is not allowed", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 100, y: 1, range: 300, facing: "orbit", reverseOk: false }), aimOffsetRad: 0, state: newNavState() });
    expect(out.throttle).toBe(0);
  });
  it("drives straight at a target that is far outside the band", () => {
    const state = newNavState();
    const out = steerToward({ self: at(0, 0), goal: goal({ x: 900, y: 0.5, range: 300, facing: "orbit" }), aimOffsetRad: 0, state });
    expect(out).toEqual({ steer: 0, throttle: 1 });
  });
  it("flips side only when the target has crossed well behind the other shoulder", () => {
    const state = newNavState();
    state.orbitSide = 1;
    steerToward({ self: at(0, 0), goal: goal({ x: 0, y: -300, range: 300, facing: "orbit" }), aimOffsetRad: 0, state });
    expect(state.orbitSide).toBe(1); // -π/2: not beyond π/2
    steerToward({ self: at(0, 0), goal: goal({ x: -300, y: -10, range: 300, facing: "orbit" }), aimOffsetRad: 0, state });
    expect(state.orbitSide).toBe(-1);
  });
});

describe("steerToward: free (BB25, BB26)", () => {
  it("arrives", () => {
    expect(steerToward({ self: at(0, 0), goal: goal({ x: band / 2, y: 0, facing: "free" }), aimOffsetRad: 0, state: newNavState() }))
      .toEqual({ steer: 0, throttle: 0 });
  });
  it("backs toward a point behind it, steering from the tail", () => {
    // Point behind and slightly to +y. The tail (at angle+π) must swing toward +y, which means the
    // heading must FALL: steer -1.
    const out = steerToward({ self: at(0, 0), goal: goal({ x: -200, y: 20, facing: "free" }), aimOffsetRad: 0, state: newNavState() });
    expect(out.throttle).toBe(-1);
    expect(out.steer).toBe(-1);
  });
  it("turns and drives forward when reversing is not allowed", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: -200, y: 20, facing: "free", reverseOk: false }), aimOffsetRad: 0, state: newNavState() });
    expect(out.throttle).toBe(1);
    expect(out.steer).toBe(1);
  });
  it("forwardOnly turns toward a point behind it and never takes the tail path", () => {
    const out = steerToward({ self: at(0, 0), goal: goal({ x: -200, y: 20, facing: "free", forwardOnly: true }), aimOffsetRad: 0, state: newNavState() });
    expect(out.throttle).toBe(1);
    expect(out.steer).toBe(1);
  });
});

describe("the latch (BB28)", () => {
  it("keeps steering inside the deadband once started and stops inside half of it", () => {
    const state = newNavState();
    const dead = BRAIN_CONSTANTS.steerDeadbandRad;
    const aimed = (err: number) => steerToward({ self: at(0, 0, 0), goal: goal({ x: Math.cos(err) * 1000, y: Math.sin(err) * 1000, range: 100 }), aimOffsetRad: 0, state }).steer;
    expect(aimed(dead * 2)).toBe(1);
    expect(aimed(dead * 0.8)).toBe(1);
    expect(aimed(dead * 0.4)).toBe(0);
    expect(aimed(dead * 0.8)).toBe(0);
  });
  it("does not hold the wheel across a sign change inside the hold window", () => {
    const state = newNavState();
    const aimed = (err: number) => steerToward({ self: at(0, 0, 0), goal: goal({ x: Math.cos(err) * 1000, y: Math.sin(err) * 1000, range: 100 }), aimOffsetRad: 0, state }).steer;
    expect(aimed(0.12)).toBe(1);
    expect(aimed(-0.045)).toBe(0);
    expect(aimed(-0.12)).toBe(-1);
  });
});

describe("avoidWalls (BB32)", () => {
  const forward = { steer: 0 as const, throttle: 1 as const };
  it("does nothing without a push or when not driving forward", () => {
    expect(avoidWalls(at(0, 0), forward, undefined, newNavState())).toEqual(forward);
    expect(avoidWalls(at(0, 0), { steer: 0, throttle: -1 }, { x: -1, y: 0 }, newNavState())).toEqual({ steer: 0, throttle: -1 });
  });
  it("steers toward the push's side", () => {
    expect(avoidWalls(at(0, 0, 0), forward, { x: 0, y: 1 }, newNavState()).steer).toBe(1);
    expect(avoidWalls(at(0, 0, 0), forward, { x: 0, y: -1 }, newNavState()).steer).toBe(-1);
  });
  it("backs up when the wall is dead ahead", () => {
    expect(avoidWalls(at(0, 0, 0), forward, { x: -1, y: 0.1 }, newNavState()).throttle).toBe(-1);
  });
  it("ignores a wall behind", () => {
    expect(avoidWalls(at(0, 0, 0), forward, { x: 1, y: 0 }, newNavState())).toEqual(forward);
  });
  it("flips the orbit side when pushed from the inside", () => {
    const state = newNavState();
    state.orbitSide = 1;
    avoidWalls(at(0, 0, 0), forward, { x: 0, y: -1 }, state);
    expect(state.orbitSide).toBe(-1);
  });
});
