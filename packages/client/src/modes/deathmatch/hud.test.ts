import { beforeEach, describe, expect, it } from "vitest";
import type { ArenaState } from "@motor-combat-moba/shared";
import {
  DEFAULT_GAME_MODE,
  GameMode,
  installMode,
  modeConfigOf,
  withMode,
} from "@motor-combat-moba/shared";
import { DEATHMATCH_HUD } from "./hud.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const state = (matchEndsTick: number) => ({ matchEndsTick }) as unknown as ArenaState;

describe("DEATHMATCH_HUD", () => {
  it("reads its lobby card off Deathmatch's OWN bundle, not the ambient mode", () => {
    // DEFAULT_GAME_MODE (Brawl) is installed above — the card must still quote Deathmatch's numbers.
    const { deathmatch } = modeConfigOf(GameMode.FFA_DEATHMATCH);
    expect(DEATHMATCH_HUD.lobbyCard()).toEqual({
      kicker: "Free-for-all",
      body: `Everyone fights everyone. Dying costs ${deathmatch.respawnDelaySeconds} seconds, not the round. Most kills on the clock wins.`,
      meta: ["2-6 players", `${deathmatch.matchSeconds / 60} minutes`],
    });
  });

  it("reads the same lobby card while Deathmatch itself is the ambient mode", () => {
    withMode(modeConfigOf(GameMode.FFA_DEATHMATCH), () => {
      expect(DEATHMATCH_HUD.lobbyCard()).toEqual(DEATHMATCH_HUD.lobbyCard());
    });
  });

  it("counts down the match clock", () => {
    expect(DEATHMATCH_HUD.clockLabel(state(90 * 30), 0)).toBe("1:30");
  });

  it("is empty with no matchEndsTick", () => {
    expect(DEATHMATCH_HUD.clockLabel(state(0), 0)).toBe("");
  });

  it("carries a kills column", () => {
    expect(DEATHMATCH_HUD.showsKills).toBe(true);
  });

  it("has no results line", () => {
    expect(DEATHMATCH_HUD.resultsLine({} as never, "p1")).toBeUndefined();
  });
});
