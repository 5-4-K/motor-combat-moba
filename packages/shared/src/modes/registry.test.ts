import { describe, expect, it, vi } from "vitest";
import { GameMode } from "../constants.js";
import {
  DEFAULT_GAME_MODE,
  MODE_TABLE,
  activeGameModes,
  isActiveGameMode,
  isGameMode,
  modeConfigOf,
  modeConfigOrDefault,
} from "./registry.js";

describe("MODE_TABLE", () => {
  it("carries a bundle for every mode", () => {
    for (const def of Object.values(MODE_TABLE)) {
      expect(def.config.id).toBe(def.id);
    }
  });

  it("hides an inactive mode from the picker but keeps its bundle reachable", () => {
    expect(activeGameModes()).not.toContain(GameMode.TEAM);
    expect(modeConfigOf(GameMode.TEAM)).toBeDefined();
  });

  it("gives each mode its own bundle object", () => {
    expect(modeConfigOf(GameMode.FFA_LAST_STANDING)).not.toBe(
      modeConfigOf(GameMode.FFA_DEATHMATCH),
    );
  });

  it("has exactly the three GameMode wire values", () => {
    expect(Object.keys(MODE_TABLE).sort()).toEqual(["0", "1", "2"]);
    expect(MODE_TABLE[GameMode.FFA_LAST_STANDING].name).toBe("Brawl");
    expect(MODE_TABLE[GameMode.TEAM].name).toBe("Team brawl");
    expect(MODE_TABLE[GameMode.FFA_DEATHMATCH].name).toBe("Deathmatch");
  });
});

describe("isGameMode", () => {
  it("accepts the three wire values and refuses everything else", () => {
    expect(isGameMode(GameMode.FFA_LAST_STANDING)).toBe(true);
    expect(isGameMode(GameMode.TEAM)).toBe(true);
    expect(isGameMode(GameMode.FFA_DEATHMATCH)).toBe(true);
    expect(isGameMode(3)).toBe(false);
    expect(isGameMode("0")).toBe(false);
    expect(isGameMode(undefined)).toBe(false);
  });
});

describe("isActive", () => {
  it("publishes the two FFA modes; Team brawl is unpublished", () => {
    expect(activeGameModes()).toEqual([GameMode.FFA_LAST_STANDING, GameMode.FFA_DEATHMATCH]);
  });

  it("keeps DEFAULT_GAME_MODE active, so a new lobby always opens on a selectable mode", () => {
    expect(MODE_TABLE[DEFAULT_GAME_MODE].isActive).toBe(true);
  });

  it("isActiveGameMode refuses unknown values and inactive rows", () => {
    expect(isActiveGameMode(GameMode.FFA_LAST_STANDING)).toBe(true);
    expect(isActiveGameMode(GameMode.TEAM)).toBe(false);
    expect(isActiveGameMode(3)).toBe(false);
    expect(isActiveGameMode("0")).toBe(false);
    expect(isActiveGameMode(undefined)).toBe(false);
  });
});

describe("modeConfigOf", () => {
  it("throws on an unknown mode", () => {
    expect(() => modeConfigOf(99 as GameMode)).toThrow();
  });
});

describe("modeConfigOrDefault", () => {
  it("returns DEFAULT_GAME_MODE's bundle for an out-of-range wire byte, without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(modeConfigOrDefault(99)).toBe(MODE_TABLE[DEFAULT_GAME_MODE].config);
    warn.mockRestore();
  });

  it("returns the matching bundle for a known wire value", () => {
    expect(modeConfigOrDefault(GameMode.FFA_DEATHMATCH)).toBe(
      MODE_TABLE[GameMode.FFA_DEATHMATCH].config,
    );
  });
});
