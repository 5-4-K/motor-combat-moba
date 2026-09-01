import { describe, expect, it } from "vitest";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { applyDamage, damageFor, weaponDamageOf } from "./damage.js";

describe("applyDamage", () => {
  it("subtracts the amount from hp", () => {
    expect(applyDamage(50, 8)).toBe(42);
  });

  it("floors at 0 rather than going negative", () => {
    expect(applyDamage(5, 8)).toBe(0);
  });

  it("leaves hp untouched for a zero amount", () => {
    expect(applyDamage(50, 0)).toBe(50);
  });

  it("treats an already-dead car as staying at 0", () => {
    expect(applyDamage(0, 8)).toBe(0);
  });

  it("ignores negative amounts rather than healing", () => {
    expect(applyDamage(50, -8)).toBe(50);
  });
});

describe("damageFor", () => {
  it("leaves a weapon's damage untouched at the baseline rating", () => {
    expect(damageFor(COMBAT_CONFIG.attackBaseline, 50)).toBe(50);
  });

  it("halves at rating 0 and adds half again at rating 100", () => {
    expect(damageFor(0, 50)).toBe(25);
    expect(damageFor(100, 50)).toBe(75);
  });

  it("matches exact percentage arithmetic at every rating", () => {
    // Guards the float-normalisation in `damageFor`: `damagePerAttack` is 0.01, which is not exactly
    // representable, so without normalisation the product lands just under a .5 boundary at some
    // ratings and rounds the wrong way. Fails at attack 15, 63 and 65 without it.
    for (let attack = 0; attack <= 100; attack++) {
      const exact = Math.floor((50 * (100 + (attack - COMBAT_CONFIG.attackBaseline))) / 100 + 0.5);
      expect(damageFor(attack, 50)).toBe(exact);
    }
  });

  it("always returns a whole number, so hp stays an integer", () => {
    // uint16 hp: a fractional subtraction would round somewhere less visible.
    for (const attack of [0, 7, 30, 33, 50, 66, 70, 99, 100]) {
      expect(Number.isInteger(damageFor(attack, 31))).toBe(true);
    }
  });

  it("keeps a zero-damage weapon at zero however high the attack", () => {
    expect(damageFor(100, 0)).toBe(0);
  });

  it("never returns a negative number for an out-of-range rating", () => {
    // Ratings are validated in config.test.ts, but a defensive floor here means a bad authoring
    // value cannot turn a weapon into a repair kit via applyDamage's `amount <= 0` early return.
    expect(damageFor(-500, 50)).toBeGreaterThanOrEqual(0);
  });
});

describe("weaponDamageOf", () => {
  it("gives each chassis its own damage with the same weapon", () => {
    expect(weaponDamageOf("mirage", "shockwave")).toBe(25);
    expect(weaponDamageOf("bullseye", "shockwave")).toBe(23);
    expect(weaponDamageOf("bastion", "shockwave")).toBe(20);
  });
})
