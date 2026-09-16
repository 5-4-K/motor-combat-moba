/**
 * The playground's per-CAR tint: a free colour for one car, keyed by its seat id.
 *
 * **Why seat id and not `colorId`.** The obvious cheap version of this feature overrides a
 * `COLOR_TABLE` slot and lets whoever wears it pick the new paint up. That is wrong here, because
 * `isPlaygroundSetup` deliberately allows any of the six seats to sit on the same `colorId` (PG31 —
 * there is a test named for it). Keying on the slot would repaint every seat wearing that colour from
 * one picker, so the key is the thing that is actually unique per car.
 *
 * **Why seat id and not the Colyseus session id it used to be.** A seat outlives a connection, which
 * is what lets a tint survive a page reload at all. Session id was the only other candidate before
 * the six-car widening, and it was wrong for the human specifically: their `client.sessionId` is
 * fresh on every connection, so keying on it discarded their own tint on every reload while the
 * bot's — keyed on the constant `"bot"` — persisted across the same reload. `migrateTintKeys` in
 * `packages/client/src/dev/playground/storage.ts` migrates that one old key (the bot's) that can
 * still be identified; a stored human key cannot be, and is simply left to expire unread.
 *
 * **Why an entry carries `on` rather than being present-or-absent.** The palette dropdown and this
 * picker both want to paint the same car, and exactly one of them can win. Presence alone would make
 * that precedence implicit — the dropdown would silently stop working the moment a colour was
 * picked, which is the failure `env-panel.ts` already names for `floor.*`/`floorArt.*`: a control
 * that quietly does nothing is worse than one that says why. So the developer flips which side is
 * live, and switching the tint OFF keeps the colour rather than discarding it — the whole job here
 * is comparing a candidate against the palette, which means going back and forth without retyping a
 * hex. A remembered-but-off colour is why this persists as `{hex, on}` instead of a bare number.
 *
 * Client-only and never sent anywhere, exactly like the VFX and environment override maps beside it:
 * nothing here crosses the wire, so `PlayerState` keeps its `colorId` and hard invariant 8 is not in
 * play. A shipped arena or a practice room never reads a byte of this, because only the playground
 * overlay ever seeds it — the same rule that keeps a saved tuning session out of a real match (EV34).
 *
 * Deliberately NOT cached behind a version counter the way `env-store.ts` is. That counter exists
 * because `resolveEnvironment` rebuilds a sixty-field object and runs per particle per frame; this
 * resolves with a single property read, so caching it would cost more than it saves.
 */

/** One car's picked colour, and whether it — rather than the car's `colorId` — is painting the car. */
export interface CarTint {
  readonly hex: number;
  readonly on: boolean;
}

/** Seat id -> the picked tint. No entry means this car has never been given one. */
export type CarTintOverrides = Record<string, CarTint>;

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
 * A stored blob, entry by entry, dropping anything that is not a tint.
 *
 * Lenient per entry in the same way `sanitizeStoredEnv` is, and for the same reason: a hand-edited
 * blob or a stale seat id must cost that one car its tint, never the whole tuning session. A
 * fractional or out-of-range hex is DROPPED rather than rounded or clamped — a repair nobody asked
 * for would hide the fact that something wrote a non-colour here.
 *
 * A BARE NUMBER is upgraded rather than dropped, the same additive move `upgradeStoredSetup` makes
 * for a setup saved before a field existed. That was the shape before the on/off toggle, and it
 * meant exactly "a tint that is painting this car" — so `on: true` preserves what the developer
 * saved instead of silently losing a colour they were working on.
 */
export function sanitizeCarTints(value: unknown): CarTintOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: CarTintOverrides = {};
  for (const [sessionId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isHex(raw)) {
      out[sessionId] = { hex: raw, on: true };
      continue;
    }
    if (typeof raw !== "object" || raw === null) continue;
    const rec = raw as Record<string, unknown>;
    if (!isHex(rec.hex) || typeof rec.on !== "boolean") continue;
    out[sessionId] = { hex: rec.hex, on: rec.on };
  }
  return out;
}

/** A real 0xRRGGBB integer. `0x000000` is a colour like any other, so this tests range, not truth. */
function isHex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffff;
}
