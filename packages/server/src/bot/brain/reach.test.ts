import { describe, expect, it } from "vitest";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import { kitReachOf, weaponReachOf } from "./reach.js";

describe("weaponReachOf", () => {
  it("uses aimRangeUnits for an aim-assisted gun, not authored flight range", () => {
    const def = weaponDefOf("predator");
    expect(def.aimRangeUnits).toBeDefined();
    expect(weaponReachOf("predator")).toBe(def.aimRangeUnits);
    expect(weaponReachOf("predator")).toBeLessThan(def.range);
  });

  it("uses authored range when there is no aim assist", () => {
    expect(weaponReachOf("pepperbox")).toBe(weaponDefOf("pepperbox").range);
  });

  it("uses contactTriggerUnits for a range-0 charge", () => {
    expect(weaponDefOf("wildcharge").range).toBe(0);
    expect(weaponReachOf("wildcharge")).toBe(BRAIN_CONSTANTS.contactTriggerUnits);
  });
});

describe("kitReachOf", () => {
  it("takes Bullseye's shortest gun as pepperbox, not predator's flight range", () => {
    const kit = kitReachOf("bullseye");
    expect(kit.shortest).toBe(weaponReachOf("pepperbox"));
    expect(kit.longest).toBeGreaterThanOrEqual(weaponReachOf("predator"));
    expect(slotsOf("bullseye")).toContain("predator");
  });

  it("unions extra observed weapons into the kit", () => {
    const base = kitReachOf("mirage");
    const withLance = kitReachOf("mirage", ["lance"]);
    expect(withLance.longest).toBeGreaterThanOrEqual(base.longest);
  });
});
