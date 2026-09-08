import { describe, expect, it } from "vitest";
import { DEFAULT_WEAPON_FX, WEAPON_FX, weaponFxOf } from "./table.js";
import {
  FX_CHANNELS,
  FX_FIELDS,
  FX_PHASES,
  burstFor,
  fxTableSource,
  fromControl,
  fxCellsFor,
  fxKey,
  isFxAtShipped,
  resolveWeaponFx,
  shippedBurstFor,
  toControl,
  type FxFieldDef,
  type FxOverrides,
} from "./tuning.js";

const TAU = Math.PI * 2;
const fieldOf = (name: string): FxFieldDef => FX_FIELDS.find((f) => f.name === name)!;

describe("fxKey", () => {
  it("is weapon.phase.channel.field", () => {
    expect(fxKey("wildcharge", "impact", "fire", "count")).toBe("wildcharge.impact.fire.count");
  });
});

describe("shippedBurstFor", () => {
  it("returns the authored burst for a channel the weapon uses", () => {
    const burst = shippedBurstFor("magmablast", "impact", "spark");
    expect(burst.count).toBe(WEAPON_FX.magmablast!.impact.find((b) => b.channel === "spark")!.count);
    expect(burst.count).toBe(64);
  });

  it("returns a count-0 seed for a channel the weapon does not use", () => {
    // lance's impact is a single spark burst; it has no debris.
    const burst = shippedBurstFor("lance", "impact", "debris");
    expect(burst.count).toBe(0);
    expect(burst.channel).toBe("debris");
    // The rest of the seed is plausible, so raising count off zero shows something (PG45).
    expect(burst.size).toBeGreaterThan(0);
    expect(burst.lifeMs).toBeGreaterThan(0);
  });

  it("seeds an unauthored weapon from DEFAULT_WEAPON_FX", () => {
    // wildcharge has no WEAPON_FX row, so weaponFxOf falls back to the default (PG45).
    expect(WEAPON_FX.wildcharge).toBeUndefined();
    const fire = shippedBurstFor("wildcharge", "muzzle", "fire");
    expect(fire.count).toBe(DEFAULT_WEAPON_FX.muzzle.find((b) => b.channel === "fire")!.count);
  });
});

describe("burstFor", () => {
  it("returns the shipped burst when nothing is overridden", () => {
    expect(burstFor("magmablast", "impact", "fire", {})).toEqual(
      shippedBurstFor("magmablast", "impact", "fire"),
    );
  });

  it("applies a numeric override to one field and leaves its siblings alone", () => {
    const overrides: FxOverrides = { "magmablast.impact.fire.count": 12 };
    const burst = burstFor("magmablast", "impact", "fire", overrides);
    expect(burst.count).toBe(12);
    expect(burst.speed).toBe(shippedBurstFor("magmablast", "impact", "fire").speed);
  });

  it("applies a boolean override", () => {
    const burst = burstFor("predator", "muzzle", "smoke", { "predator.muzzle.smoke.soot": true });
    expect(burst.soot).toBe(true);
  });

  it("ignores an override of the wrong type", () => {
    const burst = burstFor("magmablast", "impact", "fire", {
      "magmablast.impact.fire.count": true as unknown as number,
    });
    expect(burst.count).toBe(shippedBurstFor("magmablast", "impact", "fire").count);
  });
});

describe("fxCellsFor", () => {
  it("is always eight cells, phase-major, in channel order", () => {
    const cells = fxCellsFor("lance", {});
    expect(cells).toHaveLength(8);
    expect(cells.map((c) => c.phase)).toEqual([
      ...FX_PHASES.flatMap((p) => FX_CHANNELS.map(() => p)),
    ]);
    expect(cells.slice(0, 4).map((c) => c.channel)).toEqual([...FX_CHANNELS]);
  });

  it("carries both the shipped burst and the current one", () => {
    const cells = fxCellsFor("lance", { "lance.muzzle.fire.count": 40 });
    const cell = cells.find((c) => c.phase === "muzzle" && c.channel === "fire")!;
    expect(cell.current.count).toBe(40);
    expect(cell.shipped.count).toBe(12);
  });
});

describe("FX_FIELDS", () => {
  it("covers every editable FxBurst field and nothing else", () => {
    // The order matters twice over: it is the panel's row order and the export's key order, and it
    // must match `FxBurst`'s declaration order so a pasted fragment matches the rows beside it.
    expect(FX_FIELDS.map((f) => f.name)).toEqual([
      "count",
      "speed",
      "lifeMs",
      "size",
      "growPerSec",
      "alpha",
      "soot",
      "coneRad",
    ]);
  });

  it("contains every shipped value in range", () => {
    const rows = [...Object.values(WEAPON_FX), DEFAULT_WEAPON_FX];
    for (const row of rows) {
      for (const burst of [...row!.muzzle, ...row!.impact]) {
        for (const field of FX_FIELDS) {
          if (field.kind !== "number") continue;
          const value = toControl(field, burst[field.name] as number);
          expect(value).toBeGreaterThanOrEqual(field.min);
          expect(value).toBeLessThanOrEqual(field.max);
        }
      }
    }
  });
});

describe("toControl / fromControl", () => {
  it("is the identity for a plain numeric field", () => {
    const field = fieldOf("speed");
    expect(toControl(field, 420)).toBe(420);
    expect(fromControl(field, 420)).toBe(420);
  });

  it("round-trips a full sphere back to exactly TAU", () => {
    const field = fieldOf("coneRad");
    expect(toControl(field, TAU)).toBe(360);
    expect(fromControl(field, 360)).toBe(TAU);
  });

  it("round-trips a narrow cone to within half a degree", () => {
    const field = fieldOf("coneRad");
    // Half a degree is the most a 1° grid can promise, and it is 0.0087 rad — so asserting a
    // tighter radian tolerance (`toBeCloseTo(x, 2)` allows 0.005) fails on inputs that are simply
    // far from a whole degree: 0.9 rad round-trips 0.0076 away, 1.3 rad 0.0085. Assert the property
    // the grid actually guarantees, over a spread of cones rather than one lucky value.
    const halfDegree = (0.5 / 360) * Math.PI * 2;
    for (const rad of [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3]) {
      const deg = Math.round(toControl(field, rad));
      expect(Math.abs(fromControl(field, deg) - rad)).toBeLessThan(halfDegree);
    }
  });
});

describe("isFxAtShipped", () => {
  it("is true within half a step, so a slider dragged back to shipped clears its override", () => {
    const field = fieldOf("alpha");
    expect(isFxAtShipped(field, 0.9, 0.9)).toBe(true);
    expect(isFxAtShipped(field, 0.9 + field.step / 4, 0.9)).toBe(true);
    expect(isFxAtShipped(field, 0.9 + field.step, 0.9)).toBe(false);
  });

  it("every shipped value is REACHABLE on its own grid", () => {
    // The tolerance is `< step / 2`, so a shipped value sitting exactly at a grid midpoint can
    // never be cleared: the two nearest positions the slider can land on are both exactly half a
    // step away, and neither counts as shipped. Touching such a field would leave a phantom
    // override in every export, forever — which is the precise bug PG43's tolerance exists to
    // prevent. Three values had this property under the first set of steps chosen for FX_FIELDS
    // (alpha 0.95 at step 0.02; lifeMs 190 and 430 at step 20), so this asserts the property over
    // the whole table rather than trusting the steps to stay right through a future WEAPON_FX edit.
    const rows = [...Object.values(WEAPON_FX), DEFAULT_WEAPON_FX];
    for (const row of rows) {
      for (const burst of [...row!.muzzle, ...row!.impact]) {
        for (const field of FX_FIELDS) {
          if (field.kind !== "number") continue;
          const control = toControl(field, burst[field.name] as number);
          const nearest = field.min + Math.round((control - field.min) / field.step) * field.step;
          expect(
            isFxAtShipped(field, nearest, control),
            `${burst.channel}.${field.name} = ${control} is unreachable on a ${field.step} grid`,
          ).toBe(true);
        }
      }
    }
  });

  it("uses strict equality for a boolean field", () => {
    const field = fieldOf("soot");
    expect(isFxAtShipped(field, false, false)).toBe(true);
    expect(isFxAtShipped(field, true, false)).toBe(false);
  });
});

describe("resolveWeaponFx", () => {
  it("reproduces the shipped row exactly when nothing is overridden", () => {
    for (const weaponId of ["magmablast", "thumper", "lance", "predator"]) {
      expect(resolveWeaponFx(weaponId, {})).toEqual(weaponFxOf(weaponId));
    }
  });

  it("preserves the authored burst ORDER rather than re-sorting into channel order", () => {
    // magmablast's impact is authored fire, smoke, spark, debris — fire before smoke, which is not
    // FX_CHANNELS order. Re-sorting would silently change what draws over what.
    expect(resolveWeaponFx("magmablast", {}).impact.map((b) => b.channel)).toEqual([
      "fire",
      "smoke",
      "spark",
      "debris",
    ]);
  });

  it("drops a burst whose count is overridden to zero (PG47)", () => {
    const row = resolveWeaponFx("lance", { "lance.muzzle.spark.count": 0 });
    expect(row.muzzle.map((b) => b.channel)).toEqual(["fire"]);
  });

  it("appends a newly enabled channel after the authored ones", () => {
    const row = resolveWeaponFx("lance", { "lance.impact.debris.count": 6 });
    expect(row.impact.map((b) => b.channel)).toEqual(["spark", "debris"]);
    expect(row.impact[1]!.count).toBe(6);
  });

  it("appends TWO newly enabled channels, in FX_CHANNELS order, after the authored ones", () => {
    // lance's muzzle is authored fire, spark. Enabling smoke and debris at once must not re-sort the
    // whole phase into FX_CHANNELS order (smoke, fire, spark, debris) -- the authored pair stays
    // first, and only the two new ones are appended, in FX_CHANNELS order relative to each other.
    const row = resolveWeaponFx("lance", {
      "lance.muzzle.smoke.count": 5,
      "lance.muzzle.debris.count": 8,
    });
    expect(row.muzzle.map((b) => b.channel)).toEqual(["fire", "spark", "smoke", "debris"]);
  });

  it("gives an unauthored weapon a real row once a channel is raised off zero", () => {
    const row = resolveWeaponFx("wildcharge", { "wildcharge.impact.debris.count": 12 });
    expect(row.impact.some((b) => b.channel === "debris" && b.count === 12)).toBe(true);
  });

  it("returns the shipped row BY IDENTITY for a weapon nothing overrides", () => {
    expect(resolveWeaponFx("magmablast", { "lance.muzzle.fire.count": 40 })).toBe(
      weaponFxOf("magmablast"),
    );
  });

  it("returns a rebuilt row for a weapon that is overridden", () => {
    const row = resolveWeaponFx("lance", { "lance.muzzle.fire.count": 40 });
    expect(row).not.toBe(weaponFxOf("lance"));
    expect(row.muzzle.find((b) => b.channel === "fire")!.count).toBe(40);
  });

  it("does not throw, or rebuild, for an unknown weapon id", () => {
    expect(resolveWeaponFx("no-such-weapon", {})).toBe(weaponFxOf("no-such-weapon"));
  });
});

describe("fxTableSource", () => {
  it("is empty when nothing is overridden", () => {
    expect(fxTableSource({})).toBe("");
  });

  it("emits only the weapons that were touched", () => {
    const source = fxTableSource({ "lance.muzzle.fire.count": 40 });
    expect(source).toContain("lance: {");
    expect(source).not.toContain("magmablast");
  });

  it("emits a full row, not just the changed field", () => {
    const source = fxTableSource({ "lance.muzzle.fire.count": 40 });
    expect(source).toContain("count: 40");
    expect(source).toContain('channel: "spark"'); // the untouched sibling burst is still there
    expect(source).toContain("impact: [");
  });

  it("writes a full sphere as TAU rather than 6.2832", () => {
    const source = fxTableSource({ "magmablast.impact.fire.count": 20 });
    expect(source).toContain("coneRad: TAU");
    expect(source).not.toContain("6.28");
  });

  it("omits a burst switched off, and only that one", () => {
    const source = fxTableSource({ "lance.muzzle.spark.count": 0 });
    // `lance` authors a spark burst in BOTH phases — muzzle fire+spark, impact spark. Switching the
    // muzzle one off must leave the muzzle with fire alone while the impact spark, a different
    // burst nobody touched, survives. So assert on the muzzle slice, not the whole fragment.
    const muzzle = source.slice(source.indexOf("muzzle:"), source.indexOf("impact:"));
    expect(muzzle).toContain('channel: "fire"');
    expect(muzzle).not.toContain('channel: "spark"');
    expect(source).toContain('channel: "spark"');
  });

  it("is valid TypeScript that reproduces the resolved row", () => {
    const overrides = { "lance.muzzle.fire.count": 40, "lance.impact.debris.count": 6 };
    const source = fxTableSource(overrides);
    // Evaluate the fragment as an object literal and compare it to what the sim would render.
    const TAU = Math.PI * 2;
    const parsed = new Function("TAU", `return {${source}};`)(TAU) as Record<string, unknown>;
    expect(parsed.lance).toEqual(resolveWeaponFx("lance", overrides));
  });

  it("round-trips a cone that is NOT a full sphere through the four-decimal number path", () => {
    // lance's muzzle bursts author coneRad 0.7 (fire) and 0.6 (spark), neither of them TAU, so this
    // exercises `numberSource`'s trimmed-decimal branch rather than its `TAU` special case.
    const overrides: FxOverrides = { "lance.muzzle.fire.count": 40 };
    const source = fxTableSource(overrides);
    const muzzle = source.slice(source.indexOf("muzzle:"), source.indexOf("impact:"));
    expect(muzzle).toContain("coneRad: 0.7");
    expect(muzzle).toContain("coneRad: 0.6");
    expect(muzzle).not.toContain("coneRad: TAU");
    const parsed = new Function("TAU", `return {${source}};`)(TAU) as Record<string, unknown>;
    expect(parsed.lance).toEqual(resolveWeaponFx("lance", overrides));
  });
});
