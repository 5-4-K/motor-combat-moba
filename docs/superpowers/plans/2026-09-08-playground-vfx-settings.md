# Playground VFX Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second playground settings panel that tunes every field of `WEAPON_FX` for all ten weapons, live, with an in-panel preview and a pasteable export.

**Architecture:** A pure module (`fx/tuning.ts`) turns `WEAPON_FX` into a fixed 8-cell grid per weapon and applies a sparse override map to it. A module-level store holds the live overrides; `ArenaScene` builds a resolver from it **only for a playground room** and injects it into `FxLayer`, so shipped scenes are untouched. The DOM panel in `dev/playground/overlay.ts` edits the map and replays the edited burst through a preview callback owned by `PlaygroundScene`.

**Tech Stack:** TypeScript, Phaser 4 (particle emitters only), vitest (node environment), plain DOM — no framework.

**Spec:** [`docs/superpowers/specs/2026-09-08-playground-vfx-settings-design.md`](../specs/2026-09-08-playground-vfx-settings-design.md) — decisions **PG41–PG55**. Read it alongside this plan; every task below cites the decisions it implements.

## Global Constraints

- **Client-only.** Nothing here crosses the wire, touches `packages/shared`, or adds a schema field. No `room.send` call is added.
- **Playground-only reach (PG46).** A shipped arena or practice session must construct `FxLayer` exactly as it does today and render shipped `WEAPON_FX`.
- **`weaponFxOf` stays the default and the fallback.** It is not modified, and it remains the default parameter value everywhere a resolver is accepted.
- **Pure logic is tested; DOM is not (PG55).** Anything that decides something goes in a pure module with a vitest file beside it. `overlay.ts` stays the untested DOM shell it declares itself to be.
- **`packages/shared` is consumed as built `dist`.** Run `npm run build -w @motor-combat-moba/shared` once before the first test run in a fresh checkout, and again after any shared change (there are none in this plan).
- **Test command:** `npm run test -w @motor-combat-moba/client -- <path>` for one file; `npm test` from the root for everything (it builds shared first).
- **Typecheck command:** `npm run typecheck -w @motor-combat-moba/client`.
- **No magic numbers in logic** (hard invariant 2). Every constant this plan introduces is a named export with a comment.
- **Commit after every task.** Commit messages are lowercase-prefixed (`feat:`, `test:`, `refactor:`) as the existing history uses.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `packages/client/src/fx/tuning.ts` | Pure grid model: field descriptors, per-channel seeds, override apply/clear, degree↔radian conversion, `resolveWeaponFx`, the export serializer. |
| `packages/client/src/fx/tuning.test.ts` | Tests for the above. |
| `packages/client/src/fx/override-store.ts` | Module-level live override map + `liveFxResolver()`. The `config/view-options.ts` pattern. |
| `packages/client/src/fx/override-store.test.ts` | Tests for the above. |
| `packages/client/src/dev/playground/vfx-panel.ts` | The VFX settings panel's DOM. Kept out of `overlay.ts`, which is already 934 lines. |

**Modified:**

| File | Change |
|---|---|
| `packages/client/src/fx/emitters.ts` | Optional resolver parameter; drop `count: 0` specs. |
| `packages/client/src/fx/emitters.test.ts` | Cases for both. |
| `packages/client/src/fx/layer.ts` | Optional 5th constructor parameter, stored and used in `update`. |
| `packages/client/src/scenes/controlled-car.ts` | Add `isPlaygroundRoom`. |
| `packages/client/src/scenes/controlled-car.test.ts` | Cases for it. |
| `packages/client/src/scenes/ArenaScene.ts` | Pass the resolver when the room is a playground; add `previewFx`. |
| `packages/client/src/dev/playground/storage.ts` | New `vfx` section in the stored blob. |
| `packages/client/src/dev/playground/storage.test.ts` | Cases for it. |
| `packages/client/src/dev/playground/ui-model.ts` | `OverlayView` gains `"physics"` and `"vfx"`, loses `"settings"`. |
| `packages/client/src/dev/playground/ui-model.test.ts` | Updated `pauseKeyAction` cases. |
| `packages/client/src/dev/playground/overlay.ts` | Menu entry, header rename, view routing, VFX panel mount, preview callback parameter. |
| `packages/client/src/dev/PlaygroundScene.ts` | Load the `vfx` section into the store, clear on shutdown, supply the preview callback. |
| `CLAUDE.md` | One row in the doc table for the new spec. |

---

## Task 1: The grid model — field descriptors, seeds, and cells

Implements **PG42** (fixed 4-channel grid), **PG43** (sparse dot-path overrides), **PG44** (degrees in, radians out), **PG45** (unauthored weapons seed from `DEFAULT_WEAPON_FX`), **PG49** (ranges), **PG50** (`soot` is smoke-only).

**Files:**
- Create: `packages/client/src/fx/tuning.ts`
- Test: `packages/client/src/fx/tuning.test.ts`

**Interfaces:**
- Consumes: `WEAPON_FX`, `DEFAULT_WEAPON_FX`, `weaponFxOf`, `FxBurst`, `FxChannel`, `WeaponFxRow` from `./table.js`.
- Produces: `FxPhase`, `FX_PHASES`, `FX_CHANNELS`, `FxFieldName`, `FxFieldDef`, `FX_FIELDS`, `FxOverrides`, `fxKey()`, `shippedBurstFor()`, `burstFor()`, `FxCell`, `fxCellsFor()`, `toControl()`, `fromControl()`, `isFxAtShipped()`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/fx/tuning.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- src/fx/tuning.test.ts`
Expected: FAIL — `Failed to resolve import "./tuning.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/client/src/fx/tuning.ts`:

```ts
import type { FxBurst, FxChannel } from "./table.js";
import { weaponFxOf } from "./table.js";

/**
 * The playground's VFX tuning model (spec PG42-PG45, PG49, PG50).
 *
 * Pure and Phaser-free, so it runs under vitest's node environment beside the rest of `fx/`. It
 * turns a weapon's `WeaponFxRow` — a variable-length list per phase — into a FIXED grid of eight
 * cells, two phases by four channels, and applies a sparse override map to it. `count: 0` is the
 * off switch for a cell (PG42), which is what lets one rectangular grid represent every row in
 * `WEAPON_FX` and every row that has no entry there at all.
 */

const TAU = Math.PI * 2;

export type FxPhase = "muzzle" | "impact";

/** Phase order in the panel and in every derived list. */
export const FX_PHASES: readonly FxPhase[] = ["muzzle", "impact"];

/** Channel order in the panel. NOT the render order — see `resolveWeaponFx` in Task 2. */
export const FX_CHANNELS: readonly FxChannel[] = ["smoke", "fire", "spark", "debris"];

export type FxFieldName = keyof Omit<FxBurst, "channel">;

export interface FxFieldDef {
  readonly name: FxFieldName;
  readonly label: string;
  readonly kind: "number" | "boolean";
  /** Control-unit bounds. For `coneRad` these are DEGREES, not radians — see `toControl`. */
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The control edits degrees while the store holds radians (PG44). */
  readonly degrees: boolean;
  /** Rendered on every row for grid regularity, but live on smoke alone (PG50). */
  readonly smokeOnly: boolean;
}

/**
 * Every editable field of an `FxBurst`, with the range its slider spans (PG49).
 *
 * Ranges contain every shipped value with headroom and are deliberately NOT a budget guard: the
 * largest authored values are `count` 64, `speed` 420, `lifeMs` 3000, `size` 82, `growPerSec` 80,
 * and `MAX_SPECS_PER_FRAME` already caps a frame. A panel that refuses an extreme is a panel that
 * cannot answer "is this too much".
 *
 * `channel` is absent on purpose: it is the cell's identity, not one of its values.
 */
export const FX_FIELDS: readonly FxFieldDef[] = [
  { name: "count", label: "Count", kind: "number", min: 0, max: 100, step: 1, degrees: false, smokeOnly: false },
  { name: "speed", label: "Speed", kind: "number", min: 0, max: 600, step: 5, degrees: false, smokeOnly: false },
  { name: "lifeMs", label: "Life (ms)", kind: "number", min: 0, max: 4000, step: 10, degrees: false, smokeOnly: false },
  { name: "size", label: "Size", kind: "number", min: 0, max: 120, step: 1, degrees: false, smokeOnly: false },
  { name: "growPerSec", label: "Grow/s", kind: "number", min: -20, max: 120, step: 1, degrees: false, smokeOnly: false },
  { name: "alpha", label: "Alpha", kind: "number", min: 0, max: 1, step: 0.01, degrees: false, smokeOnly: false },
  { name: "coneRad", label: "Cone", kind: "number", min: 0, max: 360, step: 1, degrees: true, smokeOnly: false },
  { name: "soot", label: "Soot", kind: "boolean", min: 0, max: 1, step: 1, degrees: false, smokeOnly: true },
];

/** A sparse map of `"<weaponId>.<phase>.<channel>.<field>"` to its value (PG43). */
export type FxOverrides = Record<string, number | boolean>;

export function fxKey(
  weaponId: string,
  phase: FxPhase,
  channel: FxChannel,
  field: FxFieldName,
): string {
  return `${weaponId}.${phase}.${channel}.${field}`;
}

/**
 * What a cell opens at when the weapon's row does not use that channel (PG45).
 *
 * The starting position of a control, not something the game renders — every one is `count: 0`, so
 * none of these reaches an emitter until a developer raises it. The other fields are plausible
 * values for that channel, taken from the shape the shipped rows use, so raising `count` off zero
 * produces something visible rather than a burst of zero-size particles.
 */
const CHANNEL_SEED: Readonly<Record<FxChannel, FxBurst>> = {
  smoke: { channel: "smoke", count: 0, speed: 40, lifeMs: 900, size: 26, growPerSec: 26, alpha: 0.3, soot: false, coneRad: TAU },
  fire: { channel: "fire", count: 0, speed: 70, lifeMs: 200, size: 34, growPerSec: 16, alpha: 0.9, soot: false, coneRad: TAU },
  spark: { channel: "spark", count: 0, speed: 280, lifeMs: 300, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
  debris: { channel: "debris", count: 0, speed: 140, lifeMs: 800, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
};

/**
 * The burst this cell would render with no overrides at all.
 *
 * Reads through `weaponFxOf`, so a weapon with no `WEAPON_FX` row seeds from `DEFAULT_WEAPON_FX` —
 * the six unauthored weapons open showing what they actually render today (PG45).
 */
export function shippedBurstFor(weaponId: string, phase: FxPhase, channel: FxChannel): FxBurst {
  const authored = weaponFxOf(weaponId)[phase].find((b) => b.channel === channel);
  return authored ?? CHANNEL_SEED[channel];
}

/** The burst this cell renders now: shipped, with any overridden field replaced. */
export function burstFor(
  weaponId: string,
  phase: FxPhase,
  channel: FxChannel,
  overrides: FxOverrides,
): FxBurst {
  const shipped = shippedBurstFor(weaponId, phase, channel);
  const out: Record<string, unknown> = { ...shipped };
  for (const field of FX_FIELDS) {
    const value = overrides[fxKey(weaponId, phase, channel, field.name)];
    if (value === undefined) continue;
    // A stored value of the wrong type is dropped rather than written through: the storage codec
    // (Task 5) is lenient by design, and a string where a number belongs would NaN-poison an
    // emitter config rather than fail loudly.
    if (field.kind === "number" && typeof value !== "number") continue;
    if (field.kind === "boolean" && typeof value !== "boolean") continue;
    out[field.name] = value;
  }
  return out as unknown as FxBurst;
}

export interface FxCell {
  readonly phase: FxPhase;
  readonly channel: FxChannel;
  readonly shipped: FxBurst;
  readonly current: FxBurst;
}

/** All eight cells for one weapon, phase-major, in `FX_CHANNELS` order — the panel's row order. */
export function fxCellsFor(weaponId: string, overrides: FxOverrides): FxCell[] {
  const cells: FxCell[] = [];
  for (const phase of FX_PHASES) {
    for (const channel of FX_CHANNELS) {
      cells.push({
        phase,
        channel,
        shipped: shippedBurstFor(weaponId, phase, channel),
        current: burstFor(weaponId, phase, channel, overrides),
      });
    }
  }
  return cells;
}

/**
 * Stored value to control value. Identity for every field but `coneRad`, which is edited in degrees
 * (PG44) because a slider from 0 to 6.283 in steps of 0.098 is unreadable.
 *
 * Written as `rad / TAU * 360` rather than `rad * 180 / Math.PI` so that a full sphere — the value
 * 14 of the 25 shipped bursts author — round-trips to exactly `TAU` and back, instead of landing a
 * float's width away and writing a phantom override for a field nobody touched.
 */
export function toControl(field: FxFieldDef, stored: number): number {
  return field.degrees ? (stored / TAU) * 360 : stored;
}

/** Control value to stored value. The exact inverse of `toControl`. */
export function fromControl(field: FxFieldDef, control: number): number {
  return field.degrees ? (control / 360) * TAU : control;
}

/**
 * Should this control's value be treated as "shipped", i.e. should its override entry be DELETED?
 *
 * Both arguments are in CONTROL units, so the tolerance below is in the same units as `field.step`.
 * The half-step rule is `isAtShipped`'s, from `dev/playground/ui-model.ts`, and exists for the same
 * reason: a range input snaps to its `min`/`step` grid, the shipped value very often does not sit on
 * that grid, and a strict comparison would leave a phantom override behind every time a slider was
 * dragged back to where it started.
 */
export function isFxAtShipped(
  field: FxFieldDef,
  value: number | boolean,
  shipped: number | boolean,
): boolean {
  if (field.kind !== "number" || typeof value !== "number" || typeof shipped !== "number") {
    return value === shipped;
  }
  return Math.abs(value - shipped) < field.step / 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- src/fx/tuning.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/fx/tuning.ts packages/client/src/fx/tuning.test.ts
git commit -m "feat: add the playground VFX grid model (PG42-PG45, PG49, PG50)"
```

---

## Task 2: Resolving a grid back into a `WeaponFxRow`

Implements **PG42**'s round-trip requirement and **PG47** (`count: 0` never reaches an emitter).

**Files:**
- Modify: `packages/client/src/fx/tuning.ts`
- Test: `packages/client/src/fx/tuning.test.ts`

**Interfaces:**
- Consumes: `burstFor`, `FX_CHANNELS`, `FxOverrides` from Task 1.
- Produces: `WeaponFxResolver` (type `(weaponId: string) => WeaponFxRow`), `resolveWeaponFx(weaponId, overrides)`, `fxResolverFor(overrides)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/tuning.test.ts` (and add `fxResolverFor`, `resolveWeaponFx` to the import list at the top of the file):

```ts
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

  it("gives an unauthored weapon a real row once a channel is raised off zero", () => {
    const row = resolveWeaponFx("wildcharge", { "wildcharge.impact.debris.count": 12 });
    expect(row.impact.some((b) => b.channel === "debris" && b.count === 12)).toBe(true);
  });
});

describe("fxResolverFor", () => {
  it("returns the shipped row, by identity, for an untouched weapon", () => {
    const resolve = fxResolverFor({ "lance.muzzle.fire.count": 40 });
    expect(resolve("magmablast")).toBe(weaponFxOf("magmablast"));
  });

  it("returns the overridden row for a touched weapon", () => {
    const resolve = fxResolverFor({ "lance.muzzle.fire.count": 40 });
    expect(resolve("lance").muzzle.find((b) => b.channel === "fire")!.count).toBe(40);
  });

  it("falls back to the default row for an unknown weapon id", () => {
    expect(fxResolverFor({})("no-such-weapon")).toBe(weaponFxOf("no-such-weapon"));
  });
});
```

Add `weaponFxOf` to the existing `./table.js` import in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- src/fx/tuning.test.ts`
Expected: FAIL — `resolveWeaponFx is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `packages/client/src/fx/tuning.ts` (and add `WeaponFxRow` to the `./table.js` type import):

```ts
/** How `fx/emitters.ts` asks for a weapon's row. `weaponFxOf` is the shipped implementation. */
export type WeaponFxResolver = (weaponId: string) => WeaponFxRow;

/**
 * One phase's bursts, in RENDER order, with every disabled cell dropped.
 *
 * The authored order is preserved and newly enabled channels are appended after it, rather than
 * emitting `FX_CHANNELS` order throughout. Order decides which burst is spawned first and therefore
 * which one survives the `MAX_SPECS_PER_FRAME` cap, so re-sorting would be a silent behaviour change
 * for every weapon whose authored order differs — `magmablast`'s impact leads with fire, not smoke.
 */
function resolvePhase(
  weaponId: string,
  phase: FxPhase,
  authored: readonly FxBurst[],
  overrides: FxOverrides,
): FxBurst[] {
  const order: FxChannel[] = [
    ...authored.map((b) => b.channel),
    ...FX_CHANNELS.filter((c) => !authored.some((b) => b.channel === c)),
  ];
  const out: FxBurst[] = [];
  for (const channel of order) {
    const burst = burstFor(weaponId, phase, channel, overrides);
    // PG47: a disabled cell produces no burst at all, so it costs no emitter call, no texture
    // re-resolve, and none of the per-frame spec budget.
    if (burst.count > 0) out.push(burst);
  }
  return out;
}

/** A weapon's row with the override map applied. Equal to the shipped row for an empty map. */
export function resolveWeaponFx(weaponId: string, overrides: FxOverrides): WeaponFxRow {
  const shipped = weaponFxOf(weaponId);
  return {
    muzzle: resolvePhase(weaponId, "muzzle", shipped.muzzle, overrides),
    impact: resolvePhase(weaponId, "impact", shipped.impact, overrides),
  };
}

/**
 * A resolver over a fixed override map.
 *
 * A weapon with no entry in the map returns `weaponFxOf`'s own row BY IDENTITY, not a rebuilt copy:
 * in a room where one weapon is being tuned, the other five keep hitting the shipped object and
 * allocate nothing per burst.
 */
export function fxResolverFor(overrides: FxOverrides): WeaponFxResolver {
  const touched = new Set(
    Object.keys(overrides).map((key) => key.slice(0, Math.max(0, key.indexOf(".")))),
  );
  return (weaponId) =>
    touched.has(weaponId) ? resolveWeaponFx(weaponId, overrides) : weaponFxOf(weaponId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- src/fx/tuning.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/tuning.ts packages/client/src/fx/tuning.test.ts
git commit -m "feat: resolve a VFX grid back into a WeaponFxRow (PG42, PG47)"
```

---

## Task 3: The injection seam in `emitters.ts` and `FxLayer`

Implements **PG46** (injected, never global) and **PG47**.

**Files:**
- Modify: `packages/client/src/fx/emitters.ts`
- Modify: `packages/client/src/fx/emitters.test.ts`
- Modify: `packages/client/src/fx/layer.ts:112-166` (constructor) and `:450` (`update`)

**Interfaces:**
- Consumes: `WeaponFxResolver` from Task 2.
- Produces: `emitterSpecsFor(event, resolve?)`, `emitterSpecsForAll(events, resolve?)`, `new FxLayer(scene, seed, w, h, resolveFx?)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/emitters.test.ts`:

```ts
describe("emitterSpecsFor with an injected resolver", () => {
  it("uses the resolver's row instead of the shipped one", () => {
    const resolve = () => ({
      muzzle: [
        { channel: "debris" as const, count: 3, speed: 10, lifeMs: 100, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: 1 },
      ],
      impact: [],
    });
    const specs = emitterSpecsFor(
      { kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 },
      resolve,
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]!.channel).toBe("debris");
  });

  it("defaults to the shipped table when no resolver is passed", () => {
    const specs = emitterSpecsFor({ kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 });
    expect(specs.map((s) => s.channel)).toEqual(["fire", "spark"]);
  });

  it("drops a burst whose count is zero (PG47)", () => {
    const resolve = () => ({
      muzzle: [
        { channel: "fire" as const, count: 0, speed: 10, lifeMs: 100, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: 1 },
        { channel: "spark" as const, count: 2, speed: 10, lifeMs: 100, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: 1 },
      ],
      impact: [],
    });
    const specs = emitterSpecsFor(
      { kind: "shotFired", weaponId: "lance", x: 0, y: 0, angle: 0 },
      resolve,
    );
    expect(specs.map((s) => s.channel)).toEqual(["spark"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- src/fx/emitters.test.ts`
Expected: FAIL — the resolver argument is ignored, so the first case returns the shipped `fire`/`spark` pair.

- [ ] **Step 3: Write the implementation**

In `packages/client/src/fx/emitters.ts`, add the import and change both exported functions:

```ts
import type { WeaponFxResolver } from "./tuning.js";
```

```ts
/**
 * Every burst one event asks for, placed at its pose.
 *
 * `resolve` defaults to the shipped table. The playground passes its own (spec PG46) — injected
 * rather than read from a module-level store, so a shipped arena or practice session cannot render
 * anything but `WEAPON_FX` no matter what a developer saved in this browser.
 */
export function emitterSpecsFor(
  event: FxEvent,
  resolve: WeaponFxResolver = weaponFxOf,
): EmitterSpec[] {
  const place = (bursts: readonly FxBurst[], angle: number): EmitterSpec[] =>
    bursts
      // PG47: a zero-count burst is dropped here rather than handed to `emitParticleAt`, so an off
      // channel costs no emitter call and none of `MAX_SPECS_PER_FRAME`.
      .filter((burst) => burst.count > 0)
      .map((burst) => ({ channel: burst.channel, x: event.x, y: event.y, angle, burst }));

  switch (event.kind) {
    case "shotFired":
      return place(resolve(event.weaponId).muzzle, event.angle);
    case "shotEnded":
      return place(resolve(event.weaponId).impact, event.angle);
    case "damaged":
      return place(damageBursts(event.amount), 0);
    case "died":
      return place(deathBursts(), 0);
  }
}

/** Every event's specs, flattened and capped at `MAX_SPECS_PER_FRAME`. */
export function emitterSpecsForAll(
  events: readonly FxEvent[],
  resolve: WeaponFxResolver = weaponFxOf,
): EmitterSpec[] {
  const specs: EmitterSpec[] = [];
  for (const event of events) {
    for (const spec of emitterSpecsFor(event, resolve)) {
      if (specs.length >= MAX_SPECS_PER_FRAME) return specs;
      specs.push(spec);
    }
  }
  return specs;
}
```

In `packages/client/src/fx/layer.ts`, add the import, a field, a constructor parameter, and one call-site change.

Type-only — `layer.ts` uses the resolver TYPE but never builds one; `fxResolverFor` belongs to the
playground's store (Task 4), not here:

```ts
import type { WeaponFxResolver } from "./tuning.js";
```

Add beside the other private fields (after `burstsSpawned`):

```ts
  /**
   * How this layer turns a weapon id into a row (spec PG46).
   *
   * Defaults to the shipped table, and every shipped scene leaves it at that default. Only the
   * playground passes one, which is what confines VFX overrides to that room by construction rather
   * than by discipline.
   */
  private readonly resolveFx: WeaponFxResolver;
```

Change the constructor signature and add one assignment as its first statement:

```ts
  constructor(
    scene: Phaser.Scene,
    seed: number,
    arenaWidth: number,
    arenaHeight: number,
    resolveFx: WeaponFxResolver = weaponFxOf,
  ) {
    this.scene = scene;
    this.resolveFx = resolveFx;
```

Add `weaponFxOf` to the existing `./table.js` import in `layer.ts` if it is not already there.

In `update`, change the one spawn call:

```ts
    this.spawn(emitterSpecsForAll(events, this.resolveFx));
```

- [ ] **Step 4: Run the fx suite and typecheck**

Run: `npm run test -w @motor-combat-moba/client -- src/fx`
Expected: PASS, including the existing `perf.test.ts` cases (the cap behaviour is unchanged — no shipped burst has `count: 0`).

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/emitters.ts packages/client/src/fx/emitters.test.ts packages/client/src/fx/layer.ts
git commit -m "feat: let FxLayer take an injected weapon-fx resolver (PG46, PG47)"
```

---

## Task 4: The live store, the playground room check, and the `ArenaScene` wiring

Implements **PG46** and the preview half of **PG52**.

**Files:**
- Create: `packages/client/src/fx/override-store.ts`
- Test: `packages/client/src/fx/override-store.test.ts`
- Modify: `packages/client/src/scenes/controlled-car.ts`
- Modify: `packages/client/src/scenes/controlled-car.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts:913-918`

**Interfaces:**
- Consumes: `resolveWeaponFx`, `FxOverrides`, `WeaponFxResolver` from Tasks 1-2; `EmitterSpec` from `fx/emitters.js`.
- Produces: `fxOverrides()`, `setFxOverrides(next)`, `liveFxResolver()`, `isPlaygroundRoom(room)`, `ArenaScene.previewFx(specs)`.

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/fx/override-store.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { weaponFxOf } from "./table.js";
import { fxOverrides, liveFxResolver, setFxOverrides } from "./override-store.js";

afterEach(() => setFxOverrides(null));

describe("the VFX override store", () => {
  it("starts empty", () => {
    expect(fxOverrides()).toEqual({});
  });

  it("holds what was set, and clears on null", () => {
    setFxOverrides({ "lance.muzzle.fire.count": 40 });
    expect(fxOverrides()["lance.muzzle.fire.count"]).toBe(40);
    setFxOverrides(null);
    expect(fxOverrides()).toEqual({});
  });

  it("gives a resolver that reads the store LIVE, not at construction", () => {
    const resolve = liveFxResolver();
    expect(resolve("lance")).toEqual(weaponFxOf("lance"));
    setFxOverrides({ "lance.muzzle.fire.count": 40 });
    expect(resolve("lance").muzzle.find((b) => b.channel === "fire")!.count).toBe(40);
  });
});
```

Append to `packages/client/src/scenes/controlled-car.test.ts` (and add `isPlaygroundRoom` to its import from `./controlled-car.js`):

```ts
describe("isPlaygroundRoom", () => {
  it("is true for the playground room and false for everything else", () => {
    expect(isPlaygroundRoom({ name: "playground" })).toBe(true);
    expect(isPlaygroundRoom({ name: "arena" })).toBe(false);
    expect(isPlaygroundRoom({ name: "practice" })).toBe(false);
    expect(isPlaygroundRoom({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @motor-combat-moba/client -- src/fx/override-store.test.ts src/scenes/controlled-car.test.ts`
Expected: FAIL — unresolved import `./override-store.js`, and `isPlaygroundRoom is not a function`.

- [ ] **Step 3: Write the implementations**

Create `packages/client/src/fx/override-store.ts`:

```ts
import { resolveWeaponFx, type FxOverrides, type WeaponFxResolver } from "./tuning.js";

/**
 * The live VFX override map (spec PG46, PG54).
 *
 * A module-level singleton for exactly the reason `config/view-options.ts` is one: the thing that
 * SETS it is a DOM overlay with no handle on the Phaser scene, and the thing that READS it is a
 * particle spawn several layers down.
 *
 * Being global is not what decides its reach. Only a playground room ever builds a resolver over it
 * (`ArenaScene`), so a shipped arena or practice session never reads a byte of this even when a
 * developer has a tuning session saved in the same browser. `PlaygroundScene` loads it on start and
 * clears it on shutdown, the same lifecycle `setTuning` and `setShowHitboxes` already follow.
 */
let current: FxOverrides = {};

export function fxOverrides(): FxOverrides {
  return current;
}

/** Replace the map. `null` clears it — what `PlaygroundScene.onShutdown` calls. */
export function setFxOverrides(next: FxOverrides | null): void {
  current = next ?? {};
}

/**
 * A resolver that reads the store at CALL time.
 *
 * Not `fxResolverFor(fxOverrides())`: the panel edits the map while the `FxLayer` that will render
 * the next burst already exists, so a resolver that captured the map at construction would render
 * the state the panel opened with until the next arena restart.
 */
export function liveFxResolver(): WeaponFxResolver {
  return (weaponId) => resolveWeaponFx(weaponId, current);
}
```

Append to `packages/client/src/scenes/controlled-car.ts`:

```ts
/**
 * Is this the dev-only playground room (spec PG46)?
 *
 * Read off the room's own name for the same reason `isPracticeRoom` above is: a scene-set flag can
 * go stale — tune VFX in the playground, exit, join a real match, and a flag nobody cleared would
 * render that match with overrides — while a room's name cannot.
 */
export function isPlaygroundRoom(room: { name?: string }): boolean {
  return room.name === PLAYGROUND_ROOM_NAME;
}
```

Add `PLAYGROUND_ROOM_NAME` to the existing `@motor-combat-moba/shared` import at the top of that file.

In `packages/client/src/scenes/ArenaScene.ts`, add the imports:

```ts
import { liveFxResolver } from "../fx/override-store.js";
import type { EmitterSpec } from "../fx/emitters.js";
```

and add `isPlaygroundRoom` to the existing `./controlled-car.js` import.

Change the `FxLayer` construction at line 913 (`this.room` is already assigned at line 857, well before this point):

```ts
    this.fx = new FxLayer(
      this,
      this.arena.width * 31 + this.arena.height,
      this.arena.width,
      this.arena.height,
      // Only a playground room resolves through the override store (spec PG46). Everything else
      // gets the default and renders shipped WEAPON_FX.
      this.room && isPlaygroundRoom(this.room) ? liveFxResolver() : undefined,
    );
```

Add a public method beside `previewFx`'s neighbours — put it directly after the `update` method's closing brace, near the other public entry points:

```ts
  /**
   * Spawn a burst straight into the fx layer, bypassing event derivation (spec PG51).
   *
   * The playground's VFX panel calls this through `PlaygroundScene`. It deliberately does NOT go
   * through `deriveFxEvents`: there is no state delta to derive from on a frozen field, and a
   * synthetic event would land in `lastEvents()`, which this scene reads for camera shake. A
   * preview must not shake the camera.
   *
   * A no-op before `create` has built the layer and after `shutdown` has dropped it, which is what
   * makes it safe to call from a timer that outlives an arena restart.
   */
  previewFx(specs: readonly EmitterSpec[]): void {
    this.fx?.spawn(specs);
  }
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm run test -w @motor-combat-moba/client -- src/fx/override-store.test.ts src/scenes/controlled-car.test.ts`
Expected: PASS.

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/override-store.ts packages/client/src/fx/override-store.test.ts packages/client/src/scenes/controlled-car.ts packages/client/src/scenes/controlled-car.test.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat: wire the VFX override store to playground rooms only (PG46, PG51)"
```

---

## Task 5: Persisting the overrides

Implements **PG54**.

**Files:**
- Modify: `packages/client/src/dev/playground/storage.ts`
- Modify: `packages/client/src/dev/playground/storage.test.ts`

**Interfaces:**
- Consumes: `FxOverrides`, `FX_FIELDS`, `FX_CHANNELS`, `FX_PHASES`, `fxKey` from Task 1.
- Produces: `StoredPlayground.vfx: FxOverrides`, `sanitizeStoredVfx(value)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/dev/playground/storage.test.ts`:

```ts
describe("the stored vfx section (PG54)", () => {
  it("is empty for a blob saved before it existed", () => {
    const raw = JSON.stringify({ setup: defaultPlaygroundSetup(), overrides: {} });
    expect(decodeStored(raw).vfx).toEqual({});
  });

  it("round-trips a valid entry", () => {
    const stored = {
      setup: defaultPlaygroundSetup(),
      overrides: {},
      view: { showHitbox: false },
      vfx: { "lance.muzzle.fire.count": 40, "predator.muzzle.smoke.soot": true },
    };
    expect(decodeStored(encodeStored(stored)).vfx).toEqual(stored.vfx);
  });

  it("drops a malformed key without losing the valid ones beside it", () => {
    const raw = JSON.stringify({
      setup: defaultPlaygroundSetup(),
      vfx: {
        "lance.muzzle.fire.count": 40,
        "lance.muzzle.fire": 3, // too few segments
        "no-such-weapon.muzzle.fire.count": 3, // unknown weapon
        "lance.launch.fire.count": 3, // unknown phase
        "lance.muzzle.glitter.count": 3, // unknown channel
        "lance.muzzle.fire.sparkle": 3, // unknown field
      },
    });
    expect(decodeStored(raw).vfx).toEqual({ "lance.muzzle.fire.count": 40 });
  });

  it("drops a value of the wrong type or out of range", () => {
    const raw = JSON.stringify({
      setup: defaultPlaygroundSetup(),
      vfx: {
        "lance.muzzle.fire.count": "40", // string where a number belongs
        "lance.muzzle.fire.soot": 1, // number where a boolean belongs
        "lance.muzzle.fire.speed": 99999, // outside the field's range
        "lance.muzzle.fire.alpha": 0.5, // fine
      },
    });
    expect(decodeStored(raw).vfx).toEqual({ "lance.muzzle.fire.alpha": 0.5 });
  });

  it("survives a vfx section that is not an object", () => {
    const raw = JSON.stringify({ setup: defaultPlaygroundSetup(), vfx: "nope" });
    expect(decodeStored(raw).vfx).toEqual({});
  });
});
```

Add `encodeStored` to the test file's imports if it is not already there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- src/dev/playground/storage.test.ts`
Expected: FAIL — `decodeStored(...).vfx` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `packages/client/src/dev/playground/storage.ts`, add the imports:

```ts
import { isWeaponId } from "@motor-combat-moba/shared";
import {
  FX_CHANNELS,
  FX_FIELDS,
  FX_PHASES,
  toControl,
  type FxOverrides,
} from "../../fx/tuning.js";
```

Add the field to the interface:

```ts
export interface StoredPlayground {
  setup: PlaygroundSetup;
  overrides: TuningOverrides;
  view: StoredView;
  /** The playground's VFX overrides (spec PG54). Client-only, like `view` — never sent anywhere. */
  vfx: FxOverrides;
}
```

Add the codec above `decodeStored`:

```ts
/**
 * Read the `vfx` section back, entry by entry, dropping anything that no longer makes sense.
 *
 * Lenient in the same way `sanitizeStoredTuning` is, and for the same reason (PG54): a stale key
 * left by a renamed weapon, a retuned range, or a hand-edited blob must cost that one entry, never
 * the whole tuning session. Range is checked in CONTROL units, which is what `FX_FIELDS` bounds
 * are expressed in — a `coneRad` of `TAU` is 360 there, comfortably inside 0-360.
 */
export function sanitizeStoredVfx(value: unknown): FxOverrides {
  if (!isPlainRecord(value)) return {};
  const out: FxOverrides = {};
  for (const [key, raw] of Object.entries(value)) {
    const parts = key.split(".");
    if (parts.length !== 4) continue;
    const [weaponId, phase, channel, fieldName] = parts as [string, string, string, string];
    if (!isWeaponId(weaponId)) continue;
    if (!FX_PHASES.some((p) => p === phase)) continue;
    if (!FX_CHANNELS.some((c) => c === channel)) continue;
    const field = FX_FIELDS.find((f) => f.name === fieldName);
    if (!field) continue;
    if (field.kind === "boolean") {
      if (typeof raw !== "boolean") continue;
      out[key] = raw;
      continue;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const control = toControl(field, raw);
    if (control < field.min || control > field.max) continue;
    out[key] = raw;
  }
  return out;
}
```

Add the section to `decodeStored`'s return object:

```ts
    view: decodeView(rec.view),
    vfx: sanitizeStoredVfx(rec.vfx),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- src/dev/playground/storage.test.ts`
Expected: PASS.

`vfx` is required on `StoredPlayground`, so the one existing `saveStored({...})` call site — in
`overlay.ts`'s `persist()` at line ~590, the only one in the codebase — stops typechecking. Keep the
tree green by adding the section to it now, carrying whatever is already stored:

```ts
    function persist(): void {
      saveStored({
        setup: readSetup(),
        overrides: { ...overrides },
        view: { showHitbox: hitboxToggle.checked },
        // Carried through unchanged: the physics panel does not edit VFX, and a save from here must
        // not wipe a tuning session. Task 7 replaces this with the panel's own live map.
        vfx: loadStored().vfx,
      });
    }
```

Then run `npm run typecheck -w @motor-combat-moba/client` and confirm it is CLEAN before committing.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/playground/storage.ts packages/client/src/dev/playground/storage.test.ts
git commit -m "feat: persist VFX overrides in the playground storage blob (PG54)"
```

---

## Task 6: Two panels in the menu

Implements **PG41**.

**Files:**
- Modify: `packages/client/src/dev/playground/ui-model.ts:11` and `:26-32`
- Modify: `packages/client/src/dev/playground/ui-model.test.ts`
- Modify: `packages/client/src/dev/playground/overlay.ts` (view routing, menu, header)

**Interfaces:**
- Produces: `OverlayView = "hidden" | "menu" | "physics" | "vfx"`.

- [ ] **Step 1: Write the failing test**

In `packages/client/src/dev/playground/ui-model.test.ts`, replace every `pauseKeyAction` case naming `"settings"` with these:

```ts
describe("pauseKeyAction", () => {
  it("backs out of either settings panel without touching pause", () => {
    expect(pauseKeyAction("physics", "DIV")).toBe("back-to-menu");
    expect(pauseKeyAction("vfx", "DIV")).toBe("back-to-menu");
  });

  it("toggles pause from the menu and from gameplay", () => {
    expect(pauseKeyAction("menu", "DIV")).toBe("toggle");
    expect(pauseKeyAction("hidden", "DIV")).toBe("toggle");
  });

  it("ignores the key inside a form control, in every view", () => {
    // All three FORM_CONTROL_TAGS members, in both cases: dropping any one of them from that set
    // must fail a test, and the match is case-insensitive.
    for (const view of ["hidden", "menu", "physics", "vfx"] as const) {
      for (const tag of ["INPUT", "SELECT", "TEXTAREA", "input", "select", "textarea"]) {
        expect(pauseKeyAction(view, tag)).toBe("ignore");
      }
    }
  });

  it("matches the tag case-insensitively on the toggle path too", () => {
    expect(pauseKeyAction("menu", "body")).toBe("toggle");
    expect(pauseKeyAction("hidden", "div")).toBe("toggle");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- src/dev/playground/ui-model.test.ts`
Expected: FAIL — TypeScript rejects `"physics"` and `"vfx"` as `OverlayView` values.

- [ ] **Step 3: Write the implementation**

In `ui-model.ts`, change the type and the function:

```ts
/**
 * `"hidden"` while the sim is unpaused; the other three are the paused sub-screens (spec PG41 —
 * `"physics"` is what was called `"settings"` before the VFX panel joined it).
 */
export type OverlayView = "hidden" | "menu" | "physics" | "vfx";
```

```ts
export function pauseKeyAction(
  view: OverlayView,
  targetTag: string,
): "toggle" | "back-to-menu" | "ignore" {
  if (FORM_CONTROL_TAGS.has(targetTag.toUpperCase())) return "ignore";
  // Either settings panel backs out to the menu without touching pause; the sim stays frozen.
  if (view === "physics" || view === "vfx") return "back-to-menu";
  return "toggle";
}
```

Update the doc comment above it: replace "settings backs out to the menu" with "either settings panel backs out to the menu".

In `overlay.ts`:

1. Change the `subView` declaration (line ~440):

```ts
  let subView: "menu" | "physics" | "vfx" = "menu";
```

2. Change `render()` to route three views:

```ts
  function render(): void {
    root.replaceChildren();
    const view = effectiveView();
    root.style.display = view === "hidden" ? "none" : "flex";
    if (view === "menu") root.appendChild(buildMenu());
    else if (view === "physics") root.appendChild(buildSettings());
    else if (view === "vfx") root.appendChild(buildVfxPanel());
  }
```

3. Add the menu entry and rename the existing one:

```ts
  function buildMenu(): HTMLElement {
    return h("div", { class: "pg-panel" }, [
      h("h2", {}, ["Paused"]),
      button({}, ["Resume"], () => room.send(MSG_PLAYGROUND_PAUSE)),
      button({}, ["Switch car"], () => room.send(MSG_PLAYGROUND_SWITCH)),
      button({}, ["Physics settings"], () => {
        subView = "physics";
        render();
      }),
      button({}, ["VFX settings"], () => {
        subView = "vfx";
        render();
      }),
    ]);
  }
```

4. Rename the panel header (line ~878): `h("h2", {}, ["Settings"])` becomes `h("h2", {}, ["Physics settings"])`.

5. Add a placeholder `buildVfxPanel` immediately above `buildSettings`, so this task compiles on its own. Task 7 replaces its body:

```ts
  /** The VFX settings panel (spec PG48). Body lands in Task 7. */
  function buildVfxPanel(): HTMLElement {
    return h("div", { class: "pg-panel pg-settings" }, [
      h("div", { class: "pg-settings-header" }, [
        h("h2", {}, ["VFX settings"]),
        button({}, ["Back"], () => {
          subView = "menu";
          render();
        }),
      ]),
    ]);
  }
```

6. In `leaveSettings`'s default binding and in its reassignment, `subView = "menu"` is unchanged — no edit needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- src/dev/playground/ui-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, open `http://localhost:5173/?dev=playground`, press `P`.
Expected: four menu buttons. "Physics settings" opens the existing panel with its header reading "Physics settings"; "VFX settings" opens an empty panel with a working Back button; `P` backs out of both.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/dev/playground/ui-model.ts packages/client/src/dev/playground/ui-model.test.ts packages/client/src/dev/playground/overlay.ts
git commit -m "feat: split the playground menu into Physics and VFX settings (PG41)"
```

---

## Task 7: The VFX panel

Implements **PG48** (layout), **PG49** (controls), **PG50** (`soot` disabled off smoke), and the editing half of **PG43**.

**Files:**
- Create: `packages/client/src/dev/playground/vfx-panel.ts`
- Modify: `packages/client/src/dev/playground/overlay.ts` (replace the Task 6 placeholder; extend CSS)

**Interfaces:**
- Consumes: `FX_FIELDS`, `FX_CHANNELS`, `FX_PHASES`, `fxCellsFor`, `fxKey`, `toControl`, `fromControl`, `isFxAtShipped`, `FxOverrides` (Task 1); `setFxOverrides`, `fxOverrides` (Task 4); `weaponOptions` (`ui-model.ts`); `h`, `button` (`ui/dom.ts`).
- Produces: `buildVfxPanel(opts: VfxPanelOptions): HTMLElement`, `VfxPanelOptions`.

**Note on placement:** this lives in its own file because `overlay.ts` is already 934 lines. It follows the same rule that file states about itself — it builds nodes and wires events, and every decision it needs comes from `fx/tuning.ts`.

- [ ] **Step 1: Write the panel module**

Create `packages/client/src/dev/playground/vfx-panel.ts`:

```ts
import type { FxChannel } from "../../fx/table.js";
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
  type FxCell,
  type FxFieldDef,
  type FxOverrides,
  type FxPhase,
} from "../../fx/tuning.js";
import { button, h } from "../../ui/dom.js";
import { weaponOptions } from "./ui-model.js";

/**
 * The VFX settings panel (spec PG48).
 *
 * A DOM shell like `overlay.ts`, and untested for the same reason — every decision it makes comes
 * from `fx/tuning.ts`, which is tested. Its own job is nodes, events, and calling back.
 *
 * One weapon renders at a time. Eight cells of eight controls is already ~64 controls; ten weapons
 * at once would be 640, and a full rebuild on every slider input.
 */

export interface VfxPanelOptions {
  /** The live map. Mutated in place, exactly as the physics panel mutates its own `overrides`. */
  readonly overrides: FxOverrides;
  /** Save to localStorage. Called after every edit (spec PG19's rule, applied here). */
  readonly persist: () => void;
  /** Replay what is currently selected. Called after every edit and by the Fire button. `"all"`
   * widens the selection: every phase, every channel, or both. */
  readonly preview: (
    weaponId: string,
    phase: FxPhase | "all",
    channel: FxChannel | "all",
  ) => void;
  /** Leave the panel. Clears the replay timer and returns to the menu. */
  readonly onBack: () => void;
  /** Copy the export to the clipboard (Task 9). */
  readonly onCopy: () => void;
}

/** How a collapsed channel block states its own condition, so a weapon's shape reads at a glance. */
function channelSummary(count: number): string {
  return count > 0 ? `${count} ×` : "off";
}

export function buildVfxPanel(opts: VfxPanelOptions): HTMLElement {
  const weapons = weaponOptions();
  let weaponId: string = weapons[0]!.id;
  /** Which block is expanded, or `undefined` for none. Narrows the preview to that channel. */
  let expanded: { phase: FxPhase; channel: FxChannel } | undefined;

  const body = h("div", { class: "pg-stats" });

  const weaponSelect = h("select", {}, weapons.map((w) => h("option", { value: w.id }, [w.name])));
  weaponSelect.value = weaponId;
  weaponSelect.addEventListener("change", () => {
    weaponId = weaponSelect.value;
    expanded = undefined;
    renderBody();
    fire();
  });

  function fire(): void {
    // ONE call, even for the whole weapon. Calling `preview` once per phase would leave the replay
    // timer armed on whichever phase went last, so the other would flash once and never repeat.
    if (expanded) opts.preview(weaponId, expanded.phase, expanded.channel);
    else opts.preview(weaponId, "all", "all");
  }

  /** One slider (or checkbox) for one field of one cell, wired straight into the overrides map. */
  function fieldRow(
    phase: FxPhase,
    channel: FxChannel,
    field: FxFieldDef,
    refreshHeader: () => void,
  ): HTMLElement {
    const key = fxKey(weaponId, phase, channel, field.name);
    const shipped = shippedBurstFor(weaponId, phase, channel)[field.name];
    const current = burstFor(weaponId, phase, channel, opts.overrides)[field.name];

    const shippedControl =
      field.kind === "number" ? toControl(field, shipped as number) : (shipped as boolean);
    const currentControl =
      field.kind === "number" ? toControl(field, current as number) : (current as boolean);

    const valueSpan = h("span", { class: "pg-value" }, [readout(field, currentControl)]);

    let control: HTMLInputElement;
    let read: () => number | boolean;

    if (field.kind === "number") {
      control = h("input", {
        type: "range",
        min: String(field.min),
        max: String(field.max),
        step: String(field.step),
      }) as HTMLInputElement;
      control.value = String(currentControl);
      read = () => Number(control.value);
    } else {
      control = h("input", { type: "checkbox", checked: Boolean(currentControl) }) as HTMLInputElement;
      read = () => control.checked;
      // PG50: rendered on every row so the grid stays rectangular, live on smoke alone. An inert
      // control that looks live is worse than one that plainly is not.
      control.disabled = field.smokeOnly && channel !== "smoke";
    }

    function snapToShipped(): void {
      delete opts.overrides[key];
      control.value = String(shippedControl);
      if (field.kind === "boolean") control.checked = Boolean(shippedControl);
      valueSpan.textContent = readout(field, shippedControl);
    }

    function onEdit(): void {
      const value = read();
      if (isFxAtShipped(field, value, shippedControl)) {
        snapToShipped();
      } else {
        opts.overrides[key] = field.kind === "number" ? fromControl(field, value as number) : value;
        valueSpan.textContent = readout(field, value);
      }
      opts.persist();
      // `count` decides whether the cell fires at all, so its collapsed header goes stale. Refresh
      // that ONE text node rather than calling `renderBody()`: a range input fires `input` on every
      // pointer move, and replacing the panel's children mid-drag destroys the very slider the
      // pointer is captured on — the replacement node never saw the initiating `mousedown`, so the
      // drag is stranded until the user releases and grabs again.
      if (field.name === "count") refreshHeader();
      fire();
    }

    control.addEventListener(field.kind === "number" ? "input" : "change", onEdit);

    return h("div", { class: "pg-row pg-stat-row" }, [
      h("label", { title: key }, [`${field.label} (shipped ${readout(field, shippedControl)})`]),
      control,
      valueSpan,
      button({ class: "pg-reset", title: "Reset to shipped" }, ["↺"], () => {
        snapToShipped();
        opts.persist();
        if (field.name === "count") refreshHeader();
        fire();
      }),
    ]);
  }

  function readout(field: FxFieldDef, value: number | boolean): string {
    if (typeof value === "boolean") return value ? "on" : "off";
    const rounded = field.step < 1 ? value.toFixed(2) : String(Math.round(value));
    return field.degrees ? `${rounded}°` : rounded;
  }

  function channelBlock(cell: FxCell): HTMLElement {
    const { phase, channel } = cell;
    const isOpen = expanded?.phase === phase && expanded.channel === channel;

    const label = (count: number): string => `${channel} — ${channelSummary(count)}`;

    const header = button({ class: "pg-fx-head" }, [label(cell.current.count)], () => {
      expanded = isOpen ? undefined : { phase, channel };
      renderBody();
      fire();
    });

    /** Repaint just this header from the live map. See `onEdit` for why this is not a `renderBody`. */
    const refreshHeader = (): void => {
      header.textContent = label(burstFor(weaponId, phase, channel, opts.overrides).count);
    };

    const rows = isOpen
      ? FX_FIELDS.map((field) => fieldRow(phase, channel, field, refreshHeader))
      : [];
    return h("div", { class: "pg-fx-block" }, [header, ...rows]);
  }

  function renderBody(): void {
    // One grid computation per render rather than one per block: `fxCellsFor` builds all eight
    // cells on every call, so calling it inside `channelBlock` built the grid eight times.
    const cells = fxCellsFor(weaponId, opts.overrides);
    body.replaceChildren(
      ...FX_PHASES.flatMap((phase) => [
        h("div", { class: "pg-fx-phase" }, [phase]),
        ...FX_CHANNELS.map((channel) =>
          channelBlock(cells.find((c) => c.phase === phase && c.channel === channel)!),
        ),
      ]),
    );
  }

  const resetAllBtn = button({}, ["Reset all"], () => {
    for (const key of Object.keys(opts.overrides)) delete opts.overrides[key];
    opts.persist();
    renderBody();
    fire();
  });

  renderBody();

  return h("div", { class: "pg-panel pg-settings pg-vfx" }, [
    h("div", { class: "pg-settings-header" }, [
      h("h2", {}, ["VFX settings"]),
      button({}, ["Back"], () => opts.onBack()),
    ]),
    h("div", { class: "pg-row" }, [h("label", {}, ["Weapon"]), weaponSelect]),
    h("div", { class: "pg-stats-toolbar" }, [
      resetAllBtn,
      button({}, ["Copy overrides"], () => opts.onCopy()),
      button({}, ["Fire"], () => fire()),
    ]),
    body,
  ]);
}
```

- [ ] **Step 2: Wire it into the overlay**

In `overlay.ts`, replace the Task 6 placeholder `buildVfxPanel` with a call into the new module. Add the import:

```ts
import { buildVfxPanel as buildVfxPanelDom } from "./vfx-panel.js";
```

and replace the placeholder function:

```ts
  /**
   * The VFX settings panel (spec PG48). Its own module; this wires it to the overlay's storage,
   * preview and navigation. `vfxOverrides` is the same live object the store holds, mutated in
   * place, so an edit is visible to the next burst without a re-install.
   */
  function buildVfxPanel(): HTMLElement {
    return buildVfxPanelDom({
      overrides: vfxOverrides,
      persist: persistVfx,
      preview: () => {
        /* Task 8 */
      },
      onBack: () => {
        subView = "menu";
        render();
      },
      onCopy: () => {
        /* Task 9 */
      },
    });
  }
```

Add, just below the `subView` declaration near the top of `mountPlaygroundOverlay`:

```ts
  /** The live VFX override map, shared with the fx store so an edit reaches the next burst (PG46).
   * Loaded once per mount and mutated in place by the panel. */
  const vfxOverrides: FxOverrides = { ...loadStored().vfx };
  setFxOverrides(vfxOverrides);

  /** Saves the VFX section without disturbing the physics panel's own save path, which reads its
   * live DOM controls and is not available outside `buildSettings`. */
  function persistVfx(): void {
    const stored = loadStored();
    saveStored({ ...stored, vfx: { ...vfxOverrides } });
  }
```

Add the imports `setFxOverrides` from `../../fx/override-store.js` and `type FxOverrides` from `../../fx/tuning.js`.

In `buildSettings`'s own `persist()`, add the section so a physics save does not wipe the VFX one:

```ts
    function persist(): void {
      saveStored({
        setup: readSetup(),
        overrides: { ...overrides },
        view: { showHitbox: hitboxToggle.checked },
        vfx: { ...vfxOverrides },
      });
    }
```

- [ ] **Step 3: Add the CSS**

Append to the `CSS` template literal in `overlay.ts`:

```css
.pg-vfx { min-width: 460px; }
.pg-fx-phase {
  margin: 12px 0 4px;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #9aa0a6;
}
.pg-fx-block { border: 1px solid #333; border-radius: 4px; margin: 4px 0; }
.pg-fx-head {
  width: 100%;
  margin: 0;
  text-align: left;
  border: none;
  border-radius: 4px;
  background: #23262b;
  text-transform: capitalize;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: no errors except in `PlaygroundScene.ts`, whose `saveStored` call Task 10 fixes.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, open `?dev=playground`, press `P`, open VFX settings.
Expected: a weapon select, two phase headings, four collapsible channel blocks each reading `smoke — off` / `fire — 8 ×` and so on. Expanding a block shows eight rows. `soot` is greyed out on fire, spark and debris. Dragging `count` to 0 flips the header to `off`. Switching weapons rebuilds the grid; `wildcharge` shows the default row's shape.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/dev/playground/vfx-panel.ts packages/client/src/dev/playground/overlay.ts
git commit -m "feat: add the playground VFX settings panel (PG43, PG48-PG50)"
```

---

## Task 8: The preview

Implements **PG51** (auto-replay + Fire) and **PG52** (late-resolved scene reference, three timer exits).

**Files:**
- Modify: `packages/client/src/dev/playground/overlay.ts`
- Modify: `packages/client/src/dev/PlaygroundScene.ts`

**Interfaces:**
- Consumes: `ArenaScene.previewFx` (Task 4); `emitterSpecsFor` (Task 3); the `preview` callback shape from Task 7.
- Produces: `mountPlaygroundOverlay(room, onArenaChanged, previewFx)` — a third parameter.

- [ ] **Step 1: Add the replay constants and timer to the overlay**

In `overlay.ts`, add near the other module constants above `mountPlaygroundOverlay`:

```ts
/**
 * How often the VFX panel replays the burst being edited (spec PG51).
 *
 * Long enough that a 3-second smoke column has thinned before the next one lands, short enough that
 * a slider drag shows its result without reaching for the Fire button.
 */
const VFX_REPLAY_MS = 1500;

/**
 * Where a previewed burst is spawned, in world units.
 *
 * Off-centre so the panel — which sits centred — does not cover it. Fixed rather than derived from
 * the arena, so the spot does not move when the arena changes under a panel that is already open.
 */
const VFX_PREVIEW_POS = { x: 260, y: 300 } as const;
```

Change the mount signature and add the timer:

```ts
export function mountPlaygroundOverlay(
  room: Room<PlaygroundState>,
  onArenaChanged: () => void,
  previewFx: (specs: readonly EmitterSpec[]) => void,
): () => void {
```

Add beside `vfxOverrides`:

```ts
  /** The VFX panel's replay timer (spec PG52). Cleared on leaving the panel, on unmount, and on an
   * arena change — a timer firing into a torn-down scene is this feature's likeliest bug. */
  let replayTimer: ReturnType<typeof setInterval> | undefined;

  function stopReplay(): void {
    if (replayTimer !== undefined) clearInterval(replayTimer);
    replayTimer = undefined;
  }

  /**
   * Build and spawn one preview. `"all"` widens either axis (spec PG51); returns whether anything
   * was actually spawned, so the caller does not arm a replay for a selection that is entirely off.
   */
  function firePreview(
    weaponId: string,
    phase: FxPhase | "all",
    channel: FxChannel | "all",
  ): boolean {
    const row = resolveWeaponFx(weaponId, vfxOverrides);
    const phases: readonly FxPhase[] = phase === "all" ? FX_PHASES : [phase];
    const specs: EmitterSpec[] = [];
    for (const p of phases) {
      for (const burst of row[p]) {
        if (channel !== "all" && burst.channel !== channel) continue;
        specs.push({
          channel: burst.channel,
          x: VFX_PREVIEW_POS.x,
          y: VFX_PREVIEW_POS.y,
          // Muzzle bursts are cones; firing them along +x points them away from the panel.
          angle: 0,
          burst,
        });
      }
    }
    if (specs.length === 0) return false;
    // Built by hand rather than through `deriveFxEvents`: a synthetic event would land in
    // `lastEvents()`, which `ArenaScene` reads for camera shake, and a preview must not shake.
    previewFx(specs);
    return true;
  }
```

Rewrite the panel's wiring to arm the timer:

```ts
  function buildVfxPanel(): HTMLElement {
    let last: { weaponId: string; phase: FxPhase | "all"; channel: FxChannel | "all" } | undefined;

    const preview = (
      weaponId: string,
      phase: FxPhase | "all",
      channel: FxChannel | "all",
    ): void => {
      last = { weaponId, phase, channel };
      const fired = firePreview(weaponId, phase, channel);
      stopReplay();
      // Nothing in the selection is switched on, so there is nothing to replay. The next edit
      // re-arms; an interval that spawns nothing 40 times a minute is just noise.
      if (!fired) return;
      replayTimer = setInterval(() => {
        if (last) firePreview(last.weaponId, last.phase, last.channel);
      }, VFX_REPLAY_MS);
    };

    return buildVfxPanelDom({
      overrides: vfxOverrides,
      persist: persistVfx,
      preview,
      onBack: () => {
        stopReplay();
        subView = "menu";
        render();
      },
      onCopy: () => {
        /* Task 9 */
      },
    });
  }
```

Add `stopReplay()` to the other exit — inside `onState` (so a resume stops it) and in `unmount`:

```ts
  function onState(): void {
    if (room.state.paused === wasPaused) return;
    wasPaused = room.state.paused;
    if (!wasPaused) {
      subView = "menu";
      stopReplay();
    }
    render();
  }
```

```ts
  return function unmount(): void {
    stopReplay();
    window.removeEventListener("keydown", onKeyDown);
    // ... rest unchanged
  };
```

Also call `stopReplay()` at the top of the `pauseKeyAction` `"back-to-menu"` branch in `onKeyDown`, so P leaves the panel the same way the Back button does:

```ts
    } else if (action === "back-to-menu") {
      if (effectiveView() === "vfx") {
        stopReplay();
        subView = "menu";
        render();
        return;
      }
      leaveSettings();
    }
```

Add the imports: `EmitterSpec` from `../../fx/emitters.js`, `resolveWeaponFx` and `type FxPhase` from `../../fx/tuning.js`, `type FxChannel` from `../../fx/table.js`.

- [ ] **Step 2: Supply the callback from `PlaygroundScene`**

In `PlaygroundScene.ts`, change the mount call:

```ts
    this.unmountOverlay = mountPlaygroundOverlay(
      room,
      () => this.onArenaChanged(),
      (specs) => this.previewFx(specs),
    );
```

and add the method, plus the `EmitterSpec` type import from `../fx/emitters.js` and `ArenaScene` from `../scenes/ArenaScene.js`:

```ts
  /**
   * Hand a preview burst to the running `ArenaScene` (spec PG52).
   *
   * Resolved at CALL time, never held: `onArenaChanged` stops and relaunches that scene while the
   * overlay is mounted once and outlives it, so a reference captured when the panel opened would be
   * a use-after-destroy on the next arena change. `ArenaScene.previewFx` no-ops when its own layer
   * is gone, which covers the window between the stop and the relaunch.
   */
  private previewFx(specs: readonly EmitterSpec[]): void {
    const arena = this.scene.get("arena") as ArenaScene | undefined;
    arena?.previewFx?.(specs);
  }
```

An arena change needs no exit of its own (spec PG52): the timer keeps running, `previewFx` resolves the scene at call time and no-ops through the restart window, and the preview then resumes into the new layer — which is what a developer with the panel open wants. Say so in `previewFx`'s comment.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: errors only in `PlaygroundScene.ts`'s `saveStored` call, fixed in Task 10.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`, open `?dev=playground`, pause, open VFX settings, pick `magmablast`, expand `impact` → `fire`.
Expected: a fire burst replays roughly every 1.5s at a fixed spot left of the panel. Dragging `size` changes the next replay. `Fire` triggers one immediately. Collapsing the block widens the replay to the whole phase. Leaving the panel, resuming, or changing the arena stops it — verify no burst appears after Back, and that the browser console shows no errors after an arena change with the panel open.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/playground/overlay.ts packages/client/src/dev/PlaygroundScene.ts
git commit -m "feat: replay the edited VFX burst in the panel (PG51, PG52)"
```

---

## Task 9: The export

Implements **PG53**.

**Files:**
- Modify: `packages/client/src/fx/tuning.ts`
- Modify: `packages/client/src/fx/tuning.test.ts`
- Modify: `packages/client/src/dev/playground/overlay.ts` (the `onCopy` callback)

**Interfaces:**
- Consumes: `resolveWeaponFx` (Task 2).
- Produces: `fxTableSource(overrides): string`.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/tuning.test.ts` (add `fxTableSource` to the imports):

```ts
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

  it("omits a burst switched off", () => {
    const source = fxTableSource({ "lance.muzzle.spark.count": 0 });
    expect(source).not.toContain('channel: "spark"');
  });

  it("is valid TypeScript that reproduces the resolved row", () => {
    const overrides = { "lance.muzzle.fire.count": 40, "lance.impact.debris.count": 6 };
    const source = fxTableSource(overrides);
    // Evaluate the fragment as an object literal and compare it to what the sim would render.
    const TAU = Math.PI * 2;
    const parsed = new Function("TAU", `return {${source}};`)(TAU) as Record<string, unknown>;
    expect(parsed.lance).toEqual(resolveWeaponFx("lance", overrides));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @motor-combat-moba/client -- src/fx/tuning.test.ts`
Expected: FAIL — `fxTableSource is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `packages/client/src/fx/tuning.ts`:

```ts
/** A number as source: `TAU` where it is exactly that, otherwise trimmed to four decimals. */
function numberSource(field: FxFieldName, value: number): string {
  if (field === "coneRad" && value === TAU) return "TAU";
  return String(Number(value.toFixed(4)));
}

function burstSource(burst: FxBurst): string {
  const fields = FX_FIELDS.map((field) => {
    const value = burst[field.name];
    const source = typeof value === "boolean" ? String(value) : numberSource(field.name, value);
    return `${field.name}: ${source}`;
  });
  return `{ channel: "${burst.channel}", ${fields.join(", ")} }`;
}

/**
 * The overrides as a pasteable `WEAPON_FX` fragment (spec PG53).
 *
 * The destination is `packages/client/src/fx/table.ts`, not a JSON blob a codec reads back — which
 * is why this emits source rather than the JSON the physics panel's Copy button produces. Full rows
 * are emitted, in `table.ts`'s own shape, for every weapon the developer actually touched; an
 * untouched weapon is absent, so pasting the result can never rewrite a row nobody edited.
 *
 * Empty string when nothing is overridden — there is nothing to paste.
 */
export function fxTableSource(overrides: FxOverrides): string {
  const weaponIds = [
    ...new Set(Object.keys(overrides).map((key) => key.slice(0, Math.max(0, key.indexOf("."))))),
  ].filter((id) => id.length > 0);
  if (weaponIds.length === 0) return "";

  const rows = weaponIds.map((weaponId) => {
    const row = resolveWeaponFx(weaponId, overrides);
    const phase = (bursts: readonly FxBurst[]): string =>
      bursts.length === 0
        ? "[]"
        : `[\n${bursts.map((b) => `      ${burstSource(b)},`).join("\n")}\n    ]`;
    return [
      `  ${weaponId}: {`,
      `    muzzle: ${phase(row.muzzle)},`,
      `    impact: ${phase(row.impact)},`,
      `  },`,
    ].join("\n");
  });

  return rows.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @motor-combat-moba/client -- src/fx/tuning.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the Copy button**

In `overlay.ts`, replace the `onCopy` placeholder:

```ts
      onCopy: () => {
        const source = fxTableSource(vfxOverrides);
        copyText(source === "" ? "// no VFX overrides to copy" : source);
      },
```

Extract the physics panel's existing clipboard logic into a shared helper beside `persistVfx`, and have the physics `copyBtn` call it too, so there is one copy path rather than two:

```ts
  /** Clipboard with the same guarded fallback the physics panel has always used: no Clipboard API
   * (older browser, insecure context) falls back to a selectable textarea plus a console dump. */
  function copyText(text: string, before?: Element): void {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (clipboard && typeof clipboard.writeText === "function") {
      void clipboard.writeText(text);
      return;
    }
    console.log(text);
    const host = before ?? root.querySelector(".pg-stats");
    host?.parentElement?.querySelector(".pg-copy-fallback")?.remove();
    const ta = h("textarea", { class: "pg-copy-fallback", readonly: true }) as HTMLTextAreaElement;
    ta.value = text;
    host?.before(ta);
    ta.select();
  }
```

Replace the body of the physics `copyBtn` handler with `copyText(JSON.stringify(overrides, null, 2), statsContainer)`.

Add `fxTableSource` to the `../../fx/tuning.js` import.

- [ ] **Step 6: Typecheck and verify in the browser**

Run: `npm run typecheck -w @motor-combat-moba/client`

Run: `npm run dev`, open the VFX panel, change `lance`'s muzzle fire count, click Copy overrides, paste into a scratch file.
Expected: a `lance: { muzzle: [...], impact: [...] },` block that drops straight into `WEAPON_FX` in `table.ts`. Verify the physics panel's Copy overrides still produces its JSON.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/fx/tuning.ts packages/client/src/fx/tuning.test.ts packages/client/src/dev/playground/overlay.ts
git commit -m "feat: export VFX overrides as a pasteable table.ts fragment (PG53)"
```

---

## Task 10: Scene lifecycle, docs, and the full suite

Implements **PG54**'s lifecycle half, and closes the plan.

**Files:**
- Modify: `packages/client/src/dev/PlaygroundScene.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Load and clear the store**

In `PlaygroundScene.ts`'s `connect()`, beside the existing `setShowHitboxes(stored.view.showHitbox)`:

```ts
    // Client-only, like the hitbox toggle above: the server has no opinion about how a weapon looks
    // on this browser. Loaded BEFORE `scene.launch("arena")` below, so the ArenaScene that is about
    // to build its FxLayer already sees the overrides this browser saved (spec PG54).
    setFxOverrides(stored.vfx);
```

Confirm this line sits above the `this.scene.launch("arena")` call. In `onShutdown()`, beside `setShowHitboxes(false)`:

```ts
    setFxOverrides(null);
```

Extend that method's existing comment to name the third store: "...the same rule `PlaygroundRoom.onLeave` enforces server-side, mirrored here for the client-side tuning store, the view options and the VFX overrides."

Add the import:

```ts
import { setFxOverrides } from "../fx/override-store.js";
```

- [ ] **Step 2: Fix the remaining `saveStored` call**

`PlaygroundScene.ts` does not call `saveStored`, but confirm with:

Run: `npm run typecheck -w @motor-combat-moba/client`
Expected: **no errors at all** now. If any `saveStored` call still fails to typecheck, add `vfx: loadStored().vfx` to it.

- [ ] **Step 3: Document the spec**

In `CLAUDE.md`, in the "Read the right doc" table, extend the existing playground row so it names the new spec. Change the cell reading `..., and the ?dev=assets additions (PG24–PG40)` to end with:

```
(PG24–PG40); the VFX settings panel over `WEAPON_FX`, its preview and its export (PG41–PG55)
```

and append to that row's link cell:

```
, [`docs/superpowers/specs/2026-09-08-playground-vfx-settings-design.md`](docs/superpowers/specs/2026-09-08-playground-vfx-settings-design.md)
```

- [ ] **Step 4: Run the whole suite and build**

Run: `npm test`
Expected: PASS across shared, server, client and scripts.

Run: `npm run build`
Expected: clean. This is the root script, which builds shared → server → client in that order — never `npm run build --workspaces`.

- [ ] **Step 5: Confirm the release build is unaffected**

Run: `npm run build:release`
Expected: clean, and the dev-tool grep in `scripts/build-release.mjs` still passes — `vfx-panel.ts` is reached only from `overlay.ts`, which is already dev-gated, so no new marker is needed.

Verify by hand that `fx/tuning.ts` and `fx/override-store.ts` ARE in the release bundle (they are imported by `emitters.ts`/`ArenaScene.ts`) and that nothing in them reads a store a shipped scene writes:

Run: `grep -c "setFxOverrides" dist-release/motor-combat-moba/public/assets/*.js`
Expected: `0` — the only caller is `PlaygroundScene`, which is stripped.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/dev/PlaygroundScene.ts CLAUDE.md
git commit -m "feat: load and clear VFX overrides with the playground scene (PG54)"
```

---

## Manual acceptance

Run `npm run dev` and open `http://localhost:5173/?dev=playground`. Walk this list:

1. `P` opens a four-entry menu. **Physics settings** opens the old panel, header renamed.
2. **VFX settings** opens the grid. Every one of the ten weapons is selectable, `wildcharge` and `thunderclap` included.
3. Expanding `magmablast` → impact → fire replays that burst about every 1.5s, left of the panel.
4. Dragging `size` changes the next replay; dragging it back to shipped clears the override (verify by Copy overrides producing nothing for that weapon).
5. `count` to 0 flips the header to `off` and the burst stops appearing.
6. `soot` is editable on smoke and greyed elsewhere.
7. Reset all restores every weapon; Copy overrides then reports nothing to copy.
8. Back, then resume — no burst appears on the running field.
9. Reload the page: the overrides are still there.
10. Change the arena with the panel open — no console error, and the preview resumes in the new arena.
11. Exit to the join screen and start a practice match: **shipped fx**, with no trace of the overrides.
