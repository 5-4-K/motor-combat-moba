import { describe, expect, it } from "vitest";
import { BOT_PROFILES, botInput, type BotPose, type BotProfile } from "./playground-bot.js";

const HARD: BotProfile = BOT_PROFILES.hard;

describe("botInput", () => {
  it("fires all masked slots at a target dead ahead and in range", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 100, y: 0, angle: 0 };
    const result = botInput(1, self, target, [120, 120, 120], HARD);
    expect(result).toEqual({ seq: 1, steer: 0, throttle: 1, fireSlots: 0b111 });
  });

  it("turns toward a target behind it and holds fire", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: -100, y: 0, angle: 0 };
    const result = botInput(2, self, target, [60, 60, 60], HARD);
    expect(result.steer).not.toBe(0);
    expect(result.fireSlots).toBe(0);
  });

  it("backs off when inside the standoff distance", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 50, y: 0, angle: 0 };
    const result = botInput(3, self, target, [60], HARD);
    expect(result.throttle).toBe(-1);
  });

  it("coasts with a null target — everything zero", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const result = botInput(4, self, null, [60, 60, 60], HARD);
    expect(result).toEqual({ seq: 4, steer: 0, throttle: 0, fireSlots: 0 });
  });

  it("steers the short way across the +-pi seam", () => {
    // self.angle is just under +pi; the target sits just across the seam on the negative side,
    // 0.5 rad away the short way (turn positive/right), not ~5.78 rad the long way around.
    const selfAngle = Math.PI - 0.14;
    const bearing = selfAngle + 0.5 - 2 * Math.PI;
    const self: BotPose = { x: 0, y: 0, angle: selfAngle };
    const target: BotPose = {
      x: 100 * Math.cos(bearing),
      y: 100 * Math.sin(bearing),
      angle: 0,
    };
    const result = botInput(5, self, target, [], HARD);
    expect(result.steer).toBe(1);
  });

  it("only fires slots whose range covers the target, inside the fire cone", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 50, y: 0, angle: 0 };
    const result = botInput(6, self, target, [40, 60, 40], HARD);
    expect(result.fireSlots).toBe(0b010);
  });

  it("holds fire outside the fire cone even with a slot in range", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    // Just outside fireConeRad (0.35) but inside aimToleranceRad-derived steer deadzone territory.
    const bearing = 0.4;
    const target: BotPose = {
      x: 50 * Math.cos(bearing),
      y: 50 * Math.sin(bearing),
      angle: 0,
    };
    const result = botInput(7, self, target, [60], HARD);
    expect(result.fireSlots).toBe(0);
  });
});

describe("BOT_PROFILES (PG27)", () => {
  it("is frozen, table and rows alike", () => {
    expect(Object.isFrozen(BOT_PROFILES)).toBe(true);
    for (const profile of Object.values(BOT_PROFILES)) expect(Object.isFrozen(profile)).toBe(true);
  });

  it("hard is EXACTLY the bot that shipped — the whole point of the difficulty split", () => {
    // These six numbers are the pre-split `BOT_CONFIG` plus `PlaygroundRoom`'s own
    // `OPPONENT_FIRE_PERIOD`. Pinned by value, not by comment: "the current one should be hard" has
    // to stay true through every later retune of easy and medium.
    expect(BOT_PROFILES.hard).toEqual({
      standoffUnits: 70,
      deadbandUnits: 0,
      reactionTicks: 1,
      aimToleranceRad: 0.3,
      fireConeRad: 0.35,
      firePeriodTicks: 2,
    });
  });

  it("keeps aimToleranceRad below fireConeRad on every profile", () => {
    // The tolerance is the deadzone the bot STOPS STEERING inside; the cone is the gate it must be
    // inside TO FIRE. A profile with tolerance >= cone lets the bot settle at a heading it is happy
    // with but can never shoot from — an easy bot that never fires.
    for (const [name, profile] of Object.entries(BOT_PROFILES)) {
      expect(profile.aimToleranceRad, name).toBeLessThan(profile.fireConeRad);
    }
  });

  it("orders the pressure knobs monotonically from easy to hard", () => {
    const { easy, medium, hard } = BOT_PROFILES;
    expect(easy.standoffUnits).toBeGreaterThan(medium.standoffUnits);
    expect(medium.standoffUnits).toBeGreaterThan(hard.standoffUnits);
    expect(easy.deadbandUnits).toBeGreaterThan(medium.deadbandUnits);
    expect(medium.deadbandUnits).toBeGreaterThan(hard.deadbandUnits);
    expect(easy.reactionTicks).toBeGreaterThan(medium.reactionTicks);
    expect(medium.reactionTicks).toBeGreaterThan(hard.reactionTicks);
    expect(easy.firePeriodTicks).toBeGreaterThan(medium.firePeriodTicks);
    expect(medium.firePeriodTicks).toBeGreaterThan(hard.firePeriodTicks);
  });
});

describe("botInput — the coast deadband (PG28)", () => {
  it("coasts inside the deadband where hard would charge or reverse", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    // 150 units out: inside easy's 170 +- 60 band ([110, 230]), outside medium's 110 +- 30 band
    // ([80, 140]). (The brief's own draft used 130 here, which is inside BOTH bands — 130 <= 140 —
    // so it could never have told easy and medium apart; 150 is the corrected distance.)
    const target: BotPose = { x: 150, y: 0, angle: 0 };
    expect(botInput(1, self, target, [60], BOT_PROFILES.easy).throttle).toBe(0);
    expect(botInput(1, self, target, [60], BOT_PROFILES.medium).throttle).toBe(1);
  });

  it("still closes when well outside the band, and backs off when well inside it", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    expect(botInput(2, self, { x: 400, y: 0, angle: 0 }, [60], BOT_PROFILES.easy).throttle).toBe(1);
    expect(botInput(3, self, { x: 20, y: 0, angle: 0 }, [60], BOT_PROFILES.easy).throttle).toBe(-1);
  });

  it("collapses to the old charge-or-reverse expression at deadbandUnits 0", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    // Exactly at hard's standoff: the old code's `distance > standoff ? 1 : -1` reverses here, and
    // a zero-width band must not turn that into a coast.
    expect(botInput(4, self, { x: 70, y: 0, angle: 0 }, [60], HARD).throttle).toBe(-1);
    expect(botInput(5, self, { x: 71, y: 0, angle: 0 }, [60], HARD).throttle).toBe(1);
  });
});
