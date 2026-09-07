import { describe, expect, it } from "vitest";
import { HIT_STOP_MS, HIT_STOP_SCALE, ramShake, shakeFor } from "./camera.js";

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
});

describe("ramShake", () => {
  it("scales with the closing speed", () => {
    expect(ramShake(300).intensity).toBeGreaterThan(ramShake(60).intensity);
  });

  it("still produces something for a gentle nudge, so contact is never silent", () => {
    expect(ramShake(1).intensity).toBeGreaterThan(0);
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
