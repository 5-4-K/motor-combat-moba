import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { assembleModeConfig } from "./build.js";
import { LEGACY_TABLES } from "./legacy.js";

describe("assembleModeConfig", () => {
  it("derives the five artifacts the sim reads", () => {
    const config = assembleModeConfig(GameMode.FFA_LAST_STANDING, LEGACY_TABLES);
    expect(Object.keys(config.derived.weaponTicks)).toEqual(Object.keys(LEGACY_TABLES.weapons));
    expect(Object.keys(config.derived.chassisDrive)).toEqual(Object.keys(LEGACY_TABLES.cars));
    expect(config.derived.ramTicks).toBeDefined();
    expect(config.derived.turretTicks).toBeDefined();
  });

  it("deep-freezes the bundle, so nothing can mutate a live mode", () => {
    const config = assembleModeConfig(GameMode.FFA_LAST_STANDING, LEGACY_TABLES);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.drive)).toBe(true);
    expect(Object.isFrozen(config.weapons.predator)).toBe(true);
    expect(Object.isFrozen(config.derived.weaponTicks)).toBe(true);
  });

  it("gives two bundles built from the same tables independent objects", () => {
    const a = assembleModeConfig(GameMode.FFA_LAST_STANDING, LEGACY_TABLES);
    const b = assembleModeConfig(GameMode.FFA_DEATHMATCH, LEGACY_TABLES);
    expect(a.weapons.predator).not.toBe(b.weapons.predator);
    expect(a.weapons.predator).toEqual(b.weapons.predator);
  });
});
