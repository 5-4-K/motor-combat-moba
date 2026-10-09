export type FlowConfig = typeof FLOW_CONFIG;

export const FLOW_CONFIG = {
  carSelectSeconds: 60,
  /** How long the "cars locked in" grid holds before the match countdown starts. */
  revealSeconds: 10,
  countdownSeconds: 3,
  nameMin: 1,
  nameMax: 16,
  /**
   * Whether Start opens the arena select screen (AR6). Widened to `boolean` so a mode's `config.ts`
   * can override it to `false` — `as const` would pin the literal `true`. Off means the match plays
   * the mode's `arenas[0]` and goes straight to car select, as before the screen existed.
   */
  arenaSelectEnabled: true as boolean,
  /** The host's choosing clock. At its end the highlighted arena is picked. */
  arenaSelectSeconds: 10,
  /** How long the chosen arena's card holds in the centre before car select. */
  arenaRevealSeconds: 3,
  /** Added to the reveal when the pick was Select random, so the roulette has time to spin. */
  arenaRouletteSeconds: 1.5,
} as const;
