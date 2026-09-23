import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE,
  TURRET_CONFIG,
  applyOverrides,
  installMode,
  modeConfigOf,
} from "@motor-combat-moba/shared";
import { TURRET_VISUAL } from "../config/turret-visual.js";
import { easeTurretAngle, turretDisplayLength } from "./turret-visual.js";

const rate = (TURRET_CONFIG.turnRateDegPerSec * Math.PI) / 180;

// `easeTurretAngle` reads `turret()` at call time, which throws outside a mode scope, so every test
// here needs a bundle installed — and a retuned one must not leak into the next test. This used to
// ride on `afterEach(() => setTuning(null))` plus the incidental fact that the retune test ran
// before the tests that depend on the shipped rate; installing the pristine bundle up front makes
// that order irrelevant.
beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

describe("turret visual (TR42)", () => {
  it("sizes the turret from the manifest scale", () => {
    expect(turretDisplayLength("fit")).toBe(36);
    expect(turretDisplayLength(1.5)).toBe(54);
  });
  it("sizes against a caller-given length, which is how the playground's turret knobs reach it (TR60)", () => {
    expect(turretDisplayLength("fit", 40)).toBe(40);
    expect(turretDisplayLength(1.5, 40)).toBe(60);
  });
  it("eases at the turn rate live at CALL time, so a playground retune reaches the drawn turret (TR59)", () => {
    installMode(applyOverrides(modeConfigOf(DEFAULT_GAME_MODE), { "turret.turnRateDegPerSec": 360 }));
    expect(easeTurretAngle(0, 1, 0.01)).toBeCloseTo(((360 * Math.PI) / 180) * 0.01, 9);
  });
  it("eases toward the networked angle at the turret's own rate", () => {
    expect(easeTurretAngle(0, 1, 0.01)).toBeCloseTo(rate * 0.01, 9);
    expect(easeTurretAngle(0, 0.001, 0.1)).toBe(0.001);
  });
  it("takes the short way, and snaps across a respawn-sized jump", () => {
    expect(easeTurretAngle(3.1, -3.1, 0.001)).toBeGreaterThan(3.1 - 1e-9);
    expect(easeTurretAngle(0, 3, 0.001)).toBe(3);
  });
  it("snaps at TURRET_VISUAL.snapAboveRad, not a bare literal (final-fixes item 6)", () => {
    const justUnder = TURRET_VISUAL.snapAboveRad - 0.01;
    const justOver = TURRET_VISUAL.snapAboveRad + 0.01;
    // Under the threshold: eased one step, not snapped straight to target.
    expect(easeTurretAngle(0, justUnder, 0.001)).not.toBe(justUnder);
    // At or over it: a respawn-sized jump, snap straight to target.
    expect(easeTurretAngle(0, justOver, 0.001)).toBe(justOver);
  });
});
