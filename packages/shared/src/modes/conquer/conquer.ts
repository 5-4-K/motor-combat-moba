// This is the one LIVE copy: Conquer's win rule is "conquer", so this table is what `conquer()`
// actually resolves to when the Conquer mode is active. (Brawl's and Deathmatch's copies of this
// same table are inert — their win rule never reads it.)
import type { ConquerConfig } from "../../config/conquer-config.js";

export const CONQUER_CONQUER = {
  captureDelaySeconds: 5,
  controlTargetSeconds: 60,
  teamSize: 3,
  uniqueChassisPerTeam: true,
} as const satisfies ConquerConfig;
