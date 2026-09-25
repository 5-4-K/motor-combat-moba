import { beforeEach, describe, expect, it } from "vitest";
import type { ArenaState } from "@motor-combat-moba/shared";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { BRAWL_HUD } from "./hud.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const state = (matchEndsTick: number) => ({ matchEndsTick }) as unknown as ArenaState;

describe("BRAWL_HUD", () => {
  it("carries today's FFA_LAST_STANDING lobby card copy", () => {
    expect(BRAWL_HUD.lobbyCard()).toEqual({
      kicker: "Free-for-all",
      body: "Everyone fights everyone. Last car driving takes the round.",
      meta: ["2-6 players", "Last one standing"],
    });
  });

  it("has no clock, since Brawl has no match clock", () => {
    expect(BRAWL_HUD.clockLabel(state(0), 100)).toBe("");
  });

  it("would still format a clock if matchEndsTick were ever set", () => {
    expect(BRAWL_HUD.clockLabel(state(90 * 30), 0)).toBe("1:30");
  });

  it("carries no kills column", () => {
    expect(BRAWL_HUD.showsKills).toBe(false);
  });

  it("has no results line", () => {
    expect(BRAWL_HUD.resultsLine({} as never, "p1")).toBeUndefined();
  });
});
