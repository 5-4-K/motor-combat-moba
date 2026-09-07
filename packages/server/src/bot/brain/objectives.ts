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
 * three of the six terms could not move a decision at all. Measured in a hard Bullseye duel, per
 * term, as the CONTRIBUTION each weight bought at a realistic pose:
 *
 * | term          | measured range        | old weight | old points | new weight | new points |
 * |---------------|-----------------------|------------|------------|------------|------------|
 * | `myEv`        | 0-75 EV/s             | 2          | 0-150      | 2          | 0-150      |
 * | `theirEv`     | 0-75 EV/s             | 1 (x0.9)   | 0-67       | 0.6 (x0.9) | 0-40       |
 * | `rangeError`  | 0-600 units           | 0.02       | ~1 at 50 u | 0.12       | ~6 at 50 u |
 * | `wallPenalty` | 0-1 (0.017 in a corner)| 40 (unpin)| **0.66**   | 2400       | 40         |
 * | `lockKeep`    | 0 or 1                | 1          | **1**      | 8          | 8          |
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
 * situation whose entire content is "leave". `lockKeep` is 0-or-1 and was likewise worth one point
 * against a `myEv` running to 150; 8 makes holding a lock worth about a twentieth of a perfect shot,
 * which is roughly what the lock is worth.
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
 */
const BASE: Readonly<Record<SituationId, PlanWeights>> = Object.freeze({
  recover: { myEv: 0, theirEv: 0, rangeError: 0, wallPenalty: 60, lockKeep: 0, threatAvoid: 0 },
  waitOut: {
    myEv: 0, theirEv: 0.5, rangeError: 0.375, wallPenalty: 240, lockKeep: 0, threatAvoid: 0,
  },
  evade: { myEv: 0.3, theirEv: 4, rangeError: 0, wallPenalty: 360, lockKeep: 0, threatAvoid: 0.6 },
  unpin: { myEv: 0.2, theirEv: 1, rangeError: 0, wallPenalty: 2400, lockKeep: 0, threatAvoid: 0 },
  punish: { myEv: 3, theirEv: 0.25, rangeError: 0.5, wallPenalty: 240, lockKeep: 12, threatAvoid: 0 },
  reset: {
    myEv: 0.4, theirEv: 3, rangeError: 0.625, wallPenalty: 360, lockKeep: 2, threatAvoid: 0,
  },
  fight: { myEv: 2, theirEv: 0.6, rangeError: 0.3, wallPenalty: 300, lockKeep: 8, threatAvoid: 0 },
  close: {
    myEv: 1, theirEv: 0.75, rangeError: 0.875, wallPenalty: 300, lockKeep: 4, threatAvoid: 0,
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
