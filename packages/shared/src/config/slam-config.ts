import { msToTicks } from "./weapon-ticks.js";

/**
 * Hard-slam tuning (spec S3). A slam REPLACES the graded ram with a fixed exchange: same knock for
 * every attacker and victim, by design — "impulse strength is fixed unlike ram". Networked balance,
 * same standing as RAM_CONFIG.
 */
export const SLAM_CONFIG = {
  /**
   * **SUPERSEDED as of 2026-09-06.** The equal-and-opposite reaction this comment measures —
   * `reactionOf` negating and mass-scaling a copy of the victim's `Impulse` back onto the attacker —
   * is being replaced by a contest model: each car brings a push into the collision from its
   * `attack` rating times the speed it is driving into the impact, plus a scaled contribution from
   * its `defence` rating, and each car's received impact is computed directly from the *other*
   * car's push — never derived by negating its own. `mass` is being removed from the game entirely,
   * replaced by per-car `attack` and `defence` stats, so the mass figures below
   * (`RAM_REFERENCE_MASS`, `RAM_CONFIG.massFactorMin`/`massFactorMax`) measure a rating that is
   * going away. `docs/superpowers/specs/2026-09-06-car-physics-rework-design.md` is the authority
   * for where this is headed; the measurement below stays accurate about the code as it stands
   * today and is kept for anyone debugging current behaviour.
   *
   * Fixed knock impulse (a speed), 2x RAM_CONFIG.knockMaxSpeed. No mass factor, no side bonus — the
   * victim's push is `massScaled: false` (see `sim/contact.ts`'s slam branch).
   *
   * **The attacker's reaction is NOT unscaled**, and that asymmetry is the sharpest edge of the
   * 2026-09-06 equal-and-opposite change (stage 2 Task 4): `reactionOf` always forces
   * `massScaled: true`, even for a slam, so the attacker's own mass divides its recoil back down
   * while the victim's push ignores mass entirely.
   *
   * **The attacker is charged in TWO layers here too, exactly as `RAM_CONFIG.knockMaxSpeed`'s own
   * comment now explains — an earlier pass of this comment measured the reaction alone and was
   * wrong.** A charging car is not exempt from `resolveWorld`'s collision reflection: `wildcharge` is
   * a `kind: "maneuver"` CHARGE, and `isDashing` (the only thing that routes `stepSim` through the
   * substepped dash resolver instead of ordinary `resolveWorld`) checks for DASH specifically, not
   * CHARGE — so a charging Bastion drives and collides exactly like an ordinary car, and
   * `runPipeline`'s `serverTick` (drive + `resolveWorld`) still runs before `contactTick` reaches this
   * slam. The restitution reflection happens FIRST, and the fixed slam reaction lands on top of it.
   *
   * Measured through the real order — `serverTick` then `contactTick` — for Bastion (mass 900,
   * `wildcharge`'s only chassis) landing a slam at its own top speed (190 u/s, `RAM_REFERENCE_MASS`
   * 500, `RAM_CONFIG.massFactorMin/Max` 0.6/1.6), dead-on:
   *
   * `resolveWorld` reflection: `190 * -0.15 = -28.5`. Reaction on top:
   * `520 * clamp(500/900, 0.6, 1.6) = 520 * 0.6 = 312`. Final: `-28.5 - 312 = -340.5 u/s` — the
   * attacker ends the slam thrown backwards at **1.8x its own top speed** (not 64% of it as an
   * isolated-`contactTick` measurement would suggest), the whole way across the two collision layers
   * that actually apply on the live path. This value was tuned purely as the VICTIM's Δv, under a
   * one-way model where the attacker paid nothing at all (the old `SLAM_CONFIG.selfKeepFactor`
   * hand-approximated the attacker's cost instead; this stage deleted it outright in favour of the
   * real reaction above).
   *
   * Stage 4 (`docs/superpowers/plans/2026-09-06-car-physics/04-impulse-def.md`) moves this number
   * onto `wildcharge.impulse.speed` and, per spec P31, is where it "must be deliberately re-pitched
   * against the measured new ram maximum" — do not retune it here in isolation.
   */
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
