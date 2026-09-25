import { beforeEach, describe, expect, it } from "vitest";
import type { ArenaState } from "@motor-combat-moba/shared";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { TEAM_HUD } from "./hud.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const state = (matchEndsTick: number) => ({ matchEndsTick }) as unknown as ArenaState;

describe("TEAM_HUD", () => {
  it("carries today's TEAM lobby card copy", () => {
    expect(TEAM_HUD.lobbyCard()).toEqual({
      kicker: "Team",
      body: "Two teams, shared victory. Last team with a car standing wins.",
      meta: ["2v2 – 3v3", "Last team standing"],
    });
  });

  it("has no clock, since Team brawl has no match clock", () => {
    expect(TEAM_HUD.clockLabel(state(0), 100)).toBe("");
  });

  it("carries no kills column", () => {
    expect(TEAM_HUD.showsKills).toBe(false);
  });

  it("has no results line", () => {
    expect(TEAM_HUD.resultsLine({} as never, "p1")).toBeUndefined();
  });
});
