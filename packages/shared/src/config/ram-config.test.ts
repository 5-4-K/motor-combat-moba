import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { CAR_TABLE, forwardMaxSpeedOf, ramAttackOf, ramDefenceOf } from "./car-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { msToTicks } from "./weapon-ticks.js";
import {
  RAM_CONFIG,
  halfLifeToPerTick,
  inertiaRadiusSquared,
  ramTicks,
  reelingSpinPerTick,
} from "./ram-config.js";
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

describe("RAM_CONFIG under the Unity ram rule", () => {
  it("authors Unity's shove scales, with a flank the hardest hit", () => {
    expect(RAM_CONFIG.headOnScale).toBe(0.2);
    expect(RAM_CONFIG.flankScale).toBe(1.5);
    expect(RAM_CONFIG.rearScale).toBe(1.2);
    expect(RAM_CONFIG.flankScale).toBeGreaterThan(RAM_CONFIG.rearScale);
    expect(RAM_CONFIG.rearScale).toBeGreaterThan(RAM_CONFIG.headOnScale);
  });

  it("gates a ram on a real approach speed", () => {
    expect(RAM_CONFIG.minRamSpeed).toBeGreaterThan(0);
    // A ram is a deliberate act: well over a drift, well under a chassis top speed.
    expect(RAM_CONFIG.minRamSpeed).toBeLessThan(forwardMaxSpeedOf("bastion") / 2);
  });

  it("derives the spin inertia from the hull, so it cannot drift from it", () => {
    const expected = (DRIVE_CONFIG.carWidth ** 2 + DRIVE_CONFIG.carHeight ** 2) / 12;
    expect(inertiaRadiusSquared()).toBeCloseTo(expected, 9);
  });

  it("decays a reeling car's spin as a per-second rate", () => {
    expect(RAM_CONFIG.reelingSpinDecayRate).toBeGreaterThan(0);
    expect(reelingSpinPerTick()).toBeCloseTo(
      Math.exp(-RAM_CONFIG.reelingSpinDecayRate / TICK_RATE_HZ), 12);
  });

  it("locks the attacker for less time than it reels the victim", () => {
    expect(RAM_CONFIG.attackerLockMs).toBeGreaterThan(0);
    expect(RAM_CONFIG.attackerLockMs).toBeLessThan(RAM_CONFIG.ramUncontrolMs);
    expect(ramTicks().attackerLock).toBe(msToTicks(RAM_CONFIG.attackerLockMs));
  });
});

// Replaces the old "mass rating" block outright. `mass` and `massOf` are deleted (stage 3 Task 4,
// spec R1), so the questions that block asked — is every chassis's rating a whole 0-100 number, and
// does the roster order the way the design says — are asked here of the pair that replaced it. The
// third question it asked ("does `massOf` scale the rating by `massPerRating`") has no successor on
// purpose: the contest reads the ratings unscaled, so there is no derived quantity to pin.
describe("the ram ratings", () => {
  it("gives every chassis whole 0-100 ratings on both ram axes", () => {
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      for (const rating of [ramAttackOf(id), ramDefenceOf(id)]) {
        expect(Number.isInteger(rating)).toBe(true);
        expect(rating).toBeGreaterThanOrEqual(0);
        expect(rating).toBeLessThanOrEqual(100);
      }
    }
  });

  it("orders both axes tank > speedster > skirmisher, as the old single mass rating did", () => {
    expect(ramAttackOf("bastion")).toBeGreaterThan(ramAttackOf("mirage"));
    expect(ramAttackOf("mirage")).toBeGreaterThan(ramAttackOf("bullseye"));
    expect(ramDefenceOf("bastion")).toBeGreaterThan(ramDefenceOf("mirage"));
    expect(ramDefenceOf("mirage")).toBeGreaterThan(ramDefenceOf("bullseye"));
  });

  // The whole reason there are two ratings and not one (spec R1): a chassis's offence and its
  // solidity must be settable apart. Bastion's spread (70/90) is the roster's widest and Bullseye's
  // (45/30) leans the other way, so the pair is doing work no single rating could — if every car
  // ever carried the same number on both, the split would have bought nothing.
  it("does not carry the same number on both axes for every car", () => {
    const ids = Object.keys(CAR_TABLE) as CarId[];
    expect(ids.some((id) => ramAttackOf(id) !== ramDefenceOf(id))).toBe(true);
  });
});
