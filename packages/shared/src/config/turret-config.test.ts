import { beforeEach, describe, expect, it } from "vitest";
import { installMode, slots } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { GameMode, TICK_RATE_HZ } from "../constants.js";
import { CAR_TABLE, activeCarIds, basicAttackIds, turretMountOf } from "./car-config.js";
import { carHasTurretWeapon } from "../sim/weapons/turret.js";
import { fireSlotsOf } from "./weapon-slots.js";
import { TURRET_CONFIG, TURRET_TICKS, resolveTurretTicks } from "./turret-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";

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

  it("ships the turret on the basic attacks plus the chosen turret-aimed abilities (TR4)", () => {
    const turretIds = Object.values(WEAPON_TABLE).filter((d) => d.turret).map((d) => d.id).sort();
    // The basic attacks all carry a turret (so they COULD be turret-aimed if ever switched on),
    // plus the deliberately turret-aimed ability weapons: each active chassis's slot-1 weapon
    // (`predator`/`magmablast`/`thumper`/`fury-horn`) and `roadblock`. `basicAttackIds()` reads
    // `CAR_TABLE` rather than a naming convention. This row is where any OTHER weapon quietly
    // gaining a turret would be caught.
    const basics = [...basicAttackIds()];
    const turretAbilities = ["predator", "magmablast", "thumper", "fury-horn", "roadblock"];
    expect(turretIds).toEqual([...basics, ...turretAbilities].sort());
  });

  it("gives every active chassis a live turret through a carried ability, basic attack off (TR53)", () => {
    // The posture decoupled the turret from the basic attack: the basic attack is off in every mode,
    // yet every active chassis still draws a turret, captures the pointer and shows the crosshair,
    // because each carries at least one turret ability weapon (its slot-1 weapon, plus roadblock on
    // Bastion). Asserted over the real roster — `carHasTurretWeapon` skips the disabled slot 0 and
    // still finds a turret on an ability slot.
    expect(slots().basicAttackEnabled).toBe(false);
    for (const carId of activeCarIds()) {
      expect(carHasTurretWeapon(fireSlotsOf(carId)), carId).toBe(true);
    }
  });

  it("ships the turret visible in the base, and a hidden turret resolves to an instant turn", () => {
    expect(TURRET_CONFIG.visible).toBe(true);
    expect(resolveTurretTicks({ ...TURRET_CONFIG, visible: false }).turnPerTick).toBe(Number.POSITIVE_INFINITY);
  });

  it("hides the turret in Brawl alone (the seed for trying the feel)", () => {
    for (const mode of [GameMode.FFA_LAST_STANDING, GameMode.TEAM, GameMode.FFA_DEATHMATCH, GameMode.CONQUER]) {
      expect(modeConfigOf(mode).turret.visible, GameMode[mode]).toBe(mode !== GameMode.FFA_LAST_STANDING);
    }
  });

  it("gives every chassis a mount, and an unknown id the centre (TR5)", () => {
    for (const car of Object.values(CAR_TABLE)) expect(car.turretMount).toEqual({ x: 0, y: 0 });
    expect(turretMountOf("not-a-car")).toEqual({ x: 0, y: 0 });
  });
});
