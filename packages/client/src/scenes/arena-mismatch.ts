/**
 * What to show when the server names an arena this build does not have.
 *
 * The release zip cannot reach this state: it ships one build of server and client with one
 * `ACTIVE_ARENA_ID` inlined into both. Development can, via the stale-`dist` gotcha in `CLAUDE.md`
 * and its browser-side twin — a tab held open across a server restart, or a Vite dep cache still
 * holding the previous `shared/dist`. That is exactly the loop arena authoring lives in, so the
 * message names both sides and the fix, rather than leaving a stack trace inside Phaser's boot.
 */
export function arenaMismatchMessage(serverArenaId: string, knownIds: readonly string[]): string {
  const known = knownIds.length > 0 ? knownIds.join(", ") : "(none)";
  return (
    `Arena mismatch.\n\n` +
    `The server is running "${serverArenaId}", but this build only knows: ${known}.\n\n` +
    `Rebuild shared (npm run build -w @motor-combat-moba/shared) and hard-refresh this page.`
  );
}
