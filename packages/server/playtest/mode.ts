/**
 * Which mode's bundle a playtest run measures (MC41).
 *
 * `npm run playtest -- --mode=<id|name>` reaches `run-all.ts`, which resolves it ONCE, names the
 * run folder after it, and passes it down to each probe through `PLAYTEST_MODE_ENV` — the same
 * shape `PLAYTEST_RUN_DIR` already uses to keep six spawned probes writing into one folder. A probe
 * run on its own (`tsx playtest/ram.ts --mode=2`) parses the flag itself, so neither entry point is
 * the only one that understands it.
 *
 * Every probe is a one-shot process, so `installMode` (no restore) is right here where `withMode`
 * is right in a server room — see each probe's own comment.
 */
import {
  DEFAULT_GAME_MODE,
  installMode,
  modeConfigOf,
  parseModeArg,
  type GameMode,
} from "@motor-combat-moba/shared";

/** Set by `run-all.ts` on each spawned probe, so one `--mode` covers the whole run. */
export const PLAYTEST_MODE_ENV = "PLAYTEST_MODE";

/**
 * Resolve the mode from an argument list and the environment: an explicit `--mode=` wins, then
 * `PLAYTEST_MODE`, then `DEFAULT_GAME_MODE`.
 *
 * Any other argument throws rather than being ignored: a typo'd `--mdoe=2` that silently measured
 * the default mode would produce a full report of the wrong game with nothing on the page saying
 * so, which is the exact failure per-mode tooling exists to remove. An unknown MODE throws too —
 * `parseModeArg` never falls back.
 */
export function resolvePlaytestMode(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): GameMode {
  let selected: string | undefined;
  for (const arg of argv) {
    const match = /^--mode(?:=(.*))?$/.exec(arg);
    if (!match) {
      throw new Error(
        `playtest: unrecognised argument "${arg}" — the only flag is --mode=<id|name>`,
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
