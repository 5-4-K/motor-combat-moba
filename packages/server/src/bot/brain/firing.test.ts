import { describe, expect, it } from "vitest";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView, BotSlotView } from "../types.js";
import { chooseSlot, effectiveRangeOf, isUlt, preferredRangeOf, slotIsReady } from "./firing.js";

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
    target, distance: 300, aimDelta: 0, weights: ones, tick: 0, lastPressTick: -999,
  };

  it("presses nothing while the aim is outside the fire cone", () => {
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard,
      aimDelta: 1.2, rng: makeRng(1),
    });
    expect(out.slot).toBeUndefined();
  });

  it("presses nothing before burstGapTicks has elapsed", () => {
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard,
      tick: 1, lastPressTick: 0, rng: makeRng(1),
    });
    expect(out.slot).toBeUndefined();
  });

  it("returns exactly one slot, never a mask (H27)", () => {
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard, rng: makeRng(1),
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
    let ultPresses = 0;
    for (let seed = 0; seed < 40; seed++) {
      const out = chooseSlot({
        ...base, self: ultOnly("bullseye"), profile: BOT_PROFILES.hard,
        distance: 1100, rng: makeRng(seed),
      });
      if (out.slot === 2) ultPresses++;
    }
    expect(ultPresses).toBeLessThan(16); // ~10% at ultDisciplineChance 0.9, with seed slack
  });

  it("an undisciplined bot burns its ult against a full-hp target (H30)", () => {
    let ultPresses = 0;
    for (let seed = 0; seed < 40; seed++) {
      const out = chooseSlot({
        ...base, self: ultOnly("bullseye"), profile: BOT_PROFILES.easy,
        distance: 1100, rng: makeRng(seed),
      });
      if (out.slot === 2) ultPresses++;
    }
    expect(ultPresses).toBe(40); // ultDisciplineChance 0 never holds
  });

  it("a good window lets the ult win the ranking against a better-value slot (H30)", () => {
    // Full kit, target nearly dead: lance is worth far less per second than predator, and must win
    // anyway — otherwise "saves it for a wounded target" could never produce a press.
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard,
      distance: 500, target: { ...target, hp: 5 }, rng: makeRng(1),
    });
    expect(out.slot).toBe(2);
  });

  it("respects the switch lock rather than throwing a press away (H27a)", () => {
    const locked = { ...self("bullseye"), switchLockUntilTick: 50 };
    const out = chooseSlot({
      ...base, self: locked, profile: BOT_PROFILES.hard, tick: 10, rng: makeRng(1),
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
      distance: 100, target: { ...target, x: 100, hp: 10 }, rng: makeRng(1),
    });
    expect(out.slot).toBe(2);
  });

  it("will NOT press a range-0 weapon from well beyond contact range (H28)", () => {
    const bastion = self("bastion");
    const chargeOnly: BotSelfView = {
      ...bastion,
      slots: bastion.slots.map((slot, i) => (i === 2 ? slot : { ...slot, stocks: 0 })),
    };
    const out = chooseSlot({
      ...base, self: chargeOnly, profile: BOT_PROFILES.easy,
      distance: 600, rng: makeRng(1),
    });
    expect(out.slot).toBeUndefined();
  });
});
