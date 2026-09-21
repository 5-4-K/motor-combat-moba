import { describe, expect, it } from "vitest";
import { turretPivotOf, wrapAngle } from "./turret.js";

describe("wrapAngle", () => {
  it("maps into (-pi, pi]", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle((-5 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe("turretPivotOf (TR6)", () => {
  it("is the car centre for the shipped zero mount", () => {
    expect(turretPivotOf({ x: 100, y: 50, angle: 1.2 }, "mirage")).toEqual({ x: 100, y: 50 });
  });

  it("rotates a non-zero mount with the car", () => {
    const p = turretPivotOf({ x: 0, y: 0, angle: Math.PI / 2 }, "mirage", { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(10, 9);
  });
});
