import { describe, expect, it } from "vitest";
import { DEFAULT_PATCH_RATE_HZ, WEAPON_CONFIG, hpOf } from "@motor-arena/shared";
import { extrapolateShot, hpBarColor, hpFraction } from "./combat-visual.js";

describe("hpFraction", () => {
  it("is 1 at full hp", () => {
    expect(hpFraction(hpOf("rectangle"), "rectangle")).toBe(1);
  });

  it("is 0 for a wreck", () => {
    expect(hpFraction(0, "rectangle")).toBe(0);
  });

  it("measures each chassis against its own maximum", () => {
    expect(hpFraction(hpOf("hexagon") / 2, "hexagon")).toBe(0.5);
    expect(hpFraction(hpOf("oval") / 2, "oval")).toBe(0.5);
  });

  it("clamps rather than overflowing the bar", () => {
    expect(hpFraction(hpOf("rectangle") * 2, "rectangle")).toBe(1);
    expect(hpFraction(-5, "rectangle")).toBe(0);
  });

  it("falls back to the default chassis for an unrecognised carId", () => {
    expect(hpFraction(hpOf("rectangle"), "not-a-car")).toBe(1);
    expect(Number.isNaN(hpFraction(10, ""))).toBe(false);
  });
});

describe("hpBarColor", () => {
  it("is green while healthy", () => {
    expect(hpBarColor(1)).toBe(hpBarColor(0.5));
  });

  it("changes colour as hp drops", () => {
    const healthy = hpBarColor(1);
    const hurt = hpBarColor(0.3);
    const critical = hpBarColor(0.1);
    expect(hurt).not.toBe(healthy);
    expect(critical).not.toBe(hurt);
  });

  it("is the critical colour at zero", () => {
    expect(hpBarColor(0)).toBe(hpBarColor(0.1));
  });
});

describe("extrapolateShot", () => {
  const SPEED = WEAPON_CONFIG.projectileSpeed;

  it("does not move a shot reported this instant", () => {
    expect(extrapolateShot(100, 100, 0, SPEED, 0)).toEqual({ x: 100, y: 100 });
  });

  it("advances along the shot's own heading", () => {
    const moved = extrapolateShot(100, 100, 0, SPEED, 10);
    expect(moved.x).toBeCloseTo(100 + SPEED * 0.01, 6);
    expect(moved.y).toBeCloseTo(100, 6);
  });

  it("follows the angle", () => {
    const moved = extrapolateShot(100, 100, Math.PI / 2, SPEED, 10);
    expect(moved.x).toBeCloseTo(100, 6);
    expect(moved.y).toBeCloseTo(100 + SPEED * 0.01, 6);
  });

  it("caps at one patch interval, so a stall cannot fling a stale shot away", () => {
    const patchMs = 1000 / DEFAULT_PATCH_RATE_HZ;
    const capped = extrapolateShot(100, 100, 0, SPEED, 5000);
    expect(capped).toEqual(extrapolateShot(100, 100, 0, SPEED, patchMs));
  });

  it("never runs a shot backwards on a negative elapsed time", () => {
    expect(extrapolateShot(100, 100, 0, SPEED, -50)).toEqual({ x: 100, y: 100 });
  });
});
