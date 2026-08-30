import { DEATH_FADE_MS, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { describe, expect, it } from "vitest";
import { CAR_TABLE, COLOR_TABLE, DEFAULT_CAR_ID, DRIVE_CONFIG } from "@motor-combat-moba/shared";
import { carFillOf, carShapeOf, deathFadeAlpha, hexagonPoints } from "./car-visual.js";

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

describe("deathFadeAlpha", () => {
  const FADE_TICKS = Math.ceil((DEATH_FADE_MS * TICK_RATE_HZ) / 1000);

  it("draws a living car fully opaque, whatever its death stamp says", () => {
    expect(deathFadeAlpha(true, 0, 500)).toBe(1);
    // A stale stamp on a living car must not dim it — respawn or revive would otherwise fade a car
    // that is perfectly alive.
    expect(deathFadeAlpha(true, 100, 500)).toBe(1);
  });

  it("fades linearly from the death tick and reaches nothing exactly at the end", () => {
    expect(deathFadeAlpha(false, 100, 100)).toBe(1);
    expect(deathFadeAlpha(false, 100, 100 + FADE_TICKS / 2)).toBeCloseTo(0.5, 6);
    expect(deathFadeAlpha(false, 100, 100 + FADE_TICKS)).toBe(0);
    expect(deathFadeAlpha(false, 100, 100 + FADE_TICKS * 10)).toBe(0);
  });

  it("treats a dead car with no death stamp as already gone", () => {
    // A client that never received the patch carrying the transition — a spectator, or a late
    // joiner. Erring toward gone is what stops a corpse being parked on the field forever; erring
    // the other way would draw it at full opacity indefinitely.
    expect(deathFadeAlpha(false, 0, 500)).toBe(0);
  });

  it("never returns a negative alpha from a clock that ran backwards", () => {
    // Reconciliation can hand the renderer a tick behind the one that stamped the death.
    expect(deathFadeAlpha(false, 200, 190)).toBe(1);
  });
});
