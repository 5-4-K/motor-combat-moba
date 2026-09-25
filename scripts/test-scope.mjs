#!/usr/bin/env node
/**
 * Maps a diff (a set of changed paths) to the tests and playtests it owes (GM35).
 *
 * The mode-folder split (Part C) means most changes touch exactly one mode's own folders, and
 * running the full suite plus every mode's playtest for a one-line HUD tweak is the thing this
 * exists to stop. `scopeOf` decides, from the changed paths alone, whether the diff is:
 *
 *   - `"none"`     — nothing that owes a test moved (docs, READMEs outside packages/scripts).
 *   - `"mode"`     — every changed path sits inside one or more modes' own folders. Only those
 *                    modes' scoped tests and playtest runs are owed.
 *   - `"full"`     — at least one changed path is common code (or an untracked/unrecognised shape),
 *                    so nothing short of the whole suite can be trusted.
 *
 * A mode's own folder is `packages/{shared,client}/src/modes/<slug>/`, that mode's snapshot file,
 * or (via its RULE FAMILY — several slugs can share one controller/rules implementation, see
 * `MODE_FAMILY`) `packages/{server,shared,client}/src/modes/<family>/` and
 * `packages/server/playtest/modes/<family>/`. Anything else — including the `modes/` ROOT files
 * (`merge.ts`, `registry.ts`, `contract.test.ts`, …) which are common code sitting at that same
 * directory depth — is common, and common code anywhere in the diff promotes the whole diff to
 * `"full"`: a shared accessor or a rules-registry edit can change every mode's behaviour at once,
 * so scoping it to "whichever mode's folder happened to also be touched" would be a lie.
 *
 * `docs/turn-tuning.md` is a deliberate exception to "docs never owe tests": it is the one doc a
 * test (`scripts/turn-tuning-doc.test.mjs`) reads values out of, so a change to it is treated as
 * code, not prose — hence `"full"` rather than `"none"`.
 */
import { execFileSync, execSync } from "node:child_process";

// Static, like the other tooling scripts (`mode-rosters.mjs`) that read built shared: only the
// `"full"` scope in `commandsFor` below actually calls these, but importing lazily would mean an
// ESM/CJS interop dance for no benefit — every caller of this module already runs after
// `npm run build -w @motor-combat-moba/shared` (the root `test:common`/`test:affected` scripts, and
// the CLI entry point below), and the unit tests that exercise `scopeOf`/`commandsFor` never reach
// the `"full"` branch of `commandsFor`.
import { activeGameModes, modeSlug } from "../packages/shared/dist/index.js";

/** Which modes share a rules/controller FAMILY (server `modes/<family>/`, and the mirror folders
 * in shared/client, plus `server/playtest/modes/<family>/`). Brawl and Team brawl both run the
 * `last-standing` family; Deathmatch and Conquer are each their own family today. */
export const MODE_FAMILY = {
  brawl: "last-standing",
  "team-brawl": "last-standing",
  deathmatch: "deathmatch",
  conquer: "conquer",
};

/** Every slug that shares a given family, in `MODE_FAMILY`'s own insertion order. */
function slugsInFamily(family) {
  return Object.keys(MODE_FAMILY).filter((slug) => MODE_FAMILY[slug] === family);
}

/**
 * Which mode slug(s) a single changed path belongs to, or `null` if it is not a per-mode path at
 * all (common code, or something outside `packages/`). A family-scoped path (e.g.
 * `packages/server/src/modes/last-standing/…`) expands to every slug in that family.
 */
function slugsForPath(path) {
  // Checked before the general per-slug pattern below: `__snapshots__` is not itself a mode slug,
  // so without this ordering the per-slug regex would greedily capture it as one.
  const snapshot = /^packages\/shared\/src\/modes\/__snapshots__\/([^/]+)\.tables\.json$/.exec(path);
  if (snapshot) return [snapshot[1]];

  const perSlug = /^packages\/(?:shared|client)\/src\/modes\/([^/]+)\//.exec(path);
  if (perSlug) return [perSlug[1]];

  const perFamily =
    /^packages\/server\/src\/modes\/([^/]+)\//.exec(path) ||
    /^packages\/shared\/src\/modes\/([^/]+)\//.exec(path) ||
    /^packages\/client\/src\/modes\/([^/]+)\//.exec(path) ||
    /^packages\/server\/playtest\/modes\/([^/]+)\//.exec(path);
  if (perFamily) {
    const family = perFamily[1];
    const slugs = slugsInFamily(family);
    // The captured segment might itself already be a slug (e.g. `deathmatch`, `conquer`) rather
    // than a family name with several slugs under it — `slugsInFamily` returns [] for anything
    // that is not a KEY of `MODE_FAMILY` (i.e. not a family name), so fall back to treating the
    // captured segment as a direct slug in that case.
    if (slugs.length > 0) return slugs;
    if (Object.prototype.hasOwnProperty.call(MODE_FAMILY, family)) return [family];
    // A folder under `modes/` that names neither a known slug nor a known family (e.g. the
    // `modes/` root files this regex should never have matched — `merge.ts`, `registry.ts`,
    // `contract.test.ts`) is common code, not per-mode.
    return null;
  }

  return null;
}

/** A `docs/` path this repo treats as common (tested) code rather than inert prose. */
const TESTED_DOCS = new Set(["docs/turn-tuning.md"]);

/**
 * Drop paths that own no test at all: everything under `docs/` except the ones in `TESTED_DOCS`
 * (rule 1's first clause), and any other `.md` file outside `packages/` and `scripts/` (READMEs,
 * root-level notes). Everything else survives to the mode/common classification below.
 */
function relevantPaths(paths) {
  return paths.filter((path) => {
    if (path.startsWith("docs/")) return TESTED_DOCS.has(path);
    if (path.endsWith(".md") && !path.startsWith("packages/") && !path.startsWith("scripts/")) return false;
    return true;
  });
}

/**
 * Decide the test scope a set of changed paths owes.
 *
 * @param {string[]} changedPaths
 * @returns {{ scope: "none" } | { scope: "mode", modes: string[], commonProbes: boolean } | { scope: "full" }}
 */
export function scopeOf(changedPaths) {
  const kept = relevantPaths(changedPaths);
  if (kept.length === 0) return { scope: "none" };

  const modes = new Set();
  let commonProbes = false;

  for (const path of kept) {
    const slugs = slugsForPath(path);
    if (slugs === null) return { scope: "full" };
    for (const slug of slugs) modes.add(slug);

    const isConfigFile = /^packages\/(?:shared|client)\/src\/modes\/[^/]+\/config\.ts$/.test(path);
    const isSnapshot = /^packages\/shared\/src\/modes\/__snapshots__\/[^/]+\.tables\.json$/.test(path);
    if (isConfigFile || isSnapshot) commonProbes = true;
  }

  return { scope: "mode", modes: [...modes].sort(), commonProbes };
}

/** Shell commands (in order) for a resolved scope. Callers with `--run` execute these in order. */
export function commandsFor(scope) {
  if (scope.scope === "none") return [];

  if (scope.scope === "mode") {
    const commands = [];
    for (const slug of scope.modes) {
      commands.push(`npm run test:mode -- ${slug}`);
      commands.push(`npm run playtest -- --mode=${slug} --scope=mode`);
      if (scope.commonProbes) commands.push(`npm run playtest -- --mode=${slug} --scope=common`);
    }
    return commands;
  }

  // scope === "full"
  const commands = ["npm test"];
  for (const mode of activeGameModes()) {
    commands.push(`npm run playtest -- --mode=${modeSlug(mode)} --scope=all`);
  }
  return commands;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Every changed path this run should consider: the diff against `base`, the working tree's
 * unstaged and staged changes, and untracked files — unioned, so nothing slips through because it
 * was only staged, or only untracked, or only committed. */
function collectChangedPaths(base) {
  const sets = [
    git(["diff", "--name-only", `${base}...HEAD`]),
    git(["diff", "--name-only"]),
    git(["diff", "--name-only", "--cached"]),
    git(["ls-files", "--others", "--exclude-standard"]),
  ];
  return [...new Set(sets.flat())];
}

async function main() {
  const args = process.argv.slice(2);
  const run = args.includes("--run");
  const baseArg = args.find((arg) => arg.startsWith("--base="));
  const base = baseArg ? baseArg.slice("--base=".length) : "origin/development/main";

  const changedPaths = collectChangedPaths(base);
  const scope = scopeOf(changedPaths);
  const commands = commandsFor(scope);

  console.log(`test-scope: ${JSON.stringify(scope)}`);
  for (const command of commands) console.log(`  ${command}`);

  if (!run) return;

  for (const command of commands) {
    console.log(`\n$ ${command}`);
    try {
      execSync(command, { stdio: "inherit" });
    } catch (error) {
      process.exitCode = typeof error.status === "number" ? error.status : 1;
      return;
    }
  }
}

// Run only when invoked directly (`node scripts/test-scope.mjs`), not when imported by the tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
