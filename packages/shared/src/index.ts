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
  WeaponKind,
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
export { WeaponInstanceState } from "./schema/WeaponInstanceState.js";
export { WeaponSlotState } from "./schema/WeaponSlotState.js";
export { ArenaState } from "./schema/ArenaState.js";

export { applyDamage } from "./sim/damage.js";
export { stepSim } from "./sim/step.js";
export type { SimBody, StepContext } from "./sim/step.js";
export { stepDrive } from "./sim/drive.js";
export {
  circleOverlapsObb,
  convexOverlap,
  obbCorners,
  obbsInContact,
  obbsOverlap,
  pointInAabb,
  pointInObb,
  resolveWorld,
} from "./sim/collide.js";
export { runCombat } from "./sim/combat.js";
export type { CombatInput, CombatPlayer, CombatResult, CombatWorld } from "./sim/combat.js";
export { canDamage } from "./sim/weapons/targets.js";
export {
  hasLineOfSight,
  inAcquireRegion,
  inRetainRegion,
  lockScore,
  muzzleOf,
  newLockState,
  signedAngleDegTo,
  updateLock,
} from "./sim/weapons/lock.js";
export type { LockOwner, LockState, LockTarget, UpdateLockContext } from "./sim/weapons/lock.js";
export {
  beginFire,
  cancelPending,
  newFireState,
  releaseShots,
  tickRecharge,
} from "./sim/weapons/fire.js";
export type { FireState, PendingFire, SlotState } from "./sim/weapons/fire.js";
export {
  instanceExpired,
  muzzleOffset,
  spawnInstances,
  stepInstance,
  wallClipDistance,
} from "./sim/weapons/instances.js";
export type { ShotOrder, WeaponInstance } from "./sim/weapons/instances.js";
export { resolveInstanceHits } from "./sim/weapons/hits.js";
export type { PoseEntry, PoseSnapshot } from "./sim/weapons/hits.js";
export { beamShapeAt, projectileShapeAt, shapeHitsObb, smear } from "./sim/weapons/shapes.js";
export type { WorldShape } from "./sim/weapons/shapes.js";
export type { Aabb, Bounds, Obb, Vec2 } from "./sim/collide.js";
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
export { WEAPON_TABLE, isWeaponId, weaponDefOf } from "./config/weapon-config.js";
export type {
  BeamHitbox,
  BeamWeaponDef,
  Hitbox,
  ProjectileHitbox,
  ProjectileWeaponDef,
  StockDef,
  VolleyDef,
  WeaponDef,
  WeaponId,
} from "./config/weapon-types.js";
export { WEAPON_TICKS, msToTicks, weaponTicksOf } from "./config/weapon-ticks.js";
export type { WeaponTicks } from "./config/weapon-ticks.js";
export { WEAPON_SLOT_CONFIG, slotsFrom, slotsOf } from "./config/weapon-slots.js";
export { COMBAT_CONFIG } from "./config/combat-config.js";
export { AIM_CONFIG, AIM_TICKS } from "./config/aim-config.js";
export type { AimTicks } from "./config/aim-config.js";
export { CAMERA_CONFIG, DRIVE_CONFIG } from "./config/drive-config.js";
export { FLOW_CONFIG } from "./config/flow-config.js";
export { NET_CONFIG } from "./config/net-config.js";

export type { ArenaDef, Obstacle, Spawn } from "./arena/types.js";
export { ARENA_01 } from "./arena/arena-01.js";
export { ARENA_02 } from "./arena/arena-02.js";
export { ARENAS, ARENA_IDS, getArena, isArenaId } from "./arena/registry.js";
export type { ArenaId } from "./arena/registry.js";
export { ACTIVE_ARENA_ID } from "./config/arena-config.js";
export { ARENA_ART_COMMON, ARENA_ART_PREFIX, arenaIdFromArtKey } from "./arena/art-keys.js";

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

