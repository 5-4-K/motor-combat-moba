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
  it("returns undefined with no candidates", () => {
    expect(chooseTarget({ self, candidates: [], perception: newPerception(), profile: hard, tick: 0, heldTargetId: undefined, heldSinceTick: 0 })).toBeUndefined();
  });
});
