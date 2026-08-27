import { describe, expect, it } from "vitest";
import { WEAPON_TABLE, isWeaponId, weaponDefOf } from "./weapon-config.js";

describe("WEAPON_TABLE", () => {
  it("ships the migrated cannon with today's numbers", () => {
    const cannon = WEAPON_TABLE.cannon;
    expect(cannon.kind).toBe("projectile");
    expect(cannon.damage).toBe(8);
    expect(cannon.cooldownMs).toBe(500); // was fireRateHz: 2
    expect(cannon.speed).toBe(900);
    expect(cannon.range).toBe(900); // was lifetimeTicks: 30 == 1s of flight at 900 u/s
    expect(cannon.startUpMs).toBe(0);
    expect(cannon.recoveryMs).toBe(0);
    expect(cannon.damageFrequencyMs).toBe(0);
    expect(cannon.unlocksAt).toBe(1);
    expect(cannon.stock).toBeUndefined();
  });

  it("gives the cannon a single-target circle hitbox and no volley spread", () => {
    const cannon = WEAPON_TABLE.cannon;
    if (cannon.kind !== "projectile") throw new Error("cannon must be a projectile");
    expect(cannon.pierce).toBe(0);
    expect(cannon.hitbox).toEqual({ shape: "circle", radius: 3 });
    expect(cannon.volley).toEqual({
      volleys: 1,
      volleyIntervalMs: 0,
      pelletsPerVolley: 1,
      spreadAngleDeg: 0,
    });
  });

  it("validates every row: positive stats, unlocksAt >= 1", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      expect(def.unlocksAt).toBeGreaterThanOrEqual(1);
      expect(def.damage).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.range).toBeGreaterThan(0);
      expect(def.name.length).toBeGreaterThan(0);
      if (def.stock) {
        expect(def.stock.max).toBeGreaterThanOrEqual(2);
        expect(def.stock.refireDelayMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("rejects prototype names as weapon ids", () => {
    expect(isWeaponId("cannon")).toBe(true);
    expect(isWeaponId("constructor")).toBe(false);
    expect(isWeaponId("__proto__")).toBe(false);
    expect(isWeaponId(7)).toBe(false);
  });

  it("resolves a def by id", () => {
    expect(weaponDefOf("cannon").id).toBe("cannon");
  });
});
