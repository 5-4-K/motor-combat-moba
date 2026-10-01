import { describe, expect, it } from "vitest";
import { contactBlendWeight } from "./contact-blend.js";

describe("contactBlendWeight", () => {
  it("is 1 within one car length, 0 at the range and beyond, linear between", () => {
    expect(contactBlendWeight(0, 60, 2)).toBe(1);
    expect(contactBlendWeight(60, 60, 2)).toBe(1);
    expect(contactBlendWeight(90, 60, 2)).toBeCloseTo(0.5, 12);
    expect(contactBlendWeight(120, 60, 2)).toBe(0);
    expect(contactBlendWeight(500, 60, 2)).toBe(0);
  });

  it("never rises as the distance grows", () => {
    let prev = 1;
    for (let d = 0; d <= 200; d += 1) {
      const w = contactBlendWeight(d, 60, 2);
      expect(w).toBeLessThanOrEqual(prev);
      expect(w).toBeGreaterThanOrEqual(0);
      prev = w;
    }
  });
});
