import type { BotProfile } from "../../config/bot-profiles.js";
import type { SituationId } from "../types.js";
import type { PlanWeights } from "./planner.js";

/**
 * What each situation is FOR, as a weight vector (P27).
 *
 * The situation layer used to choose a heading per play, which the movement layer then averaged
 * against wall and orbit desires — and averaging two good headings is what produced spec section
 * 1.1. Now a situation states an objective and the planner is the only thing that turns an
 * objective into steer and throttle. There is no second place for a heading to come from.
 *
 * These are BASE weights, identical across tiers. Spec P38 names two profile-scaled terms, and
 * exactly ONE of them lives here: `weightsFor` scales `theirEv` by `opponentRangeRespect` and
 * touches nothing else. The other, `commitPenalty`, is not a `PlanWeights` term at all — the
 * planner applies it separately, as a fraction of the candidate score SPREAD favouring last tick's
 * action (`plan` in `planner.ts`), so it never passes through this table. A tier may change
 * how strongly it feels a pressure, never what a situation is for.
 *
 * RE-DERIVED AGAINST MEASURED TERM SCALES (R-P9, fix round 1, 2026-09-06). The first draft of this
 * table was written before a single term had been measured, and it was dimensionally incoherent:
 * three of them could not move a decision at all. Measured in a hard Bullseye duel, per
 * term, as the CONTRIBUTION each weight bought at a realistic pose:
 *
 * | term          | measured range        | old weight | old points | new weight | new points |
 * |---------------|-----------------------|------------|------------|------------|------------|
 * | `myEv`        | 0-75 EV/s             | 2          | 0-150      | 2          | 0-150      |
 * | `theirEv`     | 0-75 EV/s             | 1 (x0.9)   | 0-67       | 0.6 (x0.9) | 0-40       |
 * | `rangeError`  | 0-600 units           | 0.02       | ~1 at 50 u | 0.12       | ~6 at 50 u |
 * | `wallPenalty` | 0-1 (0.017 in a corner)| 40 (unpin)| **0.66**   | 2400       | 40         |
 * | `threatAvoid` | +-40 u (see below)    | (absent)   | —          | 0.6 (evade)| 0-24       |
 *
 * `threatAvoid`'s ROW IS STATED AT THE SHIPPED SCALE, and it is much smaller than the scale it was
 * derived on (M6, fix wave 3, 2026-09-07). It was "+-200 units at K=22, 0-120 points", measured
 * when a candidate was one input held for the whole horizon. R-P10 replaced that with a commitment
 * window followed by `CONTINUATION` — a full-neutral coast to rest — and the same re-derivation
 * that took `rangeError` up 10x below applies here for the same reason: the nine terminal poses now
 * sit ~40 units apart, not ~190, and a STATIONARY bot's whole menu spans about 4 units of travel
 * (see `CONTINUATION` in `planner.ts`). So 0.6 buys ~24 points of separation at the spread, and
 * ~2.4 from rest, against a `myEv` running to 150.
 *
 * THE WEIGHT IS NOT CHANGED HERE, and that is deliberate: `rangeError` was re-derived because the
 * term had stopped being able to say where to stand, whereas the dodge still wins its comparison
 * (`objectives.test.ts` asserts `threatAvoid` beats the best available shot, and it does at 0.6).
 * What was wrong was the JUSTIFYING FIGURE, which is what a tuner reads to decide the dodge weight
 * is fine. Anyone re-deriving it should measure the displacement the menu actually offers rather
 * than trusting either number here.
 *
 * `wallPenalty` is the one that looks alarming and is not. `boundsPenalty` is a SQUARED NORMALISED
 * overlap, so a Bullseye jammed into a corner at (40, 40) scores 0.0165 and an unobstructed pose
 * scores exactly 0 — the units are hundredths, and a weight in the hundreds is what turns them into
 * points. The 60x scale-up is the same number in a different unit, not a 60x behaviour change: an
 * obstacle box contributes a flat 1.0, which is where the term saturates, and `unpin`'s 2400 is the
 * situation whose entire content is "leave".
 *
 * `lockKeep` USED TO BE THE SIXTH ROW HERE, worth 12 in `punish`, 8 in `fight`, 4 in `close` and 2
 * in `reset`. It scored 0-or-1 on whether the retired ambient lock would have pointed an assisted
 * shot from a candidate pose, and it went with the mechanism. Nothing replaced it, deliberately:
 * what it was really buying — stand where the enemy is in front of you and inside your reach — is
 * what `myEv` scores directly through `proxyValue`, now that no slot gets the forced-zero aim error
 * that made `myEv` blind to the nose for exactly those weapons. The four situations that carried a
 * weight for it are the ones to watch in a balance run.
 *
 * `theirEv`'s drop from 1 to 0.6 is the only judgment call in the table rather than a unit fix. Both
 * it and `myEv` are EV per second, so their ratio IS the trade the bot is offering: at 2:1 the bot
 * would not close on a 10 EV/s improvement that cost it 30 EV/s of exposure, which reads as sound
 * play until you notice it also would not step back INTO its own gun's range after being shoved out
 * of it. At 2:0.6 it closes. Measured on the duel pair: 62 -> 98 off-axis fires at otherwise
 * identical settings.
 *
 * `rangeError` RE-DERIVED A SECOND TIME, 10x, WHEN R-P10 CHANGED ITS MEASURED SCALE (R-P10c, fix
 * round 4, 2026-09-07). R-P9's own rule is that a weight is re-derived when the quantity under it
 * moves, and R-P10 moved this one by construction. A candidate used to be one input held for the
 * whole horizon, so at hard's K=22 the nine terminal poses were spread ~190 units apart and 0.12
 * bought ~15 points of separation. A candidate is now the input held for the COMMITMENT WINDOW and
 * then a coast to rest, so the terminal poses are spread ~40 units and the same weight bought ~5 —
 * against a `myEv` cliff of 86 points between "nose on the target" and "nose 0.24 rad off it",
 * which did not shrink at all. The term stopped being able to say where to stand: measured, the
 * bot settled anywhere from 157 to 611 units against a preferred 530, and the closed-loop duels
 * became a lottery on which side of Bullseye's kit reach it happened to stop.
 *
 * Swept as a global gain on every row, seven seeds, both closed-loop duels, a duel counting as
 * passed only when it clears BOTH `fires > 90` and `meanOffset < 0.2`:
 *
 * | gain | 1x | 2x | 3x | 5x | 6x | 8x | **10x** | 12x | 16x |
 * |---|---|---|---|---|---|---|---|---|---|
 * | on-axis passes  | 6/7 | 6/7 | 5/7 | 4/7 | 4/7 | 5/7 | **6/7** | 5/7 | 5/7 |
 * | off-axis passes | 2/7 | 2/7 | 4/7 | 5/7 | 7/7 | 7/7 | **7/7** | 7/7 | 7/7 |
 *
 * 10x is the only row that is best-in-column on both. Above 6x the settle is stable (every seed
 * parks within 425-573 of a preferred 530 instead of 157-611) and the remaining variation is the
 * fire count at the edge of the kit's reach, not the bot's ability to hold a station. It is a
 * SCALE fix, not a priority change: the ratios between the eight situations are untouched, every
 * row is multiplied by the same 10, and the two rows that were 0 (`evade`, `unpin` — plays whose
 * content is "get off this line" and "leave", not "stand at a range") are still 0.
 *
 * `rangeError` RE-DERIVED A THIRD TIME, BACK DOWN TO 2.5x, WHEN R-P12 CHANGED ITS SCALE AGAIN
 * (fix round 5, 2026-09-07). Same rule, same event, the other direction: the commitment window is
 * now half the horizon rather than `recomputeTicks` (`BRAIN_CONSTANTS.commitWindowFraction`), so
 * hard commits 11 ticks instead of 2 and the nine terminal poses are spread ~120 units again
 * instead of ~40. 10x on that spread is a term that shouts down `myEv`'s heading cliff and steers
 * the bot by range alone. Swept as a global gain at the shipped window, seven seeds, both duels,
 * with `src/bot/` + `src/config/` red counts at the interesting rows:
 *
 * | gain (x the 10x above) | 0.15 | 0.2 | **0.25** | 0.3 | 0.4 | 0.5 | 1.0 | 2.0 |
 * |---|---|---|---|---|---|---|---|---|
 * | on-axis passes  | 5/7 | 6/7 | **7/7** | 6/7 | 6/7 | 5/7 | 4/7 | 2/7 |
 * | off-axis passes | 6/7 | 6/7 | **6/7** | 6/7 | 6/7 | 6/7 | 5/7 | 2/7 |
 * | red             |  -  |  -  |  **3**  |  3  |  -  |  -  |  6  |  -  |
 *
 * 0.2-0.4 is the plateau and 0.25 is its peak, so the rows below are the 10x values multiplied by
 * 0.25 — the same uniform scale fix, the same untouched ratios, the same two zero rows.
 *
 * `facingError` IS THE SEVENTH COLUMN (F11, 2026-09-07). The term is bounded [0, 1] — 0 driving
 * straight ahead, 0.5 sliding sideways, 1 reversing — so a weight IS the maximum penalty it can
 * contribute, and each row is set against what it competes with in that situation. `waitOut` is the
 * highest (F13): hunting is where facing your travel is the play, and 120 sits against
 * `rangeError` 0.375 x ~857 ~= 321. `reset` and `fight` are deliberately the lowest non-zero rows
 * (F12): a ranged chassis backing off toward its preferred range with its guns on the target is
 * correct play, and this term must not forbid it — which is the whole reason the facing pressure is
 * a per-situation column and not a `BRAIN_CONSTANTS` scalar. `recover` is 0 because a dead or
 * phased car is forced to coast and has nothing to steer (F8).
 *
 * `fight` WAS SWEPT, and it is the only row that was. The reasoned starting value was 15; at 15 the
 * off-axis duel canary settled at meanOffset 0.243 against a 0.2 bar — a real regression, which
 * outranks the two targets this term was written for. Swept over {0, 5, 15, 30, 60} at
 * `waitOut` 120, whole `src/bot/brain/` suite, 249 tests:
 *
 * | fight  | 0    | 5    | 15   | **30** | 60   |
 * |--------|------|------|------|--------|------|
 * | red    | 0    | 1    | 1    | **0**  | 0    |
 * | which  | —    | P50 ladder | off-axis duel | **—** | — |
 *
 * {30, 60} is the contiguous clean plateau and 30 is its low end, so it is the smallest facing
 * pressure that holds the aim line while leaving the ordering F12 argues for intact
 * (reset 10 < fight 30 < punish 50 < unpin 60 < close 80 < waitOut 120). 0 also passes, but it
 * switches the term OFF in the situation the bot spends most of its time in, which is exactly the
 * fragility F3 exists to remove. `waitOut` was swept over {60, 90, 120, 180, 240} at `fight` 15 and
 * is INERT for both canaries — every point was 248/249 on the same off-axis failure — so it keeps
 * the value F13's argument gives it. No other row was swept: a value found by chasing two tests
 * across six free parameters is overfitting, not tuning.
 *
 * `evade` RE-DERIVED, 40 -> 10, ON THE HEADROOM ARGUMENT THAT SHIPPED `fight` (final review,
 * 2026-09-07). Same rule as every re-derivation above — a weight is set against the term it
 * competes with — applied to the one situation nobody applied it to. In `evade` that competing
 * term is `threatAvoid`, and this file's own scale table puts it at **0-24 points** (0.6 x the
 * ~40 u terminal spread). `facingError` at 40 therefore made a reverse dodge buying FULL
 * clearance earn 24 and pay 40: reverse dodges were dominated OUTRIGHT, not merely priced.
 *
 * That is F12's principle — the term must not FORBID correct play — in a situation F12 never
 * examined; its headroom argument names `fight` and `reset` only, and `fight` was the only row
 * ever swept. It mattered more here than anywhere else because `DRIVE_CONFIG.steeringGrip` was
 * 1.0, so in the planner's rollout `facingError` was effectively BINARY (0 or 1, never the 0.5
 * band — see `facingErrorOf` in `planner.ts`): the weight was a FLAT TOLL on every reversing
 * candidate, not a ceiling one rarely reaches.
 *
 * ⚠ **THAT PREMISE IS GONE, AND STAGE 5 TASK 8 STEP 1 HAS RE-RUN THE DERIVATION IT OWED
 * (2026-09-19).** `DRIVE_CONFIG.steeringGrip` does not exist any more: the 2026-09-18 Unity
 * drive-model port deleted it outright (U13), which is that knob taken all the way to its 0 end.
 * Lateral velocity is now always present — it IS the drift — so `facingError` is CONTINUOUS rather
 * than binary, and the terminal pose of an ordinary TURN scores in (0, 0.5] where it used to score
 * exactly 0.
 *
 * **NEITHER ROW MOVED, and this is a measured conclusion, not a shortcut.** Both rows below argued
 * from binariness (`evade`'s 10 and `fight`'s 30, each set against the term it competes with under
 * the headroom rule), and the binary case they actually argue about — a candidate that reverses
 * straight, no turning at all — is UNCHANGED: `forwardOf / speed` still hits exactly ±1 at zero yaw
 * rate, so a full-clearance reverse still reads `facingError` 1 today exactly as it did at
 * `steeringGrip` 1.0, and the headroom arithmetic below (24-point `threatAvoid` ceiling in `evade`,
 * ~90-point `rangeError` in `fight`) is untouched by the port. What the port added is a NEW,
 * previously-unreachable case — an ordinary turn now scoring somewhere in (0, 0.5] rather than
 * exactly 0 — and that case was measured rather than assumed: rolled through `stepDrive` over a hard
 * tier's own commit-then-coast window (12 committed ticks of full lock, 10 coasting), the terminal
 * `facingError` for an ordinary turn ranges 0.0042-0.0212 across the roster and every starting speed
 * from rest to top speed (`planner.ts`'s `facingErrorOf` carries the full table). At the shipped
 * weights that is 0.04-0.21 points in `evade` and 0.13-0.64 in `fight` — nowhere close to a "flat
 * toll" that could re-create "turning is pure cost" (F1-F3): both rows still price an ordinary turn
 * as a rounding error next to `threatAvoid`'s 0-24 range or `rangeError`'s tens-to-hundreds, and
 * still price a genuine reversal at the same 14-point (`evade`) and precedent-matching (`fight`)
 * margins the derivation below always argued for. Neither weight had reason to move, so neither did.
 *
 * **What the continuous term did NOT explain, once measured against the live suite.** Three bot
 * symptoms coincided with this port and were checked against `facingError` specifically before
 * concluding they are not this term's doing:
 * - `controller.test.ts`'s G12 pair (`hunts a quadrant waypoint`, `hunts toward a last-known pose`)
 *   — the bot sits at `{steer: 0, throttle: 0}` hunting a waypoint ~150° behind it. Probed directly:
 *   `facingError` on the turning candidates is 0.006-0.02, negligible; the actual cause is that
 *   EVERY forward-driving candidate's terminal `rangeError` (the `waitOut` situation's only other
 *   live term, weight 0.375) is now worse than standing still, because a hard tier's ~12-tick commit
 *   window cannot turn far enough toward a target that far behind it to close any net distance under
 *   the heavier, faster drive model — a short-horizon planning limitation the physics port exposed,
 *   not a `facingError` miscalibration. No `BOT_PROFILES` knob flips it without either violating the
 *   documented performance budget on `planHorizonTicks` (needs roughly 40 against hard's shipped 22,
 *   nearly doubling per-plan cost) or moving `commitWindowFraction`, a swept global constant this
 *   file's own rules require re-sweeping rather than nudging. Left red and reported as a genuine,
 *   unresolved regression — see the stage 5 Task 8 report.
 * - `tiers.test.ts`'s H25 / S13-evade pair (dodge scenes compared by `.steer` alone) — probed
 *   directly: the planner's real winner under `dodgeChance: 1` DOES change (`{steer: 0, throttle: 1}`
 *   to `{steer: 0, throttle: -1}`, a genuine dodge), it just does it entirely through THROTTLE. The
 *   planner correctly prefers a straight reverse over a turning dodge here because turning away costs
 *   most of `myEv`'s 75 achievable points (down to ~18.7) while a straight reverse keeps the gun on
 *   target — `facingError`'s ~0.04-point difference between those two candidates is not what decides
 *   it. The tests check the wrong axis for this geometry, not a broken dodge; see the Task 8 report.
 * - `tiers.test.ts` P50 (`hits far more often above the easy tier`) — this one really is a
 *   regression, but a pre-existing, already-documented one (the paragraph two above this table
 *   traces it to a `solve()` EV-rating mismatch on hard's `pepperbox` at its own derived comfort
 *   range), and this file's own `facingError` weights play no part in it — confirmed by the same
 *   probe, which never sees `facingError` differ meaningfully between hard's candidates in that
 *   scene. Per this skill's "you do not tune around a solver bug" rule, left red.
 *
 * The derivation, not a sweep. `fight` ships facing at ~1/3 of the term it competes with (30
 * against `rangeError`'s ~90) — "a tie-breaker, never a veto". One third of `evade`'s 24 is 8;
 * 10 is that raised to the roster's existing floor for a situation where reversing IS the play
 * (`reset`, also 10). At 10 a full-clearance reverse still wins its comparison by 14 points,
 * while a candidate that gains nothing on the line still pays for pointing backwards — which is
 * the tie-breaker this term is for.
 *
 * THE EMPIRICAL LEG WAS RETIRED WITH THE SCENE IT WAS MEASURED ON (2026-09-07). This paragraph
 * used to close with an open-loop measurement taken in `controller.test.ts`'s dodge scene — "at 10
 * the bot reverses straight off the line to 19.4 u, at 15 and above it drives forward and turns,
 * crossing at t~19", with {15, 20, 24} byte-identical to 40. **That scene no longer exists.**
 * Commit `43ad3d6` replaced it one commit after those numbers were written, precisely because its
 * escape axis ran along the car's own nose and a straight reverse was the correct dodge there; the
 * current scene puts the escape axis PERPENDICULAR to the nose, where the throttle cannot reach it
 * at all. Re-measured on the current scene at the shipped weight of 10, the emitted answer is
 * `throttle +1` on every one of the 30 ticks with the wheel coming in bursts — a FORWARD arc, the
 * exact opposite of the reverse the old figures describe. The old numbers were therefore deleted
 * rather than reworded: they described a fixture, not a mechanism.
 *
 * WHAT THE WEIGHT NOW STANDS ON: the headroom derivation above, and nothing else. That derivation
 * is untouched by the scene change — it is arithmetic over this file's own scale table
 * (`threatAvoid` spans 0-24 achievable points in `evade`, so `facingError` at 40 dominated
 * full-clearance dodges outright) plus the `fight` precedent of ~1/3 of the competing term, and it
 * never depended on any scene. The `{10 vs 15}` FLIP POINT WAS AN OLD-SCENE MEASUREMENT AND HAS
 * NOT BEEN RE-MEASURED: do not cite it as evidence that values above 15 are inert here.
 * `controller.test.ts`'s dodge test is GREEN at 10, but it asserts the fire/steer ordering
 * property, not this weight, so treat it as a non-contradiction rather than as support. A
 * closed-loop `npm run playtest` run is still the instrument that would settle the dodge for real.
 * The weight is not to be raised back to chase a stricter assertion — the derivation stands on its
 * own.
 */
const BASE: Readonly<Record<SituationId, PlanWeights>> = Object.freeze({
  recover: {
    myEv: 0, theirEv: 0, rangeError: 0, wallPenalty: 60, threatAvoid: 0,
    facingError: 0,
  },
  waitOut: {
    myEv: 0, theirEv: 0.5, rangeError: 0.375, wallPenalty: 240, threatAvoid: 0,
    facingError: 120,
  },
  evade: {
    myEv: 0.3, theirEv: 4, rangeError: 0, wallPenalty: 360, threatAvoid: 0.6,
    // 10, not 40: `threatAvoid` maxes out at 24 points here (0.6 x the ~40 u spread, per the
    // scale table above), so 40 made a full-clearance reverse dodge earn 24 and pay 40 —
    // dominated outright, which is F12's prohibition in a situation F12 never examined. See the
    // "`evade` RE-DERIVED" paragraph above for the headroom derivation.
    facingError: 10,
  },
  unpin: {
    myEv: 0.2, theirEv: 1, rangeError: 0, wallPenalty: 2400, threatAvoid: 0,
    facingError: 60,
  },
  punish: {
    myEv: 3, theirEv: 0.25, rangeError: 0.5, wallPenalty: 240, threatAvoid: 0,
    facingError: 50,
  },
  reset: {
    myEv: 0.4, theirEv: 3, rangeError: 0.625, wallPenalty: 360, threatAvoid: 0,
    facingError: 10,
  },
  fight: {
    myEv: 2, theirEv: 0.6, rangeError: 0.3, wallPenalty: 300, threatAvoid: 0,
    facingError: 30,
  },
  close: {
    myEv: 1, theirEv: 0.75, rangeError: 0.875, wallPenalty: 300, threatAvoid: 0,
    facingError: 80,
  },
});

/**
 * The objective the planner optimises for this tick's play.
 *
 * Returns a FRESH object every call: `BASE` is the shared identity of the eight plays and a caller
 * that mutated a returned vector would silently re-author every later decision at every tier.
 */
export function weightsFor(situation: SituationId, profile: BotProfile): PlanWeights {
  const base = BASE[situation];
  return { ...base, theirEv: base.theirEv * profile.opponentRangeRespect };
}
