import { CAR_TABLE } from "./car-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { IMPULSE_CONFIG } from "./impulse-config.js";
import { RAM_CONFIG } from "./ram-config.js";
import type { TuningOverrides, TuningValue } from "./tuning.js";
import type { CarId } from "./types.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import type { WeaponId } from "./weapon-types.js";

/**
 * Enumerable, validatable tuning surface for a dev playground (spec PG14) — built once from the
 * six source tables `setTuning` (Task 2) already knows how to write. `path` is a `setTuning`-ready
 * dot-path; a UI slaps `min`/`max`/`step`/`options` on it and never has to know a leaf's provenance.
 */
export interface TunableField {
  path: string; // setTuning-compatible: "weapon.predator.damage"
  group: "car" | "drive" | "ram" | "combat" | "impulse" | "weapon";
  ownerId?: string; // carId or weaponId for car/weapon groups
  label: string; // path minus group+owner, e.g. "hitbox.radius"
  kind: "number" | "boolean" | "enum";
  shipped: TuningValue;
  min?: number;
  max?: number;
  step?: number; // numbers only
  options?: readonly string[]; // enums only
}

/**
 * The independent chassis ratings. `CarDef` also carries `id`, `name`, `weapons` and `isActive` —
 * none of those are ratings, so the car group walks this explicit list rather than every own field,
 * unlike drive/ram/combat below. `isActive` in particular must never surface here: it decides which
 * cars real matches offer, not a balance number (spec PG18).
 *
 * Seven since stage 3 of the car-physics rework, not the six T7 named: the single `mass` rating that
 * used to sit at the end became `ramAttack` and `ramDefence`, which is a rating MORE, not a rename.
 * Both belong here — they are per-car balance numbers a playground tester needs to reach, and they
 * are the two knobs the ram contest is most sensitive to. `CarDef.brakeDecel` is still deliberately
 * absent: it is a direct value in u/s², not a 0-100 rating, and the walker's number bounds assume a
 * rating. (`coastHalfLifeSeconds` was absent for the same reason until the 2026-09-18 Unity
 * drive-model port deleted the field outright; coasting is `accel`'s `dragRate` now, and `accel` IS
 * on this list.)
 */
const CAR_RATINGS = ["speed", "accel", "handling", "attack", "hp", "ramAttack", "ramDefence"] as const;

/**
 * Skipped at ANY depth while walking a weapon row — render/render-adjacent or purely nominal, never
 * balance. `kind` also gates which weapons compare against which for enum options (see below), so
 * emitting it as a tunable field would let a playground blob silently reclassify a weapon.
 *
 * `shape` and `type` are discriminated-union TAGS, not identity strings, but they belong here for
 * the same reason: each one gates which sibling keys the object is allowed to have (`ProjectileHitbox`'s
 * `shape` decides whether `radius` or `radiusAlong`/`radiusAcross` exist; `ManeuverSpec`'s `type`
 * decides whether `durationMs`/`slamsStunned` exist). Flipping only the tag through a validated
 * `setTuning` write leaves those siblings as whatever the ORIGINAL variant authored — a `capsule`'s
 * `radiusAlong`/`radiusAcross` surviving under a `circle` tag that wants `radius` — and
 * `capsuleShapeAt`/`circleShapeAt` (`sim/weapons/shapes.ts`) then read a field the new variant never
 * defined, computing `undefined - undefined` and NaN-poisoning every hit-test vertex downstream. A
 * leaf write can never update siblings, so a union tag can never be safe as a leaf; unlike `id`/
 * `name`/`kind`/`color` this is a general rule about tags, not a name-by-name exclusion list, but
 * every shipped tag key happens to be named `shape` or `type` today.
 */
const SKIP_KEYS = new Set(["id", "name", "kind", "color", "shape", "type"]);

/**
 * `drive.carWidth`/`drive.carHeight` are the OBB hitbox model — out of tuning scope by spec. That is
 * the whole reason now.
 *
 * It used to carry a second reason too: `RAM_CONFIG.inertiaCoefficient` was a `RAM_CONFIG` field
 * derived from these once at module load, and `ram.inertiaCoefficient` stayed tunable below as the
 * live-reading escape hatch (overriding it directly worked; overriding the hull dimensions instead
 * would not move a value already frozen at load, so the two would silently disagree). The Unity
 * ram-model port deleted `inertiaCoefficient` outright — the hull-derived inertia term is now
 * `inertiaRadiusSquared()` (`ram-config.ts`), a plain function with no `RAM_CONFIG` leaf of its own
 * for this walker to expose, so there is no `ram.*` path left to disagree with either.
 */
const DRIVE_SKIP_KEYS = new Set(["carWidth", "carHeight"]);

/**
 * Range for a plain (non-car-rating) number, straight from the brief: 0 as the floor always: triple
 * the shipped value above zero, and a generous but bounded ceiling for a zeroed field — 2000 for a
 * millisecond knob (a zeroed `startUpMs`/`recoveryMs`/`damageFrequencyMs` should still be raisable
 * to something a player would notice), 10 for anything else. `step` is always a hundredth of the
 * range, so a slider reads the same resolution whatever the field.
 */
function numberRange(shipped: number, path: string): { min: number; max: number; step: number } {
  const max = shipped > 0 ? shipped * 3 : path.endsWith("Ms") ? 2000 : 10;
  return { min: 0, max, step: max / 100 };
}

function pushSimpleField(
  fields: TunableField[],
  group: "drive" | "ram" | "combat" | "impulse",
  key: string,
  value: unknown,
): void {
  const path = `${group}.${key}`;
  if (typeof value === "number") {
    const { min, max, step } = numberRange(value, path);
    fields.push({ path, group, label: key, kind: "number", shipped: value, min, max, step });
    return;
  }
  if (typeof value === "boolean") {
    fields.push({ path, group, label: key, kind: "boolean", shipped: value });
  }
  // A string leaf here would need a peer table to build an enum from (see the weapon walk below) —
  // drive/ram/combat are each a single object, not a roster, so there is nothing to compare against.
  // None of the three tables authors a string field today; this is future-proofing, not dead code.
}

/**
 * Flattens one weapon row into `relativePath -> leaf value`, recursing into nested objects
 * (`hitbox`, `volley`, `maneuver`, ...) and arrays (`applies`, `muzzles`) alike, numeric array
 * indices becoming path segments the same way `setTuning`'s `leafOf` already accepts them
 * (`"weapon.predator.applies.0.durationMs"`). `SKIP_KEYS` is checked at every level, not just the
 * top, so `applies.0.statusId`'s sibling `applies` items never smuggle an `id`/`name`/`kind`/`color`
 * key back in from some future nested shape.
 */
function collectLeaves(value: unknown, prefix: string, into: Map<string, TuningValue>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLeaves(item, prefix ? `${prefix}.${index}` : String(index), into));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (SKIP_KEYS.has(key)) continue;
      collectLeaves(inner, prefix ? `${prefix}.${key}` : key, into);
    }
    return;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    into.set(prefix, value);
  }
  // undefined (every optional WeaponDef field absent on a given row) leaves no trace, which is
  // exactly right: a field a row doesn't author is not a field that row can tune.
}

function buildWeaponFields(fields: TunableField[]): void {
  const weaponIds = Object.keys(WEAPON_TABLE) as WeaponId[];
  const leavesByWeapon = new Map<WeaponId, Map<string, TuningValue>>();
  for (const weaponId of weaponIds) {
    const leaves = new Map<string, TuningValue>();
    collectLeaves(WEAPON_TABLE[weaponId], "", leaves);
    leavesByWeapon.set(weaponId, leaves);
  }

  /**
   * A string leaf becomes an enum only when at least two DIFFERENT values are actually observed at
   * its exact relative path among rows sharing this row's `kind` (projectile/beam/maneuver) — never
   * across kinds, since a `maneuver` row and a `projectile` row agreeing on a string by coincidence
   * says nothing about what's safe to swap. Below that threshold (including "this path exists on
   * only one row of this kind") the field is dropped rather than emitted as a single-option enum:
   * per the task brief, this is what keeps an identity-shaped string (a one-off id, a name nobody
   * else in the kind shares) from becoming a writable, "validated" field just because it happens not
   * to be literally named `id`/`name`/`kind`/`color`.
   */
  const optionsByKindPath = new Map<string, Set<string>>();
  for (const weaponId of weaponIds) {
    const kind = WEAPON_TABLE[weaponId].kind;
    for (const [path, value] of leavesByWeapon.get(weaponId)!) {
      if (typeof value !== "string") continue;
      const key = `${kind}::${path}`;
      const set = optionsByKindPath.get(key) ?? new Set<string>();
      set.add(value);
      optionsByKindPath.set(key, set);
    }
  }

  for (const weaponId of weaponIds) {
    const kind = WEAPON_TABLE[weaponId].kind;
    for (const [label, value] of leavesByWeapon.get(weaponId)!) {
      const path = `weapon.${weaponId}.${label}`;
      if (typeof value === "number") {
        const { min, max, step } = numberRange(value, path);
        fields.push({ path, group: "weapon", ownerId: weaponId, label, kind: "number", shipped: value, min, max, step });
        continue;
      }
      if (typeof value === "boolean") {
        fields.push({ path, group: "weapon", ownerId: weaponId, label, kind: "boolean", shipped: value });
        continue;
      }
      const options = optionsByKindPath.get(`${kind}::${label}`);
      if (!options || options.size < 2) continue; // no real choice observed -> not tunable
      fields.push({
        path,
        group: "weapon",
        ownerId: weaponId,
        label,
        kind: "enum",
        shipped: value,
        options: [...options].sort(),
      });
    }
  }
}

function buildFields(): TunableField[] {
  const fields: TunableField[] = [];

  for (const carId of Object.keys(CAR_TABLE) as CarId[]) {
    const car = CAR_TABLE[carId];
    for (const rating of CAR_RATINGS) {
      fields.push({
        path: `car.${carId}.${rating}`,
        group: "car",
        ownerId: carId,
        label: rating,
        kind: "number",
        shipped: car[rating],
        min: 0,
        max: 100,
        step: 1,
      });
    }
  }

  for (const [key, value] of Object.entries(DRIVE_CONFIG)) {
    if (DRIVE_SKIP_KEYS.has(key)) continue;
    pushSimpleField(fields, "drive", key, value);
  }

  for (const [key, value] of Object.entries(RAM_CONFIG)) {
    pushSimpleField(fields, "ram", key, value);
  }

  for (const [key, value] of Object.entries(COMBAT_CONFIG)) {
    pushSimpleField(fields, "combat", key, value);
  }

  // `IMPULSE_CONFIG` joined the tunable roots on 2026-09-19, once the Unity port made both members
  // matter: `spinScale` was inert until stage 4 gave an authored push a real lever arm, and
  // `wallContactPad` is what every `ImpulseDef.onWallImpact` sweep measures against. Neither is a
  // derived artifact — `contact.ts` and `ram-bridge.ts` read `wallContactPad` at call time and
  // `impulse.ts` reads `spinScale` at call time — so neither owes `tuning.ts`'s rebuild list an entry.
  for (const [key, value] of Object.entries(IMPULSE_CONFIG)) {
    pushSimpleField(fields, "impulse", key, value);
  }

  buildWeaponFields(fields);

  return fields;
}

/**
 * Computed once, at module load — before any playground call to `setTuning` can run, so `shipped`
 * always reflects the true built-in defaults rather than whatever override happened to be active the
 * first time a caller asked. `setTuning` mutates the five source tables IN PLACE (that is its whole
 * trick — see `tuning.ts`), so reading them lazily on first use would risk caching a tuned value as
 * "shipped" if some earlier code path had already called `setTuning`. Frozen so nothing downstream
 * can mutate the shared field objects; `tunableFields()` still hands out a fresh array each call so a
 * caller sorting or filtering its result can't corrupt the cache.
 */
const FIELDS: readonly TunableField[] = Object.freeze(buildFields().map((field) => Object.freeze(field)));
const FIELD_MAP: ReadonlyMap<string, TunableField> = new Map(FIELDS.map((field) => [field.path, field]));

export function tunableFields(): TunableField[] {
  return FIELDS.slice();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `null` when `value` is a legal assignment for `field`; otherwise a short, human-readable reason —
 * shared by `validateTuning` (which reports the first offender) and `sanitizeStoredTuning` (which
 * only needs the yes/no).
 */
function invalidReason(field: TunableField, value: unknown): string | null {
  if (field.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "must be a finite number";
    if (value < (field.min as number) || value > (field.max as number)) return "out of range";
    return null;
  }
  if (field.kind === "boolean") {
    return typeof value === "boolean" ? null : "must be a boolean";
  }
  // enum
  return typeof value === "string" && (field.options as readonly string[]).includes(value)
    ? null
    : "not a valid option";
}

/**
 * Reject-whole (spec PG13): a blob with one bad entry is entirely rejected rather than partially
 * applied, naming the first offending path so the playground UI can point at it.
 */
export function validateTuning(raw: unknown): { ok: true; overrides: TuningOverrides } | { ok: false; error: string } {
  if (!isPlainRecord(raw)) return { ok: false, error: "tuning overrides must be a plain object" };
  for (const [path, value] of Object.entries(raw)) {
    const field = FIELD_MAP.get(path);
    if (!field) return { ok: false, error: `${path}: unknown tuning path` };
    const reason = invalidReason(field, value);
    if (reason) return { ok: false, error: `${path}: ${reason}` };
  }
  return { ok: true, overrides: Object.freeze({ ...(raw as Record<string, TuningValue>) }) };
}

/**
 * Lenient counterpart for loading a previously-saved blob (spec PG20): a stale path — a retuned
 * range, a retired weapon, a config field that no longer exists — is dropped silently instead of
 * failing the whole load. Runs the same per-entry check as `validateTuning`, filtering rather than
 * rejecting.
 */
export function sanitizeStoredTuning(raw: unknown): TuningOverrides {
  if (!isPlainRecord(raw)) return Object.freeze({});
  const clean: Record<string, TuningValue> = {};
  for (const [path, value] of Object.entries(raw)) {
    const field = FIELD_MAP.get(path);
    if (!field) continue;
    if (invalidReason(field, value)) continue;
    clean[path] = value as TuningValue;
  }
  return Object.freeze(clean);
}
