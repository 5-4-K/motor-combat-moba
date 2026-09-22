import { CAR_TABLE } from "./car-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { IMPULSE_CONFIG } from "./impulse-config.js";
import { RAM_CONFIG } from "./ram-config.js";
import { isStatusId } from "./status-config.js";
import { TURRET_CONFIG } from "./turret-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import { DEFAULT_GAME_MODE } from "../modes/registry.js";
import { installMode } from "../modes/active.js";
import { assembleModeConfig } from "../modes/build.js";
import { LEGACY_TABLES } from "../modes/legacy.js";
import type { ModeTables } from "../modes/types.js";

export type TuningValue = number | boolean | string;

/**
 * Flat dot-paths into the seven balance tables: `"car.mirage.speed"`, `"drive.baseTurnRate"`,
 * `"ram.attackerLockMs"`, `"combat.hpPerRating"`, `"impulse.spinScale"`, `"weapon.predator.damage"`,
 * `"turret.turnRateDegPerSec"`, `"car.mirage.turretMount.x"`,
 * `"weapon.pepperbox.hitbox.radiusAlong"`. Numeric segments index arrays
 * (`"weapon.predator.applies.0.durationMs"`).
 */
export type TuningOverrides = Readonly<Record<string, TuningValue>>;

/**
 * Dev-only runtime balance tuning (spec PG12).
 *
 * **Rewritten for the accessor-layer migration (MC14, fix round 1).** This used to mutate the seven
 * source tables below IN PLACE and then tell a handful of module-load-derived caches to re-resolve
 * (`rebuildResolvedDrive`/`rebuildWeaponTicks`/`rebuildRamTicks`/`rebuildBurstDefs`/
 * `rebuildTurretTicks`). That stopped working the moment the accessors those caches fed (`driveOf`,
 * `weaponTicksOf`, `ramTicks()`, `instanceDefOf`, and every other accessor in `modes/active.ts`)
 * started reading the INSTALLED mode bundle instead of a module global: a bundle is a
 * `structuredClone` taken once when it is assembled, so mutating `CAR_TABLE`/`WEAPON_TABLE`/etc.
 * afterward no longer reaches it, no matter how many rebuild functions run.
 *
 * The fix matches how the accessors actually read config now: `setTuning` builds a **fresh
 * `ModeConfig` bundle** from `LEGACY_TABLES` with the overrides written into a clone of it, and
 * `installMode`s that bundle — process-wide, exactly as before (this dev tool was never per-room).
 * `setTuning(null)` installs a bundle assembled straight from the untouched `LEGACY_TABLES`. Neither
 * path ever mutates `CAR_TABLE`/`DRIVE_CONFIG`/`WEAPON_TABLE`/`RAM_CONFIG`/`COMBAT_CONFIG`/
 * `IMPULSE_CONFIG`/`TURRET_CONFIG` — those seven stay the pristine shipped values forever, which is
 * also what keeps `DEFAULTS` below (validated against once, at module load) permanently accurate.
 * There is nothing left to "rebuild": assembling a bundle already resolves every derived artifact
 * (`derived.chassisDrive`, `derived.weaponTicks`, `derived.ramTicks`, `derived.burstDefs`, ...) as
 * one step, so the five `rebuild*` functions this file used to call have no successor at all.
 */
type Container = Record<string, unknown>;

const ROOTS: Readonly<Record<string, object>> = Object.freeze({
  car: CAR_TABLE,
  drive: DRIVE_CONFIG,
  ram: RAM_CONFIG,
  impulse: IMPULSE_CONFIG,
  combat: COMBAT_CONFIG,
  weapon: WEAPON_TABLE,
  turret: TURRET_CONFIG,
});

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const inner of Object.values(value as Container)) deepFreeze(inner);
  return Object.freeze(value);
}

/**
 * A validation-only snapshot of the seven balance-table shapes, taken once at module load. Nothing
 * ever mutates `ROOTS`'s own tables any more (see the note above), so this stays accurate forever —
 * it no longer needs to double as "the shipped values `setTuning(null)` restores", because
 * `setTuning(null)` now re-assembles a bundle from `LEGACY_TABLES` instead of restoring into a live
 * object.
 */
const DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze(
  Object.fromEntries(Object.entries(ROOTS).map(([key, table]) => [key, deepFreeze(structuredClone(table))])),
);

let active: TuningOverrides | null = null;

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

function hasOwn(container: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(container, key);
}

/**
 * Walks a dot-path down one of the root maps and returns the container holding its leaf. Every hop
 * is an own-property check: `in` would walk the prototype chain and let `"car.mirage.toString"`
 * resolve to a function.
 */
function leafOf(roots: Readonly<Record<string, unknown>>, path: string): { container: Container; key: string } {
  const segments = path.split(".");
  const group = segments[0] ?? "";
  if (segments.length < 2 || !hasOwn(roots, group)) throw new Error(`unknown tuning path: ${path}`);
  let node: unknown = roots[group];
  for (let i = 1; i < segments.length - 1; i += 1) {
    const segment = segments[i] as string;
    if (!isContainer(node) || !hasOwn(node, segment)) throw new Error(`unknown tuning path: ${path}`);
    node = node[segment];
  }
  const key = segments[segments.length - 1] as string;
  if (!isContainer(node) || !hasOwn(node, key)) throw new Error(`unknown tuning path: ${path}`);
  return { container: node, key };
}

/**
 * Validated against the SNAPSHOT, not the live table, and before anything is written — a rejected
 * `setTuning` must leave the tables exactly as it found them, including any override already active.
 */
function assertAssignable(path: string, value: TuningValue): void {
  const { container, key } = leafOf(DEFAULTS, path);
  const shipped = container[key];
  if (typeof shipped !== typeof value) {
    throw new Error(`tuning path ${path} is ${typeof shipped}, not ${typeof value}`);
  }
  // The one VALUE check in an otherwise shape-only validator, and it earns its exception: a
  // `statusId` leaf is the only string in these tables that is looked up in another table rather
  // than read as data. `applyStatus` takes an unknown id straight to `statusDefOf(...)!.onApply` and
  // throws a bare TypeError mid-tick, killing the room — so an unknown id has to be refused HERE,
  // before the store is written, which is also what keeps `setTuning`'s all-or-nothing promise.
  // Every such leaf is reachable: `weapon.<id>.applies.N.statusId`, `...explosion.applies.N.statusId`
  // and — new in stage 4 of the Unity physics port — `...impulse.applies.N.statusId` and
  // `...impulse.onWallImpact.applies.N.statusId`.
  if (key === "statusId" && !isStatusId(value)) {
    throw new Error(`tuning path ${path} is not a status id: ${String(value)}`);
  }
}

export function setTuning(overrides: TuningOverrides | null): void {
  if (overrides) {
    // Shape-validated against the frozen `DEFAULTS` snapshot, all-or-nothing, before a single byte
    // of `tables` below is written — unchanged from before this rewrite. A rejected call installs
    // nothing and leaves whatever bundle was already active running.
    for (const [path, value] of Object.entries(overrides)) assertAssignable(path, value);
  }

  if (!overrides) {
    installMode(assembleModeConfig(DEFAULT_GAME_MODE, LEGACY_TABLES));
    active = null;
    return;
  }

  // A fresh clone every call — never `LEGACY_TABLES` itself, and never a bundle from a previous
  // `setTuning` call — so overrides replace rather than accumulate, the same promise the old
  // restore-then-apply dance kept.
  const tables = structuredClone(LEGACY_TABLES) as ModeTables;
  const tuningRoots: Readonly<Record<string, unknown>> = {
    car: tables.cars,
    weapon: tables.weapons,
    drive: tables.drive,
    ram: tables.ram,
    impulse: tables.impulse,
    combat: tables.combat,
    turret: tables.turret,
  };
  for (const [path, value] of Object.entries(overrides)) {
    const { container, key } = leafOf(tuningRoots, path);
    container[key] = value;
  }
  installMode(assembleModeConfig(DEFAULT_GAME_MODE, tables));
  active = Object.freeze({ ...overrides });
}

export function activeTuning(): TuningOverrides | null {
  return active;
}
