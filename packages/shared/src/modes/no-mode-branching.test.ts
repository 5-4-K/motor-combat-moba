// GM2 (Task 9): common code must never branch on a SPECIFIC game mode — it asks `rulesOf(mode)`,
// `controllerOf(mode)` or `hudOf(mode)` for the FACT it needs, and that fact lives in the mode's own
// module. Branching on `GameMode.FOO`, the deleted `winRuleOf`, or a bare win-rule string
// ("conquer"/"deathmatch"/"last_standing") outside `modes/` is exactly the shape `flow/modes.ts`'s
// old exhaustive switch had, and this guard is what stops it coming back one call site at a time.
//
// Modelled on `no-raw-config-in-sim.test.ts`: comments and import statements are stripped before
// matching (the codebase's own doc comments narrate this history in prose, using the very names this
// guard bans — a stripped-comments walk is what lets the file you are reading right now say
// "GameMode.FOO" without becoming an offender), the walk is rooted at THIS FILE'S OWN LOCATION so it
// is `cwd`-independent, and a `*.test.ts` file is never walked (a test fixture legitimately builds a
// `GameMode.X` value to set up its scenario).
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SHARED_SRC = fileURLToPath(new URL("..", import.meta.url)).replace(/[/\\]+$/, "");
const PACKAGES_ROOT = join(SHARED_SRC, "..", "..");

const ROOTS: ReadonlyArray<{ label: string; dir: string }> = [
  { label: "packages/shared/src", dir: SHARED_SRC },
  { label: "packages/server/src", dir: join(PACKAGES_ROOT, "server/src") },
  { label: "packages/client/src", dir: join(PACKAGES_ROOT, "client/src") },
];

/**
 * Judged legitimate (Task 9 Step 2) — each entry is a project-relative file path with the one-line
 * reason it may still branch on a specific mode.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  "packages/shared/src/constants.ts": "defines the enum",
  "packages/shared/src/modes/registry.ts": "is under /modes/ anyway",
  "packages/server/src/config/mode-bot.ts": "Record<GameMode, BotModeConfig> registry",
  "packages/server/src/rooms/PracticeRoom.ts": "practice pins FFA_DEATHMATCH (room kind, GM21)",
  "packages/client/src/scenes/PracticeSetupScene.ts": "installs practice's pinned mode",
};

const BANNED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bGameMode\.[A-Z_]+\b/,
  /\bwinRuleOf\b/,
  /["'](conquer|deathmatch|last_standing)["']/,
];

/** True if `file` is under `/modes/` (any package) — its own carve-out, same as the brief's list. */
function isUnderModesDir(file: string): boolean {
  return file.split(/[/\\]/).includes("modes");
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name))
    : e.name.endsWith(".ts") && !e.name.includes(".test.") ? [join(dir, e.name)] : []);
}

/** Comments and import statements stripped, same idiom as the raw-config guard's `harnessCode`. */
function strippedCode(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\bimport\s[\s\S]*?from\s*["'][^"']*["'];?/g, "");
}

/** Every `file:line` where a stripped, non-import, non-comment line matches a banned pattern. */
function offendingLines(file: string): string[] {
  const lines = strippedCode(file).split("\n");
  const hits: string[] = [];
  lines.forEach((line, i) => {
    if (BANNED_PATTERNS.some((re) => re.test(line))) {
      hits.push(`${file}:${i + 1} branches on a specific game mode — move it into that mode's module (GM2)`);
    }
  });
  return hits;
}

describe("common code never branches on a specific game mode (GM2)", () => {
  it("has no GameMode.X / winRuleOf / win-rule-string branch outside modes/ and the judged allow-list", () => {
    const offenders = ROOTS.flatMap(({ label, dir }) =>
      walk(dir)
        .filter((file) => !isUnderModesDir(file))
        .map((file) => ({ file, rel: label + file.slice(dir.length) }))
        .filter(({ rel }) => !(rel in ALLOWED))
        .flatMap(({ file }) => offendingLines(file)),
    );
    expect(offenders).toEqual([]);
  });

  // Unlike the raw-config guard's own liveness check, this one only asserts the file still EXISTS,
  // not that it still matches a banned pattern: "defines the enum" and "is under /modes/ anyway" are
  // structural reasons a file is exempt, not claims that its own source currently trips a pattern —
  // `constants.ts` DEFINES `GameMode.CONQUER = 3`, it never WRITES `GameMode.CONQUER` as a reference.
  it("the allow-list itself names only files that still exist", () => {
    for (const relPath of Object.keys(ALLOWED)) {
      const full = join(PACKAGES_ROOT, "..", relPath);
      expect(() => readFileSync(full, "utf8"), relPath).not.toThrow();
    }
  });

  // The regression this guard exists to catch, proven rather than asserted: a mode-name branch
  // reintroduced anywhere in the walked trees must fail, naming the file and line. Written into a
  // TEMP DIRECTORY appended to the roots (same reasoning as the raw-config guard's own tripwire) so a
  // hard kill mid-test leaves nothing inside a real walked tree for the next run to misreport.
  it("fails when a mode-name branch is reintroduced", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "mc-branch-tripwire-"));
    const fixturePath = join(tempRoot, "__tripwire-fixture.ts");
    try {
      writeFileSync(
        fixturePath,
        'import { GameMode } from "@motor-combat-moba/shared";\n' +
          "export function f(mode: GameMode): boolean {\n" +
          "  return mode === GameMode.CONQUER;\n" +
          "}\n",
      );
      const roots = [...ROOTS, { label: "tripwire", dir: tempRoot }];
      const offenders = roots.flatMap(({ dir }) => walk(dir).flatMap((file) => offendingLines(file)));
      expect(offenders.some((line) => line.startsWith(fixturePath))).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
