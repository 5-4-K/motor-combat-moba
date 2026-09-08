import type { PlaygroundCarSetup, PlaygroundSetup, TuningOverrides } from "@motor-combat-moba/shared";
import { defaultPlaygroundSetup, isPlaygroundSetup, isWeaponId, sanitizeStoredTuning } from "@motor-combat-moba/shared";
import {
  FX_CHANNELS,
  FX_FIELDS,
  FX_PHASES,
  toControl,
  type FxOverrides,
} from "../../fx/tuning.js";
import { ENV_FIELDS, envKey, type EnvOverrides } from "../../fx/env-tuning.js";

/**
 * localStorage persistence for the playground overlay (Task 11, spec PG19/PG20). Pure codec + a thin
 * `Storage` seam so `storage.test.ts` can run under vitest's node environment without a `window`;
 * `overlay.ts` and `PlaygroundScene` are the only production callers, both letting `storage` default
 * to `window.localStorage`.
 */

export const PLAYGROUND_STORAGE_KEY = "motor-combat.playground.v1";

/**
 * Client-only view options the playground remembers. Kept in its own section rather than folded
 * into `setup`, because `setup` goes to the server and these never do — see `config/view-options`.
 */
export interface StoredView {
  showHitbox: boolean;
}

export interface StoredPlayground {
  setup: PlaygroundSetup;
  overrides: TuningOverrides;
  view: StoredView;
  /** The playground's VFX overrides (spec PG54). Client-only, like `view` — never sent anywhere. */
  vfx: FxOverrides;
  /** The playground's environment overrides (EV32). Client-only, like `vfx` — never sent anywhere. */
  env: EnvOverrides;
}

/** Everything off. What a browser with nothing saved, or a saved blob from before this existed, gets. */
export function defaultStoredView(): StoredView {
  return { showHitbox: false };
}

/**
 * Read the view section back, field by field, falling back per field rather than whole.
 *
 * Every blob saved before this section existed lacks it entirely, and there will be more sections
 * later — so a missing or malformed `view` has to cost nothing but its own defaults. It must never
 * be able to invalidate the setup and overrides saved beside it, which is the same rule
 * `decodeStored` already follows between those two.
 */
function decodeView(value: unknown): StoredView {
  const rec = isPlainRecord(value) ? value : {};
  return { showHitbox: rec.showHitbox === true };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Additively fill in the fields Task 1 added — `botDifficulty` on the setup, `colorId` on each car —
 * when a stored `setup` record is missing exactly those, before validating it (PG25).
 *
 * `isPlaygroundSetup` guards both the wire and this codec, and it went strict when `colorId` and
 * `botDifficulty` were added — so without this, every setup saved before that change would fail
 * validation and silently discard a car, a loadout and an arena the developer had chosen.
 *
 * This is deliberately narrow: it adds `botDifficulty` only when the top-level field is absent, and
 * adds a car's `colorId` only when that car record is itself present (a plain object) and lacks one —
 * each from that car's OWN default, so an upgraded blob inherits two DISTINCT colours rather than
 * both cars landing on `me`'s. It never invents a whole missing section (`arenaId`, `botEnabled`,
 * `me`, `opponent`) from the defaults — a blob missing one of those stays invalid and, like before
 * this change, falls back whole. This never loosens the wire: the server still rejects an incomplete
 * payload; only what this browser saved for itself is upgraded.
 */
function upgradeStoredSetup(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const fallback = defaultPlaygroundSetup();
  const upgradeCar = (car: unknown, base: PlaygroundCarSetup): unknown =>
    isPlainRecord(car) && car.colorId === undefined ? { ...car, colorId: base.colorId } : car;
  return {
    ...value,
    ...(value.botDifficulty === undefined ? { botDifficulty: fallback.botDifficulty } : {}),
    ...(value.me !== undefined ? { me: upgradeCar(value.me, fallback.me) } : {}),
    ...(value.opponent !== undefined ? { opponent: upgradeCar(value.opponent, fallback.opponent) } : {}),
  };
}

/**
 * Read the `vfx` section back, entry by entry, dropping anything that no longer makes sense.
 *
 * Lenient in the same way `sanitizeStoredTuning` is, and for the same reason (PG54): a stale key
 * left by a renamed weapon, a retuned range, or a hand-edited blob must cost that one entry, never
 * the whole tuning session. Range is checked in CONTROL units, which is what `FX_FIELDS` bounds
 * are expressed in — a `coneRad` of `TAU` is 360 there, comfortably inside 0-360.
 */
export function sanitizeStoredVfx(value: unknown): FxOverrides {
  if (!isPlainRecord(value)) return {};
  const out: FxOverrides = {};
  for (const [key, raw] of Object.entries(value)) {
    const parts = key.split(".");
    if (parts.length !== 4) continue;
    const [weaponId, phase, channel, fieldName] = parts as [string, string, string, string];
    if (!isWeaponId(weaponId)) continue;
    if (!FX_PHASES.some((p) => p === phase)) continue;
    if (!FX_CHANNELS.some((c) => c === channel)) continue;
    const field = FX_FIELDS.find((f) => f.name === fieldName);
    if (!field) continue;
    if (field.kind === "boolean") {
      if (typeof raw !== "boolean") continue;
      out[key] = raw;
      continue;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const control = toControl(field, raw);
    if (control < field.min || control > field.max) continue;
    out[key] = raw;
  }
  return out;
}

/**
 * Read the `env` section back, entry by entry, dropping anything that no longer makes sense.
 *
 * Lenient in the same way `sanitizeStoredVfx` is, and for the same reason (EV32): a stale key left
 * by a renamed field, a retuned range, or a hand-edited blob must cost that one entry, never the
 * whole tuning session. A fractional value in an `integer` field is dropped rather than rounded — a
 * fractional `floor.grainCells` reopens the tiling seam, so a silent round would be a repair the
 * developer never asked for.
 *
 * Iterates `ENV_FIELDS` rather than the stored object's own keys — the mirror image of
 * `sanitizeStoredVfx`'s loop — which has the useful property that an unknown key cannot survive by
 * construction.
 */
export function sanitizeStoredEnv(value: unknown): EnvOverrides {
  if (!isPlainRecord(value)) return {};
  const out: EnvOverrides = {};
  for (const field of ENV_FIELDS) {
    const key = envKey(field.section, field.name);
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    if (raw < field.min || raw > field.max) continue;
    if (field.kind !== "number" && !Number.isInteger(raw)) continue;
    out[key] = raw;
  }
  return out;
}

/**
 * Never throws. Absent (`null`) or unparseable input, or JSON that parses to something other than a
 * plain object, all fall back to `defaultPlaygroundSetup()` + `{}`. The two halves are validated
 * independently and each falls back on its own: a bad `setup` does not drop a good `overrides` blob
 * and vice versa. `overrides` runs through `sanitizeStoredTuning` (spec PG20), which drops any path
 * that no longer names a tunable field (a retuned range, a retired weapon) rather than failing the
 * whole load.
 */
export function decodeStored(raw: string | null): StoredPlayground {
  let parsed: unknown = null;
  if (raw !== null) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const rec = isPlainRecord(parsed) ? parsed : {};
  return {
    setup: (() => {
      const upgraded = upgradeStoredSetup(rec.setup);
      return isPlaygroundSetup(upgraded) ? upgraded : defaultPlaygroundSetup();
    })(),
    overrides: sanitizeStoredTuning(rec.overrides),
    view: decodeView(rec.view),
    vfx: sanitizeStoredVfx(rec.vfx),
    env: sanitizeStoredEnv(rec.env),
  };
}

export function encodeStored(s: StoredPlayground): string {
  return JSON.stringify(s);
}

/** `window.localStorage` when one exists, `undefined` under vitest's node environment (no `window`
 * global at all) so a caller with no injected storage degenerates to "nothing stored" / "no-op save"
 * instead of throwing on import or on first use. */
function defaultLocalStorage(): Storage | undefined {
  return typeof window !== "undefined" ? window.localStorage : undefined;
}

export function loadStored(storage?: Pick<Storage, "getItem">): StoredPlayground {
  const store = storage ?? defaultLocalStorage();
  return decodeStored(store ? store.getItem(PLAYGROUND_STORAGE_KEY) : null);
}

export function saveStored(s: StoredPlayground, storage?: Pick<Storage, "setItem">): void {
  const store = storage ?? defaultLocalStorage();
  store?.setItem(PLAYGROUND_STORAGE_KEY, encodeStored(s));
}
