// Brawl mode's table bundle (MC2). Every value here is identical to today's live config — this
// mode has not been tuned yet. See `docs/superpowers/plans/2026-09-22-per-mode-config/`.
import type { ArenaId } from "../../arena/registry.js";
import type { ModeTables } from "../types.js";
import { BRAWL_CARS } from "./cars.js";
import { BRAWL_WEAPONS } from "./weapons.js";
import { BRAWL_DRIVE } from "./drive.js";
import { BRAWL_RAM } from "./ram.js";
import { BRAWL_IMPULSE } from "./impulse.js";
import { BRAWL_COMBAT } from "./combat.js";
import { BRAWL_TURRET } from "./turret.js";
import { BRAWL_STATUS_CONFIG, BRAWL_STATUS_TABLE, BRAWL_STATUS_LIMITS } from "./status.js";
import { BRAWL_SPIKE } from "./spike.js";
import { BRAWL_SLOTS } from "./slots.js";
import { BRAWL_FLOW } from "./flow.js";
import { BRAWL_DEATHMATCH } from "./deathmatch.js";
import { BRAWL_CONQUER } from "./conquer.js";
import { BRAWL_CAMERA } from "./camera.js";

export const BRAWL_TABLES: ModeTables = {
  cars: BRAWL_CARS,
  weapons: BRAWL_WEAPONS,
  drive: BRAWL_DRIVE,
  ram: BRAWL_RAM,
  impulse: BRAWL_IMPULSE,
  combat: BRAWL_COMBAT,
  turret: BRAWL_TURRET,
  statusConfig: BRAWL_STATUS_CONFIG,
  statusTable: BRAWL_STATUS_TABLE,
  statusLimits: BRAWL_STATUS_LIMITS,
  spike: BRAWL_SPIKE,
  slots: BRAWL_SLOTS,
  flow: BRAWL_FLOW,
  deathmatch: BRAWL_DEATHMATCH,
  conquer: BRAWL_CONQUER,
  camera: BRAWL_CAMERA,
  arenas: ["arena-01", "arena-02"] as readonly ArenaId[],
  maxPlayers: 6,
};
