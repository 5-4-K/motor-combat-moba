import { describe, expect, it } from "vitest";
import { CAR_TABLE, COLOR_TABLE, DEFAULT_CAR_ID, DRIVE_CONFIG } from "@motor-arena/shared";
import { carFillOf, carShapeOf, hexagonPoints } from "./car-visual.js";

describe("carShapeOf", () => {
  it("gives every CAR_TABLE id its own silhouette", () => {
    const shapes = Object.keys(CAR_TABLE).map((id) => carShapeOf(id));
    expect(shapes).toEqual(["rect", "ellipse", "hex"]);
    expect(new Set(shapes).size).toBe(Object.keys(CAR_TABLE).length);
  });

  it("draws the default chassis for an unset or unknown carId", () => {
    const fallback = carShapeOf(DEFAULT_CAR_ID);
    expect(carShapeOf("")).toBe(fallback);
    expect(carShapeOf("triangle")).toBe(fallback);
    // `in` would accept this; the shape lookup must not inherit from Object.prototype either.
    expect(carShapeOf("constructor")).toBe(fallback);
  });
});

describe("carFillOf", () => {
  it("converts each COLOR_TABLE hex to its Phaser integer", () => {
    for (const color of COLOR_TABLE) {
      expect(carFillOf(color.colorId)).toBe(Number.parseInt(color.hex.slice(1), 16));
    }
    expect(carFillOf(0)).toBe(0xe74c3c);
  });

  it("falls back to a real colour for an out-of-range colorId instead of NaN", () => {
    // A NaN fill renders as an invisible car, which is worse than the wrong colour.
    expect(carFillOf(99)).toBe(carFillOf(COLOR_TABLE[0].colorId));
    expect(Number.isNaN(carFillOf(-1))).toBe(false);
  });
});

describe("hexagonPoints", () => {
  it("is a closed six-sided shape inside the car's own footprint", () => {
    const points = hexagonPoints(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);
    expect(points).toHaveLength(6);
    for (const point of points) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(DRIVE_CONFIG.carWidth / 2);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(DRIVE_CONFIG.carHeight / 2);
    }
  });

  it("points its nose along +x so rotating by angle faces the direction of travel", () => {
    const points = hexagonPoints(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);
    const nose = points.reduce((best, p) => (p.x > best.x ? p : best));
    expect(nose).toEqual({ x: DRIVE_CONFIG.carWidth / 2, y: 0 });
  });
});
