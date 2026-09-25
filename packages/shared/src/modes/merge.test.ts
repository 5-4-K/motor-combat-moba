import { describe, expect, it } from "vitest";
import { mergeTables, replace, type ModeOverrides } from "./merge.js";
import type { ModeTables } from "./types.js";

// A tiny structural stand-in: mergeTables is generic over plain data, so the test does not need a
// real 1,400-line table set. Cast through unknown at the boundary only.
const base = {
  cars: { mirage: { speed: 85, weapons: ["a", "b"], turret: { x: 1 } } },
  weapons: { a: { damage: 10 } },
  slots: { basicAttackEnabled: false, maxAbilitySlots: 3 },
  arenas: ["arena-01", "arena-02"],
  maxPlayers: 6,
} as unknown as ModeTables;
const o = (x: unknown) => x as ModeOverrides;

describe("mergeTables", () => {
  it("returns equal tables for empty overrides, as a fresh object", () => {
    const out = mergeTables(base, {});
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
    expect((out as any).cars.mirage).not.toBe((base as any).cars.mirage);
  });
  it("merges plain objects key by key", () => {
    const out = mergeTables(base, o({ cars: { mirage: { speed: 90 } }, slots: { basicAttackEnabled: true } })) as any;
    expect(out.cars.mirage).toEqual({ speed: 90, weapons: ["a", "b"], turret: { x: 1 } });
    expect(out.slots).toEqual({ basicAttackEnabled: true, maxAbilitySlots: 3 });
  });
  it("replaces arrays whole", () => {
    const out = mergeTables(base, o({ cars: { mirage: { weapons: ["b"] } }, arenas: ["arena-03"] })) as any;
    expect(out.cars.mirage.weapons).toEqual(["b"]);
    expect(out.arenas).toEqual(["arena-03"]);
  });
  it("replace() swaps a whole row, which is how an optional field is removed", () => {
    const out = mergeTables(base, o({ cars: { mirage: replace({ speed: 1, weapons: [] }) } })) as any;
    expect(out.cars.mirage).toEqual({ speed: 1, weapons: [] });
  });
  it("adds a new keyed row only through replace()", () => {
    const out = mergeTables(base, o({ weapons: { z: replace({ damage: 5 }) } })) as any;
    expect(out.weapons.z).toEqual({ damage: 5 });
  });
  it("throws naming the full path on an unknown key (typo guard, GM13)", () => {
    expect(() => mergeTables(base, o({ cars: { mirage: { sped: 1 } } }))).toThrow(
      "mode override path does not exist in the base: cars.mirage.sped",
    );
    expect(() => mergeTables(base, o({ weapons: { z: { damage: 5 } } }))).toThrow("weapons.z");
  });
  it("throws when an override changes a value's type", () => {
    expect(() => mergeTables(base, o({ maxPlayers: "6" }))).toThrow("maxPlayers");
    expect(() => mergeTables(base, o({ slots: 3 }))).toThrow("slots");
  });
  it("never mutates the base, so two modes overriding one row stay independent", () => {
    const snapshot = structuredClone(base);
    const a = mergeTables(base, o({ cars: { mirage: { speed: 1 } } })) as any;
    const b = mergeTables(base, {}) as any;
    expect(base).toEqual(snapshot);
    expect(a.cars.mirage.speed).toBe(1);
    expect(b.cars.mirage.speed).toBe(85);
  });
});
