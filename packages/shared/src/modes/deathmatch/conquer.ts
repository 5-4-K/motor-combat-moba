// Inert in Deathmatch: only a "conquer" win rule reads it.
import type { ConquerConfig } from "../../config/conquer-config.js";

export const DEATHMATCH_CONQUER = {
  captureDelaySeconds: 5,
  controlTargetSeconds: 60,
  teamSize: 3,
  uniqueChassisPerTeam: true,
} as const satisfies ConquerConfig;
