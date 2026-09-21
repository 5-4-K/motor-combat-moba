import { describe, expect, it } from "vitest";
import { aimBearingOf } from "./aim.js";

describe("aimBearingOf (TR33)", () => {
  it("is the bearing from the pivot to the world point", () => {
    expect(aimBearingOf({ x: 0, y: 0 }, { x: 0, y: 10 }, 0)).toBeCloseTo(Math.PI / 2, 12);
  });
  it("falls back when the cursor sits on the pivot", () => {
    expect(aimBearingOf({ x: 5, y: 5 }, { x: 5, y: 5 }, 1.3)).toBe(1.3);
  });
});
