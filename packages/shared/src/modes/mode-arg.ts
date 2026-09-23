/**
 * `--mode=<id|name>` for the headless tooling (MC41): `npm run ttk`, `npm run balance` and
 * `npm run playtest` all select which mode's bundle they measure, and all three parse the flag
 * through this one module so the accepted spellings, the report label and the report directory's
 * name cannot drift apart between them.
 *
 * **An unknown mode throws, naming every mode that exists.** The whole point of per-mode tooling is
 * that a report says which game it measured; a typo that quietly fell back to `DEFAULT_GAME_MODE`
 * would produce a report labelled with the mode the reader asked for and filled with another one's
 * numbers — the exact failure this phase exists to remove.
 *
 * **An INACTIVE mode is accepted.** `MODE_TABLE`'s `isActive` is the LOBBY's publish gate, and the
 * registry's own header already says the playground, practice and this harness family "pin or pass
 * a mode directly and never read this flag". Measuring a mode before publishing it is the point of
 * measuring it at all — a mode nobody can reach from a lobby is exactly the one whose numbers
 * nobody has seen. `modeLabelOf` marks it `inactive` in every header it reaches, so a report can
 * never quietly be about an unpublished mode.
 */
import type { GameMode } from "../constants.js";
import { MODE_TABLE, isGameMode } from "./registry.js";

/**
 * Lowercase, hyphenated form of a mode's display name — `"Team brawl"` becomes `"team-brawl"`.
 *
 * Two jobs, deliberately one function: it is the suffix a report directory carries (so a folder
 * name says which mode it measured), and it is the normalised form `parseModeArg` matches a typed
 * argument against (so `--mode="Team Brawl"`, `--mode=team-brawl` and `--mode=team_brawl` are all
 * the same mode). A single function means the spelling a folder shows is always a spelling the
 * flag accepts.
 */
export function modeSlug(mode: GameMode): string {
  return normalise(MODE_TABLE[mode].name);
}

/** The normalisation both sides of a name match go through: trim, fold case, and collapse every
 * run of non-alphanumerics into a single hyphen. */
function normalise(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * How a harness names its mode in a header, a console line or an error: `Deathmatch (mode 2)`, and
 * `Team brawl (mode 1, inactive)` for one that no lobby publishes. The wire id rides alongside the
 * name because the name is what a reader recognises and the id is what `run.json` stores.
 */
export function modeLabelOf(mode: GameMode): string {
  const def = MODE_TABLE[mode];
  // Tolerant of an unknown value on purpose: the balance harness labels a BASELINE's mode with
  // this, and a baseline is arbitrary JSON off disk that may name a mode this build no longer has.
  // Refusing that comparison is `checkComparable`'s job; crashing while printing why is nobody's.
  if (def === undefined) return `unknown mode ${String(mode)}`;
  return `${def.name} (mode ${mode}${def.isActive ? "" : ", inactive"})`;
}

/** Every accepted spelling, one per mode, for a `--help` page and for the error below:
 * `0/brawl, 1/team-brawl (inactive), 2/deathmatch`. */
export function modeOptions(): string {
  return everyMode()
    .map((mode) => `${mode}/${modeSlug(mode)}${MODE_TABLE[mode].isActive ? "" : " (inactive)"}`)
    .join(", ");
}

/** Numeric ascending, so the list a reader sees is the same every time and matches the wire ids. */
function everyMode(): GameMode[] {
  return Object.keys(MODE_TABLE)
    .map((key) => Number(key) as GameMode)
    .sort((a, b) => a - b);
}

/**
 * Resolve one `--mode=` value: the numeric wire id (`2`) or the display name in any casing or
 * separator (`Deathmatch`, `deathmatch`, `Team Brawl`, `team-brawl`). Throws on anything else,
 * naming every mode — never falls back to a default.
 */
export function parseModeArg(raw: string): GameMode {
  const text = raw.trim();

  // A bare integer is the wire id. Checked before the name match so a future mode literally named
  // "2" could not shadow the id 2 — ids are the stable form and win.
  if (/^\d+$/.test(text)) {
    const id = Number.parseInt(text, 10);
    if (isGameMode(id)) return id;
    throw new Error(`--mode: ${id} is not a known game mode — expected one of: ${modeOptions()}`);
  }

  const wanted = normalise(text);
  for (const mode of everyMode()) {
    if (modeSlug(mode) === wanted) return mode;
  }

  throw new Error(`--mode: unknown mode "${raw}" — expected one of: ${modeOptions()}`);
}
