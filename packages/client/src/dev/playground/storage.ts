import type { PlaygroundCarSetup, PlaygroundSetup, TuningOverrides } from "@motor-combat-moba/shared";
import { defaultPlaygroundSetup, isPlaygroundSetup, sanitizeStoredTuning } from "@motor-combat-moba/shared";

/**
 * localStorage persistence for the playground overlay (Task 11, spec PG19/PG20). Pure codec + a thin
 * `Storage` seam so `storage.test.ts` can run under vitest's node environment without a `window`;
 * `overlay.ts` and `PlaygroundScene` are the only production callers, both letting `storage` default
 * to `window.localStorage`.
 */

export const PLAYGROUND_STORAGE_KEY = "motor-combat.playground.v1";

export interface StoredPlayground {
  setup: PlaygroundSetup;
  overrides: TuningOverrides;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge a stored `setup` record over `defaultPlaygroundSetup()` before validating it (PG25).
 *
 * `isPlaygroundSetup` guards both the wire and this codec, and it went strict when `colorId` and
 * `botDifficulty` were added — so without this, every setup saved before that change would fail
 * validation and silently discard a car, a loadout and an arena the developer had chosen. The merge
 * is deliberately shallow-per-side: the two car records are merged over their OWN defaults, so an
 * upgraded blob inherits two DISTINCT colours rather than both cars landing on `me`'s.
 *
 * This never loosens the wire. The server still rejects an incomplete payload; only what this
 * browser saved for itself is upgraded, and a blob still invalid after the merge falls back whole.
 */
function upgradeStoredSetup(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const fallback = defaultPlaygroundSetup();
  const mergeCar = (car: unknown, base: PlaygroundCarSetup): unknown =>
    isPlainRecord(car) ? { ...base, ...car } : base;
  return {
    ...fallback,
    ...value,
    me: mergeCar(value.me, fallback.me),
    opponent: mergeCar(value.opponent, fallback.opponent),
  };
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
