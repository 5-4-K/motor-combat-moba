import type { PlaygroundSetup, TuningOverrides } from "@motor-combat-moba/shared";
import {
  BOT_SESSION_ID,
  PLAYGROUND_SEAT_IDS,
  defaultPlaygroundSetup,
  isPlaygroundSetup,
  sanitizeStoredTuning,
} from "@motor-combat-moba/shared";
import {
  FX_CHANNELS,
  FX_FIELDS,
  isFxSubjectId,
  phasesForSubject,
  toControl,
  type FxOverrides,
} from "../../fx/tuning.js";
import { ENV_FIELDS, envKey, isAcceptableEnvValue, type EnvOverrides } from "../../fx/env-tuning.js";
import { sanitizeCarTints, type CarTintOverrides } from "../../fx/car-tint.js";

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
  /**
   * A free tint per CAR, keyed by session id. Client-only like `vfx` and `env`, and keyed by session
   * rather than by `colorId` because both cars are allowed to wear the same colour (PG31) — see
   * `fx/car-tint.ts` for why that rules the cheaper keying out.
   */
  carTint: CarTintOverrides;
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
 * Additively fill in what a stored `setup` record is missing, before validating it (PG25/PG85).
 *
 * Two generations of blob pass through here. The older one lacks `botDifficulty` and a per-car
 * `colorId`; the 2026-09-16 one lacks the whole seat model, carrying `me` and `opponent` where six
 * `cars` and a `drivenSeat` now live. `isPlaygroundSetup` guards both the wire and this codec and
 * went strict for each of those, so without this every blob saved before the change would fail
 * validation and silently discard a car, a loadout and an arena the developer had chosen.
 *
 * Deliberately narrow, in the style the `colorId` upgrade already set: each piece is added only when
 * it is absent, and a whole missing SECTION is never invented. A blob without `arenaId`, without
 * `botEnabled`, or without both car records stays invalid and falls back whole, exactly as before.
 * This never loosens the wire — the server still rejects an incomplete payload; only what this
 * browser saved for itself is upgraded.
 */
function upgradeStoredSetup(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const fallback = defaultPlaygroundSetup();
  const withDifficulty =
    value.botDifficulty === undefined ? { ...value, botDifficulty: fallback.botDifficulty } : value;
  // Already a seat blob: nothing to do. Checked by presence rather than by shape, so a malformed
  // `cars` is handed to the validator to reject rather than being silently replaced.
  if (withDifficulty.cars !== undefined) return withDifficulty;

  const { me, opponent, ...rest } = withDifficulty as Record<string, unknown>;
  if (me === undefined || opponent === undefined) return withDifficulty;

  /** One legacy car record onto its seat: its own fields, plus whatever that seat's default
   * supplies for a field it never had (`colorId` on the oldest blobs, `enabled` on all of them). */
  const seatFrom = (car: unknown, seat: number, enabled: boolean): unknown => {
    const base = fallback.cars[seat]!;
    if (!isPlainRecord(car)) return { ...base, enabled };
    return {
      ...car,
      ...(car.colorId === undefined ? { colorId: base.colorId } : {}),
      enabled,
    };
  };

  return {
    ...rest,
    cars: fallback.cars.map((base, seat) =>
      seat === 0 ? seatFrom(me, 0, true) : seat === 1 ? seatFrom(opponent, 1, true) : { ...base, enabled: false },
    ),
    drivenSeat: 0,
  };
}

/**
 * Re-key the playground's stored car tints onto seat ids (PG86).
 *
 * Exactly one old key can be identified: the bot's, which was the constant `BOT_SESSION_ID` and is
 * seat 1 under the upgrade above. The human's own key was a per-connection Colyseus session id,
 * which cannot be mapped to anything — it is left where it is and simply never resolves, which
 * `sanitizeCarTints` already tolerates (a stale key costs that one car its tint, never the blob).
 *
 * That loss is not a regression. Under the old keying the human's tint was ALREADY discarded on
 * every reload, because the key was new on every connection; seat ids are the change that stops
 * that happening again.
 *
 * A tint already saved against seat 1 WINS over the legacy one. Saving under a seat id can only
 * have happened after this change, so it is the newer intent.
 */
function migrateTintKeys(tints: CarTintOverrides): CarTintOverrides {
  const legacy = tints[BOT_SESSION_ID];
  if (legacy === undefined) return tints;
  const seat1 = PLAYGROUND_SEAT_IDS[1]!;
  const rest: CarTintOverrides = {};
  for (const [key, tint] of Object.entries(tints)) {
    if (key !== BOT_SESSION_ID) rest[key] = tint;
  }
  return seat1 in rest ? rest : { ...rest, [seat1]: legacy };
}

/**
 * Read the `vfx` section back, entry by entry, dropping anything that no longer makes sense.
 *
 * Lenient in the same way `sanitizeStoredTuning` is, and for the same reason (PG54): a stale key
 * left by a renamed weapon, a retuned range, or a hand-edited blob must cost that one entry, never
 * the whole tuning session. Range is checked in CONTROL units, which is what `FX_FIELDS` bounds
 * are expressed in — a `coneRad` of `TAU` is 360 there, comfortably inside 0-360.
 *
 * `isFxSubjectId` widens the gate to the two car events alongside every weapon (EV21), and the
 * `phasesForSubject` check drops a `muzzle` key saved against a car event — that subject has only
 * `impact`, so a stale `carDeath.muzzle.*` key would otherwise survive and resolve into a phase the
 * row does not have.
 */
export function sanitizeStoredVfx(value: unknown): FxOverrides {
  if (!isPlainRecord(value)) return {};
  const out: FxOverrides = {};
  for (const [key, raw] of Object.entries(value)) {
    const parts = key.split(".");
    if (parts.length !== 4) continue;
    const [weaponId, phase, channel, fieldName] = parts as [string, string, string, string];
    if (!isFxSubjectId(weaponId)) continue;
    if (!phasesForSubject(weaponId).some((p) => p === phase)) continue;
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
 * developer never asked for. The finite/range/integer check itself is `isAcceptableEnvValue`,
 * shared with `env-tuning.ts`'s own `resolveEnvironment`/`envTableSource` so the two cannot drift.
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
    if (!isAcceptableEnvValue(field, raw)) continue;
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
    carTint: migrateTintKeys(sanitizeCarTints(rec.carTint)),
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
