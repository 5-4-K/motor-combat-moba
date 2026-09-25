import { describe, expect, it } from "vitest";
import { BRAWL_HUD } from "./hud.js";

// Shared last-standing-family behaviour (clockLabel, showsKills, resultsLine) is covered by
// `modes/last-standing/hud.test.ts`. Only the card copy is Brawl's own.
describe("BRAWL_HUD", () => {
  it("carries today's FFA_LAST_STANDING lobby card copy", () => {
    expect(BRAWL_HUD.lobbyCard()).toEqual({
      kicker: "Free-for-all",
      body: "Everyone fights everyone. Last car driving takes the round.",
      meta: ["2-6 players", "Last one standing"],
    });
  });
});
