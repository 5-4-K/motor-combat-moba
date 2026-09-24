import { describe, expect, it } from "vitest";

// The raw globals — each table's ONE canonical source before the per-mode migration, and still the
// thing a config-tuning PR is most likely to touch out of habit.
import { CAR_TABLE } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { CONQUER_CONFIG } from "../config/conquer-config.js";
import { DEATHMATCH_CONFIG } from "../config/deathmatch-config.js";
import { CAMERA_CONFIG, DRIVE_CONFIG } from "../config/drive-config.js";
import { FLOW_CONFIG } from "../config/flow-config.js";
import { IMPULSE_CONFIG } from "../config/impulse-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import { SPIKE_CONFIG } from "../config/spike-config.js";
import { STATUS_CONFIG, STATUS_LIMITS, STATUS_TABLE } from "../config/status-config.js";
import { TURRET_CONFIG } from "../config/turret-config.js";
import { BASIC_ATTACK_CONFIG, WEAPON_TABLE } from "../config/weapon-config.js";
import { WEAPON_SLOT_CONFIG } from "../config/weapon-slots.js";

// Brawl's hand-maintained copies.
import { BRAWL_CAMERA } from "./brawl/camera.js";
import { BRAWL_CARS } from "./brawl/cars.js";
import { BRAWL_COMBAT } from "./brawl/combat.js";
import { BRAWL_DEATHMATCH } from "./brawl/deathmatch.js";
import { BRAWL_CONQUER } from "./brawl/conquer.js";
import { BRAWL_DRIVE } from "./brawl/drive.js";
import { BRAWL_FLOW } from "./brawl/flow.js";
import { BRAWL_IMPULSE } from "./brawl/impulse.js";
import { BRAWL_RAM } from "./brawl/ram.js";
import { BRAWL_SLOTS } from "./brawl/slots.js";
import { BRAWL_SPIKE } from "./brawl/spike.js";
import { BRAWL_STATUS_CONFIG, BRAWL_STATUS_LIMITS, BRAWL_STATUS_TABLE } from "./brawl/status.js";
import { BRAWL_TURRET } from "./brawl/turret.js";
import { BRAWL_WEAPONS } from "./brawl/weapons.js";

// Deathmatch's hand-maintained copies.
import { DEATHMATCH_CAMERA } from "./deathmatch/camera.js";
import { DEATHMATCH_CARS } from "./deathmatch/cars.js";
import { DEATHMATCH_COMBAT } from "./deathmatch/combat.js";
import { DEATHMATCH_DEATHMATCH } from "./deathmatch/deathmatch.js";
import { DEATHMATCH_CONQUER } from "./deathmatch/conquer.js";
import { DEATHMATCH_DRIVE } from "./deathmatch/drive.js";
import { DEATHMATCH_FLOW } from "./deathmatch/flow.js";
import { DEATHMATCH_IMPULSE } from "./deathmatch/impulse.js";
import { DEATHMATCH_RAM } from "./deathmatch/ram.js";
import { DEATHMATCH_SLOTS } from "./deathmatch/slots.js";
import { DEATHMATCH_SPIKE } from "./deathmatch/spike.js";
import {
  DEATHMATCH_STATUS_CONFIG,
  DEATHMATCH_STATUS_LIMITS,
  DEATHMATCH_STATUS_TABLE,
} from "./deathmatch/status.js";
import { DEATHMATCH_TURRET } from "./deathmatch/turret.js";
import { DEATHMATCH_WEAPONS } from "./deathmatch/weapons.js";

/**
 * THE ALARM, not the fix (2026-09-22 final review).
 *
 * Every table now exists three times: the raw global in `packages/shared/src/config/`, and a
 * literal, hand-maintained copy in each of `modes/brawl/` and `modes/deathmatch/`. Nothing asserted
 * they stayed equal — measured: editing raw `WEAPON_TABLE.thunderclap.damage` 90 -> 777 left the sim
 * reading 90, because every real entry point reads a mode's own copy (`weapons()`/`cfg().weapons`),
 * never the raw global, and nothing said the two had drifted.
 *
 * **This file exists because today the three copies are identical BY INTENT** — neither mode has
 * been tuned away from the shipped numbers yet (both mode folders' own header comments say so) — and
 * it is the tripwire for that intent slipping while the deeper fix (one source of truth for the
 * tables, collapsing the three copies into one) is still outstanding. **Delete or narrow this test
 * the day a mode is deliberately tuned away from the raw global** — that is the correct, expected
 * reason for a row here to start failing, not a bug to chase. Until then, a mismatch means someone
 * edited the raw global, a mode's own copy, or both, without keeping them in sync, and the game is
 * simulating whichever one the ACTIVE MODE'S bundle assembled from — never the raw global directly.
 *
 * `drive` excludes `carWidth`/`carHeight`: those two are deliberately GLOBAL across every mode
 * (MC35 — the OBB hull drags too much else behind it to vary per mode), so neither mode folder's
 * `drive.ts` is allowed to author them at all (a `ModeTables.drive` literal including them fails
 * TypeScript's excess-property check), and comparing them here would be comparing a field that does
 * not exist on one side.
 */
describe("table pinning: the raw global equals each mode folder's copy (tripwire, delete when a mode intentionally diverges)", () => {
  const { carWidth: _carWidth, carHeight: _carHeight, ...driveWithoutHull } = DRIVE_CONFIG;

  const TABLES: ReadonlyArray<{
    table: string;
    raw: unknown;
    brawl: unknown;
    deathmatch: unknown;
  }> = [
    { table: "cars (CAR_TABLE)", raw: CAR_TABLE, brawl: BRAWL_CARS, deathmatch: DEATHMATCH_CARS },
    { table: "weapons (WEAPON_TABLE)", raw: WEAPON_TABLE, brawl: BRAWL_WEAPONS, deathmatch: DEATHMATCH_WEAPONS },
    {
      table: "drive (DRIVE_CONFIG, minus the global carWidth/carHeight hull — MC35)",
      raw: driveWithoutHull,
      brawl: BRAWL_DRIVE,
      deathmatch: DEATHMATCH_DRIVE,
    },
    { table: "ram (RAM_CONFIG)", raw: RAM_CONFIG, brawl: BRAWL_RAM, deathmatch: DEATHMATCH_RAM },
    { table: "impulse (IMPULSE_CONFIG)", raw: IMPULSE_CONFIG, brawl: BRAWL_IMPULSE, deathmatch: DEATHMATCH_IMPULSE },
    { table: "combat (COMBAT_CONFIG)", raw: COMBAT_CONFIG, brawl: BRAWL_COMBAT, deathmatch: DEATHMATCH_COMBAT },
    { table: "turret (TURRET_CONFIG)", raw: TURRET_CONFIG, brawl: BRAWL_TURRET, deathmatch: DEATHMATCH_TURRET },
    {
      table: "statusConfig (STATUS_CONFIG)",
      raw: STATUS_CONFIG,
      brawl: BRAWL_STATUS_CONFIG,
      deathmatch: DEATHMATCH_STATUS_CONFIG,
    },
    {
      table: "statusTable (STATUS_TABLE)",
      raw: STATUS_TABLE,
      brawl: BRAWL_STATUS_TABLE,
      deathmatch: DEATHMATCH_STATUS_TABLE,
    },
    {
      table: "statusLimits (STATUS_LIMITS)",
      raw: STATUS_LIMITS,
      brawl: BRAWL_STATUS_LIMITS,
      deathmatch: DEATHMATCH_STATUS_LIMITS,
    },
    { table: "spike (SPIKE_CONFIG)", raw: SPIKE_CONFIG, brawl: BRAWL_SPIKE, deathmatch: DEATHMATCH_SPIKE },
    { table: "slots (WEAPON_SLOT_CONFIG)", raw: WEAPON_SLOT_CONFIG, brawl: BRAWL_SLOTS, deathmatch: DEATHMATCH_SLOTS },
    { table: "flow (FLOW_CONFIG)", raw: FLOW_CONFIG, brawl: BRAWL_FLOW, deathmatch: DEATHMATCH_FLOW },
    {
      table: "deathmatch (DEATHMATCH_CONFIG)",
      raw: DEATHMATCH_CONFIG,
      brawl: BRAWL_DEATHMATCH,
      deathmatch: DEATHMATCH_DEATHMATCH,
    },
    { table: "conquer (CONQUER_CONFIG)", raw: CONQUER_CONFIG, brawl: BRAWL_CONQUER, deathmatch: DEATHMATCH_CONQUER },
    { table: "camera (CAMERA_CONFIG)", raw: CAMERA_CONFIG, brawl: BRAWL_CAMERA, deathmatch: DEATHMATCH_CAMERA },
  ];

  for (const { table, raw, brawl, deathmatch } of TABLES) {
    it(`${table}: brawl's copy matches the raw global`, () => {
      expect(
        brawl,
        `modes/brawl's copy of ${table} has drifted from the raw global — the game reads the ` +
          `mode folder, never the raw global, so this mismatch means brawl actually runs on ` +
          `different numbers than an edit to the raw global would suggest.`,
      ).toEqual(raw);
    });

    it(`${table}: deathmatch's copy matches the raw global`, () => {
      expect(
        deathmatch,
        `modes/deathmatch's copy of ${table} has drifted from the raw global — the game reads ` +
          `the mode folder, never the raw global, so this mismatch means deathmatch actually runs ` +
          `on different numbers than an edit to the raw global would suggest.`,
      ).toEqual(raw);
    });
  }

  // Named explicitly per the review, on top of the general sweep above: these two were the ones
  // measured as silently divergence-prone, and `WEAPON_SLOT_CONFIG.basicAttackEnabled` in
  // particular was previously pinned for the DEFAULT mode only (`weapon-slots.test.ts`), never for
  // deathmatch.
  it("WEAPON_SLOT_CONFIG.maxAbilitySlots matches each mode's slots.maxAbilitySlots", () => {
    expect(BRAWL_SLOTS.maxAbilitySlots).toBe(WEAPON_SLOT_CONFIG.maxAbilitySlots);
    expect(DEATHMATCH_SLOTS.maxAbilitySlots).toBe(WEAPON_SLOT_CONFIG.maxAbilitySlots);
  });

  it("BASIC_ATTACK_CONFIG.enabled matches each mode's slots.basicAttackEnabled", () => {
    expect(BRAWL_SLOTS.basicAttackEnabled).toBe(BASIC_ATTACK_CONFIG.enabled);
    expect(DEATHMATCH_SLOTS.basicAttackEnabled).toBe(BASIC_ATTACK_CONFIG.enabled);
  });
});
