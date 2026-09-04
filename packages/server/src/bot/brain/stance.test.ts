import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView } from "../types.js";
import { newPerception, type PerceptionState } from "./perception.js";
import { newStanceState, pickStance, scoreStances, scoreTargets } from "./stance.js";

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

describe("scoreTargets", () => {
  const base = { self, perception: newPerception(), tick: 100, heldTargetId: undefined, heldSinceTick: 0 };

  it("skips dead and phased cars", () => {
    const out = scoreTargets({
      ...base,
      candidates: [car("dead", { alive: false }), car("ghost", { phased: true })],
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBeUndefined();
  });

  it("a high-woundedBias tier picks the wounded car (H32)", () => {
    const out = scoreTargets({
      ...base,
      candidates: [car("healthy", { x: 200 }), car("hurt", { x: 400, hp: 10 })],
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBe("hurt");
  });

  it("a vengeful tier chases whoever shot at it (H33)", () => {
    const out = scoreTargets({
      ...base,
      perception: blaming("shooter", 98),
      candidates: [car("quiet", { x: 150 }), car("shooter", { x: 480 })],
      profile: BOT_PROFILES.easy, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBe("shooter");
  });

  it("keeps the held target while the commitment window is open", () => {
    const out = scoreTargets({
      ...base,
      candidates: [car("held", { x: 450 }), car("closer", { x: 120 })],
      heldTargetId: "held", heldSinceTick: 95,
      profile: BOT_PROFILES.easy, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBe("held");
  });
});

describe("scoreStances", () => {
  const base = {
    self, target: car("them"), distance: 300, preferredRange: 300, tick: 0,
    hasReadyContactWeapon: false, wantsRam: false, pinnedOnWall: false,
  };

  it("engages when healthy with a target", () => {
    const scores = scoreStances({ ...base, profile: BOT_PROFILES.hard, rng: makeRng(1) });
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]![0];
    expect(best).toBe("engage");
  });

  it("hunts when there is no target", () => {
    const scores = scoreStances({
      ...base, target: undefined, profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]![0];
    expect(best).toBe("hunt");
  });

  it("wants to brawl when a contact weapon is ready (H36)", () => {
    const scores = scoreStances({
      ...base, hasReadyContactWeapon: true, distance: 140,
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(scores.brawl).toBeGreaterThan(scores.engage);
  });

  it("wants to brawl when it has committed to a ram (H40)", () => {
    const scores = scoreStances({
      ...base, wantsRam: true, distance: 140, profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(scores.brawl).toBeGreaterThan(scores.engage);
  });

  it("does not brawl with no contact weapon and no ram intent", () => {
    const scores = scoreStances({ ...base, profile: BOT_PROFILES.hard, rng: makeRng(1) });
    expect(scores.brawl).toBeLessThan(scores.engage);
  });

  it("scores disengage above engage when badly hurt", () => {
    const scores = scoreStances({
      ...base, self: { ...self, hp: 10 }, profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(scores.disengage).toBeGreaterThan(scores.engage);
  });

  it("never disengages at retreatHpFraction 0, however hurt (H37)", () => {
    const scores = scoreStances({
      ...base, self: { ...self, hp: 1 }, profile: BOT_PROFILES.easy, rng: makeRng(1),
    });
    expect(scores.disengage).toBeLessThan(scores.engage);
  });
});

describe("pickStance", () => {
  const scores = {
    engage: 1, brawl: 0, kite: 5, disengage: 0, reposition: 0, hunt: 0, recover: 0,
  } as const;

  it("holds the current stance inside the commitment window (H10)", () => {
    const state = { current: "engage" as const, sinceTick: 100 };
    const next = pickStance(state, { ...scores }, 105, BOT_PROFILES.hard, undefined);
    expect(next.current).toBe("engage");
  });

  it("rescores once the window has elapsed", () => {
    const state = { current: "engage" as const, sinceTick: 100 };
    const next = pickStance(state, { ...scores }, 130, BOT_PROFILES.hard, undefined);
    expect(next.current).toBe("kite");
  });

  it("a pre-emption cuts the window short (H10)", () => {
    const state = { current: "engage" as const, sinceTick: 100 };
    const next = pickStance(state, { ...scores }, 101, BOT_PROFILES.hard, "disengage");
    expect(next.current).toBe("disengage");
    expect(next.sinceTick).toBe(101);
  });

  it("starts from a defined stance", () => {
    expect(newStanceState().current).toBe("hunt");
  });
});
