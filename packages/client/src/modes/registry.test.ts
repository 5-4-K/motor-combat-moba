import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, GameMode, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { hudOf, MODE_HUDS } from "./registry.js";
import { BRAWL_HUD } from "./brawl/hud.js";
import { TEAM_HUD } from "./team-brawl/hud.js";
import { DEATHMATCH_HUD } from "./deathmatch/hud.js";
import { CONQUER_HUD } from "./conquer/hud.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

describe("hudOf", () => {
  it("resolves every published mode to its own HUD", () => {
    expect(hudOf(GameMode.FFA_LAST_STANDING)).toBe(BRAWL_HUD);
    expect(hudOf(GameMode.TEAM)).toBe(TEAM_HUD);
    expect(hudOf(GameMode.FFA_DEATHMATCH)).toBe(DEATHMATCH_HUD);
    expect(hudOf(GameMode.CONQUER)).toBe(CONQUER_HUD);
  });

  it("falls back to the default mode's HUD for an unrecognised byte off the wire", () => {
    expect(hudOf(250)).toBe(MODE_HUDS[DEFAULT_GAME_MODE]);
    expect(hudOf(-1)).toBe(MODE_HUDS[DEFAULT_GAME_MODE]);
  });
});
