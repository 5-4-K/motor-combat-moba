import { describe, expect, it } from "vitest";
import {
  HIT_STOP_MS,
  HIT_STOP_SCALE,
  ramShake,
  shakeFor,
  shouldStartShake,
  type ActiveShake,
} from "./camera.js";

describe("shakeFor", () => {
  it("shakes harder for a death than for a hit", () => {
    const death = shakeFor({ kind: "died", sessionId: "a", x: 0, y: 0 })!;
    const hit = shakeFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 20 })!;
    expect(death.intensity).toBeGreaterThan(hit.intensity);
  });

  it("scales a hit's shake with the damage taken", () => {
    const light = shakeFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 3 })!;
    const heavy = shakeFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 45 })!;
    expect(heavy.intensity).toBeGreaterThan(light.intensity);
  });

  it("caps the shake, so a burst of damage cannot make the camera unusable", () => {
    const huge = shakeFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 100_000 })!;
    expect(huge.intensity).toBeLessThanOrEqual(0.02);
  });

  it("never shakes for a muzzle flash — the camera would tremble constantly", () => {
    expect(shakeFor({ kind: "shotFired", weaponId: "pepperbox", x: 0, y: 0, angle: 0 })).toBeUndefined();
  });

  it("shakes for an explosion ending but not for a beam ending", () => {
    expect(shakeFor({ kind: "shotEnded", weaponId: "magmablast", x: 0, y: 0, angle: 0 })).toBeDefined();
    expect(shakeFor({ kind: "shotEnded", weaponId: "lance", x: 0, y: 0, angle: 0 })).toBeUndefined();
  });

  it("does not shake for predator ending — it is a homing missile, not an explosive", () => {
    expect(shakeFor({ kind: "shotEnded", weaponId: "predator", x: 0, y: 0, angle: 0 })).toBeUndefined();
  });
});

describe("ramShake", () => {
  it("scales with the closing speed", () => {
    expect(ramShake(300).intensity).toBeGreaterThan(ramShake(60).intensity);
  });

  it("still produces something for a gentle nudge, so contact is never silent", () => {
    expect(ramShake(1).intensity).toBeGreaterThan(0);
  });

  it("floors an unattributed ram at 0.006, matching the shipped feel", () => {
    expect(ramShake(0).intensity).toBeCloseTo(0.006, 6);
  });

  it("caps below an explosion and a kill, so a ram never out-shakes either", () => {
    const ram = ramShake(100_000).intensity;
    expect(ram).toBeCloseTo(0.012, 6);
    expect(ram).toBeLessThan(shakeFor({ kind: "shotEnded", weaponId: "magmablast", x: 0, y: 0, angle: 0 })!.intensity);
    expect(ram).toBeLessThan(shakeFor({ kind: "died", sessionId: "a", x: 0, y: 0 })!.intensity);
  });
});

describe("shouldStartShake", () => {
  const spec = (intensity: number) => ({ durationMs: 100, intensity });

  it("starts when nothing is playing", () => {
    expect(shouldStartShake(undefined, spec(0.01), 1000)).toBe(true);
  });

  it("starts when a stronger shake arrives mid-shake", () => {
    const active: ActiveShake = { intensity: 0.005, endsAtMs: 2000 };
    expect(shouldStartShake(active, spec(0.01), 1000)).toBe(true);
  });

  it("refuses a weaker shake arriving mid-shake", () => {
    const active: ActiveShake = { intensity: 0.01, endsAtMs: 2000 };
    expect(shouldStartShake(active, spec(0.005), 1000)).toBe(false);
  });

  it("starts an equal shake — ties go to the new one", () => {
    const active: ActiveShake = { intensity: 0.01, endsAtMs: 2000 };
    expect(shouldStartShake(active, spec(0.01), 1000)).toBe(true);
  });

  it("starts a weaker shake exactly at the previous one's end — the boundary counts as over", () => {
    const active: ActiveShake = { intensity: 0.01, endsAtMs: 2000 };
    expect(shouldStartShake(active, spec(0.005), 2000)).toBe(true);
  });

  it("starts just after the previous shake's end, regardless of strength", () => {
    const active: ActiveShake = { intensity: 0.01, endsAtMs: 2000 };
    expect(shouldStartShake(active, spec(0.001), 2001)).toBe(true);
  });
});

describe("hit stop", () => {
  it("is brief and partial — a full freeze reads as a dropped frame", () => {
    expect(HIT_STOP_MS).toBeGreaterThan(0);
    expect(HIT_STOP_MS).toBeLessThanOrEqual(120);
    expect(HIT_STOP_SCALE).toBeGreaterThan(0);
    expect(HIT_STOP_SCALE).toBeLessThan(1);
  });
});
