import { DEFAULT_GAME_MODE, GameMode } from "@motor-combat-moba/shared";
import { describe, expect, it } from "vitest";
import { PLAYTEST_MODE_ENV, resolvePlaytestMode } from "./mode.js";

const NO_ENV: NodeJS.ProcessEnv = {};

describe("resolvePlaytestMode (MC41)", () => {
  it("defaults to DEFAULT_GAME_MODE with no flag and no env", () => {
    expect(resolvePlaytestMode([], NO_ENV)).toBe(DEFAULT_GAME_MODE);
  });

  it("takes --mode by wire id or by name", () => {
    expect(resolvePlaytestMode(["--mode=2"], NO_ENV)).toBe(GameMode.FFA_DEATHMATCH);
    expect(resolvePlaytestMode(["--mode=deathmatch"], NO_ENV)).toBe(GameMode.FFA_DEATHMATCH);
    expect(resolvePlaytestMode(["--mode=Brawl"], NO_ENV)).toBe(GameMode.FFA_LAST_STANDING);
  });

  it("reads the env var run-all passes down to each spawned probe", () => {
    expect(resolvePlaytestMode([], { [PLAYTEST_MODE_ENV]: "deathmatch" })).toBe(
      GameMode.FFA_DEATHMATCH,
    );
  });

  it("lets an explicit --mode beat the inherited env var", () => {
    expect(resolvePlaytestMode(["--mode=0"], { [PLAYTEST_MODE_ENV]: "deathmatch" })).toBe(
      GameMode.FFA_LAST_STANDING,
    );
  });

  it("refuses an unknown mode instead of measuring the default", () => {
    expect(() => resolvePlaytestMode(["--mode=deathmatchh"], NO_ENV)).toThrow(/unknown mode/);
    expect(() => resolvePlaytestMode([], { [PLAYTEST_MODE_ENV]: "9" })).toThrow(
      /not a known game mode/,
    );
  });

  it("refuses a typo'd flag and a bare --mode rather than ignoring them", () => {
    // `--mdoe=2` silently ignored would run six probes against the default bundle and write a
    // report with nothing on it saying the flag never landed.
    expect(() => resolvePlaytestMode(["--mdoe=2"], NO_ENV)).toThrow(/unrecognised argument/);
    expect(() => resolvePlaytestMode(["--mode"], NO_ENV)).toThrow(/requires a value/);
  });
});
