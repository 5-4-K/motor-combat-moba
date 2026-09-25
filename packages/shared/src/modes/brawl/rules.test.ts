import { describe, expect, it } from "vitest";
import { GameMode } from "../../constants.js";
import { modeConfigOf } from "../registry.js";
import { BRAWL_RULES } from "./rules.js";

const ready = (team: number) => ({ status: "ready" as const, team });
const config = modeConfigOf(GameMode.FFA_LAST_STANDING);

describe("BRAWL_RULES", () => {
  it("plays FFA with no respawns, no clock, no chassis exclusivity", () => {
    expect(BRAWL_RULES.sides).toBe("ffa");
    expect(BRAWL_RULES.respawns).toBe(false);
    expect(BRAWL_RULES.hasMatchClock).toBe(false);
    expect(BRAWL_RULES.claimsChassis(config)).toBe(false);
  });

  it("rejects fewer than 2 ready", () => {
    expect(BRAWL_RULES.canStart(config, [ready(0)])).toEqual({
      ok: false,
      error: "Need at least 2 ready players",
    });
    expect(BRAWL_RULES.canStart(config, [])).toEqual({
      ok: false,
      error: "Need at least 2 ready players",
    });
  });

  it("accepts 2+ ready regardless of team", () => {
    expect(BRAWL_RULES.canStart(config, [ready(0), ready(1)])).toEqual({ ok: true });
  });
});
