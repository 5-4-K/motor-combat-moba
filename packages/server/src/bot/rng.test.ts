import { describe, expect, it } from "vitest";
import { deriveSeed, makeRng } from "./rng.js";

describe("makeRng", () => {
  it("is deterministic for a seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("differs between seeds", () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it("stays inside [0, 1)", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("deriveSeed", () => {
  it("gives each (match, slot) its own stream", () => {
    expect(deriveSeed(1, "match", 0)).not.toBe(deriveSeed(1, "match", 1));
  });

  it("is stable across runs, so a replay reproduces exactly", () => {
    expect(deriveSeed(99, "m", 3)).toBe(deriveSeed(99, "m", 3));
  });
});
