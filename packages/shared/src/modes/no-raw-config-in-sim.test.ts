// Guards MC13 (see task-5-brief.md Step 3, and task-5b-brief.md which widened it). Every config
// table read — in `sim/`, and since task 5b in every non-test file under `packages/client/src` and
// `packages/server/src` too — must go through the mode bundle's accessors — `drive()`, `ram()`,
// `impulse()`, `combat()`, `spike()`, `turret()`, `statusConfig()`, `statusTable()`, `statusLimits()`,
// `slots()`, `cars()`, `weapons()`, `flow()`, `deathmatch()`, `camera()`, `derived()`
// (`../modes/active.js`) — never a RAW global (`WEAPON_TABLE`, `CAR_TABLE`, `DRIVE_CONFIG`, ...) in
// any form. A raw read is invisible to `setTuning`'s rebuilt bundle and to a room ticking inside a
// non-default mode's `withMode` scope, so this walks every non-test file under the three roots and
// fails, naming the offenders, the moment one creeps back in.
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
// `BASIC_ATTACK_CONFIG` is REMOVED from the list task 5b inherited. It is a genuine build-time
// global outside the per-mode bundle — confirmed against `ModeTables`/`ModeConfig`, neither of which
// carries it, and against `01-accessor-layer/task-4-5-report.md`, which converted its sibling field
// (`WEAPON_SLOT_CONFIG.basicAttackEnabled`) but deliberately left `BASIC_ATTACK_CONFIG.enabled`
// itself raw everywhere, including `sim/fire.ts` and `bot/brain/firing.ts`. It was never actually
// read raw inside `sim/` (zero offenders either way), so leaving it banned was harmless there; but
// banning it across client/server would flag five genuinely-correct raw reads
// (`bot/brain/firing.ts`, `client/config/{aim-hud,slot-keys}.ts`, `client/scenes/movement-hint.ts`,
// `client/scenes/ArenaScene.ts`) that have nothing to do with this guard's purpose.
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BANNED =
  /\b(WEAPON_TABLE|CAR_TABLE|DRIVE_CONFIG|RAM_CONFIG|COMBAT_CONFIG|IMPULSE_CONFIG|STATUS_TABLE|STATUS_CONFIG|SPIKE_CONFIG|SPIKE_TICKS|TURRET_CONFIG|TURRET_TICKS|WEAPON_SLOT_CONFIG|WEAPON_TICKS|DEATHMATCH_CONFIG|DEATHMATCH_TICKS|CHASSIS_DRIVE|FLOW_CONFIG|CAMERA_CONFIG)\b/;
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
    const offenders = walk("src/sim").filter(hasRawConfigReference);
    expect(offenders).toEqual([]);
  });
});

describe("client and server read config only through the bundle (MC13, task 5b)", () => {
  it("has no raw config table reference outside the judged dev/playground/ allow-list", () => {
    const roots: Array<{ label: string; dir: string }> = [
      { label: "packages/client/src", dir: "../client/src" },
      { label: "packages/server/src", dir: "../server/src" },
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
      // packages/shared is this test's cwd, so "packages/client/..." resolves through "../client/...".
      const fromShared = relPath.replace(/^packages\/[^/]+/, (pkg) => `../${pkg.slice("packages/".length)}`);
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
    "freeze and export itself, and `tuning.ts`/`tuning-walker.ts` here deliberately read the raw " +
    "seven-table ROOTS to validate and snapshot against — see their own extensive doc comments.",
  "modes": "The mode-ASSEMBLY layer. `build.ts` reads raw `DRIVE_CONFIG.carWidth`/`carHeight` " +
    "because the OBB hull is explicitly out of tuning scope (never per-mode, never a slider) — see " +
    "`tuning-walker.ts`'s own `DRIVE_SKIP_KEYS` comment. `registry.ts`, `brawl/`, `deathmatch/` and " +
    "`active.ts` do not reference a raw identifier at all (checked); `types.ts` only names one in a " +
    "doc comment.",
  "schema": "Colyseus schema field declarations. Every match here is a doc comment naming which " +
    "table a field is validated or drained against (e.g. `STATUS_CONFIG.maxActive`); no schema " +
    "field type or default reads a live config value.",
  "arena": "Arena layout definitions and their `Bounds`/sizing helpers. Arenas are a separate " +
    "registry from the per-mode bundle (`getArena`/`ARENAS`, never `cfg()`), and every match here " +
    "is a doc comment justifying a literal dimension (1280x720, a spike depth) against a raw " +
    "config value used elsewhere, not a read of it.",
};

/** Files directly under `src/` (not a subdirectory) that legitimately name a raw identifier. */
const ALLOWED_FILES: Readonly<Record<string, string>> = {
  "index.ts": "The package's own public barrel. It deliberately RE-EXPORTS every raw table " +
    "(`export { CAR_TABLE } from \"./config/car-config.js\"`, and so on) for legitimate raw " +
    "consumers outside the mode system entirely — the balance/playtest harnesses' shipped-vs-tuned " +
    "comparisons, `scripts/build-cars-and-weapons.mjs`, config tests, and this very file's table- " +
    "pinning test all need the raw table alongside the accessor. Re-exporting a name is not reading " +
    "it.",
};

/** True if `file` sits under one of `ALLOWED_DIRS`'s directories, or is an `ALLOWED_FILES` entry
 * directly under `src/`, relative to `src/`. */
function isAllowedRawReference(file: string): boolean {
  const relative = file.startsWith("src/") ? file.slice("src/".length) : file;
  if (relative in ALLOWED_FILES) return true;
  return Object.keys(ALLOWED_DIRS).some((dir) => relative === dir || relative.startsWith(`${dir}/`));
}

describe("ALL of packages/shared/src reads config only through the bundle (MC13, 2026-09-22 final review)", () => {
  it("has no raw config table reference outside the judged config/modes/schema/arena layers", () => {
    const offenders = walk("src").filter(hasRawConfigReference).filter((file) => !isAllowedRawReference(file));
    expect(offenders).toEqual([]);
  });

  it("every ALLOWED_DIRS entry still points at a real directory that still needs it", () => {
    for (const dir of Object.keys(ALLOWED_DIRS)) {
      const files = walk(`src/${dir}`);
      expect(files.length, `src/${dir} does not exist or is empty`).toBeGreaterThan(0);
      expect(files.some(hasRawConfigReference), `src/${dir} — nothing here needs the exemption any more`).toBe(true);
    }
  });

  // The regression this whole block exists to catch: reintroducing exactly `respawn.ts`'s old bug
  // — a raw read in a directory this guard does NOT exempt — must fail loudly.
  it("fails when a raw read is reintroduced outside the exempt directories", () => {
    const fixturePath = join("src", "flow", "__tripwire-fixture.ts");
    writeFileSync(fixturePath, 'import { DEATHMATCH_TICKS } from "../config/deathmatch-config.js";\n');
    try {
      const offenders = walk("src").filter(hasRawConfigReference).filter((file) => !isAllowedRawReference(file));
      expect(offenders).toContain(fixturePath);
    } finally {
      rmSync(fixturePath);
    }
  });
});
