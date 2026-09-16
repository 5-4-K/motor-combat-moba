/**
 * The playground's per-CAR tint overrides: a free colour for one car, keyed by its session id.
 *
 * **Why session id and not `colorId`.** The obvious cheap version of this feature overrides a
 * `COLOR_TABLE` slot and lets whoever wears it pick the new paint up. That is wrong here, because
 * `isPlaygroundSetup` deliberately allows BOTH cars to sit on the same `colorId` (PG31 — there is a
 * test named for it). Keying on the slot would repaint both cars from one picker, so the key is the
 * thing that is actually unique per car.
 *
 * Client-only and never sent anywhere, exactly like the VFX and environment override maps beside it:
 * nothing here crosses the wire, so `PlayerState` keeps its `colorId` and hard invariant 8 is not in
 * play. A shipped arena or a practice room never reads a byte of this, because only `PlaygroundScene`
 * ever calls `setCarTintOverrides` — the same rule that keeps a saved tuning session out of a real
 * match (EV34).
 *
 * Deliberately NOT cached behind a version counter the way `env-store.ts` is. That counter exists
 * because `resolveEnvironment` rebuilds a sixty-field object and runs per particle per frame; this
 * resolves with a single property read, so caching it would cost more than it saves.
 */

/** Session id -> 0xRRGGBB. Absent means "this car wears its `colorId`'s shipped colour". */
export type CarTintOverrides = Record<string, number>;

let current: CarTintOverrides = {};

/**
 * The live map. Returned by reference rather than copied, because the settings panel mutates it in
 * place — the same contract the physics, VFX and environment maps have with their own panels.
 */
export function carTintOverrides(): CarTintOverrides {
  return current;
}

/** Replace the map. `null` clears it — what `PlaygroundScene.onShutdown` calls. */
export function setCarTintOverrides(next: CarTintOverrides | null): void {
  current = next ?? {};
}

/**
 * A stored blob, entry by entry, dropping anything that is not a colour.
 *
 * Lenient per entry in the same way `sanitizeStoredEnv` is, and for the same reason: a hand-edited
 * blob or a stale session id must cost that one car its override, never the whole tuning session.
 * A fractional or out-of-range value is DROPPED rather than rounded or clamped — a repair nobody
 * asked for would hide the fact that something wrote a non-colour here.
 */
export function sanitizeCarTints(value: unknown): CarTintOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: CarTintOverrides = {};
  for (const [sessionId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isCarTint(raw)) out[sessionId] = raw;
  }
  return out;
}

/** A real 0xRRGGBB integer. `0x000000` is a colour like any other, so this tests range, not truth. */
export function isCarTint(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffff;
}
