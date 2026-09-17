import { afterEach, describe, expect, it, vi } from "vitest";
import { CAR_TABLE, basicAttackOf } from "./car-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import { WEAPON_SLOT_CONFIG, slotsOf, slotsFrom } from "./weapon-slots.js";

afterEach(() => vi.restoreAllMocks());

describe("loadouts", () => {
  it("gives every ACTIVE car at least one weapon, and no car more than the slot limit", () => {
    // The floor is an ACTIVE-car rule, not a roster-wide one. An inactive car may carry nothing at
    // all: that is the shape a chassis is prototyped in, driven in the playground to judge its
    // handling long before anyone has authored the three exclusive weapons it will eventually ship
    // with. A car a player can actually select must be able to fight, so the floor applies the
    // moment `isActive` flips true.
    for (const car of Object.values(CAR_TABLE)) {
      if (car.isActive) expect(car.weapons.length).toBeGreaterThanOrEqual(1);
      expect(car.weapons.length).toBeLessThanOrEqual(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    }
  });

  it("gives each chassis the kit its type calls for", () => {
    expect(CAR_TABLE.bullseye.weapons).toEqual(["predator", "pepperbox", "lance"]);
    expect(CAR_TABLE.mirage.weapons).toEqual(["magmablast", "thunderclap", "afterburner"]);
    expect(CAR_TABLE.bastion.weapons).toEqual(["thumper", "roadblock", "wildcharge"]);
  });

  it("shares no weapon between two chassis, active or not, so car select is a real choice", () => {
    // L1. Exclusivity is the point of having three chassis: a shared opener would drag all three
    // toward the same early-fight rhythm.
    //
    // Deliberately UNCONDITIONAL — it covers inactive rows too, and that is the whole reason the
    // rule above lets a prototype carry nothing. The alternative (scope L1 to active cars, let a
    // prototype borrow a shipped kit) moves the split to the worst possible moment: activating a
    // car would fail the suite for a reason unrelated to the edit that activated it. Borrow
    // nothing, author your own, and `isActive: true` is then a one-field change.
    const all = Object.values(CAR_TABLE).flatMap((car) => [...car.weapons]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("lets a weapon exist with no chassis carrying it", () => {
    // A `WEAPON_TABLE` row owned by nobody is legal and expected: `tremor` is authored and
    // uncarried today, and a chassis in development needs its weapons to exist in the table before
    // its kit is assembled. This used to be a whitelist (`UNCARRIED = ["tremor"]`) asserting an
    // exact carried-row count, which made every new weapon a two-file edit and made "author the
    // weapons first, wire the kit second" impossible.
    //
    // The guard that whitelist doubled as — a weapon silently dropped from a shipped kit — is NOT
    // lost: "gives each chassis the kit its type calls for" above pins all three shipped loadouts
    // element by element, which catches a dropped weapon more precisely than a count ever did.
    const carried = new Set(Object.values(CAR_TABLE).flatMap((car) => [...car.weapons]));
    expect(carried.size).toBeLessThanOrEqual(Object.keys(WEAPON_TABLE).length);
    for (const id of carried) expect(WEAPON_TABLE).toHaveProperty(id);
  });

  it("returns the car's list in slot order", () => {
    expect(slotsOf("bastion")).toEqual(["thumper", "roadblock", "wildcharge"]);
  });

  it("truncates an over-long loadout to the slot limit and warns once, naming the car", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const over = ["magmablast", "magmablast", "magmablast", "magmablast"] as const;

    const first = slotsFrom("bastion", over);
    const second = slotsFrom("bastion", over);

    expect(first).toHaveLength(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    expect(second).toHaveLength(WEAPON_SLOT_CONFIG.maxWeaponSlots);
    expect(warn).toHaveBeenCalledTimes(1); // once per car, not once per call
    expect(warn.mock.calls[0]![0]).toContain("bastion");
  });

  it("does not warn for a loadout inside the limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    slotsFrom("bullseye", ["magmablast"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("gives every chassis a basic attack named after it, shipped or not (BA2, BA9)", () => {
    for (const car of Object.values(CAR_TABLE)) {
      expect(basicAttackOf(car.id), car.id).toBe(`basic-attack-${car.id}`);
      expect(WEAPON_TABLE, car.id).toHaveProperty(basicAttackOf(car.id));
    }
  });

  it("keeps the basic attack out of the chassis's own kit (BA10)", () => {
    // `weapons` means the three ABILITY slots and nothing else. A basic attack leaking into it
    // would double-arm the car and put a fourth box in the HUD.
    for (const car of Object.values(CAR_TABLE)) {
      expect(car.weapons, car.id).not.toContain(basicAttackOf(car.id));
      for (const weaponId of car.weapons) expect(weaponId.startsWith("basic-attack-"), car.id).toBe(false);
    }
  });
});
