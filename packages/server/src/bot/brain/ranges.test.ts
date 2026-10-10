import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, applyOverrides, fireSlotsOf, installMode, modeConfigOf, weaponDefOf, withMode, type WeaponId } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS, RESOLVED_BOT_PROFILES } from "../../config/bot-profiles.js";
import type { BotSlotView } from "../types.js";
import { carrierOf, effectiveReachOf, fightRangeOf, ownComfortOf, slotIsReady, usableSlots } from "./ranges.js";
import { kitReachOf, weaponReachOf } from "./reach.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));
installMode(modeConfigOf(DEFAULT_GAME_MODE));

function slot(weaponId: WeaponId, over: Partial<BotSlotView> = {}): BotSlotView {
  return { weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0, range: weaponDefOf(weaponId).range, ...over };
}

describe("effectiveReachOf (BB42)", () => {
  it("never exceeds the weapon's reach and never drops below minEngageUnits", () => {
    for (const id of ["predator", "lance", "magmablast", "thumper"] as WeaponId[]) {
      const r = effectiveReachOf(id, 0.035, 0.7);
      expect(r).toBeLessThanOrEqual(weaponReachOf(id));
      expect(r).toBeGreaterThanOrEqual(BRAIN_CONSTANTS.minEngageUnits);
    }
  });

  it("shrinks as the hands get worse or the bar rises", () => {
    expect(effectiveReachOf("predator", 0.18, 0.7)).toBeLessThan(effectiveReachOf("predator", 0.035, 0.7));
    expect(effectiveReachOf("predator", 0.035, 0.9)).toBeLessThanOrEqual(effectiveReachOf("predator", 0.035, 0.3));
  });

  it("pins the measured hard values (sigma 0.035, bar 0.7)", () => {
    // Measured from the solver on the 13-sample grid (minEngageUnits..reach in 12 steps), shooter
    // mid-arena: a number moves only when a weapon row, a node weight or the grid does.
    expect(effectiveReachOf("predator", 0.035, 0.7)).toBeCloseTo(646.67, 1);
    expect(effectiveReachOf("thumper", 0.035, 0.7)).toBeCloseTo(816.67, 1);
    expect(effectiveReachOf("magmablast", 0.035, 0.7)).toBeCloseTo(900, 1);
  });

  it("gives a held beam its full reach (lance regression: a shooter on the bounds edge clipped it to nothing)", () => {
    expect(effectiveReachOf("lance", 0.035, 0.7)).toBeGreaterThanOrEqual(900);
  });

  it("is keyed on the active bundle, not just (weapon, sigma, bar)", () => {
    const stock = effectiveReachOf("predator", 0.035, 0.7);
    expect(stock).toBeGreaterThan(300);
    installMode(applyOverrides(modeConfigOf(DEFAULT_GAME_MODE), { "weapon.predator.range": 300 }));
    expect(effectiveReachOf("predator", 0.035, 0.7)).toBeLessThanOrEqual(300);
    installMode(modeConfigOf(DEFAULT_GAME_MODE));
    expect(effectiveReachOf("predator", 0.035, 0.7)).toBe(stock);
  });

  it("is the full reach when only the exact aim has to land", () => {
    // Bar 0.3 is inside the centre node's weight (0.457): a stationary target straight ahead is hit
    // by the exact aim at any distance inside reach.
    expect(effectiveReachOf("predator", 0.18, 0.3)).toBe(weaponReachOf("predator"));
  });
});

describe("ownComfortOf (BB43)", () => {
  const hard = RESOLVED_BOT_PROFILES.hard;
  const basic = slot("predator"); // index 0 stands in for the (disabled) basic attack
  it("stands at the shortest READY gun's effective reach", () => {
    const kit = [basic, slot("predator"), slot("pepperbox"), slot("lance")];
    const shortest = Math.min(...kit.slice(1).map((s) => effectiveReachOf(s.weaponId, hard.aimErrorSigmaRad, hard.hitChanceBar)));
    expect(ownComfortOf(kit, hard, 0)).toBeCloseTo(Math.max(BRAIN_CONSTANTS.minEngageUnits, shortest * BRAIN_CONSTANTS.comfortFraction), 6);
  });
  it("is the engage floor for an empty kit", () => {
    expect(ownComfortOf([], hard, 0)).toBe(BRAIN_CONSTANTS.minEngageUnits);
  });
  it("ignores a slot that is not ready soon", () => {
    const far = 10_000;
    const kit = [basic, slot("predator"), slot("pepperbox", { stocks: 0, rechargeEndsTick: far }), slot("lance", { stocks: 0, rechargeEndsTick: far })];
    const predator = effectiveReachOf("predator", hard.aimErrorSigmaRad, hard.hitChanceBar);
    expect(ownComfortOf(kit, hard, 0)).toBeCloseTo(Math.max(BRAIN_CONSTANTS.minEngageUnits, predator * BRAIN_CONSTANTS.comfortFraction), 6);
  });
  it("stands off at the kit's longest reach while nothing is ready soon", () => {
    const far = 10_000;
    const kit = [basic, slot("predator", { stocks: 0, rechargeEndsTick: far }), slot("lance", { stocks: 0, rechargeEndsTick: far })];
    const longest = Math.max(...kit.slice(1).map((s) => effectiveReachOf(s.weaponId, hard.aimErrorSigmaRad, hard.hitChanceBar)));
    expect(ownComfortOf(kit, hard, 0)).toBeCloseTo(longest * BRAIN_CONSTANTS.comfortFraction, 6);
  });
});

describe("fightRangeOf (BB44)", () => {
  it("is the larger of own comfort and the opponent's keep-out", () => {
    const hard = RESOLVED_BOT_PROFILES.hard;
    const target = { sessionId: "t", carId: "mirage" as const, team: 1 as const, x: 0, y: 0, angle: 0, vx: 0, vy: 0, hp: 1, maxHp: 1, alive: true, phased: false, statuses: [], maneuver: 0 };
    expect(fightRangeOf(10, target, [], hard)).toBe(kitReachOf("mirage", []).shortest * hard.opponentRangeRespect);
    expect(fightRangeOf(5000, target, [], hard)).toBe(5000);
    expect(fightRangeOf(10, undefined, [], hard)).toBe(10);
  });
});

describe("usableSlots / slotIsReady", () => {
  it("skips the disabled basic-attack slot and reports readiness", () => {
    const kit = [slot("predator"), slot("pepperbox", { refireLockUntilTick: 50 })];
    expect(usableSlots(kit).map((u) => u.index)).toEqual([1]); // index 0 is the basic attack, off in every mode
    expect(slotIsReady(kit[1]!, 10)).toBe(false);
    expect(slotIsReady(kit[1]!, 50)).toBe(true);
  });
  it("includes slot 0 when a bundle turns the basic attack on", () => {
    const kit = fireSlotsOf("bullseye").map((id) => slot(id));
    const on = applyOverrides(modeConfigOf(DEFAULT_GAME_MODE), { "slots.basicAttackEnabled": true });
    expect(withMode(on, () => usableSlots(kit).map((u) => u.index))).toEqual([0, 1, 2, 3]);
    expect(usableSlots(kit).map((u) => u.index)).toEqual([1, 2, 3]);
  });
});

describe("carrierOf (L1)", () => {
  it("names the one chassis and fire slot that carries a weapon", () => {
    expect(carrierOf("lance")).toEqual({ carId: "bullseye", slotIndex: fireSlotsOf("bullseye").indexOf("lance") });
  });
  it("throws for a weapon no chassis carries", () => {
    expect(() => carrierOf("no-such-weapon" as WeaponId)).toThrow(/no chassis carries no-such-weapon/);
  });
});
