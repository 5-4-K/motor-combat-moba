import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { MODE_TABLE } from "./registry.js";
import { modeLabelOf, modeOptions, modeSlug, parseModeArg } from "./mode-arg.js";

describe("parseModeArg (MC41)", () => {
  it("accepts the numeric wire id", () => {
    expect(parseModeArg("0")).toBe(GameMode.FFA_LAST_STANDING);
    expect(parseModeArg("1")).toBe(GameMode.TEAM);
    expect(parseModeArg("2")).toBe(GameMode.FFA_DEATHMATCH);
  });

  it("accepts the display name, whatever the casing or separator", () => {
    expect(parseModeArg("Brawl")).toBe(GameMode.FFA_LAST_STANDING);
    expect(parseModeArg("deathmatch")).toBe(GameMode.FFA_DEATHMATCH);
    expect(parseModeArg("DEATHMATCH")).toBe(GameMode.FFA_DEATHMATCH);
    expect(parseModeArg("Team brawl")).toBe(GameMode.TEAM);
    expect(parseModeArg("team-brawl")).toBe(GameMode.TEAM);
    expect(parseModeArg("  team_brawl  ")).toBe(GameMode.TEAM);
  });

  it("accepts an INACTIVE mode — measuring one before it is published is the point", () => {
    // Not a restatement of the case above: this is the DECISION, written down. `isActive` is the
    // lobby's publish gate, and a harness that refused an unpublished mode would leave exactly the
    // mode nobody has numbers for unmeasurable.
    expect(MODE_TABLE[GameMode.TEAM].isActive).toBe(false);
    expect(parseModeArg("1")).toBe(GameMode.TEAM);
  });

  it("throws on an unknown mode rather than falling back to a default, naming the ones that exist", () => {
    // The whole failure this phase exists to remove: a typo that silently measures another mode.
    expect(() => parseModeArg("ffa")).toThrow(/unknown mode "ffa"/);
    expect(() => parseModeArg("ffa")).toThrow(/0\/brawl/);
    expect(() => parseModeArg("ffa")).toThrow(/2\/deathmatch/);
    expect(() => parseModeArg("7")).toThrow(/not a known game mode/);
    expect(() => parseModeArg("")).toThrow(/unknown mode/);
  });

  it("prefers the wire id over a name, so an id can never be shadowed", () => {
    expect(parseModeArg("2")).toBe(GameMode.FFA_DEATHMATCH);
  });
});

describe("modeSlug / modeLabelOf / modeOptions", () => {
  it("slugs a display name into something a directory can carry", () => {
    expect(modeSlug(GameMode.FFA_LAST_STANDING)).toBe("brawl");
    expect(modeSlug(GameMode.TEAM)).toBe("team-brawl");
    expect(modeSlug(GameMode.FFA_DEATHMATCH)).toBe("deathmatch");
  });

  it("round-trips: every slug it prints is a spelling the flag accepts", () => {
    for (const key of Object.keys(MODE_TABLE)) {
      const mode = Number(key) as GameMode;
      expect(parseModeArg(modeSlug(mode))).toBe(mode);
    }
  });

  it("labels a mode with its name and wire id, and marks an unpublished one", () => {
    expect(modeLabelOf(GameMode.FFA_DEATHMATCH)).toBe("Deathmatch (mode 2)");
    expect(modeLabelOf(GameMode.FFA_LAST_STANDING)).toBe("Brawl (mode 0)");
    expect(modeLabelOf(GameMode.TEAM)).toBe("Team brawl (mode 1, inactive)");
  });

  it("lists every mode in wire-id order", () => {
    expect(modeOptions()).toBe("0/brawl, 1/team-brawl (inactive), 2/deathmatch");
  });
});
