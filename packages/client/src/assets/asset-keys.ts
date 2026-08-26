import { ARENA_ART_COMMON, arenaIdFromArtKey, DEFAULT_CAR_ID, isCarId } from "@motor-combat-moba/shared";

/** The manifest namespace car sprites live under. Exported so nothing has to spell `"car."` twice. */
export const CAR_KEY_PREFIX = "car.";

/**
 * The manifest key for a wire `carId`. Namespaced so that powers, projectiles, and effects can land
 * as new rows in the same flat map rather than as a new section of the schema.
 *
 * Unrecognised ids resolve to `DEFAULT_CAR_ID` — the same fallback `carShapeOf` and the sim take —
 * so a stale or hostile id draws the default chassis instead of silently drawing nothing.
 */
export function carSpriteKey(carId: string): string {
  return `${CAR_KEY_PREFIX}${isCarId(carId) ? carId : DEFAULT_CAR_ID}`;
}

/**
 * Whether boot should load a manifest entry at all.
 *
 * The runtime half of "only the selected arena ships": another arena's art is skipped even if a
 * manifest row names it, which keeps a dev build from spending load time on arenas it will not draw
 * and keeps behaviour identical to the pruned release. `scripts/build-release.mjs` applies the same
 * rule to the files themselves.
 */
export function shouldLoadAssetKey(key: string, activeArenaId: string): boolean {
  const arenaId = arenaIdFromArtKey(key);
  if (arenaId === undefined) return true;
  return arenaId === ARENA_ART_COMMON || arenaId === activeArenaId;
}
