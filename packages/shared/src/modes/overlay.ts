import { isStatusId } from "../config/status-config.js";
import type { TuningOverrides, TuningValue } from "../config/tuning.js";
import { assembleModeConfig } from "./build.js";
import type { ModeConfig, ModeTables } from "./types.js";

/**
 * Builds a NEW `ModeConfig` from `base` plus `overrides`, without ever installing it. This is the
 * per-bundle replacement for `config/tuning.ts`'s `setTuning`: that function assembles a bundle from
 * `BRAWL_TABLES` alone and `installMode`s it process-wide, so it can only ever tune the default mode
 * for the whole server. `applyOverrides` takes whichever bundle the caller already has — Brawl's,
 * Deathmatch's, a future mode's — and returns a tuned sibling of it; what the caller does with the
 * result (install it, hold it as a room's own `this.modeConfig`, discard it) is entirely up to them.
 *
 * The path-walking machinery below (`leafOf`, `assertAssignable`) is a deliberate copy of
 * `tuning.ts`'s own, not an import of it: `leafOf` there is private, and a later task guts
 * `tuning.ts` down to calling this function — importing its internals would just have to be undone.
 * The doc comments on both are carried across unchanged, because the reasoning is unchanged: it is
 * still an own-property walk (never `in`, which would let `"car.mirage.toString"` resolve to a
 * function off the prototype chain), and `statusId` is still the one leaf validated by VALUE rather
 * than by shape.
 */
type Container = Record<string, unknown>;

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
 * Validated against `roots` — built from the BASE bundle the caller passed, never the raw `config/`
 * globals — and before anything is written: a rejected `applyOverrides` must leave the caller's base
 * bundle exactly as it found it, and every path in the batch is checked before the first leaf of the
 * clone is touched.
 *
 * A tuning path is valid for the MODE being tuned, not for whatever the shipped globals hold — and
 * this repo is deliberately moving off the raw globals, so validating against them would be a new
 * dependency on tables the game no longer reads.
 */
function assertAssignable(roots: Readonly<Record<string, unknown>>, path: string, value: TuningValue): void {
  const { container, key } = leafOf(roots, path);
  const shipped = container[key];
  if (typeof shipped !== typeof value) {
    throw new Error(`tuning path ${path} is ${typeof shipped}, not ${typeof value}`);
  }
  // The one VALUE check in an otherwise shape-only validator, and it earns its exception: a
  // `statusId` leaf is the only string in these tables that is looked up in another table rather
  // than read as data. `applyStatus` takes an unknown id straight to `statusDefOf(...)!.onApply` and
  // throws a bare TypeError mid-tick, killing the room — so an unknown id has to be refused HERE,
  // before the clone is written, which is also what keeps `applyOverrides`'s all-or-nothing promise.
  // Every such leaf is reachable: `weapon.<id>.applies.N.statusId`, `...explosion.applies.N.statusId`
  // and `...impulse.applies.N.statusId` / `...impulse.onWallImpact.applies.N.statusId`.
  if (key === "statusId" && !isStatusId(value)) {
    throw new Error(`tuning path ${path} is not a status id: ${String(value)}`);
  }
}

function rootsOf(tables: ModeTables): Readonly<Record<string, unknown>> {
  return {
    car: tables.cars,
    weapon: tables.weapons,
    drive: tables.drive,
    ram: tables.ram,
    impulse: tables.impulse,
    combat: tables.combat,
    turret: tables.turret,
  };
}

/**
 * Builds a tuned sibling of `base`: same `GameMode` id, same everything `overrides` does not touch,
 * with every dot-path in `overrides` written and every derived artifact re-resolved. Never installs
 * anything and never mutates `base` — `base` stays live and untouched for as long as the caller keeps
 * it, and each call's overrides REPLACE rather than accumulate, since every call starts fresh from
 * `base` rather than from a bundle a previous call produced.
 *
 * All-or-nothing: every path in `overrides` is validated against `base`'s own tables before a single
 * leaf of the clone is written, so a rejected call throws before `structuredClone` even runs.
 *
 * `base` is a `ModeConfig`, which structurally satisfies `ModeTables` (it extends it), so it can be
 * cloned and handed to `assembleModeConfig` directly — the extra `id`/`derived` fields the clone also
 * carries are overwritten by `assembleModeConfig`'s own `{ ...cloned, drive, id, derived }` spread,
 * and `base.drive` already carries the global OBB hull `assembleModeConfig` would otherwise
 * re-attach, so nothing stale survives into the returned bundle.
 */
export function applyOverrides(base: ModeConfig, overrides: TuningOverrides): ModeConfig {
  const validationRoots = rootsOf(base);
  for (const [path, value] of Object.entries(overrides)) {
    assertAssignable(validationRoots, path, value);
  }

  const tables = structuredClone(base) as ModeTables;
  const writeRoots = rootsOf(tables);
  for (const [path, value] of Object.entries(overrides)) {
    const { container, key } = leafOf(writeRoots, path);
    container[key] = value;
  }

  return assembleModeConfig(base.id, tables);
}
