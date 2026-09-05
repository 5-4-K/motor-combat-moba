/**
 * Argument parsing for `npm run balance -- [flags]` (B41, B42). Pure and side-effect-free — no
 * I/O, no console output, no reading a baseline off disk — so `parseArgs` is testable by itself and
 * `run.ts` owns everything that touches the filesystem or the terminal.
 *
 * **The CLI speaks player types; the code speaks bot difficulties (B42).** `SKILL_TO_DIFFICULTY`
 * below is the ONE place that translates `pro`/`casual`/`amateur` into `hard`/`medium`/`easy` —
 * nowhere else in the harness may own half of that mapping, so the two vocabularies can never drift
 * apart. `run.ts` prints both forms together (`pro (hard)`) rather than picking one.
 *
 * **An unknown flag, or a value that fails to parse, throws rather than being ignored.** Silently
 * dropping a typo'd `--matchs=10` would produce a run that looks complete but never did what its
 * command line claimed — worse than refusing to start.
 */
import {
  DEATHMATCH_CONFIG,
  GameMode,
  isArenaId,
  type BotDifficulty,
} from "@motor-combat-moba/shared";
import type { RunConfig, Shape } from "./runner.js";

export type PlayerSkill = "pro" | "casual" | "amateur";

/** B42's one mapping table. `run.ts` is the only other file allowed to READ it (to print both
 * forms); nothing may reimplement it. */
export const SKILL_TO_DIFFICULTY: Readonly<Record<PlayerSkill, BotDifficulty>> = Object.freeze({
  pro: "hard",
  casual: "medium",
  amateur: "easy",
});

/**
 * A `last-standing` match ends by elimination, not by a clock — Task 15's probes measured roughly
 * 7s per match, so 300s (5 minutes) is not a target duration, it is a SAFETY CAP against a rig that
 * never converges. A last-standing match that actually reaches this cap is a stalemate: a real
 * finding (a matchup, or a bot pairing, that cannot resolve) rather than a normal ending, and
 * `run.ts`'s `hitClock` reporting is what surfaces that.
 */
const LAST_STANDING_SAFETY_CAP_SECONDS = 300;

/**
 * `--match-seconds` doubles as `DEATHMATCH_CONFIG.matchSeconds` when nothing overrides it (Task 17
 * made `match.ts` set `state.matchEndsTick = setup.maxTicks`, so this harness's clock IS the
 * deathmatch clock, not a mock of it) — read from shared config rather than hardcoded, so a future
 * retune of the real match length keeps the harness in step with no edit needed here.
 */
function defaultMatchSeconds(mode: GameMode): number {
  return mode === GameMode.FFA_DEATHMATCH
    ? DEATHMATCH_CONFIG.matchSeconds
    : LAST_STANDING_SAFETY_CAP_SECONDS;
}

/** `--shape=duel` defaults to last-standing — a duel wants one clean winner, not a timed brawl —
 * while every other shape defaults to deathmatch. `--mode` always overrides this. */
function defaultMode(shape: Shape): GameMode {
  return shape === "duel" ? GameMode.FFA_LAST_STANDING : GameMode.FFA_DEATHMATCH;
}

/**
 * A random seed generated here, once, before any match runs, is not a violation of B43's "no
 * `Math.random()` on a path a run touches" — nothing downstream of `parseArgs` reads the wall clock
 * or reseeds; every match, bot stream and spawn shuffle is a pure function of the single integer
 * this returns. It exists only so a run with no `--seed` still gets one worth printing and replaying.
 */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function parseIntFlag(name: string, raw: string): number {
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`parseArgs: --${name} must be an integer, got "${raw}"`);
  }
  return Number.parseInt(raw, 10);
}

function parseShape(raw: string): Shape {
  if (raw === "ffa" || raw === "duel") return raw;
  throw new Error(`parseArgs: --shape must be "ffa" or "duel", got "${raw}"`);
}

function parseSkill(raw: string): PlayerSkill {
  if (raw === "pro" || raw === "casual" || raw === "amateur") return raw;
  throw new Error(`parseArgs: --skill must be "pro", "casual" or "amateur", got "${raw}"`);
}

function parseMode(raw: string): GameMode {
  if (raw === "deathmatch") return GameMode.FFA_DEATHMATCH;
  if (raw === "last-standing") return GameMode.FFA_LAST_STANDING;
  throw new Error(`parseArgs: --mode must be "deathmatch" or "last-standing", got "${raw}"`);
}

function parseArena(raw: string): string {
  if (!isArenaId(raw)) throw new Error(`parseArgs: --arena "${raw}" is not a known arena id`);
  return raw;
}

/** Every flag this CLI recognises. Anything else in `argv` is a typo and `parseArgs` throws naming
 * it, rather than silently ignoring it (per this file's own header). */
const KNOWN_FLAGS = new Set([
  "matches",
  "shape",
  "mode",
  "skill",
  "seed",
  "arena",
  "baseline",
  "match-seconds",
  "out",
  "force",
]);

/**
 * Flags with no `parseXxx` validator standing between the raw string and `ParsedArgs` — `baseline`
 * and `out` are read straight off `flags.get(name)` as paths, with nothing to notice a bare
 * `--baseline` (no `=value`) landing as the literal string `"true"`. Every OTHER flag already fails
 * loudly on a bare form for free, because its parser rejects `"true"` as not a valid shape/mode/
 * skill/integer/arena id — the error reads oddly ("must be an integer, got \"true\"") but it is
 * still an error. `baseline`/`out` have no such parser, so a bare `--baseline` used to sail through
 * as a literal path named `true`, surfacing only much later as a confusing "cannot read true/run.json"
 * filesystem error with no hint the flag itself was the problem. This set is what
 * `requireExplicitValue` checks before that can happen — any future flag added the same
 * pass-through way (a raw string, no `parseXxx`) belongs in this set too.
 */
const REQUIRES_EXPLICIT_VALUE = new Set(["baseline", "out"]);

/**
 * Rejects a bare `--name` (no `=value`) for a flag in `REQUIRES_EXPLICIT_VALUE`, naming the flag
 * rather than letting it silently become the string `"true"`. `bareFlags` is the set of flag names
 * `parseArgs`'s own tokenizer saw with no `=` at all — distinct from a flag explicitly given the
 * literal value `"true"` (`--out=true`), which is a legal, if odd, directory name and must not be
 * rejected.
 */
function requireExplicitValue(name: string, bareFlags: ReadonlySet<string>): void {
  if (bareFlags.has(name)) {
    throw new Error(
      `parseArgs: --${name} requires a value (--${name}=<path>) — got a bare flag with nothing after it`,
    );
  }
}

export interface ParsedArgs extends RunConfig {
  /** The player-type vocabulary the flag was actually given in (B42) — kept alongside the resolved
   * `difficulty` so `run.ts` can print both forms without re-deriving one from the other. */
  skill: PlayerSkill;
  baseline?: string;
  out?: string;
  /** B37: run a `--baseline` comparison even when the config or bot fingerprint (or shape/mode)
   * differs, instead of refusing. A boolean flag, not a value — `--force` (bare) and `--force=true`
   * both set it, deliberately NOT in `REQUIRES_EXPLICIT_VALUE` (that set exists to reject exactly
   * the bare form this flag is meant to be used in). `run.ts` is what actually acts on it; a run with
   * no `--baseline` at all just carries `force: true` for nothing to apply it to. */
  force: boolean;
}

/**
 * Parse `npm run balance -- [flags]`'s argument list into a fully-resolved `RunConfig` plus the CLI
 * extras (`skill`, `baseline`, `out`) that do not belong on `RunConfig` itself.
 *
 * Flags come as `--name=value` (bare `--name` is accepted too, e.g. a future boolean flag, and is
 * recorded as `"true"`) — EXCEPT the flags in `REQUIRES_EXPLICIT_VALUE` (`baseline`, `out`), which
 * throw on a bare form rather than silently becoming the path `"true"`. Order does not matter. Every
 * flag not in `KNOWN_FLAGS` throws, naming the offending flag, per this file's header.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string>();
  // Names seen with no `=value` at all (a bare `--baseline`, say) — distinct from a flag explicitly
  // given the literal value `"true"`, which `requireExplicitValue` must not reject.
  const bareFlags = new Set<string>();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) {
      throw new Error(`parseArgs: unrecognised argument "${arg}" — flags must look like --name=value`);
    }
    const [, name, value] = match;
    if (value === undefined) bareFlags.add(name!);
    flags.set(name!, value ?? "true");
  }

  for (const name of flags.keys()) {
    if (!KNOWN_FLAGS.has(name)) {
      throw new Error(`parseArgs: unknown flag "--${name}" — see docs or --help for the flag list`);
    }
  }

  for (const name of REQUIRES_EXPLICIT_VALUE) requireExplicitValue(name, bareFlags);

  const shape = flags.has("shape") ? parseShape(flags.get("shape")!) : "ffa";
  const mode = flags.has("mode") ? parseMode(flags.get("mode")!) : defaultMode(shape);
  const skill = flags.has("skill") ? parseSkill(flags.get("skill")!) : "pro";
  const matches = flags.has("matches") ? parseIntFlag("matches", flags.get("matches")!) : 50;
  const seed = flags.has("seed") ? parseIntFlag("seed", flags.get("seed")!) : randomSeed();
  const arenaId = flags.has("arena") ? parseArena(flags.get("arena")!) : "arena-01";
  const matchSeconds = flags.has("match-seconds")
    ? parseIntFlag("match-seconds", flags.get("match-seconds")!)
    : defaultMatchSeconds(mode);

  if (matches <= 0) throw new Error(`parseArgs: --matches must be a positive integer, got ${matches}`);
  if (matchSeconds <= 0) {
    throw new Error(`parseArgs: --match-seconds must be a positive integer, got ${matchSeconds}`);
  }

  return {
    shape,
    matches,
    mode,
    difficulty: SKILL_TO_DIFFICULTY[skill],
    skill,
    seed,
    arenaId,
    matchSeconds,
    baseline: flags.get("baseline"),
    out: flags.get("out"),
    force: flags.has("force"),
  };
}
