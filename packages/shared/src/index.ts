export {
  TICK_RATE_HZ,
  MS_PER_TICK,
  MAX_PLAYERS,
  MAX_TEAM_SIZE,
  DEFAULT_PATCH_RATE_HZ,
  ROOM_NAME,
  RoomPhase,
  GameMode,
  PlayerStatus,
} from "./constants.js";
export type { DeployMode } from "./constants.js";

export { INPUT_MESSAGE } from "./net/input.js";
export type { InputMessage } from "./net/input.js";
export {
  MSG_SWITCH_TEAM,
  MSG_SET_MODE,
  MSG_START_MATCH,
  MSG_KICK,
  MSG_START_ERROR,
  MSG_SELECT_CAR,
  MSG_PREVIEW_CAR,
  MSG_RETURN_TO_LOBBY,
} from "./net/lobby-messages.js";

export { PlayerState } from "./schema/PlayerState.js";
export { ProjectileState } from "./schema/ProjectileState.js";
export { ArenaState } from "./schema/ArenaState.js";

export { applyDamage } from "./sim/damage.js";
export { isRamming, ramDamage, ramOutcome } from "./sim/ram.js";
export type { RamOutcome } from "./sim/ram.js";
export { stepSim } from "./sim/step.js";
export type { SimBody, StepContext } from "./sim/step.js";
export { stepDrive } from "./sim/drive.js";
export { obbsInContact, obbsOverlap, pointInAabb, pointInObb, resolveWorld } from "./sim/collide.js";
export { fireCooldownTicks, muzzleOffset, runCombat } from "./sim/combat.js";
export type { CombatInput, CombatPlayer, CombatResult, CombatWorld } from "./sim/combat.js";
export {
  canDamage,
  projectileExpired,
  projectileHitsCar,
  projectileHitsObstacle,
  stepProjectile,
} from "./sim/projectiles.js";
export type { Proj } from "./sim/projectiles.js";
export type { Aabb, Bounds, Obb } from "./sim/collide.js";
export { carHullOf, carIdOf, isOnField, otherCarHulls } from "./sim/context.js";
export type { ContextEntry, ContextPlayer } from "./sim/context.js";

export type { CarDef, CarId, ColorDef } from "./config/types.js";
export {
  CAR_TABLE,
  DEFAULT_CAR_ID,
  forwardMaxSpeedOf,
  hpOf,
  isCarId,
  reverseMaxSpeedOf,
} from "./config/car-config.js";
export { COLOR_TABLE } from "./config/color-config.js";
export { WEAPON_CONFIG } from "./config/weapon-config.js";
export { COMBAT_CONFIG } from "./config/combat-config.js";
export { CAMERA_CONFIG, DRIVE_CONFIG } from "./config/drive-config.js";
export { FLOW_CONFIG } from "./config/flow-config.js";
export { NET_CONFIG } from "./config/net-config.js";

export type { ArenaDef, Obstacle, Spawn } from "./arena/types.js";
export { ARENA_01 } from "./arena/arena-01.js";
export { DEFAULT_ARENA_ID, getArena } from "./arena/registry.js";

export { normalizeName, validateName, isNameTaken } from "./lobby/names.js";
export type { ValidateNameResult } from "./lobby/names.js";
export { pickTeam, pickColor, canSwitchTeam } from "./lobby/teams.js";
export type { SwitchTeamPlayer } from "./lobby/teams.js";
export { canStart } from "./lobby/start-rules.js";
export type { StartRuleStatus, StartRulePlayer, CanStartResult } from "./lobby/start-rules.js";
export { badgeColor, viewFor } from "./lobby/status.js";
export type { StatusInput, ViewId } from "./lobby/status.js";

export { reduceFlow } from "./flow/match-flow.js";
export type { FlowStatus, FlowPlayer, FlowState, FlowEvent } from "./flow/match-flow.js";
export { assignSpawns } from "./flow/spawns.js";
export { livingSides } from "./flow/win.js";
export type { LivingPlayer, LivingSidesResult } from "./flow/win.js";

