import { GameMode, DEFAULT_GAME_MODE, isGameMode } from "@motor-combat-moba/shared";
import type { ModeController } from "./types.js";
import { LAST_STANDING_CONTROLLER } from "./last-standing/controller.js";
import { DEATHMATCH_CONTROLLER } from "./deathmatch/controller.js";
import { CONQUER_CONTROLLER } from "./conquer/controller.js";

/**
 * One `ModeController` per `GameMode` (GM18-GM21). `satisfies Record<GameMode, ModeController>` is
 * the exhaustiveness guard: a new `GameMode` value fails this object literal until it gets a row.
 * Brawl and Team share `LAST_STANDING_CONTROLLER` — the family, not the mode, owns the behaviour.
 */
export const MODE_CONTROLLERS = {
  [GameMode.FFA_LAST_STANDING]: LAST_STANDING_CONTROLLER,
  [GameMode.TEAM]: LAST_STANDING_CONTROLLER,
  [GameMode.FFA_DEATHMATCH]: DEATHMATCH_CONTROLLER,
  [GameMode.CONQUER]: CONQUER_CONTROLLER,
} satisfies Record<GameMode, ModeController>;

/**
 * The WIRE-facing accessor, same fallback shape as `rulesOf`/`modeConfigOrDefault`: an unrecognised
 * byte off the network resolves to `DEFAULT_GAME_MODE`'s controller rather than throwing. Resolved
 * fresh on every call — never cache the result on a room — so a host switching mode between matches
 * gets the new family's behaviour immediately (Review Focus 4).
 */
export function controllerOf(mode: number): ModeController {
  return isGameMode(mode) ? MODE_CONTROLLERS[mode] : MODE_CONTROLLERS[DEFAULT_GAME_MODE];
}
