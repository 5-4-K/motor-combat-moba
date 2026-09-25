// GM26 (Task 9): one contract every mode's `ModeHud` must satisfy, run once per row in `MODE_TABLE`.
import { beforeEach, describe, expect, it } from "vitest";
import { ArenaState, MODE_TABLE, installMode } from "@motor-combat-moba/shared";
import { hudOf } from "./registry.js";

const allModes = Object.keys(MODE_TABLE).map(Number);

describe.each(allModes)("mode %i contract (client)", (mode) => {
  const def = MODE_TABLE[mode as keyof typeof MODE_TABLE];

  // Client tests use `installMode` (per-process, no restore), same as every other client mode test
  // (`modes/registry.test.ts`) — a tab installs exactly one bundle and lets it persist. Vitest
  // isolates each test FILE in its own module context by default, so this file's installed bundle
  // never leaks into another file's tests.
  beforeEach(() => installMode(def.config));

  it("lobbyCard() has non-empty kicker, body and meta", () => {
    const card = hudOf(mode).lobbyCard();
    expect(card.kicker.length).toBeGreaterThan(0);
    expect(card.body.length).toBeGreaterThan(0);
    expect(card.meta.length).toBeGreaterThan(0);
  });

  it("clockLabel returns a string", () => {
    const state = new ArenaState();
    state.mode = mode;
    state.matchEndsTick = 0;
    expect(typeof hudOf(mode).clockLabel(state, 0)).toBe("string");
  });

  it("showsKills is boolean", () => {
    expect(typeof hudOf(mode).showsKills).toBe("boolean");
  });
});
