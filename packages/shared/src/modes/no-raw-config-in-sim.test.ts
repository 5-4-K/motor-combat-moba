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
import { readFileSync, readdirSync } from "node:fs";
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
