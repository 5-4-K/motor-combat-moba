import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { assembleModeConfig } from "./build.js";
import { DEATHMATCH_TABLES } from "./deathmatch/index.js";
import { applyOverrides } from "./overlay.js";
import { modeConfigOf } from "./registry.js";

describe("applyOverrides", () => {
  it("returns a NEW bundle and leaves the base untouched", () => {
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    const before = base.weapons.predator.damage;
    const tuned = applyOverrides(base, { "weapon.predator.damage": 999 });
    expect(tuned.weapons.predator.damage).toBe(999);
    expect(base.weapons.predator.damage).toBe(before);
  });

  it("re-derives the artifacts a changed leaf feeds", () => {
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    const tuned = applyOverrides(base, { "weapon.predator.cooldownMs": 4000 });
    expect(tuned.derived.weaponTicks.predator.cooldown).not.toBe(base.derived.weaponTicks.predator.cooldown);
  });

  it("rejects a path through an array the weapon does not have at all", () => {
    // NOT the status-id guard, despite the shape of the path: `predator` authors no `applies` array,
    // so this throws at the path walk ("unknown tuning path") and never reaches the status-id check
    // at all. It is here as the array-hop case — a numeric segment into an absent array — and the
    // test below is the one that proves the status-id guard. Re-titled 2026-09-23 after a reviewer
    // read this one as the guard it is not.
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    expect(base.weapons.predator.applies).toBeUndefined();
    expect(() => applyOverrides(base, { "weapon.predator.applies.0.statusId": "nope" })).toThrow(
      /unknown tuning path/,
    );
  });

  it("rejects an unknown status id on a leaf that actually carries one, not merely a missing path", () => {
    // predator (above) carries no `applies` array at all, so that throw is really "unknown path".
    // thunderclap does carry one, and this is the value check that matters: an unknown status id
    // reaches `statusDefOf(...)!.onApply` and throws a bare TypeError mid-tick if it is not caught
    // here first.
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    expect(base.weapons.thunderclap.applies?.[0]?.statusId).toBe("stunned");
    // Matched on the message, not merely on "it threw": this file installs no mode, and until
    // 2026-09-23 the guard read the INSTALLED bundle's status table through `isStatusId` — so a
    // bare `.toThrow()` here was satisfied by "config read outside a mode scope" and the guard
    // itself never ran. It validates against `base.statusTable` now, which is both scope-free and
    // the right table: a status id is valid for the mode being tuned.
    expect(() => applyOverrides(base, { "weapon.thunderclap.applies.0.statusId": "nope" })).toThrow(
      /not a status id/,
    );
    // and a real one is accepted, on that same leaf, with no mode installed anywhere.
    expect(
      applyOverrides(base, { "weapon.thunderclap.applies.0.statusId": "spiked" }).weapons.thunderclap
        .applies?.[0]?.statusId,
    ).toBe("spiked");
    // and it wrote nothing: the base's own row still carries the real status id
    expect(base.weapons.thunderclap.applies?.[0]?.statusId).toBe("stunned");
  });

  it("replaces rather than accumulates: two calls from the same base each carry only their own changes", () => {
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    const first = applyOverrides(base, { "weapon.predator.damage": 111 });
    const second = applyOverrides(base, { "drive.baseTurnRate": 2 });

    expect(second.weapons.predator.damage).toBe(base.weapons.predator.damage);
    expect(second.drive.baseTurnRate).toBe(2);

    expect(first.drive.baseTurnRate).toBe(base.drive.baseTurnRate);
    expect(first.weapons.predator.damage).toBe(111);
  });

  it("returns a frozen bundle, like every other bundle in this system", () => {
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    const tuned = applyOverrides(base, { "weapon.predator.damage": 50 });
    expect(Object.isFrozen(tuned)).toBe(true);
    expect(Object.isFrozen(tuned.drive)).toBe(true);
    expect(Object.isFrozen(tuned.weapons.predator)).toBe(true);
    expect(Object.isFrozen(tuned.derived.weaponTicks)).toBe(true);
  });

  it("throws on an unknown car, an unknown root, and a prototype-chain probe — and writes nothing", () => {
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    expect(() => applyOverrides(base, { "car.nosuchcar.speed": 50 })).toThrow();
    expect(() => applyOverrides(base, { "nope.x": 1 })).toThrow();
    expect(() => applyOverrides(base, { "car.mirage.toString": 1 })).toThrow();
    // none of those calls could have written anything to the base, structurally: applyOverrides
    // never mutates its argument, only a clone it builds after every path validates.
    expect(base.cars.mirage.speed).not.toBe(50);
  });

  it("throws on a type mismatch instead of writing a wrong-typed value", () => {
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    expect(() => applyOverrides(base, { "weapon.predator.damage": "lots" })).toThrow();
  });

  it("rejects the whole batch when only one override in it is bad", () => {
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    expect(() =>
      applyOverrides(base, {
        "weapon.predator.damage": 5,
        "weapon.thunderclap.applies.0.statusId": "nope",
      }),
    ).toThrow();
    expect(base.weapons.predator.damage).not.toBe(5);
  });

  it("tunes a mode OTHER than the default, and the result is that mode's numbers plus the override, not Brawl's", () => {
    const dmBase = modeConfigOf(GameMode.FFA_DEATHMATCH);
    const brawlBase = modeConfigOf(GameMode.FFA_LAST_STANDING);
    const tuned = applyOverrides(dmBase, { "weapon.predator.damage": 777 });

    expect(tuned.id).toBe(GameMode.FFA_DEATHMATCH);
    expect(tuned.weapons.predator.damage).toBe(777);
    expect(tuned).not.toBe(brawlBase);

    // Everything else matches a bundle built straight from DEATHMATCH_TABLES, not BRAWL_TABLES —
    // the whole point of this function is that it can tune a non-default mode at all.
    const freshDeathmatch = assembleModeConfig(GameMode.FFA_DEATHMATCH, DEATHMATCH_TABLES);
    expect(tuned.cars).toEqual(freshDeathmatch.cars);
    expect(tuned.drive).toEqual(freshDeathmatch.drive);
    expect(tuned.deathmatch).toEqual(freshDeathmatch.deathmatch);
    expect({ ...tuned.weapons, predator: freshDeathmatch.weapons.predator }).toEqual(freshDeathmatch.weapons);
  });
});
