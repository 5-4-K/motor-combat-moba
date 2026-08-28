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

  it("rises with attack and never falls", () => {
    let previous = -1;
    for (let attack = 0; attack <= 100; attack += 1) {
      const value = damageFor(attack, 50);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
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
    expect(weaponDamageOf("rectangle", "fireball")).toBe(40);
    expect(weaponDamageOf("oval", "fireball")).toBe(60);
    expect(weaponDamageOf("hexagon", "fireball")).toBe(50);
  });
})
