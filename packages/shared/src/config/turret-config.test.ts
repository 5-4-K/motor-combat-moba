import { beforeEach, describe, expect, it } from "vitest";
import { installMode, slots, withMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { GameMode, TICK_RATE_HZ } from "../constants.js";
import { CAR_TABLE, activeCarIds, turretMountOf } from "./car-config.js";
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

  it("ships no turret on any weapon row, in the global table or any mode bundle (turret system off)", () => {
    // The turret system is switched off in every mode: the machinery stays (and is tested on a
    // turret-restored bundle, see `turretRestored`), but no shipped row carries `turret`, so every
    // weapon fires from the fixed front muzzle. A row quietly regaining one is caught here.
    expect(Object.values(WEAPON_TABLE).filter((d) => d.turret).map((d) => d.id)).toEqual([]);
    for (const mode of [GameMode.FFA_LAST_STANDING, GameMode.TEAM, GameMode.FFA_DEATHMATCH, GameMode.CONQUER]) {
      const carrying = Object.values(modeConfigOf(mode).weapons).filter((d) => d.turret).map((d) => d.id);
      expect(carrying, GameMode[mode]).toEqual([]);
    }
  });

  it("gives no active chassis a turret weapon in any mode (turret system off)", () => {
    for (const mode of [GameMode.FFA_LAST_STANDING, GameMode.TEAM, GameMode.FFA_DEATHMATCH, GameMode.CONQUER]) {
      withMode(modeConfigOf(mode), () => {
        expect(slots().basicAttackEnabled, GameMode[mode]).toBe(false);
        for (const carId of activeCarIds()) {
          expect(carHasTurretWeapon(fireSlotsOf(carId)), `${GameMode[mode]} ${carId}`).toBe(false);
        }
      });
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
