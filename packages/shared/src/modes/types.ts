import type { GameMode } from "../constants.js";
import type { ArenaId } from "../arena/registry.js";
import type { ChassisDrive } from "../config/car-config.js";
import type { CombatConfig } from "../config/combat-config.js";
import type { ConquerConfig, ConquerTicks } from "../config/conquer-config.js";
import type { DeathmatchConfig, DeathmatchTicks } from "../config/deathmatch-config.js";
import type { CameraConfig, DriveConfig } from "../config/drive-config.js";
import type { FlowConfig } from "../config/flow-config.js";
import type { ImpulseConfig } from "../config/impulse-config.js";
import type { RamConfig, RamTicks } from "../config/ram-config.js";
import type { SpikeConfig, SpikeTicks } from "../config/spike-config.js";
import type { StatusConfig, StatusLimits } from "../config/status-config.js";
import type { StatusDef, StatusId } from "../config/status-types.js";
import type { TurretConfig, TurretTicks } from "../config/turret-config.js";
import type { CarDef, CarId } from "../config/types.js";
import type { WeaponTicks } from "../config/weapon-ticks.js";
import type { WeaponSlotConfig } from "../config/weapon-slots.js";
import type { BeamWeaponDef, WeaponDef, WeaponId } from "../config/weapon-types.js";

/** The value half of one mode's configuration. Types stay in `config/` (MC4). */
export interface ModeTables {
  readonly cars: Readonly<Record<CarId, CarDef>>;
  readonly weapons: Readonly<Record<WeaponId, WeaponDef>>;
  /**
   * The drive model, minus the OBB hull (`carWidth`/`carHeight`). Spec MC35 keeps the hull GLOBAL —
   * one hull for every mode, because it drags a derived chain behind it (car art pixel size, arena
   * spawn clearance against spikes, `inertiaRadiusSquared()`, both `spinScale` constants, the
   * countdown arrow and hp-bar scaling) — so a mode's own tables must not be ABLE to author a
   * different one, not merely be expected not to. Omitting the two fields here makes that
   * structural: an inline `drive: {...}` literal for a new mode that tried to include them would
   * fail TypeScript's excess-property check. `assembleModeConfig` re-attaches both from the global
   * `DRIVE_CONFIG` when it builds the bundle, so `ModeConfig.drive` below carries the full
   * `DriveConfig` again, hull included.
   */
  readonly drive: Omit<DriveConfig, "carWidth" | "carHeight">;
  readonly ram: RamConfig;
  readonly impulse: ImpulseConfig;
  readonly combat: CombatConfig;
  readonly turret: TurretConfig;
  readonly statusConfig: StatusConfig;
  readonly statusTable: Readonly<Record<StatusId, StatusDef>>;
  readonly statusLimits: StatusLimits;
  readonly spike: SpikeConfig;
  readonly slots: WeaponSlotConfig;
  readonly flow: FlowConfig;
  readonly deathmatch: DeathmatchConfig;
  readonly conquer: ConquerConfig;
  readonly camera: CameraConfig;
  readonly arenas: readonly ArenaId[];
  readonly maxPlayers: number;
}

/** Artifacts derived once per mode at module load and frozen (MC7, nine as of Conquer). */
export interface ModeDerived {
  readonly weaponTicks: Readonly<Record<WeaponId, WeaponTicks>>;
  readonly chassisDrive: Readonly<Record<CarId, ChassisDrive>>;
  readonly burstDefs: Readonly<Partial<Record<WeaponId, BeamWeaponDef>>>;
  readonly ramTicks: Readonly<RamTicks>;
  readonly turretTicks: Readonly<TurretTicks>;
  readonly spikeTicks: Readonly<SpikeTicks>;
  readonly deathmatchTicks: Readonly<DeathmatchTicks>;
  readonly conquerTicks: Readonly<ConquerTicks>;
  readonly statusPulseTicks: Readonly<Record<StatusId, number>>;
}

export interface ModeConfig extends ModeTables {
  readonly id: GameMode;
  readonly derived: ModeDerived;
  /** The full `DriveConfig`, hull included — `assembleModeConfig` re-attaches it. See `ModeTables.drive`. */
  readonly drive: DriveConfig;
}
