import type { DriveConfig } from "../config/drive-config.js";
import type { StatusDef, StatusId } from "../config/status-types.js";
import type { TuningOverrides, TuningValue } from "../config/tuning.js";
import { assembleModeConfig } from "./build.js";
import type { ModeConfig, ModeTables } from "./types.js";

/**
 * Builds a NEW `ModeConfig` from `base` plus `overrides`, without ever installing it. It replaced
 * `config/tuning.ts`'s `setTuning`, now deleted: that function assembled a bundle from
 * `BRAWL_TABLES` alone and `installMode`d it process-wide, so it could only ever tune the default
 * mode, and it tuned it for every room in the server at once. `applyOverrides` takes whichever
 * bundle the caller already has — Brawl's, Deathmatch's, a future mode's — and returns a tuned
 * sibling of it; what the caller does with the result (install it, hold it as a room's own
 * `this.modeConfig`, discard it) is entirely up to them.
 *
 * The path-walking machinery below (`leafOf`, `assertAssignable`) began as a deliberate copy of
 * `tuning.ts`'s own, and is now the only copy: `setTuning` is gone and `tuning.ts` is types only.
 * The reasoning is unchanged from that original: it is still an own-property walk (never `in`,
 * which would let `"car.mirage.toString"` resolve to a function off the prototype chain), and
 * `statusId` is still the one leaf validated by VALUE rather than by shape.
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
function assertAssignable(
  roots: Readonly<Record<string, unknown>>,
  statuses: Readonly<Record<StatusId, StatusDef>>,
  path: string,
  value: TuningValue,
): void {
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
  //
  // Checked against `statuses` — the BASE BUNDLE's own status table — rather than through
  // `isStatusId`, which reads whichever bundle the process last installed and throws outright when
  // none is (2026-09-23). Two reasons, and the first is the same one the rest of this validator
  // already follows: a status id is valid for the MODE being tuned. The second is that
  // `applyOverrides` is pure and installs nothing, so requiring an ambient mode scope just to
  // validate would make it the one impure-by-precondition step in the overlay — and until this
  // changed, the check silently never ran: outside a scope it threw the scope error instead, which
  // reads as a rejection to a caller and to a test expecting a throw.
  if (key === "statusId" && !(typeof value === "string" && hasOwn(statuses, value))) {
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
 * MC35: the OBB hull (`carWidth`/`carHeight`) is GLOBAL — one hull for every mode — and
 * `ModeTables.drive`'s TYPE omits both fields so a mode folder cannot author one. That is a
 * static-only guarantee: the `tables` this function receives is almost always a `ModeConfig`
 * (structurally a `ModeTables`), whose `drive` is the FULL `DriveConfig` at runtime, hull included,
 * re-attached by `assembleModeConfig`. Reading `tables.drive` straight through, as `rootsOf` does,
 * would silently reintroduce both fields as valid tuning paths: `applyOverrides` would validate the
 * override, write it into the clone, and `assembleModeConfig` would then re-attach the shipped
 * global hull straight over that write — no error, no effect, the caller none the wiser.
 *
 * VALIDATION-ONLY roots, built as a plain destructured copy that drops the two hull keys: nothing
 * ever writes through `assertAssignable`'s roots (it only reads, to check a path exists and a
 * value's type-matches), so a copy disconnected from the real object is safe here — and it is what
 * makes `drive.carWidth`/`drive.carHeight` read as `unknown tuning path` again, the same as before
 * `ModeTables.drive`'s hull omission became runtime-invisible-but-type-only. This copy must NEVER be
 * reused for the WRITE roots (`rootsOf` above, unchanged): a copy's primitive fields are disconnected
 * from the real `tables.drive` object `assembleModeConfig` re-reads afterwards, so writing into the
 * copy would silently do nothing for every OTHER drive override too, not merely the two hull ones —
 * tried, and it broke `drive.baseTurnRate` the same way.
 */
function validationRootsOf(tables: ModeTables): Readonly<Record<string, unknown>> {
  const { carWidth: _carWidth, carHeight: _carHeight, ...drive } = tables.drive as DriveConfig;
  return { ...rootsOf(tables), drive };
}

/** MC35: `drive.carWidth`/`drive.carHeight` alone — the two hull fields `validationRootsOf` hides. */
const HULL_PATHS = new Set(["drive.carWidth", "drive.carHeight"]);

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
  const validationRoots = validationRootsOf(base);
  for (const [path, value] of Object.entries(overrides)) {
    assertAssignable(validationRoots, base.statusTable, path, value);
  }

  // Two clones happen per call — this one, and `assembleModeConfig`'s own — and the pair is not
  // redundant (checked 2026-09-23). `base` is deep-frozen, and the write loop below has to mutate
  // something, so the overrides need a clone BEFORE they are written; `assembleModeConfig` clones
  // AFTER, which is what guarantees the bundle it returns shares no sub-object with whatever tables
  // it was handed. Dropping either one means either writing into the caller's frozen base or handing
  // back a bundle wired to this function's scratch object.
  const tables = structuredClone(base) as ModeTables;
  const writeRoots = rootsOf(tables);
  for (const [path, value] of Object.entries(overrides)) {
    // MC35, defense in depth: every path here already passed `validationRootsOf` above, which
    // cannot resolve a hull path at all — so this can only ever fire if a future edit reorders
    // validation and writing to interleave per-path instead of validating the whole batch first.
    // Checked here, locally, rather than trusted to that ordering: a guard that only holds because
    // of an invariant one function away is exactly the shape of guard that silently stopped
    // guarding once already on this branch (F2).
    if (HULL_PATHS.has(path)) throw new Error(`unknown tuning path: ${path}`);
    const { container, key } = leafOf(writeRoots, path);
    container[key] = value;
  }

  return assembleModeConfig(base.id, tables);
}
