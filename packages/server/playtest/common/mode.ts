/**
 * Which mode's bundle a playtest run measures (MC41).
 *
 * `npm run playtest -- --mode=<id|name>` reaches `run-all.ts`, which resolves it ONCE, names the
 * run folder after it, and passes it down to each probe through `PLAYTEST_MODE_ENV` — the same
 * shape `PLAYTEST_RUN_DIR` already uses to keep six spawned probes writing into one folder. A probe
 * run on its own (`tsx playtest/common/ram.ts --mode=2`) parses the flag itself, so neither entry point is
 * the only one that understands it.
 *
 * Every probe is a one-shot process, so `installMode` (no restore) is right here where `withMode`
 * is right in a server room — see each probe's own comment.
 */
import {
  DEFAULT_GAME_MODE,
  GameMode,
  installMode,
  modeConfigOf,
  parseModeArg,
} from "@motor-combat-moba/shared";

/** Set by `run-all.ts` on each spawned probe, so one `--mode` covers the whole run. */
export const PLAYTEST_MODE_ENV = "PLAYTEST_MODE";

/**
 * Which `playtest/modes/<family>/` folder a mode's probes live under (Task 14). Brawl and Team
 * share `LAST_STANDING_CONTROLLER` server-side (`packages/server/src/modes/registry.ts`) — the
 * family, not the mode, owns the behaviour a mode-specific probe would exercise, so they share a
 * folder here too. `satisfies Record<GameMode, string>` is the exhaustiveness guard: a new
 * `GameMode` value fails this object literal until it gets a row.
 */
export const FAMILY_OF = {
  [GameMode.FFA_LAST_STANDING]: "last-standing",
  [GameMode.TEAM]: "last-standing",
  [GameMode.FFA_DEATHMATCH]: "deathmatch",
  [GameMode.CONQUER]: "conquer",
} satisfies Record<GameMode, string>;

const SCOPES = ["common", "mode", "all"] as const;
export type PlaytestScope = (typeof SCOPES)[number];

/**
 * Resolve `--scope=common|mode|all` from an argument list, defaulting to `all`. Thrown on anything
 * else, naming the valid values — the same "never silently fall back" shape `resolvePlaytestMode`
 * uses for `--mode`, for the same reason: a typo'd scope that quietly ran the wrong probe set would
 * produce a report that looks complete and is not.
 */
export function parseScope(argv: readonly string[] = process.argv.slice(2)): PlaytestScope {
  let selected: string | undefined;
  for (const arg of argv) {
    const match = /^--scope(?:=(.*))?$/.exec(arg);
    if (!match) continue; // not a --scope flag; resolvePlaytestMode owns --mode and unknown args
    if (match[1] === undefined || match[1] === "") {
      throw new Error("playtest: --scope requires a value (--scope=common|mode|all)");
    }
    selected = match[1];
  }
  if (selected === undefined) return "all";
  if ((SCOPES as readonly string[]).includes(selected)) return selected as PlaytestScope;
  throw new Error(`playtest: unknown --scope "${selected}" — expected one of: ${SCOPES.join(", ")}`);
}

/**
 * Resolve the mode from an argument list and the environment: an explicit `--mode=` wins, then
 * `PLAYTEST_MODE`, then `DEFAULT_GAME_MODE`.
 *
 * Any other argument throws rather than being ignored: a typo'd `--mdoe=2` that silently measured
 * the default mode would produce a full report of the wrong game with nothing on the page saying
 * so, which is the exact failure per-mode tooling exists to remove. An unknown MODE throws too —
 * `parseModeArg` never falls back. `--scope` is a sibling flag `run-all.ts` also reads off this
 * same argv, so it is recognised and skipped here rather than tripping the "only flag" check.
 */
export function resolvePlaytestMode(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): GameMode {
  let selected: string | undefined;
  for (const arg of argv) {
    if (/^--scope(?:=.*)?$/.test(arg)) continue;
    const match = /^--mode(?:=(.*))?$/.exec(arg);
    if (!match) {
      throw new Error(
        `playtest: unrecognised argument "${arg}" — the only flags are --mode=<id|name> and --scope=<common|mode|all>`,
      );
    }
    if (match[1] === undefined || match[1] === "") {
      throw new Error("playtest: --mode requires a value (--mode=<id|name>)");
    }
    selected = match[1];
  }

  const raw = selected ?? env[PLAYTEST_MODE_ENV];
  if (raw === undefined || raw === "") return DEFAULT_GAME_MODE;
  return parseModeArg(raw);
}

/**
 * `resolvePlaytestMode`, but a bad flag prints one line and exits 1 instead of throwing a stack
 * trace out of a top-level script. The throwing form stays exported because that is what a test
 * asserts on, and because `run-all.ts` needs the answer before it creates anything.
 */
export function resolvePlaytestModeOrExit(): GameMode {
  try {
    return resolvePlaytestMode();
  } catch (err) {
    console.error(`playtest failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * Resolve, install, and hand the mode back so the caller can label its report with it. Called at
 * the top of every probe, in place of the `installMode(modeConfigOf(DEFAULT_GAME_MODE))` line each
 * one carried before.
 */
export function installPlaytestMode(): GameMode {
  const mode = resolvePlaytestModeOrExit();
  installMode(modeConfigOf(mode));
  return mode;
}
