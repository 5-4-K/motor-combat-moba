import type { ModeRules } from "../rules-types.js";

export const DEATHMATCH_RULES: ModeRules = {
  sides: "ffa",
  respawns: true,
  hasMatchClock: true,
  winRuleLabel: "deathmatch",
  claimsChassis: () => false,
  canStart(_config, ready) {
    if (ready.length < 2) {
      return { ok: false, error: "Need at least 2 ready players" };
    }
    return { ok: true };
  },
};
