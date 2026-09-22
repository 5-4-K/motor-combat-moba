// Proves the ~22 existing config accessors read the SCOPED bundle (`withMode`) rather than a
// module-level global. Adapted from the task-3 brief's sketch: the brief's `hpOf` case named a
// `baseHp` field that does not exist on `CombatConfig` (only `hpPerRating` does), so this version
// drives the same assertion — hpOf tracks the scoped `combat` table, not a global — through the
// real field instead.
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { driveOf, hpOf } from "../config/car-config.js";
import { weaponDefOf } from "../config/weapon-config.js";
import { assembleModeConfig } from "./build.js";
import { BRAWL_TABLES } from "./brawl/index.js";
import { withMode } from "./active.js";

describe("existing accessors read the active bundle", () => {
  it("driveOf reflects the scoped mode, not a module global", () => {
    const fast = assembleModeConfig(GameMode.FFA_DEATHMATCH, {
      ...BRAWL_TABLES,
      drive: { ...BRAWL_TABLES.drive, baseMaxSpeed: 999, speedPerRating: 0 },
    });
    withMode(fast, () => expect(driveOf("mirage").maxSpeed).toBe(999));
  });

  it("weaponDefOf reflects the scoped mode", () => {
    const buffed = assembleModeConfig(GameMode.FFA_DEATHMATCH, {
      ...BRAWL_TABLES,
      weapons: { ...BRAWL_TABLES.weapons,
        predator: { ...BRAWL_TABLES.weapons.predator, damage: 777 } },
    });
    withMode(buffed, () => expect(weaponDefOf("predator").damage).toBe(777));
  });

  it("hpOf reflects the scoped mode", () => {
    const tanky = assembleModeConfig(GameMode.FFA_DEATHMATCH, {
      ...BRAWL_TABLES,
      combat: { ...BRAWL_TABLES.combat, hpPerRating: 1000 },
    });
    // bastion's `hp` rating is 90 — see CAR_TABLE in config/car-config.ts.
    withMode(tanky, () => expect(hpOf("bastion")).toBe(90000));
  });
});
