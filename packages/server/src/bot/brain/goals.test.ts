import { describe, expect, it } from "vitest";
import { hasStatus } from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView } from "../types.js";
import { newPerception, type PerceptionState } from "./perception.js";
import { rolesOf } from "./roles.js";
import { newGoalState, pickGoal, scoreGoals, scoreTargets } from "./goals.js";
import type { KitRoles } from "./roles.js";

const self: BotSelfView = {
  sessionId: "me", carId: "bullseye", team: 0, x: 0, y: 0, angle: 0, speed: 0,
  hp: 65, maxHp: 65, alive: true, statuses: [], slots: [],
  switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
};

function car(sessionId: string, over: Partial<BotCarView> = {}): BotCarView {
  return {
    sessionId, carId: "mirage", team: 0, x: 300, y: 0, angle: 0, speed: 0,
    hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
    ...over,
  };
}

function blaming(sessionId: string, tick: number): PerceptionState {
  const state = newPerception();
  state.blameTick.set(sessionId, tick);
  return state;
}

const emptyRoles: KitRoles = rolesOf([]);

const base = {
  self, target: car("them"), distance: 300, preferredRange: 400,
  tick: 100, roles: emptyRoles, hasReadyContactWeapon: false, wantsRam: false,
  pinnedOnWall: false, targetNearWall: false, ultSpent: false,
};

function bestOf(scores: Record<string, number>): string {
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]![0];
}

describe("scoreTargets", () => {
  const targetBase = {
    self, perception: newPerception(), tick: 100, heldTargetId: undefined, heldSinceTick: 0,
  };

  it("skips dead and phased cars", () => {
    const out = scoreTargets({
      ...targetBase,
      candidates: [car("dead", { alive: false }), car("ghost", { phased: true })],
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBeUndefined();
  });

  it("a high-woundedBias tier picks the wounded car (H32)", () => {
    const out = scoreTargets({
      ...targetBase,
      candidates: [car("hurt", { hp: 8, x: 250 }), car("full", { hp: 70, x: 200 })],
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBe("hurt");
  });

  it("a high-vengefulness tier picks whoever last shot at it (H33)", () => {
    const out = scoreTargets({
      ...targetBase,
      perception: blaming("shooter", 100),
      candidates: [car("hurt", { hp: 8, x: 250 }), car("shooter", { hp: 70, x: 490 })],
      profile: BOT_PROFILES.easy, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBe("shooter");
  });
});

describe("scoreGoals", () => {
  it("recovers when control is lost", () => {
    const scores = scoreGoals({
      ...base, self: { ...self, alive: false }, profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(bestOf(scores)).toBe("recover");
  });

  it("hunts when there is no target", () => {
    const scores = scoreGoals({
      ...base, target: undefined, profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(bestOf(scores)).toBe("huntLastKnown");
  });

  it("easy rushes a visible target (G11)", () => {
    const scores = scoreGoals({ ...base, profile: BOT_PROFILES.easy, rng: makeRng(1) });
    expect(bestOf(scores)).toBe("rush");
  });

  it("hard sets up CC when a stun slot is ready and the target is not stunned", () => {
    const roles = rolesOf([{
      weaponId: "roadblock", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0, range: 500,
    }]);
    const withSlot: BotSelfView = {
      ...self, carId: "bastion",
      slots: [{ weaponId: "roadblock", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0, range: 500 }],
    };
    const scores = scoreGoals({
      ...base, self: withSlot, roles, profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(bestOf(scores)).toBe("setupCc");
  });

  it("hard dumps once the target is stunned", () => {
    const roles = rolesOf([{
      weaponId: "roadblock", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0, range: 500,
    }]);
    const withSlot: BotSelfView = {
      ...self, carId: "bastion",
      slots: [{ weaponId: "roadblock", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0, range: 500 }],
    };
    const stunned = car("them", {
      statuses: [{ statusId: "stunned", startTick: 0, endsTick: 999, sourceSessionId: "me" }],
    });
    expect(hasStatus(stunned.statuses, "stunned", 100)).toBe(true);
    const scores = scoreGoals({
      ...base, self: withSlot, target: stunned, roles,
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(bestOf(scores)).toBe("dump");
  });

  it("keeps dump as a small base until a dump condition is true", () => {
    const scores = scoreGoals({ ...base, profile: BOT_PROFILES.hard, rng: makeRng(1) });
    expect(scores.dump).toBeLessThan(scores.holdRange);
    expect(bestOf(scores)).not.toBe("dump");
  });

  it("unpins harder than it contacts when it is the one on the wall", () => {
    const scores = scoreGoals({
      ...base, hasReadyContactWeapon: true, pinnedOnWall: true,
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(bestOf(scores)).toBe("unpin");
    expect(scores.unpin).toBeGreaterThan(scores.contact);
  });

  it("wants contact when a maneuver is ready (H36)", () => {
    const scores = scoreGoals({
      ...base, hasReadyContactWeapon: true, distance: 140,
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(scores.contact).toBeGreaterThan(scores.holdRange);
  });

  it("hard resets when badly hurt (H37)", () => {
    const scores = scoreGoals({
      ...base, self: { ...self, hp: 10 }, profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(scores.reset).toBeGreaterThan(scores.holdRange);
  });

  it("never resets at retreatHpFraction 0, however hurt (H37)", () => {
    const scores = scoreGoals({
      ...base, self: { ...self, hp: 1 }, distance: 300, preferredRange: 200,
      profile: BOT_PROFILES.easy, rng: makeRng(1),
    });
    expect(bestOf(scores)).toBe("rush");
    expect(scores.reset).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("pickGoal", () => {
  const scores = {
    recover: -Infinity, huntLastKnown: -Infinity, rush: 1, holdRange: 0, intercept: 0,
    setupCc: -Infinity, dump: 0, contact: -Infinity, reset: 5, pinWall: -Infinity, unpin: -Infinity,
  } as const;

  it("holds the current goal inside the commitment window (G7)", () => {
    const state = { current: "rush" as const, sinceTick: 100 };
    const next = pickGoal(state, { ...scores }, 105, BOT_PROFILES.hard, undefined);
    expect(next.current).toBe("rush");
  });

  it("rescores once the window has elapsed", () => {
    const state = { current: "rush" as const, sinceTick: 100 };
    const next = pickGoal(state, { ...scores }, 130, BOT_PROFILES.hard, undefined);
    expect(next.current).toBe("reset");
  });

  it("a pre-emption cuts the window short (G7)", () => {
    const state = { current: "rush" as const, sinceTick: 100 };
    const next = pickGoal(state, { ...scores }, 101, BOT_PROFILES.hard, "reset");
    expect(next.current).toBe("reset");
    expect(next.sinceTick).toBe(101);
  });

  it("starts from huntLastKnown", () => {
    expect(newGoalState().current).toBe("huntLastKnown");
  });
});
