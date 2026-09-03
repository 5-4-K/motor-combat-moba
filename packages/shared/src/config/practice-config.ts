/**
 * Practice-mode session limits (spec PR26–PR31). Not balance: these bound what one host PC spends
 * on sandboxes nobody is sitting at, and they live here rather than as literals in the room because
 * invariant 2 admits no exceptions for "it's only a timeout".
 */
export const PRACTICE_CONFIG = {
  /** Wall-clock seconds without an input before the room closes itself (PR27). */
  idleTimeoutSeconds: 300,
  /** Seconds of that timeout remaining when the player is warned (PR28). */
  idleWarningSeconds: 60,
  /**
   * How many practice rooms may exist at once on one process (PR29). Six is the game's own player
   * ceiling, so no LAN scenario has more practising humans than a match could seat. Overridable by
   * environment through `getMaxPracticeRooms` in the server's `mode.ts`.
   */
  maxConcurrentRooms: 6,
} as const;
