import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { CAR_TABLE, RAM_REFERENCE, RAM_REFERENCE_MASS, forwardMaxSpeedOf, massOf } from "./car-config.js";
import { RAM_CONFIG, RAM_DECAY, halfLifeToPerTick } from "./ram-config.js";
import type { CarId } from "./types.js";

describe("halfLifeToPerTick", () => {
  it("halves the value after exactly one half-life of ticks", () => {
    const perTick = halfLifeToPerTick(0.5);
    const ticks = 0.5 * TICK_RATE_HZ;
    expect(perTick ** ticks).toBeCloseTo(0.5, 12);
  });

  it("is tick-rate independent: the same wall-clock half-life survives a rate change", () => {
    // Authored in seconds precisely so a future move to 60 Hz does not halve every recovery time.
    expect(halfLifeToPerTick(0.25) ** (0.25 * TICK_RATE_HZ)).toBeCloseTo(0.5, 12);
  });

  it("returns 0 for a non-positive or non-finite half-life rather than NaN", () => {
    expect(halfLifeToPerTick(0)).toBe(0);
    expect(halfLifeToPerTick(-1)).toBe(0);
    expect(halfLifeToPerTick(Number.NaN)).toBe(0);
  });

  it("never returns a multiplier at or above 1, which would make a knock permanent", () => {
    for (const hl of [0.05, 0.15, 0.25, 0.35, 2]) {
      expect(halfLifeToPerTick(hl)).toBeGreaterThan(0);
      expect(halfLifeToPerTick(hl)).toBeLessThan(1);
    }
  });
});

describe("RAM_CONFIG", () => {
  it("pins the authored knobs", () => {
    expect(RAM_CONFIG.contactPad).toBe(1);
    expect(RAM_CONFIG.minApproachSpeed).toBe(60);
    expect(RAM_CONFIG.bonusFront).toBe(0.3);
    expect(RAM_CONFIG.bonusFlank).toBe(1.0);
    expect(RAM_CONFIG.bonusRear).toBe(1.3);
    expect(RAM_CONFIG.authorityFloor).toBe(0.35);
    expect(RAM_CONFIG.knockMaxSpeed).toBe(260);
    expect(RAM_CONFIG.massPerRating).toBe(10);
  });

  it("orders the side bonuses front < flank < rear, which is the whole positional read", () => {
    expect(RAM_CONFIG.bonusFront).toBeLessThan(RAM_CONFIG.bonusFlank);
    expect(RAM_CONFIG.bonusFlank).toBeLessThan(RAM_CONFIG.bonusRear);
  });

  it("keeps the authority floor a real floor", () => {
    expect(RAM_CONFIG.authorityFloor).toBeGreaterThan(0);
    expect(RAM_CONFIG.authorityFloor).toBeLessThan(1);
  });

  it("clamps victim mass factor around 1", () => {
    expect(RAM_CONFIG.massFactorMin).toBeLessThan(1);
    expect(RAM_CONFIG.massFactorMax).toBeGreaterThan(1);
  });

  it("derives inertiaCoefficient from the hull, never typed", () => {
    expect(RAM_CONFIG.inertiaCoefficient).toBeCloseTo((48 ** 2 + 32 ** 2) / 12, 9);
  });

  it("bleeds spin faster when countersteering than when coasting", () => {
    expect(RAM_DECAY.counterSteer).toBeLessThan(RAM_DECAY.spin);
  });
});

describe("mass rating", () => {
  it("gives every chassis an integer 0-100 mass", () => {
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const { mass } = CAR_TABLE[id];
      expect(Number.isInteger(mass)).toBe(true);
      expect(mass).toBeGreaterThanOrEqual(0);
      expect(mass).toBeLessThanOrEqual(100);
    }
  });

  it("scales ratings to real mass via massPerRating", () => {
    expect(massOf("rectangle")).toBe(350);
    expect(massOf("oval")).toBe(450);
    expect(massOf("hexagon")).toBe(850);
  });

  it("makes the tank the heaviest and the speedster the lightest", () => {
    expect(massOf("hexagon")).toBeGreaterThan(massOf("oval"));
    expect(massOf("oval")).toBeGreaterThan(massOf("rectangle"));
  });

  it("derives the ram reference from an average chassis at the roster's top speed", () => {
    expect(RAM_REFERENCE_MASS).toBe(500);
    expect(RAM_REFERENCE).toBe(RAM_REFERENCE_MASS * forwardMaxSpeedOf("rectangle"));
    expect(RAM_REFERENCE).toBe(270000);
  });
});
