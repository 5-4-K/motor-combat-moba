/**
 * What to show when the server names an arena this build does not have.
 *
 * The release zip cannot reach this state: it ships one build of server and client, so both sides
 * hold the same `ARENAS` registry and the same mode bundles, and every arena a room can name
 * (`arenas[0]` of its mode's set) is a key of the registry the client was built with. Development
 * can, via the stale-`dist` gotcha in `CLAUDE.md`
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
