import { describe, expect, it } from "vitest";
import { WEAPON_TABLE, isWeaponId, weaponDefOf } from "./weapon-config.js";
import type { WeaponDef } from "./weapon-types.js";

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

  it("validates every row: positive stats, unlocksAt >= 1, volley counts >= 1, cone angle in (0, 180)", () => {
    const rows: WeaponDef[] = Object.values(WEAPON_TABLE);
    for (const def of rows) {
      expect(def.unlocksAt).toBeGreaterThanOrEqual(1);
      expect(def.damage).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.range).toBeGreaterThan(0);
      expect(def.name.length).toBeGreaterThan(0);
      if (def.stock) {
        expect(def.stock.max).toBeGreaterThanOrEqual(2);
        expect(def.stock.refireDelayMs).toBeGreaterThanOrEqual(0);
      }
      if (def.kind === "projectile") {
        // Both counts are loop bounds in `spawnInstances`/`releaseShots`, and both fail silently
        // rather than loudly: `pelletsPerVolley: 0` spawns nothing at all for a press that still
        // spends its stock, and `volleys: 0` fires exactly one shot (the first release always
        // emits) instead of none.
        expect(def.volley.volleys).toBeGreaterThanOrEqual(1);
        expect(def.volley.pelletsPerVolley).toBeGreaterThanOrEqual(1);
        expect(def.volley.spreadAngleDeg).toBeGreaterThanOrEqual(0);
      }
      // Dormant until the first beam row ships, and deliberately written now rather than then: a
      // cone's half-angle goes through `Math.tan`, so `angleDeg: 180` yields an infinite spread and
      // an all-NaN polygon that SAT silently reports as hitting nothing, and `0` a zero-area cone.
      if (def.kind === "beam" && def.hitbox.shape === "cone") {
        expect(def.hitbox.angleDeg).toBeGreaterThan(0);
        expect(def.hitbox.angleDeg).toBeLessThan(180);
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
