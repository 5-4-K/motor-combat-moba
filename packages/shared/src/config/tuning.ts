import { CAR_TABLE, rebuildResolvedDrive } from "./car-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { RAM_CONFIG, rebuildRamDecay } from "./ram-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import { rebuildWeaponTicks } from "./weapon-ticks.js";

export type TuningValue = number | boolean | string;

/**
 * Flat dot-paths into the five balance tables: `"car.mirage.speed"`, `"drive.baseTurnRate"`,
 * `"ram.massPerRating"`, `"combat.hpPerRating"`, `"weapon.predator.damage"`,
 * `"weapon.pepperbox.hitbox.radiusAlong"`. Numeric segments index arrays
 * (`"weapon.predator.applies.0.durationMs"`).
 */
export type TuningOverrides = Readonly<Record<string, TuningValue>>;

/**
 * Dev-only runtime balance tuning (spec PG12).
 *
 * The five source tables below are `as const` but not frozen, so this module overrides them by
 * mutating them IN PLACE. That is the whole trick: object identity is preserved, so every existing
 * importer — the sim, the render tables, the server — keeps reading the same object and needs no
 * call-site change. Only the artifacts derived once at module load — the resolved drive, the weapon
 * ticks, the ram reference pair, and the ram decay multipliers — have to be told to re-resolve.
 * Anything else derived from one of these tables at module load owes this list an entry, or its
 * source knob is dead to tuning.
 *
 * A deep clone of each table is snapshotted at module load and deep-frozen; every `setTuning` call
 * restores from that snapshot before applying, so overrides replace rather than accumulate and
 * `setTuning(null)` is exactly the shipped build.
 */
type Container = Record<string, unknown>;

const ROOTS: Readonly<Record<string, object>> = Object.freeze({
  car: CAR_TABLE,
  drive: DRIVE_CONFIG,
  ram: RAM_CONFIG,
  combat: COMBAT_CONFIG,
  weapon: WEAPON_TABLE,
});

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const inner of Object.values(value as Container)) deepFreeze(inner);
  return Object.freeze(value);
}

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
 * Copies `source` back over `target` field by field. Nested objects and arrays are recursed into
 * rather than reassigned, so anything that captured a sub-object (a hitbox, an `applies` entry, a
 * kit array) still sees the restored values through its own reference.
 */
function restoreInPlace(target: Container, source: unknown): void {
  if (Array.isArray(source)) {
    const targetArray = target as unknown as unknown[];
    targetArray.length = source.length;
    for (let i = 0; i < source.length; i += 1) restoreKey(target, String(i), source[i]);
    return;
  }
  if (!isContainer(source)) return;
  for (const key of Object.keys(source)) restoreKey(target, key, source[key]);
}

function restoreKey(target: Container, key: string, value: unknown): void {
  if (!isContainer(value)) {
    target[key] = value;
    return;
  }
  const current = target[key];
  if (!isContainer(current) || Array.isArray(current) !== Array.isArray(value)) {
    target[key] = Array.isArray(value) ? [] : {};
  }
  restoreInPlace(target[key] as Container, value);
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
}

export function setTuning(overrides: TuningOverrides | null): void {
  if (overrides) {
    for (const [path, value] of Object.entries(overrides)) assertAssignable(path, value);
  }
  for (const [group, table] of Object.entries(ROOTS)) {
    restoreInPlace(table as Container, DEFAULTS[group]);
  }
  if (overrides) {
    for (const [path, value] of Object.entries(overrides)) {
      const { container, key } = leafOf(ROOTS, path);
      container[key] = value;
    }
  }
  active = overrides ? Object.freeze({ ...overrides }) : null;
  rebuildResolvedDrive(active !== null);
  rebuildWeaponTicks(active !== null);
  rebuildRamDecay(active !== null);
}

export function activeTuning(): TuningOverrides | null {
  return active;
}
