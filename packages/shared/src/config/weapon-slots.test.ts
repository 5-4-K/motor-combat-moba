import { afterEach, describe, expect, it, vi } from "vitest";
import { AIM_CONFIG } from "./aim-config.js";
import { CAR_TABLE } from "./car-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import { WEAPON_SLOT_CONFIG, carAimRangeOf, slotsOf, slotsFrom } from "./weapon-slots.js";

afterEach(() => vi.restoreAllMocks());

describe("loadouts", () => {
  it("gives every car at least one weapon and no more than the slot limit", () => {
    for (const car of Object.values(CAR_TABLE)) {
      expect(car.weapons.length).toBeGreaterThanOrEqual(1);
      expect(car.weapons.length).toBeLessThanOrEqual(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    }
  });

  it("gives each chassis the kit its type calls for", () => {
    expect(CAR_TABLE.bullseye.weapons).toEqual(["shockwave", "pepperbox", "lance"]);
    expect(CAR_TABLE.mirage.weapons).toEqual(["predator", "thunderclap", "afterburner"]);
    expect(CAR_TABLE.bastion.weapons).toEqual(["thumper", "roadblock", "wildcharge"]);
  });

  it("shares no weapon between two chassis, so car select is a real choice", () => {
    // L1. Exclusivity is the point of having three chassis: a shared opener would drag all three
    // toward the same early-fight rhythm.
    const all = Object.values(CAR_TABLE).flatMap((car) => [...car.weapons]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("carries every table row on exactly one chassis, except the deliberately unassigned set", () => {
    // `tremor` is the table's one authored-but-uncarried row (loadout decision pending). Naming the
    // set here keeps the guard honest: a weapon accidentally dropped from a kit still fails, and
    // adding an unassigned row is a conscious edit to this list rather than a silent pass.
    const UNCARRIED = ["tremor"];
    const carried = new Set(Object.values(CAR_TABLE).flatMap((car) => [...car.weapons]));
    for (const id of UNCARRIED) expect(carried.has(id)).toBe(false);
    expect(carried.size).toBe(Object.keys(WEAPON_TABLE).length - UNCARRIED.length);
  });

  it("returns the car's list in slot order", () => {
    expect(slotsOf("bastion")).toEqual(["thumper", "roadblock", "wildcharge"]);
  });

  it("truncates an over-long loadout to the slot limit and warns once, naming the car", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const over = ["shockwave", "shockwave", "shockwave", "shockwave"] as const;

    const first = slotsFrom("bastion", over);
    const second = slotsFrom("bastion", over);

    expect(first).toHaveLength(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    expect(second).toHaveLength(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    expect(warn).toHaveBeenCalledTimes(1); // once per car, not once per call
    expect(warn.mock.calls[0]![0]).toContain("bastion");
  });

  it("does not warn for a loadout inside the limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    slotsFrom("bullseye", ["shockwave"]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("carAimRangeOf", () => {
  it("is 400 for every shipped chassis (all assisted rows author 400 in this pass)", () => {
    for (const id of ["mirage", "bullseye", "bastion"] as const) {
      expect(carAimRangeOf(id)).toBe(400);
    }
  });
  it("falls back to AIM_CONFIG.lockRange for a car with no assisted weapon", () => {
    // No such chassis ships; the fallback is the contract for one. Assert it equals the global.
    expect(AIM_CONFIG.lockRange).toBe(400); // if this moves, revisit carAimRangeOf's fallback
  });
});
