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

// The per-mode config scope (MC9-MC13). Server and client need `withMode`/`assembleModeConfig` to
// scope a bundle of their own — a test bundle, or eventually a real non-default mode — rather than
// only ever reading whatever this process last installed.
export { withMode, cfg, installMode, hasMode } from "./modes/active.js";
// `applyOverrides` (MC39/MC40): builds a tuned SIBLING of a base bundle without installing anything.
// It REPLACED `config/tuning.ts`'s process-wide `setTuning`, which is gone — that file is types only
// now. See `modes/overlay.ts` for the full reasoning.
export { applyOverrides } from "./modes/overlay.js";
// The bundle accessors themselves (MC13/MC14): `sim/` has read exclusively through these since the
// accessor-layer work, and server/client code that used to read a raw config global in place — a
// playground retune rebuilds the BUNDLE rather than mutating those globals — needs the same
// accessors to stay live under it. Task 5b (see docs/superpowers/sdd) widened this from
// `drive, turret, derived` to the full accessor set, since the 108 raw reads it converted outside
// `shared/src/sim` needed every one of them.
export {
  drive,
  turret,
  derived,
  ram,
  impulse,
  combat,
  spike,
  statusConfig,
  statusTable,
  statusLimits,
  slots,
  cars,
  weapons,
  flow,
  deathmatch,
  conquer,
  camera,
} from "./modes/active.js";
export { assembleModeConfig } from "./modes/build.js";
export type { ModeConfig, ModeTables } from "./modes/types.js";

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
  MSG_CHAT,
  isChatPayload,
} from "./net/lobby-messages.js";
export {
  BOT_SESSION_ID,
  MSG_PLAYGROUND_BOT_DEBUG,
  MSG_PLAYGROUND_PAUSE,
  MSG_PLAYGROUND_SETUP,
  MSG_PLAYGROUND_TUNING,
  PLAYGROUND_ROOM_NAME,
  PLAYGROUND_SEATS,
  PLAYGROUND_SEAT_IDS,
  defaultPlaygroundSetup,
  isBotDebugPayload,
  isBotDifficulty,
  isPlaygroundSetup,
} from "./net/playground-messages.js";
export type {
  BotDebugPayload,
  BotDifficulty,
  PlaygroundCarSetup,
  PlaygroundSetup,
} from "./net/playground-messages.js";
export {
  MSG_PRACTICE_IDLE_WARNING,
  MSG_PRACTICE_PAUSE,
  PRACTICE_FULL_CLOSE_CODE,
  PRACTICE_FULL_ERROR,
  PRACTICE_IDLE_CLOSE_CODE,
  PRACTICE_IDLE_ERROR,
  PRACTICE_INVALID_SETUP_CLOSE_CODE,
  PRACTICE_INVALID_SETUP_ERROR,
  PRACTICE_PLAYGROUND_BUSY_CLOSE_CODE,
  PRACTICE_PLAYGROUND_BUSY_ERROR,
  PRACTICE_ROOM_NAME,
  defaultPracticeSetup,
  isPracticeSetup,
} from "./net/practice-messages.js";
export type { PracticeOpponent, PracticeSetup } from "./net/practice-messages.js";

export { StatusState } from "./schema/StatusState.js";
export { PlayerState } from "./schema/PlayerState.js";
export { WeaponInstanceState } from "./schema/WeaponInstanceState.js";
export { WeaponSlotState } from "./schema/WeaponSlotState.js";
export { ArenaState } from "./schema/ArenaState.js";
export { ChatMessageState } from "./schema/ChatMessageState.js";
export { PlaygroundState } from "./schema/PlaygroundState.js";
export { PracticeState } from "./schema/PracticeState.js";

export {
  RAM_CONFIG,
  halfLifeToPerTick,
  inertiaRadiusSquared,
  ramTicks,
  reelingSpinPerTick,
} from "./config/ram-config.js";
export { applyDamage, applyHeal, damageFor, scaleDamage, weaponDamageOf } from "./sim/damage.js";
export { stepSim } from "./sim/step.js";
export type { SimBody, StepContext } from "./sim/step.js";
export { stepDrive } from "./sim/drive.js";
export { ManeuverKind, NO_MANEUVER } from "./sim/maneuver.js";
export type { ManeuverKindValue } from "./sim/maneuver.js";
export {
  circleOverlapsObb,
  contactNormalBetween,
  convexOverlap,
  nearestPointOnObb,
  obbCorners,
  obbsInContact,
  obbsOverlap,
  pointInAabb,
  pointInObb,
  resolveWorld,
} from "./sim/collide.js";
export { runCombat, startManeuver } from "./sim/combat.js";
export type {
  CombatInput,
  CombatPlayer,
  CombatResult,
  CombatWorld,
  StatusRequest,
} from "./sim/combat.js";
export { applyImpulse, type Impulse } from "./sim/impulse.js";
export { applyRams, contactPointOn, pairKey, ramTypeOf, regionOf, resolveRam } from "./sim/ram.js";
export type { RamCar, RamRegion, RamResolution, RamSide, RamType } from "./sim/ram.js";
export { IMPULSE_CONFIG } from "./config/impulse-config.js";
export { hullTouchesWorld, resolveContacts } from "./sim/contact.js";
export type {
  ContactCar,
  ContactEvents,
  ContactHit,
  SpikeContact,
  SpikeHit,
} from "./sim/contact.js";
export { newCombatEvents } from "./sim/combat-events.js";
export type {
  CombatEvents, DamagedEvent, DamageSource, FiredEvent, HazardId, KilledEvent,
} from "./sim/combat-events.js";
export { canDamage } from "./sim/weapons/targets.js";
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
  muzzleOf,
  muzzleOffset,
  type OwnerPose,
  spawnInstances,
  stepInstance,
  wallClipDistance,
} from "./sim/weapons/instances.js";
export type { ShotOrder, WeaponInstance } from "./sim/weapons/instances.js";
export { resolveInstanceHits } from "./sim/weapons/hits.js";
export type { PoseEntry, PoseSnapshot } from "./sim/weapons/hits.js";
export { beamShapeAt, projectileShapeAt, shapeHitsObb, smear } from "./sim/weapons/shapes.js";
export type { WorldShape } from "./sim/weapons/shapes.js";
export {
  carHasTurretWeapon,
  clampBearingToSwing,
  clampToSwing,
  turnTurret,
  turretPivotOf,
  turretTurnDelta,
  wrapAngle,
} from "./sim/weapons/turret.js";
export type { Aabb, Bounds, CarObstacle, Obb, Vec2 } from "./sim/collide.js";
export { carHullOf, carIdOf, isOnField, isSolid, otherCarHulls } from "./sim/context.js";
export type { ContextEntry, ContextPlayer } from "./sim/context.js";
export { forwardOf, lateralOf, speedOf, toWorld } from "./sim/velocity.js";

export type { CarDef, CarId, ColorDef } from "./config/types.js";
export {
  CAR_TABLE,
  DEFAULT_CAR_ID,
  activeCarIds,
  basicAttackIds,
  basicAttackOf,
  dragRateOf,
  driveOf,
  engineAccelOf,
  forwardMaxSpeedOf,
  hpOf,
  isActiveCarId,
  isCarId,
  ramAttackOf,
  ramDefenceOf,
  reverseAccelOf,
  turnRateOf,
  turretMountOf,
} from "./config/car-config.js";
export type { ChassisDrive } from "./config/car-config.js";
export {
  DEFAULT_GAME_MODE,
  MODE_TABLE,
  activeArenaIds,
  activeGameModes,
  isActiveGameMode,
  isGameMode,
  modeConfigOf,
  modeConfigOrDefault,
} from "./modes/registry.js";
export type { ModeDef } from "./modes/registry.js";
// `--mode=<id|name>` for the headless tooling (MC41): ttk, balance and playtest all parse the flag,
// label their report and name their report folder through this one module.
export { modeLabelOf, modeOptions, modeSlug, parseModeArg } from "./modes/mode-arg.js";
export { COLOR_TABLE, isColorId } from "./config/color-config.js";
export {
  BASIC_ATTACK_CONFIG,
  WEAPON_TABLE,
  instanceDefOf,
  isWeaponId,
  weaponDefOf,
} from "./config/weapon-config.js";
export type {
  BeamHitbox,
  BeamOrigin,
  BeamWeaponDef,
  ExplosionDef,
  Hitbox,
  HomingDef,
  ImpulseDef,
  ManeuverSpec,
  ManeuverWeaponDef,
  PelletDef,
  ProjectileHitbox,
  ProjectileWeaponDef,
  StatusApplication,
  StatusTarget,
  StockDef,
  TurretDef,
  VolleyDef,
  WeaponDef,
  WeaponId,
} from "./config/weapon-types.js";
export { WEAPON_TICKS, msToTicks, scaleTicks, weaponTicksOf } from "./config/weapon-ticks.js";
export type { WeaponTicks } from "./config/weapon-ticks.js";
export { ABILITY_SLOT_CEILING, WEAPON_SLOT_CONFIG, slotsFrom, slotsOf, fireSlotsOf } from "./config/weapon-slots.js";
export { TURRET_CONFIG, TURRET_TICKS, type TurretConfig } from "./config/turret-config.js";
export { COMBAT_CONFIG, DEATH_FADE_MS } from "./config/combat-config.js";
export type { TuningOverrides, TuningValue } from "./config/tuning.js";
export { sanitizeStoredTuning, tunableFields, validateTuning } from "./config/tuning-walker.js";
export type { TunableField } from "./config/tuning-walker.js";

// --- statuses (buffs and debuffs) ----------------------------------------------------------
export {
  STATUS_CONFIG,
  STATUS_IDS,
  STATUS_LIMITS,
  STATUS_TABLE,
  isStatusId,
  statusDefOf,
} from "./config/status-config.js";
export type {
  StatusChannel,
  StatusDef,
  StatusFlag,
  StatusId,
  StatusKind,
  StatusOnApply,
  StatusPulse,
  StatusReapply,
} from "./config/status-types.js";
export { STATUS_PULSE_TICKS, statusPulseTicksOf } from "./config/status-ticks.js";
export {
  applyStatus,
  clearStatuses,
  expireStatuses,
  expireStatusesFromSource,
  hasStatus,
  isPhasedAt,
  modifiersFromRows,
  newStatusState,
  remainingTicks,
  statusPulses,
  toActiveStatuses,
} from "./sim/status/statuses.js";
export type { ActiveStatus, StatusPulseResult, StatusRow } from "./sim/status/statuses.js";
export { NEUTRAL_MODIFIERS, modifiersOf } from "./sim/status/modifiers.js";
export type { Modifiers } from "./sim/status/modifiers.js";
export { CAMERA_CONFIG, DRIVE_CONFIG, LOGICAL_CANVAS } from "./config/drive-config.js";
export { FLOW_CONFIG } from "./config/flow-config.js";
export { DEATHMATCH_CONFIG, DEATHMATCH_TICKS } from "./config/deathmatch-config.js";
export { CONQUER_CONFIG, resolveConquerTicks } from "./config/conquer-config.js";
export type { ConquerConfig, ConquerTicks } from "./config/conquer-config.js";
export { NET_CONFIG } from "./config/net-config.js";
export { PRACTICE_CONFIG } from "./config/practice-config.js";
export { CHAT_CONFIG } from "./config/chat-config.js";
export { SPIKE_CONFIG, SPIKE_TICKS } from "./config/spike-config.js";

export type { ArenaDef, ArenaZone, Obstacle, Spawn } from "./arena/types.js";
export { ARENA_01 } from "./arena/arena-01.js";
export { ARENA_02 } from "./arena/arena-02.js";
export { ARENA_03 } from "./arena/arena-03.js";
export { ARENAS, ARENA_IDS, getArena, isArenaId } from "./arena/registry.js";
export type { ArenaId } from "./arena/registry.js";
export { ACTIVE_ARENA_ID } from "./config/arena-config.js";
export { ARENA_ART_COMMON, ARENA_ART_PREFIX, arenaIdFromArtKey } from "./arena/art-keys.js";
export { boundsOf, playableExtentOf } from "./arena/bounds.js";
export { planesOf, rectPlanes, supportRadius, planePenetration, type BoundaryPlane } from "./sim/boundary.js";

export { normalizeName, validateName, isNameTaken } from "./lobby/names.js";
export type { ValidateNameResult } from "./lobby/names.js";
export { pickTeam, pickColor, canSwitchTeam } from "./lobby/teams.js";
export type { SwitchTeamPlayer } from "./lobby/teams.js";
export { canStart } from "./lobby/start-rules.js";
export type { StartRuleStatus, StartRulePlayer, CanStartResult } from "./lobby/start-rules.js";
export { badgeColor, viewFor } from "./lobby/status.js";
export type { StatusInput, ViewId } from "./lobby/status.js";
export { normalizeChatText, validateChatText } from "./lobby/chat.js";
export type { ValidateChatResult } from "./lobby/chat.js";

export { reduceFlow } from "./flow/match-flow.js";
export type { FlowStatus, FlowPlayer, FlowState, FlowEvent } from "./flow/match-flow.js";
export { assignSpawns } from "./flow/spawns.js";
export { respawnsIn, sidesOf, winRuleOf } from "./flow/modes.js";
export { farthestSpawn, isDueToRespawn, phaseDecision } from "./flow/respawn.js";
export type { PhaseAction, PhaseInput } from "./flow/respawn.js";
export { deathmatchEnded, deathmatchOutcome, livingSides } from "./flow/win.js";
export type { DeathmatchPlayer, LivingPlayer, LivingSidesResult } from "./flow/win.js";

