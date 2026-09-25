import { GameMode } from "../constants.js";
import { BRAWL_RULES } from "./brawl/rules.js";
import { TEAM_RULES } from "./team-brawl/rules.js";
import { DEATHMATCH_RULES } from "./deathmatch/rules.js";
import { CONQUER_RULES } from "./conquer/rules.js";
import { DEFAULT_GAME_MODE, isGameMode } from "./registry.js";
import type { ModeRules } from "./rules-types.js";

/**
 * One `ModeRules` per `GameMode`, replacing `sidesOf`/`respawnsIn`'s exhaustive switches (GM14).
 * `satisfies Record<GameMode, ModeRules>` is the same exhaustiveness guard those switches used to
 * give at the type level — a new `GameMode` value fails this object literal until it gets a row.
 */
export const MODE_RULES = {
  [GameMode.FFA_LAST_STANDING]: BRAWL_RULES,
  [GameMode.TEAM]: TEAM_RULES,
  [GameMode.FFA_DEATHMATCH]: DEATHMATCH_RULES,
  [GameMode.CONQUER]: CONQUER_RULES,
} as const satisfies Record<GameMode, ModeRules>;

/**
 * The WIRE-facing accessor, same fallback shape as `modeConfigOrDefault`: an unrecognised byte off
 * the network resolves to `DEFAULT_GAME_MODE`'s rules rather than throwing.
 */
export function rulesOf(mode: number): ModeRules {
  return isGameMode(mode) ? MODE_RULES[mode] : MODE_RULES[DEFAULT_GAME_MODE];
}
