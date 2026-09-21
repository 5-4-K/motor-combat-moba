import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { CAR_TABLE, basicAttackIds, turretMountOf } from "./car-config.js";
import { TURRET_CONFIG, TURRET_TICKS } from "./turret-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";

describe("turret config (TR1-TR5)", () => {
  it("turns at the configured rate, converted once to radians per tick", () => {
    expect(TURRET_TICKS.turnPerTick).toBeCloseTo(
      (TURRET_CONFIG.turnRateDegPerSec * Math.PI) / 180 / TICK_RATE_HZ,
      12,
    );
  });

  it("puts `turret` only on single-muzzle projectile rows with a finite, non-negative offset (TR3)", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      if (!def.turret) continue;
      expect(def.kind, `${def.id} carries turret`).toBe("projectile");
      expect(def.muzzles, `${def.id} carries turret with muzzles`).toBeUndefined();
      expect(Number.isFinite(def.turret.additionalOffset) && def.turret.additionalOffset >= 0, def.id).toBe(true);
    }
  });

  it("ships the turret on exactly the basic attacks, predator, magmablast and thumper (TR4)", () => {
    const turretIds = Object.values(WEAPON_TABLE).filter((d) => d.turret).map((d) => d.id).sort();
    // The one honest way to ask "is this weapon a basic attack" is the slot, not the id (final-fixes
    // item 8) — `basicAttackIds()` reads `CAR_TABLE`, never a naming convention this table happens
    // to follow today.
    const basics = [...basicAttackIds()];
    expect(turretIds).toEqual([...basics, "magmablast", "predator", "thumper"].sort());
  });

  it("gives every chassis a mount, and an unknown id the centre (TR5)", () => {
    for (const car of Object.values(CAR_TABLE)) expect(car.turretMount).toEqual({ x: 0, y: 0 });
    expect(turretMountOf("not-a-car")).toEqual({ x: 0, y: 0 });
  });
});
