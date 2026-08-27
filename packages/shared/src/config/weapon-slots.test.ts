import { afterEach, describe, expect, it, vi } from "vitest";
import { CAR_TABLE } from "./car-config.js";
import { WEAPON_SLOT_CONFIG, slotsOf, slotsFrom } from "./weapon-slots.js";

afterEach(() => vi.restoreAllMocks());

describe("loadouts", () => {
  it("gives every car at least one weapon and no more than the slot limit", () => {
    for (const car of Object.values(CAR_TABLE)) {
      expect(car.weapons.length).toBeGreaterThanOrEqual(1);
      expect(car.weapons.length).toBeLessThanOrEqual(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    }
  });

  it("ships all three cars carrying the migrated cannon in slot 1", () => {
    expect(CAR_TABLE.rectangle.weapons).toEqual(["cannon"]);
    expect(CAR_TABLE.oval.weapons).toEqual(["cannon"]);
    expect(CAR_TABLE.hexagon.weapons).toEqual(["cannon"]);
  });

  it("returns the car's list in slot order", () => {
    expect(slotsOf("hexagon")).toEqual(["cannon"]);
  });

  it("truncates an over-long loadout to the slot limit and warns once, naming the car", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const over = ["cannon", "cannon", "cannon", "cannon"] as const;

    const first = slotsFrom("hexagon", over);
    const second = slotsFrom("hexagon", over);

    expect(first).toHaveLength(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    expect(second).toHaveLength(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    expect(warn).toHaveBeenCalledTimes(1); // once per car, not once per call
    expect(warn.mock.calls[0]![0]).toContain("hexagon");
  });

  it("does not warn for a loadout inside the limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    slotsFrom("oval", ["cannon"]);
    expect(warn).not.toHaveBeenCalled();
  });
});
