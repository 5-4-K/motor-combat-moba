// Guards MC13 (see task-5-brief.md Step 3, and task-5b-brief.md which widened it). Every config
// table read — in `sim/`, and since task 5b in every non-test file under `packages/client/src` and
// `packages/server/src` too — must go through the mode bundle's accessors — `drive()`, `ram()`,
// `impulse()`, `combat()`, `spike()`, `turret()`, `statusConfig()`, `statusTable()`, `statusLimits()`,
// `slots()`, `cars()`, `weapons()`, `flow()`, `deathmatch()`, `conquer()`, `camera()`, `derived()`
// (`../modes/active.js`) — never a RAW global (`WEAPON_TABLE`, `CAR_TABLE`, `DRIVE_CONFIG`, ...) in
// any form. A raw read is invisible to a playground retune's rebuilt bundle and to a room ticking inside a
// non-default mode's `withMode` scope, so this walks every non-test file under the three roots and
// fails, naming the offenders, the moment one creeps back in.
//
// Widened a third time for MC41 (2026-09-23): the two headless harnesses,
// `packages/server/playtest` and `packages/server/balance`, which this guard had NEVER walked —
// see the block at the bottom of this file for what that cost and what the harness sweep allows.
//
// Widened after fix round 1 (see task-4-5-report.md): the original pattern required a literal `.`
// right after the identifier, so it missed a destructured read (`const { x } = DRIVE_CONFIG`) and a
// bracketed one (`CAR_TABLE[id]`) — both found by hand, not by this test. `BANNED` now matches the
// bare identifier in ANY form — dotted, bracketed, destructured, or passed as a bare reference —
// since none of these all-caps table/config names have any legitimate reason to appear in a walked
// file's source at all; the accessors are separate, lowercase identifiers. The one carve-out is a
// line that is purely a type-only import (`import type { ... }`), in case a type sharing one of
// these exact names is ever imported for its type alone.
//
// Widened again for task 5b (see task-5b-report.md): `sim/` never had a reason to read `FLOW_CONFIG`
// or `CAMERA_CONFIG` (lobby/countdown timing and client camera framing are not sim concerns), so the
// original list never needed to ban them — but `packages/server/src/rooms/` and
// `packages/client/src/scenes/`/`ui/` genuinely do read them, raw, in several places (ArenaRoom's
// countdown/reveal/car-select ticks, the countdown module's own tick count, the join screen's name
// cap, ArenaScene's camera zoom/lerp/free-roam speed). Both are part of `ModeTables` with live
// accessors (`flow()`, `camera()`) already exported, so they are added here. `WEAPON_TICKS`,
// `SPIKE_TICKS`, `DEATHMATCH_CONFIG` and `DEATHMATCH_TICKS` are added for the same reason — real
// mode-bundle globals with real accessors (`derived().weaponTicks`/`.spikeTicks`, `deathmatch()`,
// `derived().deathmatchTicks`) that the original sim-scoped list simply never needed. `CHASSIS_DRIVE`
// joins them for completeness (`derived().chassisDrive`), though no walked file was found reading it
// raw.
//
// `BASIC_ATTACK_CONFIG` was never added to `BANNED` above — it stayed a genuine build-time global
// outside the per-mode bundle from task 5b through the rest of the accessor-layer work, since only
// its sibling field (`WEAPON_SLOT_CONFIG.basicAttackEnabled`) had a per-mode home at the time. As of
// GM9 (Task 4) `BASIC_ATTACK_CONFIG` is deleted outright: the flag lives only as
// `slots.basicAttackEnabled` now, read through `slots()` everywhere — `bot/brain/firing.ts`,
// `client/config/{aim-hud,slot-keys}.ts`, `client/scenes/movement-hint.ts` and
// `client/scenes/ArenaScene.ts` all switched over. There is nothing left to ban or exempt.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative as pathRelative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Roots are resolved from THIS FILE'S OWN LOCATION, never `process.cwd()` — `npx vitest run
// <path>` from the repo root and from `packages/shared` must walk the identical tree. `SHARED_SRC`
// lands on `packages/shared/src` regardless of which directory the process started in.
// `fileURLToPath` on a directory URL keeps its trailing slash; strip it so `label +
// file.slice(dir.length)` below reconstructs the separator correctly instead of eating it.
const SHARED_SRC = fileURLToPath(new URL("..", import.meta.url)).replace(/[/\\]+$/, "");
const PACKAGES_ROOT = join(SHARED_SRC, "..", "..");
const REPO_ROOT = join(PACKAGES_ROOT, "..");

const BANNED =
  /\b(WEAPON_TABLE|CAR_TABLE|DRIVE_CONFIG|RAM_CONFIG|COMBAT_CONFIG|IMPULSE_CONFIG|STATUS_TABLE|STATUS_CONFIG|SPIKE_CONFIG|SPIKE_TICKS|TURRET_CONFIG|TURRET_TICKS|WEAPON_SLOT_CONFIG|WEAPON_TICKS|DEATHMATCH_CONFIG|DEATHMATCH_TICKS|CONQUER_CONFIG|CHASSIS_DRIVE|FLOW_CONFIG|CAMERA_CONFIG)\b/;
const IMPORT_TYPE_LINE = /^\s*import\s+type\b/;

/**
 * Judged legitimate in task 5b Step 2/3 (see task-5b-report.md for the full reasoning) — each entry
 * is a project-relative file path with the one-line reason it stays raw. Every entry here is a
 * `dev/playground/` file EXCEPT the reason is not "reads a shipped default for a slider": it is the
 * one case task 5b found that is structurally identical to that exemption but outside its literal
 * wording — paste-ready EXPORT TEXT naming a real shared-source identifier, not a live read.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  "packages/client/src/dev/playground/turret-model.ts":
    "turretExportText() prints paste-ready source text (`TURRET_CONFIG.${key} = ...`, " +
    "`CAR_TABLE.${carId}.turretMount = ...`) for a developer to copy into " +
    "packages/shared/src/config/*.ts — the string literally names the real file-level identifier " +
    "it belongs under, so this is generated text describing where a value goes, never a live " +
    "config read. The file's actual reads (enumerating the roster for the panel's per-car " +
    "sections) already go through cars().",
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name))
    : e.name.endsWith(".ts") && !e.name.includes(".test.") ? [join(dir, e.name)] : []);
}

/** True if `file` mentions a banned identifier on any line that is not a type-only import. */
function hasRawConfigReference(file: string): boolean {
  return readFileSync(file, "utf8")
    .split("\n")
    .some((line) => !IMPORT_TYPE_LINE.test(line) && BANNED.test(line));
}

describe("sim reads config only through the bundle (MC13)", () => {
  it("has no raw config table reference — dotted, bracketed, destructured, or bare", () => {
    const offenders = walk(join(SHARED_SRC, "sim")).filter(hasRawConfigReference);
    expect(offenders).toEqual([]);
  });
});

describe("client and server read config only through the bundle (MC13, task 5b)", () => {
  it("has no raw config table reference outside the judged dev/playground/ allow-list", () => {
    const roots: Array<{ label: string; dir: string }> = [
      { label: "packages/client/src", dir: join(PACKAGES_ROOT, "client/src") },
      { label: "packages/server/src", dir: join(PACKAGES_ROOT, "server/src") },
    ];
    const offenders = roots.flatMap(({ label, dir }) =>
      walk(dir)
        .filter(hasRawConfigReference)
        // Normalise to a project-relative path (the walk root is a relative fragment of it) so it
        // matches ALLOWED's keys and reads the same regardless of which package's `cwd` ran the test.
        .map((file) => label + file.slice(dir.length))
        .filter((file) => !(file in ALLOWED)),
    );
    expect(offenders).toEqual([]);
  });

  it("the allow-list itself names only files that still exist and still need it", () => {
    for (const relPath of Object.keys(ALLOWED)) {
      // relPath is project-relative ("packages/client/..."); REPO_ROOT is this file's own
      // location walked back up to the repo root, so the join is cwd-independent.
      const fromShared = join(REPO_ROOT, relPath);
      expect(hasRawConfigReference(fromShared), relPath).toBe(true);
    }
  });
});

/**
 * `sim/` and (task 5b) `client/src`/`server/src` were the only roots this guard ever walked. The
 * REST of `packages/shared/src` — `flow/`, `lobby/`, `net/`, the package root (`index.ts`) — was
 * never checked at all, which is exactly how `flow/respawn.ts`'s `isDueToRespawn` survived reading
 * the raw `deathmatch-ticks` export directly on the server tick path while its own sibling
 * `respawnPlayer` correctly read `derived().deathmatchTicks` two calls away (2026-09-22 final
 * review). Widened here to walk ALL of `packages/shared/src`, `sim/` included — re-covering `sim/`
 * is harmless (it stays clean) and keeps this block a true "everything" sweep rather than one with
 * its own silent gap; the older `sim`-only describe above stays too, since a `sim/` regression
 * failing there gives a narrower, faster-to-read message than the whole-package one below — except
 * the directories in `ALLOWED_DIRS`, each with the one reason its files may legitimately name a raw
 * identifier: the config layer that OWNS these tables, the mode-assembly layer that reads them to
 * BUILD a bundle in the first place, and doc-comment-only mentions in the schema and arena layers.
 *
 * **This guard will need updating, not just an allow-list entry, if the one-source-of-truth
 * refactor mentioned throughout this codebase's docs ever lands** — at that point "the config
 * layer may read its own raw tables" stops being the right rule, because there may be no second
 * per-mode copy left to keep separate from it. Until then, this is the correct, permanent shape of
 * the guard, not a stopgap.
 */
const ALLOWED_DIRS: Readonly<Record<string, string>> = {
  "config": "The raw tables' own home. A table cannot avoid naming its own identifier to define, " +
    "freeze and export itself. `tuning-walker.ts` no longer belongs on that list: it took a " +
    "`ModeConfig` parameter in phase 6 and walks THAT bundle's seven roots, so the only raw names " +
    "left in it are doc-comment mentions of the tables a knob used to live in — which is exactly " +
    "the kind of reference `IMPORT_TYPE_LINE` cannot distinguish and this directory exemption " +
    "covers. `tuning.ts` beside it is types only.",
  "schema": "Colyseus schema field declarations. Every match here is a doc comment naming which " +
    "table a field is validated or drained against (e.g. `STATUS_CONFIG.maxActive`); no schema " +
    "field type or default reads a live config value.",
  "arena": "Arena layout definitions and their `Bounds`/sizing helpers. Arenas are a separate " +
    "registry from the per-mode bundle (`getArena`/`ARENAS`, never `cfg()`), and every match here " +
    "is a doc comment justifying a literal dimension (1280x720, a spike depth) against a raw " +
    "config value used elsewhere, not a read of it.",
};

/**
 * Individual files (any depth under `src/`, given as a path relative to it) that legitimately name
 * a raw identifier — narrower than a whole-directory exemption in `ALLOWED_DIRS` (Finding 12): only
 * the file itself is exempt, so a sibling in the same folder that starts reading a raw table is
 * still caught.
 */
const ALLOWED_FILES: Readonly<Record<string, string>> = {
  "index.ts": "The package's own public barrel. It deliberately RE-EXPORTS every raw table " +
    "(`export { CAR_TABLE } from \"./config/car-config.js\"`, and so on) for legitimate raw " +
    "consumers outside the mode system entirely — the balance/playtest harnesses' shipped-vs-tuned " +
    "comparisons, `scripts/build-cars-and-weapons.mjs`, config tests, and this very file's table- " +
    "pinning test all need the raw table alongside the accessor. Re-exporting a name is not reading " +
    "it.",
  "modes/base.ts": "The mode-ASSEMBLY layer's base. Reads every raw global by design (GM6) — it IS " +
    "the raw globals, assembled once into `BASE_TABLES` for every mode's overrides to merge over.",
  "modes/build.ts": "Reads raw `DRIVE_CONFIG.carWidth`/`carHeight` because the OBB hull is " +
    "explicitly out of tuning scope (never per-mode, never a slider) — see `tuning-walker.ts`'s own " +
    "`DRIVE_SKIP_KEYS` comment.",
  "modes/types.ts": "Names `DRIVE_CONFIG` once, in a doc comment explaining where `ModeConfig.drive` " +
    "comes from, never a live read.",
};

/** True if `file` sits under one of `ALLOWED_DIRS`'s directories, or is an `ALLOWED_FILES` entry
 * directly under `src/`, relative to `src/`. */
function isAllowedRawReference(file: string): boolean {
  // `pathRelative` rather than a "src/" prefix-strip: `file` is now an absolute path (or, for the
  // tripwire fixture, a temp-dir path outside `SHARED_SRC` entirely, which correctly relativizes to
  // something starting with "..", matching neither ALLOWED_FILES nor ALLOWED_DIRS below).
  const relative = pathRelative(SHARED_SRC, file);
  if (relative in ALLOWED_FILES) return true;
  return Object.keys(ALLOWED_DIRS).some((dir) => relative === dir || relative.startsWith(`${dir}/`));
}

describe("ALL of packages/shared/src reads config only through the bundle (MC13, 2026-09-22 final review)", () => {
  it("has no raw config table reference outside the judged config/modes/schema/arena layers", () => {
    const offenders = walk(SHARED_SRC).filter(hasRawConfigReference).filter((file) => !isAllowedRawReference(file));
    expect(offenders).toEqual([]);
  });

  it("every ALLOWED_DIRS entry still points at a real directory that still needs it", () => {
    for (const dir of Object.keys(ALLOWED_DIRS)) {
      const files = walk(join(SHARED_SRC, dir));
      expect(files.length, `src/${dir} does not exist or is empty`).toBeGreaterThan(0);
      expect(files.some(hasRawConfigReference), `src/${dir} — nothing here needs the exemption any more`).toBe(true);
    }
  });

  // The regression this whole block exists to catch: reintroducing exactly `respawn.ts`'s old bug
  // — a raw read in a directory this guard does NOT exempt — must fail loudly.
  // Written into a TEMP DIRECTORY walked alongside `src`, never into `src/flow/` itself, for the
  // same reason as the harness tripwire at the bottom of this file: a `finally` does not survive a
  // hard kill, and what a kill left behind here was a stray `.ts` inside the compiled source tree —
  // reported as a real offender by the next run, and picked up by `tsc` besides.
  it("fails when a raw read is reintroduced outside the exempt directories", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "mc-tripwire-"));
    const fixturePath = join(tempRoot, "__tripwire-fixture.ts");
    try {
      writeFileSync(fixturePath, 'import { DEATHMATCH_TICKS } from "../config/deathmatch-config.js";\n');
      const offenders = [...walk(SHARED_SRC), ...walk(tempRoot)]
        .filter(hasRawConfigReference)
        .filter((file) => !isAllowedRawReference(file));
      expect(offenders).toContain(fixturePath);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

/**
 * The two HEADLESS HARNESSES — `packages/server/playtest` and `packages/server/balance` — which
 * this guard had never walked at all (MC41, 2026-09-23).
 *
 * That gap is exactly how `npm run playtest -- --mode=2` came to print "Mode: Deathmatch (mode 2)"
 * over numbers that were mostly Brawl's: the `--mode` flag reached the report HEADER and the output
 * folder name, while `collision.ts` read `RAM_CONFIG.globalScale`, `ram.ts` read
 * `RAM_CONFIG.minRamSpeed`, `geometry.ts` read `SPIKE_CONFIG.depth` and `weapons.ts` read
 * `WEAPON_TABLE[id].damage` straight off the raw globals underneath it. Invisible only because
 * `table-pinning.test.ts` holds both shipped modes byte-identical — the flag minted a claim the
 * measurements did not honour, which is worse than not having the flag.
 *
 * Neither harness ships, so neither is covered by the `packages/server/src` sweep above; both run
 * the real sim inside a real mode scope (`installPlaytestMode()` per probe process, `withMode` at
 * `balance/run.ts`'s entry), so every accessor resolves correctly and there was never a technical
 * reason for the raw reads.
 *
 * TWO differences from the sweeps above, both narrowing what counts as an offence rather than what
 * is walked:
 *
 * 1. **Comments and import statements are stripped first.** The probes narrate their own tuning
 *    history in prose — "`RAM_CONFIG.globalScale`/`spinScale` (then-placeholders, since measured
 *    and settled at 0.6/0.3)" — and that history is about the TABLE, which is still the right thing
 *    to name. The dir-level exemptions above make the same judgement wholesale for `schema/` and
 *    `arena/` ("every match here is a doc comment"); here it is made precisely, so a real read in
 *    an otherwise comment-heavy file is still caught. Imports go with them because an import is not
 *    a read — a banned name imported and never used is dead weight the compiler flags, not a mode
 *    leak — and stripping them is what lets the hull carve-out below be about USES.
 *
 * 2. **The OBB hull is allowed, and nothing else is.** `DRIVE_CONFIG.carWidth`/`carHeight` are
 *    GLOBAL by spec MC35 — one hull for every mode, excluded from `ModeTables` by type, because the
 *    hull drags a derived chain behind it (car art pixel size, arena spawn clearance,
 *    `inertiaRadiusSquared()`, both `spinScale` constants). `drive().carWidth` would compile and
 *    return the same number, since `assembleModeConfig` re-attaches the hull to every bundle — so
 *    converting it would break nothing and TEACH the reader something false about where the value
 *    comes from. `world.ts`, `collision.ts`, `geometry.ts`, `weapons2.ts` and `prediction.ts` all
 *    read it, several at module scope, which is safe for exactly the same reason: a global constant
 *    cannot be frozen to the wrong mode.
 *
 * What this rule costs, deliberately: a harness may no longer name a raw table in REPORT PROSE
 * either (`weapons.ts`'s W7 line now reads `statusConfig().maxActive`, not `STATUS_CONFIG.maxActive`).
 * That is the right spelling anyway — the report header names a mode, so pointing its reader at a
 * global the game no longer reads is a small lie of the same family as the one above.
 *
 * There are no per-file exemptions here, and adding one should be resisted: every read these roots
 * had was convertible, and a harness whose whole job is to measure a mode has no business reading
 * around it.
 */
const HARNESS_ROOTS: ReadonlyArray<{ label: string; dir: string }> = [
  { label: "packages/server/playtest", dir: join(PACKAGES_ROOT, "server/playtest") },
  { label: "packages/server/balance", dir: join(PACKAGES_ROOT, "server/balance") },
];

/** MC35's hull, the one banned spelling a harness file may still use — see the block above. */
const HULL_FIELD_READ = /DRIVE_CONFIG\.car(?:Width|Height)\b/g;
/** The same two fields, destructured: `const { carWidth: W, carHeight: H } = DRIVE_CONFIG;`. */
const HULL_DESTRUCTURE = /\{\s*car(?:Width|Height)[^}]*\}\s*=\s*DRIVE_CONFIG\b/g;

/**
 * A harness file's source reduced to the code that actually READS something: comments gone
 * (the `[^:]` guard on the line-comment pattern is the repo's own idiom, so a `://` inside a
 * string is not mistaken for one), import statements gone, and MC35's hull reads gone.
 */
function harnessCode(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\bimport\s[\s\S]*?from\s*["'][^"']*["'];?/g, "");
}

function mentionsBanned(code: string): boolean {
  return code.split("\n").some((line) => !IMPORT_TYPE_LINE.test(line) && BANNED.test(line));
}

/** The real assertion: a banned identifier in code, once MC35's hull reads are taken out. */
function harnessHasRawConfigRead(file: string): boolean {
  return mentionsBanned(harnessCode(file).replace(HULL_FIELD_READ, "").replace(HULL_DESTRUCTURE, ""));
}

/** A file the hull carve-out is doing real work for: it reads a banned identifier in CODE, and the
 * hull strip is the only reason it is not an offender. */
function harnessReadsOnlyTheHull(file: string): boolean {
  return mentionsBanned(harnessCode(file)) && !harnessHasRawConfigRead(file);
}

describe("the headless harnesses measure the mode they say they measure (MC41)", () => {
  it("playtest and balance read config only through the bundle, apart from MC35's global hull", () => {
    const offenders = HARNESS_ROOTS.flatMap(({ label, dir }) =>
      walk(dir)
        .filter(harnessHasRawConfigRead)
        .map((file) => label + file.slice(dir.length)),
    );
    expect(offenders).toEqual([]);
  });

  // The hull carve-out is the one allowance this block grants, so it gets the same liveness check
  // `ALLOWED_DIRS` gets: if nothing reads the hull any more, DELETE the carve-out rather than
  // leaving a hole nobody needs. Each file named here WOULD be an offender without it.
  it("the MC35 hull carve-out still covers real reads, and only the hull", () => {
    const hullReaders = HARNESS_ROOTS.flatMap(({ dir }) => walk(dir)).filter(harnessReadsOnlyTheHull);
    expect(hullReaders.length, "nothing in the harnesses needs the hull carve-out any more").toBeGreaterThan(0);
    for (const file of hullReaders) {
      expect(readFileSync(file, "utf8"), file).toMatch(/DRIVE_CONFIG\.car(?:Width|Height)|carWidth[^}]*\}\s*=\s*DRIVE_CONFIG/);
    }
  });

  // The regression this block exists to catch, proven rather than asserted: a per-mode read put
  // back into a probe must fail, naming that probe. A hull read in the same file must not.
  // The fixture is written into a TEMP DIRECTORY added to the roots for the duration, never into
  // `packages/server/playtest/` itself (2026-09-23). A `finally` cleans up an ordinary failure, but
  // not a hard kill — Ctrl-C, an OOM, a killed CI runner — and what that left behind was a file
  // inside a swept root that the very next run would then report as a real offender, in the one
  // guard whose whole job is to be believed. A temp root leaves nothing to find.
  it("fails when a per-mode read is reintroduced into a probe, and not for a hull read", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "mc-tripwire-"));
    const fixturePath = join(tempRoot, "__tripwire-fixture.ts");
    // The same walk the real assertion uses, not the predicate alone: that is what proves a ROOT is
    // being walked, which is the half of this guard that was missing for a year. The temp root is
    // appended to the real ones so the walk under test is byte-for-byte the shipped one.
    const roots = [...HARNESS_ROOTS, { label: "tripwire", dir: tempRoot }];
    const offenders = (): string[] =>
      roots.flatMap(({ label, dir }) =>
        walk(dir)
          .filter(harnessHasRawConfigRead)
          .map((file) => label + file.slice(dir.length)),
      );
    try {
      writeFileSync(
        fixturePath,
        'import { DRIVE_CONFIG, RAM_CONFIG } from "@motor-combat-moba/shared";\n' +
          "export const hull = DRIVE_CONFIG.carWidth;\n" +
          "export const leak = RAM_CONFIG.globalScale;\n",
      );
      expect(offenders()).toContain("tripwire/__tripwire-fixture.ts");
      writeFileSync(
        fixturePath,
        'import { DRIVE_CONFIG } from "@motor-combat-moba/shared";\n' +
          "export const hull = DRIVE_CONFIG.carWidth;\n",
      );
      expect(offenders()).not.toContain("tripwire/__tripwire-fixture.ts");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
