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
  GameMode,
  isArenaId,
  modeConfigOf,
  modeLabelOf,
  modeOptions,
  parseModeArg,
  winRuleOf,
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
 * `--match-seconds` doubles as the mode's own `deathmatch.matchSeconds` when nothing overrides it
 * (Task 17 made `match.ts` set `state.matchEndsTick = setup.maxTicks`, so this harness's clock IS
 * the deathmatch clock, not a mock of it) — read from shared config rather than hardcoded, so a
 * future retune of the real match length keeps the harness in step with no edit needed here.
 *
 * Read off `modeConfigOf(mode)`, not the raw `DEATHMATCH_CONFIG` global (MC41). `matchSeconds` is
 * a per-mode table, so the raw read would have given every mode the DEFAULT mode's clock while
 * `--mode` claimed otherwise — the same defect this pass converted out of the playtest probes.
 * `modeConfigOf` is a pure registry lookup and needs no ACTIVE scope, which is what lets this stay
 * where it is: `parseArgs` runs before `run.ts` installs a bundle, deliberately, because which
 * bundle to install is the answer it produces.
 *
 * Keyed on `winRuleOf(mode)`, not on `mode === GameMode.FFA_DEATHMATCH` (2026-09-23). Every other
 * consumer of the win condition already asks `winRuleOf` — `match.ts`, `report.ts`, `ArenaRoom`,
 * the client's `spectate.ts` — so naming one enum value here made the clock the ONE place that
 * disagreed: a second mode whose win rule is `"deathmatch"` would have had `match.ts` run it as a
 * deathmatch while `maxTicks` came from the last-standing safety cap, and the sentence two
 * paragraphs above ("this harness's clock IS the deathmatch clock, not a mock of it") would have
 * quietly stopped being true.
 */
function defaultMatchSeconds(mode: GameMode): number {
  return winRuleOf(mode) === "deathmatch"
    ? modeConfigOf(mode).deathmatch.matchSeconds
    : LAST_STANDING_SAFETY_CAP_SECONDS;
}

/** `--shape=duel` defaults to last-standing — a duel wants one clean winner, not a timed brawl —
 * while every other shape defaults to deathmatch. `--mode` always overrides this. */
function defaultMode(shape: Shape): GameMode {
  return shape === "duel" ? GameMode.FFA_LAST_STANDING : GameMode.FFA_DEATHMATCH;
}

/**
 * The flat defaults, named once so `parseArgs` and `helpText` cannot drift apart — a `--help` page
 * that prints a default the parser no longer applies is worse than no page at all, and nothing
 * typed would catch it.
 */
const DEFAULT_SHAPE: Shape = "ffa";
const DEFAULT_SKILL: PlayerSkill = "pro";
const DEFAULT_MATCHES = 50;

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

/**
 * `--mode` names the mode this run measures — BOTH the win condition the matches play under and,
 * since MC41, the config bundle backing them (`run.ts` installs it). One flag for both, because
 * they were never two things: `GameMode.FFA_DEATHMATCH` IS the row whose tables Deathmatch plays on.
 *
 * `deathmatch` and `last-standing` are kept as aliases for the win-condition vocabulary this flag
 * shipped with — `last-standing` in particular is not a mode NAME (that row is called "Brawl"), so
 * dropping it would break every command line and README example written before this change.
 * Everything else routes to the shared `parseModeArg`, which takes the wire id or the display name
 * and throws naming every mode rather than falling back to a default.
 */
function parseMode(raw: string): GameMode {
  if (raw === "deathmatch") return GameMode.FFA_DEATHMATCH;
  if (raw === "last-standing") return GameMode.FFA_LAST_STANDING;
  try {
    return parseModeArg(raw);
  } catch (err) {
    // Re-thrown under this file's own `parseArgs:` prefix, the way every other flag's error reads,
    // with the legacy aliases named alongside the modes themselves.
    throw new Error(
      `parseArgs: --mode "${raw}" is not a known mode — expected one of: ${modeOptions()}, ` +
        `or the aliases "deathmatch" / "last-standing" (${(err as Error).message})`,
    );
  }
}

/**
 * Which arena every match runs in — **validated against the MODE's own arena set**, not merely
 * against the global arena registry (2026-09-23).
 *
 * `--mode=X` installs X's bundle and stamps X on the report. Until this check existed, `--arena`
 * was held to `isArenaId` alone and the DEFAULT was the hardcoded `"arena-01"`, so a mode
 * authoring `arenas: ["arena-03"]` produced a complete, confident report labelled with that mode
 * and measured entirely in an arena that mode never plays — the exact "one mode's numbers reported
 * as another's" failure the per-mode work exists to stop.
 *
 * **Refused, not marked.** A banner in the report was the alternative; this file's own header
 * already rules on that question for every other flag ("an unknown flag, or a value that fails to
 * parse, throws rather than being ignored ... silently dropping a typo'd `--matchs=10` would
 * produce a run that looks complete but never did what its command line claimed"). An arena the
 * mode does not play is that same class of mistake, and a marked report still leaves real numbers
 * in a Deltas table for someone to read past the banner. The error names the mode's legal set, so
 * the fix is in the message.
 */
function parseArena(raw: string, mode: GameMode): string {
  if (!isArenaId(raw)) throw new Error(`parseArgs: --arena "${raw}" is not a known arena id`);
  const allowed = modeConfigOf(mode).arenas;
  if (!allowed.includes(raw)) {
    throw new Error(
      `parseArgs: --arena "${raw}" is not an arena ${modeLabelOf(mode)} plays — that mode's ` +
        `arenas are: ${allowed.join(", ")}`,
    );
  }
  return raw;
}

/**
 * The mode's OWN first arena — `arenas[0]` is the one a mode actually plays, the rest of the list
 * being what it may play — replacing a hardcoded `"arena-01"` that was mode-blind. See
 * `parseArena` above for what that cost.
 */
function defaultArena(mode: GameMode): string {
  return modeConfigOf(mode).arenas[0];
}

/** Every flag this CLI recognises. Anything else in `argv` is a typo and `parseArgs` throws naming
 * it, rather than silently ignoring it (per this file's own header). Exported so `cli.test.ts` can
 * hold `helpText` to it: a flag added here but never documented there fails the suite. */
export const KNOWN_FLAGS = new Set([
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
  "include-inactive",
  "help",
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
 * Does this argument list ask for the flag list? Checked by `run.ts` BEFORE `parseArgs`, so `--help`
 * still prints when it sits beside the very typo the user is trying to look up — the whole point of
 * the page. `-h` is accepted here even though it cannot survive `parseArgs`'s `--name=value`
 * tokenizer, for the same reason: someone reaching for help should get help, not a lecture about
 * argument syntax.
 *
 * `help` is in `KNOWN_FLAGS` too, so a caller that skips this check and hands `--help` straight to
 * `parseArgs` gets an ordinary run rather than an "unknown flag --help" error contradicting the
 * message every other unknown flag prints.
 */
export function wantsHelp(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--help" || arg === "-h" || arg.startsWith("--help="));
}

/**
 * The `--help` page. Every default it prints comes from the same constant `parseArgs` applies (or
 * from shared config, for `--match-seconds`), never a retyped literal — this page is prose, and
 * nothing typed would catch it going stale otherwise. Kept here rather than in `run.ts` so it sits
 * beside `KNOWN_FLAGS`: a flag added there without a line here is visible in one screenful.
 */
export function helpText(): string {
  const deathmatchDefault = defaultMatchSeconds(GameMode.FFA_DEATHMATCH);
  return [
    "npm run balance -- [flags]",
    "",
    "Headless win-rate / matchup harness. Runs matches with bots, aggregates the results, and",
    "writes a report under packages/server/balance/reports/<date-NN>/.",
    "",
    "Flags (all --name=value; order does not matter):",
    "",
    `  --shape=ffa|duel            (default ${DEFAULT_SHAPE}) ffa seats one 2/2/2 six-car match; duel cycles`,
    "                              all nine ordered chassis pairs, --matches EACH. Past six chassis",
    "                              ffa rotates which six play each match; duel is unaffected.",
    `  --matches=<n>               (default ${DEFAULT_MATCHES}) matches per run (ffa) or per ordered pair (duel).`,
    "  --mode=<id|name>            (default last-standing for duel, deathmatch otherwise) the mode this",
    `                              run measures — its win condition AND its config bundle. One of:`,
    `                              ${modeOptions()}; the aliases "deathmatch" and "last-standing"`,
    "                              still work. An inactive mode is measurable on purpose: an",
    "                              unpublished mode is the one whose numbers nobody has seen.",
    `  --skill=pro|casual|amateur  (default ${DEFAULT_SKILL}) player type; maps to bot difficulty ` +
      `${SKILL_TO_DIFFICULTY.pro}|${SKILL_TO_DIFFICULTY.casual}|${SKILL_TO_DIFFICULTY.amateur}.`,
    "  --seed=<int>                (default: a fresh random seed, printed first) the run is a pure",
    "                              function of this — same seed, same matches, replayed exactly.",
    "  --arena=<arena-id>          (default: the mode's own arenas[0]) which arena every match runs",
    "                              on. Refused if the mode does not play it — a report labelled with",
    "                              one mode and measured in another's arena is worse than no report.",
    `  --match-seconds=<n>         (default ${deathmatchDefault} for deathmatch, ` +
      `${LAST_STANDING_SAFETY_CAP_SECONDS} for last-standing) per-match`,
    "                              clock. For deathmatch this IS the game's clock; for last-standing",
    "                              it is a stalemate cap, and hitting it is itself a finding.",
    "  --baseline=<dir>            (default: none) a previous run's directory; adds a \"Deltas vs",
    "                              baseline\" section. Refuses to run, before any match, if the config",
    "                              or bot fingerprint, shape, mode or skill differs.",
    "  --force                     (default off) run a refused --baseline comparison anyway; the",
    "                              report carries a banner naming every mismatch. No-op without",
    "                              --baseline.",
    "  --include-inactive          (default off) also seat chassis with CarDef.isActive false, so a",
    "                              car still in development can be measured before it is published.",
    "                              A chassis carrying no weapons is skipped either way. Refuses a",
    "                              --baseline comparison against a run that did not use it.",
    "  --out=<dir>                 (default: a fresh dated folder under reports/) write there instead.",
    "  --help, -h                  Print this and exit.",
    "",
    "Examples:",
    "  npm run balance -- --shape=duel --matches=20 --seed=7",
    "  npm run balance -- --matches=100 --seed=7 --out=balance/reports/before",
    "  npm run balance -- --matches=100 --seed=7 --baseline=balance/reports/before",
    "",
    "See packages/server/balance/README.md for the paired-run workflow, how to read a win-rate",
    "interval, and the harness's known distortions.",
  ].join("\n");
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

  const shape = flags.has("shape") ? parseShape(flags.get("shape")!) : DEFAULT_SHAPE;
  const mode = flags.has("mode") ? parseMode(flags.get("mode")!) : defaultMode(shape);
  const skill = flags.has("skill") ? parseSkill(flags.get("skill")!) : DEFAULT_SKILL;
  const matches = flags.has("matches")
    ? parseIntFlag("matches", flags.get("matches")!)
    : DEFAULT_MATCHES;
  const seed = flags.has("seed") ? parseIntFlag("seed", flags.get("seed")!) : randomSeed();
  const arenaId = flags.has("arena") ? parseArena(flags.get("arena")!, mode) : defaultArena(mode);
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
    // Bare boolean, same shape as `--force` and deliberately NOT in `REQUIRES_EXPLICIT_VALUE`:
    // `--include-inactive` and `--include-inactive=true` both set it, which is how anyone would
    // reach for it.
    includeInactive: flags.has("include-inactive"),
    baseline: flags.get("baseline"),
    out: flags.get("out"),
    force: flags.has("force"),
  };
}
