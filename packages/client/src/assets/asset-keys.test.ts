import { describe, expect, it } from "vitest";
import { carSpriteKey, shouldLoadAssetKey, weaponIconKey } from "./asset-keys.js";

describe("carSpriteKey", () => {
  it("namespaces a known car id", () => {
    expect(carSpriteKey("hexagon")).toBe("car.hexagon");
    expect(carSpriteKey("oval")).toBe("car.oval");
  });

  it("falls back to the default chassis for anything unrecognised", () => {
    expect(carSpriteKey("bogus")).toBe("car.rectangle");
    expect(carSpriteKey("")).toBe("car.rectangle");
  });

  it("does not treat inherited object properties as car ids", () => {
    expect(carSpriteKey("constructor")).toBe("car.rectangle");
    expect(carSpriteKey("toString")).toBe("car.rectangle");
  });
});

describe("weaponIconKey", () => {
  it("namespaces a weapon id", () => {
    expect(weaponIconKey("fireball")).toBe("weapon-icon.fireball");
    expect(weaponIconKey("repeater")).toBe("weapon-icon.repeater");
  });
});

describe("shouldLoadAssetKey", () => {
  it("loads everything outside the arena namespace", () => {
    expect(shouldLoadAssetKey("car.rectangle", "arena-01")).toBe(true);
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
});
