// GM6: the common defaults every mode starts from. These ARE the `config/` globals — editing one
// changes every mode that does not override that value, and the per-mode snapshots
// (`__snapshots__/<slug>.tables.json`) show exactly which modes moved.
import type { ArenaId } from "../arena/registry.js";
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
import { WEAPON_TABLE } from "../config/weapon-config.js";
import { WEAPON_SLOT_CONFIG } from "../config/weapon-slots.js";
import type { ModeTables } from "./types.js";

// The hull is global (MC35): stripped here so no mode's tables can carry it.
const { carWidth: _w, carHeight: _h, ...DRIVE_WITHOUT_HULL } = DRIVE_CONFIG;

export const BASE_TABLES: ModeTables = {
  cars: CAR_TABLE,
  weapons: WEAPON_TABLE,
  drive: DRIVE_WITHOUT_HULL,
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
  conquer: CONQUER_CONFIG,
  camera: CAMERA_CONFIG,
  arenas: ["arena-01", "arena-02"] as readonly ArenaId[],
  maxPlayers: 6,
};
