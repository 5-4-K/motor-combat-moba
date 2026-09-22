import { withMode, type ModeConfig } from "@motor-combat-moba/shared";

/**
 * Wraps a room entry point so it cannot run unscoped (MC15) — a thin, server-named re-export of
 * shared's `withMode`. The async guard (refusing a Promise-returning callback, per MC11) lives at
 * `withMode`'s own definition in `@motor-combat-moba/shared`, not here: the client and every
 * headless harness call `withMode` directly too, and a server-only check would leave them
 * unguarded. This wrapper exists so a reader of a room file sees one obvious name for "this handler
 * runs inside its room's mode".
 */
export function scoped<T>(config: ModeConfig, fn: () => T): T {
  return withMode(config, fn);
}
