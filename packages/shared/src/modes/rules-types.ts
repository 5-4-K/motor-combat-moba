import type { ModeConfig } from "./types.js";

/** Which side structure a mode uses. Replaces `sidesOf`'s return type (GM14). */
export type Sides = "ffa" | "team";

/**
 * `StartRulePlayer`/`CanStartResult` moved here from `lobby/start-rules.ts` (still re-exported from
 * there and from `index.ts` under the same names) so a mode's own `canStart` can be typed without
 * importing the lobby module.
 */
export interface StartRulePlayer {
  status: "ready" | "in_match" | "post_match";
  team: number;
}

export type CanStartResult = { ok: true } | { ok: false; error: string };

/**
 * The mode-shaped facts that used to live as branches in `flow/modes.ts`'s exhaustive switches, now
 * one object per mode (GM14). `rulesOf(mode)` is the registry that resolves a `GameMode` to its
 * `ModeRules`.
 */
export interface ModeRules {
  readonly sides: Sides;
  readonly respawns: boolean;
  readonly hasMatchClock: boolean;
  /**
   * What ends the match, as a string — the same three values the deleted `flow/modes.ts` function
   * used to return, before it was folded into this registry (Task 9, GM2). Kept as its own field
   * only because a few non-test callers still need the STRING itself (a balance report printing
   * "deathmatch" in prose, a CLI comparing against it) — everything that only needed a boolean fact
   * now reads `respawns`/`hasMatchClock` directly instead.
   */
  readonly winRuleLabel: "last_standing" | "deathmatch" | "conquer";
  /** `players` is already filtered to READY players — `canStart` in `lobby/start-rules.ts` does that. */
  canStart(config: ModeConfig, ready: readonly StartRulePlayer[]): CanStartResult;
  claimsChassis(config: ModeConfig): boolean;
}
