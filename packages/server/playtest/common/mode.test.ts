import { DEFAULT_GAME_MODE, GameMode } from "@motor-combat-moba/shared";
import { describe, expect, it } from "vitest";
import { FAMILY_OF, PLAYTEST_MODE_ENV, parseScope, resolvePlaytestMode } from "./mode.js";

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

  it("ignores a sibling --scope flag rather than treating it as unrecognised", () => {
    expect(resolvePlaytestMode(["--mode=deathmatch", "--scope=common"], NO_ENV)).toBe(
      GameMode.FFA_DEATHMATCH,
    );
  });
});

describe("FAMILY_OF (Task 14)", () => {
  it("has every GameMode", () => {
    for (const value of Object.values(GameMode).filter(
      (v): v is number => typeof v === "number",
    )) {
      expect(FAMILY_OF[value as GameMode]).toBeDefined();
    }
  });

  it("maps brawl and team to the shared last-standing family", () => {
    expect(FAMILY_OF[GameMode.FFA_LAST_STANDING]).toBe("last-standing");
    expect(FAMILY_OF[GameMode.TEAM]).toBe("last-standing");
  });

  it("maps deathmatch and conquer to their own families", () => {
    expect(FAMILY_OF[GameMode.FFA_DEATHMATCH]).toBe("deathmatch");
    expect(FAMILY_OF[GameMode.CONQUER]).toBe("conquer");
  });
});

describe("parseScope (Task 14)", () => {
  it("defaults to 'all' with no flag", () => {
    expect(parseScope([])).toBe("all");
  });

  it("takes --scope=common, --scope=mode and --scope=all", () => {
    expect(parseScope(["--scope=common"])).toBe("common");
    expect(parseScope(["--scope=mode"])).toBe("mode");
    expect(parseScope(["--scope=all"])).toBe("all");
  });

  it("ignores a sibling --mode flag", () => {
    expect(parseScope(["--mode=2", "--scope=mode"])).toBe("mode");
  });

  it("throws naming the valid values for an unknown scope", () => {
    expect(() => parseScope(["--scope=bogus"])).toThrow(/common, mode, all/);
  });

  it("throws on a bare --scope with no value", () => {
    expect(() => parseScope(["--scope"])).toThrow(/requires a value/);
  });
});
