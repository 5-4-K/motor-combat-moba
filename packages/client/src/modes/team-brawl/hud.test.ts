import { describe, expect, it } from "vitest";
import { TEAM_HUD } from "./hud.js";

// Shared last-standing-family behaviour (clockLabel, showsKills, resultsLine) is covered by
// `modes/last-standing/hud.test.ts`. Only the card copy is Team brawl's own.
describe("TEAM_HUD", () => {
  it("carries today's TEAM lobby card copy", () => {
    expect(TEAM_HUD.lobbyCard()).toEqual({
      kicker: "Team",
      body: "Two teams, shared victory. Last team with a car standing wins.",
      meta: ["2v2 – 3v3", "Last team standing"],
    });
  });
});
