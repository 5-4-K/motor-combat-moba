// SCAFFOLDING. Phase 2 replaces this with brawl/ and deathmatch/ folders and deletes this file.
// It exists so phase 1 is a pure refactor: one bundle, today's numbers, nothing to compare.
import { MAX_PLAYERS } from "../constants.js";
import type { ArenaId } from "../arena/registry.js";
import { CAR_TABLE } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { DEATHMATCH_CONFIG } from "../config/deathmatch-config.js";
import { CAMERA_CONFIG, DRIVE_CONFIG } from "../config/drive-config.js";
import { FLOW_CONFIG } from "../config/flow-config.js";
import { IMPULSE_CONFIG } from "../config/impulse-config.js";
import { DEFAULT_GAME_MODE } from "./registry.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import { SPIKE_CONFIG } from "../config/spike-config.js";
import { STATUS_CONFIG, STATUS_LIMITS, STATUS_TABLE } from "../config/status-config.js";
import { TURRET_CONFIG } from "../config/turret-config.js";
import { WEAPON_TABLE } from "../config/weapon-config.js";
import { WEAPON_SLOT_CONFIG } from "../config/weapon-slots.js";
import { installMode } from "./active.js";
import { assembleModeConfig } from "./build.js";
import type { ModeTables } from "./types.js";

/** Today's live values, wrapped in the shape `assembleModeConfig` consumes. */
export const LEGACY_TABLES: ModeTables = {
  cars: CAR_TABLE,
  weapons: WEAPON_TABLE,
  // The full DRIVE_CONFIG, hull included: `ModeTables.drive`'s narrower type (MC35) only stops a
  // new mode's own inline literal from authoring carWidth/carHeight — it does not, and need not,
  // stop this reference to the actual global object from carrying them too. assembleModeConfig
  // re-attaches the hull from DRIVE_CONFIG regardless, so this is inert either way.
  drive: DRIVE_CONFIG,
  ram: RAM_CONFIG,
  impulse: IMPULSE_CONFIG,
  combat: COMBAT_CONFIG,
  turret: TURRET_CONFIG,
  statusConfig: STATUS_CONFIG,
  statusTable: STATUS_TABLE,
  statusLimits: STATUS_LIMITS,
  spike: SPIKE_CONFIG,
  slots: WEAPON_SLOT_CONFIG,
  flow: FLOW_CONFIG,
  deathmatch: DEATHMATCH_CONFIG,
  camera: CAMERA_CONFIG,
  arenas: ["arena-01", "arena-02"] as readonly ArenaId[],
  maxPlayers: MAX_PLAYERS,
};

// SCAFFOLDING (phases 1-2): removed in phase 3, when cfg() starts throwing.
installMode(assembleModeConfig(DEFAULT_GAME_MODE, LEGACY_TABLES));
