import { describe, expect, it } from "vitest";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { isRamming, ramDamage, ramOutcome } from "./ram.js";

const T = COMBAT_CONFIG.ramDotThreshold;

describe("isRamming", () => {
  it("is true when the car faces straight at the other", () => {
    expect(isRamming(0, 0, 0, 10, 0, T)).toBe(true);
  });

  it("is false when the car faces away", () => {
    expect(isRamming(10, 0, 0, 0, 0, T)).toBe(false);
  });

  it("is false for a perpendicular sideswipe", () => {
    expect(isRamming(0, 0, Math.PI / 2, 10, 0, T)).toBe(false);
  });

  it("is false at exactly zero distance, where there is no direction to face", () => {
    expect(isRamming(5, 5, 0, 5, 5, T)).toBe(false);
  });

  it("accepts an angle exactly on the threshold", () => {
    // dot === T exactly: 60 degrees off, cos(60 deg) === 0.5 === the default threshold.
    expect(isRamming(0, 0, Math.PI / 3, 10, 0, 0.5)).toBe(true);
  });

  it("rejects an angle just past the threshold", () => {
    expect(isRamming(0, 0, Math.PI / 3 + 0.01, 10, 0, 0.5)).toBe(false);
  });

  it("is unaffected by how far apart the cars are", () => {
    expect(isRamming(0, 0, 0, 1000, 0, T)).toBe(true);
  });
});

describe("ramOutcome", () => {
  it("gives the hit to A when only A faces the contact", () => {
    expect(ramOutcome(true, false)).toBe("a_hits_b");
  });

  it("gives the hit to B when only B faces the contact", () => {
    expect(ramOutcome(false, true)).toBe("b_hits_a");
  });

  it("is head-on when both face each other", () => {
    expect(ramOutcome(true, true)).toBe("both");
  });

  it("is a no-damage graze when neither faces the other", () => {
    expect(ramOutcome(false, false)).toBe("none");
  });
});

describe("the facing rules over a real pair", () => {
  it("rear-ends: A behind B, both driving +x, only A deals damage", () => {
    const a = { x: 0, y: 0, angle: 0 };
    const b = { x: 10, y: 0, angle: 0 };
    const aRams = isRamming(a.x, a.y, a.angle, b.x, b.y, T);
    const bRams = isRamming(b.x, b.y, b.angle, a.x, a.y, T);
    expect(ramOutcome(aRams, bRams)).toBe("a_hits_b");
  });

  it("head-on: B turned around, both deal damage", () => {
    const a = { x: 0, y: 0, angle: 0 };
    const b = { x: 10, y: 0, angle: Math.PI };
    const aRams = isRamming(a.x, a.y, a.angle, b.x, b.y, T);
    const bRams = isRamming(b.x, b.y, b.angle, a.x, a.y, T);
    expect(ramOutcome(aRams, bRams)).toBe("both");
  });

  it("sideswipe: A crossing B's path, nobody deals damage", () => {
    const a = { x: 0, y: 0, angle: Math.PI / 2 };
    const b = { x: 10, y: 0, angle: Math.PI / 2 };
    const aRams = isRamming(a.x, a.y, a.angle, b.x, b.y, T);
    const bRams = isRamming(b.x, b.y, b.angle, a.x, a.y, T);
    expect(ramOutcome(aRams, bRams)).toBe("none");
  });
});

describe("ramDamage", () => {
  it("is strength times the per-strength rate", () => {
    expect(ramDamage(8, 1)).toBe(8);
  });

  it("scales with the rate", () => {
    expect(ramDamage(3, 2)).toBe(6);
  });

  it("is zero for a zero-strength chassis", () => {
    expect(ramDamage(0, 1)).toBe(0);
  });
});
