import { describe, expect, it } from "vitest";
import { canStart } from "./start-rules.js";
import { GameMode } from "../constants.js";
import { modeConfigOf } from "../modes/registry.js";
import { rulesOf } from "../modes/rules-registry.js";

const ready = (team: 0 | 1) => ({ status: "ready" as const, team });

/**
 * `canStart` itself owns exactly one thing — filtering to ready players and delegating to the
 * starting mode's own `ModeRules.canStart` — so this file no longer duplicates each mode's business
 * rules. Those live in `modes/<slug>/rules.test.ts` (BRAWL_RULES, TEAM_RULES, DEATHMATCH_RULES,
 * CONQUER_RULES).
 */
describe("canStart", () => {
  it("filters out players who are not ready before the mode's rule ever sees them", () => {
    const players = [
      ready(0),
      { status: "in_match" as const, team: 0 },
      { status: "post_match" as const, team: 1 },
    ];
    // Only one of these three is ready, so FFA's "need at least 2" rule is the one that fires.
    expect(canStart(GameMode.FFA_LAST_STANDING, players)).toEqual({
      ok: false,
      error: "Need at least 2 ready players",
    });
  });

  it("delegates to rulesOf(mode).canStart(modeConfigOf(mode), readyPlayers), for every mode", () => {
    const players = [ready(0), ready(1), { status: "in_match" as const, team: 0 }];
    const readyPlayers = players.filter((p) => p.status === "ready");
    for (const mode of [
      GameMode.FFA_LAST_STANDING,
      GameMode.TEAM,
      GameMode.FFA_DEATHMATCH,
      GameMode.CONQUER,
    ]) {
      expect(canStart(mode, players)).toEqual(
        rulesOf(mode).canStart(modeConfigOf(mode), readyPlayers),
      );
    }
  });
});
