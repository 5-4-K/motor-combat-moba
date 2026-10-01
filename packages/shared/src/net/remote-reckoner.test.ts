import { beforeEach, describe, expect, it } from "vitest";
import { installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { MS_PER_TICK } from "../constants.js";
import { ramDefenceOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { ManeuverKind } from "../sim/maneuver.js";
import { NEUTRAL_MODIFIERS } from "../sim/status/modifiers.js";
import { stepSim, type SimBody, type StepContext } from "../sim/step.js";
import type { InputKeys } from "./tick-input.js";
import { RemoteReckoner } from "./remote-reckoner.js";

installMode(modeConfigOf(DEFAULT_GAME_MODE));
beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const DT = MS_PER_TICK / 1000;
const keys: InputKeys = { steer: 1, throttle: 1, fireSlots: 0 };
const GO: InputKeys = { steer: 0, throttle: 1, fireSlots: 0 };
const OPEN: StepContext = {
  carId: "mirage",
  others: [],
  obstacles: [],
  bounds: { width: 800, height: 600 },
  modifiers: NEUTRAL_MODIFIERS,
  selfRamDefence: ramDefenceOf("mirage"),
};
const body: SimBody = {
  x: 100, y: 300, angle: 0, vx: 0, vy: 0, angVel: 0,
  maneuver: ManeuverKind.NONE, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
};

function fresh(ctx = OPEN, k = keys): RemoteReckoner {
  const r = new RemoteReckoner(6);
  r.update("a", { tick: 10, body, keys: k, ctx });
  return r;
}

describe("RemoteReckoner", () => {
  it("steps the newest snapshot with the last keys, one tick at a time", () => {
    const expected = stepSim(stepSim(body, keys, DT, OPEN), keys, DT, OPEN);
    expect(fresh().poseAt("a", 12)).toEqual(expected);
  });

  it("interpolates between whole ticks", () => {
    const r = fresh();
    const a = r.poseAt("a", 10)!;
    const b = r.poseAt("a", 11)!;
    const mid = r.poseAt("a", 10.5)!;
    expect(mid.x).toBeGreaterThan(a.x);
    expect(mid.x).toBeLessThan(b.x);
  });

  it("never goes past maxTicks", () => {
    const r = fresh();
    expect(r.poseAt("a", 100)).toEqual(r.poseAt("a", 16));
  });

  it("reports how far past the snapshot a tick is", () => {
    const r = fresh();
    expect(r.overshoot("a", 9)).toBe(0);
    expect(r.overshoot("a", 13.5)).toBe(3.5);
    expect(r.overshoot("nobody", 13)).toBe(0);
  });

  it("stops at a wall because it is the same stepSim", () => {
    const wall = { x: 100 + DRIVE_CONFIG.carWidth / 2 + 30, y: 0, w: 60, h: 600 };
    const ctx = { ...OPEN, obstacles: [wall] };
    const r = fresh(ctx, GO);
    for (let t = 10; t <= 16; t += 0.5) {
      expect(r.poseAt("a", t)!.x + DRIVE_CONFIG.carWidth / 2).toBeLessThanOrEqual(wall.x + 1e-6);
    }
  });

  it("drops the cache when a newer snapshot arrives, keeps it for the same tick", () => {
    const r = fresh();
    r.poseAt("a", 14);
    r.update("a", { tick: 10, body: { ...body, x: 500 }, keys, ctx: OPEN });
    expect(r.poseAt("a", 10)!.x).toBe(body.x);
    r.update("a", { tick: 11, body: { ...body, x: 500 }, keys, ctx: OPEN });
    expect(r.poseAt("a", 11)!.x).toBe(500);
  });

  it("forgets a car", () => {
    const r = fresh();
    r.forget("a");
    expect(r.poseAt("a", 11)).toBeUndefined();
  });
});
