import type { CanStartResult, ModeRules, Sides } from "../rules-types.js";

/**
 * The rule family shared by Brawl and Team brawl (GM14): no respawns, no match clock, no chassis
 * exclusivity. Only `canStart` differs by side structure, and even that is the same shape
 * `lobby/start-rules.ts` always used — exact strings preserved.
 */
export function lastStandingRules(sides: Sides): ModeRules {
  return {
    sides,
    respawns: false,
    hasMatchClock: false,
    winRuleLabel: "last_standing",
    claimsChassis: () => false,
    canStart(_config, ready): CanStartResult {
      if (sides !== "team") {
        if (ready.length < 2) {
          return { ok: false, error: "Need at least 2 ready players" };
        }
        return { ok: true };
      }

      let team0 = 0;
      let team1 = 0;
      for (const player of ready) {
        if (player.team === 0) team0 += 1;
        else if (player.team === 1) team1 += 1;
      }

      if (team0 === 0 || team1 === 0) {
        return { ok: false, error: "Need at least 1 ready player per team" };
      }
      if (team0 !== team1) {
        return { ok: false, error: "Teams must be equal to start" };
      }
      return { ok: true };
    },
  };
}
