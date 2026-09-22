# Name ledger

Every name the phase plans share. **This file outranks any one plan and is outranked by the spec.**
If a plan and this file disagree, this file wins; if this file and the spec disagree, the spec wins.

## `packages/shared/src/modes/types.ts`

```ts
/** The value half of one mode's configuration. Types stay in `config/` (MC4). */
export interface ModeTables {
  readonly cars: Readonly<Record<CarId, CarDef>>;
  readonly weapons: Readonly<Record<WeaponId, WeaponDef>>;
  readonly drive: DriveConfig;
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
  readonly camera: CameraConfig;
  readonly arenas: readonly ArenaId[];
  readonly maxPlayers: number;
}

/** Artifacts derived once per mode at module load and frozen (MC7). */
export interface ModeDerived {
  readonly weaponTicks: Readonly<Record<WeaponId, WeaponTicks>>;
  readonly chassisDrive: Readonly<Record<CarId, ChassisDrive>>;
  readonly burstDefs: Readonly<Partial<Record<WeaponId, BeamWeaponDef>>>;
  readonly ramTicks: Readonly<RamTicks>;
  readonly turretTicks: Readonly<TurretTicks>;
  readonly spikeTicks: Readonly<SpikeTicks>;
  readonly deathmatchTicks: Readonly<DeathmatchTicks>;
  readonly statusPulseTicks: Readonly<Record<StatusId, number>>;
}

export interface ModeConfig extends ModeTables {
  readonly id: GameMode;
  readonly derived: ModeDerived;
}
```

## `packages/shared/src/modes/build.ts`

```ts
/** Computes `ModeDerived`, deep-freezes, returns the bundle. The ONLY place a bundle is made. */
export function assembleModeConfig(id: GameMode, tables: ModeTables): ModeConfig;
```

## `packages/shared/src/modes/active.ts`

```ts
export function withMode<T>(config: ModeConfig, fn: () => T): T;
export function cfg(): ModeConfig;                 // THROWS outside a scope (MC12)
export function hasMode(): boolean;                // diagnostics and tests only

/**
 * Boot-time install with no restore. SCAFFOLDING: phase 1 calls it once at module load so the
 * whole existing suite keeps passing while accessors move onto the bundle. Phase 3 deletes that
 * call, at which point `cfg()` genuinely throws outside a `withMode` scope (MC12) and every test
 * installs a mode in its own setup.
 */
export function installMode(config: ModeConfig): void;

// Accessors (MC13). Each is a one-line read of `cfg()`.
export function cars(): Readonly<Record<CarId, CarDef>>;
export function weapons(): Readonly<Record<WeaponId, WeaponDef>>;
export function drive(): DriveConfig;
export function ram(): RamConfig;
export function impulse(): ImpulseConfig;
export function combat(): CombatConfig;
export function turret(): TurretConfig;
export function statusConfig(): StatusConfig;
export function statusTable(): Readonly<Record<StatusId, StatusDef>>;
export function statusLimits(): StatusLimits;
export function spike(): SpikeConfig;
export function slots(): WeaponSlotConfig;
export function flow(): FlowConfig;
export function deathmatch(): DeathmatchConfig;
export function camera(): CameraConfig;
export function derived(): ModeDerived;
```

## `packages/shared/src/modes/registry.ts`

```ts
export interface ModeDef {
  readonly id: GameMode;
  readonly name: string;
  readonly isActive: boolean;
  readonly config: ModeConfig;
}
export const MODE_TABLE: Readonly<Record<GameMode, ModeDef>>;

/** Throws on an unknown mode. The PROGRAMMER-facing accessor — never call it on a wire value. */
export function modeConfigOf(mode: GameMode): ModeConfig;

/**
 * The WIRE-facing accessor. `state.mode` is a uint8 an old client can set to anything, so a room
 * must never resolve it through the throwing form: that kills the room mid-tick. Logs once and
 * falls back to `DEFAULT_GAME_MODE` (phase 3, Task 4).
 */
export function modeConfigOrDefault(mode: number): ModeConfig;
/** Union of every ACTIVE mode's arena set, de-duplicated, registry order (MC24, MC25). */
export function activeArenaIds(): readonly ArenaId[];
```

`isGameMode`, `isActiveGameMode`, `activeGameModes`, `DEFAULT_GAME_MODE` and `MODE_ORDER` keep their
current signatures and move here from `config/mode-config.ts`.

## Type changes to existing `config/` types

Two existing types gain a field; both are edits to the single-source type, not copies (MC4).

```ts
// config/weapon-slots.ts — BASIC_ATTACK_CONFIG is one boolean and becomes part of the
// per-mode slot config rather than a config object of its own (MC27).
export interface WeaponSlotConfig {
  readonly maxAbilitySlots: number;
  readonly maxFireSlots: number;        // derived: maxAbilitySlots + 1
  readonly basicAttackSlotIndex: 0;     // derived, always 0
  readonly basicAttackEnabled: boolean; // WAS BASIC_ATTACK_CONFIG.enabled
}
```

`BASIC_ATTACK_CONFIG` is deleted; its three readers in `sim/` and its readers in the client HUD,
`build-cars-and-weapons.mjs` and `BotController.chooseSlot` all move to `slots().basicAttackEnabled`
or the per-mode equivalent. The `basic-attack-toggle` skill's checklist changes with it — flipping
the flag is now a per-mode edit (phase 6, Task 6).

## `packages/shared/src/modes/overlay.ts` (phase 5)

```ts
/** Clones `base`'s tables, writes each dot-path, re-assembles. Never mutates `base`. */
export function applyOverrides(base: ModeConfig, overrides: TuningOverrides): ModeConfig;
```

## `packages/shared/src/modes/test-setup.ts` (phase 3)

```ts
/** Runs `fn` inside DEFAULT_GAME_MODE's bundle. For suites that are not about a specific mode. */
export function withDefaultMode<T>(fn: () => T): T;
```

## `scripts/build-cars-and-weapons.mjs` (phase 6)

```js
/** Pure inner form, so a test can stamp a hypothetical set of modes without touching the registry. */
export function stampOfModes(configs);
/** balanceStamp() === stampOfModes(activeGameModes().map(modeConfigOf)) */
export function balanceStamp();
```

## Existing accessors — signatures UNCHANGED, bodies rewritten (MC14)

`driveOf(id)`, `weaponDefOf(id)`, `weaponTicksOf(id)`, `hpOf(id)`, `statusDefOf(id)`, `slotsOf(id)`,
`basicAttackOf(id)`, `ramAttackOf(id)`, `ramDefenceOf(id)`, `turretMountOf(id)`,
`instanceDefOf(id, isExplosion)`, `fireSlotsOf(id)`, `activeCarIds()`, `armedCarIds()`,
`basicAttackIds()`, `isCarId(v)`, `isWeaponId(v)`, `isStatusId(v)`, `statusPulseTicksOf(id)`,
`explosionDamageModeOf(id)`, `inertiaRadiusSquared()`, `ramTicks()`.

**Their ~50 call sites in `sim/` change zero characters.** Only the bodies change, from reading an
imported table to reading the matching accessor above.

## `packages/server/src/rooms/mode-scope.ts`

```ts
/** Wraps every room entry point so a handler cannot run unscoped (MC15). */
export function scoped<T>(config: ModeConfig, fn: () => T): T;
```

## `packages/server/src/config/mode-bot.ts`

```ts
export interface BotModeConfig {
  readonly profiles: Readonly<Record<BotDifficulty, BotProfile>>;
  readonly brainConstants: BrainConstants;
  readonly brainVersion: string;
}
export const MODE_BOT_CONFIG: Readonly<Record<GameMode, BotModeConfig>>;
export function botConfigOf(mode: GameMode): BotModeConfig;
```

## `packages/client/src/net/mode-scope.ts`

```ts
/** Installs the bundle for the joined room and re-installs when `state.mode` changes (MC16). */
export function installRoomMode(mode: GameMode): void;
export function runInRoomMode<T>(fn: () => T): T;
```

## Naming rules

- `cfg()` is the raw bundle read; **prefer a named accessor** at every call site.
- Bundle field names match their old global's name minus the `_CONFIG` / `_TABLE` suffix,
  lowercased: `DRIVE_CONFIG` → `drive`, `WEAPON_TABLE` → `weapons`, `STATUS_TABLE` → `statusTable`.
- A mode folder's key is lowercase and matches its `name` where possible: `brawl/`, `deathmatch/`.
