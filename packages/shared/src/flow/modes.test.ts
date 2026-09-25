import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { winRuleOf } from "./modes.js";

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
  it("plays under its own win rule", () => {
    expect(winRuleOf(GameMode.CONQUER)).toBe("conquer");
  });
});
