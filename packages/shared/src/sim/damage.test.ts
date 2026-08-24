import { describe, expect, it } from "vitest";
import { applyDamage } from "./damage.js";

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
})
