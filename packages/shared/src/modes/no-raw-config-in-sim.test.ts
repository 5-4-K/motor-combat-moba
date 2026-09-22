// Guards MC13 (see task-5-brief.md, Step 3): every config table `sim/` reads must go through the
// mode bundle's accessors — `drive()`, `ram()`, `impulse()`, `combat()`, `spike()`, `turret()`,
// `statusConfig()`, `statusTable()`, `slots()`, `derived()` (`../modes/active.js`) — never a RAW
// global (`WEAPON_TABLE`, `CAR_TABLE`, `DRIVE_CONFIG`, ...) dereferenced directly. A raw read is
// invisible to `setTuning`'s rebuilt bundle and to a future non-legacy mode, so this walks every
// non-test file under `src/sim` and fails, naming the offenders, the moment one creeps back in.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BANNED = /\b(WEAPON_TABLE|CAR_TABLE|DRIVE_CONFIG|RAM_CONFIG|COMBAT_CONFIG|IMPULSE_CONFIG|STATUS_TABLE|STATUS_CONFIG|SPIKE_CONFIG|TURRET_CONFIG|TURRET_TICKS|WEAPON_SLOT_CONFIG|BASIC_ATTACK_CONFIG)\./;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name))
    : e.name.endsWith(".ts") && !e.name.includes(".test.") ? [join(dir, e.name)] : []);
}

describe("sim reads config only through the bundle (MC13)", () => {
  it("has no raw config table dereference", () => {
    const offenders = walk("src/sim")
      .filter((f) => BANNED.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
