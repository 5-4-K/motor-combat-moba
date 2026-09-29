import { describe, expect, it } from "vitest";
import { isHold, nearestOnPath, percentile } from "./metrics.js";

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
