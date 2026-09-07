/**
 * What remains of hard-slam tuning after the 2026-09-06 physics rework moved every slam-specific
 * number onto `wildcharge`'s own `ImpulseDef`. This one is not a slam property at all — it is how
 * much a hull is inflated when asking "is this touching level geometry", which any impulse with a
 * `wallStun` needs.
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
} as const;
