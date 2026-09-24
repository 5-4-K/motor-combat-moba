// Deathmatch mode's table bundle (MC3). Every value here is identical to today's live config —
// this mode has not been tuned yet. See `docs/superpowers/plans/2026-09-22-per-mode-config/`.
import type { ArenaId } from "../../arena/registry.js";
import type { ModeTables } from "../types.js";
import { DEATHMATCH_CARS } from "./cars.js";
import { DEATHMATCH_WEAPONS } from "./weapons.js";
import { DEATHMATCH_DRIVE } from "./drive.js";
import { DEATHMATCH_RAM } from "./ram.js";
import { DEATHMATCH_IMPULSE } from "./impulse.js";
import { DEATHMATCH_COMBAT } from "./combat.js";
import { DEATHMATCH_TURRET } from "./turret.js";
import {
  DEATHMATCH_STATUS_CONFIG,
  DEATHMATCH_STATUS_TABLE,
  DEATHMATCH_STATUS_LIMITS,
} from "./status.js";
import { DEATHMATCH_SPIKE } from "./spike.js";
import { DEATHMATCH_SLOTS } from "./slots.js";
import { DEATHMATCH_FLOW } from "./flow.js";
import { DEATHMATCH_DEATHMATCH } from "./deathmatch.js";
import { DEATHMATCH_CONQUER } from "./conquer.js";
import { DEATHMATCH_CAMERA } from "./camera.js";

export const DEATHMATCH_TABLES: ModeTables = {
  cars: DEATHMATCH_CARS,
  weapons: DEATHMATCH_WEAPONS,
  drive: DEATHMATCH_DRIVE,
  ram: DEATHMATCH_RAM,
  impulse: DEATHMATCH_IMPULSE,
  combat: DEATHMATCH_COMBAT,
  turret: DEATHMATCH_TURRET,
  statusConfig: DEATHMATCH_STATUS_CONFIG,
  statusTable: DEATHMATCH_STATUS_TABLE,
  statusLimits: DEATHMATCH_STATUS_LIMITS,
  spike: DEATHMATCH_SPIKE,
  slots: DEATHMATCH_SLOTS,
  flow: DEATHMATCH_FLOW,
  deathmatch: DEATHMATCH_DEATHMATCH,
  conquer: DEATHMATCH_CONQUER,
  camera: DEATHMATCH_CAMERA,
  arenas: ["arena-01", "arena-02"] as readonly ArenaId[],
  maxPlayers: 6,
};
