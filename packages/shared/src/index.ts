export {
  TICK_RATE_HZ,
  MS_PER_TICK,
  MAX_PLAYERS,
  DEFAULT_PATCH_RATE_HZ,
  ROOM_NAME,
  RoomPhase,
  GameMode,
  PlayerStatus,
} from "./constants.js";
export type { DeployMode } from "./constants.js";

export { INPUT_MESSAGE } from "./net/input.js";
export type { InputMessage } from "./net/input.js";

export { PlayerState } from "./schema/PlayerState.js";
export { ArenaState } from "./schema/ArenaState.js";

export { stepSim } from "./sim/step.js";
export type { SimBody } from "./sim/step.js";

export type { CarDef, CarId, ColorDef } from "./config/types.js";
export { CAR_TABLE, forwardMaxSpeedOf, hpOf, reverseMaxSpeedOf } from "./config/car-config.js";
export { COLOR_TABLE } from "./config/color-config.js";
export { WEAPON_CONFIG } from "./config/weapon-config.js";
export { COMBAT_CONFIG } from "./config/combat-config.js";
export { DRIVE_CONFIG } from "./config/drive-config.js";
export { FLOW_CONFIG } from "./config/flow-config.js";
export { NET_CONFIG } from "./config/net-config.js";

