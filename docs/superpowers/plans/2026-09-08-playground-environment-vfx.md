# Playground Environment VFX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every non-weapon visual constant — the camera grade and vignette, shake and hit-stop, decals, smoke occlusion, the generated asphalt floor, the painted markings, and the two car-event burst lists — tunable live from the playground, the way `WEAPON_FX` already is.

**Architecture:** Lift every one of those constants into a single client-side `ENVIRONMENT_FX` table, and have each consumer take it as a **defaulted parameter** — the seam `FxLayer` already uses for `resolveFx`. A playground room passes a live resolver over a sparse override map; every other room passes nothing and gets the shipped table, so the store never touches a shipped code path. A flat `ENV_FIELDS` model drives a third settings panel, persistence in the existing localStorage blob, and a pasteable `environment.ts` export. The two car-event burst lists instead join the *existing* weapon panel, because they are already `FxBurst`-shaped.

**Tech Stack:** TypeScript, Phaser 4.2.1, vitest (node environment, no browser), plain-DOM overlay via `packages/client/src/ui/dom.ts`.

**Spec:** [`docs/superpowers/specs/2026-09-08-playground-environment-vfx-design.md`](../specs/2026-09-08-playground-environment-vfx-design.md) — decisions **EV1–EV34**. Read it alongside this plan.

## Global Constraints

- **Client-only.** Nothing in this plan touches `packages/shared` or `packages/server`. No shared table, no `ArenaDef.palette`, no schema field, no wire contract (EV2, EV4).
- **Nothing owed elsewhere.** No `balanceStamp` movement, so no `npm run build:manual`. No turn stat, so no `docs/turn-tuning.md`. No playtest probe measures particles, decals or camera (EV2).
- **Behaviour-identical lift.** Tasks 1–8 must not change a single rendered pixel. Every value moves verbatim; the identity tests are what prove it (EV7).
- **Defaulted parameters only.** Every new `env` parameter is optional and defaults to `ENVIRONMENT_FX`. No existing call site outside the playground may be required to pass one (EV11).
- **No module-level store reads inside `fx/` modules.** The store is reached only through a resolver passed in from `ArenaScene` (EV12, EV34).
- **Fx subject ids must not contain a `.`** — the override key format is `"<subject>.<phase>.<channel>.<field>"` and `sanitizeStoredVfx` splits on `.` and rejects anything that is not exactly 4 parts. The car-event ids are therefore `carDamage` and `carDeath`, never `car.damage`.
- **Car-event entries use the `impact` phase only.** Reusing an existing `FxPhase` keeps `sanitizeStoredVfx`'s phase check and the key format untouched (EV21).
- Run `npm test -w @motor-combat-moba/client` for the client suite; `npm test` at the root runs everything.

---

### Task 1: The environment table

**Files:**
- Create: `packages/client/src/fx/environment.ts`
- Create: `packages/client/src/fx/environment.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface EnvironmentFx` and `const ENVIRONMENT_FX: EnvironmentFx`, with the nine sections `grade`, `vignette`, `shake`, `hitStop`, `decals`, `occlusion`, `floor`, `markings`, `carBursts`. Every later task reads these names.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/fx/environment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ENVIRONMENT_FX } from "./environment.js";

/**
 * EV7: the lift must be behaviour-identical. These literals are the values the game shipped with
 * before `fx/environment.ts` existed, transcribed from `ArenaScene.drawArena`, `fx/camera.ts`,
 * `fx/decals.ts`, `fx/occlusion.ts`, `fx/textures.ts`, `fx/layer.ts` and `fx/emitters.ts`. If one
 * of these fails, the move changed a pixel.
 */
describe("ENVIRONMENT_FX", () => {
  it("carries the shipped grade and vignette", () => {
    expect(ENVIRONMENT_FX.grade).toEqual({
      saturate: -0.22,
      warmR: 1.07,
      warmB: 0.92,
      brightness: 0.96,
    });
    expect(ENVIRONMENT_FX.vignette).toEqual({ x: 0.5, y: 0.5, radius: 0.78, strength: 0.42 });
  });

  it("carries the shipped shake and hit-stop", () => {
    expect(ENVIRONMENT_FX.shake).toEqual({
      max: 0.02,
      diedMs: 260,
      damagedMs: 120,
      damagedBase: 0.0015,
      damagedPerHp: 0.00018,
      damagedCap: 0.6,
      explosionMs: 200,
      explosionCap: 0.75,
      ramMs: 120,
      ramFloor: 0.006,
      ramPerSpeed: 0.00002,
      ramCap: 0.6,
    });
    expect(ENVIRONMENT_FX.hitStop).toEqual({ ms: 90, scale: 0.25 });
  });

  it("carries the shipped decal and occlusion values", () => {
    expect(ENVIRONMENT_FX.decals).toEqual({
      halfLifeMs: 40_000,
      maxTotal: 600,
      maxScorch: 120,
      fadeCutoff: 0.02,
      tyreSpacing: 4.5,
      tyreMaxStep: 80,
      tyreSpeedFloor: 40,
      tyreTrackRatio: 1 / 3,
      tyreRadius: 2.7,
      tyreAlpha: 0.18,
      tyreTint: 0x141210,
      scorchAlphaShot: 0.55,
      scorchAlphaDeath: 0.7,
      scorchScaleDeath: 1.4,
      scorchScaleDefault: 0.35,
    });
    expect(ENVIRONMENT_FX.occlusion).toEqual({ halo: 14 });
  });

  it("carries the shipped floor, markings and car-burst values", () => {
    expect(ENVIRONMENT_FX.floor).toEqual({
      grainCells: 64,
      patchCells: 8,
      grainOctaves: 3,
      patchOctaves: 2,
      grainWeight: 0.62,
      patchWeight: 0.38,
      baseGrey: 50,
      greySpan: 46,
      warmR: 2,
      warmG: 1,
      warmB: -2,
    });
    expect(ENVIRONMENT_FX.markings).toEqual({
      laneColor: 0xdccd96,
      laneAlpha: 0.13,
      laneWidth: 6,
      laneSpacing: 46,
      laneDash: 26,
      laneMargin: 40,
      circleAlpha: 0.1,
      circleWidth: 4,
      circleRadius: 130,
    });
    expect(ENVIRONMENT_FX.carBursts).toEqual({ sparkPerHp: 0.5, countFloor: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- environment`
Expected: FAIL — `Failed to resolve import "./environment.js"`.

- [ ] **Step 3: Write the table**

Create `packages/client/src/fx/environment.ts`:

```ts
/**
 * Every environment visual constant, in one place (spec EV6).
 *
 * **Client-side for the same reason `WEAPON_FX` is (VFX30, EV2).** `balanceStamp` hashes the shared
 * tables whole, including purely visual fields, so a table like this one living in shared would make
 * every look tweak owe a `npm run build:manual` and a stamp update. Here it owes nothing.
 *
 * Every value below was lifted verbatim from where it used to live — `ArenaScene.drawArena`,
 * `fx/camera.ts`, `fx/decals.ts`, `fx/occlusion.ts`, `fx/textures.ts`, `fx/layer.ts`,
 * `fx/emitters.ts`. `environment.test.ts` pins each one against the literal that shipped, so the
 * move cannot change a pixel (EV7).
 *
 * **The asphalt seed is deliberately absent (EV9).** It is `arena.width * 31 + arena.height` so that
 * every client in a room generates the same floor; a tunable, persisted or exported seed would break
 * that agreement. The panel offers a preview-only reroll instead.
 */
export interface EnvironmentFx {
  /** The warm-desaturated `ColorMatrix` grade (VFX27). `warmG` is held at 1 and is not a field. */
  readonly grade: {
    readonly saturate: number;
    readonly warmR: number;
    readonly warmB: number;
    readonly brightness: number;
  };
  readonly vignette: {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly strength: number;
  };
  /**
   * Camera shake (VFX26). The `*Cap` values are FRACTIONS OF `max`, not absolute intensities, which
   * is how the shipped code expresses them and what keeps the documented ordering — ram ties
   * `damaged`, both below an explosion, all below a kill — true under a retune of `max` alone.
   */
  readonly shake: {
    readonly max: number;
    readonly diedMs: number;
    readonly damagedMs: number;
    readonly damagedBase: number;
    readonly damagedPerHp: number;
    readonly damagedCap: number;
    readonly explosionMs: number;
    readonly explosionCap: number;
    readonly ramMs: number;
    readonly ramFloor: number;
    readonly ramPerSpeed: number;
    readonly ramCap: number;
  };
  readonly hitStop: { readonly ms: number; readonly scale: number };
  /**
   * The persistent ground layer (VFX23). `tyreTrackRatio` is a FRACTION OF `DRIVE_CONFIG.carHeight`
   * rather than a pixel number (EV8), so a chassis retune still moves the track width.
   */
  readonly decals: {
    readonly halfLifeMs: number;
    readonly maxTotal: number;
    readonly maxScorch: number;
    readonly fadeCutoff: number;
    readonly tyreSpacing: number;
    readonly tyreMaxStep: number;
    readonly tyreSpeedFloor: number;
    readonly tyreTrackRatio: number;
    readonly tyreRadius: number;
    readonly tyreAlpha: number;
    readonly tyreTint: number;
    readonly scorchAlphaShot: number;
    readonly scorchAlphaDeath: number;
    readonly scorchScaleDeath: number;
    /** The fallback for a weapon whose row authors no `scorchScale` (EV10). */
    readonly scorchScaleDefault: number;
  };
  readonly occlusion: { readonly halo: number };
  /**
   * The generated asphalt (VFX36). `grainCells`, `patchCells` and both octave counts MUST stay whole
   * numbers — `tileableFbm`'s period is in cells and has to be an integer for the lattice to close,
   * which is the seam `textures.test.ts`'s tiling case pins (EV15).
   */
  readonly floor: {
    readonly grainCells: number;
    readonly patchCells: number;
    readonly grainOctaves: number;
    readonly patchOctaves: number;
    readonly grainWeight: number;
    readonly patchWeight: number;
    readonly baseGrey: number;
    readonly greySpan: number;
    readonly warmR: number;
    readonly warmG: number;
    readonly warmB: number;
  };
  readonly markings: {
    readonly laneColor: number;
    readonly laneAlpha: number;
    readonly laneWidth: number;
    readonly laneSpacing: number;
    readonly laneDash: number;
    readonly laneMargin: number;
    readonly circleAlpha: number;
    readonly circleWidth: number;
    readonly circleRadius: number;
  };
  /** How a damage burst's spark count follows the hp lost (EV22). */
  readonly carBursts: { readonly sparkPerHp: number; readonly countFloor: number };
}

export const ENVIRONMENT_FX: EnvironmentFx = {
  grade: { saturate: -0.22, warmR: 1.07, warmB: 0.92, brightness: 0.96 },
  vignette: { x: 0.5, y: 0.5, radius: 0.78, strength: 0.42 },
  shake: {
    max: 0.02,
    diedMs: 260,
    damagedMs: 120,
    damagedBase: 0.0015,
    damagedPerHp: 0.00018,
    damagedCap: 0.6,
    explosionMs: 200,
    explosionCap: 0.75,
    ramMs: 120,
    ramFloor: 0.006,
    ramPerSpeed: 0.00002,
    ramCap: 0.6,
  },
  hitStop: { ms: 90, scale: 0.25 },
  decals: {
    halfLifeMs: 40_000,
    maxTotal: 600,
    maxScorch: 120,
    fadeCutoff: 0.02,
    tyreSpacing: 4.5,
    tyreMaxStep: 80,
    tyreSpeedFloor: 40,
    tyreTrackRatio: 1 / 3,
    tyreRadius: 2.7,
    tyreAlpha: 0.18,
    tyreTint: 0x141210,
    scorchAlphaShot: 0.55,
    scorchAlphaDeath: 0.7,
    scorchScaleDeath: 1.4,
    scorchScaleDefault: 0.35,
  },
  occlusion: { halo: 14 },
  floor: {
    grainCells: 64,
    patchCells: 8,
    grainOctaves: 3,
    patchOctaves: 2,
    grainWeight: 0.62,
    patchWeight: 0.38,
    baseGrey: 50,
    greySpan: 46,
    warmR: 2,
    warmG: 1,
    warmB: -2,
  },
  markings: {
    laneColor: 0xdccd96,
    laneAlpha: 0.13,
    laneWidth: 6,
    laneSpacing: 46,
    laneDash: 26,
    laneMargin: 40,
    circleAlpha: 0.1,
    circleWidth: 4,
    circleRadius: 130,
  },
  carBursts: { sparkPerHp: 0.5, countFloor: 1 },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @motor-combat-moba/client -- environment`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/environment.ts packages/client/src/fx/environment.test.ts
git commit -m "feat(fx): add the ENVIRONMENT_FX table (EV6, EV7)"
```

---

### Task 2: `fx/camera.ts` reads the table

**Files:**
- Modify: `packages/client/src/fx/camera.ts`
- Modify: `packages/client/src/fx/camera.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (the `HIT_STOP_*` import and its four uses at lines ~3048, ~3067, ~3068, ~3070)

**Interfaces:**
- Consumes: `ENVIRONMENT_FX`, `EnvironmentFx` from Task 1.
- Produces: `shakeFor(event, env?: EnvironmentFx)`, `ramShake(closingSpeed, env?: EnvironmentFx)`. `HIT_STOP_MS`, `HIT_STOP_SCALE` and `MAX_SHAKE` are **deleted**; `ArenaScene` reads `ENVIRONMENT_FX.hitStop` (Task 12 gives it a resolver). `shouldStartShake` is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/camera.test.ts`:

```ts
import { ENVIRONMENT_FX } from "./environment.js";

describe("shake reads the environment table", () => {
  it("scales a kill's shake with env.shake.max", () => {
    const env = { ...ENVIRONMENT_FX, shake: { ...ENVIRONMENT_FX.shake, max: 0.05 } };
    const spec = shakeFor({ kind: "died", sessionId: "a", x: 0, y: 0 }, env);
    expect(spec).toEqual({ durationMs: 260, intensity: 0.05 });
  });

  it("scales a ram's floor and slope with env", () => {
    const env = {
      ...ENVIRONMENT_FX,
      shake: { ...ENVIRONMENT_FX.shake, ramFloor: 0.001, ramPerSpeed: 0 },
    };
    expect(ramShake(500, env)).toEqual({ durationMs: 120, intensity: 0.001 });
  });

  it("defaults to the shipped table when no env is passed", () => {
    expect(shakeFor({ kind: "died", sessionId: "a", x: 0, y: 0 })).toEqual({
      durationMs: 260,
      intensity: 0.02,
    });
    expect(ramShake(0)).toEqual({ durationMs: 120, intensity: 0.006 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- camera`
Expected: FAIL — `shakeFor` takes one argument, so the `env` is ignored and the first case returns `intensity: 0.02`.

- [ ] **Step 3: Rewrite `fx/camera.ts`**

Delete `HIT_STOP_MS`, `HIT_STOP_SCALE` and the `MAX_SHAKE` const, and thread `env`:

```ts
import type { EnvironmentFx } from "./environment.js";
import { ENVIRONMENT_FX } from "./environment.js";

export function shakeFor(event: FxEvent, env: EnvironmentFx = ENVIRONMENT_FX): ShakeSpec | undefined {
  const s = env.shake;
  switch (event.kind) {
    case "died":
      return { durationMs: s.diedMs, intensity: s.max };
    case "damaged":
      return {
        durationMs: s.damagedMs,
        intensity: Math.min(s.max * s.damagedCap, s.damagedBase + event.amount * s.damagedPerHp),
      };
    case "shotEnded":
      return EXPLOSIVE.has(event.weaponId)
        ? { durationMs: s.explosionMs, intensity: s.max * s.explosionCap }
        : undefined;
    case "shotFired":
      return undefined;
  }
}

export function ramShake(closingSpeed: number, env: EnvironmentFx = ENVIRONMENT_FX): ShakeSpec {
  const s = env.shake;
  return {
    durationMs: s.ramMs,
    intensity: Math.min(s.max * s.ramCap, s.ramFloor + Math.abs(closingSpeed) * s.ramPerSpeed),
  };
}
```

Keep the existing doc comments on both functions — the ordering paragraph on `ramShake` ("a ram must never out-shake an explosion or a kill") is still true and is now the reason the caps are fractions of `max`.

- [ ] **Step 4: Update `ArenaScene`'s hit-stop uses**

In `packages/client/src/scenes/ArenaScene.ts`, drop `HIT_STOP_MS` and `HIT_STOP_SCALE` from the `fx/camera.js` import, add `import { ENVIRONMENT_FX } from "../fx/environment.js";`, and replace the four uses:

```ts
// ~line 3048
return performance.now() < this.hitStopUntilMs ? ENVIRONMENT_FX.hitStop.scale : 1;

// ~lines 3067-3070
this.hitStopUntilMs = performance.now() + ENVIRONMENT_FX.hitStop.ms;
this.tweens.timeScale = ENVIRONMENT_FX.hitStop.scale;
this.time.delayedCall(ENVIRONMENT_FX.hitStop.ms, () => {
```

Update the four doc comments that name `HIT_STOP_MS`/`HIT_STOP_SCALE` (lines ~820, ~3041, ~3052, ~3059) to say `ENVIRONMENT_FX.hitStop`.

- [ ] **Step 5: Run the client suite and the typecheck**

Run: `npm test -w @motor-combat-moba/client && npm run typecheck -w @motor-combat-moba/client`
Expected: PASS. Every pre-existing `camera.test.ts` case must still pass untouched — that is the identity check for this task.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/fx/camera.ts packages/client/src/fx/camera.test.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "refactor(fx): camera shake and hit-stop read ENVIRONMENT_FX (EV11)"
```

---

### Task 3: `scorchScale` moves onto the weapon row

**Files:**
- Modify: `packages/client/src/fx/table.ts`
- Modify: `packages/client/src/fx/table.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `WeaponFxRow` gains `readonly scorchScale?: number`. `magmablast` 1.25, `predator` 1.0, `thumper` 0.5 carry it; every other row omits it and falls back to `ENVIRONMENT_FX.decals.scorchScaleDefault` at the call site in Task 4.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/table.test.ts`:

```ts
describe("scorchScale on the weapon row (EV10)", () => {
  it("carries the three scales that used to live in decals.ts", () => {
    expect(weaponFxOf("magmablast").scorchScale).toBe(1.25);
    expect(weaponFxOf("predator").scorchScale).toBe(1.0);
    expect(weaponFxOf("thumper").scorchScale).toBe(0.5);
  });

  it("leaves every other weapon without one, so the caller's default applies", () => {
    expect(weaponFxOf("lance").scorchScale).toBeUndefined();
    expect(weaponFxOf("pepperbox").scorchScale).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- table`
Expected: FAIL — `scorchScale` does not exist on `WeaponFxRow`.

- [ ] **Step 3: Add the field**

In `packages/client/src/fx/table.ts`, extend the interface:

```ts
export interface WeaponFxRow {
  readonly muzzle: readonly FxBurst[];
  readonly impact: readonly FxBurst[];
  /**
   * How wide a scorch mark this weapon's impact leaves, as a multiple of the scorch texture (EV10).
   *
   * Lives here rather than in `fx/decals.ts`, where a `SCORCH_SCALE` record keyed by `weaponId` used
   * to hold the same three numbers: it is weapon fx data, so it belongs on the weapon's row where
   * the playground panel, its persistence and its export already reach it. Absent means "use
   * `ENVIRONMENT_FX.decals.scorchScaleDefault`" — absent is not zero.
   */
  readonly scorchScale?: number;
}
```

Add `scorchScale: 1.25` to the `magmablast` row, `scorchScale: 1.0` to `predator`, `scorchScale: 0.5` to `thumper`. Leave `lance` and `DEFAULT_WEAPON_FX` without one.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @motor-combat-moba/client -- table`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/table.ts packages/client/src/fx/table.test.ts
git commit -m "feat(fx): move scorch scale onto WeaponFxRow (EV10)"
```

---

### Task 4: `fx/decals.ts` reads the table

**Files:**
- Modify: `packages/client/src/fx/decals.ts`
- Modify: `packages/client/src/fx/decals.test.ts`
- Modify: `packages/client/src/fx/layer.ts` (the four call sites in `update`, `layTyreMarks`, `stampSurvivors`)

**Interfaces:**
- Consumes: `ENVIRONMENT_FX` (Task 1), `WeaponFxRow.scorchScale` (Task 3).
- Produces: `tyreMarkSteps(carry, segmentLength, env?)`, `tyreMarksFor(pose, speed, env?)`, `decalFadeAlpha(ageMs, env?)`, `decalStampsFor(event, env?, resolve?: WeaponFxResolver)`, `tyreTrackHalfWidth(env?): number`. `DECAL_HALF_LIFE_MS`, `MAX_DECALS`, `TYRE_MARK_SPACING`, `TYRE_MARK_MAX_STEP`, `TYRE_MARK_SPEED_FLOOR`, `TYRE_TRACK_HALF_WIDTH` and `SCORCH_SCALE` are **deleted**.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/decals.test.ts`:

```ts
import { ENVIRONMENT_FX } from "./environment.js";

describe("decals read the environment table", () => {
  it("takes tyre spacing from env", () => {
    const env = { ...ENVIRONMENT_FX, decals: { ...ENVIRONMENT_FX.decals, tyreSpacing: 10 } };
    expect(tyreMarkSteps(0, 25, env).fractions).toHaveLength(2);
    expect(tyreMarkSteps(0, 25).fractions).toHaveLength(5); // shipped 4.5
  });

  it("takes the fade half-life from env", () => {
    const env = { ...ENVIRONMENT_FX, decals: { ...ENVIRONMENT_FX.decals, halfLifeMs: 1000 } };
    expect(decalFadeAlpha(1000, env)).toBeCloseTo(0.5, 5);
    expect(decalFadeAlpha(40_000)).toBeCloseTo(0.5, 5); // shipped 40_000
  });

  it("takes a scorch scale from the weapon row, falling back to the env default", () => {
    expect(decalStampsFor({ kind: "shotEnded", weaponId: "magmablast", x: 0, y: 0, angle: 0 })[0]!.scale)
      .toBe(1.25);
    expect(decalStampsFor({ kind: "shotEnded", weaponId: "lance", x: 0, y: 0, angle: 0 })[0]!.scale)
      .toBe(0.35);
  });

  it("takes the tyre track half width from the ratio, not a frozen pixel value", () => {
    const env = { ...ENVIRONMENT_FX, decals: { ...ENVIRONMENT_FX.decals, tyreTrackRatio: 0.5 } };
    const marks = tyreMarksFor({ x: 0, y: 0, angle: 0 }, 200, env);
    expect(Math.abs(marks[0]!.y - marks[1]!.y)).toBeCloseTo(DRIVE_CONFIG.carHeight, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- decals`
Expected: FAIL — the `env` arguments are ignored, so the first assertion of each pair matches the shipped value instead.

- [ ] **Step 3: Thread `env` through `fx/decals.ts`**

```ts
import type { EnvironmentFx } from "./environment.js";
import { ENVIRONMENT_FX } from "./environment.js";
import { weaponFxOf } from "./table.js";
import type { WeaponFxResolver } from "./tuning.js";

/**
 * Half the distance between the two tracks, as a fraction of the hull rather than a frozen pixel
 * value (EV8) — a chassis retune must still move the tracks.
 */
export function tyreTrackHalfWidth(env: EnvironmentFx = ENVIRONMENT_FX): number {
  return DRIVE_CONFIG.carHeight * env.decals.tyreTrackRatio;
}

export function tyreMarkSteps(
  carry: number,
  segmentLength: number,
  env: EnvironmentFx = ENVIRONMENT_FX,
): TyreMarkSteps {
  const { tyreSpacing, tyreMaxStep } = env.decals;
  if (!(segmentLength > 0)) return { fractions: [], carry };
  if (segmentLength > tyreMaxStep) return { fractions: [], carry: 0 };
  const fractions: number[] = [];
  let need = tyreSpacing - carry;
  while (need <= segmentLength) {
    fractions.push(need / segmentLength);
    need += tyreSpacing;
  }
  return { fractions, carry: carry + segmentLength - fractions.length * tyreSpacing };
}

/**
 * `resolve` defaults to the shipped weapon table for the same reason `emitterSpecsFor`'s does: a
 * scorch mark's width is now the weapon's own `scorchScale` (EV10a), so this needs the same
 * resolver the playground already injects for bursts.
 */
export function decalStampsFor(
  event: FxEvent,
  env: EnvironmentFx = ENVIRONMENT_FX,
  resolve: WeaponFxResolver = weaponFxOf,
): DecalStamp[] {
  const d = env.decals;
  if (event.kind === "shotEnded") {
    return [
      {
        kind: "scorch",
        x: event.x,
        y: event.y,
        scale: resolve(event.weaponId).scorchScale ?? d.scorchScaleDefault,
        alpha: d.scorchAlphaShot,
      },
    ];
  }
  if (event.kind === "died") {
    return [
      { kind: "scorch", x: event.x, y: event.y, scale: d.scorchScaleDeath, alpha: d.scorchAlphaDeath },
    ];
  }
  return [];
}

export function tyreMarksFor(
  pose: { x: number; y: number; angle: number },
  speed: number,
  env: EnvironmentFx = ENVIRONMENT_FX,
): TyreMark[] {
  const d = env.decals;
  if (speed < d.tyreSpeedFloor) return [];
  const px = -Math.sin(pose.angle);
  const py = Math.cos(pose.angle);
  const half = tyreTrackHalfWidth(env);
  return [
    { x: pose.x + px * half, y: pose.y + py * half, radius: d.tyreRadius, alpha: d.tyreAlpha },
    { x: pose.x - px * half, y: pose.y - py * half, radius: d.tyreRadius, alpha: d.tyreAlpha },
  ];
}

export function decalFadeAlpha(ageMs: number, env: EnvironmentFx = ENVIRONMENT_FX): number {
  if (ageMs <= 0) return 1;
  const alpha = Math.pow(0.5, ageMs / env.decals.halfLifeMs);
  return alpha < env.decals.fadeCutoff ? 0 : alpha;
}
```

Delete the six `export const`s and the `SCORCH_SCALE` record. Keep every doc comment, moving the reasoning onto the matching `EnvironmentFx` field where the constant is gone.

- [ ] **Step 4: Update `fx/layer.ts`'s uses**

`layer.ts` currently imports `MAX_DECALS` and `decalFadeAlpha`, and hard-codes `MAX_SCORCH_DECALS = 120` and the tyre tint `0x141210`. For now, keep `layer.ts` compiling by reading `ENVIRONMENT_FX` directly at those four points — Task 8 replaces them with the injected resolver:

```ts
import { ENVIRONMENT_FX } from "./environment.js";
// MAX_SCORCH_DECALS / MAX_TYRE_DECALS become:
const scorchCap = ENVIRONMENT_FX.decals.maxScorch;
const tyreCap = ENVIRONMENT_FX.decals.maxTotal - scorchCap;
// the tyre decal's tint becomes ENVIRONMENT_FX.decals.tyreTint
// decalFadeAlpha(...) and decalStampsFor(...) keep their single-argument calls (defaults apply)
```

- [ ] **Step 5: Run the client suite and the typecheck**

Run: `npm test -w @motor-combat-moba/client && npm run typecheck -w @motor-combat-moba/client`
Expected: PASS, with every pre-existing `decals.test.ts` case unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/fx/decals.ts packages/client/src/fx/decals.test.ts packages/client/src/fx/layer.ts
git commit -m "refactor(fx): decals read ENVIRONMENT_FX and the row's scorch scale (EV10a, EV11)"
```

---

### Task 5: `fx/occlusion.ts` reads the table

**Files:**
- Modify: `packages/client/src/fx/occlusion.ts`
- Modify: `packages/client/src/fx/occlusion.test.ts`
- Modify: `packages/client/src/fx/layer.ts` (`buildEraserTextures`)

**Interfaces:**
- Consumes: `ENVIRONMENT_FX` (Task 1).
- Produces: `eraserStampsFor(cars, env?)`, `eraserStampWidth(env?): number`, `eraserStampHeight(env?): number`. `ERASER_HALO`, `ERASER_STAMP_WIDTH` and `ERASER_STAMP_HEIGHT` are **deleted**.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/occlusion.test.ts`:

```ts
import { ENVIRONMENT_FX } from "./environment.js";

describe("occlusion reads the environment table", () => {
  it("grows the stamp box with the halo", () => {
    const env = { ...ENVIRONMENT_FX, occlusion: { halo: 30 } };
    expect(eraserStampWidth(env)).toBe(DRIVE_CONFIG.carWidth + 60);
    expect(eraserStampHeight(env)).toBe(DRIVE_CONFIG.carHeight + 60);
  });

  it("defaults to the shipped halo of 14", () => {
    expect(eraserStampWidth()).toBe(DRIVE_CONFIG.carWidth + 28);
  });

  it("sizes each stamp from the same env it was given", () => {
    const env = { ...ENVIRONMENT_FX, occlusion: { halo: 30 } };
    const cars = [{ sessionId: "a", x: 1, y: 2, angle: 0, hp: 10, alive: true, carId: "bastion", vx: 0, vy: 0 }];
    expect(eraserStampsFor(cars, env)[0]!.width).toBe(DRIVE_CONFIG.carWidth + 60);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- occlusion`
Expected: FAIL — `eraserStampWidth` is not exported.

- [ ] **Step 3: Thread `env` through `fx/occlusion.ts`**

```ts
import type { EnvironmentFx } from "./environment.js";
import { ENVIRONMENT_FX } from "./environment.js";

/**
 * The final world size of one hole: the hull plus the halo on every side.
 *
 * A function rather than a constant now that the halo is tunable. `layer.ts` sizes its silhouette
 * textures to this box's aspect, and a second copy of the formula there is exactly how the two
 * would drift apart — see EV30 for why a halo edit must also rebuild those textures.
 */
export function eraserStampWidth(env: EnvironmentFx = ENVIRONMENT_FX): number {
  return DRIVE_CONFIG.carWidth + env.occlusion.halo * 2;
}

export function eraserStampHeight(env: EnvironmentFx = ENVIRONMENT_FX): number {
  return DRIVE_CONFIG.carHeight + env.occlusion.halo * 2;
}

export function eraserStampsFor(
  cars: readonly FxCarView[],
  env: EnvironmentFx = ENVIRONMENT_FX,
): EraserStamp[] {
  const width = eraserStampWidth(env);
  const height = eraserStampHeight(env);
  const stamps: EraserStamp[] = [];
  for (const car of cars) {
    if (!car.alive) continue;
    stamps.push({ x: car.x, y: car.y, angle: car.angle, width, height, carId: car.carId });
  }
  return stamps;
}
```

- [ ] **Step 4: Update `buildEraserTextures`**

In `packages/client/src/fx/layer.ts`, replace the three `ERASER_*` reads with `eraserStampWidth()`, `eraserStampHeight()` and `ENVIRONMENT_FX.occlusion.halo`. Task 8 swaps `ENVIRONMENT_FX` for the injected resolver.

- [ ] **Step 5: Run the client suite and the typecheck**

Run: `npm test -w @motor-combat-moba/client && npm run typecheck -w @motor-combat-moba/client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/fx/occlusion.ts packages/client/src/fx/occlusion.test.ts packages/client/src/fx/layer.ts
git commit -m "refactor(fx): occlusion halo reads ENVIRONMENT_FX (EV11)"
```

---

### Task 6: `asphaltTexture` reads the table

**Files:**
- Modify: `packages/client/src/fx/textures.ts`
- Modify: `packages/client/src/fx/textures.test.ts`

**Interfaces:**
- Consumes: `ENVIRONMENT_FX` (Task 1).
- Produces: `asphaltTexture(seed, size?, env?)`. `ASPHALT_GRAIN_CELLS` and `ASPHALT_PATCH_CELLS` are **deleted**.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/textures.test.ts`:

```ts
import { ENVIRONMENT_FX } from "./environment.js";

describe("asphaltTexture reads the environment table", () => {
  it("changes its pixels when the grey base moves", () => {
    const env = { ...ENVIRONMENT_FX, floor: { ...ENVIRONMENT_FX.floor, baseGrey: 120 } };
    const shipped = asphaltTexture(9, 64);
    const brighter = asphaltTexture(9, 64, env);
    expect(brighter.data[0]).toBeGreaterThan(shipped.data[0]!);
  });

  it("stays tileable at a different whole cell count", () => {
    const env = { ...ENVIRONMENT_FX, floor: { ...ENVIRONMENT_FX.floor, grainCells: 32, patchCells: 4 } };
    const tex = asphaltTexture(9, 64, env);
    // The same seam property the shipped tiling case pins: the wrap must be no worse than the
    // interior. Whole cell counts are what makes `tileableFbm`'s lattice close (EV15).
    const seam = meanChannelDelta(tex, tex.width - 1, 0);
    const interior = meanChannelDelta(tex, 10, 11);
    expect(seam).toBeLessThan(interior * 3);
  });

  it("defaults to the shipped floor values", () => {
    expect(asphaltTexture(9, 64)).toEqual(asphaltTexture(9, 64, ENVIRONMENT_FX));
  });
});
```

If `textures.test.ts` has no `meanChannelDelta` helper, reuse whatever the existing tiling case uses to compare columns — do not invent a second measure.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- textures`
Expected: FAIL — the third argument is ignored, so `brighter.data[0]` equals `shipped.data[0]`.

- [ ] **Step 3: Thread `env` through `asphaltTexture`**

```ts
export function asphaltTexture(
  seed: number,
  size = 512,
  env: EnvironmentFx = ENVIRONMENT_FX,
): TexturePixels {
  const f = env.floor;
  const data = new Uint8ClampedArray(size * size * 4);
  const grain = size / f.grainCells;
  const patch = size / f.patchCells;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const n =
        tileableFbm(i / grain, j / grain, seed + 7, f.grainOctaves, f.grainCells) * f.grainWeight +
        tileableFbm(i / patch, j / patch, seed + 55, f.patchOctaves, f.patchCells) * f.patchWeight;
      const g = f.baseGrey + n * f.greySpan;
      const k = (j * size + i) * 4;
      data[k] = g + f.warmR;
      data[k + 1] = g + f.warmG;
      data[k + 2] = Math.max(0, g + f.warmB);
      data[k + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}
```

Keep the existing doc comment; add a line noting the cell counts must stay whole (EV15) and that `textures.test.ts`'s tiling case is what enforces it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @motor-combat-moba/client -- textures`
Expected: PASS, including the pre-existing tiling case unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/textures.ts packages/client/src/fx/textures.test.ts
git commit -m "refactor(fx): asphaltTexture reads ENVIRONMENT_FX (EV11)"
```

---

### Task 7: The car-event burst rows

**Files:**
- Modify: `packages/client/src/fx/table.ts`
- Modify: `packages/client/src/fx/table.test.ts`
- Modify: `packages/client/src/fx/emitters.ts`
- Modify: `packages/client/src/fx/emitters.test.ts`

**Interfaces:**
- Consumes: `ENVIRONMENT_FX` (Task 1), `WeaponFxRow` (Task 3).
- Produces: `CAR_EVENT_IDS = ["carDamage", "carDeath"] as const`, `type CarEventId`, `CAR_EVENT_FX: Record<CarEventId, WeaponFxRow>`, `isCarEventId(id): id is CarEventId`. `weaponFxOf` resolves those two ids as well. `emitterSpecsFor(event, resolve?, env?)` and `emitterSpecsForAll(events, resolve?, env?)`. `DAMAGE_SPARK_SCALE` is **deleted**.

**Why the ids have no dot:** the override key is `"<subject>.<phase>.<channel>.<field>"` and `sanitizeStoredVfx` splits on `.` and rejects anything that is not exactly four parts. `car.damage` would silently drop every saved override for that entry. Use `carDamage`/`carDeath`.

**Why both rows use the `impact` phase only:** car events have no muzzle/impact split (EV21). Reusing an existing `FxPhase` value keeps the key format and the sanitizer's phase check untouched; `muzzle` is simply an empty list.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/table.test.ts`:

```ts
describe("car event rows (EV20, EV21)", () => {
  it("resolves both car ids through weaponFxOf", () => {
    expect(weaponFxOf("carDeath").impact).toHaveLength(4);
    expect(weaponFxOf("carDamage").impact).toHaveLength(1);
  });

  it("leaves the muzzle phase empty on both", () => {
    expect(weaponFxOf("carDeath").muzzle).toEqual([]);
    expect(weaponFxOf("carDamage").muzzle).toEqual([]);
  });

  it("uses ids with no dot, so the override key format still splits into four", () => {
    for (const id of CAR_EVENT_IDS) expect(id).not.toContain(".");
  });

  it("carries the death burst exactly as emitters.ts authored it", () => {
    const fire = weaponFxOf("carDeath").impact.find((b) => b.channel === "fire")!;
    expect(fire).toMatchObject({ count: 26, speed: 120, lifeMs: 460, size: 60, alpha: 1 });
  });
});
```

Append to `packages/client/src/fx/emitters.test.ts`:

```ts
import { ENVIRONMENT_FX } from "./environment.js";

describe("damage bursts read carBursts (EV22)", () => {
  it("scales the spark count by env.carBursts.sparkPerHp", () => {
    const specs = emitterSpecsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 20 });
    expect(specs[0]!.burst.count).toBe(10); // 20 * 0.5
  });

  it("caps the count at the row's own count field", () => {
    const specs = emitterSpecsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 1000 });
    expect(specs[0]!.burst.count).toBe(30);
  });

  it("floors the count so a scratch still registers", () => {
    const specs = emitterSpecsFor({ kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 1 });
    expect(specs[0]!.burst.count).toBe(1);
  });

  it("treats a cap of zero as off, and does NOT floor it back to one", () => {
    const resolve = () => ({ muzzle: [], impact: [{ ...weaponFxOf("carDamage").impact[0]!, count: 0 }] });
    const specs = emitterSpecsFor(
      { kind: "damaged", sessionId: "a", x: 0, y: 0, amount: 50 },
      resolve,
      ENVIRONMENT_FX,
    );
    expect(specs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @motor-combat-moba/client -- table emitters`
Expected: FAIL — `CAR_EVENT_IDS` is not exported and `weaponFxOf("carDeath")` returns `DEFAULT_WEAPON_FX`.

- [ ] **Step 3: Add the rows to `fx/table.ts`**

```ts
/**
 * The two non-weapon subjects the fx panel can edit (EV20).
 *
 * **No dot in either id.** The override key is `"<subject>.<phase>.<channel>.<field>"` and
 * `sanitizeStoredVfx` splits it on `.` expecting exactly four parts, so `car.damage` would drop
 * every saved override for that entry without an error.
 */
export const CAR_EVENT_IDS = ["carDamage", "carDeath"] as const;
export type CarEventId = (typeof CAR_EVENT_IDS)[number];

export function isCarEventId(id: string): id is CarEventId {
  return (CAR_EVENT_IDS as readonly string[]).includes(id);
}

/**
 * What a car looks like when it is hit and when it dies — lifted verbatim from `emitters.ts`'s
 * `damageBursts` and `deathBursts` (EV20).
 *
 * Both use the `impact` phase alone and leave `muzzle` empty: a car event has no muzzle, and
 * reusing an existing `FxPhase` is what keeps the key format and the storage sanitizer untouched
 * (EV21). `carDamage`'s `count` is the CAP, not the count — the burst's actual spark count follows
 * the hp lost, through `ENVIRONMENT_FX.carBursts` (EV22).
 */
export const CAR_EVENT_FX: Record<CarEventId, WeaponFxRow> = {
  carDamage: {
    muzzle: [],
    impact: [
      { channel: "spark", count: 30, speed: 240, lifeMs: 300, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
    ],
  },
  carDeath: {
    muzzle: [],
    impact: [
      { channel: "fire", count: 26, speed: 120, lifeMs: 460, size: 60, growPerSec: 18, alpha: 1, soot: false, coneRad: TAU },
      { channel: "smoke", count: 26, speed: 90, lifeMs: 2600, size: 64, growPerSec: 70, alpha: 0.66, soot: true, coneRad: TAU },
      { channel: "spark", count: 34, speed: 340, lifeMs: 620, size: 7, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
      { channel: "debris", count: 20, speed: 150, lifeMs: 900, size: 5, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
    ],
  },
};

/**
 * The row for a weapon OR a car event, or the modest default. Never throws on an unknown id.
 *
 * Car events are checked first because their ids can never collide with a `WeaponId` — they are not
 * in `WEAPON_TABLE` — so the order is about reading clearly, not about precedence.
 */
export function weaponFxOf(id: string): WeaponFxRow {
  if (isCarEventId(id)) return CAR_EVENT_FX[id];
  return WEAPON_FX[id as WeaponId] ?? DEFAULT_WEAPON_FX;
}
```

- [ ] **Step 4: Rewrite `fx/emitters.ts`**

Delete `DAMAGE_SPARK_SCALE`, `damageBursts` and `deathBursts`, and read the rows through the resolver:

```ts
import type { EnvironmentFx } from "./environment.js";
import { ENVIRONMENT_FX } from "./environment.js";

/**
 * The damage row's bursts with their counts scaled to the hp lost (EV22).
 *
 * The row's authored `count` is the CAP. A cap of zero means the cell is switched off and must stay
 * off — flooring it back to `countFloor` there would make a disabled burst impossible to express,
 * which is the whole point of PG42's `count: 0` off switch.
 */
function damageBursts(amount: number, template: readonly FxBurst[], env: EnvironmentFx): FxBurst[] {
  const { sparkPerHp, countFloor } = env.carBursts;
  return template.map((burst) => ({
    ...burst,
    count:
      burst.count === 0
        ? 0
        : Math.max(countFloor, Math.min(burst.count, Math.round(amount * sparkPerHp))),
  }));
}

export function emitterSpecsFor(
  event: FxEvent,
  resolve: WeaponFxResolver = weaponFxOf,
  env: EnvironmentFx = ENVIRONMENT_FX,
): EmitterSpec[] {
  const place = (bursts: readonly FxBurst[], angle: number): EmitterSpec[] =>
    bursts
      .filter((burst) => burst.count > 0)
      .map((burst) => ({ channel: burst.channel, x: event.x, y: event.y, angle, burst }));

  switch (event.kind) {
    case "shotFired":
      return place(resolve(event.weaponId).muzzle, event.angle);
    case "shotEnded":
      return place(resolve(event.weaponId).impact, event.angle);
    case "damaged":
      return place(damageBursts(event.amount, resolve("carDamage").impact, env), 0);
    case "died":
      return place(resolve("carDeath").impact, 0);
  }
}
```

Give `emitterSpecsForAll` the same third parameter and pass it through.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @motor-combat-moba/client && npm run typecheck -w @motor-combat-moba/client`
Expected: PASS. Every pre-existing `emitters.test.ts` case must still pass — the damage and death output is identical to before.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/fx/table.ts packages/client/src/fx/table.test.ts packages/client/src/fx/emitters.ts packages/client/src/fx/emitters.test.ts
git commit -m "feat(fx): car damage and death become editable fx rows (EV20-EV22)"
```

---

### Task 8: The environment tuning model

**Files:**
- Create: `packages/client/src/fx/env-tuning.ts`
- Create: `packages/client/src/fx/env-tuning.test.ts`

**Interfaces:**
- Consumes: `EnvironmentFx`, `ENVIRONMENT_FX` (Task 1).
- Produces: `type EnvSection`, `interface EnvFieldDef`, `ENV_FIELDS`, `envKey(section, field)`, `type EnvOverrides = Record<string, number>`, `type EnvResolver = () => EnvironmentFx`, `resolveEnvironment(overrides): EnvironmentFx`, `isEnvAtShipped(field, value, shipped): boolean`, `envTableSource(overrides): string`, `shippedEnvValue(field): number`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/fx/env-tuning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ENVIRONMENT_FX } from "./environment.js";
import {
  ENV_FIELDS,
  envKey,
  envTableSource,
  isEnvAtShipped,
  resolveEnvironment,
  shippedEnvValue,
} from "./env-tuning.js";

describe("resolveEnvironment", () => {
  it("returns the shipped table for an empty map", () => {
    expect(resolveEnvironment({})).toEqual(ENVIRONMENT_FX);
  });

  it("applies one override and leaves its siblings alone", () => {
    const env = resolveEnvironment({ [envKey("grade", "saturate")]: -0.5 });
    expect(env.grade.saturate).toBe(-0.5);
    expect(env.grade.brightness).toBe(ENVIRONMENT_FX.grade.brightness);
    expect(env.decals).toEqual(ENVIRONMENT_FX.decals);
  });

  it("drops an entry naming an unknown section or field", () => {
    const env = resolveEnvironment({ "nope.thing": 1, "grade.nope": 1 });
    expect(env).toEqual(ENVIRONMENT_FX);
  });

  it("drops an out-of-range or non-finite entry rather than writing NaN into a shader", () => {
    const env = resolveEnvironment({
      [envKey("vignette", "strength")]: 99,
      [envKey("grade", "brightness")]: Number.NaN,
    });
    expect(env.vignette.strength).toBe(ENVIRONMENT_FX.vignette.strength);
    expect(env.grade.brightness).toBe(ENVIRONMENT_FX.grade.brightness);
  });

  it("drops a fractional value in an integer field, because a fractional cell count reopens the seam", () => {
    const env = resolveEnvironment({ [envKey("floor", "grainCells")]: 33.5 });
    expect(env.floor.grainCells).toBe(64);
  });
});

describe("ENV_FIELDS reachability (EV13)", () => {
  it("names a real path for every row", () => {
    for (const field of ENV_FIELDS) {
      const section = (ENVIRONMENT_FX as unknown as Record<string, Record<string, number>>)[field.section];
      expect(section, `unknown section ${field.section}`).toBeDefined();
      expect(typeof section![field.name], `unknown field ${field.section}.${field.name}`).toBe("number");
    }
  });

  it("has exactly one row for every leaf of EnvironmentFx", () => {
    const leaves: string[] = [];
    for (const [section, values] of Object.entries(ENVIRONMENT_FX)) {
      for (const name of Object.keys(values as Record<string, number>)) leaves.push(`${section}.${name}`);
    }
    const rows = ENV_FIELDS.map((f) => envKey(f.section, f.name));
    expect([...rows].sort()).toEqual([...leaves].sort());
  });

  it("contains every shipped value inside its own range", () => {
    for (const field of ENV_FIELDS) {
      const shipped = shippedEnvValue(field);
      expect(shipped, `${field.section}.${field.name} below min`).toBeGreaterThanOrEqual(field.min);
      expect(shipped, `${field.section}.${field.name} above max`).toBeLessThanOrEqual(field.max);
    }
  });
});

describe("isEnvAtShipped", () => {
  it("is half-step tolerant for a number", () => {
    const field = ENV_FIELDS.find((f) => f.section === "grade" && f.name === "saturate")!;
    expect(isEnvAtShipped(field, -0.222, -0.22)).toBe(true);
    expect(isEnvAtShipped(field, -0.3, -0.22)).toBe(false);
  });

  it("is exact for an integer and a colour", () => {
    const cells = ENV_FIELDS.find((f) => f.section === "floor" && f.name === "grainCells")!;
    expect(isEnvAtShipped(cells, 64, 64)).toBe(true);
    expect(isEnvAtShipped(cells, 65, 64)).toBe(false);
    const tint = ENV_FIELDS.find((f) => f.section === "decals" && f.name === "tyreTint")!;
    expect(isEnvAtShipped(tint, 0x141210, 0x141210)).toBe(true);
    expect(isEnvAtShipped(tint, 0x141211, 0x141210)).toBe(false);
  });
});

describe("envTableSource (EV33)", () => {
  it("is empty when nothing is overridden", () => {
    expect(envTableSource({})).toBe("");
  });

  it("emits only the touched sections, whole", () => {
    const source = envTableSource({ [envKey("grade", "saturate")]: -0.5 });
    expect(source).toContain("grade: {");
    expect(source).toContain("saturate: -0.5");
    expect(source).toContain("brightness: 0.96");
    expect(source).not.toContain("decals: {");
  });

  it("emits a colour as hex", () => {
    const source = envTableSource({ [envKey("decals", "tyreAlpha")]: 0.5 });
    expect(source).toContain("tyreTint: 0x141210");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- env-tuning`
Expected: FAIL — `Failed to resolve import "./env-tuning.js"`.

- [ ] **Step 3: Write `fx/env-tuning.ts`**

```ts
import type { EnvironmentFx } from "./environment.js";
import { ENVIRONMENT_FX } from "./environment.js";

/**
 * The playground's environment tuning model (spec EV13-EV19).
 *
 * Pure and Phaser-free, so it runs under vitest's node environment beside the rest of `fx/`. It is
 * deliberately FLAT where `fx/tuning.ts` is a grid (EV14): a weapon row is rectangular — two phases
 * by four channels — and the environment is nine sections of heterogeneous scalars, so a grid here
 * would be mostly holes.
 */
export type EnvSection = keyof EnvironmentFx;

export interface EnvFieldDef {
  readonly section: EnvSection;
  readonly name: string;
  readonly label: string;
  /**
   * `integer` is not cosmetic: `floor.grainCells` and `floor.patchCells` are `tileableFbm`'s period
   * in cells, and a fractional period stops the lattice closing — the seam bug the tiling test in
   * `textures.test.ts` exists to catch (EV15). `color` is edited as hex rather than dragged.
   */
  readonly kind: "number" | "integer" | "color";
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const c = (
  section: EnvSection,
  name: string,
  label: string,
  min: number,
  max: number,
  step: number,
  kind: EnvFieldDef["kind"] = "number",
): EnvFieldDef => ({ section, name, label, kind, min, max, step });

/**
 * Every editable field, with the range its control spans.
 *
 * Ranges contain every shipped value with headroom and are deliberately NOT a budget guard, the
 * same rule `FX_FIELDS` states: a panel that refuses an extreme is a panel that cannot answer "is
 * this too much". The reachability test in `env-tuning.test.ts` holds this list to
 * `EnvironmentFx` in both directions, so a knob added to the table without a row here fails the
 * suite rather than silently not appearing in the panel.
 */
export const ENV_FIELDS: readonly EnvFieldDef[] = [
  c("grade", "saturate", "Saturate", -1, 1, 0.01),
  c("grade", "warmR", "Warm R", 0.5, 1.5, 0.01),
  c("grade", "warmB", "Warm B", 0.5, 1.5, 0.01),
  c("grade", "brightness", "Brightness", 0.5, 1.5, 0.01),

  c("vignette", "x", "Centre X", 0, 1, 0.01),
  c("vignette", "y", "Centre Y", 0, 1, 0.01),
  c("vignette", "radius", "Radius", 0, 1.5, 0.01),
  c("vignette", "strength", "Strength", 0, 1, 0.01),

  c("shake", "max", "Max intensity", 0, 0.1, 0.001),
  c("shake", "diedMs", "Kill (ms)", 0, 1000, 10),
  c("shake", "damagedMs", "Hit (ms)", 0, 1000, 10),
  c("shake", "damagedBase", "Hit floor", 0, 0.02, 0.0005),
  c("shake", "damagedPerHp", "Hit per hp", 0, 0.001, 0.00001),
  c("shake", "damagedCap", "Hit cap x max", 0, 1, 0.01),
  c("shake", "explosionMs", "Explosion (ms)", 0, 1000, 10),
  c("shake", "explosionCap", "Explosion cap x max", 0, 1, 0.01),
  c("shake", "ramMs", "Ram (ms)", 0, 1000, 10),
  c("shake", "ramFloor", "Ram floor", 0, 0.02, 0.0005),
  c("shake", "ramPerSpeed", "Ram per speed", 0, 0.0002, 0.000005),
  c("shake", "ramCap", "Ram cap x max", 0, 1, 0.01),

  c("hitStop", "ms", "Duration (ms)", 0, 500, 10),
  c("hitStop", "scale", "Time scale", 0, 1, 0.01),

  c("decals", "halfLifeMs", "Half-life (ms)", 1000, 120000, 1000),
  c("decals", "maxTotal", "Max decals", 0, 2000, 10, "integer"),
  c("decals", "maxScorch", "Max scorch", 0, 1000, 10, "integer"),
  c("decals", "fadeCutoff", "Fade cutoff", 0, 0.2, 0.005),
  c("decals", "tyreSpacing", "Tyre spacing", 1, 40, 0.5),
  c("decals", "tyreMaxStep", "Tyre max step", 10, 300, 5),
  c("decals", "tyreSpeedFloor", "Tyre speed floor", 0, 300, 5),
  c("decals", "tyreTrackRatio", "Track ratio x hull", 0, 1, 0.01),
  c("decals", "tyreRadius", "Tyre radius", 0.5, 12, 0.1),
  c("decals", "tyreAlpha", "Tyre alpha", 0, 1, 0.01),
  c("decals", "tyreTint", "Tyre tint", 0, 0xffffff, 1, "color"),
  c("decals", "scorchAlphaShot", "Scorch alpha (shot)", 0, 1, 0.01),
  c("decals", "scorchAlphaDeath", "Scorch alpha (death)", 0, 1, 0.01),
  c("decals", "scorchScaleDeath", "Scorch scale (death)", 0, 4, 0.05),
  c("decals", "scorchScaleDefault", "Scorch scale (default)", 0, 4, 0.05),

  c("occlusion", "halo", "Smoke hole halo", 0, 60, 1),

  c("floor", "grainCells", "Grain cells", 4, 256, 4, "integer"),
  c("floor", "patchCells", "Patch cells", 1, 64, 1, "integer"),
  c("floor", "grainOctaves", "Grain octaves", 1, 6, 1, "integer"),
  c("floor", "patchOctaves", "Patch octaves", 1, 6, 1, "integer"),
  c("floor", "grainWeight", "Grain weight", 0, 1, 0.01),
  c("floor", "patchWeight", "Patch weight", 0, 1, 0.01),
  c("floor", "baseGrey", "Base grey", 0, 255, 1),
  c("floor", "greySpan", "Grey span", 0, 200, 1),
  c("floor", "warmR", "Warm R offset", -20, 20, 1),
  c("floor", "warmG", "Warm G offset", -20, 20, 1),
  c("floor", "warmB", "Warm B offset", -20, 20, 1),

  c("markings", "laneColor", "Paint colour", 0, 0xffffff, 1, "color"),
  c("markings", "laneAlpha", "Lane alpha", 0, 1, 0.01),
  c("markings", "laneWidth", "Lane width", 0, 20, 1),
  c("markings", "laneSpacing", "Lane spacing", 10, 200, 2),
  c("markings", "laneDash", "Lane dash", 0, 200, 2),
  c("markings", "laneMargin", "Lane margin", 0, 200, 5),
  c("markings", "circleAlpha", "Circle alpha", 0, 1, 0.01),
  c("markings", "circleWidth", "Circle width", 0, 20, 1),
  c("markings", "circleRadius", "Circle radius", 0, 600, 5),

  c("carBursts", "sparkPerHp", "Sparks per hp", 0, 3, 0.05),
  c("carBursts", "countFloor", "Count floor", 0, 10, 1, "integer"),
];

export function envKey(section: EnvSection, field: string): string {
  return `${section}.${field}`;
}

/** A sparse map of `"<section>.<field>"` to its value. Colours are stored as integers (EV17). */
export type EnvOverrides = Record<string, number>;

/** How a consumer asks for the live table. `() => ENVIRONMENT_FX` is the shipped implementation. */
export type EnvResolver = () => EnvironmentFx;

export function shippedEnvValue(field: EnvFieldDef): number {
  return (ENVIRONMENT_FX as unknown as Record<string, Record<string, number>>)[field.section]![
    field.name
  ]!;
}

function accepts(field: EnvFieldDef, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value < field.min || value > field.max) return false;
  // A fractional cell count reopens the tiling seam, and a fractional decal cap is meaningless.
  if (field.kind !== "number" && !Number.isInteger(value)) return false;
  return true;
}

/**
 * The table with the override map applied.
 *
 * Rebuilt rather than mutated, and section-by-section rather than deep-cloned, because the result is
 * handed to consumers that may hold it for a frame. `liveEnvResolver` is what stops this running per
 * particle — see `fx/env-store.ts` (EV19).
 */
export function resolveEnvironment(overrides: EnvOverrides): EnvironmentFx {
  const out = {} as Record<string, Record<string, number>>;
  for (const [section, values] of Object.entries(ENVIRONMENT_FX)) {
    out[section] = { ...(values as Record<string, number>) };
  }
  for (const field of ENV_FIELDS) {
    const value = overrides[envKey(field.section, field.name)];
    if (value === undefined) continue;
    if (!accepts(field, value)) continue;
    out[field.section]![field.name] = value;
  }
  return out as unknown as EnvironmentFx;
}

/**
 * Should this control's value be treated as shipped, i.e. should its override entry be DELETED?
 *
 * The half-step rule `isFxAtShipped` and `isAtShipped` already share, and for the same reason: a
 * range input snaps to its `min`/`step` grid and a shipped value very often does not sit on it, so a
 * strict comparison would leave a phantom override behind every time a slider was dragged back.
 * `integer` and `color` compare exactly — there is no grid to miss (EV16).
 */
export function isEnvAtShipped(field: EnvFieldDef, value: number, shipped: number): boolean {
  if (field.kind !== "number") return value === shipped;
  return Math.abs(value - shipped) < field.step / 2;
}

function valueSource(field: EnvFieldDef, value: number): string {
  if (field.kind === "color") return `0x${value.toString(16).padStart(6, "0")}`;
  return String(Number(value.toFixed(6)));
}

/**
 * The overrides as a pasteable `ENVIRONMENT_FX` fragment (EV33).
 *
 * Whole sections, and only the touched ones. `fxTableSource` emits full weapon rows because there
 * are ten independent rows; there is exactly one environment table, so the useful granularity here
 * is the section — a paste replaces `grade` entirely and leaves `decals` alone.
 *
 * Empty string when nothing is overridden: there is nothing to paste.
 */
export function envTableSource(overrides: EnvOverrides): string {
  const resolved = resolveEnvironment(overrides) as unknown as Record<string, Record<string, number>>;
  const touched = new Set<string>();
  for (const field of ENV_FIELDS) {
    const value = overrides[envKey(field.section, field.name)];
    if (value !== undefined && accepts(field, value)) touched.add(field.section);
  }
  if (touched.size === 0) return "";

  const sections: string[] = [];
  for (const section of Object.keys(ENVIRONMENT_FX)) {
    if (!touched.has(section)) continue;
    const rows = ENV_FIELDS.filter((f) => f.section === section).map(
      (f) => `    ${f.name}: ${valueSource(f, resolved[section]![f.name]!)},`,
    );
    sections.push([`  ${section}: {`, ...rows, `  },`].join("\n"));
  }
  return sections.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @motor-combat-moba/client -- env-tuning`
Expected: PASS. If the reachability test fails, a row is missing from `ENV_FIELDS` or a field is missing from `EnvironmentFx` — fix the mismatch, do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/env-tuning.ts packages/client/src/fx/env-tuning.test.ts
git commit -m "feat(fx): the environment tuning model (EV13-EV17, EV33)"
```

---

### Task 9: The environment override store

**Files:**
- Create: `packages/client/src/fx/env-store.ts`
- Create: `packages/client/src/fx/env-store.test.ts`

**Interfaces:**
- Consumes: `EnvOverrides`, `EnvResolver`, `resolveEnvironment` (Task 8), `ENVIRONMENT_FX` (Task 1).
- Produces: `envOverrides(): EnvOverrides`, `setEnvOverrides(next: EnvOverrides | null): void`, `bumpEnvVersion(): void`, `liveEnvResolver(): EnvResolver`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/fx/env-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { ENVIRONMENT_FX } from "./environment.js";
import { envKey } from "./env-tuning.js";
import { bumpEnvVersion, envOverrides, liveEnvResolver, setEnvOverrides } from "./env-store.js";

describe("env store", () => {
  beforeEach(() => setEnvOverrides(null));

  it("starts empty and resolves to the shipped table", () => {
    expect(envOverrides()).toEqual({});
    expect(liveEnvResolver()()).toEqual(ENVIRONMENT_FX);
  });

  it("reads the store at CALL time, not at construction", () => {
    const resolve = liveEnvResolver();
    setEnvOverrides({ [envKey("grade", "saturate")]: -0.5 });
    expect(resolve().grade.saturate).toBe(-0.5);
  });

  it("returns the same object twice while nothing has changed (EV19)", () => {
    const resolve = liveEnvResolver();
    expect(resolve()).toBe(resolve());
  });

  it("re-resolves after an in-place mutation is announced", () => {
    const map = { [envKey("grade", "saturate")]: -0.5 };
    setEnvOverrides(map);
    const resolve = liveEnvResolver();
    expect(resolve().grade.saturate).toBe(-0.5);
    map[envKey("grade", "saturate")] = -0.9;
    bumpEnvVersion();
    expect(resolve().grade.saturate).toBe(-0.9);
  });

  it("clears back to the shipped table on null", () => {
    setEnvOverrides({ [envKey("grade", "saturate")]: -0.5 });
    setEnvOverrides(null);
    expect(liveEnvResolver()()).toEqual(ENVIRONMENT_FX);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- env-store`
Expected: FAIL — `Failed to resolve import "./env-store.js"`.

- [ ] **Step 3: Write `fx/env-store.ts`**

```ts
import type { EnvironmentFx } from "./environment.js";
import { resolveEnvironment, type EnvOverrides, type EnvResolver } from "./env-tuning.js";

/**
 * The live environment override map (spec EV18, EV19).
 *
 * A module-level singleton for exactly the reason `fx/override-store.ts` is one: the thing that SETS
 * it is a DOM overlay with no handle on the Phaser scene, and the thing that READS it is several
 * layers down.
 *
 * Being global is not what decides its reach. Only a playground room builds a resolver over it
 * (`ArenaScene`), so a shipped arena or practice session never reads a byte of this even when a
 * developer has a tuning session saved in the same browser (EV34).
 */
let current: EnvOverrides = {};

/**
 * Bumped whenever the map changes. This is the one place the environment resolver must NOT copy the
 * weapon one (EV19): `resolveWeaponFx` runs once per event, a handful of times a frame, while
 * `resolveEnvironment` would run per particle per frame through `decalFadeAlpha` and its
 * neighbours. Rebuilding a sixty-field object that often is a per-frame allocation storm, so the
 * resolver caches on this counter and re-resolves once per EDIT instead.
 */
let version = 0;
let cachedVersion = -1;
let cached: EnvironmentFx | undefined;

export function envOverrides(): EnvOverrides {
  return current;
}

/** Replace the map. `null` clears it — what `PlaygroundScene.onShutdown` calls. */
export function setEnvOverrides(next: EnvOverrides | null): void {
  current = next ?? {};
  version++;
}

/**
 * Announce that the map was mutated in place.
 *
 * The panel mutates `current` directly, exactly as the physics and VFX panels mutate their own maps,
 * so there is no assignment for `setEnvOverrides` to catch. Every panel edit calls this.
 */
export function bumpEnvVersion(): void {
  version++;
}

export function liveEnvResolver(): EnvResolver {
  return () => {
    if (cachedVersion !== version || cached === undefined) {
      cached = resolveEnvironment(current);
      cachedVersion = version;
    }
    return cached;
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @motor-combat-moba/client -- env-store`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/env-store.ts packages/client/src/fx/env-store.test.ts
git commit -m "feat(fx): the environment override store, memoised on a version counter (EV18, EV19)"
```

---

### Task 10: `FxLayer` takes an environment resolver

**Files:**
- Modify: `packages/client/src/fx/layer.ts`

**Interfaces:**
- Consumes: `EnvResolver` (Task 8), `ENVIRONMENT_FX` (Task 1), the `env`-aware fx functions (Tasks 2, 4, 5, 6, 7).
- Produces: `new FxLayer(scene, seed, arenaWidth, arenaHeight, resolveFx?, resolveEnv?: EnvResolver)`, `FxLayer.rebuildFloor(seed?: number): void`, `FxLayer.trimDecals(): void`.

`layer.ts` has no test by design (its own comment says so), so this task is verified by the typecheck, the rest of the suite, and a manual run in Task 13.

- [ ] **Step 1: Add the resolver to the constructor**

```ts
import type { EnvResolver } from "./env-tuning.js";
import { ENVIRONMENT_FX } from "./environment.js";

const SHIPPED_ENV: EnvResolver = () => ENVIRONMENT_FX;

export class FxLayer {
  private readonly resolveEnv: EnvResolver;
  /** The seed the floor was last generated with, so `rebuildFloor` can reuse or replace it (EV27). */
  private floorSeed: number;

  constructor(
    scene: Phaser.Scene,
    seed: number,
    arenaWidth: number,
    arenaHeight: number,
    resolveFx: WeaponFxResolver = weaponFxOf,
    resolveEnv: EnvResolver = SHIPPED_ENV,
  ) {
    this.scene = scene;
    this.resolveFx = resolveFx;
    this.resolveEnv = resolveEnv;
    this.floorSeed = seed;
    this.uploadTextures(seed);
    // ... unchanged
  }
```

- [ ] **Step 2: Route every environment read through the resolver**

Replace the direct `ENVIRONMENT_FX` reads Tasks 4 and 5 left behind, and pass `env` into the fx calls:

```ts
  update(view: FxWorldView, dtMs: number): void {
    const env = this.resolveEnv();
    this.clockMs += dtMs;
    const events = deriveFxEvents(this.prevView, view);
    this.frameEvents = events;
    this.spawn(emitterSpecsForAll(events, this.resolveFx, env));

    const scorchCap = env.decals.maxScorch;
    for (const event of events) {
      for (const stamp of decalStampsFor(event, env, this.resolveFx)) {
        this.pushDecal(this.scorchDecals, scorchCap, {
          key: FX_TEXTURE_KEYS.scorch,
          x: stamp.x,
          y: stamp.y,
          scale: stamp.scale,
          baseAlpha: stamp.alpha,
          rotation: Math.random() * Math.PI * 2,
          tint: 0xffffff,
          bornAtMs: this.clockMs,
        });
      }
    }

    this.layTyreMarks(view, env);
    this.redrawDecals(env);
    this.maskSmoke(view, env);
    this.prevView = view;
  }
```

- `layTyreMarks(view, env)` passes `env` to `tyreMarkSteps` and `tyreMarksFor`, caps at `env.decals.maxTotal - env.decals.maxScorch`, and tints with `env.decals.tyreTint`.
- `redrawDecals(env)` passes `env` to `stampSurvivors`, which passes it to `decalFadeAlpha`.
- `maskSmoke(view, env)` passes `env` to `eraserStampsFor`.
- `buildEraserTextures` reads `this.resolveEnv()` for `eraserStampWidth`, `eraserStampHeight` and the halo inset.

Delete the module-level `MAX_SCORCH_DECALS` and `MAX_TYRE_DECALS` constants and the `0x141210` literal.

- [ ] **Step 3: Add `rebuildFloor` and `trimDecals`**

```ts
  /**
   * Regenerate and re-upload the asphalt (EV27).
   *
   * Behind a button rather than run on every slider tick: generating 512x512 pixels of two-octave
   * tileable fbm on every `input` event would lock the panel.
   *
   * **The caller must re-point the tile sprite afterwards** (EV28). `add()` removes the texture and
   * creates a new one, but a `TileSprite` holds a REFERENCE to the old texture object, so it keeps
   * drawing the stale image until `setTexture` is called again. `ArenaScene.rebuildFloor` does that;
   * this method cannot, because the tile sprite is the scene's, not the layer's.
   */
  rebuildFloor(seed?: number): void {
    if (seed !== undefined) this.floorSeed = seed;
    this.addTexture(FX_TEXTURE_KEYS.asphalt, asphaltTexture(this.floorSeed, 512, this.resolveEnv()));
  }

  /**
   * Drop decals that a lowered cap has made surplus (EV24).
   *
   * Without this a cap lowered from 600 to 50 would only bite as new decals arrived, so the change
   * would read as having done nothing for the next half-minute of driving.
   */
  trimDecals(): void {
    const env = this.resolveEnv();
    const scorchCap = env.decals.maxScorch;
    const tyreCap = Math.max(0, env.decals.maxTotal - scorchCap);
    if (this.scorchDecals.length > scorchCap) {
      this.scorchDecals.splice(0, this.scorchDecals.length - scorchCap);
    }
    if (this.tyreDecals.length > tyreCap) {
      this.tyreDecals.splice(0, this.tyreDecals.length - tyreCap);
    }
  }
```

Lift the `add` closure out of `uploadTextures` into a private `addTexture(key, tex)` method so `rebuildFloor` can reuse it rather than copying the remove-then-`createCanvas` dance.

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w @motor-combat-moba/client && npm test -w @motor-combat-moba/client`
Expected: PASS. No behaviour has changed yet — every caller still uses the default resolver.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx/layer.ts
git commit -m "feat(fx): FxLayer takes an environment resolver, gains rebuildFloor and trimDecals (EV24, EV27, EV28)"
```

---

### Task 11: Persist the environment overrides

**Files:**
- Modify: `packages/client/src/dev/playground/storage.ts`
- Modify: `packages/client/src/dev/playground/storage.test.ts`

**Interfaces:**
- Consumes: `EnvOverrides`, `ENV_FIELDS`, `envKey` (Task 8).
- Produces: `StoredPlayground.env: EnvOverrides`, `sanitizeStoredEnv(value: unknown): EnvOverrides`.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/dev/playground/storage.test.ts`:

```ts
import { envKey } from "../../fx/env-tuning.js";
import { sanitizeStoredEnv } from "./storage.js";

describe("sanitizeStoredEnv (EV32)", () => {
  it("keeps a valid entry", () => {
    expect(sanitizeStoredEnv({ [envKey("grade", "saturate")]: -0.5 })).toEqual({
      "grade.saturate": -0.5,
    });
  });

  it("drops one bad entry and keeps the rest", () => {
    const out = sanitizeStoredEnv({
      [envKey("grade", "saturate")]: -0.5,
      "grade.nope": 1,
      "nope.saturate": 1,
      [envKey("vignette", "strength")]: 99,
      [envKey("floor", "grainCells")]: 33.5,
      [envKey("hitStop", "ms")]: "90",
    });
    expect(out).toEqual({ "grade.saturate": -0.5 });
  });

  it("returns an empty map for a non-object", () => {
    expect(sanitizeStoredEnv(null)).toEqual({});
    expect(sanitizeStoredEnv("nope")).toEqual({});
  });

  it("loads a pre-existing blob that has no env section as empty", () => {
    const decoded = decodeStored(JSON.stringify({ setup: defaultPlaygroundSetup(), vfx: {} }));
    expect(decoded.env).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @motor-combat-moba/client -- storage`
Expected: FAIL — `sanitizeStoredEnv` is not exported.

- [ ] **Step 3: Add the section**

In `packages/client/src/dev/playground/storage.ts`:

```ts
import { ENV_FIELDS, envKey, type EnvOverrides } from "../../fx/env-tuning.js";

export interface StoredPlayground {
  // ... existing fields
  env: EnvOverrides;
}

/**
 * Read the `env` section back, entry by entry, dropping anything that no longer makes sense.
 *
 * Lenient in the same way `sanitizeStoredVfx` is, and for the same reason (EV32): a stale key left
 * by a renamed field, a retuned range, or a hand-edited blob must cost that one entry, never the
 * whole tuning session. A fractional value in an `integer` field is dropped rather than rounded — a
 * fractional `floor.grainCells` reopens the tiling seam, so a silent round would be a repair the
 * developer never asked for.
 */
export function sanitizeStoredEnv(value: unknown): EnvOverrides {
  if (!isPlainRecord(value)) return {};
  const out: EnvOverrides = {};
  for (const field of ENV_FIELDS) {
    const key = envKey(field.section, field.name);
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    if (raw < field.min || raw > field.max) continue;
    if (field.kind !== "number" && !Number.isInteger(raw)) continue;
    out[key] = raw;
  }
  return out;
}
```

Add `env: sanitizeStoredEnv(rec.env)` to `decodeStored`'s returned object. **No storage version bump** — `decodeStored` already tolerates a missing section, so an existing blob loads with `env: {}`.

Update every construction of a `StoredPlayground` literal in the file and in `storage.test.ts` to carry `env`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @motor-combat-moba/client -- storage && npm run typecheck -w @motor-combat-moba/client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/playground/storage.ts packages/client/src/dev/playground/storage.test.ts
git commit -m "feat(playground): persist environment VFX overrides (EV32)"
```

---

### Task 12: `ArenaScene` applies the environment

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `liveEnvResolver` (Task 9), `FxLayer.rebuildFloor`/`trimDecals` (Task 10), `ENVIRONMENT_FX` (Task 1).
- Produces: `ArenaScene.applyEnvironment(): void` (re-applies grade, vignette and markings from the current resolver), `ArenaScene.rebuildFloor(seed?: number): void`.

No unit test — `ArenaScene` is Phaser-bound. Verified by typecheck plus the manual run in Task 13.

- [ ] **Step 1: Hold the resolver and the filter controllers**

```ts
import { liveEnvResolver } from "../fx/env-store.js";
import type { EnvResolver } from "../fx/env-tuning.js";
import { ENVIRONMENT_FX } from "../fx/environment.js";

  private resolveEnv: EnvResolver = () => ENVIRONMENT_FX;
  private gradeFilter?: Phaser.Filters.ColorMatrix;
  private vignetteFilter?: Phaser.Filters.Vignette;
```

In `create`, before `new FxLayer(...)`:

```ts
    // Only a playground room resolves through the override store (EV34). Everything else gets the
    // shipped table, exactly as it does for WEAPON_FX.
    if (this.room && isPlaygroundRoom(this.room)) this.resolveEnv = liveEnvResolver();
```

and pass `this.resolveEnv` as the sixth `FxLayer` argument.

- [ ] **Step 2: Split the grade and vignette out of `drawArena`**

```ts
  /**
   * Re-apply the grade, the vignette and the painted markings from the current environment table.
   *
   * Called once from `drawArena` and again by the playground on every edit (EV25). The grade is a
   * `reset()` followed by the same three calls IN THE SHIPPED ORDER — Phaser composes
   * `M_new = M_old * a`, so the operation added LAST is applied FIRST to the pixel, which is why
   * the sequence runs brightness, then the warm gain, then the desaturation. The panel exposes the
   * four magnitudes and cannot reorder these three calls (EV26).
   */
  private applyEnvironment(): void {
    const env = this.resolveEnv();
    const grade = this.gradeFilter;
    if (grade) {
      grade.colorMatrix.reset();
      grade.colorMatrix.saturate(env.grade.saturate);
      grade.colorMatrix.multiply(
        [env.grade.warmR, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, env.grade.warmB, 0, 0, 0, 0, 0, 1, 0],
        true,
      );
      grade.colorMatrix.brightness(env.grade.brightness, true);
    }
    const vignette = this.vignetteFilter;
    if (vignette) {
      vignette.x = env.vignette.x;
      vignette.y = env.vignette.y;
      vignette.radius = env.vignette.radius;
      vignette.strength = env.vignette.strength;
    }
    this.redrawArenaGraphics();
  }
```

In `drawArena`, keep the controllers instead of discarding them, and call the new method:

```ts
    this.gradeFilter = cam.filters.internal.addColorMatrix();
    this.vignetteFilter = cam.filters.internal.addVignette();
    this.applyEnvironment();
```

- [ ] **Step 3: Lift the markings into their own method**

```ts
  /**
   * Redraw obstacles, painted markings and border from the current environment table (EV29).
   *
   * Clear-and-redraw rather than a second `Graphics`: the three share one object so they cost one
   * draw call, and the markings cannot be re-issued without re-issuing the other two.
   */
  private redrawArenaGraphics(): void {
    const gfx = this.arenaGfx;
    if (!gfx) return;
    const arena = this.arena;
    const env = this.resolveEnv();
    const colors = arenaColorsOf(arena);
    const m = env.markings;

    gfx.clear();
    gfx.fillStyle(colors.obstacle, 1);
    for (const obstacle of arena.obstacles) {
      gfx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    }
    gfx.lineStyle(m.laneWidth, m.laneColor, m.laneAlpha);
    for (let y = m.laneMargin; y < arena.height - m.laneMargin; y += m.laneSpacing) {
      gfx.lineBetween(
        arena.width / 2,
        y,
        arena.width / 2,
        Math.min(y + m.laneDash, arena.height - m.laneMargin),
      );
    }
    gfx.lineStyle(m.circleWidth, m.laneColor, m.circleAlpha);
    gfx.strokeCircle(arena.width / 2, arena.height / 2, m.circleRadius);

    gfx.lineStyle(ARENA_BORDER_PX, colors.border, 1);
    const border = arenaBorderRect(arena, ARENA_BORDER_PX);
    gfx.strokeRect(border.x, border.y, border.w, border.h);
  }
```

`drawArena` creates `this.arenaGfx` and then calls `applyEnvironment()`, which draws into it. **Guard against a zero or negative `laneSpacing`** — the `for` loop would never terminate. Clamp in the loop: `y += Math.max(1, m.laneSpacing)`. The field's `min` of 10 makes this unreachable through the panel; the clamp is for a hand-edited blob that `sanitizeStoredEnv` would have accepted.

- [ ] **Step 4: Add the public re-apply and floor rebuild hooks**

```ts
  /** Called by the playground overlay after an environment edit (EV25, EV29). */
  reapplyEnvironment(): void {
    this.applyEnvironment();
    this.fx?.trimDecals();
  }

  /**
   * Regenerate the asphalt and RE-POINT the tile sprite at it (EV28).
   *
   * The `setTexture` is not optional: `FxLayer.rebuildFloor` removes the old texture and creates a
   * new one under the same key, but the `TileSprite` holds a reference to the old texture OBJECT and
   * would keep drawing the stale image without this line.
   */
  rebuildFloor(seed?: number): void {
    this.fx?.rebuildFloor(seed);
    this.floorTile?.setTexture(FX_TEXTURE_KEYS.asphalt);
  }

  /** Rebuild the smoke-hole silhouettes after a halo edit (EV30). */
  rebuildOcclusion(): void {
    this.fx?.rebuildEraserTextures();
  }
```

- [ ] **Step 5: Route shake through the resolver**

At the two shake call sites, pass the env: `shakeFor(event, this.resolveEnv())` (~line 2290) and `ramShake(closingSpeed, this.resolveEnv())` (~line 1883). Replace the four `ENVIRONMENT_FX.hitStop` reads from Task 2 with `this.resolveEnv().hitStop`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck -w @motor-combat-moba/client && npm test -w @motor-combat-moba/client`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(client): ArenaScene applies the environment table live (EV25, EV26, EV28-EV30, EV34)"
```

---

### Task 13: The Environment settings panel

**Files:**
- Create: `packages/client/src/dev/playground/env-panel.ts`
- Modify: `packages/client/src/dev/playground/overlay.ts`

**Interfaces:**
- Consumes: `ENV_FIELDS`, `envKey`, `isEnvAtShipped`, `shippedEnvValue`, `envTableSource`, `EnvOverrides` (Task 8); `bumpEnvVersion`, `setEnvOverrides` (Task 9); `StoredPlayground.env` (Task 11); `ArenaScene.reapplyEnvironment`/`rebuildFloor`/`rebuildOcclusion` (Task 12).
- Produces: `buildEnvPanel(opts: EnvPanelOptions): HTMLElement`.

Like `vfx-panel.ts`, this module is untested by design — every decision it makes comes from `fx/env-tuning.ts`, which is tested; its own job is nodes, events and calling back.

- [ ] **Step 1: Write `env-panel.ts`**

```ts
import {
  ENV_FIELDS,
  envKey,
  isEnvAtShipped,
  shippedEnvValue,
  type EnvFieldDef,
  type EnvOverrides,
  type EnvSection,
} from "../../fx/env-tuning.js";
import { button, h } from "../../ui/dom.js";

/**
 * The environment settings panel (spec EV31).
 *
 * Sections are ordered by how often they are reached for, not alphabetically: the grade and the
 * vignette are the two things VFX27 calls "a large fraction of what reads as gritty", and the floor
 * and markings are the ones nobody retunes twice in a session.
 */
const SECTION_ORDER: readonly EnvSection[] = [
  "grade",
  "vignette",
  "shake",
  "hitStop",
  "decals",
  "occlusion",
  "floor",
  "markings",
  "carBursts",
];

const SECTION_LABELS: Record<EnvSection, string> = {
  grade: "Colour grade",
  vignette: "Vignette",
  shake: "Camera shake",
  hitStop: "Hit stop",
  decals: "Decals",
  occlusion: "Smoke occlusion",
  floor: "Floor texture",
  markings: "Painted markings",
  carBursts: "Car burst scaling",
};

export interface EnvPanelOptions {
  /** The live map. Mutated in place, exactly as the physics and VFX panels mutate their own. */
  readonly overrides: EnvOverrides;
  /** Save to localStorage. Called after every edit. */
  readonly persist: () => void;
  /**
   * Announce the edit and re-apply it. Called after every edit with the section that changed, so the
   * panel can ask for the right kind of apply: `floor` and `occlusion` are rebuilds, everything else
   * is live (EV23, EV27, EV30).
   */
  readonly onEdit: (section: EnvSection) => void;
  /** Regenerate the asphalt with the arena's own seed (EV27). */
  readonly onRegenerateFloor: () => void;
  /** Regenerate the asphalt with a fresh seed — preview only, never saved or exported (EV9). */
  readonly onRerollFloor: () => void;
  /** Fire one of each shake kind, because shake cannot be judged on a frozen field (EV31). */
  readonly onTestShake: () => void;
  /** Copy the export to the clipboard. */
  readonly onCopy: () => void;
  /** Leave the panel and return to the menu. */
  readonly onBack: () => void;
}

/** How many of a section's fields are overridden, so a collapsed block states its own condition. */
function sectionSummary(section: EnvSection, overrides: EnvOverrides): string {
  const n = ENV_FIELDS.filter(
    (f) => f.section === section && overrides[envKey(f.section, f.name)] !== undefined,
  ).length;
  return n === 0 ? "shipped" : `${n} changed`;
}

export function buildEnvPanel(opts: EnvPanelOptions): HTMLElement {
  let expanded: EnvSection | undefined = "grade";
  const body = h("div", { class: "pg-stats" });

  /** One control for one field, wired straight into the overrides map. */
  function fieldRow(field: EnvFieldDef): HTMLElement {
    const key = envKey(field.section, field.name);
    const shipped = shippedEnvValue(field);
    const value = overridesValue(field, shipped);

    const readout = h("span", { class: "pg-readout" }, [format(field, value)]);

    const commit = (next: number): void => {
      if (isEnvAtShipped(field, next, shipped)) delete opts.overrides[key];
      else opts.overrides[key] = next;
      readout.textContent = format(field, next);
      opts.persist();
      opts.onEdit(field.section);
    };

    if (field.kind === "color") {
      const input = h("input", { type: "color" }) as HTMLInputElement;
      input.value = `#${value.toString(16).padStart(6, "0")}`;
      input.addEventListener("input", () =>
        commit(Number.parseInt(input.value.slice(1), 16)),
      );
      return h("label", { class: "pg-field" }, [field.label, input, readout]);
    }

    const input = h("input", {
      type: "range",
      min: String(field.min),
      max: String(field.max),
      step: String(field.step),
    }) as HTMLInputElement;
    input.value = String(value);
    input.addEventListener("input", () => commit(Number(input.value)));
    return h("label", { class: "pg-field" }, [field.label, input, readout]);
  }

  function overridesValue(field: EnvFieldDef, shipped: number): number {
    const stored = opts.overrides[envKey(field.section, field.name)];
    return typeof stored === "number" ? stored : shipped;
  }

  function format(field: EnvFieldDef, value: number): string {
    if (field.kind === "color") return `#${value.toString(16).padStart(6, "0")}`;
    return String(Number(value.toFixed(6)));
  }

  function sectionExtras(section: EnvSection): HTMLElement[] {
    if (section === "floor") {
      return [
        button({}, ["Regenerate"], opts.onRegenerateFloor),
        // Preview only. The seed is arena-derived so every client generates the same floor, which is
        // why it is neither a field nor persisted (EV9).
        button({}, ["Reroll seed (preview)"], opts.onRerollFloor),
      ];
    }
    if (section === "shake") return [button({}, ["Test shake"], opts.onTestShake)];
    return [];
  }

  function renderBody(): void {
    body.replaceChildren();
    for (const section of SECTION_ORDER) {
      const isOpen = expanded === section;
      const head = button({ class: "pg-section-head" }, [
        `${SECTION_LABELS[section]} — ${sectionSummary(section, opts.overrides)}`,
      ], () => {
        expanded = isOpen ? undefined : section;
        renderBody();
      });
      body.appendChild(head);
      if (!isOpen) continue;
      const rows = ENV_FIELDS.filter((f) => f.section === section).map(fieldRow);
      body.appendChild(h("div", { class: "pg-section-body" }, [...rows, ...sectionExtras(section)]));
    }
  }

  renderBody();
  return h("div", { class: "pg-env" }, [
    h("div", { class: "pg-head" }, [
      button({}, ["Back"], opts.onBack),
      button({}, ["Copy environment"], opts.onCopy),
    ]),
    body,
  ]);
}
```

**The one thing to get right here:** `renderBody` rebuilds only on a section expand/collapse, never on a slider `input`. `commit` mutates the readout in place. Rebuilding the body mid-drag is the bug that was fixed twice in the VFX panel ("stop the VFX panel tearing down a slider mid-drag", "stop count edits from tearing down the vfx panel mid-drag") — do not reintroduce it.

- [ ] **Step 2: Add the scene hooks**

The overlay does **not** hold a handle on the arena scene — it takes injected callbacks, because
`onArenaChanged` stops and relaunches that scene while the overlay outlives it, so a captured
reference would be a use-after-destroy on the next arena change. Follow `previewFx` exactly.

In `packages/client/src/scenes/ArenaScene.ts`, add the shake tester beside Task 12's other hooks:

```ts
  /**
   * Fire one of each shake kind, for the panel's Test shake button (EV31).
   *
   * Its own method rather than a synthetic `FxEvent` through `previewFx`: `previewFx` deliberately
   * does NOT put anything in `lastEvents()`, precisely so a burst preview cannot shake the camera.
   * This is the opposite requirement, so it goes straight to `tryShake`.
   */
  testShake(): void {
    const env = this.resolveEnv();
    const kinds: FxEvent[] = [
      { kind: "damaged", sessionId: "preview", x: 0, y: 0, amount: 40 },
      { kind: "shotEnded", weaponId: "magmablast", x: 0, y: 0, angle: 0 },
      { kind: "died", sessionId: "preview", x: 0, y: 0 },
    ];
    let delay = 0;
    for (const event of kinds) {
      const spec = shakeFor(event, env);
      if (spec) this.time.delayedCall(delay, () => this.tryShake(spec));
      delay += 400;
    }
    this.time.delayedCall(delay, () => this.tryShake(ramShake(300, env)));
  }
```

In `packages/client/src/dev/PlaygroundScene.ts`, add a hooks object resolved at call time, in the
same shape and for the same reason as `previewFx`:

```ts
  /**
   * The environment panel's four hooks into the running `ArenaScene`.
   *
   * Resolved at CALL time, never held — identical reasoning to `previewFx` above. Each no-ops while
   * the scene is between a stop and a relaunch.
   */
  private envHooks(): PlaygroundEnvHooks {
    const arena = (): ArenaScene | undefined => this.scene.get("arena") as ArenaScene | undefined;
    return {
      reapply: () => arena()?.reapplyEnvironment?.(),
      rebuildFloor: (seed) => arena()?.rebuildFloor?.(seed),
      rebuildOcclusion: () => arena()?.rebuildOcclusion?.(),
      testShake: () => arena()?.testShake?.(),
    };
  }
```

and pass it as a fourth argument:

```ts
    this.unmountOverlay = mountPlaygroundOverlay(
      room,
      () => this.onArenaChanged(),
      (specs) => this.previewFx(specs),
      this.envHooks(),
    );
```

- [ ] **Step 3: Wire the panel into `overlay.ts`**

Add the parameter and the type:

```ts
export interface PlaygroundEnvHooks {
  readonly reapply: () => void;
  readonly rebuildFloor: (seed?: number) => void;
  readonly rebuildOcclusion: () => void;
  readonly testShake: () => void;
}

export function mountPlaygroundOverlay(
  room: Room<PlaygroundState>,
  onArenaChanged: () => void,
  previewFx: (specs: readonly EmitterSpec[]) => void,
  envHooks: PlaygroundEnvHooks,
): () => void {
```

Then follow the `"vfx"` sub-view wiring exactly:

```ts
  let subView: "menu" | "physics" | "vfx" | "env" = "menu";
  const envOverridesMap: EnvOverrides = { ...loadStored().env };
  setEnvOverrides(envOverridesMap);

  function persistEnv(): void {
    const stored = loadStored();
    saveStored({ ...stored, env: { ...envOverridesMap } });
  }
```

Add a `button({}, ["Environment settings"], () => { subView = "env"; render(); })` beside the two
existing ones, an `else if (view === "env") root.appendChild(buildEnvPanel({ ... }))` branch, and
include `env: { ...envOverridesMap }` wherever the overlay writes a full `StoredPlayground`.

The panel's options object:

```ts
    return buildEnvPanel({
      overrides: envOverridesMap,
      persist: persistEnv,
      onEdit: (section) => {
        // The store caches on this counter, so an in-place mutation is invisible without it (EV19).
        bumpEnvVersion();
        // `floor` is Regenerate-only: regenerating 512x512 pixels of fbm per slider tick would lock
        // the panel (EV27). A halo edit must rebuild the baked silhouettes or the hole's soft edge
        // drifts off its own border (EV30).
        if (section === "floor") return;
        if (section === "occlusion") envHooks.rebuildOcclusion();
        envHooks.reapply();
      },
      onRegenerateFloor: () => envHooks.rebuildFloor(),
      // Preview only: never written to `envOverridesMap`, so never persisted and never exported (EV9).
      onRerollFloor: () => envHooks.rebuildFloor(Math.floor(Math.random() * 1_000_000_000)),
      onTestShake: () => envHooks.testShake(),
      onCopy: () => {
        const source = envTableSource(envOverridesMap);
        copyText(source === "" ? "// no environment overrides to copy" : source);
      },
      onBack: () => {
        subView = "menu";
        render();
      },
    });
```

Add `setEnvOverrides(null)` beside the existing `setFxOverrides(null)` on unmount, and
`.pg-env { min-width: 460px; }` beside `.pg-vfx` in the CSS block.

- [ ] **Step 4: Verify by running it**

Run: `npm run typecheck -w @motor-combat-moba/client && npm test -w @motor-combat-moba/client`
Then `npm run dev` and open `http://localhost:5173/?dev=playground`. Check each by eye:

1. **Grade** — drag `saturate` to `-1`; the arena goes grey immediately.
2. **Vignette** — drag `strength` to `1`; the corners darken. Set it back to `0.42`; the readout returns to shipped and the override disappears from the section summary.
3. **Decals** — drive; drop `halfLifeMs` to `2000` and watch the existing rubber fade out at once (EV24). Drop `maxTotal` to `50` and watch the trail shorten immediately rather than over the next half-minute.
4. **Floor** — change `baseGrey`; **nothing happens until you press Regenerate** (EV27). Press it; the asphalt changes. **If it does not, `setTexture` is missing** (EV28).
5. **Markings** — change `circleRadius`; the painted circle resizes with no button.
6. **Occlusion** — raise `halo` to `40`; the hole in the smoke grows AND its soft edge stays on its own border (EV30). A hard-edged or offset hole means `rebuildOcclusion` was not called.
7. **Shake** — press Test shake; the camera moves. Raise `max` and press again; it moves more.
8. **Persistence** — reload the page; every override is still there and still applied.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/playground/env-panel.ts packages/client/src/dev/playground/overlay.ts packages/client/src/dev/PlaygroundScene.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(playground): the Environment settings panel (EV31, EV33)"
```

---

### Task 14: Car events in the weapon panel

**Files:**
- Modify: `packages/client/src/fx/tuning.ts`
- Modify: `packages/client/src/fx/tuning.test.ts`
- Modify: `packages/client/src/dev/playground/ui-model.ts`
- Modify: `packages/client/src/dev/playground/ui-model.test.ts`
- Modify: `packages/client/src/dev/playground/storage.ts`
- Modify: `packages/client/src/dev/playground/vfx-panel.ts`

**Interfaces:**
- Consumes: `CAR_EVENT_IDS`, `isCarEventId` (Task 7).
- Produces: `fxCellsFor(subjectId, overrides, phases?: readonly FxPhase[])`, `phasesForSubject(id): readonly FxPhase[]`, `fxSubjectOptions(): { id: string; name: string }[]`, `isFxSubjectId(id): boolean`. `fxTableSource` splits its output into a `WEAPON_FX` group and a `CAR_EVENT_FX` group.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/fx/tuning.test.ts`:

```ts
describe("car event subjects (EV21, EV22)", () => {
  it("gives a car event one phase, not two", () => {
    expect(phasesForSubject("carDeath")).toEqual(["impact"]);
    expect(phasesForSubject("magmablast")).toEqual(["muzzle", "impact"]);
  });

  it("builds four cells for a car event and eight for a weapon", () => {
    expect(fxCellsFor("carDeath", {}, phasesForSubject("carDeath"))).toHaveLength(4);
    expect(fxCellsFor("magmablast", {}, phasesForSubject("magmablast"))).toHaveLength(8);
  });

  it("resolves an override on a car event through the normal key format", () => {
    const row = resolveWeaponFx("carDeath", { "carDeath.impact.fire.count": 3 });
    expect(row.impact.find((b) => b.channel === "fire")!.count).toBe(3);
  });

  it("emits car rows into their own group in the export", () => {
    const source = fxTableSource({ "carDeath.impact.fire.count": 3 });
    expect(source).toContain("CAR_EVENT_FX");
    expect(source).toContain("carDeath: {");
  });
});
```

Append to `packages/client/src/dev/playground/ui-model.test.ts` (`fxSubjectOptions` lives in
`ui-model.ts`, so its test belongs beside it rather than in `tuning.test.ts`):

```ts
describe("fxSubjectOptions (EV20)", () => {
  it("lists every weapon, then both car events, in that order", () => {
    const options = fxSubjectOptions();
    expect(options).toHaveLength(Object.keys(WEAPON_TABLE).length + 2);
    expect(options.at(-2)).toEqual({ id: "carDamage", name: "Car: damage" });
    expect(options.at(-1)).toEqual({ id: "carDeath", name: "Car: death" });
  });
});
```

Append to `packages/client/src/dev/playground/storage.test.ts`:

```ts
it("keeps a car event override, which isWeaponId alone would have dropped", () => {
  expect(sanitizeStoredVfx({ "carDeath.impact.fire.count": 3 })).toEqual({
    "carDeath.impact.fire.count": 3,
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @motor-combat-moba/client -- tuning storage ui-model`
Expected: FAIL — `phasesForSubject` is not exported, and `sanitizeStoredVfx` drops the car key because `isWeaponId("carDeath")` is false.

- [ ] **Step 3: Widen `fx/tuning.ts`**

```ts
import { CAR_EVENT_IDS, isCarEventId } from "./table.js";

/**
 * Which phases a subject has (EV21).
 *
 * A car event has no muzzle, so it renders a 1 x 4 grid rather than 2 x 4. It reuses the EXISTING
 * `"impact"` phase rather than introducing a third value, which is what keeps the override key
 * format and `sanitizeStoredVfx`'s phase check untouched.
 */
export function phasesForSubject(id: string): readonly FxPhase[] {
  return isCarEventId(id) ? ["impact"] : FX_PHASES;
}

/** Every id the fx panel can edit. Weapons first, then the two car events. */
export function isFxSubjectId(id: string): boolean {
  return isWeaponId(id) || isCarEventId(id);
}
```

Give `fxCellsFor` a third parameter, `phases: readonly FxPhase[] = FX_PHASES`, and loop over it instead of `FX_PHASES`.

In `fxTableSource`, partition the touched ids and emit two labelled groups so a paste lands in the right table:

```ts
  const weaponRows = ids.filter((id) => !isCarEventId(id)).map(rowSource);
  const carRows = ids.filter(isCarEventId).map(rowSource);
  const parts: string[] = [];
  if (weaponRows.length > 0) parts.push(`// WEAPON_FX\n${weaponRows.join("\n")}`);
  if (carRows.length > 0) parts.push(`// CAR_EVENT_FX\n${carRows.join("\n")}`);
  return parts.join("\n\n");
```

- [ ] **Step 4: Widen the selector and the sanitizer**

In `packages/client/src/dev/playground/ui-model.ts`:

```ts
/** Every subject the VFX panel can edit: the ten weapons, then the two car events (EV20). */
export function fxSubjectOptions(): { id: string; name: string }[] {
  return [
    ...Object.values(WEAPON_TABLE).map((row) => ({ id: row.id as string, name: row.name })),
    { id: "carDamage", name: "Car: damage" },
    { id: "carDeath", name: "Car: death" },
  ];
}
```

In `packages/client/src/dev/playground/storage.ts`, replace `sanitizeStoredVfx`'s `if (!isWeaponId(weaponId)) continue;` with `if (!isFxSubjectId(weaponId)) continue;`, and add a phase guard so a `muzzle` key saved against a car event is dropped:

```ts
    if (!phasesForSubject(weaponId).some((p) => p === phase)) continue;
```

- [ ] **Step 5: Update `vfx-panel.ts`**

Swap `weaponOptions()` for `fxSubjectOptions()`, pass `phasesForSubject(weaponId)` into `fxCellsFor`, and render only those phases. For a car event, label the `count` control **"Count cap"** rather than "Count", so EV22's reinterpretation is visible on screen rather than inferred:

```ts
  const isCap = isCarEventId(weaponId) && field.name === "count";
  const label = isCap ? "Count cap" : field.label;
```

- [ ] **Step 6: Run the tests and the app**

Run: `npm test -w @motor-combat-moba/client && npm run typecheck -w @motor-combat-moba/client`
Expected: PASS.

Then `npm run dev`, open `?dev=playground` → VFX settings. Check: the selector ends with "Car: damage" and "Car: death"; picking either shows **one** phase block; the damage entry's count control reads "Count cap"; editing `carDeath`'s fire count and killing a bot shows the change; Copy emits two labelled groups.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/fx/tuning.ts packages/client/src/fx/tuning.test.ts packages/client/src/dev/playground/ui-model.ts packages/client/src/dev/playground/ui-model.test.ts packages/client/src/dev/playground/storage.ts packages/client/src/dev/playground/vfx-panel.ts
git commit -m "feat(playground): tune the car damage and death bursts in the VFX panel (EV20-EV22)"
```

---

### Task 15: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/project-structure.md`

**Interfaces:** none.

- [ ] **Step 1: Update the root `CLAUDE.md`**

Extend the VFX paragraph in the "Read the right doc" table's playground row to name the environment spec, and add a short paragraph beside the existing VFX one:

> **The playground tunes two kinds of VFX, and they are different shapes.** Per-weapon bursts live in
> `fx/table.ts` and are edited as a 2x4 grid; the environment — grade, vignette, shake, hit-stop,
> decals, occlusion, the generated floor and the painted markings — lives in `fx/environment.ts` as
> one `ENVIRONMENT_FX` table and is edited as a flat list of sections. Both reach the renderer the
> same way: a resolver injected by `ArenaScene` **only for a playground room**, so a shipped arena or
> a practice session renders the shipped tables no matter what is saved in that browser. Three
> environment knobs are not live — `floor.*` needs the panel's Regenerate button, and
> `occlusion.halo` rebuilds the smoke-hole silhouettes — see EV27, EV28 and EV30.

- [ ] **Step 2: Add the new files to `docs/project-structure.md`**

Add `fx/environment.ts`, `fx/env-tuning.ts`, `fx/env-store.ts` and `dev/playground/env-panel.ts` to the client's source tree listing, each with its one-line responsibility.

- [ ] **Step 3: Verify the whole suite from the root**

Run: `npm test`
Expected: PASS across shared, server, client and scripts.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/project-structure.md
git commit -m "docs: the environment VFX panel and its three non-live knobs"
```

---

## After the plan

**Say this in the summary, loudly:** nothing here touches shared, the sim, or any balance number, so
no playtest probe is invalidated and no manual rebuild is owed (EV2). The one thing a reader should
still check by eye is the **arena's look at rest** — the grade, the vignette and the floor are the
whole visual ground of the game, and the identity tests only prove the lift did not move them, not
that a later tuning session is an improvement.
