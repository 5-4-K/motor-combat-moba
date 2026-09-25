import type { ModeRules } from "../rules-types.js";

/** CQ28. Exactly `config.conquer.teamSize` ready players per team, no more, no fewer. */
export const CONQUER_RULES: ModeRules = {
  sides: "team",
  respawns: true,
  hasMatchClock: true,
  claimsChassis: (config) => config.conquer.uniqueChassisPerTeam,
  canStart(config, ready) {
    let team0 = 0;
    let team1 = 0;
    for (const player of ready) {
      if (player.team === 0) team0 += 1;
      else if (player.team === 1) team1 += 1;
    }

    const size = config.conquer.teamSize;
    if (team0 !== size || team1 !== size) {
      return { ok: false, error: `Conquer needs exactly ${size} ready players per team` };
    }
    return { ok: true };
  },
};
