import { describe, expect, it } from "vitest";
import { cellular, fbm, hash2, tileableFbm, valueNoise } from "./noise.js";

describe("hash2", () => {
  it("stays inside [0,1)", () => {
    for (let i = 0; i < 200; i++) {
      const v = hash2(i, i * 7, 1337);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for the same inputs", () => {
    expect(hash2(12, 34, 99)).toBe(hash2(12, 34, 99));
  });

  it("decorrelates neighbours across a sweep, not just one lucky pair", () => {
    let tooClose = 0;
    for (let i = 0; i < 500; i++) {
      if (Math.abs(hash2(i, i * 3, 42) - hash2(i + 1, i * 3, 42)) <= 0.01) tooClose++;
    }
    // This bar is a sanity bound against a badly correlated hash. Independent uniform values
    // predict P(|a−b| ≤ 0.01) = 2(0.01) − 0.01² ≈ 0.0199, so ~10 hits expected in 500 pairs.
    // Threshold of 20 sits about three standard deviations above that (sd ≈ 3.1).
    expect(tooClose).toBeLessThan(20);
  });

  it("spans the whole unit interval, not just its bottom half", () => {
    let min = 1;
    let max = 0;
    let sum = 0;
    let n = 0;
    for (let seed = 0; seed < 3; seed++) {
      for (let y = 0; y < 60; y++) {
        for (let x = 0; x < 60; x++) {
          const v = hash2(x, y, seed * 13 + 7);
          min = Math.min(min, v);
          max = Math.max(max, v);
          sum += v;
          n++;
        }
      }
    }
    // An arithmetic-shift avalanche caps this at 0.5 and pulls the mean to 0.25, which halves the
    // contrast of every texture built on fbm.
    expect(max).toBeGreaterThan(0.95);
    expect(min).toBeLessThan(0.05);
    expect(sum / n).toBeGreaterThan(0.45);
    expect(sum / n).toBeLessThan(0.55);
  });
});

describe("valueNoise", () => {
  it("interpolates smoothly between lattice points", () => {
    // Two samples a hundredth of a cell apart must not jump.
    const a = valueNoise(4.50, 4.5, 3);
    const b = valueNoise(4.51, 4.5, 3);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it("reproduces the lattice value exactly at integer coordinates", () => {
    expect(valueNoise(6, 9, 2)).toBeCloseTo(hash2(6, 9, 2), 10);
  });
});

describe("fbm", () => {
  it("stays inside [0,1]", () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 0.37, i * 0.11, 7, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("varies with the seed — this is what makes a re-roll a re-roll (VFX8)", () => {
    expect(fbm(3.3, 4.4, 1, 4)).not.toBe(fbm(3.3, 4.4, 2, 4));
  });

  it("adds detail with each octave rather than repeating one", () => {
    expect(fbm(3.3, 4.4, 1, 1)).not.toBe(fbm(3.3, 4.4, 1, 4));
  });
});

describe("tileableFbm", () => {
  it("wraps exactly, not just closely — the same pattern repeats at the tile period", () => {
    // The property `asphaltTexture` is built on: sampling one period apart must return the
    // identical value, which is an equality rather than a bound. `fbm` cannot do this — its lattice
    // has no wrap at all, which is what put a 5x seam across the arena floor.
    for (let i = 0; i < 24; i++) {
      const x = i * 0.31;
      expect(tileableFbm(x, 1.7, 5, 3, 8)).toBeCloseTo(tileableFbm(x + 8, 1.7, 5, 3, 8), 12);
      expect(tileableFbm(1.7, x, 5, 3, 8)).toBeCloseTo(tileableFbm(1.7, x + 8, 5, 3, 8), 12);
      // Negative coordinates too: `%` keeps the sign in JS, so a naive wrap hashes cells the
      // positive side never reaches and the seam survives on one edge only.
      expect(tileableFbm(-x, 1.7, 5, 3, 8)).toBeCloseTo(tileableFbm(-x + 8, 1.7, 5, 3, 8), 12);
    }
  });

  it("stays inside [0,1]", () => {
    for (let i = 0; i < 200; i++) {
      const v = tileableFbm(i * 0.37, i * 0.11, 7, 4, 16);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("varies with the seed, and adds detail with each octave", () => {
    expect(tileableFbm(3.3, 4.4, 1, 4, 16)).not.toBe(tileableFbm(3.3, 4.4, 2, 4, 16));
    expect(tileableFbm(3.3, 4.4, 1, 1, 16)).not.toBe(tileableFbm(3.3, 4.4, 1, 4, 16));
  });

  it("leaves `fbm` alone — the other textures' output is pinned to it", () => {
    // A frozen sample rather than a comparison against a reimplementation: the point is that the
    // non-wrapping generator every other texture in `textures.ts` uses did not move.
    expect(fbm(3.3, 4.4, 1, 4)).toBeCloseTo(0.5343265174305329, 12);
  });
});

describe("cellular noise", () => {
  it("returns the two nearest feature distances, in order", () => {
    for (let i = 0; i < 200; i++) {
      const { f1, f2 } = cellular(i * 0.37, i * 0.61, 9);
      expect(f1).toBeLessThanOrEqual(f2);
      expect(f1).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(f2)).toBe(true);
    }
  });

  it("is deterministic for a seed and drifts for a different one", () => {
    expect(cellular(3.2, 4.8, 1)).toEqual(cellular(3.2, 4.8, 1));
    expect(cellular(3.2, 4.8, 1)).not.toEqual(cellular(3.2, 4.8, 2));
  });

  it("puts f2 - f1 near zero on a cell boundary and larger inside a cell", () => {
    // This difference IS the crack network: near 0 where two cells meet, large in a plate's middle.
    let onBoundary = 0;
    let interior = 0;
    for (let i = 0; i < 4000; i++) {
      const edge = cellular((i % 64) * 0.25, Math.floor(i / 64) * 0.25, 3);
      if (edge.f2 - edge.f1 < 0.05) onBoundary++;
      if (edge.f2 - edge.f1 > 0.4) interior++;
    }
    expect(onBoundary).toBeGreaterThan(0);
    expect(interior).toBeGreaterThan(onBoundary);
  });
});
