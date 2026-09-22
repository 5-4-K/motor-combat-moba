// Guards MC13 (see task-5-brief.md, Step 3): every config table `sim/` reads must go through the
// mode bundle's accessors — `drive()`, `ram()`, `impulse()`, `combat()`, `spike()`, `turret()`,
// `statusConfig()`, `statusTable()`, `slots()`, `cars()`, `derived()` (`../modes/active.js`) —
// never a RAW global (`WEAPON_TABLE`, `CAR_TABLE`, `DRIVE_CONFIG`, ...) in any form. A raw read is
// invisible to `setTuning`'s rebuilt bundle and to a future non-legacy mode, so this walks every
// non-test file under `src/sim` and fails, naming the offenders, the moment one creeps back in.
//
// Widened after fix round 1 (see task-4-5-report.md): the original pattern required a literal `.`
// right after the identifier, so it missed a destructured read (`const { x } = DRIVE_CONFIG`) and a
// bracketed one (`CAR_TABLE[id]`) — both found by hand, not by this test. `BANNED` now matches the
// bare identifier in ANY form — dotted, bracketed, destructured, or passed as a bare reference —
// since none of these all-caps table/config names have any legitimate reason to appear in `sim/`
// source at all; the accessors are separate, lowercase identifiers. The one carve-out is a line that
// is purely a type-only import (`import type { ... }`), in case a type sharing one of these exact
// names is ever imported for its type alone.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BANNED = /\b(WEAPON_TABLE|CAR_TABLE|DRIVE_CONFIG|RAM_CONFIG|COMBAT_CONFIG|IMPULSE_CONFIG|STATUS_TABLE|STATUS_CONFIG|SPIKE_CONFIG|TURRET_CONFIG|TURRET_TICKS|WEAPON_SLOT_CONFIG|BASIC_ATTACK_CONFIG)\b/;
const IMPORT_TYPE_LINE = /^\s*import\s+type\b/;

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
