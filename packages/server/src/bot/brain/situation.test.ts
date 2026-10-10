import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, TICK_RATE_HZ, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { RESOLVED_BOT_PROFILES } from "../../config/bot-profiles.js";
import { ALL_SITUATIONS, classifySituation, isIncomingCar, newSituationState, pickSituation, type SituationInputs } from "./situation.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const calm: SituationInputs = {
  selfControlLost: false, hittable: true, evade: false, pinned: false, punish: false, reset: false,
  kitDry: false, inRamRange: false, inOwnReach: true,
};

describe("classifySituation (BB15)", () => {
  it("orders the plays", () => {
    expect(classifySituation({ ...calm, selfControlLost: true, evade: true })).toBe("recover");
    expect(classifySituation({ ...calm, evade: true, pinned: true })).toBe("evade");
    expect(classifySituation({ ...calm, pinned: true, punish: true })).toBe("unpin");
    expect(classifySituation({ ...calm, hittable: false })).toBe("waitOut");
    expect(classifySituation({ ...calm, punish: true, reset: true })).toBe("punish");
    expect(classifySituation({ ...calm, reset: true, kitDry: true, inRamRange: true })).toBe("reset");
    expect(classifySituation({ ...calm, kitDry: true, inRamRange: true })).toBe("ram");
    expect(classifySituation(calm)).toBe("fight");
    expect(classifySituation({ ...calm, inOwnReach: false })).toBe("close");
  });
  it("un-pins and dodges even with nobody to shoot (BB15)", () => {
    expect(classifySituation({ ...calm, hittable: false, pinned: true })).toBe("unpin");
    expect(classifySituation({ ...calm, hittable: false, evade: true })).toBe("evade");
  });
  it("rams only on a dry kit inside ram range (BB21)", () => {
    expect(classifySituation({ ...calm, kitDry: true })).toBe("fight");
    expect(classifySituation({ ...calm, kitDry: true, inRamRange: true, inOwnReach: false })).toBe("ram");
  });
  it("lists every situation once, in priority order", () => {
    expect(ALL_SITUATIONS).toEqual(["recover", "evade", "unpin", "waitOut", "punish", "reset", "ram", "fight", "close"]);
  });
});

describe("pickSituation (BB16)", () => {
  const hard = RESOLVED_BOT_PROFILES.hard;
  it("a higher-priority play cuts in at once, a lower one waits out the commit", () => {
    let s = newSituationState();
    s = pickSituation(s, "fight", 0, hard);
    s = pickSituation(s, "ram", 1, hard);
    expect(s.current).toBe("ram");
    s = pickSituation(s, "fight", 2, hard);
    expect(s.current).toBe("ram");
    s = pickSituation(s, "fight", 1 + hard.situationCommitTicks, hard);
    expect(s.current).toBe("fight");
  });
});

describe("isIncomingCar (BB20)", () => {
  const hard = RESOLVED_BOT_PROFILES.hard;
  const car = (vx: number) => ({ sessionId: "t", carId: "mirage" as const, team: 1 as const, x: 300, y: 0, angle: Math.PI, vx, vy: 0, hp: 1, maxHp: 1, alive: true, phased: false, statuses: [], maneuver: 0 });
  it("is true for a car closing fast and false for one driving away", () => {
    expect(isIncomingCar({ x: 0, y: 0 }, car(-400), hard)).toBe(true);
    expect(isIncomingCar({ x: 0, y: 0 }, car(400), hard)).toBe(false);
  });
  it("is false for a car closing too slowly to arrive inside the horizon", () => {
    // 300 u out, contact at 150: 150 u to cover at 100 u/s is 1.5 s, past hard's 0.8 s horizon.
    expect(hard.dodgeHorizonTicks / TICK_RATE_HZ).toBeLessThan(1.5);
    expect(isIncomingCar({ x: 0, y: 0 }, car(-100), hard)).toBe(false);
  });
});
