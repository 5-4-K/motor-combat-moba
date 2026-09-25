import type { GameMode } from "../constants.js";
import { modeConfigOf } from "../modes/registry.js";
import { rulesOf } from "../modes/rules-registry.js";
import type { CanStartResult, StartRulePlayer } from "../modes/rules-types.js";

export type StartRuleStatus = StartRulePlayer["status"];
export type { StartRulePlayer, CanStartResult };

/** Delegates to the starting mode's own `ModeRules.canStart` (GM14). */
export function canStart(mode: GameMode, players: readonly StartRulePlayer[]): CanStartResult {
  return rulesOf(mode).canStart(
    modeConfigOf(mode),
    players.filter((p) => p.status === "ready"),
  );
}
