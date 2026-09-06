import { msToTicks } from "./weapon-ticks.js";

/**
 * Hard-slam tuning (spec S3). A slam REPLACES the graded ram with a fixed exchange: same knock for
 * every attacker and victim, by design — "impulse strength is fixed unlike ram". Networked balance,
 * same standing as RAM_CONFIG.
 */
export const SLAM_CONFIG = {
  /**
   * Fixed knock impulse (a speed) applied to a slam's VICTIM. No rating factor and no side bonus —
   * a slam is authored, not contested, and its `Impulse` is `defenceScaled: false` (see
   * `sim/contact.ts`'s slam branch), so it punts every chassis identically. That is the designer's
   * escape hatch spec principle C grants (R10), and it is the one place in the game a push
   * deliberately ignores the target's solidity.
   *
   * **The attacker takes nothing from its own slam.** `sim/contact.ts`'s slam branch authors the
   * attacker's half of the contact (`ImpulseEntry.attackerImpulse`) as a deliberate zero-magnitude
   * `Impulse` and `ram-bridge.ts` applies it like any other, so "the attacker keeps going" falls out
   * of the impulse it is handed rather than being a separate rule. That is a change from what shipped
   * before 2026-09-06: `reactionOf` used to negate a copy of the victim's push back onto the
   * attacker, always forcing `defenceScaled: true`, and measured through the composed pipeline order
   * (`serverTick`'s `DRIVE_CONFIG.restitution` reflection FIRST, the reaction on top) a Bastion —
   * `wildcharge`'s only chassis — ended its own slam thrown backwards at 340.5 u/s, **1.8x its own
   * top speed**. Stage 3 Task 3 deleted `reactionOf` outright; the numbers here are what that
   * measurement was for, and they are historical.
   *
   * This value was pitched purely as the victim's Δv under that one-way model and has never been
   * re-pitched against the contest. Stage 4
   * (`docs/superpowers/plans/2026-09-06-car-physics/04-impulse-def.md`) moves it onto
   * `wildcharge.impulse.speed` and, per spec P31, is where it "must be deliberately re-pitched
   * against the measured new ram maximum" — do not retune it here in isolation. `globalScale`'s
   * comment in `ram-config.ts` now carries that measured maximum.
   */
  knockSpeed: 520,
  /**
   * INERT — reads nothing since the 2026-09-06 car-physics rework's stage 2 (Impulse). Was the
   * victim's post-slam steering authority, and it mirrored the equivalent steering floor in
   * `RAM_CONFIG` — a knob stage 3b has since deleted outright. `Impulse` has no authority field at all — `sim/contact.ts`'s slam
   * branch never wrote one even before this stage, since `ram-bridge.ts` dropped `knock.authority`
   * on the floor entirely (stage 1's shim). Ram control-loss came back as the `reeling` status in
   * stage 3b, which replaces this knob outright rather than reviving it: a ram's control-loss
   * duration is `RAM_CONFIG.ramUncontrolMs`, and stage 4 gives `wildcharge` its own on its
   * `ImpulseDef` rather than reading anything here.
   */
  victimAuthority: 0.35,
  /**
   * INERT — reads nothing since stage 2 Task 4 of the 2026-09-06 car-physics rework.
   *
   * Was the fraction of the attacker's pre-impact speed hand-restored after a slam: a tuned
   * approximation of "the attacker keeps most of its momentum", written because nothing in the sim
   * could express that outcome as physics. **What determines the attacker's outcome now is the
   * contest** (spec R4/R5, P20): each car's received impact is built from the OTHER car's push,
   * shared out by who is winning, so a car winning its contest decisively takes almost nothing —
   * it falls out of `impactOn` rather than being hand-restored afterwards. For a slam specifically
   * the outcome is stronger still and does not even go through the contest: `sim/contact.ts`'s slam
   * branch authors the attacker a zero-magnitude `attackerImpulse`, so the attacker takes exactly
   * nothing.
   *
   * The `reactionOf` recoil that briefly stood between these two models is deleted (stage 3 Task 3),
   * so this field's successor is the contest itself and not another constant. Stage 4 deletes this
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
