import { msToTicks } from "./weapon-ticks.js";

/**
 * Hard-slam tuning (spec S3). A slam REPLACES the graded ram with a fixed exchange: same knock for
 * every attacker and victim, by design — "impulse strength is fixed unlike ram". Networked balance,
 * same standing as RAM_CONFIG.
 */
export const SLAM_CONFIG = {
  /** Fixed knock impulse (a speed), 2x RAM_CONFIG.knockMaxSpeed. No mass factor, no side bonus. */
  knockSpeed: 520,
  /**
   * INERT — reads nothing since the 2026-09-06 car-physics rework's stage 2 (Impulse). Was the
   * victim's post-slam steering authority, mirroring `RAM_CONFIG.authorityFloor`'s own value.
   * `Impulse` has no authority field at all — `sim/contact.ts`'s slam branch never wrote one even
   * before this stage, since `ram-bridge.ts` dropped `knock.authority` on the floor entirely
   * (stage 1's shim). Ram control-loss returns as the `reeling` status in stage 3, which replaces
   * this knob outright rather than reviving it.
   */
  victimAuthority: 0.35,
  /**
   * INERT — reads nothing since stage 2 Task 4 of the 2026-09-06 car-physics rework. Was the
   * fraction of the attacker's pre-impact speed hand-restored after a slam. `ram-bridge.ts` no
   * longer computes a `restored` speed at all: the attacker's post-slam velocity now falls out of
   * `reactionOf`'s equal-and-opposite reaction to the exact same `Impulse` the victim received,
   * applied through the shared `impulses` map alongside every ordinary ram. Stage 4 deletes this
   * field along with the rest of `SLAM_CONFIG` rather than reviving it.
   */
  selfKeepFactor: 0.7,
  /** Wall contact within this window after being slammed stuns the victim. */
  wallStunWindowMs: 500,
  wallStunDurationMs: 500,
  /** A just-slammed car cannot be slammed again within this (O18; playtest-tuned; unexercised while Wild Charge, exempt and one-hit, is the only slammer). */
  reslamImmunityMs: 600,
  /** Hull inflation for "touching level geometry", mirroring RAM_CONFIG.contactPad. */
  wallContactPad: 1,
} as const;

export const SLAM_TICKS = Object.freeze({
  wallStunWindow: msToTicks(SLAM_CONFIG.wallStunWindowMs),
  wallStunDuration: msToTicks(SLAM_CONFIG.wallStunDurationMs),
  reslamImmunity: msToTicks(SLAM_CONFIG.reslamImmunityMs),
});
