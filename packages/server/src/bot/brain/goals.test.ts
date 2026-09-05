import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView } from "../types.js";
import { newPerception, type PerceptionState } from "./perception.js";
import { scoreTargets } from "./goals.js";

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
