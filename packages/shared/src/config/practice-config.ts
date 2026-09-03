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
   *
   * Measured 2026-09-03 (spec Risk 2), not just reasoned: N=1/3/6/12 concurrent rooms all held mean
   * sim-tick interval within ~0.1 ms of the 33.33 ms target, and even N=12 stayed light on CPU in a
   * containerized dev sandbox — so 6 is a safety rail with real headroom below it, not a number
   * pushed up to chase capacity. Left at 6 on purpose; raise it only with a fresh measurement on the
   * actual host, since a container's CPU numbers do not carry over to someone's LAN PC.
   */
  maxConcurrentRooms: 6,
} as const;
