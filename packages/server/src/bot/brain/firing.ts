import { hasStatus, weaponDefOf } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotCarView, BotSelfView, BotSlotView, SituationId } from "../types.js";
import type { KitRoles } from "./roles.js";
import { weaponReachOf } from "./reach.js";
import { bestAchievableValueOf, proxyValue, type FiringSolution } from "./solution.js";

/**
 * How much a good window is worth to an ult's ranking (H30).
 *
 * Every ult on this roster is worth less per second than the slot beside it, so without this a good
 * window could never actually produce an ult press and "saves it for a stunned target" would be
 * unobservable from outside.
 */
const ULT_WINDOW_BONUS = 4;

/** A slot with a stock in hand and neither lock running. */
export function slotIsReady(slot: BotSlotView, tick: number): boolean {
  return slot.stocks >= 1 && tick >= slot.refireLockUntilTick;
}

/** A long-cooldown weapon, worth saving for a moment (H30). */
export function isUlt(slot: BotSlotView): boolean {
  return weaponDefOf(slot.weaponId).cooldownMs >= BRAIN_CONSTANTS.ultCooldownMs;
}

/**
 * Where this bot wants to stand: the range at which its kit's value PEAKS (P31).
 *
 * Was `standoffFraction * weighted reach` — a guess with a per-tier fudge factor on top of a
 * hand-written value heuristic. The solver can answer the question directly, so it does: sample
 * `proxyValue` across the kit's reach and take the best. A Bastion and a Mirage now want genuinely
 * different distances because their kits do, rather than because they carry different fractions of
 * a shared formula, and the per-tier spread falls out of `aimErrorSigmaRad` alone — a shakier hand
 * loses its hit chance to the target's shrinking subtense sooner, so its plateau ends nearer.
 *
 * THE ANSWER IS THE FAR EDGE OF THE PLATEAU, and that is the load-bearing decision in this
 * function. `proxyValue` is monotonically NON-INCREASING in distance for every row in
 * `WEAPON_TABLE`: flat while `subtense / spread` is still saturated at a hit chance of 1, then
 * strictly falling as the target's angular width shrinks, and never rising. So the maximum is a
 * PLATEAU whose near edge is always `minEngageUnits`. Keeping the first sample that beat a running
 * best would therefore return 70 for every chassis at every tier — P31 would buy nothing, and
 * `rangeError` would drag every bot to contact range. Taking the FARTHEST qualifying sample instead
 * gives the greatest distance at which the kit still pays, which is where a player who knows their
 * own hands stands.
 *
 * "STILL PAYS" IS A FRACTION, NOT AN EXACT TIE (R-D5, fix wave 2, 2026-09-07). This used to be
 * `total >= bestValue` in a single running-best pass, i.e. the farthest range whose total EXACTLY
 * tied the maximum — and that made the `weights` argument provably inert. Every term of the sum is
 * non-negative and non-increasing in range (the target is straight ahead here, so `offBy` is
 * identically 0), so the sum ties its own maximum only where every term does individually, and
 * strictly positive weights cancel out of that condition. The result was a VETO BY THE
 * SHORTEST-REACHING SLOT applied at full strength however little the personality cared for that
 * slot. Against `BRAIN_CONSTANTS.preferredRangePlateauFraction` a heavily-weighted long slot holds
 * the total above the bar past a lightly-weighted short slot's cliff, so `slotWeights` reach the
 * standoff again — see that constant for the sweep the 0.95 came out of.
 *
 * "REACH IT" MEANS ONE CELL OF NINE, AND THAT IS THE HONEST SUMMARY (R-D5 pushback, fix wave 3,
 * 2026-09-07). A 5x5x5 sweep of `rollPersonality`'s 0.5-1.5 draw over three chassis x three tiers
 * returns more than one standoff for exactly one cell — Mirage at hard, 386.7 against 220.
 * Everywhere else the shortest ready slot's cliff is too large a share of the peak for any
 * weighting in that range to clear the bar past it. The fraction is still right — removing a
 * STRUCTURAL veto is what it does, and it is what puts a hard Bullseye at 470 rather than the exact
 * tie's 420 — but "the personality moves the standoff" is a documented limitation, not a shipped
 * behaviour. That one live cell also rests on `proxyValue` under-valuing `afterburner` ~5x; see
 * the accepted-loss note on `proxyValue` in `solution.ts`, which records that fixing it takes the
 * sweep to 0 of 9 and why it was reverted anyway.
 *
 * IT TAKES TWO PASSES OVER THE SAMPLES, but only ONE evaluation of each (M7, fix wave 3,
 * 2026-09-07). The two-pass STRUCTURE is forced: the bar is a fraction of the maximum, so the
 * maximum has to be known before any range can be tested against it, and a running best has not
 * seen the samples still ahead of it. Evaluating `totalAt` twice per range was not forced — this
 * used to say the two "cannot be folded back into one", which conflated the structure with the
 * cost. The 24 totals are computed once into an array and the second pass scans them.
 *
 * THAT COST IS NOT COVERED BY `planner.bench.test.ts`, which times `plan()` alone.
 * `preferredRangeOf` is called from `HumanController`'s recompute, outside the planner, so nothing
 * in the suite gates it. Each sample runs `proxyValue` once per slot — about 24 x 3 = 72 calls of
 * ~20 flops per pass, ~144 per recompute before this change (two passes), 72 after (one).
 *
 * THE LOWER CLAMP IS THE TABLE'S, NOT THIS FUNCTION'S. `bestRange` starts at `minEngageUnits` and
 * only ever moves outward, so the sole way out below the floor is the `Math.min` against
 * `awarenessRadiusUnits` — which is safe because every tier perceives far further than 70 units.
 * That is stated on `minEngageUnits` and pinned by `firing.test.ts`, rather than re-clamped here,
 * so a tier row that ever broke it fails a test naming the tier instead of being silently absorbed.
 *
 * WHEN NOTHING IS LOADED, THE WHOLE KIT IS SAMPLED ANYWAY (R-D4, fix wave 1, 2026-09-07) — the
 * authored reach, not the empty set. Readiness is the right filter while at least one gun is
 * loaded: a bot with one of three slots up should stand where THAT slot pays. But mid-recharge
 * every slot is filtered out, every sampled range totals 0, all of them tie — and the far-edge rule
 * above, which is correct and load-bearing for the real case, sends the bot to the FAR end of its
 * reach, 900 units for a Bullseye, capped only by `awarenessRadiusUnits`. (A zero peak makes the
 * fractional bar zero too, so the fraction does not rescue this on its own; the `peak <= 0` guard
 * below is the second line of defence, for a kit with no slots at all.) That is a degenerate tie
 * deciding a position, not a decision. The `effectiveRangeOf` this function replaced
 * carried an explicit fallback for the mirror-image reason and said so: "so a bot mid-recharge does
 * not suddenly decide it wants to be nose to nose." Backing off while reloading may well be good
 * play; if it is ever wanted it belongs in the situation layer, which already has `reset` and
 * `waitOut` for exactly that, and not in an accident of this function's tie-break.
 */
export function preferredRangeOf(
  self: BotSelfView,
  profile: BotProfile,
  weights: readonly number[],
  tick: number,
): number {
  const longest = Math.max(
    BRAIN_CONSTANTS.minEngageUnits,
    ...self.slots.map((slot) => weaponReachOf(slot.weaponId)),
  );
  // R-D4: readiness only filters while it leaves something to sample. With nothing loaded it is
  // every slot, which is the kit's authored reach.
  const anyReady = self.slots.some((slot) => slotIsReady(slot, tick));
  const step = Math.max(
    BRAIN_CONSTANTS.preferredRangeMinStepUnits,
    longest / BRAIN_CONSTANTS.preferredRangeSampleCount,
  );

  const totalAt = (range: number): number => {
    let total = 0;
    for (let i = 0; i < self.slots.length; i++) {
      const slot = self.slots[i]!;
      if (anyReady && !slotIsReady(slot, tick)) continue;
      total += proxyValue({
        shooter: { x: 0, y: 0, angle: 0 }, slot,
        targetX: range, targetY: 0,
        aimSigmaRad: profile.aimErrorSigmaRad, assisted: false,
      }) * Math.max(weights[i] ?? 1, 0.01);
    }
    return total;
  };

  // Pass 1: evaluate every sample ONCE, keeping the range beside its total so pass 2 scans rather
  // than re-evaluates. The peak is taken here because the bar is a fraction OF it, so it cannot be
  // applied until it is known.
  const samples: { range: number; total: number }[] = [];
  let peak = 0;
  for (let range = BRAIN_CONSTANTS.minEngageUnits; range <= longest; range += step) {
    const total = totalAt(range);
    samples.push({ range, total });
    peak = Math.max(peak, total);
  }
  // A kit that scores nothing anywhere (no slots at all) has no plateau to sit on the far edge of,
  // and a bar of zero would let every sample tie at 0 and hand back the far end of the reach — the
  // degenerate tie R-D4 is about. Fall to the floor instead.
  if (peak <= 0) return Math.min(BRAIN_CONSTANTS.minEngageUnits, profile.awarenessRadiusUnits);

  // Pass 2: the FARTHEST range still clearing the bar (R-D5). A scan of pass 1's totals, so the
  // sampled ranges are bit-for-bit the ones that were evaluated — re-running the accumulation
  // `range += step` a second time would be a second chance to drift.
  const bar = peak * BRAIN_CONSTANTS.preferredRangePlateauFraction;
  // Annotated `number`, not inferred: `BRAIN_CONSTANTS` is a frozen object literal, so
  // `minEngageUnits` carries the LITERAL type `70` and an inferred `bestRange` would refuse every
  // `sample.range` assigned to it below. Pre-existing on `development/main` (the server typecheck
  // gate was red on its tip); surfaced here because the car-physics branch repaired the gate.
  let bestRange: number = BRAIN_CONSTANTS.minEngageUnits;
  for (const sample of samples) {
    if (sample.total >= bar) bestRange = sample.range;
  }
  return Math.min(bestRange, profile.awarenessRadiusUnits);
}

export interface FireDecision {
  /** The single slot to press, or `undefined` to hold fire. NEVER a mask (H27). */
  slot: number | undefined;
}

/**
 * One ult slot's held discipline decision for its current (target, ready) episode (H30).
 *
 * Keyed by slot index on the controller and mutated in place by `chooseSlot`, the same shape as
 * `lastPressTick` — `chooseSlot` itself stays otherwise stateless. `holding` is rolled ONCE when a
 * slot enters a bad-moment episode, then reused verbatim every subsequent tick that episode is
 * still running: re-rolling every recompute would make even a 90%-disciplined tier's "hold" decay
 * geometrically to a certainty of firing (0.9^n keeps falling with every extra evaluation), which is
 * a coin that never stops flipping, not discipline. The episode ends — and the memo is cleared, so
 * the NEXT bad moment gets its own fresh roll — the moment the slot goes not-ready (fired, or still
 * mid-recharge) or the target changes; the moment turning good also clears it, because a good moment
 * is the episode resolving by firing, not by continuing to hold.
 */
export interface UltHoldEntry {
  targetSessionId: string;
  holding: boolean;
}

/**
 * Which one slot to press this tick (H27).
 *
 * `beginFire` resolves at most one press per tick and takes the LOWEST set bit it can use, so a bot
 * that ORs every in-range slot fires slot 0 and essentially nothing else. Ranking and returning one
 * slot is what lets a chassis actually use its kit.
 *
 * Draws exactly two random numbers, always, in this order: the discipline roll and the ult roll —
 * this NEVER changes, regardless of whether the ult roll's value ends up used (H21): a draw that
 * only happens on some ticks would make the stream depend on the branch.
 */
export function chooseSlot(args: {
  self: BotSelfView;
  target: BotCarView;
  profile: BotProfile;
  weights: readonly number[];
  tick: number;
  lastPressTick: number;
  rng: Rng;
  /** Per-slot ult discipline memo, owned and persisted by the caller (H30). Mutated in place. */
  ultHold: Map<number, UltHoldEntry>;
  /** Held situation (S18). Absent means rank as a normal fight — used by unit tests. */
  situation?: SituationId;
  roles?: KitRoles;
  /** Slot to keep pressing while stickiness lasts (S15). */
  stuckSlot?: number;
  /** This tick's per-slot firing solutions (P14), keyed by slot index. Absent means not ready/no
   * target — `solve`'s job, computed once per tick by the caller and handed in read-only. */
  solutions: ReadonlyMap<number, FiringSolution>;
}): FireDecision {
  const { self, target, profile, weights, tick, rng, ultHold, solutions } = args;

  // Both drawn unconditionally, before any early return, so the stream stays aligned (H21).
  const disciplineRoll = rng();
  const ultRoll = rng();
  // Still drawn, still discarded: the count per call must not change (H21). The value's old
  // consumer was `fireDisciplineChance`, which the EV threshold replaces.
  void disciplineRoll;

  const hold: FireDecision = { slot: undefined };
  if (tick - args.lastPressTick < profile.burstGapTicks) return hold;
  // A press the sim would refuse is a press thrown away. Reading our OWN switch lock is fair —
  // it is on our own HUD (H27a).
  if (tick < self.switchLockUntilTick) return hold;

  const targetHpFraction = target.maxHp > 0 ? target.hp / target.maxHp : 1;
  const targetStunned = hasStatus(target.statuses, "stunned", tick);

  // R20: the gate is a FRACTION of what this shooter's own kit can best achieve at its own aim
  // quality, never an absolute EV number — an absolute threshold cannot compare across kits whose
  // ceilings differ by a factor of four (see `minShotValueFraction`'s doc comment for the measured
  // per-chassis numbers this replaced). `bestAchievableValueOf` is memoised, so this costs nothing
  // beyond the first call for this (carId, sigma) pair.
  const minValue = profile.minShotValueFraction
    * bestAchievableValueOf(self.carId, profile.aimErrorSigmaRad);

  let best: number | undefined;
  let bestScore = -Infinity;

  for (let i = 0; i < self.slots.length; i++) {
    const slot = self.slots[i]!;
    if (!slotIsReady(slot, tick)) {
      // Not ready: fired, or still mid-recharge. The episode that memo belonged to is over — the
      // next time this slot is ready is a fresh one, and earns its own roll (H30).
      ultHold.delete(i);
      continue;
    }

    const def = weaponDefOf(slot.weaponId);

    let windowBonus = 1;
    if (isUlt(slot)) {
      const goodMoment =
        targetHpFraction <= profile.ultWindowHpFraction ||
        targetStunned ||
        args.situation === "punish";
      if (goodMoment) {
        // The moment turning good resolves the episode by firing (the whole point of holding), so
        // there is no held decision left to carry forward (H30).
        ultHold.delete(i);
        // And the ult has to be able to WIN the ranking, or "saves it for a stunned target" is
        // unobservable: every ult on this roster is worth less per second than the slot beside it
        // (lance ~10.8/s against predator's 30/s), so raw value would pick the small gun forever
        // and discipline would only ever read as "never fires the ult".
        windowBonus = ULT_WINDOW_BONUS;
      } else {
        // Discipline is the probability of HOLDING when the moment is not good (H30) — rolled ONCE
        // per (target, ready) episode and held from there, not re-rolled every recompute.
        const memo = ultHold.get(i);
        const holding = memo && memo.targetSessionId === target.sessionId
          ? memo.holding
          : ultRoll < profile.ultDisciplineChance;
        if (!memo || memo.targetSessionId !== target.sessionId) {
          ultHold.set(i, { targetSessionId: target.sessionId, holding });
        }
        if (holding) continue;
      }
    }

    // Rank on the solver's expected-value-per-second, gated on `minValue` (P14, R20): a shot not
    // worth taking never enters the ranking at all, ult window bonus included or not (H29's old
    // marginal-range discipline check is gone — a marginal shot is just a shot the solver scores low).
    const solution = solutions.get(i);
    if (!solution || solution.value < minValue) continue;
    let score = solution.value * Math.max(weights[i] ?? 1, 0.01) * windowBonus;
    const situation = args.situation;
    const roles = args.roles;
    if (situation === "punish" && roles?.setupCcSlot === i && targetStunned) score -= 500;
    if (args.stuckSlot === i) score += 200;
    if (self.lockTargetSessionId === target.sessionId && def.usesAimAssist) score += 50;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return { slot: best };
}
