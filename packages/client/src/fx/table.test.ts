import { describe, expect, it } from "vitest";
import { WEAPON_TABLE } from "@motor-combat-moba/shared";
import { DEFAULT_WEAPON_FX, WEAPON_FX, weaponFxOf } from "./table.js";

describe("WEAPON_FX", () => {
  it("only names weapons that exist, so a rename cannot leave a dead row", () => {
    const ids = new Set(Object.keys(WEAPON_TABLE));
    for (const id of Object.keys(WEAPON_FX)) expect(ids.has(id)).toBe(true);
  });

  it("falls back for a weapon with no row, so a new weapon still has effects", () => {
    expect(weaponFxOf("no-such-weapon")).toBe(DEFAULT_WEAPON_FX);
  });

  it("returns the authored row when there is one", () => {
    expect(weaponFxOf("magmablast")).toBe(WEAPON_FX.magmablast);
  });

  it("gives magmablast a four-channel detonation — it is the roster's one explosion", () => {
    const channels = new Set(WEAPON_FX.magmablast?.impact.map((b) => b.channel));
    expect(channels).toEqual(new Set(["fire", "smoke", "spark", "debris"]));
  });

  it("uses soot for explosion smoke and dust everywhere else (VFX7)", () => {
    const blast = WEAPON_FX.magmablast?.impact.find((b) => b.channel === "smoke");
    expect(blast?.soot).toBe(true);
    const muzzle = WEAPON_FX.magmablast?.muzzle.find((b) => b.channel === "smoke");
    expect(muzzle?.soot).toBe(false);
  });

  it("keeps every burst's numbers sane, so one bad row cannot flood the emitters", () => {
    const rows = [DEFAULT_WEAPON_FX, ...Object.values(WEAPON_FX)];
    for (const row of rows) {
      for (const burst of [...row.muzzle, ...row.impact]) {
        expect(burst.count).toBeGreaterThan(0);
        expect(burst.count).toBeLessThanOrEqual(80);
        expect(burst.lifeMs).toBeGreaterThan(0);
        expect(burst.alpha).toBeGreaterThan(0);
        expect(burst.alpha).toBeLessThanOrEqual(1);
        expect(burst.size).toBeGreaterThan(0);
      }
    }
  });
});
