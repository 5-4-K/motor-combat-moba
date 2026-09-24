import { GameMode, type BotDifficulty } from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS, BOT_BRAIN_VERSION, type BotProfile } from "./bot-profiles.js";

/**
 * `BRAIN_CONSTANTS` has no named type of its own — it has only ever been read as the frozen object
 * literal it is. Derived here rather than invented, so this can never drift from the real shape.
 */
export type BrainConstants = typeof BRAIN_CONSTANTS;

/**
 * One `GameMode`'s bot tuning (MC29). Deliberately parallel to `ModeConfig` in shared rather than a
 * field on it: `BotProfile`/`BrainConstants` are server-only bot types, and `ModeConfig` reaches the
 * client bundle, so bot tuning stays out of it. `BotController` and friends resolve this bundle
 * instead of importing `BOT_PROFILES`/`BRAIN_CONSTANTS` from `bot-profiles.ts` directly.
 */
export interface BotModeConfig {
  readonly profiles: Readonly<Record<BotDifficulty, BotProfile>>;
  readonly brainConstants: BrainConstants;
  readonly brainVersion: string;
}

/**
 * Every mode's bot row, seeded identically from the one `BOT_PROFILES`/`BRAIN_CONSTANTS`/
 * `BOT_BRAIN_VERSION` triple that still lives in `bot-profiles.ts` (spec N2). No mode has its own
 * bot tuning yet — that is a future data edit here, not a refactor of this file or its callers.
 *
 * The three rows deliberately share the same `profiles`/`brainConstants` object references: there
 * is exactly one bot brain today, so there is exactly one config object, pointed at from every mode.
 */
const SHARED_BOT_CONFIG: BotModeConfig = Object.freeze({
  profiles: BOT_PROFILES,
  brainConstants: BRAIN_CONSTANTS,
  brainVersion: BOT_BRAIN_VERSION,
});

export const MODE_BOT_CONFIG: Readonly<Record<GameMode, BotModeConfig>> = Object.freeze({
  [GameMode.FFA_LAST_STANDING]: SHARED_BOT_CONFIG,
  [GameMode.TEAM]: SHARED_BOT_CONFIG,
  [GameMode.FFA_DEATHMATCH]: SHARED_BOT_CONFIG,
  // CQ17: no bot plays Conquer; this row exists because the table is Record<GameMode, …>.
  [GameMode.CONQUER]: SHARED_BOT_CONFIG,
} as const satisfies Record<GameMode, BotModeConfig>);

/** Throws on an unknown mode, mirroring `modeConfigOf` (shared's registry.ts) — never a wire value. */
export function botConfigOf(mode: GameMode): BotModeConfig {
  const row = MODE_BOT_CONFIG[mode];
  if (row === undefined) {
    throw new Error(`botConfigOf: unknown GameMode ${String(mode)}`);
  }
  return row;
}
