import { afterEach, describe, expect, it, vi } from "vitest";
import { CAR_TABLE } from "./car-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import { WEAPON_SLOT_CONFIG, slotsOf, slotsFrom } from "./weapon-slots.js";

afterEach(() => vi.restoreAllMocks());

describe("loadouts", () => {
  it("gives every car at least one weapon and no more than the slot limit", () => {
    for (const car of Object.values(CAR_TABLE)) {
      expect(car.weapons.length).toBeGreaterThanOrEqual(1);
      expect(car.weapons.length).toBeLessThanOrEqual(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    }
  });

  it("gives each chassis its own exclusive three-weapon kit", () => {
    expect(CAR_TABLE.mirage.weapons).toEqual(["fireball", "pepperbox", "afterburner"]);
    expect(CAR_TABLE.bullseye.weapons).toEqual(["needler", "skewer", "lance"]);
    expect(CAR_TABLE.bastion.weapons).toEqual(["thumper", "shockwave", "bulwark"]);
  });

  it("shares no weapon between two chassis, so car select is a real choice", () => {
    // L1. Exclusivity is the point of having three chassis: a shared opener would drag all three
    // toward the same early-fight rhythm.
    const all = Object.values(CAR_TABLE).flatMap((car) => [...car.weapons]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("puts every weapon in the table on exactly one chassis", () => {
    const carried = new Set(Object.values(CAR_TABLE).flatMap((car) => [...car.weapons]));
    expect(carried.size).toBe(Object.keys(WEAPON_TABLE).length);
  });

  it("returns the car's list in slot order", () => {
    expect(slotsOf("bastion")).toEqual(["thumper", "shockwave", "bulwark"]);
  });

  it("truncates an over-long loadout to the slot limit and warns once, naming the car", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const over = ["fireball", "fireball", "fireball", "fireball"] as const;

    const first = slotsFrom("bastion", over);
    const second = slotsFrom("bastion", over);

    expect(first).toHaveLength(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    expect(second).toHaveLength(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    expect(warn).toHaveBeenCalledTimes(1); // once per car, not once per call
    expect(warn.mock.calls[0]![0]).toContain("bastion");
  });

  it("does not warn for a loadout inside the limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    slotsFrom("bullseye", ["fireball"]);
    expect(warn).not.toHaveBeenCalled();
  });
});
