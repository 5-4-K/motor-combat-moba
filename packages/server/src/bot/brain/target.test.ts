import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { RESOLVED_BOT_PROFILES } from "../../config/bot-profiles.js";
import type { BotCarView, BotSelfView } from "../types.js";
import { newPerception } from "./perception.js";
import { chooseTarget } from "./target.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const self: BotSelfView = { sessionId: "me", carId: "bullseye", team: 0, x: 0, y: 0, angle: 0, vx: 0, vy: 0, hp: 65, maxHp: 65, alive: true, statuses: [], slots: [], switchLockUntilTick: 0, maneuver: 0, maneuverTicksLeft: 0 };
const car = (sessionId: string, x: number, hp = 70): BotCarView => ({ sessionId, carId: "mirage", team: 0, x, y: 0, angle: 0, vx: 0, vy: 0, hp, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0 });
const hard = RESOLVED_BOT_PROFILES.hard;

describe("chooseTarget (BB46)", () => {
  it("picks the nearest when nothing else distinguishes them", () => {
    expect(chooseTarget({ self, candidates: [car("far", 600), car("near", 200)], perception: newPerception(), profile: hard, tick: 0, heldTargetId: undefined, heldSinceTick: 0 })).toBe("near");
  });
  it("hard prefers the wounded car", () => {
    expect(chooseTarget({ self, candidates: [car("near", 200), car("hurt", 300, 10)], perception: newPerception(), profile: hard, tick: 0, heldTargetId: undefined, heldSinceTick: 0 })).toBe("hurt");
  });
  it("sticks to the held target inside its commit window", () => {
    expect(chooseTarget({ self, candidates: [car("a", 300), car("b", 250)], perception: newPerception(), profile: hard, tick: 1, heldTargetId: "a", heldSinceTick: 0 })).toBe("a");
  });
  it("never picks a dead or phased car", () => {
    const dead = { ...car("dead", 100), alive: false };
    const phased = { ...car("phased", 120), phased: true };
    expect(chooseTarget({ self, candidates: [dead, phased, car("alive", 500)], perception: newPerception(), profile: hard, tick: 0, heldTargetId: undefined, heldSinceTick: 0 })).toBe("alive");
    expect(chooseTarget({ self, candidates: [dead, phased], perception: newPerception(), profile: hard, tick: 0, heldTargetId: undefined, heldSinceTick: 0 })).toBeUndefined();
  });
  it("skips a teammate while an enemy is among the candidates (BB18)", () => {
    // The same-team fallback with no enemy at all is carried from 6.x and unreachable in the shipped
    // bot modes (final review M10); this pins the branch that matters while an enemy exists.
    const mate = car("mate", 100);
    const foe = { ...car("foe", 500), team: 1 };
    expect(chooseTarget({ self, candidates: [mate, foe], perception: newPerception(), profile: hard, tick: 0, heldTargetId: undefined, heldSinceTick: 0 })).toBe("foe");
  });
  it("turns on whoever shot at it, more so at a vengeful tier (H33)", () => {
    const easy = RESOLVED_BOT_PROFILES.easy;
    const candidates = [car("near", 100), car("shooter", 300)];
    const blamed = newPerception();
    blamed.blameTick.set("shooter", 50);
    const pick = (perception: ReturnType<typeof newPerception>) =>
      chooseTarget({ self, candidates, perception, profile: easy, tick: 50, heldTargetId: undefined, heldSinceTick: 0 });
    expect(pick(newPerception())).toBe("near");
    expect(pick(blamed)).toBe("shooter");
  });
  it("returns undefined with no candidates", () => {
    expect(chooseTarget({ self, candidates: [], perception: newPerception(), profile: hard, tick: 0, heldTargetId: undefined, heldSinceTick: 0 })).toBeUndefined();
  });
});
