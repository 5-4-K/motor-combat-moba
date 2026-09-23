import { beforeEach, describe, expect, it } from "vitest";
import {
  activeArenaIds,
  DEFAULT_GAME_MODE,
  MODE_TABLE,
  installMode,
  modeConfigOf,
} from "@motor-combat-moba/shared";
import {
  arenaFloorKey,
  carSpriteKey,
  loadsEveryArena,
  shouldLoadAssetKey,
  turretSpriteKeys,
  weaponIconKey,
} from "./asset-keys.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

describe("carSpriteKey", () => {
  it("namespaces a known car id", () => {
    expect(carSpriteKey("bastion")).toBe("car.bastion");
    expect(carSpriteKey("bullseye")).toBe("car.bullseye");
  });

  it("falls back to the default chassis for anything unrecognised", () => {
    expect(carSpriteKey("bogus")).toBe("car.mirage");
    expect(carSpriteKey("")).toBe("car.mirage");
  });

  it("does not treat inherited object properties as car ids", () => {
    expect(carSpriteKey("constructor")).toBe("car.mirage");
    expect(carSpriteKey("toString")).toBe("car.mirage");
  });
});

describe("weaponIconKey", () => {
  it("namespaces a weapon id", () => {
    expect(weaponIconKey("fireball")).toBe("weapon-icon.fireball");
    expect(weaponIconKey("needler")).toBe("weapon-icon.needler");
  });
});

describe("turretSpriteKeys", () => {
  it("tries a car's own turret first, then the shared default", () => {
    expect(turretSpriteKeys("mirage")).toEqual(["turret.mirage", "turret.default"]);
  });

  it("keeps the resolution order for an unrecognised id, since turret.default still catches it", () => {
    expect(turretSpriteKeys("bogus")).toEqual(["turret.bogus", "turret.default"]);
  });
});

describe("shouldLoadAssetKey", () => {
  it("loads everything outside the arena namespace", () => {
    expect(shouldLoadAssetKey("car.mirage", ["arena-01"])).toBe(true);
    expect(shouldLoadAssetKey("powerup.boost", ["arena-01"])).toBe(true);
  });

  it("loads an arena in the given list", () => {
    expect(shouldLoadAssetKey("arena.arena-01.floor", ["arena-01"])).toBe(true);
  });

  it("skips an arena outside the given list", () => {
    expect(shouldLoadAssetKey("arena.arena-02.floor", ["arena-01"])).toBe(false);
  });

  it("always loads shared arena art", () => {
    expect(shouldLoadAssetKey("arena.common.wall", ["arena-01"])).toBe(true);
  });

  it("loads a malformed arena key rather than silently dropping it", () => {
    expect(shouldLoadAssetKey("arena.", ["arena-01"])).toBe(true);
  });

  it("loads another arena's art when every arena is requested", () => {
    expect(shouldLoadAssetKey("arena.arena-02.floor", ["arena-01"], true)).toBe(true);
  });

  it("loads art for every active mode's arenas, not just one (MC24)", () => {
    // Feeding `activeArenaIds()` as BOTH the key source and the filter would only re-test
    // `Array.includes` — it passes vacuously on an empty union and cannot fail if `BootScene`
    // reverts to a single id. So: pin that the union is genuinely wider than one arena, and check
    // containment PER MODE, against each mode's own authored list rather than against the union it
    // was derived from.
    const union = activeArenaIds();
    expect(union.length).toBeGreaterThan(1);

    const activeModes = Object.values(MODE_TABLE).filter((mode) => mode.isActive);
    expect(activeModes.length).toBeGreaterThan(0);
    for (const mode of activeModes) {
      const arenas = modeConfigOf(mode.id).arenas;
      expect(arenas.length).toBeGreaterThan(0);
      for (const id of arenas) {
        expect(union).toContain(id);
        expect(shouldLoadAssetKey(`arena.${id}.floor`, union, false)).toBe(true);
      }
    }
  });

  it("still skips an arena outside the union, proving the list is a filter and not a pass-through", () => {
    // arena-03 carries no `MODE_TABLE` entry today — it must never appear inside `activeArenaIds()`,
    // and this assertion is what would catch a filter that quietly accepts everything.
    expect(activeArenaIds()).not.toContain("arena-03");
    expect(shouldLoadAssetKey("arena.arena-03.floor", activeArenaIds())).toBe(false);
  });
});

describe("loadsEveryArena", () => {
  it("loads every arena for the playground, whose settings panel switches arenas live", () => {
    expect(loadsEveryArena("playground")).toBe(true);
  });

  it("keeps the active-arena filter for ordinary play and every other tool", () => {
    expect(loadsEveryArena(undefined)).toBe(false);
    expect(loadsEveryArena("assets")).toBe(false);
  });
});

describe("arenaFloorKey", () => {
  it("namespaces by arena so the release pruner can find it", () => {
    expect(arenaFloorKey("arena-01")).toBe("arena.arena-01.floor");
  });

  it("produces a key an arena in the list loads and one outside it does not", () => {
    expect(shouldLoadAssetKey(arenaFloorKey("arena-01"), ["arena-01"])).toBe(true);
    expect(shouldLoadAssetKey(arenaFloorKey("arena-02"), ["arena-01"])).toBe(false);
  });
});
