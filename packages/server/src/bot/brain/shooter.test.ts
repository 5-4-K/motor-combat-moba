import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, fireSlotsOf, installMode, modeConfigOf, weaponDefOf, type ActiveStatus, type CarId } from "@motor-combat-moba/shared";
import { RESOLVED_BOT_PROFILES } from "../../config/bot-profiles.js";
import type { BotCarView, BotSelfView, BotSlotView } from "../types.js";
import { chooseShot, isPressable, setupSlotIndex } from "./shooter.js";
import type { FiringSolution } from "./solution.js";
import { turretRestored } from "./turret-restored.fixture.js";

beforeEach(() => installMode(turretRestored(modeConfigOf(DEFAULT_GAME_MODE))));

function kit(carId: CarId): BotSlotView[] {
  return fireSlotsOf(carId).map((weaponId) => ({ weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0, range: weaponDefOf(weaponId).range }));
}
function selfOf(carId: CarId, slots = kit(carId)): BotSelfView {
  return { sessionId: "me", carId, team: 0, x: 0, y: 0, angle: 0, vx: 0, vy: 0, hp: 65, maxHp: 65, alive: true, statuses: [], slots, switchLockUntilTick: 0, maneuver: 0, maneuverTicksLeft: 0 };
}
const target: BotCarView = { sessionId: "t", carId: "mirage", team: 1, x: 300, y: 0, angle: Math.PI, vx: 0, vy: 0, hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0 };
const sol = (hitChance: number, expectedDamage: number): FiringSolution => ({ hitChance, expectedDamage, value: 0, aimHeadingRad: 0, readyInTicks: 0 });
const hard = RESOLVED_BOT_PROFILES.hard;
const indexOf = (carId: CarId, weaponId: string) => fireSlotsOf(carId).indexOf(weaponId as never);

describe("chooseShot (BB38, BB39)", () => {
  it("presses the pressable slot with the most expected damage, cooldown ignored", () => {
    const lance = indexOf("bullseye", "lance"); // a 16 s weapon; bullseye has no stun setup slot, so the setup rule stays out of this case
    const solutions = new Map(kit("bullseye").map((_, i) => [i, sol(0.9, i === lance ? 40 : 25)] as const).filter(([i]) => i !== 0));
    const out = chooseShot({ self: selfOf("bullseye"), target, profile: hard, tick: 100, lastPressTick: -999, solutions });
    expect(out.slot).toBe(lance);
    expect(out.bestHitChance).toBe(0.9);
  });
  it("never presses a slot under the bar", () => {
    const solutions = new Map([[1, sol(0.5, 40)], [2, sol(0.9, 5)]]);
    expect(chooseShot({ self: selfOf("mirage"), target, profile: hard, tick: 100, lastPressTick: -999, solutions }).slot).toBe(2);
  });
  it("opens with the setup slot, then dumps on a stunned target", () => {
    const self = selfOf("bastion");
    const rb = indexOf("bastion", "roadblock");
    expect(setupSlotIndex(self.slots)).toBe(rb);
    const big = [1, 2, 3].find((i) => i !== rb)!;
    const solutions = new Map([1, 2, 3].map((i) => [i, sol(0.9, i === big ? 30 : 10)] as const));
    expect(chooseShot({ self, target, profile: hard, tick: 100, lastPressTick: -999, solutions }).slot).toBe(rb);
    const stun: ActiveStatus = { statusId: "stunned", startTick: 0, endsTick: 10_000, sourceSessionId: "" };
    const stunned: BotCarView = { ...target, statuses: [stun] };
    expect(chooseShot({ self, target: stunned, profile: hard, tick: 100, lastPressTick: -999, solutions }).slot).toBe(big);
  });
  it("holds inside the burst gap and the switch lock, still reporting wantsNose and bestHitChance", () => {
    const self = selfOf("bullseye");
    const fixed = fixedSlotsOf(self);
    // Fixed muzzles not landing, turrets landing: held fire, nose wanted, the best chance reported.
    const solutions = new Map([1, 2, 3].map((i) => [i, fixed.includes(i) ? sol(0, 0) : sol(0.9, 40)] as const));
    const gapped = chooseShot({ self, target, profile: hard, tick: 100, lastPressTick: 99, solutions });
    expect(gapped).toEqual({ slot: undefined, wantsNose: true, bestHitChance: 0.9 });
    const locked = { ...self, switchLockUntilTick: 200 };
    expect(chooseShot({ self: locked, target, profile: hard, tick: 100, lastPressTick: -999, solutions }))
      .toEqual({ slot: undefined, wantsNose: true, bestHitChance: 0.9 });
  });
  it("skips the disabled basic-attack slot", () => {
    const solutions = new Map([[0, sol(1, 100)], [1, sol(0.9, 40)]]);
    expect(chooseShot({ self: selfOf("mirage"), target, profile: hard, tick: 100, lastPressTick: -999, solutions }).slot).toBe(1);
  });
});

function fixedSlotsOf(self: BotSelfView): number[] {
  return self.slots.map((s, i) => ({ i, turret: weaponDefOf(s.weaponId).turret })).filter(({ i, turret }) => i !== 0 && turret === undefined).map(({ i }) => i);
}

describe("wantsNose (BB47)", () => {
  it("never wants the nose for a turret slot, landing or not", () => {
    const self = selfOf("bullseye");
    const fixed = fixedSlotsOf(self);
    const turrets = [1, 2, 3].filter((i) => !fixed.includes(i));
    expect(turrets.length).toBeGreaterThan(0);
    // Every fixed slot spent; the turret slots ready and missing.
    const slots = self.slots.map((s, i) => (fixed.includes(i) ? { ...s, stocks: 0, rechargeEndsTick: 10_000 } : s));
    const missing = new Map(turrets.map((i) => [i, sol(0, 0)] as const));
    expect(chooseShot({ self: selfOf("bullseye", slots), target, profile: hard, tick: 100, lastPressTick: -999, solutions: missing }).wantsNose).toBe(false);
  });
  it("never wants the nose for a fixed slot whose reach falls short of the target", () => {
    const self = selfOf("bullseye");
    const fixed = fixedSlotsOf(self);
    const far = { ...target, x: 5000 };
    expect(Math.max(...fixed.map((i) => self.slots[i]!.range))).toBeLessThan(5000);
    const missing = new Map([1, 2, 3].map((i) => [i, sol(0, 0)] as const));
    expect(chooseShot({ self, target: far, profile: hard, tick: 100, lastPressTick: -999, solutions: missing }).wantsNose).toBe(false);
  });
  it("is true when a ready fixed-muzzle slot in reach is not landing, false when only turret slots are up", () => {
    const self = selfOf("bullseye");
    const fixed = self.slots.map((s, i) => ({ i, turret: weaponDefOf(s.weaponId).turret })).filter(({ i, turret }) => i !== 0 && turret === undefined).map(({ i }) => i);
    expect(fixed.length).toBeGreaterThan(0);
    const off = new Map([1, 2, 3].map((i) => [i, fixed.includes(i) ? sol(0, 0) : sol(0.9, 20)] as const));
    expect(chooseShot({ self, target, profile: hard, tick: 100, lastPressTick: -999, solutions: off }).wantsNose).toBe(true);
    const slots = self.slots.map((s, i) => (fixed.includes(i) ? { ...s, stocks: 0, rechargeEndsTick: 10_000 } : s));
    expect(chooseShot({ self: selfOf("bullseye", slots), target, profile: hard, tick: 100, lastPressTick: -999, solutions: off }).wantsNose).toBe(false);
  });
});

describe("isPressable", () => {
  it("needs a solution over the bar with damage", () => {
    expect(isPressable(undefined, 0.5)).toBe(false);
    expect(isPressable(sol(0.5, 0), 0.5)).toBe(false);
    expect(isPressable(sol(0.5, 1), 0.5)).toBe(true);
  });
});
