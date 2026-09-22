import type { GameMode } from "../constants.js";
import { resolveChassisDrive } from "../config/car-config.js";
import { resolveDeathmatchTicks } from "../config/deathmatch-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { DriveConfig } from "../config/drive-config.js";
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
 * `ModeTables` — today `BRAWL_TABLES`, passed to two different `GameMode` ids (`FFA_LAST_STANDING`
 * and the unpublished `TEAM`) — produce two independently-derived bundles.
 */
export function assembleModeConfig(id: GameMode, tables: ModeTables): ModeConfig {
  const cloned = structuredClone(tables) as ModeTables;

  /**
   * The OBB hull is global (MC35): every mode's bundle carries the same `carWidth`/`carHeight`,
   * re-attached here from `DRIVE_CONFIG` rather than left to whatever `cloned.drive` holds — which,
   * per `ModeTables.drive`'s type, can never be anything but absent anyway. This is the one place
   * the hull rejoins the rest of the drive config for the bundle's consumers.
   */
  const drive: DriveConfig = {
    ...cloned.drive,
    carWidth: DRIVE_CONFIG.carWidth,
    carHeight: DRIVE_CONFIG.carHeight,
  };

  const derived: ModeDerived = {
    weaponTicks: resolveTicks(cloned.weapons, cloned.statusConfig),
    chassisDrive: resolveChassisDrive(cloned.cars, drive, cloned.ram),
    burstDefs: buildBurstDefs(cloned.weapons),
    ramTicks: resolveRamTicks(cloned.ram),
    turretTicks: resolveTurretTicks(cloned.turret),
    spikeTicks: resolveSpikeTicks(cloned.spike),
    deathmatchTicks: resolveDeathmatchTicks(cloned.deathmatch),
    statusPulseTicks: resolveStatusPulseTicks(cloned.statusTable),
  };

  const config: ModeConfig = { ...cloned, drive, id, derived };
  return deepFreeze(config);
}
