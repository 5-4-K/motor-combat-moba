import { describe, expect, it } from "vitest";
import { GameMode } from "../../constants.js";
import { modeConfigOf } from "../registry.js";
import { CONQUER_RULES } from "./rules.js";

const p = (team: number) => ({ status: "ready" as const, team });
const config = modeConfigOf(GameMode.CONQUER);

describe("CONQUER_RULES (CQ28)", () => {
  it("plays in teams with respawns and a clock", () => {
    expect(CONQUER_RULES.sides).toBe("team");
    expect(CONQUER_RULES.respawns).toBe(true);
    expect(CONQUER_RULES.hasMatchClock).toBe(true);
  });

  it("claims chassis exactly when the mode's config says so", () => {
    expect(CONQUER_RULES.claimsChassis(config)).toBe(true);
  });

  it("needs exactly teamSize ready players per team", () => {
    expect(
      CONQUER_RULES.canStart(config, [p(0), p(0), p(0), p(1), p(1), p(1)]),
    ).toStrictEqual({ ok: true });
    for (const lobby of [
      [p(0), p(1)],
      [p(0), p(0), p(1), p(1)],
      [p(0), p(0), p(0), p(1), p(1)],
      [p(0), p(0), p(0), p(0), p(1), p(1)],
    ]) {
      expect(CONQUER_RULES.canStart(config, lobby)).toStrictEqual({
        ok: false,
        error: "Conquer needs exactly 3 ready players per team",
      });
    }
  });
});
