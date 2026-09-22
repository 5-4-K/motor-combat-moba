import type { GameMode } from "../constants.js";
import { resolveChassisDrive } from "../config/car-config.js";
import { resolveDeathmatchTicks } from "../config/deathmatch-config.js";
import { resolveRamTicks } from "../config/ram-config.js";
import { resolveSpikeTicks } from "../config/spike-config.js";
import { resolveStatusPulseTicks } from "../config/status-ticks.js";
import { resolveTurretTicks } from "../config/turret-config.js";
import { buildBurstDefs } from "../config/weapon-config.js";
import { resolveTicks } from "../config/weapon-ticks.js";
import type { ModeConfig, ModeDerived, ModeTables } from "./types.js";

/**
 * Recursively freezes an object graph. The same shape `config/tuning.ts`'s `deepFreeze` already
 * uses — kept as its own small copy here rather than imported, so `modes/` has no dependency on the
 * dev-only tuning module.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  return Object.freeze(value);
}

/**
 * Computes `ModeDerived`, deep-freezes, returns the bundle. The ONLY place a bundle is made.
 *
 * `tables` is `structuredClone`d first so two bundles built from the same source tables (or the
 * same tables object passed twice) never share a sub-object — mutating one bundle, were mutation
 * ever possible, could never reach another. Every resolver below reads the CLONE, never the
 * module-global tables its own file falls back to by default, which is what lets two different
 * `ModeTables` — today just `LEGACY_TABLES`, twice, at two different `GameMode` ids — produce two
 * independently-derived bundles.
 */
export function assembleModeConfig(id: GameMode, tables: ModeTables): ModeConfig {
  const cloned = structuredClone(tables) as ModeTables;

  const derived: ModeDerived = {
    weaponTicks: resolveTicks(cloned.weapons, cloned.statusConfig),
    chassisDrive: resolveChassisDrive(cloned.cars, cloned.drive, cloned.ram),
    burstDefs: buildBurstDefs(cloned.weapons),
    ramTicks: resolveRamTicks(cloned.ram),
    turretTicks: resolveTurretTicks(cloned.turret),
    spikeTicks: resolveSpikeTicks(cloned.spike),
    deathmatchTicks: resolveDeathmatchTicks(cloned.deathmatch),
    statusPulseTicks: resolveStatusPulseTicks(cloned.statusTable),
  };

  const config: ModeConfig = { ...cloned, id, derived };
  return deepFreeze(config);
}
