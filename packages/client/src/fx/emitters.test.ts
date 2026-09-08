import { describe, expect, it } from "vitest";
import { emitterSpecsFor, emitterSpecsForAll, MAX_SPECS_PER_FRAME } from "./emitters.js";
import { WEAPON_FX } from "./table.js";

describe("emitterSpecsFor", () => {
  it("turns a shotFired into that weapon's muzzle bursts, at the event pose", () => {
    const specs = emitterSpecsFor({ kind: "shotFired", weaponId: "lance", x: 5, y: 6, angle: 1.2 });
    expect(specs).toHaveLength(WEAPON_FX.lance!.muzzle.length);
    for (const spec of specs) {
      expect(spec.x).toBe(5);
      expect(spec.y).toBe(6);
      expect(spec.angle).toBe(1.2);
    }
  });

  it("turns a shotEnded into that weapon's impact bursts", () => {
    const specs = emitterSpecsFor({ kind: "shotEnded", weaponId: "magmablast", x: 9, y: 9, angle: 0 });
    expect(specs.map((s) => s.channel).sort()).toEqual(["debris", "fire", "smoke", "spark"]);
  });

  it("uses the default row for an unauthored weapon rather than emitting nothing", () => {
    expect(emitterSpecsFor({ kind: "shotFired", weaponId: "tremor", x: 0, y: 0, angle: 0 }).length)
      .toBeGreaterThan(0);
  });

  it("scales a damaged event's sparks with the hp actually lost", () => {
    const light = emitterSpecsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 4 });
    const heavy = emitterSpecsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 40 });
    expect(heavy[0].burst.count).toBeGreaterThan(light[0].burst.count);
  });

  it("always emits at least one spark for a scratch, so a hit is never silent", () => {
    const specs = emitterSpecsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 0.5 });
    expect(specs[0].burst.count).toBeGreaterThanOrEqual(1);
  });

  it("gives a death fire, soot and debris — bigger than any single hit", () => {
    const specs = emitterSpecsFor({ kind: "died", sessionId: "a", x: 0, y: 0 });
    const channels = specs.map((s) => s.channel);
    expect(channels).toContain("fire");
    expect(channels).toContain("smoke");
    expect(channels).toContain("debris");
    expect(specs.find((s) => s.channel === "smoke")?.burst.soot).toBe(true);
  });
});

describe("emitterSpecsForAll", () => {
  it("flattens every event's specs", () => {
    const specs = emitterSpecsForAll([
      { kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 },
      { kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 },
    ]);
    expect(specs).toHaveLength(WEAPON_FX.lance!.muzzle.length * 2);
  });

  it("caps the frame, so a pile-up degrades instead of stalling the renderer", () => {
    const many = Array.from({ length: 400 }, () => ({
      kind: "shotEnded" as const,
      weaponId: "magmablast",
      x: 0,
      y: 0,
      angle: 0,
    }));
    expect(emitterSpecsForAll(many).length).toBeLessThanOrEqual(MAX_SPECS_PER_FRAME);
  });

  it("keeps the EARLIEST specs when it caps, so the first explosion is the one you see", () => {
    const specs = emitterSpecsForAll([
      { kind: "shotFired", weaponId: "lance", x: 111, y: 0, angle: 0 },
      ...Array.from({ length: 400 }, () => ({
        kind: "shotEnded" as const,
        weaponId: "magmablast",
        x: 0,
        y: 0,
        angle: 0,
      })),
    ]);
    expect(specs[0].x).toBe(111);
  });
});

describe("emitterSpecsFor with an injected resolver", () => {
  it("uses the resolver's row instead of the shipped one", () => {
    const resolve = () => ({
      muzzle: [
        { channel: "debris" as const, count: 3, speed: 10, lifeMs: 100, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: 1 },
      ],
      impact: [],
    });
    const specs = emitterSpecsFor(
      { kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 },
      resolve,
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]!.channel).toBe("debris");
  });

  it("defaults to the shipped table when no resolver is passed", () => {
    const specs = emitterSpecsFor({ kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 });
    expect(specs.map((s) => s.channel)).toEqual(["fire", "spark"]);
  });

  it("drops a burst whose count is zero (PG47)", () => {
    const resolve = () => ({
      muzzle: [
        { channel: "fire" as const, count: 0, speed: 10, lifeMs: 100, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: 1 },
        { channel: "spark" as const, count: 2, speed: 10, lifeMs: 100, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: 1 },
      ],
      impact: [],
    });
    const specs = emitterSpecsFor(
      { kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 },
      resolve,
    );
    expect(specs.map((s) => s.channel)).toEqual(["spark"]);
  });
});
