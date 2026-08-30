/**
 * The one arena this build plays and ships.
 *
 * Change this single line to change arenas: the server's `ArenaState.arenaId` defaults to it, the
 * client loads only this arena's art at boot, and `scripts/build-release.mjs` prunes every other
 * arena's assets out of the release. It lives in `config/` rather than in the registry because this
 * is the file you are meant to edit; the registry is the file you are meant to append to.
 *
 * Must be a key of `ARENAS` in `arena/registry.ts`. `arena.test.ts` asserts that, so a typo fails
 * the build rather than throwing inside a live room.
 */
export const ACTIVE_ARENA_ID = "arena-01";
