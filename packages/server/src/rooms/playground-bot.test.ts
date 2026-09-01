import { describe, expect, it } from "vitest";
import { BOT_CONFIG, botInput, type BotPose } from "./playground-bot.js";

describe("botInput", () => {
  it("fires all masked slots at a target dead ahead and in range", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 100, y: 0, angle: 0 };
    const result = botInput(1, self, target, [120, 120, 120]);
    expect(result).toEqual({ seq: 1, steer: 0, throttle: 1, fireSlots: 0b111 });
  });

  it("turns toward a target behind it and holds fire", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: -100, y: 0, angle: 0 };
    const result = botInput(2, self, target, [60, 60, 60]);
    expect(result.steer).not.toBe(0);
    expect(result.fireSlots).toBe(0);
  });

  it("backs off when inside the standoff distance", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 50, y: 0, angle: 0 };
    const result = botInput(3, self, target, [60]);
    expect(result.throttle).toBe(-1);
  });

  it("coasts with a null target — everything zero", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const result = botInput(4, self, null, [60, 60, 60]);
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
    const result = botInput(5, self, target, []);
    expect(result.steer).toBe(1);
  });

  it("only fires slots whose range covers the target, inside the fire cone", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    const target: BotPose = { x: 50, y: 0, angle: 0 };
    const result = botInput(6, self, target, [40, 60, 40]);
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
    const result = botInput(7, self, target, [60]);
    expect(result.fireSlots).toBe(0);
  });

  it("BOT_CONFIG carries the documented constants and is frozen", () => {
    expect(BOT_CONFIG).toEqual({
      aimToleranceRad: 0.3,
      standoffUnits: 70,
      fireConeRad: 0.35,
    });
    expect(Object.isFrozen(BOT_CONFIG)).toBe(true);
  });
});
