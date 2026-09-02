import { describe, expect, it } from "vitest";
import { CAR_TABLE, WEAPON_TABLE, ARENAS, defaultPlaygroundSetup } from "@motor-combat-moba/shared";
import type { CarId, PlaygroundSetup, TunableField, WeaponId } from "@motor-combat-moba/shared";
import {
  arenaOptions,
  canStep,
  carOptions,
  isAtShipped,
  isLoadoutLegal,
  pauseKeyAction,
  shippedLoadoutOf,
  statsTabs,
  steppedValue,
  weaponOptions,
} from "./ui-model.js";

describe("pauseKeyAction", () => {
  it("toggles pause when the overlay is hidden and focus is plain", () => {
    expect(pauseKeyAction("hidden", "BODY")).toBe("toggle");
  });

  it("toggles pause when the menu is up and focus is plain", () => {
    expect(pauseKeyAction("menu", "BODY")).toBe("toggle");
  });

  it("goes back to the menu when settings is up, without unpausing", () => {
    expect(pauseKeyAction("settings", "BODY")).toBe("back-to-menu");
  });

  it("ignores the keystroke when focus is in a form control, regardless of view", () => {
    expect(pauseKeyAction("menu", "INPUT")).toBe("ignore");
    expect(pauseKeyAction("hidden", "INPUT")).toBe("ignore");
    expect(pauseKeyAction("settings", "INPUT")).toBe("ignore");
    expect(pauseKeyAction("menu", "SELECT")).toBe("ignore");
    expect(pauseKeyAction("menu", "TEXTAREA")).toBe("ignore");
  });

  it("is case-insensitive on the tag name", () => {
    expect(pauseKeyAction("hidden", "input")).toBe("ignore");
    expect(pauseKeyAction("hidden", "body")).toBe("toggle");
  });
});

describe("carOptions", () => {
  it("lists every row of CAR_TABLE, isActive ignored (PG18)", () => {
    const options = carOptions();
    const expectedIds = Object.keys(CAR_TABLE) as CarId[];
    expect(options.map((o) => o.id).sort()).toEqual([...expectedIds].sort());
    for (const id of expectedIds) {
      const row = CAR_TABLE[id];
      const option = options.find((o) => o.id === id);
      expect(option?.name).toBe(row.name);
    }
  });
});

describe("weaponOptions", () => {
  it("lists every row of WEAPON_TABLE", () => {
    const options = weaponOptions();
    const expectedIds = Object.keys(WEAPON_TABLE) as WeaponId[];
    expect(options.map((o) => o.id).sort()).toEqual([...expectedIds].sort());
    for (const id of expectedIds) {
      const row = WEAPON_TABLE[id];
      const option = options.find((o) => o.id === id);
      expect(option?.name).toBe(row.name);
    }
  });
});

describe("arenaOptions", () => {
  it("is Object.keys(ARENAS)", () => {
    expect(arenaOptions()).toEqual(Object.keys(ARENAS));
  });
});

describe("isLoadoutLegal", () => {
  it("accepts three distinct weapon ids", () => {
    expect(isLoadoutLegal(["predator", "thunderclap", "afterburner"])).toBe(true);
  });

  it("rejects a duplicate within the three slots", () => {
    expect(isLoadoutLegal(["predator", "predator", "afterburner"])).toBe(false);
  });

  it("rejects short arrays", () => {
    expect(isLoadoutLegal([])).toBe(false);
    expect(isLoadoutLegal(["predator"])).toBe(false);
    expect(isLoadoutLegal(["predator", "afterburner"])).toBe(false);
  });

  it("rejects arrays longer than three", () => {
    expect(isLoadoutLegal(["predator", "thunderclap", "afterburner", "lance"])).toBe(false);
  });
});

describe("statsTabs (PG35)", () => {
  /** Both cars on different chassis with their own shipped kits — the ordinary case. */
  function twoCarSetup(): PlaygroundSetup {
    return {
      ...defaultPlaygroundSetup(),
      me: { carId: "bastion" as CarId, colorId: 0, weapons: ["thumper", "roadblock", "wildcharge"] as [WeaponId, WeaponId, WeaponId] },
      opponent: { carId: "mirage" as CarId, colorId: 1, weapons: ["predator", "thunderclap", "afterburner"] as [WeaponId, WeaponId, WeaponId] },
    };
  }

  it("returns the three tabs, always in global/cars/weapons order", () => {
    expect(statsTabs(twoCarSetup()).map((t) => t.key)).toEqual(["global", "cars", "weapons"]);
  });

  it("puts drive, ram and combat rows under global, in one group", () => {
    const global = statsTabs(twoCarSetup())[0]!;
    expect(global.groups).toHaveLength(1);
    expect(global.groups[0]!.fields.length).toBeGreaterThan(0);
    for (const field of global.groups[0]!.fields) {
      expect(["drive", "ram", "combat"]).toContain(field.group);
    }
  });

  it("gives each SELECTED chassis its own group under cars, and no other chassis", () => {
    const cars = statsTabs(twoCarSetup())[1]!;
    expect(cars.groups.map((g) => g.title)).toEqual([CAR_TABLE.bastion.name, CAR_TABLE.mirage.name]);
    for (const group of cars.groups) {
      for (const field of group.fields) expect(field.group).toBe("car");
    }
  });

  it("gives each SELECTED weapon its own group under weapons, and no other weapon", () => {
    const weapons = statsTabs(twoCarSetup())[2]!;
    expect(weapons.groups.map((g) => g.title)).toEqual([
      WEAPON_TABLE.thumper.name,
      WEAPON_TABLE.roadblock.name,
      WEAPON_TABLE.wildcharge.name,
      WEAPON_TABLE.predator.name,
      WEAPON_TABLE.thunderclap.name,
      WEAPON_TABLE.afterburner.name,
    ]);
  });

  it("dedupes a chassis and a weapon both cars picked", () => {
    const same = defaultPlaygroundSetup(); // both cars are the default chassis with one kit
    const tabs = statsTabs(same);
    expect(tabs[1]!.groups).toHaveLength(1);
    expect(tabs[2]!.groups).toHaveLength(3);
  });

  it("keeps a tab present with an empty group list rather than dropping it", () => {
    // The tab bar's shape must not change under the pointer, so every key is always returned.
    const tabs = statsTabs(twoCarSetup());
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) expect(Array.isArray(tab.groups)).toBe(true);
  });
});

describe("canStep / steppedValue (PG36)", () => {
  const field: TunableField = {
    path: "drive.baseMaxSpeed",
    group: "drive",
    label: "baseMaxSpeed",
    kind: "number",
    shipped: 135,
    min: 0,
    max: 405,
    step: 4.05,
  } as TunableField;

  it("steps up and down by exactly one step", () => {
    expect(steppedValue(field, 100, 1)).toBeCloseTo(104.05, 6);
    expect(steppedValue(field, 100, -1)).toBeCloseTo(95.95, 6);
  });

  it("clamps at both ends instead of running past them", () => {
    expect(steppedValue(field, 404, 1)).toBe(405);
    expect(steppedValue(field, 405, 1)).toBe(405);
    expect(steppedValue(field, 1, -1)).toBe(0);
    expect(steppedValue(field, 0, -1)).toBe(0);
  });

  it("is a round trip up then down away from the clamps", () => {
    expect(steppedValue(field, steppedValue(field, 200, 1), -1)).toBeCloseTo(200, 6);
  });

  it("refuses to step a field with no grid, returning the value unchanged", () => {
    const enumField = { ...field, kind: "enum", min: undefined, max: undefined, step: undefined } as TunableField;
    expect(canStep(enumField)).toBe(false);
    expect(steppedValue(enumField, 100, 1)).toBe(100);
    expect(canStep(field)).toBe(true);
  });
});

describe("shippedLoadoutOf (PG34)", () => {
  it("returns the chassis's own kit from the roster", () => {
    expect(shippedLoadoutOf("bastion" as CarId)).toEqual(CAR_TABLE.bastion.weapons);
  });

  it("returns a three-weapon kit for every chassis on today's roster", () => {
    // The `undefined` branch has no chassis to exercise today; it is what stops a FUTURE chassis
    // with a short or duplicated kit from producing a loadout the validator rejects.
    for (const carId of Object.keys(CAR_TABLE) as CarId[]) {
      expect(shippedLoadoutOf(carId)).toHaveLength(3);
    }
  });
});

describe("isAtShipped", () => {
  /** shipped=34 does not land on the min=0/step=1.2 grid (34 / 1.2 = 28.33), mirroring the real
   * `numberRange` shape (`step = max/100`) that put most numeric fields off their own grid. */
  const offGridField: TunableField = {
    path: "test.offGrid",
    group: "combat",
    label: "offGrid",
    kind: "number",
    shipped: 34,
    min: 0,
    max: 100,
    step: 1.2,
  };

  /** A car rating: shipped is always an integer on an integer (`step: 1`) grid, so the slider can
   * land exactly on it. */
  const onGridField: TunableField = {
    path: "test.onGrid",
    group: "car",
    ownerId: "mirage",
    label: "speed",
    kind: "number",
    shipped: 88,
    min: 0,
    max: 100,
    step: 1,
  };

  const boolField: TunableField = {
    path: "test.bool",
    group: "combat",
    label: "bool",
    kind: "boolean",
    shipped: true,
  };

  it("treats an off-grid shipped value's nearest reachable grid point as shipped", () => {
    expect(isAtShipped(offGridField, 34)).toBe(true); // exact
    expect(isAtShipped(offGridField, 33.6)).toBe(true); // nearest grid point below, diff 0.4 < step/2 (0.6)
    expect(isAtShipped(offGridField, 34.8)).toBe(false); // next grid point up, diff 0.8 >= step/2
    expect(isAtShipped(offGridField, 60)).toBe(false); // an unambiguous real override
  });

  it("keeps strict-enough tolerance for an on-grid rating -- a neighboring integer is a real override", () => {
    expect(isAtShipped(onGridField, 88)).toBe(true);
    expect(isAtShipped(onGridField, 87)).toBe(false);
    expect(isAtShipped(onGridField, 89)).toBe(false);
  });

  it("keeps boolean fields strictly equal, with no tolerance", () => {
    expect(isAtShipped(boolField, true)).toBe(true);
    expect(isAtShipped(boolField, false)).toBe(false);
  });
});
