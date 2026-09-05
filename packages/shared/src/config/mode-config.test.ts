import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import {
  DEFAULT_GAME_MODE,
  MODE_TABLE,
  activeGameModes,
  isActiveGameMode,
  isGameMode,
} from "./mode-config.js";

describe("MODE_TABLE", () => {
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
