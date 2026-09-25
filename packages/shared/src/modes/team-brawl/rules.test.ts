import { describe, expect, it } from "vitest";
import { GameMode } from "../../constants.js";
import { modeConfigOf } from "../registry.js";
import { TEAM_RULES } from "./rules.js";

const ready = (team: number) => ({ status: "ready" as const, team });
const config = modeConfigOf(GameMode.TEAM);

describe("TEAM_RULES", () => {
  it("plays in teams with no respawns, no clock, no chassis exclusivity", () => {
    expect(TEAM_RULES.sides).toBe("team");
    expect(TEAM_RULES.respawns).toBe(false);
    expect(TEAM_RULES.hasMatchClock).toBe(false);
    expect(TEAM_RULES.claimsChassis(config)).toBe(false);
  });

  it("accepts 1v1 / 2v2 / 3v3 ready", () => {
    expect(TEAM_RULES.canStart(config, [ready(0), ready(1)])).toEqual({ ok: true });
    expect(
      TEAM_RULES.canStart(config, [ready(0), ready(0), ready(1), ready(1)]),
    ).toEqual({ ok: true });
    expect(
      TEAM_RULES.canStart(config, [
        ready(0),
        ready(0),
        ready(0),
        ready(1),
        ready(1),
        ready(1),
      ]),
    ).toEqual({ ok: true });
  });

  it("rejects unequal ready teams", () => {
    expect(TEAM_RULES.canStart(config, [ready(0), ready(0), ready(1)])).toEqual({
      ok: false,
      error: "Teams must be equal to start",
    });
  });

  it("returns per-team error when a side has 0 ready", () => {
    expect(TEAM_RULES.canStart(config, [ready(0)])).toEqual({
      ok: false,
      error: "Need at least 1 ready player per team",
    });
    expect(TEAM_RULES.canStart(config, [])).toEqual({
      ok: false,
      error: "Need at least 1 ready player per team",
    });
  });
});
