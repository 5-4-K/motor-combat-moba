import { describe, expect, it } from "vitest";
import { GameMode } from "@motor-combat-moba/shared";
import { botConfigOf, MODE_BOT_CONFIG } from "./mode-bot.js";

describe("MODE_BOT_CONFIG", () => {
  it("carries a row for every game mode", () => {
    for (const mode of Object.values(GameMode).filter((v) => typeof v === "number")) {
      expect(botConfigOf(mode as GameMode)).toBeTruthy();
    }
  });

  it("seeds every mode identically for now (spec N2)", () => {
    const first = botConfigOf(GameMode.FFA_LAST_STANDING);
    for (const row of Object.values(MODE_BOT_CONFIG)) {
      expect(row.profiles).toEqual(first.profiles);
      expect(row.brainVersion).toEqual(first.brainVersion);
      expect(row.brainConstants).toEqual(first.brainConstants);
    }
  });

  it("throws on an unknown mode, mirroring modeConfigOf", () => {
    expect(() => botConfigOf(99 as GameMode)).toThrow();
  });
});
