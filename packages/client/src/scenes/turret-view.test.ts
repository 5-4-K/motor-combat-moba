import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { CROSSHAIR_CONFIG } from "../config/crosshair.js";
import { TURRET_VISUAL } from "../config/turret-visual.js";
import {
  TURRET_VIEW_BOUNDS,
  carScaleKey,
  liveTurretViewResolver,
  resolveTurretView,
  sanitizeTurretView,
  setTurretViewOverrides,
  shippedTurretView,
  turretLengthOf,
  turretViewOverrides,
} from "./turret-view.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

afterEach(() => setTurretViewOverrides(null));

describe("turret view resolver (TR60)", () => {
  it("resolves an empty map to the shipped client config", () => {
    const view = resolveTurretView({});
    expect(view.crosshairMaxDistance).toBe(CROSSHAIR_CONFIG.maxDistance);
    expect(view.lengthUnits).toBe(TURRET_VISUAL.lengthUnits);
    expect(turretLengthOf(view, "mirage")).toBe(TURRET_VISUAL.lengthUnits);
  });

  it("merges each override over its shipped value, and a per-car multiplier over the global length", () => {
    const view = resolveTurretView({
      crosshairMaxDistance: 120,
      lengthUnits: 40,
      [carScaleKey("bastion")]: 1.5,
    });
    expect(view.crosshairMaxDistance).toBe(120);
    expect(view.lengthUnits).toBe(40);
    expect(turretLengthOf(view, "bastion")).toBe(60);
    // Another car keeps multiplier 1: the per-car scale is per car, not global.
    expect(turretLengthOf(view, "mirage")).toBe(40);
  });

  it("ignores a value outside its bounds rather than drawing it", () => {
    const view = resolveTurretView({
      crosshairMaxDistance: TURRET_VIEW_BOUNDS.crosshairMaxDistance.max + 1,
      lengthUnits: 0,
      [carScaleKey("mirage")]: Number.NaN,
    });
    expect(view.crosshairMaxDistance).toBe(CROSSHAIR_CONFIG.maxDistance);
    expect(view.lengthUnits).toBe(TURRET_VISUAL.lengthUnits);
    expect(turretLengthOf(view, "mirage")).toBe(TURRET_VISUAL.lengthUnits);
  });

  it("sanitizes a stored blob entry by entry: unknown keys, unknown cars and bad numbers cost only themselves", () => {
    expect(
      sanitizeTurretView({
        crosshairMaxDistance: 90,
        lengthUnits: "big",
        [carScaleKey("bastion")]: 2,
        [carScaleKey("not-a-car")]: 2,
        [carScaleKey("mirage")]: TURRET_VIEW_BOUNDS.carScale.max * 2,
        somethingElse: 3,
      }),
    ).toEqual({ crosshairMaxDistance: 90, [carScaleKey("bastion")]: 2 });
    expect(sanitizeTurretView(null)).toEqual({});
    expect(sanitizeTurretView([1, 2])).toEqual({});
  });

  it("puts every shipped value inside its own bounds, so an untouched panel is legal", () => {
    const { crosshairMaxDistance: c, lengthUnits: l, carScale: s } = TURRET_VIEW_BOUNDS;
    expect(CROSSHAIR_CONFIG.maxDistance).toBeGreaterThanOrEqual(c.min);
    expect(CROSSHAIR_CONFIG.maxDistance).toBeLessThanOrEqual(c.max);
    expect(TURRET_VISUAL.lengthUnits).toBeGreaterThanOrEqual(l.min);
    expect(TURRET_VISUAL.lengthUnits).toBeLessThanOrEqual(l.max);
    expect(1).toBeGreaterThanOrEqual(s.min);
    expect(1).toBeLessThanOrEqual(s.max);
  });

  it("the live resolver reads the store at call time; the shipped one never reads it (a practice room)", () => {
    const live = liveTurretViewResolver();
    const map = { crosshairMaxDistance: 200 };
    setTurretViewOverrides(map);
    expect(turretViewOverrides()).toBe(map);
    expect(live().crosshairMaxDistance).toBe(200);
    // Mutated in place, as the panel does: the next call sees it with no re-install.
    map.crosshairMaxDistance = 150;
    expect(live().crosshairMaxDistance).toBe(150);
    expect(shippedTurretView().crosshairMaxDistance).toBe(CROSSHAIR_CONFIG.maxDistance);
    setTurretViewOverrides(null);
    expect(live().crosshairMaxDistance).toBe(CROSSHAIR_CONFIG.maxDistance);
  });
});
