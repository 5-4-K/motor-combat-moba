import { describe, expect, it } from "vitest";
import { fbm, hash2, valueNoise } from "./noise.js";

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
    // A float-multiply hash lands ~2% of adjacent pairs inside this bar; a true 32-bit
    // integer multiply lands far fewer. Allow a couple by chance, not dozens.
    expect(tooClose).toBeLessThan(20);
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
