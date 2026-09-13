import { describe, expect, it } from "vitest";
import {
  arenaFloorKey,
  carSpriteKey,
  loadsEveryArena,
  shouldLoadAssetKey,
  weaponIconKey,
} from "./asset-keys.js";

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

describe("shouldLoadAssetKey", () => {
  it("loads everything outside the arena namespace", () => {
    expect(shouldLoadAssetKey("car.mirage", "arena-01")).toBe(true);
    expect(shouldLoadAssetKey("powerup.boost", "arena-01")).toBe(true);
  });

  it("loads the active arena's art", () => {
    expect(shouldLoadAssetKey("arena.arena-01.floor", "arena-01")).toBe(true);
  });

  it("skips another arena's art", () => {
    expect(shouldLoadAssetKey("arena.arena-02.floor", "arena-01")).toBe(false);
  });

  it("always loads shared arena art", () => {
    expect(shouldLoadAssetKey("arena.common.wall", "arena-01")).toBe(true);
  });

  it("loads a malformed arena key rather than silently dropping it", () => {
    expect(shouldLoadAssetKey("arena.", "arena-01")).toBe(true);
  });

  it("loads another arena's art when every arena is requested", () => {
    expect(shouldLoadAssetKey("arena.arena-02.floor", "arena-01", true)).toBe(true);
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

  it("produces a key the active arena loads and an inactive one does not", () => {
    expect(shouldLoadAssetKey(arenaFloorKey("arena-01"), "arena-01")).toBe(true);
    expect(shouldLoadAssetKey(arenaFloorKey("arena-02"), "arena-01")).toBe(false);
  });
});
