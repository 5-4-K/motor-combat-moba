import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { attributeSource, buildApplierMap } from "./attribution.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));
// Also installed directly, synchronously, at module scope: fixture constants below (and
// some describe bodies) read config during test COLLECTION, which happens once, before any
// beforeEach hook ever fires.
installMode(modeConfigOf(DEFAULT_GAME_MODE));

describe("buildApplierMap (B5a)", () => {
  it("finds corroded's applier inside magmablast's explosion", () => {
    expect(buildApplierMap().get("corroded")).toEqual(["magmablast"]);
  });

  it("lists every weapon that applies a status shared by more than one", () => {
    // `stunned` comes from roadblock, thunderclap and wildcharge's wall slam.
    expect((buildApplierMap().get("stunned") ?? []).length).toBeGreaterThan(1);
  });

  it("ignores self-targeted applications, which damage nobody", () => {
    // `fortified` is target: "self" — it must never make wildcharge the applier of someone's pulse.
    expect(buildApplierMap().get("fortified") ?? []).not.toContain("wildcharge");
  });
});

describe("attributeSource", () => {
  const appliers = buildApplierMap();

  it("passes a weapon source straight through", () => {
    expect(attributeSource({ kind: "weapon", weaponId: "predator", pressId: "x", isExplosion: false }, appliers))
      .toEqual({ weaponId: "predator", derived: false });
  });

  it("credits a corroded pulse to magmablast, and says the credit was derived", () => {
    expect(attributeSource({ kind: "pulse", statusId: "corroded", sourceSessionId: "p1" }, appliers))
      .toEqual({ weaponId: "magmablast", derived: true });
  });

  it("refuses to guess when two weapons apply the same status", () => {
    expect(attributeSource({ kind: "pulse", statusId: "stunned", sourceSessionId: "p1" }, appliers))
      .toEqual({ weaponId: null, derived: false });
  });

  it("names no weapon for a hazard, which belongs to the arena rather than to a kit (AS19)", () => {
    // The kill and the damage still reach the headline totals — `stats.ts` counts `totalKills`
    // before it asks for an attribution — this only keeps a wall out of a per-weapon row.
    expect(attributeSource({ kind: "hazard", hazardId: "spike" }, appliers))
      .toEqual({ weaponId: null, derived: false });
  });
});
