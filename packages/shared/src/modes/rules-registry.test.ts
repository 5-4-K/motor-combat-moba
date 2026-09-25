import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, MODE_TABLE } from "./registry.js";
import { MODE_RULES, rulesOf } from "./rules-registry.js";

describe("rulesOf", () => {
  it("has an entry for every GameMode in MODE_TABLE", () => {
    expect(Object.keys(MODE_RULES).sort()).toEqual(Object.keys(MODE_TABLE).sort());
  });
  it("falls back to the default mode's rules for an unknown wire byte, never throws", () => {
    expect(rulesOf(250)).toBe(MODE_RULES[DEFAULT_GAME_MODE]);
    expect(rulesOf(-1)).toBe(MODE_RULES[DEFAULT_GAME_MODE]);
  });
});
