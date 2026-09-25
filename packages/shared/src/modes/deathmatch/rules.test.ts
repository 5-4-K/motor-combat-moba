import { describe, expect, it } from "vitest";
import { GameMode } from "../../constants.js";
import { modeConfigOf } from "../registry.js";
import { DEATHMATCH_RULES } from "./rules.js";

const ready = (team: number) => ({ status: "ready" as const, team });
const config = modeConfigOf(GameMode.FFA_DEATHMATCH);

describe("DEATHMATCH_RULES", () => {
  it("plays FFA with respawns and a clock, no chassis exclusivity", () => {
    expect(DEATHMATCH_RULES.sides).toBe("ffa");
    expect(DEATHMATCH_RULES.respawns).toBe(true);
    expect(DEATHMATCH_RULES.hasMatchClock).toBe(true);
    expect(DEATHMATCH_RULES.claimsChassis(config)).toBe(false);
  });

  it("rejects fewer than 2 ready", () => {
    expect(DEATHMATCH_RULES.canStart(config, [ready(0)])).toEqual({
      ok: false,
      error: "Need at least 2 ready players",
    });
  });

  it("accepts 2+ ready regardless of team", () => {
    expect(DEATHMATCH_RULES.canStart(config, [ready(0), ready(1)])).toEqual({ ok: true });
  });
});
