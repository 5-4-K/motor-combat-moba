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
  "conquer",
  "camera",
  "arenas",
  "maxPlayers",
] as const satisfies readonly (keyof ModeTables)[];

// Tables added after the fixture was captured (Conquer, 2026-09-24): no pre-migration value to compare.
const POST_FIXTURE_KEYS = ["conquer"] as const;

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
        expect(Object.keys(shippedTables).sort()).toStrictEqual(
          TABLE_KEYS.filter((k) => !(POST_FIXTURE_KEYS as readonly string[]).includes(k)).sort(),
        );
      });

      for (const key of TABLE_KEYS) {
        if ((POST_FIXTURE_KEYS as readonly string[]).includes(key)) continue;
        if (key === "drive") continue; // handled below, hull stripped first
        if (key === "weapons" || key === "slots") continue; // deliberately moved since — see below
        it(`${key} matches the shipped fixture`, () => {
          // toStrictEqual (not toEqual) so a dropped optional field and an explicit `undefined`
          // are NOT treated as equivalent, and array order is checked positionally.
          expect(c[key]).toStrictEqual(shippedTables[key]);
        });
      }

      /*
       * `weapons` and `slots` are the two tables a DELIBERATE config change has moved since the
       * fixture was captured: `development/main`'s `c78bbe3` set `BASIC_ATTACK_CONFIG.enabled` to
       * `false` and returned `predator`, `magmablast` and `thumper` to fixed muzzles. The per-mode
       * merge carried both into every mode folder, because the sim reads the folder and not the raw
       * table — leaving them out of the folders would have silently un-done that commit.
       *
       * They are NOT exempted from the fixture, which would stop witnessing them entirely. The
       * fixture is restated with exactly that change applied, so everything else in both tables is
       * still held to the pre-migration snapshot: remove a turret from a FOURTH weapon, or move any
       * other weapon field, or flip the flag back in one mode folder, and these fail.
       */
      const FIXED_MUZZLE_SINCE_MAIN = ["predator", "magmablast", "thumper"] as const;

      it("weapons matches the shipped fixture, less the three turrets main returned to muzzles", () => {
        const expected = structuredClone(shippedTables.weapons) as Record<string, { turret?: unknown }>;
        for (const id of FIXED_MUZZLE_SINCE_MAIN) {
          expect(expected[id]!.turret, `${id} carried no turret in the fixture`).toBeDefined();
          delete expected[id]!.turret;
        }
        expect(c.weapons).toStrictEqual(expected);
      });

      it("slots matches the shipped fixture, less the basic attack main switched off", () => {
        expect(shippedTables.slots.basicAttackEnabled, "fixture had the flag on").toBe(true);
        expect(c.slots).toStrictEqual({ ...shippedTables.slots, basicAttackEnabled: false });
      });

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
