import { describe, expect, it } from "vitest";
import { interceptAngle, interceptTime } from "./aim.js";

describe("interceptTime", () => {
  it("is distance/speed against a stationary target", () => {
    expect(interceptTime(300, 400, 0, 0, 1000)).toBeCloseTo(0.5); // hypot 500 at 1000 u/s
  });
  it("returns null when the target outruns the shot away from it", () => {
    expect(interceptTime(100, 0, 500, 0, 400)).toBeNull(); // fleeing at 500 vs a 400 u/s shot
  });
});

describe("interceptAngle", () => {
  it("leads a crossing target so the shot and the target arrive together", () => {
    const speed = 900;
    const [tx, ty, tvx, tvy] = [400, 0, 0, 300]; // crossing at 300 u/s
    const angle = interceptAngle(0, 0, tx, ty, tvx, tvy, speed);
    const t = interceptTime(tx, ty, tvx, tvy, speed)!;
    const sx = Math.cos(angle) * speed * t;
    const sy = Math.sin(angle) * speed * t;
    expect(sx).toBeCloseTo(tx + tvx * t, 5);
    expect(sy).toBeCloseTo(ty + tvy * t, 5);
  });
  it("falls back to aiming at the current position when no intercept exists", () => {
    const angle = interceptAngle(0, 0, 100, 0, 500, 0, 400);
    expect(angle).toBeCloseTo(0); // direct bearing
  });
});
