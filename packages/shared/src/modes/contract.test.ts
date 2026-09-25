// GM26 (Task 9): one contract every mode's `ModeRules` must satisfy, run once per row in
// `MODE_TABLE` rather than once per mode family — a new mode fails this the moment it is added to
// the registry, before anything else notices.
import { describe, expect, it } from "vitest";
import { MODE_TABLE } from "./registry.js";
import { MODE_RULES, rulesOf } from "./rules-registry.js";

const allModes = Object.keys(MODE_TABLE).map(Number);

describe.each(allModes)("mode %i contract (shared)", (mode) => {
  const def = MODE_TABLE[mode as keyof typeof MODE_TABLE];

  it("rulesOf(m) is MODE_RULES[m]", () => {
    expect(rulesOf(mode)).toBe(MODE_RULES[mode as keyof typeof MODE_RULES]);
  });

  // Observed contract, not a law (GM26): every shipped mode's `hasMatchClock` agrees with its
  // `respawns` today (last-standing: neither; deathmatch/conquer: both). If a future mode ever needs
  // them to differ — a timed match with no respawns, or a respawning match with no clock — split this
  // single assertion into two independent ones rather than deleting it outright.
  it("hasMatchClock === respawns (observed, not a law — see comment above)", () => {
    expect(rulesOf(mode).hasMatchClock).toBe(rulesOf(mode).respawns);
  });

  it("canStart refuses zero ready players", () => {
    const result = rulesOf(mode).canStart(def.config, []);
    expect(result.ok).toBe(false);
  });

  it("claimsChassis returns a boolean", () => {
    expect(typeof rulesOf(mode).claimsChassis(def.config)).toBe("boolean");
  });

  it("the mode's bundle arenas are non-empty", () => {
    expect(def.config.arenas.length).toBeGreaterThan(0);
  });
});
