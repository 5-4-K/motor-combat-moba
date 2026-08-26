/**
 * How arena art is namespaced, so that a release can carry only the active arena's files.
 *
 * A manifest key `arena.<arenaId>.<slot>` names art owned by one arena, and lives on disk at
 * `public/art/arenas/<arenaId>/<slot>.png`. Two namespaces are never pruned: `arena.common.*`, for
 * art several arenas share, and everything outside the `arena.` prefix — cars today, powers later.
 *
 * This lives in shared rather than in the client because `scripts/build-release.mjs` applies the
 * same rule to files on disk that `shouldLoadAssetKey` applies to manifest keys at boot, and the
 * script already imports built shared. Two copies of this rule would eventually disagree, and the
 * symptom would be art that loads in dev and is missing from the zip.
 */
export const ARENA_ART_PREFIX = "arena.";

/** The namespace for art shared between arenas. Never pruned. */
export const ARENA_ART_COMMON = "common";

/**
 * The arena a manifest key belongs to, or `undefined` if the key is not arena-owned at all.
 * A malformed key with an empty id (`"arena."`, `"arena..floor"`) is treated as not arena-owned, so
 * it survives pruning and is left for the manifest parser to complain about rather than being
 * silently deleted by a build step.
 */
export function arenaIdFromArtKey(key: string): string | undefined {
  if (!key.startsWith(ARENA_ART_PREFIX)) return undefined;
  const rest = key.slice(ARENA_ART_PREFIX.length);
  const dot = rest.indexOf(".");
  const id = dot === -1 ? rest : rest.slice(0, dot);
  return id.length > 0 ? id : undefined;
}
