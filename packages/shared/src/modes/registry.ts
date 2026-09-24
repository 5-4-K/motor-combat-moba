import { GameMode } from "../constants.js";
import type { ArenaId } from "../arena/registry.js";
import { assembleModeConfig } from "./build.js";
import type { ModeConfig } from "./types.js";
import { BRAWL_TABLES } from "./brawl/index.js";
import { DEATHMATCH_TABLES } from "./deathmatch/index.js";
import { CONQUER_TABLES } from "./conquer/index.js";

/**
 * One row of the mode picker, plus the assembled bundle that row resolves to. Display names live
 * here so the lobby cards, the mode tag, and `modeLabel` cannot drift. The longer card copy
 * (kicker, body, player-count chips) stays in the client — it is not a sim input.
 *
 * `isActive` is the same gate as `CarDef.isActive`: flip it false and the mode disappears from the
 * lobby picker and `set_mode` refuses it — `resolveSetMode`
 * (`packages/server/src/rooms/match-helpers.ts`) checks `isActiveGameMode` before it resolves
 * anything, so an inactive mode is unreachable from a client message and not merely unpickable in
 * the UI. (That second half of the sentence was FALSE until 2026-09-23: the handler checked phase
 * and `hasPlayerInMatch` only, then resolved through `modeConfigOrDefault`, which happily seated
 * an inactive mode off the wire. The check was added rather than the claim weakened — a mode
 * nothing publishes should not be reachable from a client message.)
 * Playground, practice, and `npm run balance` pin or pass a
 * mode directly and never read this flag, so an unpublished mode can still be driven there.
 */
export interface ModeDef {
  readonly id: GameMode;
  readonly name: string;
  readonly isActive: boolean;
  readonly config: ModeConfig;
}

/**
 * Every match kind the sim knows, each carrying its own frozen bundle, assembled once at module
 * load (MC7) — switching mode is a pointer read into this table, never a rebuild.
 *
 * `TEAM` is unpublished today and has no `modes/` folder of its own — no one has authored team-mode
 * numbers yet. It is pointed at `BRAWL_TABLES` because the playground, the balance harness and the
 * team win rule still drive it even while it is hidden from a real lobby; that is also why the row
 * stays in this table rather than being dropped. `assembleModeConfig` is called again for it with
 * its own `GameMode.TEAM` id, so its bundle is a distinct object from Brawl's — see the "own bundle
 * object" test below — even though every value inside is Brawl's today.
 */
export const MODE_TABLE = {
  [GameMode.FFA_LAST_STANDING]: {
    id: GameMode.FFA_LAST_STANDING,
    name: "Brawl",
    isActive: true,
    config: assembleModeConfig(GameMode.FFA_LAST_STANDING, BRAWL_TABLES),
  },
  [GameMode.TEAM]: {
    id: GameMode.TEAM,
    name: "Team brawl",
    isActive: false,
    // No modes/team/ folder exists yet: nobody has authored team-mode numbers. Brawl's tables
    // stand in for it so the balance harness and playground can keep driving GameMode.TEAM.
    config: assembleModeConfig(GameMode.TEAM, BRAWL_TABLES),
  },
  [GameMode.FFA_DEATHMATCH]: {
    id: GameMode.FFA_DEATHMATCH,
    name: "Deathmatch",
    isActive: true,
    config: assembleModeConfig(GameMode.FFA_DEATHMATCH, DEATHMATCH_TABLES),
  },
  [GameMode.CONQUER]: {
    id: GameMode.CONQUER,
    name: "Conquer",
    isActive: false,
    config: assembleModeConfig(GameMode.CONQUER, CONQUER_TABLES),
  },
} as const satisfies Record<GameMode, ModeDef>;

/**
 * A new arena lobby opens on this mode. Must stay among `activeGameModes()` — `registry.test.ts`
 * fails until it is, the same way `DEFAULT_CAR_ID` must stay an active chassis.
 */
export const DEFAULT_GAME_MODE: GameMode = GameMode.FFA_LAST_STANDING;

/**
 * Stable picker order: Brawl, Team brawl, Deathmatch, Conquer — the lobby cards follow this, not
 * enum order.
 *
 * **Exported only so `registry.test.ts` can hold it COMPLETE against `MODE_TABLE`** (2026-09-23).
 * `MODE_TABLE` is held complete by `satisfies Record<GameMode, ModeDef>`; this list had no anchor
 * at all, and everything downstream derives its expectation from `activeGameModes()` — which
 * filters THIS array — so a mode present in the table and missing here got no lobby card, no guide
 * tab, no turn-tuning section and no `balanceStamp` entry, with every guard agreeing that was
 * correct. Flipping `isActive: true` on such a mode changed nothing and failed nothing either.
 * Nothing but that test should import this; read `activeGameModes()` instead.
 */
export const MODE_ORDER: readonly GameMode[] = [
  GameMode.FFA_LAST_STANDING,
  GameMode.TEAM,
  GameMode.FFA_DEATHMATCH,
  GameMode.CONQUER,
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

/**
 * Throws on an unknown mode. The PROGRAMMER-facing accessor — for code that already holds a
 * `GameMode` value it knows is valid (an authored constant, a value already checked with
 * `isGameMode`). Never call this on a raw wire value; use `modeConfigOrDefault` for that.
 */
export function modeConfigOf(mode: GameMode): ModeConfig {
  const def = MODE_TABLE[mode];
  if (def === undefined) {
    throw new Error(`modeConfigOf: unknown GameMode ${String(mode)}`);
  }
  return def.config;
}

let warnedOnUnknownMode = false;

/**
 * The WIRE-facing accessor. `ArenaState.mode` is a uint8 off the network — an old client, or a mode
 * deleted between builds, can put any byte in it. Resolving that through `modeConfigOf` would throw
 * and kill the room mid-tick for everyone in it, so this form never throws: an unrecognised value
 * logs once (not once per tick, so a stuck bad value cannot spam the log) and falls back to
 * `DEFAULT_GAME_MODE`'s bundle.
 */
export function modeConfigOrDefault(mode: number): ModeConfig {
  if (isGameMode(mode)) {
    return MODE_TABLE[mode].config;
  }
  if (!warnedOnUnknownMode) {
    warnedOnUnknownMode = true;
    console.warn(
      `modeConfigOrDefault: unrecognised mode byte ${mode}, falling back to DEFAULT_GAME_MODE`,
    );
  }
  return MODE_TABLE[DEFAULT_GAME_MODE].config;
}

/** Union of every ACTIVE mode's arena set, de-duplicated, registry order (MC24, MC25). */
export function activeArenaIds(): readonly ArenaId[] {
  const seen = new Set<ArenaId>();
  const result: ArenaId[] = [];
  for (const mode of activeGameModes()) {
    for (const arenaId of MODE_TABLE[mode].config.arenas) {
      if (!seen.has(arenaId)) {
        seen.add(arenaId);
        result.push(arenaId);
      }
    }
  }
  return result;
}
