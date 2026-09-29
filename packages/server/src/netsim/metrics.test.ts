import { describe, expect, it } from "vitest";
import { isHold, nearestOnPath, percentile, truthAt, truthWindow } from "./metrics.js";

describe("netsim metrics", () => {
  it("percentile is nearest-rank", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
  });

  it("nearestOnPath finds the closest point and its time on a sampled path", () => {
    const path = [
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 100, y: 0 },
    ];
    const hit = nearestOnPath(path, 50, 10);
    expect(hit.distance).toBeCloseTo(10);
    expect(hit.t).toBeCloseTo(50);
  });

  it("nearestOnPath breaks ties toward the newest point (a stationary car)", () => {
    const path = [
      { t: 0, x: 5, y: 5 },
      { t: 100, x: 5, y: 5 },
      { t: 200, x: 5, y: 5 },
    ];
    expect(nearestOnPath(path, 5, 5).t).toBe(200);
  });

  it("truthAt interpolates between the bracketing tick samples, clamped at the ends", () => {
    const path = [
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 100, y: 50 },
    ];
    expect(truthAt(path, 25)).toEqual({ t: 25, x: 25, y: 12.5 });
    expect(truthAt(path, 100)).toEqual({ t: 100, x: 100, y: 50 });
    expect(truthAt(path, -10)).toEqual({ t: -10, x: 0, y: 0 });
    expect(truthAt(path, 150)).toEqual({ t: 150, x: 100, y: 50 });
  });

  it("truthWindow spans exactly [from, to] with interpolated endpoints", () => {
    const path = [0, 100, 200, 300].map((t) => ({ t, x: t, y: 0 }));
    expect(truthWindow(path, 50, 250).map((p) => p.t)).toEqual([50, 100, 200, 250]);
    expect(truthWindow(path, 100, 200).map((p) => p.t)).toEqual([100, 200]);
    expect(truthWindow(path, 50, 250)[3]!.x).toBe(250);
  });

  describe("isHold", () => {
    it("a remote car that is standing still does not count as held", () => {
      const p = { x: 10, y: 10 };
      expect(isHold(p, p, p, p)).toBe(false);
      // Truth moved, but under the 1 u threshold: still not a hold.
      expect(isHold(p, p, p, { x: 10.5, y: 10 })).toBe(false);
    });

    it("truth moved while the drawn pose froze is a hold", () => {
      const drawn = { x: 10, y: 10 };
      expect(isHold(drawn, { x: 10.005, y: 10 }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);
    });

    it("both moving is not a hold", () => {
      expect(isHold({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(false);
    });
  });
});
