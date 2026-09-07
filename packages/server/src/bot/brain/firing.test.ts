import { describe, expect, it } from "vitest";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView, BotSlotView } from "../types.js";
import {
  chooseSlot, isUlt, preferredRangeOf, slotIsReady, type UltHoldEntry,
} from "./firing.js";
import type { FiringSolution } from "./solution.js";

/**
 * Build a mocked solutions map for `chooseSlot`, keyed by slot index -> raw solver `value`. Every
 * unit test in this file mocks the solver rather than calling `solve` for real — `chooseSlot`'s job
 * is the ranking and the gate, not the physics march, and `solution.test.ts` is what pins `solve`
 * itself against the real sim. `hitChance`/`expectedDamage` are filled in only so the shape is a
 * valid `FiringSolution`; nothing in `chooseSlot` reads them.
 */
function solutionsFor(entries: [number, number][]): Map<number, FiringSolution> {
  return new Map(entries.map(([slot, value]) => [slot, {
    hitChance: value > 0 ? 0.8 : 0, expectedDamage: value, value,
    aimHeadingRad: 0, readyInTicks: 0,
  }]));
}

function slotsFor(carId: "bullseye" | "mirage" | "bastion"): BotSlotView[] {
  return slotsOf(carId).map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  }));
}

function self(carId: "bullseye" | "mirage" | "bastion"): BotSelfView {
  return {
    sessionId: "me", carId, team: 0, x: 0, y: 0, angle: 0, speed: 0,
    hp: 100, maxHp: 100, alive: true, statuses: [], slots: slotsFor(carId),
    switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
  };
}

const target: BotCarView = {
  sessionId: "them", carId: "mirage", team: 0, x: 300, y: 0, angle: 0, speed: 0,
  hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
};

const ones = [1, 1, 1];

describe("preferredRangeOf", () => {
  it("never asks to fight further away than the bot can perceive", () => {
    const range = preferredRangeOf(self("bullseye"), BOT_PROFILES.hard, ones, 0);
    expect(range).toBeLessThanOrEqual(BOT_PROFILES.hard.awarenessRadiusUnits);
  });

  it("never collapses below the close-quarters floor", () => {
    const range = preferredRangeOf({ ...self("bastion"), slots: [] }, BOT_PROFILES.easy, [], 0);
    expect(range).toBe(70);
  });

  it("holds a longer range for a more disciplined tier", () => {
    expect(preferredRangeOf(self("mirage"), BOT_PROFILES.hard, ones, 0))
      .toBeGreaterThan(preferredRangeOf(self("mirage"), BOT_PROFILES.easy, ones, 0));
  });

  it("every tier can perceive further than the close-quarters floor", () => {
    // `preferredRangeOf`'s only route BELOW `minEngageUnits` is its `Math.min` against
    // `awarenessRadiusUnits` — `bestRange` starts at the floor and only moves outward. The function
    // dropped its explicit lower clamp when R-D5 rewrote it (R-D5's minor 4), which is safe only
    // while this holds of every tier. Pinned here rather than re-clamped there so a tier row that
    // ever broke it fails naming the tier, instead of being silently absorbed by a `Math.max`.
    for (const tier of ["easy", "medium", "hard"] as const) {
      expect(BOT_PROFILES[tier].awarenessRadiusUnits, tier)
        .toBeGreaterThan(BRAIN_CONSTANTS.minEngageUnits);
    }
  });

  it("takes the plateau's FAR edge, not its near one (P31, R-D2)", () => {
    // The whole of what P31 buys rests on this. `proxyValue` is monotonically NON-INCREASING in
    // distance for every row in `WEAPON_TABLE` — flat while hit chance is saturated at 1, then
    // falling — so the maximum is a plateau whose NEAR edge is always `minEngageUnits`. Keeping the
    // first sample to beat a running best would return 70 for every chassis at every tier and the
    // solver-derived range would be a no-op with an expensive loop in front of it. Bullseye at hard
    // is the loudest case: 470 units, nearly seven times the floor.
    expect(preferredRangeOf(self("bullseye"), BOT_PROFILES.hard, ones, 0)).toBeGreaterThan(300);
  });

  it("lets a slot preference read, so `slotWeights` actually reach the standoff (R-D5)", () => {
    // THE ASSERTION WHOSE DELETION HID THE DEFECT. Task 4 removed "weights the fallback the same way
    // as the ready path, so a slot preference still reads" in the same change that made it
    // impossible: under an EXACT-tie plateau rule the answer is
    // `min over ready slots of min(reach, cliff)` regardless of `weights`, because strictly positive
    // multipliers cancel out of "every term ties its own maximum". `rollPersonality`'s `slotWeights`
    // moved nothing at all, and nothing failed.
    //
    // Mirage at hard is the cell that reads it, and it reads it in the direction the mechanism
    // predicts. Its slots are magmablast (400 u), thunderclap (400 u), afterburner (220 u).
    // Weighting the long pair holds the total above `preferredRangePlateauFraction` past
    // afterburner's cliff, so the bot stands off; weighting afterburner instead makes that cliff a
    // big enough share of the peak to pull the total under the bar there, and it stands close.
    // Both vectors are inside `rollPersonality`'s own 0.5-1.5 draw.
    const longGunHeavy = preferredRangeOf(self("mirage"), BOT_PROFILES.hard, [1.5, 1.5, 0.5], 0);
    const afterburnerHeavy = preferredRangeOf(self("mirage"), BOT_PROFILES.hard, [0.5, 0.5, 1.5], 0);
    expect(longGunHeavy).not.toBe(afterburnerHeavy);
    expect(longGunHeavy).toBeGreaterThan(afterburnerHeavy);
  });

  it("lets a slot preference read in exactly ONE cell of nine, and pins that (R-D5 pushback)", () => {
    // The claim "`slotWeights` reach the standoff" is true and much narrower than it reads, and the
    // narrowness is what a tuner needs. Sweeping `rollPersonality`'s own 0.5-1.5 draw over all
    // three chassis at all three tiers, exactly one cell returns more than one standoff.
    //
    // THIS TEST IS ALLOWED TO FAIL ON AN IMPROVEMENT. If a roster change, a new chassis or a
    // `proxyValue` correction moves the count either way, the right response is to update this
    // number AND the two prose claims that quote it (`preferredRangeOf`'s doc comment, and
    // `docs/bot-behavior.md`'s "one chassis-by-tier cell of nine"). Pinning it is what stops those
    // two drifting silently, which is how the general-sounding claim got written in the first place.
    // Known: restoring `proxyValue`'s pulse count takes this to 0 — see the accepted-loss note on
    // `proxyValue` in `solution.ts`.
    const grid = [0.5, 0.75, 1, 1.25, 1.5];
    const live: string[] = [];
    for (const carId of ["bullseye", "mirage", "bastion"] as const) {
      for (const tier of ["easy", "medium", "hard"] as const) {
        const seen = new Set<number>();
        for (const a of grid) for (const b of grid) for (const c of grid) {
          seen.add(preferredRangeOf(self(carId), BOT_PROFILES[tier], [a, b, c], 0));
        }
        if (seen.size > 1) live.push(`${carId}/${tier}`);
      }
    }
    expect(live).toEqual(["mirage/hard"]);
  });

  it("gives different chassis different distances, because their kits differ (P31)", () => {
    // Not a per-tier fudge factor on one shared formula any more: at the SAME tier and the same
    // slot weights, Bullseye's long kit wants a longer stand-off than Bastion's short one.
    const bullseye = preferredRangeOf(self("bullseye"), BOT_PROFILES.hard, ones, 0);
    const bastion = preferredRangeOf(self("bastion"), BOT_PROFILES.hard, ones, 0);
    expect(bullseye).toBeGreaterThan(bastion);
  });

  it("falls back to the whole kit when NOTHING is ready, not to the far edge of awareness (R-D4)", () => {
    // Every slot spent AND locked — the real shape of the moment between a bot spending its last
    // loaded slot and the first one coming back.
    //
    // WITHOUT THE FALLBACK the readiness filter removes every slot, every sampled range totals 0,
    // all of them tie, and the outward tie-break — correct and load-bearing when the samples mean
    // something — carries `bestRange` to the far end of the kit's reach, capped only by
    // `awarenessRadiusUnits`. Measured before the fix (2026-09-07): a hard Bullseye stood at 900,
    // its whole awareness radius, against the 470 it stands at when loaded. That is a degenerate
    // tie deciding a position rather than a decision, which is why R-D4 restores the explicit
    // fallback the deleted `effectiveRangeOf` carried for the mirror-image reason.
    //
    // Sweeps all three chassis at all three tiers, because the defect's size varies with which
    // cap binds: Bullseye's awareness cap bound at every tier, Mirage's and Bastion's did not.
    for (const carId of ["bullseye", "mirage", "bastion"] as const) {
      for (const tier of ["easy", "medium", "hard"] as const) {
        const loaded = self(carId);
        const spent = {
          ...loaded,
          slots: loaded.slots.map((slot) => ({ ...slot, stocks: 0, refireLockUntilTick: 500 })),
        };
        // The kit's authored reach is what a not-ready bot evaluates, so it gets the SAME plateau
        // it would get with everything loaded — the range is a property of the kit, not of the
        // cooldown clocks.
        expect(
          preferredRangeOf(spent, BOT_PROFILES[tier], ones, 0),
          `${carId}/${tier} while reloading`,
        ).toBe(preferredRangeOf(loaded, BOT_PROFILES[tier], ones, 0));
      }
    }

    // And it is strictly nearer than the far edge the degenerate tie used to hand back, which is
    // the behaviour change the ruling is about.
    const bullseye = self("bullseye");
    const spent = {
      ...bullseye,
      slots: bullseye.slots.map((slot) => ({ ...slot, stocks: 0, refireLockUntilTick: 500 })),
    };
    expect(preferredRangeOf(spent, BOT_PROFILES.hard, ones, 0))
      .toBeLessThan(BOT_PROFILES.hard.awarenessRadiusUnits);
  });
});

describe("isUlt", () => {
  it("counts a long cooldown and not a short one", () => {
    const [predator, pepperbox, lance] = slotsFor("bullseye");
    expect(isUlt(predator!)).toBe(false);
    expect(isUlt(pepperbox!)).toBe(false);
    expect(isUlt(lance!)).toBe(true);
  });
});

describe("slotIsReady", () => {
  it("wants a stock and both locks expired", () => {
    const [slot] = slotsFor("bullseye");
    expect(slotIsReady(slot!, 0)).toBe(true);
    expect(slotIsReady({ ...slot!, stocks: 0 }, 0)).toBe(false);
    expect(slotIsReady({ ...slot!, refireLockUntilTick: 10 }, 0)).toBe(false);
  });
});

describe("chooseSlot", () => {
  const base = {
    target, weights: ones, tick: 0, lastPressTick: -999,
  };

  it("presses nothing before burstGapTicks has elapsed", () => {
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard,
      tick: 1, lastPressTick: 0, rng: makeRng(1), ultHold: new Map(),
      solutions: solutionsFor([[0, 40], [1, 35], [2, 30]]),
    });
    expect(out.slot).toBeUndefined();
  });

  it("returns exactly one slot, never a mask (H27)", () => {
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard, rng: makeRng(1),
      ultHold: new Map(), solutions: solutionsFor([[0, 40], [1, 35]]),
    });
    expect(out.slot === undefined || Number.isInteger(out.slot)).toBe(true);
  });

  /**
   * Only the ult is available. This is the honest way to ask the discipline question: every ult on
   * this roster is worth less per second than the slot beside it, so with a full kit the ranking
   * picks the small gun and BOTH tiers would score zero ult presses — a test that passes while
   * measuring nothing.
   */
  function ultOnly(carId: "bullseye"): BotSelfView {
    const base = self(carId);
    return {
      ...base,
      slots: base.slots.map((slot, i) => (i === 2 ? slot : { ...slot, stocks: 0 })),
    };
  }

  it("a disciplined bot holds its ult against a full-hp target (H30)", () => {
    // A fresh `ultHold` per seed, deliberately: each iteration is its OWN single-shot episode (a
    // bot seeing this exact bad moment for the first time), not 40 recomputes of one continuous
    // engagement — that continuous-engagement question belongs to the persisted-episode test below.
    // Solution value (30) clears hard's real gate (`minShotValueFraction` 0.3 x Bullseye's kit
    // ceiling ~78.3 = ~23.5) on its own, so a press here can only be explained by discipline, not by
    // the EV gate rejecting the shot outright.
    let ultPresses = 0;
    for (let seed = 0; seed < 40; seed++) {
      const out = chooseSlot({
        ...base, self: ultOnly("bullseye"), profile: BOT_PROFILES.hard,
        rng: makeRng(seed), ultHold: new Map(),
        solutions: solutionsFor([[2, 30]]),
      });
      if (out.slot === 2) ultPresses++;
    }
    expect(ultPresses).toBeLessThan(16); // ~10% at ultDisciplineChance 0.9, with seed slack
  });

  it("an undisciplined bot burns its ult against a full-hp target (H30)", () => {
    // Solution value (10) clears easy's real gate (`minShotValueFraction` 0.01 x Bullseye's kit
    // ceiling ~75 = ~0.75), so nothing but the discipline roll can hold this back.
    let ultPresses = 0;
    for (let seed = 0; seed < 40; seed++) {
      const out = chooseSlot({
        ...base, self: ultOnly("bullseye"), profile: BOT_PROFILES.easy,
        rng: makeRng(seed), ultHold: new Map(),
        solutions: solutionsFor([[2, 10]]),
      });
      if (out.slot === 2) ultPresses++;
    }
    expect(ultPresses).toBe(40); // ultDisciplineChance 0 never holds
  });

  /**
   * The defect the review caught: rerolling `ultRoll` every recompute makes even a 90%-disciplined
   * hard bot's hold decay geometrically toward a certainty of firing (0.9^n keeps falling with every
   * extra evaluation — over a real fight's worth of recomputes it is indistinguishable from zero).
   * The fix is a memo that survives across calls for as long as the (target, ready) episode does, so
   * a genuinely long engagement — many more evaluations than the 40 single-shot draws above — must
   * still show hard holding throughout, not just "less likely to have slipped yet".
   */
  it("holds the SAME decision across an entire engagement, not a fresh roll each recompute (H30)", () => {
    // `rng` is ONE persistent stream across the whole loop, matching production (a bot's `Rng` lives
    // for the room's lifetime) — a fresh `makeRng(seed)` per tick would replay the same draw at the
    // same position every tick, which is a different bug this file does not want to reintroduce.
    const ultHold = new Map<number, UltHoldEntry>();
    const persistentRng = makeRng(7);
    const solutions = solutionsFor([[2, 30]]);
    let ultPresses = 0;
    for (let tick = 0; tick < 500; tick++) {
      const out = chooseSlot({
        ...base, self: ultOnly("bullseye"), profile: BOT_PROFILES.hard,
        tick, lastPressTick: -999, rng: persistentRng, ultHold, solutions,
      });
      if (out.slot === 2) ultPresses++;
    }
    expect(ultPresses).toBe(0);
    // Reverting to a per-tick reroll (a brand-new `Map()` handed in on every iteration instead of
    // the one shared above, so every tick looks like a fresh episode) makes this fail — confirmed.
    const rerolledRng = makeRng(7);
    let rerolledPresses = 0;
    for (let tick = 0; tick < 500; tick++) {
      const out = chooseSlot({
        ...base, self: ultOnly("bullseye"), profile: BOT_PROFILES.hard,
        tick, lastPressTick: -999, rng: rerolledRng, ultHold: new Map(), solutions,
      });
      if (out.slot === 2) rerolledPresses++;
    }
    expect(rerolledPresses).toBeGreaterThan(0);
  });

  it("a good window lets the ult win the ranking against a better-value slot (H30)", () => {
    // Full kit, target nearly dead: predator's raw value (35) outranks lance's (30) outright, and
    // the ult must STILL win once the good-window bonus applies (30 * ULT_WINDOW_BONUS(4) = 120 >
    // 35) — otherwise "saves it for a wounded target" could never produce a press. Both values clear
    // hard's real gate (~23.5) unboosted, so the gate itself is not what decides this case; only
    // the ranking is under test. Pepperbox (20) sits below the threshold on purpose, to confirm a
    // gated-out slot cannot still win by default.
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard,
      target: { ...target, hp: 5 }, rng: makeRng(1), ultHold: new Map(),
      solutions: solutionsFor([[0, 35], [1, 20], [2, 30]]),
    });
    expect(out.slot).toBe(2);
  });

  it("respects the switch lock rather than throwing a press away (H27a)", () => {
    const locked = { ...self("bullseye"), switchLockUntilTick: 50 };
    const out = chooseSlot({
      ...base, self: locked, profile: BOT_PROFILES.hard, tick: 10, rng: makeRng(1),
      ultHold: new Map(), solutions: solutionsFor([[0, 40]]),
    });
    // Slot 0 is what a fresh `lastFiredSlot` of -1 would refuse; nothing may be pressed under lock.
    expect(out.slot).toBeUndefined();
  });

  it("will press a range-0 weapon at contact range (H28)", () => {
    // Bastion with only `wildcharge` in hand. Its two other slots out-rank it on value, so leaving
    // them loaded would test the ranking rather than the range-0 gate this case is about.
    const bastion = self("bastion");
    const chargeOnly: BotSelfView = {
      ...bastion,
      slots: bastion.slots.map((slot, i) => (i === 2 ? slot : { ...slot, stocks: 0 })),
    };
    const out = chooseSlot({
      ...base, self: chargeOnly, profile: BOT_PROFILES.easy,
      target: { ...target, x: 100, hp: 10 }, rng: makeRng(1), ultHold: new Map(),
      solutions: solutionsFor([[2, 20]]),
    });
    expect(out.slot).toBe(2);
  });

  it("will NOT press a range-0 weapon from well beyond contact range (H28)", () => {
    // Mirrors what `solve` itself returns beyond a slot's reach: a present entry with `value: 0`,
    // which the EV gate refuses exactly like a missing solution would.
    const bastion = self("bastion");
    const chargeOnly: BotSelfView = {
      ...bastion,
      slots: bastion.slots.map((slot, i) => (i === 2 ? slot : { ...slot, stocks: 0 })),
    };
    const out = chooseSlot({
      ...base, self: chargeOnly, profile: BOT_PROFILES.easy,
      rng: makeRng(1), ultHold: new Map(),
      solutions: solutionsFor([[2, 0]]),
    });
    expect(out.slot).toBeUndefined();
  });

  it("fires an aim-assisted gun without a HUD lock (S20)", () => {
    const predatorOnly: BotSelfView = {
      ...self("bullseye"),
      lockTargetSessionId: "",
      slots: slotsFor("bullseye").map((slot, i) => (i === 0 ? slot : { ...slot, stocks: 0 })),
    };
    const out = chooseSlot({
      ...base, self: predatorOnly, profile: BOT_PROFILES.hard, rng: makeRng(1),
      ultHold: new Map(), solutions: solutionsFor([[0, 40]]),
    });
    expect(out.slot).toBe(0);
  });

  it("an undisciplined bot still mashes an aim-assisted gun without a lock", () => {
    const predatorOnly: BotSelfView = {
      ...self("bullseye"),
      lockTargetSessionId: "",
      slots: slotsFor("bullseye").map((slot, i) => (i === 0 ? slot : { ...slot, stocks: 0 })),
    };
    let presses = 0;
    for (let seed = 0; seed < 40; seed++) {
      const out = chooseSlot({
        ...base, self: predatorOnly, profile: BOT_PROFILES.easy, rng: makeRng(seed),
        ultHold: new Map(), solutions: solutionsFor([[0, 10]]),
      });
      if (out.slot === 0) presses++;
    }
    expect(presses).toBeGreaterThan(20);
  });
});

describe("chooseSlot — expected value gate (P14, R20)", () => {
  it("holds fire when nothing clears minShotValueFraction", () => {
    // 0.3 x Bullseye's kit ceiling (~78.3, `bestAchievableValueOf`) is ~23.5 — well above all three
    // mocked values.
    const decision = chooseSlot({
      self: self("bullseye"), target, profile: { ...BOT_PROFILES.hard, minShotValueFraction: 0.3 },
      weights: ones, tick: 100, lastPressTick: 0, rng: makeRng(1),
      ultHold: new Map<number, UltHoldEntry>(),
      solutions: solutionsFor([[0, 5], [1, 3], [2, 1]]),
    });
    expect(decision.slot).toBeUndefined();
  });

  it("presses the highest-value slot that clears it", () => {
    const decision = chooseSlot({
      self: self("bullseye"), target, profile: { ...BOT_PROFILES.hard, minShotValueFraction: 0.3 },
      weights: ones, tick: 100, lastPressTick: 0, rng: makeRng(1),
      ultHold: new Map<number, UltHoldEntry>(),
      solutions: solutionsFor([[0, 30], [1, 45], [2, 1]]),
    });
    expect(decision.slot).toBe(1);
  });

  it("an amateur threshold takes a shot a skilled one declines (P37)", () => {
    // Bullseye's kit ceiling at easy's aim sigma is ~75. 0.05 x 75 = ~3.75 (below the mocked 6, so
    // it clears); 0.3 x 75 = ~22.5 (above the mocked 6, so it does not).
    const solutions = solutionsFor([[0, 6], [1, 0], [2, 0]]);
    const at = (minShotValueFraction: number) => chooseSlot({
      self: self("bullseye"), target, profile: { ...BOT_PROFILES.easy, minShotValueFraction },
      weights: ones, tick: 100, lastPressTick: 0, rng: makeRng(1),
      ultHold: new Map<number, UltHoldEntry>(), solutions,
    }).slot;
    expect(at(0.05)).toBe(0);
    expect(at(0.3)).toBeUndefined();
  });
});
