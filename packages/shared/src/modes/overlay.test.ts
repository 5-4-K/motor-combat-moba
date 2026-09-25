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

  it("rejects drive.carWidth/carHeight even though the runtime bundle carries them (MC35)", () => {
    // The OBB hull is GLOBAL (MC35): `ModeTables.drive`'s TYPE omits `carWidth`/`carHeight` so a
    // mode folder cannot author one, but `base.drive` here is a `ModeConfig`'s FULL `DriveConfig`
    // at runtime — the type omission is static only. Before this guard, `rootsOf` read
    // `tables.drive` straight through, so this override validated, wrote 999 into the clone, and
    // `assembleModeConfig` then silently re-attached the shipped global hull over that write — no
    // error, no effect, the caller none the wiser. The alternative to this throw is exactly that
    // silent no-op, not a loud one.
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    expect(() => applyOverrides(base, { "drive.carWidth": 999 })).toThrow(/unknown tuning path/);
    expect(() => applyOverrides(base, { "drive.carHeight": 999 })).toThrow(/unknown tuning path/);
    expect(base.drive.carWidth).not.toBe(999);
  });

  // NOTE: this is real coverage of a real future failure mode, not a placeholder — but today it is
  // weaker than it looks. Brawl's and Deathmatch's tables are byte-equal (neither's `config.ts`
  // overrides them, so both resolve to the same base), so the ONLY assertion below that can
  // currently fail is `expect(tuned.id)`; every `.toEqual`
  // against `freshDeathmatch` would pass just as well against a fresh BRAWL bundle right now,
  // because the two modes' numbers have not diverged yet. It becomes a real cross-mode assertion —
  // catching `applyOverrides` accidentally reading or writing the wrong mode's tables — the day
  // someone actually diverges the two folders, which is the entire point of per-mode config. Do not
  // read a green run of this test as proof the tables differ; it is not, yet.
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

  // GM9 (Task 4): `slots.basicAttackEnabled` is the per-mode home of what used to be the global
  // `BASIC_ATTACK_CONFIG.enabled` flag. `applyOverrides` needs a `slots` root to build a tuned
  // sibling bundle with the flag flipped, which is what `withBasicAttack` (`test-setup.ts`) does.
  it("can switch slots.basicAttackEnabled", () => {
    const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
    expect(base.slots.basicAttackEnabled).toBe(false);
    const tuned = applyOverrides(base, { "slots.basicAttackEnabled": true });
    expect(tuned.slots.basicAttackEnabled).toBe(true);
    expect(base.slots.basicAttackEnabled).toBe(false);
  });
});
