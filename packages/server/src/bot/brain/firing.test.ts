import { describe, expect, it } from "vitest";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView, BotSlotView } from "../types.js";
import {
  chooseSlot, effectiveRangeOf, isUlt, preferredRangeOf, slotIsReady, type UltHoldEntry,
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

describe("effectiveRangeOf", () => {
  it("puts Bullseye further out than Mirage", () => {
    const bullseye = effectiveRangeOf(slotsFor("bullseye"), ones, 0);
    const mirage = effectiveRangeOf(slotsFor("mirage"), ones, 0);
    expect(bullseye).toBeGreaterThan(mirage);
  });

  it("excludes a range-0 row rather than letting it drag the average to nothing", () => {
    const withCharge = effectiveRangeOf(slotsFor("bastion"), ones, 0);
    expect(withCharge).toBeGreaterThan(400);
  });

  it("returns 0 for a car with no slots", () => {
    expect(effectiveRangeOf([], [], 0)).toBe(0);
  });

  it("falls back to the kit as authored when nothing is ready, rather than collapsing to 0", () => {
    // The not-ready fallback runs constantly mid-fight — every tick between a bot spending its last
    // loaded slot and the first one coming back — and until this test nothing exercised it with a
    // non-empty kit, so a bot mid-recharge deciding it wanted to be nose to nose would have shipped
    // silently. Every slot spent AND locked, which is the real shape of that moment.
    const spent = slotsFor("bullseye").map((slot) => ({
      ...slot, stocks: 0, refireLockUntilTick: 500,
    }));
    expect(effectiveRangeOf(spent, ones, 0)).toBe(effectiveRangeOf(slotsFor("bullseye"), ones, 0));
  });

  it("weights the fallback the same way as the ready path, so a slot preference still reads", () => {
    // Not just "non-zero": the fallback re-runs the same value weighting, so a bot that prefers its
    // long-range slot still wants a longer range while it recharges than one that prefers the short
    // one. `predator` (1800) is slot 0 and `pepperbox` (600) is slot 1.
    const spent = slotsFor("bullseye").map((slot) => ({ ...slot, stocks: 0 }));
    const likesLongRange = effectiveRangeOf(spent, [3, 1, 1], 0);
    const likesShortRange = effectiveRangeOf(spent, [1, 3, 1], 0);
    expect(likesLongRange).toBeGreaterThan(likesShortRange);
  });
});

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
    target, distance: 300, weights: ones, tick: 0, lastPressTick: -999,
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
    // Solution value (30) clears hard's `minShotValue` (26) on its own, so a press here can only be
    // explained by discipline, not by the EV gate rejecting the shot outright.
    let ultPresses = 0;
    for (let seed = 0; seed < 40; seed++) {
      const out = chooseSlot({
        ...base, self: ultOnly("bullseye"), profile: BOT_PROFILES.hard,
        distance: 1100, rng: makeRng(seed), ultHold: new Map(),
        solutions: solutionsFor([[2, 30]]),
      });
      if (out.slot === 2) ultPresses++;
    }
    expect(ultPresses).toBeLessThan(16); // ~10% at ultDisciplineChance 0.9, with seed slack
  });

  it("an undisciplined bot burns its ult against a full-hp target (H30)", () => {
    // Solution value (10) clears easy's `minShotValue` (2), so nothing but the discipline roll can
    // hold this back.
    let ultPresses = 0;
    for (let seed = 0; seed < 40; seed++) {
      const out = chooseSlot({
        ...base, self: ultOnly("bullseye"), profile: BOT_PROFILES.easy,
        distance: 1100, rng: makeRng(seed), ultHold: new Map(),
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
        distance: 1100, tick, lastPressTick: -999, rng: persistentRng, ultHold, solutions,
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
        distance: 1100, tick, lastPressTick: -999, rng: rerolledRng, ultHold: new Map(), solutions,
      });
      if (out.slot === 2) rerolledPresses++;
    }
    expect(rerolledPresses).toBeGreaterThan(0);
  });

  it("a good window lets the ult win the ranking against a better-value slot (H30)", () => {
    // Full kit, target nearly dead: predator's raw value (35) outranks lance's (30) outright, and
    // the ult must STILL win once the good-window bonus applies (30 * ULT_WINDOW_BONUS(4) = 120 >
    // 35) — otherwise "saves it for a wounded target" could never produce a press. Both values clear
    // hard's `minShotValue` (26) unboosted, so the gate itself is not what decides this case; only
    // the ranking is under test. Pepperbox (20) sits below the threshold on purpose, to confirm a
    // gated-out slot cannot still win by default.
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard,
      distance: 500, target: { ...target, hp: 5 }, rng: makeRng(1), ultHold: new Map(),
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
      distance: 100, target: { ...target, x: 100, hp: 10 }, rng: makeRng(1), ultHold: new Map(),
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
      distance: 600, rng: makeRng(1), ultHold: new Map(),
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

describe("chooseSlot — expected value gate (P14)", () => {
  it("holds fire when nothing clears minShotValue", () => {
    const decision = chooseSlot({
      self: self("bullseye"), target, distance: 300,
      profile: { ...BOT_PROFILES.hard, minShotValue: 26 },
      weights: ones, tick: 100, lastPressTick: 0, rng: makeRng(1),
      ultHold: new Map<number, UltHoldEntry>(),
      solutions: solutionsFor([[0, 5], [1, 3], [2, 1]]),
    });
    expect(decision.slot).toBeUndefined();
  });

  it("presses the highest-value slot that clears it", () => {
    const decision = chooseSlot({
      self: self("bullseye"), target, distance: 300,
      profile: { ...BOT_PROFILES.hard, minShotValue: 26 },
      weights: ones, tick: 100, lastPressTick: 0, rng: makeRng(1),
      ultHold: new Map<number, UltHoldEntry>(),
      solutions: solutionsFor([[0, 30], [1, 45], [2, 1]]),
    });
    expect(decision.slot).toBe(1);
  });

  it("an amateur threshold takes a shot a skilled one declines (P37)", () => {
    const solutions = solutionsFor([[0, 6], [1, 0], [2, 0]]);
    const at = (minShotValue: number) => chooseSlot({
      self: self("bullseye"), target, distance: 300,
      profile: { ...BOT_PROFILES.easy, minShotValue },
      weights: ones, tick: 100, lastPressTick: 0, rng: makeRng(1),
      ultHold: new Map<number, UltHoldEntry>(), solutions,
    }).slot;
    expect(at(2)).toBe(0);
    expect(at(26)).toBeUndefined();
  });
});
