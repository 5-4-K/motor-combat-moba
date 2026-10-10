// Test-only helper. Wraps `fn` in `withMode` using `DEFAULT_GAME_MODE`'s assembled bundle, for
// suites that need SOME mode installed but are not about any particular mode's numbers. Prefer an
// explicit `withMode(modeConfigOf(SOME_MODE), fn)` when the test IS about a specific mode.
//
// This file is test-only scaffolding, not shipped config: nothing under `src/` outside a `.test.ts`
// file may import it, and it is never part of the package's public `index.ts` surface.
import { DEFAULT_GAME_MODE, modeConfigOf } from "./registry.js";
import { withMode } from "./active.js";
import { applyOverrides } from "./overlay.js";
import { assembleModeConfig } from "./build.js";
import type { ModeConfig, ModeTables } from "./types.js";

export function withDefaultMode<T>(fn: () => T): T {
  return withMode(modeConfigOf(DEFAULT_GAME_MODE), fn);
}

/**
 * GM9 (Task 4): `BASIC_ATTACK_CONFIG.enabled` is gone — the flag is per mode now
 * (`slots.basicAttackEnabled`). Runs `fn` under the DEFAULT mode's bundle with that flag set to
 * `enabled`, for suites that used to flip the global and restore it in an `afterEach`. Builds a
 * tuned sibling via `applyOverrides` rather than mutating anything, so there is nothing to restore.
 */
export function withBasicAttack<T>(enabled: boolean, fn: () => T): T {
  const base = modeConfigOf(DEFAULT_GAME_MODE);
  return withMode(applyOverrides(base, { "slots.basicAttackEnabled": enabled }), fn);
}

/**
 * The turret system is switched off in every shipped mode (no weapon row carries `turret`),
 * but its machinery (the turret config, `turretPivotOf`, `turnTurret`, `beginFire` bearings, the
 * bot's turret solving, the client's turret drawing) stays in the code and stays tested. These
 * helpers rebuild a bundle with the rows that USED to carry the turret carrying it again, so those
 * tests run on the exact bundle they were written against. Nothing else about the bundle moves.
 */
export const TURRET_RESTORED_WEAPON_IDS: readonly string[] = [
  "basic-attack-bullseye",
  "basic-attack-mirage",
  "basic-attack-bastion",
  "basic-attack-taurus",
  "basic-attack-anvil",
  "basic-attack-prowler",
  "basic-attack-cleaver",
  "basic-attack-skorpios",
  "basic-attack-caprico",
  "predator",
  "magmablast",
  "thumper",
  "roadblock",
  "fury-horn",
];

/** `tables` with `turret: { additionalOffset: 0 }` put back on exactly the rows that had it. */
export function turretRestoredTables(tables: ModeTables): ModeTables {
  const weapons: Record<string, unknown> = { ...tables.weapons };
  for (const id of TURRET_RESTORED_WEAPON_IDS) {
    const row = weapons[id];
    if (row === undefined) throw new Error(`turretRestoredTables: no weapon row "${id}"`);
    weapons[id] = { ...(row as object), turret: { additionalOffset: 0 } };
  }
  return { ...tables, weapons: weapons as unknown as ModeTables["weapons"] };
}

/** A bundle identical to `config` but with the turret rows restored (see `turretRestoredTables`). */
export function turretRestored(config: ModeConfig): ModeConfig {
  return assembleModeConfig(config.id, turretRestoredTables(config));
}

/** `assembleModeConfig(id, tables)` over `turretRestoredTables(tables)`. */
export function assembleTurretRestored(id: ModeConfig["id"], tables: ModeTables): ModeConfig {
  return assembleModeConfig(id, turretRestoredTables(tables));
}
