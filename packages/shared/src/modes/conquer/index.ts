// Conquer mode's table bundle (CQ13). Byte-equal to Deathmatch's on day one; deliberately NOT in
// table-pinning.test.ts (game-mode skill §9).
import type { ArenaId } from "../../arena/registry.js";
import type { ModeTables } from "../types.js";
import { CONQUER_CARS } from "./cars.js";
import { CONQUER_WEAPONS } from "./weapons.js";
import { CONQUER_DRIVE } from "./drive.js";
import { CONQUER_RAM } from "./ram.js";
import { CONQUER_IMPULSE } from "./impulse.js";
import { CONQUER_COMBAT } from "./combat.js";
import { CONQUER_TURRET } from "./turret.js";
import {
  CONQUER_STATUS_CONFIG,
  CONQUER_STATUS_TABLE,
  CONQUER_STATUS_LIMITS,
} from "./status.js";
import { CONQUER_SPIKE } from "./spike.js";
import { CONQUER_SLOTS } from "./slots.js";
import { CONQUER_FLOW } from "./flow.js";
import { CONQUER_DEATHMATCH } from "./deathmatch.js";
import { CONQUER_CONQUER } from "./conquer.js";
import { CONQUER_CAMERA } from "./camera.js";

export const CONQUER_TABLES: ModeTables = {
  cars: CONQUER_CARS,
  weapons: CONQUER_WEAPONS,
  drive: CONQUER_DRIVE,
  ram: CONQUER_RAM,
  impulse: CONQUER_IMPULSE,
  combat: CONQUER_COMBAT,
  turret: CONQUER_TURRET,
  statusConfig: CONQUER_STATUS_CONFIG,
  statusTable: CONQUER_STATUS_TABLE,
  statusLimits: CONQUER_STATUS_LIMITS,
  spike: CONQUER_SPIKE,
  slots: CONQUER_SLOTS,
  flow: CONQUER_FLOW,
  deathmatch: CONQUER_DEATHMATCH,
  conquer: CONQUER_CONQUER,
  camera: CONQUER_CAMERA,
  arenas: ["arena-03"] as readonly ArenaId[],
  maxPlayers: 6,
};
