import { describe, expect, it } from "vitest";
import { DEFAULT_WEAPON_FX, WEAPON_FX } from "./table.js";
import {
  FX_CHANNELS,
  FX_FIELDS,
  FX_PHASES,
  burstFor,
  fromControl,
  fxCellsFor,
  fxKey,
  isFxAtShipped,
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
    expect(FX_FIELDS.map((f) => f.name)).toEqual([
      "count",
      "speed",
      "lifeMs",
      "size",
      "growPerSec",
      "alpha",
      "coneRad",
      "soot",
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

  it("round-trips a narrow cone within a degree", () => {
    const field = fieldOf("coneRad");
    const deg = Math.round(toControl(field, 0.9));
    expect(fromControl(field, deg)).toBeCloseTo(0.9, 2);
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
