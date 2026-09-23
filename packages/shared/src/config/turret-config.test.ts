import { beforeEach, describe, expect, it } from "vitest";
import { installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { TICK_RATE_HZ } from "../constants.js";
import { CAR_TABLE, activeCarIds, basicAttackIds, turretMountOf } from "./car-config.js";
import { carHasTurretWeapon } from "../sim/weapons/turret.js";
import { fireSlotsOf } from "./weapon-slots.js";
import { TURRET_CONFIG, TURRET_TICKS } from "./turret-config.js";
import { BASIC_ATTACK_CONFIG, WEAPON_TABLE } from "./weapon-config.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

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

  it("ships the turret on exactly the basic attacks and nothing else (TR4)", () => {
    const turretIds = Object.values(WEAPON_TABLE).filter((d) => d.turret).map((d) => d.id).sort();
    // The one honest way to ask "is this weapon a basic attack" is the slot, not the id (final-fixes
    // item 8) — `basicAttackIds()` reads `CAR_TABLE`, never a naming convention this table happens
    // to follow today.
    const basics = [...basicAttackIds()];
    // `predator`, `magmablast` and `thumper` carried a turret on `feature/mouse-aim` and gave it
    // back on `development/main`, alongside `BASIC_ATTACK_CONFIG.enabled` going `false`. That pair
    // of edits is the whole of this build's "no car has a turret" posture, and this row is where a
    // third weapon quietly gaining one would be caught.
    expect(turretIds).toEqual([...basics].sort());
  });

  it("leaves no chassis able to reach a turret at all, which is this build's posture (TR53)", () => {
    // The by-product the two config edits were made FOR: nine turret rows none of which can be
    // pressed, and no turret ability. Every car therefore draws no turret, captures no pointer, and
    // shows no crosshair or turret HUD. Asserted over the real roster rather than trusted from the
    // two edits separately, since it is their CONJUNCTION that produces it.
    expect(BASIC_ATTACK_CONFIG.enabled).toBe(false);
    for (const carId of activeCarIds()) {
      expect(carHasTurretWeapon(fireSlotsOf(carId).map((s) => s.weaponId)), carId).toBe(false);
    }
  });

  it("gives every chassis a mount, and an unknown id the centre (TR5)", () => {
    for (const car of Object.values(CAR_TABLE)) expect(car.turretMount).toEqual({ x: 0, y: 0 });
    expect(turretMountOf("not-a-car")).toEqual({ x: 0, y: 0 });
  });
});
