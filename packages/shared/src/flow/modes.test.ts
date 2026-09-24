import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { respawnsIn, sidesOf, winRuleOf } from "./modes.js";

describe("sidesOf", () => {
  it("puts both FFA modes on the same side structure", () => {
    expect(sidesOf(GameMode.FFA_LAST_STANDING)).toBe("ffa");
    expect(sidesOf(GameMode.FFA_DEATHMATCH)).toBe("ffa");
  });

  it("puts team mode on its own", () => {
    expect(sidesOf(GameMode.TEAM)).toBe("team");
  });
});

describe("winRuleOf", () => {
  it("separates the win condition from the side structure", () => {
    expect(winRuleOf(GameMode.FFA_LAST_STANDING)).toBe("last_standing");
    expect(winRuleOf(GameMode.TEAM)).toBe("last_standing");
    expect(winRuleOf(GameMode.FFA_DEATHMATCH)).toBe("deathmatch");
  });
});

describe("wire values", () => {
  it("never renumbers, so an older client still agrees on 0 and 1", () => {
    expect(GameMode.FFA_LAST_STANDING).toBe(0);
    expect(GameMode.TEAM).toBe(1);
    expect(GameMode.FFA_DEATHMATCH).toBe(2);
  });
});

describe("Conquer (CQ14, CQ15)", () => {
  it("plays in teams under its own win rule", () => {
    expect(sidesOf(GameMode.CONQUER)).toBe("team");
    expect(winRuleOf(GameMode.CONQUER)).toBe("conquer");
  });
  it("respawnsIn is true exactly for the respawning modes", () => {
    expect(respawnsIn(GameMode.FFA_DEATHMATCH)).toBe(true);
    expect(respawnsIn(GameMode.CONQUER)).toBe(true);
    expect(respawnsIn(GameMode.FFA_LAST_STANDING)).toBe(false);
    expect(respawnsIn(GameMode.TEAM)).toBe(false);
  });
});
