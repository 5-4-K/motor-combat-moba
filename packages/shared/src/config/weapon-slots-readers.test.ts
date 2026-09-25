// `fireSlotsOf`'s doc comment names its live readers, and the root `CLAUDE.md` calls that list
// "the authoritative list" — the whole point being that adding a reader is a deliberate act rather
// than a habit. A hand-maintained list of call sites is exactly the kind of thing that rots, and
// this one rotted THREE TIMES IN ONE DAY (2026-09-23): it was missing
// `AssetTuningScene.drawTurret`; the correction still said `scripts/ttk.mjs` had two call sites
// when it has three, and omitted `scripts/mode-rosters.mjs` entirely; and THAT correction omitted
// `weaponCarriers` — a reader added by the very commit that was fixing the list. A fourth hand
// correction would rot the same way, so the list is held to the tree here instead.
//
// **It asserts FILES, not call-site counts.** A count is what rotted twice; a file list is what a
// reader actually needs — "which files ask this question" — and a per-file count in prose can go
// stale without making the list untrue. The doc comment stays readable prose and the paths are
// parsed back out of it, rather than being restructured into a machine-readable block nobody
// enjoys reading: the one rule the prose owes this test is that every reader is named by its FULL
// project-relative path inside backticks (``packages/server/playtest/common/weapons.ts``, not "`weapons.ts`
// in `packages/server/playtest/`").
//
// The corollary of that rule, and the one way to surprise yourself here: a full path in this doc
// comment is read as a CLAIM that the file calls `fireSlotsOf`, wherever in the comment it appears.
// The `newFireState` paragraph names its file the package-relative way (`sim/weapons/fire.ts`) for
// exactly this reason — it is the paragraph saying that file does NOT call it. Spell a
// non-reader's path in full and this test will fail, naming it as listed-but-not-calling, which is
// the right failure for a list whose job is to be exact.
//
// Mechanism follows `modes/no-raw-config-in-sim.test.ts` (directory walk over labelled roots,
// comments and imports stripped before the match, a temp-root tripwire proving the walk really
// walks) rather than inventing a third source-scanning idiom.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Roots are resolved from THIS FILE'S OWN LOCATION, never `process.cwd()` — `npx vitest run
// <path>` from the repo root and from `packages/shared` must walk the identical tree. `SHARED_SRC`
// lands on `packages/shared/src` regardless of which directory the process started in.
// `fileURLToPath` on a directory URL keeps its trailing slash; strip it so `label +
// file.slice(dir.length)` below (dir === SHARED_SRC) reconstructs the separator correctly instead
// of eating it.
const SHARED_SRC = fileURLToPath(new URL("..", import.meta.url)).replace(/[/\\]+$/, "");
const PACKAGES_ROOT = join(SHARED_SRC, "..", "..");
const REPO_ROOT = join(PACKAGES_ROOT, "..");

/** The file under test: its own doc comment is the thing being checked, so it is never a reader. */
const SOURCE = join(SHARED_SRC, "config/weapon-slots.ts");
/** The same file as the walk labels it — what the exclusion below has to match. */
const SOURCE_PATH = "packages/shared/src/config/weapon-slots.ts";

/**
 * Every root a reader could live in. `dist` and `node_modules` are not walked because no root
 * names one; the guard below re-proves that by skipping them by name anyway, since a stray build
 * output inside a source root would otherwise report the SAME reader twice under a path the doc
 * comment can never legitimately name.
 *
 * `label` is the project-relative prefix, so a failure reads the same whichever package's `cwd`
 * ran the test and matches the spelling the doc comment uses.
 */
const ROOTS: ReadonlyArray<{ label: string; dir: string }> = [
  { label: "packages/shared/src", dir: SHARED_SRC },
  { label: "packages/client/src", dir: join(PACKAGES_ROOT, "client/src") },
  { label: "packages/server/src", dir: join(PACKAGES_ROOT, "server/src") },
  { label: "packages/server/playtest", dir: join(PACKAGES_ROOT, "server/playtest") },
  { label: "packages/server/balance", dir: join(PACKAGES_ROOT, "server/balance") },
  { label: "scripts", dir: join(REPO_ROOT, "scripts") },
];

const SKIP_DIRS = new Set(["node_modules", "dist", "reports"]);
const SOURCE_FILE = /\.(?:ts|mts|mjs|js)$/;

/**
 * Source files under `dir`. Tests are excluded on purpose: `fireSlotsOf`'s own unit test calls it,
 * and so may any future test, but a test exercising a function is not a READER of it in the sense
 * the doc comment means — the list exists to say which parts of the shipped game and its tooling
 * ask "what can this car fire". `duel.fixture.ts` is deliberately still in scope: it is a fixture,
 * not a `.test.` file, and it models the bot's press ceiling, which is a real answer to that
 * question.
 */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (SKIP_DIRS.has(e.name) ? [] : walk(join(dir, e.name)))
    : SOURCE_FILE.test(e.name) && !e.name.includes(".test.") && !e.name.endsWith(".d.ts")
      ? [join(dir, e.name)]
      : []);
}

/**
 * A file's source reduced to code that could actually CALL something: block comments, line comments
 * and import statements removed. This is not optional tidiness — a dozen files across the repo
 * discuss `fireSlotsOf` in prose (`config/types.ts`, `sim/weapons/turret.ts`, the playtest probes'
 * own headers) and `index.ts` re-exports the name, and every one of them would otherwise read as a
 * reader. The `[^:]` guard on the line-comment pattern is this repo's own idiom, so a `://` inside
 * a string is not mistaken for a comment.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\bimport\s[\s\S]*?from\s*["'][^"']*["'];?/g, "");
}

/** A CALL, not a mention: the identifier followed by an open paren. A re-export cannot match. */
const CALL = /\bfireSlotsOf\s*\(/;

function callsFireSlotsOf(file: string): boolean {
  return CALL.test(code(file));
}

/** Every file in the tree that calls `fireSlotsOf`, as project-relative paths, sorted. */
function callSiteFiles(extraRoots: ReadonlyArray<{ label: string; dir: string }> = []): string[] {
  return [...ROOTS, ...extraRoots]
    .flatMap(({ label, dir }) => walk(dir).map((file) => ({ file, path: label + file.slice(dir.length) })))
    .filter(({ path }) => path !== SOURCE_PATH)
    .filter(({ file }) => callsFireSlotsOf(file))
    .map(({ path }) => path)
    .sort();
}

/** A full project-relative source path inside backticks — the one shape the prose owes this test. */
const DOCUMENTED_PATH = /`((?:packages|scripts)\/[A-Za-z0-9._/-]+\.(?:ts|mts|mjs|js))`/g;

/**
 * The paths named in `fireSlotsOf`'s own doc comment — the block comment immediately above it,
 * never the file's other comments, so `slotsOf`'s and `slotsFrom`'s prose cannot smuggle an entry
 * in or out.
 */
function documentedReaders(): string[] {
  const source = readFileSync(SOURCE, "utf8");
  const declaration = source.indexOf("export function fireSlotsOf");
  expect(declaration, `${SOURCE} no longer declares fireSlotsOf`).toBeGreaterThan(-1);
  const commentStart = source.lastIndexOf("/**", declaration);
  expect(commentStart, "fireSlotsOf has no doc comment to hold").toBeGreaterThan(-1);
  const doc = source.slice(commentStart, declaration);
  return [...new Set([...doc.matchAll(DOCUMENTED_PATH)].map((m) => m[1]))].sort();
}

describe("fireSlotsOf's documented reader list is held to the tree", () => {
  it("names every file that calls it, and no file that does not", () => {
    expect(documentedReaders()).toEqual(callSiteFiles());
  });

  // A list that matched an empty tree would pass vacuously and teach nobody anything; this is the
  // same liveness check `no-raw-config-in-sim.test.ts` gives its allow-list.
  it("is not vacuous — the tree really does have readers to find", () => {
    expect(callSiteFiles().length).toBeGreaterThan(0);
  });

  // The regression this guard exists to catch, proven rather than asserted: a new reader in a file
  // the comment does not name must fail, NAMING that file. The fixture goes in a temp directory
  // appended to the real roots, never inside a walked source root — a `finally` does not survive a
  // hard kill, and what a kill would leave behind is a stray file that the next run reports as a
  // real reader, in the one guard whose whole job is to be believed.
  it("fails when a new call site appears in a file the comment does not name", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "fire-slots-tripwire-"));
    const fixturePath = join(tempRoot, "__tripwire-fixture.ts");
    const extraRoots = [{ label: "tripwire", dir: tempRoot }];
    try {
      writeFileSync(
        fixturePath,
        'import { fireSlotsOf } from "@motor-combat-moba/shared";\n' +
          'export const kit = () => fireSlotsOf("bastion");\n',
      );
      expect(callSiteFiles(extraRoots)).toContain("tripwire/__tripwire-fixture.ts");
      // A mention that is not a call — a doc comment, a re-export — must NOT count, or every file
      // that merely discusses the function would be dragged onto the list.
      writeFileSync(
        fixturePath,
        "/** Explains `fireSlotsOf(carId)` without calling it. */\n" +
          'export { fireSlotsOf } from "@motor-combat-moba/shared";\n',
      );
      expect(callSiteFiles(extraRoots)).not.toContain("tripwire/__tripwire-fixture.ts");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
