import type { ModeTables } from "./types.js";

const REPLACE: unique symbol = Symbol("replace");

/** A whole value that replaces the base's instead of merging into it (GM8). */
export interface Replaced<T> {
  readonly [REPLACE]: true;
  readonly value: T;
}

/**
 * Wrap a row in `replace(...)` to swap it whole — the only way to add a new keyed row (a new car,
 * weapon or status) or to REMOVE an optional field (e.g. a weapon's `turret`) from a base row.
 */
export function replace<T>(value: T): Replaced<T> {
  return { [REPLACE]: true, value };
}

function isReplaced(value: unknown): value is Replaced<unknown> {
  return typeof value === "object" && value !== null && REPLACE in value;
}

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [K in keyof T]?: DeepPartial<T[K]> | Replaced<T[K]> }
    : T;

/** What a mode folder authors: only the values it changes from the base (GM7, GM8). */
export type ModeOverrides = DeepPartial<ModeTables>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kindOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function mergeInto(base: unknown, override: unknown, path: string): unknown {
  if (isReplaced(override)) return structuredClone(override.value);
  if (kindOf(base) !== kindOf(override)) {
    throw new Error(`mode override at ${path} is ${kindOf(override)}, base is ${kindOf(base)}`);
  }
  if (!isPlainObject(base) || !isPlainObject(override)) return structuredClone(override);
  const out: Record<string, unknown> = structuredClone(base);
  for (const key of Object.keys(override)) {
    const inner = override[key];
    if (inner === undefined) continue;
    const at = path === "" ? key : `${path}.${key}`;
    if (!Object.prototype.hasOwnProperty.call(base, key)) {
      if (isReplaced(inner)) {
        out[key] = structuredClone(inner.value);
        continue;
      }
      throw new Error(`mode override path does not exist in the base: ${at}`);
    }
    out[key] = mergeInto(base[key], inner, at);
  }
  return out;
}

/**
 * Base tables plus one mode's overrides → that mode's tables. Plain objects merge key by key;
 * arrays and primitives replace; `replace(...)` swaps a whole value. Never mutates either input.
 * Throws on a path the base does not have (a typo'd override must not silently do nothing, GM13)
 * or on a type change.
 */
export function mergeTables(base: ModeTables, overrides: ModeOverrides): ModeTables {
  return mergeInto(base, overrides, "") as ModeTables;
}
