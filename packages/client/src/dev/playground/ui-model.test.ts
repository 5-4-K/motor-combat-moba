import { describe, expect, it } from "vitest";
import { CAR_TABLE, WEAPON_TABLE, ARENAS } from "@motor-combat-moba/shared";
import type { CarId, WeaponId } from "@motor-combat-moba/shared";
import { arenaOptions, carOptions, isLoadoutLegal, pauseKeyAction, weaponOptions } from "./ui-model.js";

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
