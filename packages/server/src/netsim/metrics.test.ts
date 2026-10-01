import { describe, expect, it } from "vitest";
import {
  headingAt,
  headingErrorDeg,
  isHold,
  jumpExcess,
  nearestOnPath,
  percentile,
  scoreRemoteSample,
  truthAt,
  truthWindow,
} from "./metrics.js";

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

  describe("scoreRemoteSample", () => {
    // A car driving +x at 1 u/ms, truth sampled every 33 ms out to 2 s.
    const path = Array.from({ length: 61 }, (_, i) => ({ t: i * 33, x: i * 33, y: 0 }));

    it("a pose drawn behind on the true path scores ~0 error and a positive delay", () => {
      const s = scoreRemoteSample(path, 1000, 900, 0);
      expect(s.distance).toBeCloseTo(0);
      expect(s.delayMs).toBeCloseTo(100);
    });

    it("a pose drawn AHEAD on the true path (within 100 ms) scores ~0 error and a negative delay", () => {
      const s = scoreRemoteSample(path, 1000, 1080, 0);
      expect(s.distance).toBeCloseTo(0);
      expect(s.delayMs).toBeCloseTo(-80);
    });

    it("a stationary car drawn where it stands scores zero delay, not the lead window's edge", () => {
      const still = Array.from({ length: 61 }, (_, i) => ({ t: i * 33, x: 5, y: 5 }));
      const s = scoreRemoteSample(still, 1000, 5, 5);
      expect(s.distance).toBe(0);
      expect(s.delayMs).toBe(0);
    });

    it("a pose drawn more than 100 ms ahead is scored against the window's leading edge", () => {
      const s = scoreRemoteSample(path, 1000, 1150, 0);
      expect(s.distance).toBeCloseTo(50);
      expect(s.delayMs).toBeCloseTo(-100);
    });
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

  it("headingAt interpolates the true heading the short way across the seam", () => {
    const path = [
      { t: 0, angle: Math.PI - 0.1 },
      { t: 100, angle: -Math.PI + 0.1 },
    ];
    expect(Math.abs(headingAt(path, 50))).toBeCloseTo(Math.PI, 9);
    expect(headingAt(path, -10)).toBe(Math.PI - 0.1);
    expect(headingAt(path, 500)).toBe(-Math.PI + 0.1);
  });

  it("headingErrorDeg measures the short way round, in degrees", () => {
    expect(headingErrorDeg(Math.PI - 0.01, -Math.PI + 0.01)).toBeCloseTo((0.02 * 180) / Math.PI, 9);
    expect(headingErrorDeg(0.5, 0.5)).toBe(0);
  });

  it("jumpExcess is the drawn motion beyond the true motion, never negative", () => {
    const o = { x: 0, y: 0 };
    expect(jumpExcess(o, { x: 10, y: 0 }, o, { x: 4, y: 0 })).toBeCloseTo(6, 9);
    expect(jumpExcess(o, { x: 2, y: 0 }, o, { x: 4, y: 0 })).toBe(0);
  });
});
