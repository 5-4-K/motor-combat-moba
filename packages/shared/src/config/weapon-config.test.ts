import { describe, expect, it } from "vitest";
import { COLOR_TABLE } from "./color-config.js";
import { WEAPON_TABLE, isWeaponId, weaponDefOf } from "./weapon-config.js";
import type { WeaponDef } from "./weapon-types.js";
import { AIM_CONFIG } from "./aim-config.js";

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
    expect(cannon.hitbox).toEqual({ shape: "circle", radius: 12 });
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

  it("gives every weapon its own `#RRGGBB` colour, and never a player's", () => {
    const rows: WeaponDef[] = Object.values(WEAPON_TABLE);
    const colors = rows.map((def) => def.color.toUpperCase());
    for (const color of colors) expect(color).toMatch(/^#[0-9A-F]{6}$/);
    // Unique per weapon: the colour is the only thing telling two shots apart on screen, since
    // every instance draws as a plain filled hitbox.
    expect(new Set(colors).size).toBe(rows.length);
    // And never a player colour. A shot is not owner-coloured, so one wearing a player's paint
    // would claim an identity it does not carry.
    const players = new Set(COLOR_TABLE.map((c) => c.hex.toUpperCase()));
    for (const color of colors) expect(players.has(color)).toBe(false);
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

  it("gives the cannon aim assist and leaves the repeater without it", () => {
    // The pair that makes `usesAimAssist` a real switch rather than a global: one row on, one off.
    expect(WEAPON_TABLE.cannon.usesAimAssist).toBe(true);
    expect(WEAPON_TABLE.repeater.usesAimAssist).toBe(false);
  });

  it("never lets an aim-assist weapon lock past its own reach", () => {
    // A9.3. This is the one corner case a single per-car lock leaves open: with global geometry, a
    // weapon can hold a lock on a target its own `range` cannot reach, so it fires at a visible
    // bracket and falls short. Caught at authoring time instead of in play.
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (!def.usesAimAssist) continue;
      expect(def.range).toBeGreaterThanOrEqual(AIM_CONFIG.lockRange);
    }
  });

  it("keeps aim-assist weapons off the behavioural cliff", () => {
    // A9.4. `lockTimeoutMs` splits weapons into two targeting classes at `1000 / lockTimeoutMs`:
    // above it presses keep refreshing the timer and the 25% steal margin governs; below it the
    // timer lapses between shots and every shot re-picks the best target. A weapon authored near
    // the boundary flips between the two depending on how metronomically the player fires.
    //
    // The cliff is DERIVED, not hardcoded, so retuning `lockTimeoutMs` moves this guard with it
    // rather than stranding a stale range. Sustained rate is `1000 / cooldownMs` for every weapon:
    // a stocked weapon still needs one full `cooldownMs` per stock, and `refireDelayMs` only spaces
    // a burst. Per-row and therefore conservative -- a multi-slot car presses MORE often, which
    // moves it away from the cliff, never toward it.
    const cliffHz = 1000 / AIM_CONFIG.lockTimeoutMs;
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (!def.usesAimAssist) continue;
      const sustainedHz = 1000 / def.cooldownMs;
      const distance = Math.abs(sustainedHz - cliffHz) / cliffHz;
      expect(distance).toBeGreaterThan(0.15);
    }
  });

  it("refuses aim assist on an attached beam", () => {
    // A12. An attached beam re-derives its origin and angle from the owner's pose every tick, so it
    // would snap to the lock at birth and immediately re-weld to the car's nose. Dormant until the
    // first beam row ships, and written now rather than then: making an attached beam track the
    // lock every tick is a far stronger weapon than its numbers suggest, and not a decision anyone
    // should make implicitly.
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (def.kind !== "beam" || !def.attached) continue;
      expect(def.usesAimAssist).toBe(false);
    }
  });
});
