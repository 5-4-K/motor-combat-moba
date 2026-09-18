/**
 * What remains of hard-slam tuning after the 2026-09-06 physics rework moved every slam-specific
 * number onto `wildcharge`'s own `ImpulseDef`, plus one knob the 2026-09-18 Unity ram port sent back
 * the other way.
 *
 * `wallContactPad` is not a slam property at all — it is how much a hull is inflated when asking "is
 * this touching level geometry", which any impulse with a `wallStun` needs. `spinScale` is: it is the
 * ram's old constant, which the ram no longer has a use for at that value (see its own comment).
 *
 * **Where the other six went** (stage 4), so a reader who came here looking for one is not left
 * guessing:
 *
 * - `knockSpeed` (520), `wallStunWindowMs`/`wallStunDurationMs` (500/500) and `reslamImmunityMs`
 *   (600) moved verbatim onto `WEAPON_TABLE.wildcharge.impulse` as `speed`, `wallStun.windowMs`/
 *   `.durationMs` and `retriggerImmunityMs`. `knockSpeed`'s "do not retune it here in isolation"
 *   caveat travelled with it and is still unresolved — spec P31 assigns the re-pitch to stage 5.
 *   `SLAM_TICKS` went with them: those three durations now convert to ticks in `WEAPON_TICKS`,
 *   through the same `msToTicks`, so a slam's clocks are derived exactly where every other weapon's
 *   are.
 * - `victimAuthority` (0.35) was the victim's post-slam steering authority and had been inert since
 *   the rework's stage 2 — `PlayerState` has no `authority` field for it to write. Its successor is
 *   `wildcharge.impulse.uncontrolMs`, which lands the `reeling` status the same way an ordinary ram
 *   does; it was deleted rather than revived because the mechanism it named no longer exists.
 * - `selfKeepFactor` (0.7) was a hand-restored fraction of the attacker's pre-impact speed, written
 *   because nothing in the sim could express "the attacker keeps its momentum" as physics. It has
 *   been inert since stage 2 as well, and it has no successor constant: a slam's attacker is simply
 *   never pushed at all (`ram-bridge.ts`'s slams loop applies the victim's impulse and nothing
 *   else), so there is nothing left to restore. The `reactionOf` recoil that briefly stood between
 *   those two models was deleted in stage 3 (spec R7).
 */
export const SLAM_CONFIG = {
  wallContactPad: 1,

  /**
   * Calibration multiplier on the spin a slam's impulse imparts (`applyImpulse`'s `nextSpin`).
   *
   * **This is `RAM_CONFIG.spinScale`'s shipped value, 12.5, moved here rather than copied — the ram
   * no longer has a knob this could point at.** The Unity ram port (spec §7) changed that constant's
   * meaning AND the shape of the formula reading it: a ram's spin now divides by
   * `inertiaRadiusSquared()` alone, while a slam's still divides by `ramDefence * inertiaRadiusSquared`
   * — a denominator 30-90x larger — and `RAM_CONFIG.spinScale` was re-pitched 12.5 -> 0.3 for the
   * ram's shape only (spec §9: a typical flank ram landing ~4 rad/s against the 6 rad/s clamp).
   * Leaving the slam pointed at it would have cut `wildcharge`'s slam spin to 1/41.7 of what it
   * shipped at, silently, and stage 4's "wildcharge still clearly harder than the best ordinary ram"
   * exit criterion would then have been measuring that nerf and blaming the wrong thing. A constant
   * surviving in name while its value drops 41x is not surviving.
   *
   * So: the slam's spin is bit-identical before and after the port, and the two knobs are now free to
   * move independently, which is what they were always doing in practice. `SLAM_CONFIG` is not a
   * `tuning.ts` root, so unlike `RAM_CONFIG.spinScale` this is not a playground slider — that is
   * pre-existing, and fine: nothing about this move changed which knobs are tunable.
   *
   * `RAM_CONFIG.spinMaxRate` still clamps the result, shared by both paths.
   */
  spinScale: 12.5,
} as const;
