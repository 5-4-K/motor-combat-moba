import { describe, expect, it } from "vitest";
import { attributeSource, buildApplierMap } from "./attribution.js";

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
});
