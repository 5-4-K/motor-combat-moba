import shipped from "./__fixtures__/shipped-tables.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { modeConfigOf } from "./registry.js";
import type { ModeConfig, ModeTables } from "./types.js";

/**
 * `shipped-tables.json` is a snapshot of the live config tables at commit `fbe386a` — the commit
 * immediately before the per-mode-config migration began, captured with `git show` into a scratch
 * checkout, built, and dumped to JSON (see task-3-report.md for the exact steps). It is the ONLY
 * trustworthy witness that the migration moved no balance number: comparing the two mode bundles to
 * each other would only prove they match each other, which they would even if the generator that
 * seeded both folders had corrupted them identically.
 *
 * `ModeTables.drive` deliberately excludes the OBB hull (`carWidth`/`carHeight` — MC35, the hull
 * stays GLOBAL across every mode), so the fixture's `drive` has no hull either, and the assembled
 * bundle's `drive` has the hull stripped back off before the per-table compare below. The hull is
 * asserted on its own, directly.
 *
 * Every field listed here is read straight off the `ModeTables` interface (see `./types.ts`) rather
 * than off any prose list. `TABLE_KEYS` is checked against `modeConfigOf(mode)`'s own keys below at
 * RUNTIME (not just typed against `ModeTables`) — this package's tsconfig excludes `*.test.ts` from
 * `tsc`, so a stale list here would never be caught by `npm run typecheck` or `npm run build`, only
 * by an assertion that actually runs.
 */
type ShippedTables = Omit<ModeTables, "drive"> & { drive: ModeTables["drive"] };
const shippedTables = shipped as unknown as ShippedTables;

const TABLE_KEYS = [
  "cars",
  "weapons",
  "drive",
  "ram",
  "impulse",
  "combat",
  "turret",
  "statusConfig",
  "statusTable",
  "statusLimits",
  "spike",
  "slots",
  "flow",
  "deathmatch",
  "camera",
  "arenas",
  "maxPlayers",
] as const satisfies readonly (keyof ModeTables)[];

function driveWithoutHull(config: ModeConfig): ModeTables["drive"] {
  const { carWidth: _carWidth, carHeight: _carHeight, ...rest } = config.drive;
  return rest;
}

describe("day one is behaviourally a no-op (G4)", () => {
  for (const [label, mode] of [
    ["FFA_LAST_STANDING", GameMode.FFA_LAST_STANDING],
    ["FFA_DEATHMATCH", GameMode.FFA_DEATHMATCH],
  ] as const) {
    describe(`mode ${label} (${mode}) carries the shipped values`, () => {
      const c = modeConfigOf(mode);

      it("TABLE_KEYS covers every ModeTables field the bundle actually carries (no interface drift)", () => {
        const { id: _id, derived: _derived, ...tableFields } = c;
        expect(Object.keys(tableFields).sort()).toStrictEqual([...TABLE_KEYS].sort());
        expect(Object.keys(shippedTables).sort()).toStrictEqual([...TABLE_KEYS].sort());
      });

      for (const key of TABLE_KEYS) {
        if (key === "drive") continue; // handled below, hull stripped first
        it(`${key} matches the shipped fixture`, () => {
          // toStrictEqual (not toEqual) so a dropped optional field and an explicit `undefined`
          // are NOT treated as equivalent, and array order is checked positionally.
          expect(c[key]).toStrictEqual(shippedTables[key]);
        });
      }

      it("drive (hull stripped) matches the shipped fixture", () => {
        expect(driveWithoutHull(c)).toStrictEqual(shippedTables.drive);
      });

      it("drive.carWidth/carHeight carry the global hull (MC35)", () => {
        expect(c.drive.carWidth).toBe(60);
        expect(c.drive.carHeight).toBe(40);
      });
    });
  }
});
