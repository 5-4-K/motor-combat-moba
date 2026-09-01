import { describe, expect, it } from "vitest";
import { CAR_TABLE, WEAPON_TABLE, ARENAS, defaultPlaygroundSetup } from "@motor-combat-moba/shared";
import type { CarId, PlaygroundSetup, WeaponId } from "@motor-combat-moba/shared";
import {
  arenaOptions,
  carOptions,
  isLoadoutLegal,
  pauseKeyAction,
  sliderGroups,
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

describe("sliderGroups", () => {
  it("gives the default setup one car section (both cars share the default chassis)", () => {
    const setup = defaultPlaygroundSetup();
    const groups = sliderGroups(setup);
    const carGroups = groups.filter((g) => g.fields[0]?.group === "car");
    expect(carGroups).toHaveLength(1);
    expect(carGroups[0]!.title).toBe(CAR_TABLE[setup.me.carId].name);
    expect(carGroups[0]!.fields.every((f) => f.ownerId === setup.me.carId)).toBe(true);
  });

  it("gives two distinct car sections when the two cars pick different chassis", () => {
    const setup = defaultPlaygroundSetup();
    const otherCarId = (Object.keys(CAR_TABLE) as CarId[]).find((id) => id !== setup.me.carId)!;
    const twoChassis: PlaygroundSetup = {
      ...setup,
      opponent: { ...setup.opponent, carId: otherCarId },
    };
    const groups = sliderGroups(twoChassis);
    const carGroups = groups.filter((g) => g.fields[0]?.group === "car");
    expect(carGroups).toHaveLength(2);
    expect(carGroups.map((g) => g.title).sort()).toEqual(
      [CAR_TABLE[setup.me.carId].name, CAR_TABLE[otherCarId].name].sort(),
    );
  });

  it("gives exactly one Global section, covering drive+ram+combat and nothing else", () => {
    const groups = sliderGroups(defaultPlaygroundSetup());
    const globalGroups = groups.filter((g) => g.title === "Global");
    expect(globalGroups).toHaveLength(1);
    const seenGroups = new Set(globalGroups[0]!.fields.map((f) => f.group));
    expect(seenGroups).toEqual(new Set(["drive", "ram", "combat"]));
    expect(globalGroups[0]!.fields.length).toBeGreaterThan(0);
  });

  it("gives a section per selected weapon and none for an unselected one", () => {
    const setup = defaultPlaygroundSetup();
    const selectedWeaponIds = new Set<WeaponId>([...setup.me.weapons, ...setup.opponent.weapons]);
    const groups = sliderGroups(setup);
    const weaponGroups = groups.filter((g) => g.fields[0]?.group === "weapon");
    expect(weaponGroups).toHaveLength(selectedWeaponIds.size);
    const coveredIds = new Set(weaponGroups.map((g) => g.fields[0]!.ownerId));
    expect(coveredIds).toEqual(selectedWeaponIds);

    const unselectedId = (Object.keys(WEAPON_TABLE) as WeaponId[]).find((id) => !selectedWeaponIds.has(id));
    expect(unselectedId).toBeDefined();
    expect(groups.some((g) => g.fields.some((f) => f.ownerId === unselectedId))).toBe(false);
  });

  it("re-derives sections from the setup passed in -- selecting a new weapon adds its section", () => {
    const setup = defaultPlaygroundSetup();
    const notYetSelected = (Object.keys(WEAPON_TABLE) as WeaponId[]).find(
      (id) => !setup.me.weapons.includes(id) && !setup.opponent.weapons.includes(id),
    )!;
    const withNewWeapon: PlaygroundSetup = {
      ...setup,
      opponent: {
        ...setup.opponent,
        weapons: [notYetSelected, setup.opponent.weapons[1], setup.opponent.weapons[2]],
      },
    };
    const groups = sliderGroups(withNewWeapon);
    expect(groups.some((g) => g.fields.some((f) => f.ownerId === notYetSelected))).toBe(true);
  });
});
