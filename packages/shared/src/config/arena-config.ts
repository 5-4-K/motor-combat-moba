/**
 * A default arena id — NOT the arena the game plays.
 *
 * The played arena is per mode: `arenas[0]` of that mode's own `arenas` list in
 * `modes/<mode>/index.ts`, which every room reads through its `ModeConfig` (MC23). Changing the line
 * below changes nothing about play. Three call sites still read it, and they are the whole of what
 * it is for (MC26):
 *
 * - `ArenaState.arenaId`'s field initializer, a placeholder every room overwrites before anyone
 *   joins;
 * - the playground's default arena in `defaultPlaygroundSetup` (its settings panel switches arenas
 *   live, so this is only where it opens);
 * - the asset pipeline's default in `scripts/build-cars-and-weapons.mjs`, which needs ONE arena
 *   width to report weapon reach against.
 *
 * The release zip and the client's boot filter both cover `activeArenaIds()` — the union of every
 * ACTIVE mode's arena set — not this constant.
 *
 * Must be a key of `ARENAS` in `arena/registry.ts`. `arena.test.ts` asserts that, so a typo fails
 * the build rather than throwing inside a live room.
 */
export const ACTIVE_ARENA_ID = "arena-01";
