import { GameMode, DEFAULT_GAME_MODE, isGameMode } from "@motor-combat-moba/shared";
import type { ModeHud } from "./types.js";
import { BRAWL_HUD } from "./brawl/hud.js";
import { TEAM_HUD } from "./team-brawl/hud.js";
import { DEATHMATCH_HUD } from "./deathmatch/hud.js";
import { CONQUER_HUD } from "./conquer/hud.js";

/**
 * One `ModeHud` per `GameMode` (GM22-GM25), mirroring the server's `MODE_CONTROLLERS`
 * (`packages/server/src/modes/registry.ts`) and shared's `MODE_RULES`. `satisfies
 * Record<GameMode, ModeHud>` is the same exhaustiveness guard those two use: a new `GameMode` value
 * fails this object literal until it gets a row.
 */
export const MODE_HUDS = {
  [GameMode.FFA_LAST_STANDING]: BRAWL_HUD,
  [GameMode.TEAM]: TEAM_HUD,
  [GameMode.FFA_DEATHMATCH]: DEATHMATCH_HUD,
  [GameMode.CONQUER]: CONQUER_HUD,
} satisfies Record<GameMode, ModeHud>;

/**
 * The WIRE-facing accessor, same fallback shape as `rulesOf`/`controllerOf`: an unrecognised byte
 * off the network resolves to `DEFAULT_GAME_MODE`'s HUD rather than throwing.
 */
export function hudOf(mode: number): ModeHud {
  return isGameMode(mode) ? MODE_HUDS[mode] : MODE_HUDS[DEFAULT_GAME_MODE];
}
