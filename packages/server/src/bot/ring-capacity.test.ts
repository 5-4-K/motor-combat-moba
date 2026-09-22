import { describe, expect, it } from "vitest";
import { GameMode } from "@motor-combat-moba/shared";
import { botConfigOf } from "../config/mode-bot.js";
import { botRingCapacity } from "./view-ring.js";

describe("botRingCapacity", () => {
  const botConfig = botConfigOf(GameMode.FFA_LAST_STANDING);

  it("covers the deepest staleness any tier asks for, plus one", () => {
    const deepest = Math.max(...Object.values(botConfig.profiles).map((p) => p.viewStalenessTicks));
    expect(botRingCapacity(botConfig)).toBe(deepest + 1);
  });

  it("is at least 2, so a ring is never degenerate", () => {
    expect(botRingCapacity(botConfig)).toBeGreaterThanOrEqual(2);
  });
});
