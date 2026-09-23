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

/** The manifest namespace weapon icons live under. */
export const WEAPON_ICON_KEY_PREFIX = "weapon-icon.";

/**
 * Manifest key for a weapon's HUD icon. Namespaced like `car.<id>`, with its own defaults: no
 * fallback id, because a slot with no manifest icon is not an error — the HUD keeps drawing its
 * procedural glyph for it. Compare `carSpriteKey`, which falls back to `DEFAULT_CAR_ID` because a
 * car must always draw *something*.
 */
export function weaponIconKey(weaponId: string): string {
  return `${WEAPON_ICON_KEY_PREFIX}${weaponId}`;
}

/**
 * Whether boot should load a manifest entry at all.
 *
 * The runtime half of "the arena UNION ships": an arena outside every active mode's arena set is
 * skipped even if a manifest row names it, which keeps a dev build from spending load time on
 * arenas no active mode can select and keeps behaviour identical to the pruned release.
 * `scripts/build-release.mjs` applies the same rule to the files themselves.
 *
 * `everyArena` lifts the arena filter entirely, for a boot that can switch arenas without reloading
 * (see `loadsEveryArena`). Without it, an arena this page did not boot with art for draws the
 * procedural asphalt fallback, since its floor texture was never asked for.
 */
export function shouldLoadAssetKey(
  key: string,
  arenaIds: readonly string[],
  everyArena = false,
): boolean {
  const arenaId = arenaIdFromArtKey(key);
  if (arenaId === undefined || everyArena) return true;
  return arenaId === ARENA_ART_COMMON || arenaIds.includes(arenaId);
}

/**
 * Whether a boot under this `?dev=` tool should load every arena's art rather than only the active
 * modes' union. True for the playground alone: its settings panel changes `state.arenaId`
 * mid-session, and can point at an arena no active mode carries at all — broader than the union.
 * Art is loaded once at boot (`assetsReady`), so an arena skipped here can never draw its floor in
 * that tab. Dev-only by construction — `BootScene` reaches a tool id only under
 * `import.meta.env.DEV`, so the release keeps its union-only load, matching its pruned files.
 */
export function loadsEveryArena(devToolId: string | undefined): boolean {
  return devToolId === "playground";
}

/** The manifest namespace turret sprites live under. */
export const TURRET_KEY_PREFIX = "turret.";

/**
 * The manifest key resolution order for a car's turret sprite: its own custom turret first, then
 * the shared default. Unlike `carSpriteKey`, which falls back to a different CAR's art
 * (`DEFAULT_CAR_ID`), a turret's fallback is a shared ASSET — every chassis's turret plate is
 * interchangeable, so there is one default rather than nine. A car with neither row still draws:
 * the caller tries each key in turn and falls to a procedural turret when neither resolves, the
 * same three-step chain `car.<id>` already takes to its silhouette fallback.
 */
export function turretSpriteKeys(carId: string): readonly [string, string] {
  return [`${TURRET_KEY_PREFIX}${carId}`, `${TURRET_KEY_PREFIX}default`];
}

/**
 * The manifest key for an arena's floor art. Namespaced `arena.<id>.floor` so
 * `scripts/build-release.mjs` prunes every arena outside the active-mode union out of the zip and
 * `shouldLoadAssetKey` skips it at boot — both of which already understand this shape.
 *
 * Unlike `carSpriteKey` there is no fallback id: an arena with no art renders procedurally, which
 * is a supported state rather than a missing asset.
 */
export function arenaFloorKey(arenaId: string): string {
  return `arena.${arenaId}.floor`;
}
