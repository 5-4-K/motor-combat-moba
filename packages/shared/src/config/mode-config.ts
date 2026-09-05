import { GameMode } from "../constants.js";
import type { ModeDef } from "./types.js";

/**
 * The three match kinds a host can pick, plus the publish flag that hides a row from a real lobby.
 *
 * Display names live here so the lobby cards, the mode tag, and `modeLabel` cannot drift. The
 * longer card copy (kicker, body, player-count chips) stays in the client — it is not a sim input.
 *
 * `isActive` is the same gate as `CarDef.isActive`: flip it false and the mode disappears from the
 * lobby picker and `set_mode` refuses it. Playground, practice, and `npm run balance` pin or pass a
 * mode directly and never read this flag, so an unpublished mode can still be driven there.
 */
export const MODE_TABLE = {
  [GameMode.FFA_LAST_STANDING]: {
    id: GameMode.FFA_LAST_STANDING,
    name: "Brawl",
    isActive: true,
  },
  [GameMode.TEAM]: {
    id: GameMode.TEAM,
    name: "Team brawl",
    isActive: true,
  },
  [GameMode.FFA_DEATHMATCH]: {
    id: GameMode.FFA_DEATHMATCH,
    name: "Deathmatch",
    isActive: true,
  },
} as const satisfies Record<GameMode, ModeDef>;

/**
 * A new arena lobby opens on this mode. Must stay among `activeGameModes()` — `mode-config.test.ts`
 * fails until it is, the same way `DEFAULT_CAR_ID` must stay an active chassis.
 */
export const DEFAULT_GAME_MODE: GameMode = GameMode.FFA_LAST_STANDING;

/** Stable picker order: Brawl, Team brawl, Deathmatch — the lobby cards follow this, not enum order. */
const MODE_ORDER: readonly GameMode[] = [
  GameMode.FFA_LAST_STANDING,
  GameMode.TEAM,
  GameMode.FFA_DEATHMATCH,
];

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === "number" && Object.prototype.hasOwnProperty.call(MODE_TABLE, value);
}

/** True only for a wire value that both exists AND is published — real lobbies gate on this. */
export function isActiveGameMode(value: unknown): value is GameMode {
  return isGameMode(value) && MODE_TABLE[value].isActive;
}

export function activeGameModes(): GameMode[] {
  return MODE_ORDER.filter((id) => MODE_TABLE[id].isActive);
}
