> # ⚠ UNFINISHED DRAFT — DO NOT EXECUTE
>
> Plan-writing was interrupted on 2026-09-05, at a **clean task boundary**: Tasks 1-6 below are
> complete, each ending with its verification and commit step. Roughly 85 % of the plan is here.
>
> **What is missing:**
>
> 1. **The measurement-and-guard task** (the assignment's item 6): draw calls ≤ 16 at the ceiling
>    measured in the bench scene; `sceneCensus` and `scripts/bench-arena.mjs` extended so a
>    per-frame world `Graphics` outside the floor and the beam layer **fails** rather than being
>    spotted by eye; `scripts/world-retained.test.mjs` as the source guard; V2's numbers recorded
>    beside V0's and V1's in `docs/render-bench.md`. This task was planned, not forgotten — its
>    files are already listed in the File Structure table below.
> 2. `## Acceptance`, `## Handoff` and `## Self-review`.
>
> **The missing `## Handoff` is the real blocker.** V3 is written by reading it; without it, V3's
> author has to reverse-engineer V2's exports out of 3,131 lines of task bodies.
>
> **Recommended: finish it, do not restart.** Hand a worker
> [`plan-authoring-brief.md`](plan-authoring-brief.md), the V2 assignment in
> [`PROGRESS.md`](PROGRESS.md) §5, and this draft; ask for the missing task and the three sections,
> then rename to `22-render-2-bake.md`. One caution: **the ledger moved after this draft began** —
> see PROGRESS §3 — so the worker must re-check Tasks 1-6 against the current
> [`interfaces.md`](interfaces.md) rather than trusting them.
>
> Everything below this line is the interrupted draft, unreviewed.

---

# Rendering Phase V2: Bake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take every world visual that is the same picture every frame — projectile bodies, glow bands, charge orbs, hp bars, lock brackets, dash ghosts, charge outlines, countdown arrows, car silhouettes and hitbox boxes — off the per-frame `Graphics` path and onto retained sprites drawn from two atlases, one baked at boot from the existing pure builders and one packed at build time from `public/art/`, leaving exactly two `Graphics` objects in the world: the arena floor (drawn once) and the beam layer (V3's).

**Architecture:** Three seams. `render/bake.ts` gains `worldBakeJobs(ss)` — the same `projectileDrawLayers`, `instanceGlowBands`, `chargeOrbBands`, `hpBarPoints`, `lockBracketArms`, `hullOutlinePoints`, `countdownArrowPoints` and `carShapeOf` builders the client runs sixty times a second today, run **once** into `baked-atlas` with a named frame each. `scripts/pack-atlas.mjs` packs the twelve authored PNGs named by `manifest.json` into `public/art/art-atlas.{png,json}`, a committed artefact whose freshness `npm run check:art` (and therefore `npm test`) enforces. `render/layers.ts` replaces the six scattered depth constants with one banded plan, one blend per band, and a `worldSprite` factory that is the only way a world object gets a depth or a blend mode. `ShotRenderer` and `CarRenderer` keep their constructors and their `render(frame, …)` signatures and swap their innards for two order-based sprite pools.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest in the node environment, Phaser 4.2.1 (`DynamicTexture`, atlas textures, multi-texture batching, tint), `sharp` (already a root devDependency) for the build-time packer, `node --test` for `scripts/*.test.mjs`, Playwright for `npm run bench:arena`.

**Spec:** [`../../specs/2026-09-04-client-rendering-architecture-design.md`](../../specs/2026-09-04-client-rendering-architecture-design.md) — §1 (the measured cost of the shipped world path: `fillCircle` is a 101-point path whatever its radius, `FillPath` runs earcut per fill per frame with nothing cached, ~20,000 client allocations per frame at the ceiling), §2 (`DynamicTexture`, the quad batch, tint modes), §3 R1/R2/R3/R4/R6, §4 (the render stack and the layer plan), §5 (the catalogue **in full** — projectile bodies, glow bands, orbs, hp bar, lock bracket, dash ghosts, charge outline, countdown arrow, car body and silhouette), §6 R13 (`bake.ts` runs the existing pure builders once at boot) and R15 (one build-time packer for authored art), R11 (two atlases), §9 R24/R25, §10 the V2 row, §11. Ledger: [`interfaces.md`](interfaces.md) — `render/bake.ts` (**extend**, do not re-create), `render/atlas.ts` (**extend**), `render/layers.ts` (new here). Prior plans, all assumed **landed**: [`01-prep-arena-scene-split-and-render-frame.md`](01-prep-arena-scene-split-and-render-frame.md) (`RenderFrame`, `match/frame-builder.ts`, `scenes/arena/*`, the `ArenaScene` composer), [`20-render-0-instrumentation.md`](20-render-0-instrumentation.md) (`?debug=perf`, `PerfOverlay`, `dev/BenchScene.ts`, `window.__bench`, `scripts/bench-visual.mjs`, `scripts/bench-arena.mjs`, `docs/render-bench.md` and the V0 baseline) and [`21-render-1-hud.md`](21-render-1-hud.md) — **read its `## Handoff` section in full before starting.** V1 already created `render/bake.ts`, `render/atlas.ts`, `render/fonts.ts`, `scenes/HudScene.ts`, `render/hud-feed.ts`, `scenes/hud/*`, `sceneCensus` and `scripts/hud-retained.test.mjs`; it deleted `ArenaLayers` and moved `MatchBanners` into the HUD scene, so `CarRenderer` and `ShotRenderer` are constructed as `(scene, debug)`.

## Global Constraints

- Rebuild shared before testing (`npm run build -w @motor-combat-moba/shared`).
- Verify with root `npm test`, never a per-workspace run alone.
- `.js` import specifiers on every local import; shared is imported as `@motor-combat-moba/shared` and consumed as built `dist`.
- Nothing under `packages/client/src/match/` imports Phaser and no test imports Phaser. This plan adds three more Phaser-free modules for the same reason — `render/layers.ts`, `scenes/arena/world-style.ts` and the new pure helpers in `scenes/combat-visual.ts` — each with a vitest node test, and **Task 3 Step 1 removes the one runtime `import Phaser` V1 left in `render/bake.ts`**, so `render/bake.test.ts` stops pulling Phaser in transitively.
- Do not touch `packages/server/playtest/` except to fix a compile break, and say loudly in the task's commit step which probe numbers your change moves. **This plan moves none:** it changes only how the client draws. No probe imports a client scene, and nothing here touches `sim/`, a balance table, the tick order, prediction, or step-context assembly. The two changes to `scenes/combat-visual.ts` (Task 2) are pure refactorings that keep every existing return value bit-for-bit identical, and `combat-visual.test.ts` is the proof.
- Do not edit `docs/ideas/` or `docs/invariants/`.
- Commit after every task on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch off it). In a fresh worktree run `npm install` before the first build, or every build inlines the **main checkout's** shared `dist`.
- No magic numbers in logic: every depth, band offset, blend mode, pad, step count, ease rate, colour and alpha is a named constant in `render/layers.ts`, `scenes/arena/world-style.ts` or `render/bake.ts`.
- No balance table, drive constant, `TICK_RATE_HZ`, weapon row, status row, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `AIM_CONFIG.lockRange` or `ARENA_WIDTH` changes here, so neither `npm run build:manual` nor `docs/turn-tuning.md` is owed an edit. If a diff touches one by accident, stop.
- **Only the netcode stream edits `packages/shared`.** This plan edits none of it; it only reads `WEAPON_TABLE`, `CAR_TABLE`, `DRIVE_CONFIG` and the shape helpers.
- `packages/client/public/art/art-atlas.png` and `.json` are **committed artefacts**, like `public/manual.html` and V1's font pages. They are rewritten only by `npm run pack:atlas`, never by hand.
- **This phase changes what `public/art/` contains and how it is loaded.** Task 4's commit step says so loudly and names `http://localhost:5173/manual.html` and `npm run check:art`. Do **not** run `npm run build:manual` for it: the guide still links the loose PNGs, the tables it reads are untouched, and rewriting the whole page would bury whether anything real moved.

## File Structure

| File | Responsibility |
|---|---|
| `packages/client/src/render/layers.ts` (create) | `Layer`, `LAYER_DEPTH`, `LAYER_BLEND`, `CAR_BAND`, `depthOf`, `worldSprite` — the one place a world object gets a depth or a blend |
| `packages/client/src/render/layers.test.ts` (create) | The banded plan: ordering, the D7 exception, band headroom, blends |
| `packages/client/src/render/sprite-pool.ts` (create) | `SpritePool` — grow-once, order-based, zero allocation per frame |
| `packages/client/src/render/sprite-pool.test.ts` (create) | Pool reuse and hide-on-shrink, against a stub image |
| `packages/client/src/scenes/arena/world-style.ts` (create) | Every world paint constant as a number, moved out of the two renderers, plus `HP_BAR_STEPS`, the ease and their pure functions |
| `packages/client/src/scenes/arena/world-style.test.ts` (create) | The hp step index and the ease |
| `packages/client/src/scenes/combat-visual.ts` (modify) | Five pure factorings so the bake and the frame path read the same numbers: `glowFlickerScale`, `glowBandsAtRest`, `chargeOrbMaxRadius`, `chargeOrbRadius`, `chargeOrbBandsAtRest`, `instanceDrawCentre`, `hpBarAnchor`; `UNKNOWN_WEAPON_COLOR`/`UNKNOWN_WEAPON_RADIUS` exported |
| `packages/client/src/scenes/combat-visual.test.ts` (modify) | The factorings return exactly what the originals did |
| `packages/client/src/render/bake.ts` (modify) | `import type Phaser`; `hudBakeJobs` split out; `worldBakeJobs(ss)` appended; `BakeGraphics` gains `fillEllipse`, `moveTo`, `lineTo` |
| `packages/client/src/render/bake.test.ts` (modify) | The world job list, its geometry against the recorder, and the packer at both sheet sizes |
| `packages/client/src/render/atlas.ts` (modify) | `ART_ATLAS`, `ATLAS_JSON_PATH`, `ATLAS_PNG_PATH`, `artFrame`, `artFrameExists`, `artFrameSize`, `artImage`, `loadArtAtlas` |
| `packages/client/src/assets/car-sprite.ts` (modify) | `phaserTextures` resolves through the atlas, so `fitSprite` sizes against the **frame**, not the sheet |
| `scripts/pack-atlas.mjs` (create) | The build-time packer: `packRects`, `atlasJson`, `sourceFingerprint`, `main` |
| `scripts/pack-atlas.test.mjs` (create) | `node --test` over the packer's pure halves and over the committed atlas |
| `scripts/check-art.mjs`, `scripts/check-art.test.mjs` (modify) | `NON_SPRITE_FILES`; `checkAtlasCoverage` — every row in the atlas, no stale frame, fingerprint matches |
| `scripts/build-release.mjs`, `scripts/build-release.test.mjs` (modify) | `assertAtlasShipped` — a release without the atlas fails instead of silently shipping loose-only |
| `packages/client/src/scenes/BootScene.ts` (modify) | Loads the art atlas before the loose PNGs |
| `packages/client/src/scenes/arena/shot-sprites.ts` (create) | `ShotSprites` — the retained pool that replaces the per-frame shot fills |
| `packages/client/src/scenes/arena/shot-renderer.ts` (modify) | Projectiles, glows and orbs become sprites; only the beam branch keeps its `Graphics` |
| `packages/client/src/scenes/arena/car-sprites.ts` (create) | `CarDecor` — hp bars, bracket, ghosts, charge outline, arrow as retained sprites |
| `packages/client/src/scenes/arena/car-renderer.ts` (modify) | Silhouette and hitbox become baked sprites; the four decoration `Graphics` are deleted |
| `packages/client/src/scenes/hud/slot-bar.ts` (modify) | The slot icon takes its art-atlas frame (V1's handoff: "inside `SlotView.applyWeapon` and nowhere else") |
| `packages/client/src/dev/AssetTuningScene.ts` (modify) | Two `add.image` call sites take the atlas frame |
| `packages/client/src/dev/BenchScene.ts` (modify) | The census gains `worldGraphicsNames` and the per-frame `Graphics.clear()` count |
| `scripts/bench-arena.mjs` (modify) | Three new hard failures |
| `scripts/world-retained.test.mjs` (create) | Source guard: the world renderers name no `Graphics` outside the two allowed files |
| `docs/render-bench.md`, `docs/asset-pipeline.md`, `CLAUDE.md`, `packages/client/CLAUDE.md`, `docs/project-structure.md` (modify) | The V2 numbers beside V0's and V1's; the atlas is no longer deferred; the shot-detail budget is no longer a fill count |
| `package.json` (modify) | `pack:atlas` |

---

### Task 1: `render/layers.ts` — the world layer plan, and the only way to get a depth

**Files:**
- Create: `packages/client/src/render/layers.ts`
- Test: `packages/client/src/render/layers.test.ts`
- Create: `packages/client/src/render/sprite-pool.ts`
- Test: `packages/client/src/render/sprite-pool.test.ts`

**Interfaces:**
- Consumes: nothing from earlier phases; `ARENA_DEPTH` in `scenes/arena/arena-floor.ts` (V0) is replaced by `depthOf(Layer.Floor)` in Task 6.
- Produces: `Layer`, `LAYER_DEPTH`, `LAYER_BLEND`, `BLEND_NORMAL`, `BLEND_ADD`, `CAR_BAND`, `depthOf`, `worldSprite` (`render/layers.ts`); `SpritePool` (`render/sprite-pool.ts`). Tasks 5 and 6 consume both; V3–V5 consume `worldSprite`.

**Why a band table and not eight numbers.** Today the world's depths are six constants scattered over `ArenaScene.ts:149-341` and carried into `car-renderer.ts` and `shot-renderer.ts` by the preparation plan — `HP_BAR_DEPTH 60`, `LOCK_DEPTH 55`, `ARROW_DEPTH 52`, `MANEUVER_DEPTH 2`, `CAR_DEPTH 0`, `SHOT_DEPTH -5`, `ARENA_DEPTH -10`. That block's own comment says what is wrong with it: "a depth that is not written down here is a layer whose position is an accident of display-list insertion order". Spec R4 wants more than that — **one atlas and one blend per layer, planned rather than discovered** — which means the blend mode has to live beside the depth and be applied once at creation, never per frame.

**The one place this plan disagrees with the spec's table, and why.** Spec §4 lists the layers in the order Floor, Decals, GroundFx, **Cars, Shots**, Glow, OverlayFx, Debug, and the ledger fixes that member order for the `Layer` enum. The shipped game draws shots *under* cars, deliberately (`SHOT_DEPTH`'s comment, decision D7: "One rule for all instances rather than a per-weapon 'is this a ground effect' flag"). V2 is a cost change, not an art change, so the **depths keep D7** and the enum keeps the ledger's declaration order: `LAYER_DEPTH` is the authority on what draws over what, and the test below pins the inversion so nobody "fixes" it by reading the enum.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/render/layers.test.ts
import { describe, expect, it } from "vitest";
import {
  BLEND_ADD,
  BLEND_NORMAL,
  CAR_BAND,
  LAYER_BLEND,
  LAYER_DEPTH,
  Layer,
  depthOf,
} from "./layers.js";

describe("the layer plan", () => {
  it("orders the bands as the spec's stack, except that shots stay under the cars (D7)", () => {
    const bottomUp = [
      Layer.Floor,
      Layer.Decals,
      Layer.GroundFx,
      Layer.Shots,
      Layer.Cars,
      Layer.Glow,
      Layer.OverlayFx,
      Layer.Debug,
    ];
    for (let i = 1; i < bottomUp.length; i++) {
      expect(LAYER_DEPTH[bottomUp[i]!]).toBeGreaterThan(LAYER_DEPTH[bottomUp[i - 1]!]);
    }
    // The one place the enum's declaration order and the drawn order differ.
    expect(LAYER_DEPTH[Layer.Shots]).toBeLessThan(LAYER_DEPTH[Layer.Cars]);
  });

  it("gives every band room for its own offsets without reaching the next band", () => {
    const widest = Math.max(...Object.values(CAR_BAND));
    expect(widest).toBeLessThan(LAYER_DEPTH[Layer.Glow] - LAYER_DEPTH[Layer.Cars]);
    expect(Math.min(...Object.values(CAR_BAND))).toBeGreaterThanOrEqual(0);
  });

  it("keeps the shipped stacking inside the car band: bar over bracket over arrow over ghost over body", () => {
    expect(CAR_BAND.hpBar).toBeGreaterThan(CAR_BAND.bracket);
    expect(CAR_BAND.bracket).toBeGreaterThan(CAR_BAND.arrow);
    expect(CAR_BAND.arrow).toBeGreaterThan(CAR_BAND.ghost);
    expect(CAR_BAND.ghost).toBeGreaterThan(CAR_BAND.body);
    expect(CAR_BAND.body).toBe(0);
  });

  it("blends additively on exactly the two bands the spec marks additive", () => {
    expect(LAYER_BLEND[Layer.Glow]).toBe(BLEND_ADD);
    expect(LAYER_BLEND[Layer.OverlayFx]).toBe(BLEND_ADD);
    for (const layer of [Layer.Floor, Layer.Decals, Layer.GroundFx, Layer.Cars, Layer.Shots, Layer.Debug]) {
      expect(LAYER_BLEND[layer]).toBe(BLEND_NORMAL);
    }
    // Phaser's own BlendModes values, not ours to choose.
    expect([BLEND_NORMAL, BLEND_ADD]).toEqual([0, 1]);
  });

  it("adds the offset to the band and defaults it to zero", () => {
    expect(depthOf(Layer.Cars, CAR_BAND.hpBar)).toBe(LAYER_DEPTH[Layer.Cars] + CAR_BAND.hpBar);
    expect(depthOf(Layer.Shots)).toBe(LAYER_DEPTH[Layer.Shots]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/render/layers.test.ts`
Expected: FAIL — cannot resolve `./layers.js`.

- [ ] **Step 3: Write `render/layers.ts`**

```ts
// packages/client/src/render/layers.ts
import type Phaser from "phaser";

/**
 * The world's render stack, as bands (spec R4 and section 4).
 *
 * Every world object belongs to exactly one band, and a band fixes two things: the depth range it
 * occupies and the blend mode everything in it is drawn with. Nothing in the world sets its own
 * blend mode — "if a look needs additive glow it is a sprite on the additive layer" — and nothing
 * sets a bare depth number, because a depth nobody wrote down is a layer whose position is an
 * accident of display-list insertion order.
 *
 * `import type Phaser`: types only, so this module is unit-tested in the node environment like the
 * rest of the pure render code. Phaser's `BlendModes` values are restated below rather than
 * imported for the same reason.
 *
 * Member order is the spec's table, and the ledger fixes it. The DEPTHS are not in that order in one
 * place, and deliberately: `Shots` sits BELOW `Cars`, which is decision D7 — every live weapon
 * instance draws under every car, one rule for all instances rather than a per-weapon "is this a
 * ground effect" flag. `LAYER_DEPTH` is the authority on what draws over what; the enum's
 * declaration order is not. `layers.test.ts` pins the inversion so it cannot be tidied away.
 */
export enum Layer {
  Floor,
  Decals,
  GroundFx,
  Cars,
  Shots,
  Glow,
  OverlayFx,
  Debug,
}

/**
 * The base depth of each band, spaced 100 apart.
 *
 * The spacing is the whole point: a band's own contents are placed with small offsets (`CAR_BAND`),
 * and 100 is wide enough that no offset can ever climb into the band above it — which
 * `layers.test.ts` asserts rather than trusting.
 */
export const LAYER_DEPTH: Readonly<Record<Layer, number>> = {
  [Layer.Floor]: -400,
  [Layer.Decals]: -300,
  [Layer.GroundFx]: -200,
  [Layer.Shots]: -100,
  [Layer.Cars]: 0,
  [Layer.Glow]: 100,
  [Layer.OverlayFx]: 200,
  [Layer.Debug]: 300,
};

/**
 * Phaser's `BlendModes.NORMAL` and `.ADD` (`node_modules/phaser/src/renderer/BlendModes.js`),
 * restated as plain numbers so this module needs no runtime Phaser import. `layers.test.ts` pins
 * both values; if a Phaser upgrade ever renumbers them, that test is what says so.
 */
export const BLEND_NORMAL = 0;
export const BLEND_ADD = 1;

/** One blend mode per band, applied once when an object is created — never per frame. */
export const LAYER_BLEND: Readonly<Record<Layer, number>> = {
  [Layer.Floor]: BLEND_NORMAL,
  [Layer.Decals]: BLEND_NORMAL,
  [Layer.GroundFx]: BLEND_NORMAL,
  [Layer.Shots]: BLEND_NORMAL,
  [Layer.Cars]: BLEND_NORMAL,
  [Layer.Glow]: BLEND_ADD,
  [Layer.OverlayFx]: BLEND_ADD,
  [Layer.Debug]: BLEND_NORMAL,
};

/**
 * Offsets inside the `Cars` band, carried over unchanged from the depth block this replaces
 * (`ArenaScene.ts:149-341`, moved into the two renderers by the preparation plan) so nothing moves
 * relative to anything else:
 *
 * - `hpBar` 60 — over everything: a bar is the last thing that may ever be hidden.
 * - `bracket` 55 — under the bar, over the cars: the bracket frames a car, it never occludes its hp.
 * - `arrow` 52 — the countdown marker for your own car, never hidden by the car it marks.
 * - `ghost` 2 — the wild-charge outline and the thunderclap dash ghosts, above the car so a
 *   charging car's outline is not drawn underneath its own sprite.
 * - `body` 0 — the car container itself, which used to rest on Phaser's implicit default.
 */
export const CAR_BAND = {
  body: 0,
  ghost: 2,
  arrow: 52,
  bracket: 55,
  hpBar: 60,
} as const;

/** A band's depth, optionally offset inside it. The only arithmetic anyone does on a depth. */
export function depthOf(layer: Layer, offset = 0): number {
  return LAYER_DEPTH[layer] + offset;
}

/**
 * A world sprite on a band: created once, given its depth and its band's blend mode, and never
 * asked about either again.
 *
 * This is the single entry point for a world image, which is what makes R4 checkable — a grep for
 * `setBlendMode` outside this file finds every violation, and `scripts/world-retained.test.mjs`
 * makes that grep part of `npm test`.
 */
export function worldSprite(
  scene: Phaser.Scene,
  layer: Layer,
  offset: number,
  texture: string,
  frame?: string,
): Phaser.GameObjects.Image {
  const image = scene.add.image(0, 0, texture, frame);
  image.setDepth(depthOf(layer, offset));
  image.setBlendMode(LAYER_BLEND[layer]);
  image.setVisible(false);
  return image;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/client && npx vitest run src/render/layers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for the pool**

```ts
// packages/client/src/render/sprite-pool.test.ts
import { describe, expect, it } from "vitest";
import { SpritePool, type PoolSprite } from "./sprite-pool.js";

/** The four setters a pool touches. Structurally a `Phaser.GameObjects.Image` and nothing more. */
function stub(): PoolSprite & { visible: boolean; destroyed: boolean } {
  const self = {
    visible: false,
    destroyed: false,
    setVisible(v: boolean) {
      self.visible = v;
      return self;
    },
    destroy() {
      self.destroyed = true;
    },
  };
  return self;
}

describe("SpritePool", () => {
  it("hands out sprites in order, grows once, and reuses the same objects next frame", () => {
    const made: ReturnType<typeof stub>[] = [];
    const pool = new SpritePool(() => {
      const s = stub();
      made.push(s);
      return s;
    });

    pool.begin();
    const a = pool.next();
    const b = pool.next();
    pool.end();
    expect(made).toHaveLength(2);
    expect(a.visible && b.visible).toBe(true);

    pool.begin();
    expect(pool.next()).toBe(a);
    expect(pool.next()).toBe(b);
    pool.end();
    expect(made).toHaveLength(2);
  });

  it("hides what a shorter frame did not use, and keeps it for the next one", () => {
    const made: ReturnType<typeof stub>[] = [];
    const pool = new SpritePool(() => {
      const s = stub();
      made.push(s);
      return s;
    });
    pool.begin();
    pool.next();
    pool.next();
    pool.end();

    pool.begin();
    pool.next();
    pool.end();
    expect(made[0]!.visible).toBe(true);
    expect(made[1]!.visible).toBe(false);
    expect(made[1]!.destroyed).toBe(false);
    expect(pool.size).toBe(2);
  });

  it("destroys everything it made", () => {
    const made: ReturnType<typeof stub>[] = [];
    const pool = new SpritePool(() => {
      const s = stub();
      made.push(s);
      return s;
    });
    pool.begin();
    pool.next();
    pool.end();
    pool.destroy();
    expect(made[0]!.destroyed).toBe(true);
    expect(pool.size).toBe(0);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/render/sprite-pool.test.ts`
Expected: FAIL — cannot resolve `./sprite-pool.js`.

- [ ] **Step 7: Write `render/sprite-pool.ts`**

```ts
// packages/client/src/render/sprite-pool.ts

/**
 * The two methods a pooled sprite has to have. Structural, not `Phaser.GameObjects.Image`, so the
 * pool is unit-tested in the node environment against a four-line stub — the same reason
 * `car-sprite.ts` narrows the texture manager to `TextureLookup`.
 */
export interface PoolSprite {
  setVisible(value: boolean): unknown;
  destroy(): void;
}

/**
 * A grow-once, order-based sprite pool: `begin()`, `next()` per thing to draw, `end()`.
 *
 * Order-based rather than keyed by instance id on purpose. A shot's id changes every time a new one
 * is fired, so a keyed pool would `Map.set`/`Map.delete` per shot per frame; nothing about a
 * projectile's drawing survives between frames (its position, angle and frame all come out of the
 * `RenderFrame`), so the Nth sprite of this frame may be a different shot from the Nth of the last
 * one and no player can tell. What that buys is spec R6: after the first few frames the pool has
 * grown to the ceiling and `next()` allocates nothing at all.
 *
 * `end()` hides the tail rather than destroying it — a destroyed sprite is a create on the next
 * frame that has one more thing to draw, which is exactly the churn this exists to avoid.
 */
export class SpritePool<T extends PoolSprite = PoolSprite> {
  private readonly items: T[] = [];
  private used = 0;

  constructor(private readonly make: () => T) {}

  /** How many sprites the pool has ever needed at once. */
  get size(): number {
    return this.items.length;
  }

  begin(): void {
    this.used = 0;
  }

  /** The next sprite, made if the pool has never been this busy. Visible; the caller places it. */
  next(): T {
    let item = this.items[this.used];
    if (!item) {
      item = this.make();
      this.items.push(item);
    }
    item.setVisible(true);
    this.used += 1;
    return item;
  }

  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i]!.setVisible(false);
  }

  destroy(): void {
    for (const item of this.items) item.destroy();
    this.items.length = 0;
    this.used = 0;
  }
}
```

- [ ] **Step 8: Run both tests and typecheck**

Run: `cd packages/client && npx vitest run src/render/layers.test.ts src/render/sprite-pool.test.ts && npm run typecheck`
Expected: PASS (8 tests); typecheck clean. Nothing uses either module yet.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/render/layers.ts packages/client/src/render/layers.test.ts \
  packages/client/src/render/sprite-pool.ts packages/client/src/render/sprite-pool.test.ts
git commit -m "feat(client): banded world layer plan and a grow-once sprite pool

Moves no playtest probe number: two new pure modules, nothing draws them yet."
```

---

### Task 2: The builders, factored so the bake and the frame path cannot disagree

**Files:**
- Modify: `packages/client/src/scenes/combat-visual.ts` (`:185`, `:203`, `:1089-1111`, `:1358-1382`, `:1969-1989`)
- Modify: `packages/client/src/scenes/combat-visual.test.ts`
- Create: `packages/client/src/scenes/arena/world-style.ts`
- Test: `packages/client/src/scenes/arena/world-style.test.ts`

**Interfaces:**
- Consumes: the existing `combat-visual.ts` builders; `HP_BAR_GEOMETRY` etc. as they stand in `car-renderer.ts` after the preparation plan.
- Produces: `UNKNOWN_WEAPON_COLOR`, `UNKNOWN_WEAPON_RADIUS`, `glowFlickerScale`, `glowBandsAtRest`, `chargeOrbMaxRadius`, `chargeOrbRadius`, `chargeOrbBandsAtRest`, `instanceDrawCentre`, `hpBarAnchor` (`scenes/combat-visual.ts`); every `HITBOX_*`/`HP_BAR_*`/`LOCK_*`/`ARROW_*`/`DASH_GHOST_*`/`PHASED_*` constant plus `HP_BAR_STEPS`, `HP_BAR_EASE_PER_SECOND`, `BAKE_WORLD_PAD_PX`, `hpBarStepIndex`, `easeHpFraction` (`scenes/arena/world-style.ts`). Tasks 3, 5 and 6 consume them.

**What this task is and is not.** Spec R13 says the bake runs **the existing pure builders**, not new art code, and R1 says a baked frame is the shape "up to position, rotation, scale, alpha and tint". Three of today's builders fold a *time-varying scale* into the shape they return, so a bake would freeze one arbitrary moment of it:

| Builder | What varies per frame | Baked as | Applied at draw time as |
|---|---|---|---|
| `instanceGlowBands` | the flicker, `1 − flickerDepth × wave(nowMs, spawnTick)` | the bands at scale 1 | the sprite's `scale` |
| `chargeOrbBands` | the wind-up radius, `min + (max − min) × progress` | the bands at `maxRadius` | the sprite's `scale` |
| `instanceDrawShape` | the projectile's extrapolated position | the shape centred on the origin | the sprite's `position` |

So each is split into an at-rest half the bake calls and a scale/position half the frame path calls, with the *original* function rebuilt out of the two so every existing caller and every existing test keeps its exact answer. Nothing in the picture changes; the multiplication just moves from the CPU's vertex loop to the GPU's transform.

- [ ] **Step 1: Write the failing tests for the factorings**

Append to `packages/client/src/scenes/combat-visual.test.ts`:

```ts
describe("the at-rest builders the bake uses", () => {
  it("splits the glow into bands at rest times a flicker scale, exactly as before", () => {
    // `magmablast` is the roster's one glow style and authors no flicker, so its scale is pinned 1.
    expect(glowFlickerScale("magmablast", 7, 1234)).toBe(1);
    expect(glowFlickerScale("predator", 7, 1234)).toBe(1);
    expect(glowFlickerScale("not-a-weapon", 7, 1234)).toBe(1);

    const atRest = glowBandsAtRest("magmablast", 12);
    expect(atRest).toEqual(instanceGlowBands("magmablast", 12, 7, 1234));
    expect(atRest.map((b) => b.radius)).toEqual([12, 12 * 0.74, 12 * 0.42]);
    expect(glowBandsAtRest("predator", 12)).toEqual([]);
  });

  it("scales the at-rest bands by the flicker for any style that has one", () => {
    // A style with a flicker: assembled here rather than authored, so the identity is tested even
    // while every shipped row has `flickerDepth: 0`.
    const radius = 20;
    const scale = glowFlickerScale("magmablast", 3, 500);
    for (const band of instanceGlowBands("magmablast", radius, 3, 500)) {
      expect(band.radius).toBeCloseTo(
        glowBandsAtRest("magmablast", radius).find((b) => b.fill === band.fill)!.radius * scale,
        10,
      );
    }
  });

  it("splits the charge orb into bands at its maximum times a progress radius", () => {
    // `lance` is the roster's one charge style; its wind-up is `weaponTicksOf("lance").startUp`.
    const total = weaponTicksOf("lance").startUp;
    expect(chargeOrbMaxRadius("lance")).toBe(18.9);
    expect(chargeOrbMaxRadius("predator")).toBe(0);

    // Half way through the wind-up.
    const half = Math.round(total / 2);
    const radius = chargeOrbRadius("lance", 100 + half, 100);
    const bands = chargeOrbBandsAtRest("lance");
    expect(bands.map((b) => b.radius)).toEqual([18.9, 18.9 * 0.7, 18.9 * 0.4]);
    const scaled = chargeOrbBands("lance", 100 + half, 100);
    for (let i = 0; i < scaled.length; i++) {
      expect(scaled[i]!.radius).toBeCloseTo(
        (bands[i]!.radius * radius) / chargeOrbMaxRadius("lance"),
        10,
      );
      expect(scaled[i]!.fill).toBe(bands[i]!.fill);
    }
  });

  it("answers a zero radius, and so draws nothing, when no wind-up is running", () => {
    expect(chargeOrbRadius("lance", 0, 100)).toBe(0);
    expect(chargeOrbRadius("lance", 100, 100)).toBe(0);
    expect(chargeOrbRadius("predator", 200, 100)).toBe(0);
    expect(chargeOrbBands("lance", 0, 100)).toEqual([]);
  });

  it("puts a projectile's sprite on the same point its hitbox is drawn at", () => {
    const shot = { weaponId: "predator", isExplosion: false, x: 100, y: 200, angle: 0.4, extent: 0 };
    const centre = instanceDrawCentre(shot, 25);
    const shape = instanceDrawShape(shot, 25);
    expect(shape.kind).toBe("polygon");
    // The capsule is symmetric about its centre, so the mean of its vertices IS the draw centre.
    if (shape.kind === "polygon") {
      const mean = shape.points.reduce(
        (acc, p) => ({ x: acc.x + p.x / shape.points.length, y: acc.y + p.y / shape.points.length }),
        { x: 0, y: 0 },
      );
      expect(mean.x).toBeCloseTo(centre.x, 6);
      expect(mean.y).toBeCloseTo(centre.y, 6);
    }
  });

  it("leaves a beam's centre where the wire put it — beams are not extrapolated", () => {
    const beam = { weaponId: "afterburner", isExplosion: false, x: 10, y: 20, angle: 0, extent: 100 };
    expect(instanceDrawCentre(beam, 999)).toEqual({ x: 10, y: 20 });
  });

  it("anchors the hp bar sprite on the draining end of the quad hpBarPoints returns", () => {
    const pose = { x: 300, y: 150, angle: 0.9 };
    const bar = { length: 44, thickness: 5, offset: 30 };
    const quad = hpBarPoints(pose, 1, bar);
    const anchor = hpBarAnchor(pose, bar);
    // Corners 0 and 3 are the two `left` corners — the end a bar always drains from.
    expect(anchor.x).toBeCloseTo((quad[0]!.x + quad[3]!.x) / 2, 6);
    expect(anchor.y).toBeCloseTo((quad[0]!.y + quad[3]!.y) / 2, 6);
  });
});
```

Extend the file's existing import from `./combat-visual.js` with `chargeOrbBandsAtRest`, `chargeOrbMaxRadius`, `chargeOrbRadius`, `glowBandsAtRest`, `glowFlickerScale`, `hpBarAnchor`, `instanceDrawCentre`, and its import from `@motor-combat-moba/shared` with `weaponTicksOf`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/scenes/combat-visual.test.ts`
Expected: FAIL — `glowFlickerScale` and the six others are not exported.

- [ ] **Step 3: Factor `combat-visual.ts`**

Four edits. Nothing else in the file moves.

**(a) `:185` and `:203`** — add `export` to `UNKNOWN_WEAPON_COLOR` and `UNKNOWN_WEAPON_RADIUS`, and add one sentence to each comment:

```ts
/** … existing comment … `render/bake.ts` bakes the dot this colour, for the same reason. */
export const UNKNOWN_WEAPON_COLOR = 0x555555;
```

```ts
/** … existing comment … and the radius `baked.world.shot.unknown` is baked at. */
export const UNKNOWN_WEAPON_RADIUS = 3;
```

**(b) replace `:1089-1111`** (`instanceGlowBands`) with the pair below. The doc comment above it at `:1077-1088` stays where it is, on `instanceGlowBands`:

```ts
/**
 * The flicker's current scale on a glowing instance's radius, in `(0, 1]`.
 *
 * Pulled out of `instanceGlowBands` so `render/bake.ts` can bake the bands ONCE at scale 1 and the
 * frame path can apply this as the sprite's `scale` (spec R1: a baked frame is the shape up to
 * position, rotation, scale, alpha and tint). Shrink only, never grow — see `GlowStyle.flickerDepth`
 * — so the drawn shot still cannot exceed the hitbox that hits, whichever side of the split it is
 * computed on.
 */
export function glowFlickerScale(weaponId: string, spawnTick: number, nowMs: number): number {
  const style = isWeaponId(weaponId) ? WEAPON_GLOW_STYLES[weaponId] : undefined;
  if (!style) return 1;
  // [0, 1] rather than [-1, 1], so the scale below only ever subtracts. See `flickerDepth`.
  const wave =
    0.5 +
    0.5 *
      Math.sin(
        2 * Math.PI * style.flickerHz * (nowMs / 1000) + spawnTick * FLICKER_PHASE_PER_TICK,
      );
  return 1 - style.flickerDepth * wave;
}

/**
 * The concentric bands at rest — no flicker — which is what the bake draws into one frame.
 * `[]` for a weapon with no style, exactly as `instanceGlowBands` answers.
 */
export function glowBandsAtRest(weaponId: string, radius: number): DrawBand[] {
  const style = isWeaponId(weaponId) ? WEAPON_GLOW_STYLES[weaponId] : undefined;
  if (!style) return [];
  return style.bands.map((band) => ({
    radius: radius * band.radiusScale,
    fill: hexToFill(band.color),
  }));
}

export function instanceGlowBands(
  weaponId: string,
  radius: number,
  spawnTick: number,
  nowMs: number,
): DrawBand[] {
  // The flicker scales every band uniformly, so scaling the RADIUS once is the same arithmetic the
  // per-band multiply used to do — and the same arithmetic the sprite's `scale` will do.
  return glowBandsAtRest(weaponId, radius * glowFlickerScale(weaponId, spawnTick, nowMs));
}
```

**(c) replace `:1358-1382`** (`chargeOrbBands`) with the four functions below; its doc comment stays on `chargeOrbBands`:

```ts
/** The style a weapon's wind-up telegraph draws with, or `undefined`. */
function chargeStyleOf(weaponId: string): ChargeStyle | undefined {
  const def = isWeaponId(weaponId) ? weaponDefOf(weaponId) : null;
  if (!def || def.kind !== "beam") return undefined;
  return WEAPON_BEAM_STYLES[def.id]?.charge;
}

/** The orb's radius on the last tick before the shot exits, or 0 for a weapon with no telegraph. */
export function chargeOrbMaxRadius(weaponId: string): number {
  return chargeStyleOf(weaponId)?.maxRadius ?? 0;
}

/**
 * The orb's CURRENT radius, or 0 when nothing is winding up.
 *
 * Split out of `chargeOrbBands` for the reason `glowFlickerScale` was: the bands are baked once at
 * `chargeOrbMaxRadius` and this becomes the sprite's scale, so the growing telegraph costs a
 * transform instead of one `fillCircle` per band per frame.
 */
export function chargeOrbRadius(weaponId: string, pendingUntilTick: number, tick: number): number {
  const charge = chargeStyleOf(weaponId);
  if (!charge || !isWeaponId(weaponId)) return 0;
  const total = weaponTicksOf(weaponId).startUp;
  if (total <= 0) return 0;
  const remaining = pendingUntilTick - tick;
  // Nothing pending, already fired, or a pending longer than this weapon's own wind-up.
  if (remaining <= 0 || remaining > total) return 0;
  // 0 on the press tick, approaching 1 on the last tick before the shot exits. Linear on purpose:
  // the orb's job is telling an opponent how long they have, and easing would lie about that.
  const progress = clamp01(1 - remaining / total);
  return charge.minRadius + (charge.maxRadius - charge.minRadius) * progress;
}

/** The orb's bands at their full size — the picture the bake draws once. */
export function chargeOrbBandsAtRest(weaponId: string): ChargeOrbBand[] {
  const charge = chargeStyleOf(weaponId);
  if (!charge) return [];
  return charge.bands.map((band) => ({
    radius: charge.maxRadius * band.radiusScale,
    fill: hexToFill(band.color),
  }));
}

export function chargeOrbBands(
  weaponId: string,
  pendingUntilTick: number,
  tick: number,
): ChargeOrbBand[] {
  const radius = chargeOrbRadius(weaponId, pendingUntilTick, tick);
  if (radius <= 0) return [];
  const max = chargeOrbMaxRadius(weaponId);
  return chargeOrbBandsAtRest(weaponId).map((band) => ({
    radius: (band.radius * radius) / max,
    fill: band.fill,
  }));
}
```

**(d) insert before `:1969`** (`instanceDrawShape`), and make `instanceDrawShape`'s projectile branch call it so the sprite and the debug outline can never land on different points:

```ts
/**
 * Where an instance is DRAWN this frame: a projectile advanced along its own velocity since the
 * snapshot that reported it, a beam left exactly where the wire put it.
 *
 * The sprite path needs this and nothing else — a baked body frame is placed and rotated, never
 * re-tessellated — and `instanceDrawShape` calls it too, so the `?debug=1` hitbox outline is
 * guaranteed to sit on the sprite rather than near it.
 */
export function instanceDrawCentre(
  instance: DrawableInstance,
  elapsedMs: number,
): { x: number; y: number } {
  const def = drawDefOf(instance);
  if (!def || def.kind !== "projectile") return { x: instance.x, y: instance.y };
  return extrapolateShot(instance.x, instance.y, instance.angle, def.speed, elapsedMs);
}
```

and inside `instanceDrawShape`, replace

```ts
  const at = extrapolateShot(instance.x, instance.y, instance.angle, def.speed, elapsedMs);
  return projectileShapeAt(def.hitbox, at.x, at.y, instance.angle);
```

with

```ts
  const at = instanceDrawCentre(instance, elapsedMs);
  return projectileShapeAt(def.hitbox, at.x, at.y, instance.angle);
```

**(e) append after `hpBarPoints` (`:130`)**:

```ts
/**
 * Where an hp bar's sprite is anchored: the midpoint of the quad's DRAINING end.
 *
 * `hpBarPoints` returns the bar as four world-space corners, which is what a `fillPoints` needs and
 * what a sprite cannot use. A sprite instead sits at one point, rotates with the car, and grows
 * along its own local +y — so it needs the one corner-pair the bar always grows FROM, which is the
 * `left` edge (`hpBarPoints` fills `left` to `left + filled`). Derived from the same three numbers
 * rather than repeated, and `combat-visual.test.ts` asserts it against `hpBarPoints`'s own corners.
 */
export function hpBarAnchor(
  pose: { x: number; y: number; angle: number },
  bar: HpBarGeometry,
): { x: number; y: number } {
  const fx = Math.cos(pose.angle);
  const fy = Math.sin(pose.angle);
  // The bar's mid-thickness along the car's facing, and its far end across it.
  const along = -(bar.offset + bar.thickness / 2);
  const across = -bar.length / 2;
  return { x: pose.x + fx * along - fy * across, y: pose.y + fy * along + fx * across };
}
```

Add `weaponTicksOf` to the file's shared import if it is not already there (it is — `chargeOrbBands` used it), and `ChargeStyle` needs no import (declared in this file).

- [ ] **Step 4: Run the whole combat-visual suite**

Run: `cd packages/client && npx vitest run src/scenes/combat-visual.test.ts src/scenes/projectile-marks.test.ts`
Expected: PASS. Every pre-existing assertion still holds — the refactoring is arithmetically identical: `radius × radiusScale × scale` is `radius × scale × radiusScale`, and `maxRadius × radiusScale × (radius / maxRadius)` is `radius × radiusScale`.

- [ ] **Step 5: Write the failing test for `world-style.ts`**

```ts
// packages/client/src/scenes/arena/world-style.test.ts
import { describe, expect, it } from "vitest";
import { CAR_TABLE, COMBAT_CONFIG, hpOf } from "@motor-combat-moba/shared";
import {
  HP_BAR_EASE_PER_SECOND,
  HP_BAR_GEOMETRY,
  HP_BAR_STEPS,
  easeHpFraction,
  hpBarStepIndex,
} from "./world-style.js";

describe("hpBarStepIndex", () => {
  it("quantises the bar to its step count, keeping both ends exact", () => {
    expect(hpBarStepIndex(1)).toBe(HP_BAR_STEPS);
    expect(hpBarStepIndex(0)).toBe(0);
    expect(hpBarStepIndex(-1)).toBe(0);
    expect(hpBarStepIndex(2)).toBe(HP_BAR_STEPS);
    expect(hpBarStepIndex(0.5)).toBe(HP_BAR_STEPS / 2);
  });

  it("never hides a living car's last sliver", () => {
    expect(hpBarStepIndex(0.0001)).toBe(1);
    expect(hpBarStepIndex(1 / HP_BAR_STEPS / 4)).toBe(1);
  });

  it("resolves the smallest hit the game can land on the toughest chassis", () => {
    // One step in hp, on the biggest pool in the roster.
    const toughest = Math.max(...Object.keys(CAR_TABLE).map((id) => hpOf(id as "bastion")));
    const hpPerStep = toughest / HP_BAR_STEPS;
    // `magmablast`'s burst is the smallest damage number in `WEAPON_TABLE` (15), fired by the
    // weakest attacker in the roster (Bastion, attack 42) — `damageFor` scales it to 14.
    const weakest = Math.min(...Object.values(CAR_TABLE).map((c) => c.attack));
    const smallestHit = Math.round(15 * (1 + (weakest - COMBAT_CONFIG.attackBaseline) * COMBAT_CONFIG.damagePerAttack));
    expect(smallestHit).toBe(14);
    expect(hpPerStep).toBeLessThan(smallestHit);
    // …which is the property that matters: the bar moves for every hit that lands.
    expect(hpBarStepIndex(1) - hpBarStepIndex(1 - smallestHit / toughest)).toBeGreaterThanOrEqual(1);
  });
});

describe("easeHpFraction", () => {
  it("closes the gap at a constant rate in both directions and always arrives", () => {
    // A full bar drains in 1000 / HP_BAR_EASE_PER_SECOND ms.
    const stepMs = 100;
    const per = (HP_BAR_EASE_PER_SECOND * stepMs) / 1000;
    expect(easeHpFraction(1, 0, stepMs)).toBeCloseTo(1 - per, 10);
    expect(easeHpFraction(0, 1, stepMs)).toBeCloseTo(per, 10);
    // Never overshoots.
    expect(easeHpFraction(0.01, 0, 10_000)).toBe(0);
    expect(easeHpFraction(0.99, 1, 10_000)).toBe(1);
    expect(easeHpFraction(0.5, 0.5, 16)).toBe(0.5);
  });
});

describe("HP_BAR_GEOMETRY", () => {
  it("still clears the hull it is laid across", () => {
    expect(HP_BAR_GEOMETRY.offset).toBeGreaterThan(0);
    expect(HP_BAR_GEOMETRY.length).toBe(44);
    expect(HP_BAR_GEOMETRY.thickness).toBe(5);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/scenes/arena/world-style.test.ts`
Expected: FAIL — cannot resolve `./world-style.js`.

- [ ] **Step 7: Write `scenes/arena/world-style.ts`**

This is a move plus two new knobs. Every constant below comes out of `scenes/arena/car-renderer.ts`, where the preparation plan's Task 5 put it (originally `ArenaScene.ts:149-341`). Copy each with its comment **verbatim**, with these substitutions:

| In `car-renderer.ts` | In `world-style.ts` |
|---|---|
| `const HITBOX_STROKE`, `HITBOX_PX`, `HITBOX_NAME` | `export const`, unchanged |
| `const HP_BAR_GEOMETRY`, `HP_BAR_BACK` | `export const`, unchanged |
| `const LOCK_COLOR`, `LOCK_WIDTH` | `export const`, unchanged |
| `const ARROW_COLOR = hpBarColor("ally")`, `ARROW_ALPHA` | `export const`, unchanged — the `hpBarColor` import comes with it |
| `const DASH_GHOST_WIDTH`, `PHASED_ALPHA` | `export const`, unchanged |
| `const HP_BAR_DEPTH`, `LOCK_DEPTH`, `ARROW_DEPTH`, `CAR_DEPTH`, `MANEUVER_DEPTH` and the "world layer stack" block comment above them | **deleted** — `render/layers.ts` owns them now, and its `CAR_BAND` comment carries the reasoning each one held |
| `const SHOT_DEPTH` and its D7 comment, in `shot-renderer.ts` | **deleted** — the D7 paragraph moves onto `LAYER_DEPTH` in `render/layers.ts` |

Add at the top of the file:

```ts
// packages/client/src/scenes/arena/world-style.ts
/**
 * Every colour, alpha, width and proportion the world is painted with, as plain numbers, plus the
 * two pure derivations the hp bar needs.
 *
 * Phaser-free on purpose, and for the same reason `scenes/hud/hud-style.ts` is: `render/bake.ts`
 * reads these when it draws the frames at boot and the renderers read them when they place the
 * sprites, so one definition serves both and the baked picture cannot disagree with the live
 * layout. Depths are NOT here — `render/layers.ts` owns the stack.
 */
```

Then append the new knobs:

```ts
/**
 * Transparent margin left around every world bake job, in supersampled pixels.
 *
 * A baked polygon lands exactly on its tile's edge, and a texture sampled at its edge picks up the
 * neighbouring frame under linear filtering. One logical pixel of air each side is the cheapest
 * possible fix and costs 2 px of sheet per job; without it a `pepperbox` dart shows a hairline of
 * whatever was shelved next to it.
 */
export const BAKE_WORLD_PAD_PX = 2;

/**
 * How many discrete lengths an hp bar has.
 *
 * The bar is a baked white quad scaled along its length, so the length COULD be continuous — this
 * quantises it anyway, because a guarded setter that only writes when the step changes is what
 * keeps the eased bar off the frame path (spec R3, R6): a bar easing for 400 ms writes at most
 * `HP_BAR_STEPS` times instead of once per frame per car.
 *
 * 128 is chosen against the two things that can go wrong, exactly as V1 chose the sweep sheet's 90:
 *
 * - **It must not read as steppy.** The bar is `HP_BAR_GEOMETRY.length` = 44 world units and the
 *   camera's zoom is 1, so it is 44 logical px; the game FITs 1424 x 720 into the window, so on a
 *   1080p screen it is 44 x (1920 / 1424) = 59.3 device px. One step moves the end 0.46 device px —
 *   under a pixel, so the ease slides rather than clicks.
 * - **It must not swallow a hit.** The biggest hp pool in the roster is Bastion's 900, so a step is
 *   7.03 hp there. The smallest damage the game can deal is `magmablast`'s 15-point burst fired by
 *   the weakest attacker (Bastion, `attack` 42), which `damageFor` scales to 14 — two steps. Every
 *   hit that lands moves the bar.
 */
export const HP_BAR_STEPS = 128;

/**
 * How fast the drawn bar catches its reported value, in bar-fractions per second.
 *
 * Linear rather than exponential: an exponential ease never arrives, so the guarded setter would
 * keep firing forever on a bar that has already visually settled. At 2.5 a full bar empties in
 * 400 ms and a quarter-bar hit takes 100 ms — long enough to see that damage happened, short enough
 * that the bar is honest about the car's hp before the next shot lands.
 */
export const HP_BAR_EASE_PER_SECOND = 2.5;

/**
 * Which of `HP_BAR_STEPS` lengths shows `fraction` of a car's hp.
 *
 * `ceil`, not `round`, above zero: a car with one hit point left must still show a sliver, because
 * an empty bar on a living car reads as a bug. Exactly 0 is the only value that shows nothing, and
 * the caller hides the fill sprite for it rather than drawing a zero-width quad.
 */
export function hpBarStepIndex(fraction: number): number {
  if (fraction <= 0) return 0;
  if (fraction >= 1) return HP_BAR_STEPS;
  return Math.max(1, Math.min(HP_BAR_STEPS, Math.ceil(fraction * HP_BAR_STEPS)));
}

/** One frame of the bar's ease: `drawn` moved toward `target` at a constant rate, never past it. */
export function easeHpFraction(drawn: number, target: number, deltaMs: number): number {
  const step = (HP_BAR_EASE_PER_SECOND * deltaMs) / 1000;
  if (drawn < target) return Math.min(target, drawn + step);
  return Math.max(target, drawn - step);
}
```

- [ ] **Step 8: Run the test and the typecheck**

Run: `cd packages/client && npx vitest run src/scenes/arena/world-style.test.ts && npm run typecheck`
Expected: PASS (7 tests). `hpOf("bastion")` is `90 × COMBAT_CONFIG.hpPerRating` = 900, so `900 / 128 = 7.03`; `damageFor(42, 15)` is `round(15 × (1 + (42 − 50) × 0.01))` = `round(13.8)` = 14. Typecheck fails in `car-renderer.ts` and `shot-renderer.ts` until Tasks 5 and 6 re-import from the new module — **that is expected here**; the two renderers keep their own copies of the constants until then, so leave the originals in place and delete them in the tasks that stop using them. If you prefer a clean typecheck at this commit, re-point the two renderers' imports now and delete the duplicated constants; the deletion tables in Tasks 5 and 6 assume the constants are gone by then either way.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/scenes/combat-visual.ts packages/client/src/scenes/combat-visual.test.ts \
  packages/client/src/scenes/arena/world-style.ts packages/client/src/scenes/arena/world-style.test.ts \
  packages/client/src/scenes/arena/car-renderer.ts packages/client/src/scenes/arena/shot-renderer.ts
git commit -m "refactor(client): split the world builders into an at-rest half and a transform

Moves no playtest probe number: pure refactoring of client draw helpers. Every returned value is
arithmetically identical and combat-visual.test.ts asserts the identities."
```

---

### Task 3: The world bake jobs — the same builders, run once

**Files:**
- Modify: `packages/client/src/render/bake.ts`
- Modify: `packages/client/src/render/bake.test.ts`
- Modify: `packages/client/src/scenes/arena/world-style.ts` (`BAKE_WORLD_PAD_PX`)

**Interfaces:**
- Consumes: V1's `BakeGraphics`, `BakeJob`, `bakeJobs`, `packShelf`, `bakeAtlas`, `BAKE_SUPERSAMPLE`, `BAKE_SHEET_PX`, `bakedFrame`, `bakedAtlasReady`; Task 2's at-rest builders and `world-style.ts`.
- Produces: `hudBakeJobs`, `worldBakeJobs`, `bakedShotWeaponIds`, `bakedOrbWeaponIds`, `BAKED_SHOT_UNKNOWN`, `bakedShotFrame`, `bakedOrbFrame`, `bakedCarFrame`, `BAKED_CAR_HITBOX`, `BAKED_CAR_OUTLINE_CHARGE`, `BAKED_CAR_OUTLINE_GHOST`, `BAKED_HP_BAR`, `BAKED_LOCK`, `BAKED_ARROW`, `worldFrameScale` (`render/bake.ts`). `BakeJob` gains an optional `pad`; `BakeGraphics` gains `fillEllipse`, `moveTo`, `lineTo`. Tasks 5 and 6 consume all of it.

**R13, literally.** Every job below draws with the function the client runs per frame today — `projectileDrawLayers`, `glowBandsAtRest` (Task 2's at-rest half of `instanceGlowBands`), `chargeOrbBandsAtRest`, `projectileShapeAt`, `hexagonPoints`, `hullOutlinePoints`, `lockBracketArms`, `countdownArrowPoints` — with the shape's origin at the tile's centre and every length multiplied by the supersample. Nothing about any picture changes; only how often it is computed. The one rule the jobs follow that the frame path did not need: **a shape drawn in one colour is baked white and tinted at draw time; a shape drawn in several is baked in its own colours.** That is what lets one hp-bar frame serve the backing plate and both allegiances, one hull-outline frame serve six player colours, and one silhouette frame serve every colour in `COLOR_TABLE`, while `predator`'s four-colour missile and `magmablast`'s three-band ramp stay one frame each.

**Why the frame is smaller than the tile.** Each world job draws into a tile with `BAKE_WORLD_PAD_PX` of transparent margin and registers its atlas frame as the **content** rectangle inside it. The margin is what stops a neighbouring frame bleeding in under linear filtering, and keeping it out of the frame rect is what keeps every origin trivial: a centred sprite is `(0.5, 0.5)`, the hp bar's draining end is `(0.5, 0)`, and the arrow's apex is `(0.5, 1)`, with no pad arithmetic anywhere in the renderers.

- [ ] **Step 1: Take the runtime Phaser import out of `bake.ts`**

V1's `bake.ts` opens with `import Phaser from "phaser"` because `flameScratch` constructs `Phaser.Math.Vector2`. That is the one runtime Phaser reference in the module, and it drags Phaser into `bake.test.ts` transitively — against the constraint that no test imports Phaser. V2 adds nine more point-array jobs, so fix it now rather than multiply it.

| Line | Was | Becomes |
|---|---|---|
| the import | `import Phaser from "phaser";` | `import type Phaser from "phaser";` |
| `flameScratch` | `const flameScratch: Phaser.Math.Vector2[] = FLAME_UNIT_POINTS.map(() => new Phaser.Math.Vector2());` | `const flameScratch: PointLike[] = FLAME_UNIT_POINTS.map(() => ({ x: 0, y: 0 }));` |
| inside `flamePoints` | `flameScratch[i]!.set(cx + unit.x * r, cy + unit.y * r);` | `flameScratch[i]!.x = cx + unit.x * r;` / `flameScratch[i]!.y = cy + unit.y * r;` |
| `flamePoints`'s return type | `Phaser.Math.Vector2[]` | `PointLike[]` |
| the two `gfx.fillPoints(flame, true)` / `gfx.fillPoints(core, true)` calls in the glyph job | wrap the argument: `gfx.fillPoints(pts(flame), true)`, `gfx.fillPoints(pts(core), true)` |
| the `strokePoints(flame, true)` call | `gfx.strokePoints(pts(flame), true)` |

Add `import { pts, type PointLike } from "../scenes/graphics-points.js";`. `pts` is a cast and nothing more (`graphics-points.ts:22-24`), so this allocates nothing and changes no behaviour; `BakeGraphics.fillPoints` keeps its `Phaser.Math.Vector2[]` parameter type, which is now a pure type reference.

- [ ] **Step 2: Widen `BakeGraphics` and `BakeJob`**

In `render/bake.ts`, add three methods to `BakeGraphics` (alphabetical position in the interface does not matter; keep them beside their kin):

```ts
  fillEllipse(x: number, y: number, width: number, height: number): unknown;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
```

and one optional field to `BakeJob`:

```ts
export interface BakeJob {
  /** The frame name, `baked.<name>` per the ledger. */
  readonly name: string;
  /** The TILE the packer reserves and `draw` fills — content plus `pad` on every side. */
  readonly width: number;
  readonly height: number;
  /**
   * Transparent margin baked around the content, in supersampled pixels. The registered atlas frame
   * is the tile inset by this, so a neighbour cannot bleed in and no origin has to know about it.
   * HUD jobs leave it 0: they are packed edge to edge and drawn at their own size.
   */
  readonly pad?: number;
  /** Draws the job into the top-left of a cleared scratch `Graphics`. */
  draw(gfx: BakeGraphics): void;
}
```

In `bakeAtlas`, change the frame registration line so the pad is excluded:

```ts
    const pad = job.pad ?? 0;
    texture.add(job.name, 0, at.x + pad, at.y + pad, at.width - pad * 2, at.height - pad * 2);
```

Add, beside `bakedFrame`:

```ts
/**
 * How much to scale a baked WORLD frame so it draws at one texture pixel per world unit.
 *
 * World jobs are baked at the supersample, so a tier that bakes at 2 and renders at a device pixel
 * ratio of 2 draws them 1:1 (spec R17). Everything in the world scales by this and nothing else,
 * except the hp bar's length and the two things that carry a live scale of their own (the glow
 * flicker and the charge orb's wind-up).
 */
export function worldFrameScale(ss: number): number {
  return 1 / ss;
}
```

- [ ] **Step 3: Raise the pad in `world-style.ts`**

The value written in Task 2 was a placeholder for the widest stroke; make it the real one:

```ts
export const BAKE_WORLD_PAD_PX = 4;
```

and extend its comment with the arithmetic: the widest baked stroke is `wildcharge`'s charge outline at `CHARGE_OUTLINE_WIDTH` = 3 world units, which at supersample 2 puts 3 supersampled pixels of ink past the hull it is stroked around — so 4 is that plus a pixel of air.

- [ ] **Step 4: Write the failing test for the world jobs**

Append to `packages/client/src/render/bake.test.ts`, and extend its imports with `bakedOrbWeaponIds`, `bakedShotWeaponIds`, `hudBakeJobs`, `worldBakeJobs`, `worldFrameScale` from `./bake.js`; `BAKE_WORLD_PAD_PX`, `HP_BAR_GEOMETRY` from `../scenes/arena/world-style.js`; `weaponDefOf`, `DRIVE_CONFIG` from `@motor-combat-moba/shared`; and `UNKNOWN_WEAPON_COLOR`, `chargeOrbMaxRadius`, `weaponFillOf` from `../scenes/combat-visual.js`.

Replace the existing `it("bakes one frame per HUD shape plus the whole sweep sheet")` length assertion with the first test below; every other V1 assertion stays exactly as it is.

```ts
describe("the world jobs", () => {
  const world = worldBakeJobs(2);
  const byName = new Map(world.map((job) => [job.name, job]));
  const pad = BAKE_WORLD_PAD_PX;

  it("appends after the HUD jobs, so every V1 frame keeps its place in the list", () => {
    const all = bakeJobs(2, PILL);
    expect(hudBakeJobs(2, PILL)).toHaveLength(7 + SWEEP_FRAMES);
    expect(all).toHaveLength(hudBakeJobs(2, PILL).length + world.length);
    expect(all.slice(0, 7).map((job) => job.name)).toEqual([
      "baked.hud.px",
      "baked.hud.wash",
      "baked.hud.ring",
      "baked.hud.glyph.projectile",
      "baked.hud.glyph.beam",
      "baked.hud.pill.key",
      "baked.hud.pill.hint",
    ]);
    expect(all[7 + SWEEP_FRAMES]!.name).toBe("baked.world.shot.predator");
  });

  it("carries a frame for every projectile in the roster, every orb, and nothing else", () => {
    expect(bakedShotWeaponIds()).toEqual([
      "predator",
      "magmablast",
      "pepperbox",
      "thumper",
      "roadblock",
    ]);
    expect(bakedOrbWeaponIds()).toEqual(["lance"]);
    expect(world.map((job) => job.name)).toEqual([
      "baked.world.shot.predator",
      "baked.world.shot.magmablast",
      "baked.world.shot.pepperbox",
      "baked.world.shot.thumper",
      "baked.world.shot.roadblock",
      "baked.world.shot.unknown",
      "baked.world.orb.lance",
      "baked.world.car.rect",
      "baked.world.car.ellipse",
      "baked.world.car.hex",
      "baked.world.car.hitbox",
      "baked.world.car.outline.charge",
      "baked.world.car.outline.ghost",
      "baked.world.hpbar",
      "baked.world.lock",
      "baked.world.arrow",
    ]);
  });

  it("sizes every shot tile to its own hitbox plus the pad, so the sprite IS the hitbox", () => {
    const predator = weaponDefOf("predator");
    if (predator.kind !== "projectile" || predator.hitbox.shape !== "capsule") throw new Error("roster moved");
    const job = byName.get("baked.world.shot.predator")!;
    expect(job.width).toBe(predator.hitbox.radiusAlong * 2 * 2 + pad * 2);
    expect(job.height).toBe(predator.hitbox.radiusAcross * 2 * 2 + pad * 2);
    expect(job.pad).toBe(pad);

    const magma = byName.get("baked.world.shot.magmablast")!;
    expect(magma.width).toBe(12 * 2 * 2 + pad * 2);
    expect(magma.width).toBe(magma.height);
  });

  it("bakes a styleless projectile as the flat fill of its own hitbox polygon", () => {
    const gfx = recorder();
    // `pepperbox` is the roster's one non-circular projectile with no authored style.
    byName.get("baked.world.shot.pepperbox")!.draw(gfx);
    expect(gfx.calls[0]).toBe(`fillStyle(${weaponFillOf("pepperbox")},1.000)`);
    expect(gfx.calls).toHaveLength(2);
    expect(gfx.calls[1]!.startsWith("fillPoints(")).toBe(true);
  });

  it("bakes the round projectile as its glow bands, outermost first", () => {
    const gfx = recorder();
    byName.get("baked.world.shot.magmablast")!.draw(gfx);
    const c = (12 * 2 * 2 + pad * 2) / 2;
    expect(gfx.calls).toEqual([
      "fillStyle(12591104,1.000)",
      `fillCircle(${c.toFixed(3)},${c.toFixed(3)},${(12 * 2).toFixed(3)})`,
      "fillStyle(16736256,1.000)",
      `fillCircle(${c.toFixed(3)},${c.toFixed(3)},${(12 * 2 * 0.74).toFixed(3)})`,
      "fillStyle(16755200,1.000)",
      `fillCircle(${c.toFixed(3)},${c.toFixed(3)},${(12 * 2 * 0.42).toFixed(3)})`,
    ]);
  });

  it("bakes the unknown-weapon dot at the radius and colour the fallback uses", () => {
    const gfx = recorder();
    const job = byName.get("baked.world.shot.unknown")!;
    expect(job.width).toBe(3 * 2 * 2 + pad * 2);
    job.draw(gfx);
    expect(gfx.calls).toEqual([
      `fillStyle(${UNKNOWN_WEAPON_COLOR},1.000)`,
      `fillCircle(${(job.width / 2).toFixed(3)},${(job.height / 2).toFixed(3)},${(3 * 2).toFixed(3)})`,
    ]);
  });

  it("bakes the charge orb at its maximum, so the wind-up is a scale", () => {
    const job = byName.get("baked.world.orb.lance")!;
    expect(job.width).toBe(Math.ceil(chargeOrbMaxRadius("lance") * 2 * 2) + pad * 2);
    const gfx = recorder();
    job.draw(gfx);
    // Three bands, three fills.
    expect(gfx.calls.filter((c) => c.startsWith("fillCircle"))).toHaveLength(3);
  });

  it("bakes each silhouette white on the hull's own footprint, so a tint paints it", () => {
    const { carWidth: w, carHeight: h } = DRIVE_CONFIG;
    for (const name of ["baked.world.car.rect", "baked.world.car.ellipse", "baked.world.car.hex"]) {
      const job = byName.get(name)!;
      expect([job.width, job.height]).toEqual([w * 2 + pad * 2, h * 2 + pad * 2]);
    }
    const gfx = recorder();
    byName.get("baked.world.car.rect")!.draw(gfx);
    expect(gfx.calls).toEqual([
      "fillStyle(16777215,1.000)",
      `fillRect(${pad.toFixed(3)},${pad.toFixed(3)},${(w * 2).toFixed(3)},${(h * 2).toFixed(3)})`,
    ]);
  });

  it("bakes the hp bar as one white quad the length of the bar, thickness across", () => {
    const job = byName.get("baked.world.hpbar")!;
    // The sprite rotates with the car, so its local +x is the car's forward: thickness on x.
    expect(job.width).toBe(HP_BAR_GEOMETRY.thickness * 2 + pad * 2);
    expect(job.height).toBe(HP_BAR_GEOMETRY.length * 2 + pad * 2);
  });

  it("bakes the whole lock bracket as one frame, from lockBracketArms itself", () => {
    const job = byName.get("baked.world.lock")!;
    expect(job.width).toBe(LOCK_BRACKET_HALF * 2 * 2 + pad * 2);
    expect(job.width).toBe(job.height);
    const gfx = recorder();
    job.draw(gfx);
    // One lineStyle, then beginPath/moveTo/lineTo/strokePath per arm — the eight arms
    // `renderCars` strokes today, in the same order.
    expect(gfx.calls[0]!.startsWith("lineStyle(")).toBe(true);
    expect(gfx.calls.filter((c) => c.startsWith("strokePath("))).toHaveLength(8);
  });

  it("hangs the arrow's apex on the frame's bottom edge, where the sprite's origin will be", () => {
    const job = byName.get("baked.world.arrow")!;
    expect(job.width).toBe(ARROW_WIDTH_PX * 2 + pad * 2);
    expect(job.height).toBe(ARROW_HEIGHT_PX * 2 + pad * 2);
  });

  it("scales a world frame back to one world unit per pixel", () => {
    expect(worldFrameScale(2)).toBe(0.5);
    expect(worldFrameScale(1)).toBe(1);
  });
});

describe("packShelf with the world jobs", () => {
  it("packs the whole atlas into every tier's sheet", () => {
    expect(packShelf(bakeJobs(2, PILL), 2048).usedHeight).toBeLessThanOrEqual(2048);
    expect(packShelf(bakeJobs(1, PILL), 1024).usedHeight).toBeLessThanOrEqual(1024);
  });
});
```

Extend the test file's imports with `ARROW_HEIGHT_PX`, `ARROW_WIDTH_PX` from `../scenes/countdown-arrow.js` and `LOCK_BRACKET_HALF` from `../scenes/combat-visual.js`.

- [ ] **Step 5: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/render/bake.test.ts`
Expected: FAIL — `worldBakeJobs` is not exported.

- [ ] **Step 6: Write the world jobs**

In `render/bake.ts`, rename V1's `bakeJobs` to `hudBakeJobs` (body unchanged, `export` kept), then append everything below. `bakeJobs` becomes the concatenation, so `bakeAtlas` and V1's tests need no other edit.

```ts
/**
 * The world's baked frames (spec R12's catalogue, R13's rule that the bake runs the builders the
 * client already has).
 *
 * Every job below is one of the fills `shot-renderer.ts` and `car-renderer.ts` ran per frame,
 * drawn once with its origin at the tile's centre and every length multiplied by `ss`. Two
 * conventions run through all of them:
 *
 * - **One colour means white plus a tint.** The hp bar (backing plate, ally, enemy), the hull
 *   outlines (six player colours and `wildcharge`'s gold), the silhouettes, the hitbox box, the
 *   bracket and the arrow are all baked white; a `setTint` multiplies the frame to its colour at
 *   draw time, which is free on the GPU and turns N frames into one. Several colours means the
 *   frame carries them: `predator`'s missile and `magmablast`'s three-band ramp.
 * - **The content is inset by `BAKE_WORLD_PAD_PX`** and the atlas frame is registered on the
 *   content, not the tile, so no origin has to know the pad exists.
 */

/** Every weapon that spawns a drawable projectile — the bodies the atlas carries a frame for. */
export function bakedShotWeaponIds(): WeaponId[] {
  return (Object.keys(WEAPON_TABLE) as WeaponId[]).filter(
    (id) => weaponDefOf(id).kind === "projectile",
  );
}

/** Every weapon whose wind-up draws a charge orb. */
export function bakedOrbWeaponIds(): WeaponId[] {
  return (Object.keys(WEAPON_TABLE) as WeaponId[]).filter((id) => chargeOrbMaxRadius(id) > 0);
}

/** The frame a shot with an unrecognised weapon id draws: the grey dot `instanceDrawShape` falls to. */
export const BAKED_SHOT_UNKNOWN = "baked.world.shot.unknown";
export const BAKED_CAR_HITBOX = "baked.world.car.hitbox";
export const BAKED_CAR_OUTLINE_CHARGE = "baked.world.car.outline.charge";
export const BAKED_CAR_OUTLINE_GHOST = "baked.world.car.outline.ghost";
export const BAKED_HP_BAR = "baked.world.hpbar";
export const BAKED_LOCK = "baked.world.lock";
export const BAKED_ARROW = "baked.world.arrow";

/** The body frame for a weapon id; `BAKED_SHOT_UNKNOWN` for anything not in the roster. */
export function bakedShotFrame(weaponId: string): string {
  return isWeaponId(weaponId) && weaponDefOf(weaponId).kind === "projectile"
    ? `baked.world.shot.${weaponId}`
    : BAKED_SHOT_UNKNOWN;
}

/** The charge-orb frame for a weapon id, or `undefined` for a weapon with no telegraph. */
export function bakedOrbFrame(weaponId: string): string | undefined {
  return chargeOrbMaxRadius(weaponId) > 0 ? `baked.world.orb.${weaponId}` : undefined;
}

/** The silhouette frame for a chassis. */
export function bakedCarFrame(carId: string): string {
  return `baked.world.car.${carShapeOf(carId)}`;
}

/** Content points placed into a tile: scaled by `ss` and offset to the tile's centre. */
function placed(
  points: readonly PointLike[],
  ss: number,
  cx: number,
  cy: number,
): PointLike[] {
  const out: PointLike[] = [];
  for (const p of points) out.push({ x: cx + p.x * ss, y: cy + p.y * ss });
  return out;
}

/** A tile that holds `w x h` of content at supersample `ss`, plus the pad on every side. */
function tile(w: number, h: number, ss: number): { width: number; height: number; cx: number; cy: number } {
  const width = Math.ceil(w * ss) + BAKE_WORLD_PAD_PX * 2;
  const height = Math.ceil(h * ss) + BAKE_WORLD_PAD_PX * 2;
  return { width, height, cx: width / 2, cy: height / 2 };
}

/** One projectile body, drawn through the same layer table the frame path used to run per shot. */
function shotJob(weaponId: WeaponId, ss: number): BakeJob {
  const def = weaponDefOf(weaponId);
  if (def.kind !== "projectile") throw new Error(`shotJob: ${weaponId} is not a projectile`);
  const hitbox = def.hitbox;
  const halfAlong = hitbox.shape === "circle" ? hitbox.radius : hitbox.radiusAlong;
  const halfAcross = hitbox.shape === "circle" ? hitbox.radius : hitbox.radiusAcross;
  const { width, height, cx, cy } = tile(halfAlong * 2, halfAcross * 2, ss);
  // The instance the builders are asked about: at the origin, nose along +x, no flight time. That
  // is exactly what a sprite's transform will re-apply, and nothing else about it is baked in.
  const atOrigin = { weaponId, isExplosion: false, x: 0, y: 0, angle: 0, extent: 0 };
  return {
    name: `baked.world.shot.${weaponId}`,
    width,
    height,
    pad: BAKE_WORLD_PAD_PX,
    draw: (gfx) => {
      if (hitbox.shape === "circle") {
        // A round projectile's look is `WEAPON_GLOW_STYLES`, at rest — the flicker rides on the
        // sprite's scale (Task 2's `glowFlickerScale`), never on the baked radius.
        const bands = glowBandsAtRest(weaponId, hitbox.radius * ss);
        if (bands.length === 0) {
          gfx.fillStyle(weaponFillOf(weaponId), 1);
          gfx.fillCircle(cx, cy, hitbox.radius * ss);
          return;
        }
        for (const band of bands) {
          gfx.fillStyle(band.fill, 1);
          gfx.fillCircle(cx, cy, band.radius);
        }
        return;
      }
      const layers = projectileDrawLayers(atOrigin, 0);
      if (layers.length === 0) {
        // No authored style: the flat fill of the raw hitbox polygon, which is what every
        // unstyled projectile has always drawn.
        const shape = projectileShapeAt(hitbox, 0, 0, 0);
        if (shape.kind !== "polygon" || shape.points.length === 0) return;
        gfx.fillStyle(weaponFillOf(weaponId), 1);
        gfx.fillPoints(pts(placed(shape.points, ss, cx, cy)), true);
        return;
      }
      for (const layer of layers) {
        gfx.fillStyle(layer.fill, 1);
        gfx.fillPoints(pts(placed(layer.points, ss, cx, cy)), true);
      }
    },
  };
}

/** Every world frame, at supersample `ss`. Appended to the HUD's by `bakeJobs`. */
export function worldBakeJobs(ss: number): BakeJob[] {
  const { carWidth: w, carHeight: h } = DRIVE_CONFIG;
  const jobs: BakeJob[] = [];

  for (const weaponId of bakedShotWeaponIds()) jobs.push(shotJob(weaponId, ss));

  {
    const { width, height, cx, cy } = tile(UNKNOWN_WEAPON_RADIUS * 2, UNKNOWN_WEAPON_RADIUS * 2, ss);
    jobs.push({
      name: BAKED_SHOT_UNKNOWN,
      width,
      height,
      pad: BAKE_WORLD_PAD_PX,
      draw: (gfx) => {
        gfx.fillStyle(UNKNOWN_WEAPON_COLOR, 1);
        gfx.fillCircle(cx, cy, UNKNOWN_WEAPON_RADIUS * ss);
      },
    });
  }

  for (const weaponId of bakedOrbWeaponIds()) {
    const max = chargeOrbMaxRadius(weaponId);
    const { width, height, cx, cy } = tile(max * 2, max * 2, ss);
    jobs.push({
      name: `baked.world.orb.${weaponId}`,
      width,
      height,
      pad: BAKE_WORLD_PAD_PX,
      draw: (gfx) => {
        // Baked at the orb's FULL size; the wind-up is the sprite's scale (Task 2).
        for (const band of chargeOrbBandsAtRest(weaponId)) {
          gfx.fillStyle(band.fill, 1);
          gfx.fillCircle(cx, cy, band.radius * ss);
        }
      },
    });
  }

  // The three procedural silhouettes, white so `carFillOf` paints them with a tint. Permanent
  // fallbacks, not legacy: they are what lets art be added one file at a time.
  for (const shape of ["rect", "ellipse", "hex"] as const) {
    const { width, height, cx, cy } = tile(w, h, ss);
    jobs.push({
      name: `baked.world.car.${shape}`,
      width,
      height,
      pad: BAKE_WORLD_PAD_PX,
      draw: (gfx) => {
        gfx.fillStyle(0xffffff, 1);
        if (shape === "rect") gfx.fillRect(cx - (w * ss) / 2, cy - (h * ss) / 2, w * ss, h * ss);
        else if (shape === "ellipse") gfx.fillEllipse(cx, cy, w * ss, h * ss);
        else gfx.fillPoints(pts(placed(hexagonPoints(w, h), ss, cx, cy)), true);
      },
    });
  }

  {
    // The OBB the sim collides with, hidden in ordinary play and toggled by `hitboxesVisible`.
    // Baked rather than built per car: it is the same rectangle for every chassis, and a sprite
    // costs nothing to keep hidden.
    const { width, height, cx, cy } = tile(w, h, ss);
    jobs.push({
      name: BAKED_CAR_HITBOX,
      width,
      height,
      pad: BAKE_WORLD_PAD_PX,
      draw: (gfx) => {
        gfx.lineStyle(HITBOX_PX * ss, 0xffffff, 1);
        gfx.strokeRect(cx - (w * ss) / 2, cy - (h * ss) / 2, w * ss, h * ss);
      },
    });
  }

  // Two hull outlines at the two widths the game strokes: the wild-charge outline and the thinner
  // dash ghost. Both white — the charge takes `wildcharge`'s colour and a ghost takes the car's own
  // paint, and one frame serves both.
  const chargeWidth = maneuverOutline(ManeuverKind.CHARGE)?.width ?? DASH_GHOST_WIDTH;
  for (const [name, strokeWidth] of [
    [BAKED_CAR_OUTLINE_CHARGE, chargeWidth],
    [BAKED_CAR_OUTLINE_GHOST, DASH_GHOST_WIDTH],
  ] as const) {
    const { width, height, cx, cy } = tile(w, h, ss);
    jobs.push({
      name,
      width,
      height,
      pad: BAKE_WORLD_PAD_PX,
      draw: (gfx) => {
        gfx.lineStyle(strokeWidth * ss, 0xffffff, 1);
        gfx.strokePoints(pts(placed(hullOutlinePoints({ x: 0, y: 0, angle: 0 }, w, h), ss, cx, cy)), true);
      },
    });
  }

  {
    // One white quad, thickness along the car's facing (local +x) and length across it (local +y),
    // because a bar sprite rotates with the car exactly as `hpBarPoints`'s quad does. The backing
    // plate and the fill are the same frame at different tints and lengths.
    const { width, height, cx, cy } = tile(HP_BAR_GEOMETRY.thickness, HP_BAR_GEOMETRY.length, ss);
    jobs.push({
      name: BAKED_HP_BAR,
      width,
      height,
      pad: BAKE_WORLD_PAD_PX,
      draw: (gfx) => {
        gfx.fillStyle(0xffffff, 1);
        gfx.fillRect(
          cx - (HP_BAR_GEOMETRY.thickness * ss) / 2,
          cy - (HP_BAR_GEOMETRY.length * ss) / 2,
          HP_BAR_GEOMETRY.thickness * ss,
          HP_BAR_GEOMETRY.length * ss,
        );
      },
    });
  }

  {
    // The whole eight-armed bracket in ONE frame rather than the spec's four arm sprites. The
    // bracket is unrotated, fixed-size and there is at most one on screen (only the camera
    // subject's lock is drawn), so one quad beats four — and this way the frame is drawn by
    // `lockBracketArms` itself, vertex for vertex, instead of by a re-derivation of its corners.
    const { width, height, cx, cy } = tile(LOCK_BRACKET_HALF * 2, LOCK_BRACKET_HALF * 2, ss);
    jobs.push({
      name: BAKED_LOCK,
      width,
      height,
      pad: BAKE_WORLD_PAD_PX,
      draw: (gfx) => {
        gfx.lineStyle(LOCK_WIDTH * ss, 0xffffff, 1);
        for (const arm of lockBracketArms(0, 0)) {
          gfx.beginPath();
          gfx.moveTo(cx + arm.x1 * ss, cy + arm.y1 * ss);
          gfx.lineTo(cx + arm.x2 * ss, cy + arm.y2 * ss);
          gfx.strokePath();
        }
      },
    });
  }

  {
    // The countdown arrow, baked with its APEX on the frame's bottom edge: the sprite takes origin
    // (0.5, 1), so its position is `countdownArrowPoints`'s own apex, `y - ARROW_GAP_PX + bob`.
    const { width, height, cx } = tile(ARROW_WIDTH_PX, ARROW_HEIGHT_PX, ss);
    const apexY = BAKE_WORLD_PAD_PX + ARROW_HEIGHT_PX * ss;
    jobs.push({
      name: BAKED_ARROW,
      width,
      height,
      pad: BAKE_WORLD_PAD_PX,
      draw: (gfx) => {
        gfx.fillStyle(0xffffff, 1);
        // `ARROW_GAP_PX` as the y cancels the gap the builder subtracts, so the apex lands on 0
        // and the base on `-ARROW_HEIGHT_PX` — the triangle in its own box, nothing else.
        gfx.fillPoints(pts(placed(countdownArrowPoints(0, ARROW_GAP_PX, 0), ss, cx, apexY)), true);
      },
    });
  }

  return jobs;
}

/** Every frame the atlas carries: the HUD's, then the world's. */
export function bakeJobs(ss: number, pill: PillHeights): BakeJob[] {
  return [...hudBakeJobs(ss, pill), ...worldBakeJobs(ss)];
}
```

Add the imports these need:

```ts
import {
  DRIVE_CONFIG,
  ManeuverKind,
  WEAPON_TABLE,
  isWeaponId,
  projectileShapeAt,
  weaponDefOf,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { carShapeOf, hexagonPoints } from "../scenes/car-visual.js";
import {
  ARROW_GAP_PX,
  ARROW_HEIGHT_PX,
  ARROW_WIDTH_PX,
  countdownArrowPoints,
} from "../scenes/countdown-arrow.js";
import { hullOutlinePoints, maneuverOutline } from "../scenes/maneuver-visual.js";
import {
  LOCK_BRACKET_HALF,
  UNKNOWN_WEAPON_COLOR,
  UNKNOWN_WEAPON_RADIUS,
  chargeOrbBandsAtRest,
  chargeOrbMaxRadius,
  glowBandsAtRest,
  lockBracketArms,
  projectileDrawLayers,
  weaponFillOf,
} from "../scenes/combat-visual.js";
import {
  BAKE_WORLD_PAD_PX,
  DASH_GHOST_WIDTH,
  HITBOX_PX,
  HP_BAR_GEOMETRY,
  LOCK_WIDTH,
} from "../scenes/arena/world-style.js";
```

- [ ] **Step 7: Run the bake test**

Run: `cd packages/client && npx vitest run src/render/bake.test.ts`
Expected: PASS. `magmablast`'s three band colours are `#C02000`, `#FF6000`, `#FFA800` — 12591104, 16736256, 16755200 as decimals — and its hitbox radius is 12, so at supersample 2 the bands are 24, 17.76 and 10.08 supersampled pixels. The whole atlas at supersample 2 shelves into 2048: the 94 HUD tiles are 128 px square (16 per shelf, six shelves = 768 px), the two pills and the eight-pixel square take one more, and the sixteen world tiles — the tallest being `roadblock`'s 12 × 120 bar at 32 × 248 — take two.

- [ ] **Step 8: Verify the atlas in a browser and commit**

Run `npm run build -w @motor-combat-moba/shared && npm test`, then `npm run dev` and open `http://localhost:5173`. In the console:

```js
game.textures.get("baked-atlas").getFrameNames().length          // 97 + 16 = 113
game.textures.getFrame("baked-atlas", "baked.world.shot.predator").width   // 76 — the CONTENT, not the tile
```

Nothing looks different yet: no renderer draws a world frame until Tasks 5 and 6.

```bash
git add packages/client/src/render/bake.ts packages/client/src/render/bake.test.ts \
  packages/client/src/scenes/arena/world-style.ts
git commit -m "feat(client): bake every static world shape into the atlas at boot

Moves no playtest probe number: boot-time texture work only. No sim, table, tick order or
prediction code is touched, and nothing draws the new frames yet."
```

---

### Task 4: `scripts/pack-atlas.mjs`, `ART_ATLAS`, and the checks that keep it honest

**Files:**
- Create: `scripts/pack-atlas.mjs`
- Test: `scripts/pack-atlas.test.mjs`
- Create: `packages/client/public/art/art-atlas.png`, `art-atlas.json` (generated, committed)
- Modify: `packages/client/src/render/atlas.ts`
- Test: `packages/client/src/render/atlas.test.ts` (create)
- Modify: `packages/client/src/assets/car-sprite.ts` (`phaserTextures`, `:64-72`)
- Modify: `packages/client/src/scenes/BootScene.ts` (`loadArt`, `:69-108`)
- Modify: `packages/client/src/scenes/hud/slot-bar.ts` (`SlotView.applyWeapon`), `packages/client/src/dev/AssetTuningScene.ts` (`:200`, `:383`)
- Modify: `scripts/check-art.mjs`, `scripts/check-art.test.mjs`
- Modify: `scripts/build-release.mjs`, `scripts/build-release.test.mjs`
- Modify: `package.json`, `docs/asset-pipeline.md`

**Interfaces:**
- Consumes: the manifest schema (`assets/manifest-schema.ts`), `artFilesOnDisk` / `checkManifestShape` / `NON_SPRITE_DIRS` (`scripts/check-art.mjs`, V1).
- Produces: `ART_ATLAS`, `ART_ATLAS_PNG`, `ART_ATLAS_JSON`, `ArtTextureLookup`, `atlasHasFrame`, `artFrame`, `artFrameExists`, `artFrameSize`, `artImage`, `loadArtAtlas` (`render/atlas.ts`); `ATLAS_PAD_PX`, `ATLAS_MAX_PX`, `PACKER_VERSION`, `ATLAS_PNG`, `ATLAS_JSON`, `packRects`, `chooseSheet`, `atlasJson`, `sourceFingerprint`, `readSources`, `main` (`scripts/pack-atlas.mjs`); `NON_SPRITE_FILES`, `checkAtlasCoverage` (`scripts/check-art.mjs`); `assertAtlasShipped` (`scripts/build-release.mjs`); `npm run pack:atlas`.

**Read `docs/asset-pipeline.md` before writing a line of this task.** Its "Deferred" section argues *against* an atlas, and it pre-describes the design this task builds: "packing belongs in that build step — it would run against the same loose `public/art/` source and rewrite the manifest to atlas form, and because every consumer only ever asks the manifest for a key, no scene code would need to change." Two of its three objections are answered here and one is accepted:

| Its objection | Answer |
|---|---|
| "changing one car's art means re-running a packer, two files change instead of one" | Accepted, and made impossible to forget: the atlas JSON carries a fingerprint of the source bytes, `npm run check:art` reports a mismatch as a **blocker**, and `scripts/check-art.test.mjs` runs the blockers inside `npm test`. Forgetting fails the suite with the command to run, exactly as a stale manual page does. |
| "the sheet itself is an unreviewable binary blob in git diffs" | True, and the reason the loose PNGs still ship and the importers, `?dev=assets` and `manual.html` all still read them. The atlas is derived; the PNGs remain the reviewable source. |
| "packed neighbours risk edge-bleed fringing" | `ATLAS_PAD_PX` is 2 transparent pixels between every pair of frames, which is what edge bleed needs and what a tight pack lacks. |

The manifest is **not** rewritten to atlas form (spec R15: "The importers and the `?dev=assets` tool are unchanged; the manual page keeps linking the loose PNGs"). Instead the client asks the atlas for a frame named by the manifest key and falls through to the loose PNG when there is none — so a build with no atlas, or an atlas that failed to load, draws exactly what it draws today.

- [ ] **Step 1: Write the failing test for the packer's pure halves**

```js
// scripts/pack-atlas.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  ATLAS_MAX_PX,
  ATLAS_PAD_PX,
  PACKER_VERSION,
  atlasJson,
  chooseSheet,
  packRects,
  sourceFingerprint,
} from "./pack-atlas.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");

const items = [
  { key: "b", width: 100, height: 50 },
  { key: "a", width: 100, height: 50 },
  { key: "c", width: 60, height: 20 },
];

describe("packRects", () => {
  it("shelves tallest first, ties broken by key, and leaves the pad between neighbours", () => {
    const out = packRects(items, 220);
    assert.deepEqual(out.placements, [
      { key: "a", x: 0, y: 0, width: 100, height: 50 },
      { key: "b", x: 100 + ATLAS_PAD_PX, y: 0, width: 100, height: 50 },
      { key: "c", x: 0, y: 50 + ATLAS_PAD_PX, width: 60, height: 20 },
    ]);
    assert.equal(out.usedHeight, 50 + ATLAS_PAD_PX + 20);
  });

  it("answers null rather than dropping a frame it cannot fit", () => {
    assert.equal(packRects(items, 64), null);
  });

  it("is deterministic: the same items in any order pack identically", () => {
    assert.deepEqual(packRects([...items].reverse(), 220), packRects(items, 220));
  });
});

describe("chooseSheet", () => {
  it("takes the smallest power of two that holds everything", () => {
    assert.equal(chooseSheet([{ key: "a", width: 100, height: 100 }]), 128);
    assert.equal(chooseSheet([{ key: "a", width: 200, height: 100 }]), 256);
  });

  it("refuses to grow past the ceiling", () => {
    assert.throws(
      () => chooseSheet([{ key: "a", width: ATLAS_MAX_PX + 1, height: 8 }]),
      /does not fit/,
    );
  });
});

describe("atlasJson", () => {
  it("writes a Phaser JSON-Hash atlas keyed by manifest key", () => {
    const json = atlasJson([{ key: "car.mirage", x: 4, y: 8, width: 96, height: 51 }], 512, "abc123");
    assert.deepEqual(json.frames["car.mirage"], {
      frame: { x: 4, y: 8, w: 96, h: 51 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 96, h: 51 },
      sourceSize: { w: 96, h: 51 },
    });
    assert.equal(json.meta.size.w, 512);
    assert.equal(json.meta.sourceFingerprint, "abc123");
    assert.equal(json.meta.packerVersion, PACKER_VERSION);
  });
});

describe("sourceFingerprint", () => {
  it("changes when a source byte changes, and not when the order does", () => {
    const a = { key: "x", bytes: Buffer.from([1, 2, 3]) };
    const b = { key: "y", bytes: Buffer.from([4, 5, 6]) };
    assert.equal(sourceFingerprint([a, b]), sourceFingerprint([b, a]));
    assert.notEqual(
      sourceFingerprint([a, b]),
      sourceFingerprint([a, { key: "y", bytes: Buffer.from([4, 5, 7]) }]),
    );
    assert.notEqual(sourceFingerprint([a, b]), sourceFingerprint([{ key: "z", bytes: a.bytes }, b]));
  });
});

describe("the committed atlas", () => {
  it("exists beside the manifest and names every row", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(artDir, "manifest.json"), "utf8"));
    const atlas = JSON.parse(fs.readFileSync(path.join(artDir, "art-atlas.json"), "utf8"));
    assert.equal(fs.existsSync(path.join(artDir, "art-atlas.png")), true);
    assert.deepEqual(Object.keys(atlas.frames).sort(), Object.keys(manifest.sprites ?? {}).sort());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/pack-atlas.test.mjs`
Expected: FAIL — cannot resolve `./pack-atlas.mjs`.

- [ ] **Step 3: Write `scripts/pack-atlas.mjs`**

```js
// scripts/pack-atlas.mjs
/**
 * Pack every PNG the art manifest names into one power-of-two sheet (spec R15).
 *
 * The client asks the atlas for a frame named by the MANIFEST KEY and falls through to the loose
 * PNG when there is none, so this changes nothing about how art is authored: the importers still
 * write `cars/<id>.png` and a manifest row, `?dev=assets` still reads them, and `manual.html` still
 * links them. What it changes is what the browser loads — one texture instead of twelve — and,
 * because the sheet is a power of two, it is the one texture a mipmap filter can be enabled for
 * (spec R17a, V5's).
 *
 * `docs/asset-pipeline.md` used to list this under "Deferred" with three objections. Two are
 * answered here: `ATLAS_PAD_PX` is the edge-bleed fix, and `sourceFingerprint` plus
 * `scripts/check-art.mjs` make a stale sheet a blocker rather than a silently wrong picture. The
 * third — that a packed sheet is an unreviewable blob — is why the loose PNGs remain the source
 * that gets reviewed, and why they still ship.
 *
 * Everything above `main` is pure and unit-tested; only `main` touches the filesystem or sharp.
 */

/** Transparent pixels between neighbouring frames. Two is what stops linear filtering bleeding. */
export const ATLAS_PAD_PX = 2;
/** The widest sheet worth emitting. `docs/asset-pipeline.md` caps a single source PNG at 256 square. */
export const ATLAS_MAX_PX = 4096;
/** Bumped when the packing or the JSON shape changes, so every atlas re-packs. */
export const PACKER_VERSION = 1;
export const ATLAS_PNG = "art-atlas.png";
export const ATLAS_JSON = "art-atlas.json";

/**
 * A shelf packer, tallest first with ties broken by key so the output is a pure function of the
 * input set and not of the order it arrived in. Returns `null` when the sheet cannot hold the
 * items — the caller grows the sheet rather than dropping a frame.
 */
export function packRects(items, sheetPx) {
  const sorted = [...items].sort((a, b) => b.height - a.height || (a.key < b.key ? -1 : 1));
  const placements = [];
  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  for (const item of sorted) {
    if (item.width > sheetPx || item.height > sheetPx) return null;
    if (x + item.width > sheetPx) {
      x = 0;
      y += shelfHeight + ATLAS_PAD_PX;
      shelfHeight = 0;
    }
    if (y + item.height > sheetPx) return null;
    placements.push({ key: item.key, x, y, width: item.width, height: item.height });
    x += item.width + ATLAS_PAD_PX;
    shelfHeight = Math.max(shelfHeight, item.height);
  }
  return { placements, usedHeight: y + shelfHeight };
}

/** The smallest power-of-two square that holds the items. Throws rather than emitting a giant sheet. */
export function chooseSheet(items) {
  for (let px = 128; px <= ATLAS_MAX_PX; px *= 2) {
    if (packRects(items, px)) return px;
  }
  throw new Error(`art does not fit a ${ATLAS_MAX_PX}px atlas — downscale a source PNG`);
}

/** FNV-1a over the sources, in key order: what `check-art.mjs` compares to decide "stale". */
export function sourceFingerprint(entries) {
  let hash = 0x811c9dc5;
  const mix = (byte) => {
    hash ^= byte & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const ch of `v${PACKER_VERSION}:p${ATLAS_PAD_PX}`) mix(ch.charCodeAt(0));
  for (const entry of [...entries].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    for (const ch of `${entry.key} `) mix(ch.charCodeAt(0));
    for (const byte of entry.bytes) mix(byte);
    mix(0);
  }
  return hash.toString(16).padStart(8, "0");
}

/** The Phaser JSON-Hash atlas. Frame names are manifest keys, so no consumer learns a second name. */
export function atlasJson(placements, sheetPx, fingerprint) {
  const frames = {};
  for (const p of [...placements].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    frames[p.key] = {
      frame: { x: p.x, y: p.y, w: p.width, h: p.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: p.width, h: p.height },
      sourceSize: { w: p.width, h: p.height },
    };
  }
  return {
    frames,
    meta: {
      app: "scripts/pack-atlas.mjs",
      image: ATLAS_PNG,
      format: "RGBA8888",
      size: { w: sheetPx, h: sheetPx },
      scale: "1",
      packerVersion: PACKER_VERSION,
      sourceFingerprint: fingerprint,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI shell: the only part that touches the filesystem or sharp.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artDir = path.join(rootDir, "packages", "client", "public", "art");

/** Every manifest row as `{ key, file, bytes }`, in key order. Shared with `check-art.mjs`. */
export function readSources(dir = artDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  return Object.entries(manifest.sprites ?? {})
    .filter(([, row]) => typeof row?.file === "string" && row.file.length > 0)
    .map(([key, row]) => ({ key, file: row.file, bytes: fs.readFileSync(path.join(dir, row.file)) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

export async function main(dir = artDir) {
  const sources = readSources(dir);
  if (sources.length === 0) {
    console.log("no manifest rows — nothing to pack");
    return;
  }
  const items = [];
  for (const source of sources) {
    const meta = await sharp(source.bytes).metadata();
    items.push({ key: source.key, width: meta.width, height: meta.height });
  }
  const sheetPx = chooseSheet(items);
  const { placements } = packRects(items, sheetPx);
  const byKey = new Map(sources.map((s) => [s.key, s]));

  await sharp({
    create: {
      width: sheetPx,
      height: sheetPx,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(placements.map((p) => ({ input: byKey.get(p.key).bytes, left: p.x, top: p.y })))
    .png({ compressionLevel: 9 })
    .toFile(path.join(dir, ATLAS_PNG));

  const json = atlasJson(placements, sheetPx, sourceFingerprint(sources));
  fs.writeFileSync(path.join(dir, ATLAS_JSON), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`packed ${placements.length} sprites into ${sheetPx}x${sheetPx} ${ATLAS_PNG}`);
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Generate and inspect the atlas**

Run:

```bash
node scripts/pack-atlas.mjs
node --input-type=module -e "import fs from 'node:fs';const a=JSON.parse(fs.readFileSync('packages/client/public/art/art-atlas.json','utf8'));console.log(a.meta.size, Object.keys(a.frames).length, a.meta.sourceFingerprint)"
node --test scripts/pack-atlas.test.mjs
```

Expected: `packed 12 sprites into 512x512 art-atlas.png`, then `{ w: 512, h: 512 } 12` and eight hex digits. Twelve sources today: nine 128x128 weapon icons (three per shelf at 512 wide, three shelves) and three roughly 96x52 car sprites on a fourth. Tests PASS.

Open `packages/client/public/art/art-atlas.png` and look at it: every icon whole, none clipped, a visible transparent gap between neighbours.

- [ ] **Step 5: Write the failing test for the client-side resolution**

```ts
// packages/client/src/render/atlas.test.ts
import { describe, expect, it } from "vitest";
import { ART_ATLAS, artFrame, artFrameExists, artFrameSize, atlasHasFrame } from "./atlas.js";

/** The two methods the resolution reads off Phaser's `TextureManager`, and nothing more. */
function textures(
  loaded: Record<string, { width: number; height: number }>,
  frames: Record<string, { width: number; height: number }>,
) {
  return {
    exists: (key: string) => key in loaded,
    getFrame: (key: string, frame?: string | number) =>
      key === ART_ATLAS ? (frames[String(frame)] ?? null) : (loaded[key] ?? null),
  };
}

const ATLAS_ONLY = textures(
  { [ART_ATLAS]: { width: 512, height: 512 } },
  { "car.mirage": { width: 96, height: 51 } },
);
const LOOSE_ONLY = textures({ "car.mirage": { width: 96, height: 51 } }, {});
const NEITHER = textures({}, {});

describe("artFrame", () => {
  it("prefers the packed atlas", () => {
    expect(artFrame(ATLAS_ONLY, "car.mirage")).toEqual([ART_ATLAS, "car.mirage"]);
    expect(atlasHasFrame(ATLAS_ONLY, "car.mirage")).toBe(true);
  });

  it("falls through to the loose texture when the atlas is absent or lacks the key", () => {
    expect(artFrame(LOOSE_ONLY, "car.mirage")).toEqual(["car.mirage", undefined]);
    expect(artFrame(ATLAS_ONLY, "car.bastion")).toEqual(["car.bastion", undefined]);
    expect(atlasHasFrame(LOOSE_ONLY, "car.mirage")).toBe(false);
  });
});

describe("artFrameExists and artFrameSize", () => {
  it("answer for either source, and report the FRAME's size, never the sheet's", () => {
    expect(artFrameExists(ATLAS_ONLY, "car.mirage")).toBe(true);
    expect(artFrameExists(LOOSE_ONLY, "car.mirage")).toBe(true);
    expect(artFrameExists(NEITHER, "car.mirage")).toBe(false);
    expect(artFrameSize(ATLAS_ONLY, "car.mirage")).toEqual({ width: 96, height: 51 });
    expect(artFrameSize(LOOSE_ONLY, "car.mirage")).toEqual({ width: 96, height: 51 });
  });

  it("reports a zero size for art nothing has, so fitSprite is never handed a NaN", () => {
    expect(artFrameSize(NEITHER, "car.mirage")).toEqual({ width: 0, height: 0 });
  });
});
```

- [ ] **Step 6: Run it to verify it fails, then extend `render/atlas.ts`**

Run: `cd packages/client && npx vitest run src/render/atlas.test.ts`
Expected: FAIL — `ART_ATLAS` is not exported.

Append to `packages/client/src/render/atlas.ts`. V1's `BAKED_ATLAS` line and its comment stay at the top; that comment's forward reference to V2 can now be read as delivered.

```ts
import type Phaser from "phaser";

/** The packed authored art (spec R11), written by `scripts/pack-atlas.mjs`. */
export const ART_ATLAS = "art-atlas";
/** Served straight out of `public/`, like the manifest and the loose PNGs. */
export const ART_ATLAS_PNG = "art/art-atlas.png";
export const ART_ATLAS_JSON = "art/art-atlas.json";

/**
 * The slice of Phaser's `TextureManager` the resolution reads. Narrowed to two methods so this
 * module is unit-tested in the node environment — the same reason `car-sprite.ts` narrows it to
 * `TextureLookup`.
 */
export interface ArtTextureLookup {
  exists(key: string): boolean;
  getFrame(key: string, frame?: string | number): { width: number; height: number } | null;
}

/** Whether the packed atlas is loaded AND carries this manifest key. */
export function atlasHasFrame(textures: ArtTextureLookup, key: string): boolean {
  return textures.exists(ART_ATLAS) && !!textures.getFrame(ART_ATLAS, key);
}

/**
 * The `(texture, frame)` pair to draw a manifest key with: atlas first, loose PNG second.
 *
 * The fallback is the whole reason the loose PNGs still ship. A tree whose packer never ran, an
 * atlas that failed to load, and a key added to the manifest since the last pack all land here and
 * draw exactly what the game drew before the atlas existed.
 */
export function artFrame(textures: ArtTextureLookup, key: string): [string, string | undefined] {
  return atlasHasFrame(textures, key) ? [ART_ATLAS, key] : [key, undefined];
}

/** Whether either source can draw this key at all. */
export function artFrameExists(textures: ArtTextureLookup, key: string): boolean {
  return atlasHasFrame(textures, key) || textures.exists(key);
}

/**
 * The size of the FRAME, never of the sheet.
 *
 * This is the one thing an atlas would otherwise break silently: `fitSprite` scales a sprite
 * against its source dimensions, and `TextureManager.get(key).getSourceImage()` on an atlased key
 * answers the whole 512-pixel sheet. Every chassis would be drawn at a fortieth of its size.
 */
export function artFrameSize(
  textures: ArtTextureLookup,
  key: string,
): { width: number; height: number } {
  const [texture, frame] = artFrame(textures, key);
  const found = textures.getFrame(texture, frame);
  return found ? { width: found.width, height: found.height } : { width: 0, height: 0 };
}

/** `scene.add.image` for a manifest key, from whichever source has it. */
export function artImage(
  scene: Phaser.Scene,
  x: number,
  y: number,
  key: string,
): Phaser.GameObjects.Image {
  return scene.add.image(x, y, ...artFrame(scene.textures, key));
}

/** Queue the packed atlas. A missing pair leaves the texture absent and every key falls through. */
export function loadArtAtlas(load: Phaser.Loader.LoaderPlugin): void {
  load.atlas(ART_ATLAS, ART_ATLAS_PNG, ART_ATLAS_JSON);
}
```

Run again: PASS (4 tests).

- [ ] **Step 7: Point the four consumers at the atlas**

| File | Was | Becomes |
|---|---|---|
| `assets/car-sprite.ts:64-72` (`phaserTextures`) | `exists: (key) => manager.exists(key)` and a `sizeOf` reading `manager.get(key).getSourceImage()` | `exists: (key) => artFrameExists(manager, key)` and `sizeOf: (key) => artFrameSize(manager, key)`; add `import { artFrameExists, artFrameSize } from "../render/atlas.js";` and add to its doc comment: "It resolves through `render/atlas.ts`, so an atlased key is measured by its FRAME and not by the whole sheet." |
| `scenes/hud/slot-bar.ts` (`SlotView.applyWeapon`) | `.setTexture(resolved.key)` | `.setTexture(...artFrame(this.scene.textures, resolved.key))` — V1's handoff says this is the only place the HUD names a weapon-icon texture |
| `dev/AssetTuningScene.ts:200` | `applyCarSprite(this.add.image(x, y, resolved.key), resolved, NO_TINT)` | `applyCarSprite(artImage(this, x, y, resolved.key), resolved, NO_TINT)` |
| `dev/AssetTuningScene.ts:383` | `this.add.image(iconX, cy, icon.key)` | `artImage(this, iconX, cy, icon.key)` |

`resolveCarSprite`, `resolveWeaponIcon`, `applyCarSprite`, `fitSprite` and the manifest schema are **not** touched: each takes a key and a size, and both still mean what they meant.

- [ ] **Step 8: Load the atlas in `BootScene`**

Replace `loadArt`'s body (`BootScene.ts:69-108`) with the two-pass version below. Everything in the second pass — the filter, the `FILE_LOAD_ERROR` handler, the missing-texture sweep and their comments — is the existing code, moved inside `runLoader` and given one extra filter.

```ts
  /** Run one loader batch to completion. Extracted so the atlas and the loose PNGs are two passes. */
  private runLoader(queue: () => void): Promise<void> {
    queue();
    return new Promise<void>((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.start();
    });
  }

  private async loadArt(): Promise<void> {
    const { manifest: parsed, problems } = await loadManifest();
    manifest = parsed;
    for (const problem of problems) console.warn(`[art] ${problem}`);

    // Filtered before anything is queued, so `entries` stays the one list the loader, the
    // FILE_LOAD_ERROR handler, and the missing-texture sweep below all agree on. A key skipped here
    // is not "failed to load" — it was never asked for, and must not be warned about.
    const entries = Object.entries(parsed.sprites).filter(([key]) =>
      shouldLoadAssetKey(key, ACTIVE_ARENA_ID),
    );
    if (entries.length === 0) return;

    // Pass one: the packed atlas (spec R11, R15). A tree whose packer never ran, or a sheet that
    // fails to load, simply leaves the texture absent — every key then falls through to its loose
    // PNG below, which is why both still ship.
    await this.runLoader(() => loadArtAtlas(this.load));
    if (!this.textures.exists(ART_ATLAS)) {
      console.warn(`[art] no packed atlas at ${ART_ATLAS_PNG} — falling back to loose PNGs`);
    }

    // Pass two: only the keys the atlas did NOT carry. Loading both would upload the same picture
    // twice and hand the GPU a second texture to bind for nothing.
    const loose = entries.filter(([key]) => !atlasHasFrame(this.textures, key));
    if (loose.length === 0) return;

    // A file named in the manifest but missing on disk must not stall boot: warn and carry on, and
    // the missing texture key then falls through to the procedural silhouette at draw time. This
    // handler covers a genuine transport failure and is the only one that knows the resolved URL.
    const reported = new Set<string>();
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      reported.add(file.key);
      console.warn(`[art] failed to load "${file.key}" from ${file.url}`);
    });
    await this.runLoader(() => {
      for (const [key, entry] of loose) this.load.image(key, `art/${entry.file}`);
    });

    // Warn on the condition the renderer actually checks — the texture missing — rather than on
    // FILE_LOAD_ERROR alone. Vite's dev server answers a missing file under `public/` with its SPA
    // fallback (200, text/html), so the *load* succeeds and Phaser fails at the decode stage, which
    // does not emit FILE_LOAD_ERROR. Only a real 404, as the release server returns, does — and
    // that path has already warned above with the URL, so `reported` keeps it from warning twice.
    for (const [key, entry] of loose) {
      if (!reported.has(key) && !this.textures.exists(key)) {
        console.warn(`[art] failed to load "${key}" from art/${entry.file}`);
      }
    }
  }
```

Add `import { ART_ATLAS, ART_ATLAS_PNG, atlasHasFrame, loadArtAtlas } from "../render/atlas.js";`.

- [ ] **Step 9: Teach `check-art.mjs` about the atlas**

In `scripts/check-art.mjs`, beside V1's `NON_SPRITE_DIRS`:

```js
/**
 * Files at the root of the art directory that are not manifest art. `art-atlas.png` is PACKED FROM
 * the manifest rows rather than being one, so it is neither an orphan nor a row — `checkAtlasCoverage`
 * below is what holds it to the manifest instead. (`art-atlas.json` needs no entry: only `.png` is
 * in `ART_EXTENSIONS`.)
 */
export const NON_SPRITE_FILES = ["art-atlas.png"];
```

and in `artFilesOnDisk`'s walk:

```js
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (rel === "" && NON_SPRITE_DIRS.includes(entry.name)) continue;
        walk(path.join(abs, entry.name), childRel);
      } else if (rel === "" && NON_SPRITE_FILES.includes(entry.name)) {
        continue;
      } else if (ART_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        out.push(childRel);
      }
    }
```

Add the coverage check beside `checkManifestShape`:

```js
/**
 * Is the packed atlas present, current, and a faithful index of the manifest?
 *
 * The atlas is a DERIVED file, so its failure mode is the manual page's: someone repaints a PNG,
 * the loose file changes, and the packed copy the game actually draws does not. `sourceFingerprint`
 * (`scripts/pack-atlas.mjs`) hashes the source bytes into the atlas's own JSON, so a mismatch is
 * exact rather than a guess — and it is a BLOCKER, which puts it inside `npm test` through
 * `check-art.test.mjs` with the command to run.
 *
 * `sizes` is the source PNGs' dimensions by key, so a frame that no longer matches its source is
 * caught even in the case where the fingerprint somehow agrees.
 */
export function checkAtlasCoverage({ rows, atlas, fingerprint, sizes }) {
  if (!atlas) {
    return [finding("blocker", "atlas-missing", "no packed atlas — run `npm run pack:atlas`")];
  }
  const out = [];
  if (atlas.meta?.sourceFingerprint !== fingerprint) {
    out.push(
      finding(
        "blocker",
        "atlas-stale",
        "the packed atlas was built from different art — run `npm run pack:atlas`",
      ),
    );
  }
  const frames = atlas.frames ?? {};
  for (const key of Object.keys(rows)) {
    const frame = frames[key];
    if (!frame) {
      out.push(finding("blocker", "atlas-missing-row", `"${key}" is not in the packed atlas`));
      continue;
    }
    const size = sizes[key];
    if (size && (frame.frame.w !== size.width || frame.frame.h !== size.height)) {
      out.push(
        finding(
          "blocker",
          "atlas-frame-size",
          `"${key}" is ${frame.frame.w}x${frame.frame.h} in the atlas but ${size.width}x${size.height} on disk`,
        ),
      );
    }
  }
  for (const key of Object.keys(frames)) {
    if (!(key in rows)) {
      out.push(
        finding(
          "warning",
          "atlas-orphan-frame",
          `the atlas carries "${key}", which no manifest row names`,
        ),
      );
    }
  }
  return out;
}

/** The source PNGs' dimensions by manifest key — `checkAtlasCoverage`'s `sizes`. */
export async function atlasSourceSizes(sources) {
  const sizes = {};
  for (const source of sources) {
    const meta = await sharp(source.bytes).metadata();
    sizes[source.key] = { width: meta.width, height: meta.height };
  }
  return sizes;
}
```

In `main()`, after the `MANIFEST` block and before `CHASSIS SPRITES`:

```js
  console.log("\nPACKED ATLAS");
  const sources = readSources(artDir);
  let atlas = null;
  try {
    atlas = JSON.parse(fs.readFileSync(path.join(artDir, "art-atlas.json"), "utf8"));
  } catch {
    atlas = null;
  }
  const coverage = checkAtlasCoverage({
    rows: manifest.sprites ?? {},
    atlas,
    fingerprint: sourceFingerprint(sources),
    sizes: await atlasSourceSizes(sources),
  });
  if (coverage.length === 0) {
    console.log(`ok    ${Object.keys(atlas.frames).length} frames, ${atlas.meta.size.w}px sheet, current`);
  }
  for (const f of coverage) console.log(`      ${f.level}: ${f.message}`);
```

and add `countBlockers(coverage)` to the `blockers` sum at the end of `main`. Add `import sharp from "sharp";` and `import { readSources, sourceFingerprint } from "./pack-atlas.mjs";` to the CLI-shell import block.

- [ ] **Step 10: Extend `scripts/check-art.test.mjs`**

Extend the import on `:7` to `{ NON_SPRITE_DIRS, NON_SPRITE_FILES, artFilesOnDisk, atlasSourceSizes, checkAtlasCoverage, checkManifestShape, isKnownNamespace }`, add `import { readSources, sourceFingerprint } from "./pack-atlas.mjs";`, and add:

```js
describe("checkAtlasCoverage", () => {
  const rows = { "car.mirage": { file: "cars/mirage.png" } };
  const sizes = { "car.mirage": { width: 96, height: 51 } };
  const atlas = {
    frames: { "car.mirage": { frame: { x: 0, y: 0, w: 96, h: 51 } } },
    meta: { sourceFingerprint: "abc" },
  };

  it("passes a current atlas that names every row", () => {
    assert.deepEqual(checkAtlasCoverage({ rows, atlas, fingerprint: "abc", sizes }), []);
  });

  it("blocks a missing atlas, a stale one, a missing row and a wrong-sized frame", () => {
    assert.deepEqual(codes(checkAtlasCoverage({ rows, atlas: null, fingerprint: "abc", sizes })), [
      "atlas-missing",
    ]);
    assert.deepEqual(codes(checkAtlasCoverage({ rows, atlas, fingerprint: "zzz", sizes })), [
      "atlas-stale",
    ]);
    assert.deepEqual(
      codes(
        checkAtlasCoverage({
          rows: { ...rows, "car.bastion": { file: "cars/bastion.png" } },
          atlas,
          fingerprint: "abc",
          sizes,
        }),
      ),
      ["atlas-missing-row"],
    );
    assert.deepEqual(
      codes(
        checkAtlasCoverage({
          rows,
          atlas,
          fingerprint: "abc",
          sizes: { "car.mirage": { width: 64, height: 51 } },
        }),
      ),
      ["atlas-frame-size"],
    );
  });

  it("only warns about a frame no row names", () => {
    const extra = {
      ...atlas,
      frames: { ...atlas.frames, "car.ghost": { frame: { x: 0, y: 0, w: 1, h: 1 } } },
    };
    const out = checkAtlasCoverage({ rows, atlas: extra, fingerprint: "abc", sizes });
    assert.deepEqual(codes(out), ["atlas-orphan-frame"]);
    assert.equal(levelOf(out, "atlas-orphan-frame"), "warning");
  });
});
```

and, inside the existing `"the art this repo actually ships"` block:

```js
  it("ships a packed atlas built from exactly this art — run `npm run pack:atlas` if this fails", async () => {
    const sources = readSources(artDir);
    const atlas = JSON.parse(fs.readFileSync(path.join(artDir, "art-atlas.json"), "utf8"));
    const blockers = checkAtlasCoverage({
      rows: manifest.sprites ?? {},
      atlas,
      fingerprint: sourceFingerprint(sources),
      sizes: await atlasSourceSizes(sources),
    }).filter((f) => f.level === "blocker");
    assert.deepEqual(
      blockers.map((f) => f.message),
      [],
    );
  });

  it("does not treat the packed atlas as orphaned art", () => {
    assert.deepEqual(NON_SPRITE_FILES, ["art-atlas.png"]);
    assert.equal(artFilesOnDisk(artDir).includes("art-atlas.png"), false);
  });
```

- [ ] **Step 11: Make a release without the atlas fail**

Vite copies `public/` verbatim into `packages/client/dist` and `build-release.mjs` copies that tree, so the atlas ships with no wiring at all. That is exactly why it needs an assertion: a silent absence costs the release its batching and nobody would notice. Beside `assertArenaPruned` in `scripts/build-release.mjs`:

```js
/**
 * Throw if the packed art atlas did not reach the release.
 *
 * It ships because Vite copies `public/` verbatim, which means nothing in the build would complain
 * if it were absent — the game would fall back to loose PNGs and simply cost more. `npm test` keeps
 * the committed atlas CURRENT (`checkAtlasCoverage`); this keeps it from being left OUT.
 */
export function assertAtlasShipped(clientDistDir) {
  const missing = ["art-atlas.png", "art-atlas.json"].filter(
    (file) => !fs.existsSync(path.join(clientDistDir, "art", file)),
  );
  if (missing.length > 0) {
    throw new Error(
      `packed art atlas missing from the release: ${missing.join(", ")} — run \`npm run pack:atlas\``,
    );
  }
}
```

Call it immediately after `assertArenaPruned(...)` in `main`, and add to `scripts/build-release.test.mjs` (importing `assertAtlasShipped` and `node:os` alongside the existing imports):

```js
describe("assertAtlasShipped", () => {
  it("passes when both files are there and names what is missing when they are not", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-"));
    fs.mkdirSync(path.join(dir, "art"), { recursive: true });
    fs.writeFileSync(path.join(dir, "art", "art-atlas.png"), "");
    assert.throws(() => assertAtlasShipped(dir), /art-atlas\.json/);
    fs.writeFileSync(path.join(dir, "art", "art-atlas.json"), "{}");
    assert.doesNotThrow(() => assertAtlasShipped(dir));
  });
});
```

- [ ] **Step 12: Wire the command and update `docs/asset-pipeline.md`**

In root `package.json` scripts, after `check:art`:

```json
    "pack:atlas": "node scripts/pack-atlas.mjs",
```

In `docs/asset-pipeline.md`, three edits:

**(a)** In **The `public/art/` layout**, add two lines to the tree and the paragraph under it:

```
  art-atlas.png   # generated: every manifest sprite packed into one power-of-two sheet
  art-atlas.json  # generated: the frame table, keyed by manifest key
```

> Both are written by `npm run pack:atlas` and **committed**, never edited by hand. They are derived
> from the loose PNGs, which still ship and are still what the importers, `?dev=assets` and
> `manual.html` read: the client asks the atlas for a frame named by the manifest key and falls
> through to the loose PNG when there is none, so a tree with no atlas draws exactly the same
> picture at a higher cost. `npm run check:art` compares a fingerprint of the source bytes against
> the one inside `art-atlas.json` and reports a mismatch as a blocker, so re-running the packer is
> not something you can forget. **Repainting a PNG in place therefore owes you one command:**
> `npm run pack:atlas`.

**(b)** Replace the **A texture atlas** bullet under **Deferred** with a line saying it landed on
2026-09-04 with the rendering work, pointing at `scripts/pack-atlas.mjs` and section (a) above, and
keeping its three original objections beside their answers — the fingerprint, the two-pixel gutter,
and that the loose PNGs stay the reviewable source.

**(c)** Rewrite the first paragraph and the cliff table of **How much detail a shot can afford**,
which now describes code that no longer exists:

> Shots are **baked sprites**, not fills. `render/bake.ts` runs `projectileDrawLayers`,
> `glowBandsAtRest` and `chargeOrbBandsAtRest` **once at boot**, draws each weapon's body into one
> frame of `baked-atlas`, and the arena then draws a projectile as a quad: a position, a rotation,
> and — for a weapon with a flicker or a wind-up — a scale. Detail therefore costs **nothing per
> frame**; it costs atlas area once, and the sheet is 2048 px at tier Medium with roughly a quarter
> of it used.
>
> Two things still cost, and they are the ones worth stopping for: a **per-object blend mode**, which
> is forbidden outright in the world (`render/layers.ts` owns one blend per layer — put an additive
> look on the Glow layer instead of setting a mode), and **a shape whose geometry genuinely changes
> per frame**, which is a beam and nothing else.
>
> **The binding constraint is still honesty, not frame time.** Bands are fractions of the hitbox
> radius, the flicker only ever shrinks, and a baked frame is sized to the hitbox itself — so a drawn
> shot can never render larger than the thing that hits. `combat-visual.test.ts` enforces the first
> two and `render/bake.test.ts` the third.

- [ ] **Step 13: Verify everything and commit — this step's warning goes in your summary too**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
npm run typecheck
npm run check:art
npm run build:release
unzip -l motor-combat-moba-release.zip | grep art-atlas
```

Expected: every suite green including `scripts/pack-atlas.test.mjs` and the four new `check-art` cases; `check:art` prints a `PACKED ATLAS` block reading `ok 12 frames, 512px sheet, current`; the release lists both atlas files.

Then run `npm run dev`, open `http://localhost:5173`, and check in the console that `game.textures.exists("art-atlas")` is `true` and that `game.textures.getTextureKeys().filter((k) => k.startsWith("car.") || k.startsWith("weapon-icon."))` is empty — every manifest key now resolves through the sheet, and nothing loaded a loose PNG as well.

> **Say this loudly, in the commit message and in your summary to the user.** This change alters
> **what `public/art/` contains and how the client loads it**: two generated files are added, and
> every manifest sprite is now drawn from the packed sheet rather than from its own texture. Art is
> the one input the manual page's fingerprint cannot see, so a person has to look:
> **open `http://localhost:5173/manual.html`** and confirm the three chassis and nine weapon icons
> still draw, and **run `npm run check:art`** and read the new `PACKED ATLAS` block. Do **not** run
> `npm run build:manual` — the guide links the loose PNGs, which are untouched, and rebuilding the
> whole page would bury whether anything real moved.

```bash
git add scripts/pack-atlas.mjs scripts/pack-atlas.test.mjs \
  packages/client/public/art/art-atlas.png packages/client/public/art/art-atlas.json \
  packages/client/src/render/atlas.ts packages/client/src/render/atlas.test.ts \
  packages/client/src/assets/car-sprite.ts packages/client/src/scenes/BootScene.ts \
  packages/client/src/scenes/hud/slot-bar.ts packages/client/src/dev/AssetTuningScene.ts \
  scripts/check-art.mjs scripts/check-art.test.mjs \
  scripts/build-release.mjs scripts/build-release.test.mjs \
  package.json docs/asset-pipeline.md
git commit -m "feat(client): pack authored art into one build-time atlas

ART CHANGE - public/art/ gains two generated, committed files (art-atlas.png, art-atlas.json) and
the client now draws every manifest sprite from the packed sheet, falling back to the loose PNGs
when the atlas is absent. The loose PNGs still ship and manual.html still links them. Look at
http://localhost:5173/manual.html and run npm run check:art; do NOT run npm run build:manual.

Moves no playtest probe number: no sim, table, tick order or prediction code is touched."
```

---

### Task 5: Projectiles, glows and orbs become sprites

**Files:**
- Create: `packages/client/src/scenes/arena/shot-sprites.ts`
- Modify: `packages/client/src/scenes/arena/shot-renderer.ts`
- Modify: `packages/client/CLAUDE.md` (the shot-tables paragraph)

**Interfaces:**
- Consumes: `Layer`, `CAR_BAND` (not used here), `depthOf`, `worldSprite` (Task 1); `SpritePool` (Task 1); `instanceDrawCentre`, `glowFlickerScale`, `chargeOrbRadius`, `chargeOrbMaxRadius` (Task 2); `bakedShotFrame`, `bakedOrbFrame`, `worldFrameScale`, `BAKE_SUPERSAMPLE`, `BAKE_DEFAULT_TIER`, `bakedFrame` (Task 3).
- Produces: `class ShotSprites { constructor(scene: Phaser.Scene); begin(): void; body(frame: string, x: number, y: number, angle: number, scale: number): void; orb(frame: string, x: number, y: number, scale: number): void; end(): void; destroy(): void }` (`scenes/arena/shot-sprites.ts`). `ShotRenderer`'s constructor and `render(frame)` signature are unchanged, so `ArenaScene` and `BenchScene` need no edit.

**What is converted here and what is not.** The fork is one line: `instance.kind`.

| `RenderInstance.kind` | Weapons today | V2 |
|---|---|---|
| `WeaponKind.PROJECTILE` | `predator`, `magmablast`, `pepperbox`, `thumper`, `roadblock` | **sprite** — one baked frame, positioned at `instanceDrawCentre`, rotated to `angle`, scaled by `glowFlickerScale` |
| `WeaponKind.BEAM`, not an aura | `afterburner`, `lance`, `tremor` | **stays `Graphics`** — `beamDrawLayers` rebuilds the polygon every frame because the shape itself changes; V3's row |
| `WeaponKind.BEAM`, aura | `magmablast`'s detonation (a `disc` hitbox at `origin: "center"`) | **stays `Graphics`** — the spec's V3 row is "tremor and aura sprites" |
| unrecognised or `maneuver` | — | **sprite** — `BAKED_SHOT_UNKNOWN`, the same grey dot `instanceDrawShape` falls to |

That leaves `beamDrawLayers` (plus the aura's ring-and-wash, which V3 takes with it) as the **only** per-frame `Graphics` fills in the world, alongside the `?debug=1` hitbox outline pass — which is exactly the V2 gate. The one shared `Graphics` object carries both, so the world clears one `Graphics` per frame and no more.

The charge orb keeps the same second pass over cars it has today, for the same reason: a charging weapon has spawned no instance yet, which is precisely the window the telegraph draws.

- [ ] **Step 1: Write `scenes/arena/shot-sprites.ts`**

```ts
// packages/client/src/scenes/arena/shot-sprites.ts
import type Phaser from "phaser";
import { BAKED_ATLAS } from "../../render/atlas.js";
import { Layer, worldSprite } from "../../render/layers.js";
import { SpritePool } from "../../render/sprite-pool.js";

/**
 * The shot layer's retained sprites: one pool for projectile bodies, one for charge orbs.
 *
 * Order-based rather than keyed by instance id — see `SpritePool`. A frame is `begin()`, one call
 * per thing to draw, `end()`; between those three the class allocates nothing at all, which is the
 * point (spec R6). Both pools live on `Layer.Shots`, so every quad in them is one batch off one
 * texture, and neither ever touches a blend mode: the band owns that (R4).
 */
export class ShotSprites {
  private readonly bodies: SpritePool<Phaser.GameObjects.Image>;
  private readonly orbs: SpritePool<Phaser.GameObjects.Image>;

  constructor(scene: Phaser.Scene) {
    // The frame each sprite starts on does not matter — every use sets one — but a sprite must be
    // born on SOME frame of the baked atlas so it joins that texture's batch from its first draw.
    this.bodies = new SpritePool(() =>
      worldSprite(scene, Layer.Shots, 0, BAKED_ATLAS).setOrigin(0.5, 0.5),
    );
    this.orbs = new SpritePool(() =>
      worldSprite(scene, Layer.Shots, 0, BAKED_ATLAS).setOrigin(0.5, 0.5),
    );
  }

  begin(): void {
    this.bodies.begin();
    this.orbs.begin();
  }

  /** One projectile: its baked body, at its extrapolated centre, turned to its heading. */
  body(frame: string, x: number, y: number, angle: number, scale: number): void {
    this.bodies.next().setFrame(frame).setPosition(x, y).setRotation(angle).setScale(scale);
  }

  /** One charge orb at a muzzle. Never rotated: a gathering orb has no heading. */
  orb(frame: string, x: number, y: number, scale: number): void {
    this.orbs.next().setFrame(frame).setPosition(x, y).setScale(scale);
  }

  end(): void {
    this.bodies.end();
    this.orbs.end();
  }

  destroy(): void {
    this.bodies.destroy();
    this.orbs.destroy();
  }
}
```

- [ ] **Step 2: Rewrite `ShotRenderer`**

The class keeps its constructor `(scene, debug)` and its `render(frame)`; its `shotGfx` field is renamed and re-scoped, and `renderShots`'s big loop splits in two. Substitutions against the file the preparation plan's Task 6 produced:

| Was | Becomes |
|---|---|
| the field `shotGfx` and its `this.scene.add.graphics().setDepth(SHOT_DEPTH)` line | `private readonly beams: Phaser.GameObjects.Graphics`, created as `this.scene.add.graphics().setDepth(depthOf(Layer.Shots, 1)).setName(WORLD_GFX_BEAMS)` — depth 1 inside the Shots band so a beam's polygon draws over the sprite bodies exactly as one shared `Graphics` used to draw over itself, and a `name` because `dev/BenchScene.ts`'s census allow-lists the world's surviving `Graphics` by name |
| the field initialisation | plus `private readonly sprites = new ShotSprites(scene);` and `private readonly unit = worldFrameScale(BAKE_SUPERSAMPLE[BAKE_DEFAULT_TIER]);` — V5 replaces the literal tier with its measured one, and nothing else in this file knows about supersampling |
| the whole `for (const instance of frame.instances)` body | the two methods below |
| `this.renderChargeOrbs(frame, gfx)` | `this.renderChargeOrbs(frame)` |
| `destroy()`'s `this.shotGfx?.destroy()` | `this.beams.destroy(); this.sprites.destroy();` |
| `const SHOT_DEPTH = -5` and its D7 comment | **deleted** — `LAYER_DEPTH` carries the depth and the D7 paragraph |

`render` becomes:

```ts
  /**
   * Every live weapon instance, drawn from the frame and nothing else.
   *
   * A projectile is a baked sprite: `render/bake.ts` ran `projectileDrawLayers` and
   * `glowBandsAtRest` once at boot, so this loop pays a transform per shot and no geometry at all.
   * A beam is not, and will not be until V3: its shape genuinely changes every frame, which is the
   * one thing R2 says may still build geometry.
   *
   * The honesty rule is unchanged (D19). A baked body is drawn at the size of its own hitbox — its
   * frame was baked to the hitbox's extents — and the glow flicker only ever shrinks it, so what a
   * player sees is still exactly what can hurt them.
   */
  render(frame: RenderFrame): void {
    const gfx = this.beams;
    gfx.clear();
    const nowMs = frame.nowMs;
    const elapsedMs = frame.sinceSnapshotMs;

    this.sprites.begin();
    for (const instance of frame.instances) {
      if (!instance.alive) continue;
      if (instance.kind === WeaponKind.BEAM) {
        this.drawBeam(instance, frame, elapsedMs, nowMs, gfx);
        continue;
      }
      const at = instanceDrawCentre(instance, elapsedMs);
      this.sprites.body(
        bakedShotFrame(instance.weaponId),
        at.x,
        at.y,
        instance.angle,
        // The flicker is a scale on the baked bands, never a rebuilt radius (Task 2). It is 1 for
        // every weapon with no glow style, which is every weapon but `magmablast` today.
        this.unit * glowFlickerScale(instance.weaponId, instance.spawnTick, nowMs),
      );
    }
    this.renderChargeOrbs(frame);
    this.sprites.end();

    // A SECOND pass, on purpose — unchanged from the shipped code except that it now shares the
    // beam layer's `Graphics` rather than the shot layer's. Outlining inside the loop above would
    // bury each shot's hitbox under the next shot's fill.
    //
    // What is outlined is exactly what the sim tests against — the same `WorldShape` the sprites'
    // frames were baked from — so this is the ground truth for D19, not a second opinion about it.
    if (hitboxesVisible(this.debug)) {
      gfx.lineStyle(HITBOX_PX, HITBOX_STROKE, 1);
      for (const instance of frame.instances) {
        if (!instance.alive) continue;
        const shape = instanceDrawShape(instance, elapsedMs);
        if (shape.kind === "circle") gfx.strokeCircle(shape.x, shape.y, shape.radius);
        else if (shape.points.length > 0) gfx.strokePoints(pts(shape.points), true);
      }
    }
  }
```

`drawBeam` is the beam half of today's loop, moved verbatim — the aura branch, the polygon branch with `beamDrawLayers` and its flat-fill fallback, and their comments, all unchanged. Two edits only: the `isProjectileWeapon(instance.weaponId) ? projectileDrawLayers(...) : beamDrawLayers(...)` ternary loses its projectile arm and becomes a plain `beamDrawLayers(...)` call (a `BEAM`-kind instance is never a projectile — `magmablast`'s detonation reaches the aura branch above it and returns), and the method takes `gfx` as a parameter:

```ts
  private drawBeam(
    instance: RenderInstance,
    frame: RenderFrame,
    elapsedMs: number,
    nowMs: number,
    gfx: Phaser.GameObjects.Graphics,
  ): void {
    // ... the aura branch, then the polygon branch, verbatim from renderShots ...
  }
```

`renderChargeOrbs` becomes:

```ts
  /**
   * The orb a wind-up weapon gathers at its muzzle before firing.
   *
   * Still a second pass over CARS rather than more work in the instance loop, because a charging
   * weapon has spawned nothing yet — `frame.instances` is empty for it until the wind-up ends,
   * which is exactly the window this draws. Everything it needs is already on the frame.
   *
   * Baked at `chargeOrbMaxRadius` and scaled by `chargeOrbRadius` (Task 2), so the growing
   * telegraph costs one transform instead of one `fillCircle` per band per frame.
   *
   * Deliberately NOT outlined by the hitbox pass above: a charge orb is the one thing the game
   * draws where there is no hitbox at all (D19's single exception).
   */
  private renderChargeOrbs(frame: RenderFrame): void {
    for (const car of frame.cars) {
      if (!car.onField || !car.alive) continue;
      if (car.lastFiredSlot < 0) continue;
      const slot = car.weapons[car.lastFiredSlot];
      if (!slot) continue;
      const orbFrame = bakedOrbFrame(slot.weaponId);
      if (!orbFrame) continue;
      const radius = chargeOrbRadius(slot.weaponId, car.pendingUntilTick, frame.tick);
      if (radius <= 0) continue;
      // The muzzle, not the car centre: the orb is the shot gathering where the shot will leave.
      const muzzle = muzzleOf(car.pose);
      this.sprites.orb(
        orbFrame,
        muzzle.x,
        muzzle.y,
        (this.unit * radius) / chargeOrbMaxRadius(slot.weaponId),
      );
    }
  }
```

Add to `shot-renderer.ts`:

```ts
import { BAKE_DEFAULT_TIER, BAKE_SUPERSAMPLE, bakedOrbFrame, bakedShotFrame, worldFrameScale } from "../../render/bake.js";
import { Layer, depthOf } from "../../render/layers.js";
import { ShotSprites } from "./shot-sprites.js";
import { HITBOX_PX, HITBOX_STROKE } from "./world-style.js";
import { chargeOrbMaxRadius, chargeOrbRadius, glowFlickerScale, instanceDrawCentre } from "../combat-visual.js";

/** The `name` the world's surviving `Graphics` carries, so the bench census can allow-list it. */
export const WORLD_GFX_BEAMS = "shots.beams";
```

and delete the now-unused imports of `instanceGlowBands`, `projectileDrawLayers` and `isProjectileWeapon` (the typecheck will name them).

- [ ] **Step 3: Update the client's own doc paragraph**

In `packages/client/CLAUDE.md`, the three-table paragraph ("Three tables own how a shot looks…") still says the client draws shots per frame. Replace its first sentence with:

```markdown
Three tables own how a shot looks, split by what the weapon's hitbox is, and each returns `[]` for a
weapon it does not own so the flat `weaponFillOf` fill stays the fallback. **They run once, at boot**:
`render/bake.ts` draws each projectile's body into one frame of `baked-atlas` and the arena then
draws a shot as a quad (`scenes/arena/shot-sprites.ts`). Beams are the exception and still build
their polygon every frame, because their shape genuinely changes — `beamDrawLayers` and the aura's
ring are the only per-frame `Graphics` fills left in the world.
```

Leave the rest of that paragraph, and the `predator` and `lance` paragraphs below it, exactly as they are: every word of them is about the tables, which are unchanged.

- [ ] **Step 4: Verify in a browser**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
cd packages/client && npm run typecheck && cd ../..
npm run dev
```

Open `http://localhost:5173/?dev=bench`. Every projectile on the ring should be drawn exactly as before: `thumper`'s cream band across its yellow hull, `predator`'s missile with its nose cone and fins, `magmablast`'s three-ring ramp, `pepperbox`'s flat dart, `roadblock`'s bar. Then, in the console:

```js
game.scene.getScene("bench").children.list.filter((o) => o.type === "Graphics").map((o) => o.name)
```

should print `["arena.floor", "shots.beams"]` and nothing else on the shot side. Open a real match with `?debug=1` and confirm the outlines still land on the sprites — that is the check that `instanceDrawCentre` really is shared.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/scenes/arena/shot-sprites.ts \
  packages/client/src/scenes/arena/shot-renderer.ts packages/client/CLAUDE.md
git commit -m "perf(client): draw projectiles, glows and charge orbs as baked sprites

Moves no playtest probe number: the drawn shapes are identical (bake.test.ts pins the baked
geometry against the same builders) and no sim, table, tick order or prediction code is touched."
```

---

### Task 6: Hp bars, brackets, ghosts, arrows and silhouettes become sprites

**Files:**
- Create: `packages/client/src/scenes/arena/car-sprites.ts`
- Modify: `packages/client/src/scenes/arena/car-renderer.ts`
- Modify: `packages/client/src/render/layers.ts` (`worldContainer`)
- Modify: `packages/client/src/scenes/arena/arena-floor.ts` (`ARENA_DEPTH`, the floor's `name`)

**Interfaces:**
- Consumes: `Layer`, `CAR_BAND`, `depthOf`, `worldSprite`, `SpritePool` (Task 1); `hpBarAnchor` (Task 2); `HP_BAR_GEOMETRY`, `HP_BAR_BACK`, `HP_BAR_STEPS`, `hpBarStepIndex`, `easeHpFraction`, `LOCK_COLOR`, `ARROW_COLOR`, `ARROW_ALPHA`, `HITBOX_STROKE`, `HITBOX_NAME`, `PHASED_ALPHA` (Task 2); `BAKED_HP_BAR`, `BAKED_LOCK`, `BAKED_ARROW`, `BAKED_CAR_HITBOX`, `BAKED_CAR_OUTLINE_CHARGE`, `BAKED_CAR_OUTLINE_GHOST`, `bakedCarFrame`, `worldFrameScale` (Task 3); `artImage` (Task 4).
- Produces: `class CarDecor` (`scenes/arena/car-sprites.ts`); `worldContainer` (`render/layers.ts`); `WORLD_GFX_FLOOR` (`scenes/arena/arena-floor.ts`). `CarRenderer`'s constructor `(scene, debug)`, its `render(frame, cameraTargetSid): string[]`, `invalidateVisuals()` and `destroy()` are unchanged.

**The four `Graphics` this deletes, and what replaces each.** All four were `clear()`ed and refilled at the top of `renderCars` every frame (`ArenaScene.ts:1408-1420` before the preparation plan moved them):

| Deleted | Was | Becomes |
|---|---|---|
| `hpGfx` | 2 `fillPoints` per living car per frame | 2 sprites off `baked.world.hpbar`, tinted `HP_BAR_BACK` and `hpBarColor(allegiance)`, the fill's length quantised to `HP_BAR_STEPS` and eased toward the reported hp |
| `lockGfx` | 8 `beginPath`/`moveTo`/`lineTo`/`strokePath` calls | 1 sprite off `baked.world.lock`, tinted `LOCK_COLOR` |
| `arrowGfx` | 1 `fillPoints` triangle per frame during the countdown | 1 sprite off `baked.world.arrow`, tinted `ARROW_COLOR`, origin on its apex so its position is `countdownArrowPoints`' own apex |
| `maneuverGfx` | 1 or 3 `strokePoints` hull outlines per manoeuvring car | 1 or 3 sprites off the two `baked.world.car.outline.*` frames, tinted `wildcharge`'s gold or the car's own paint |

and two more that were not in the four, because they lived inside each car's container: the procedural `silhouette` `Graphics` and the always-built hitbox `Graphics`. Both become sprites too, which is what leaves `car-renderer.ts` naming no `Graphics` at all.

**Where this plan does not follow the spec's catalogue, and why.** §5 says dash ghosts become "3 copies of the body sprite at falling alpha, ADD layer". Two changes are folded into that sentence: a different *picture* (solid car copies instead of the wire outlines the game ships) and a different *blend*. V2's mandate is cost, not art, so the picture stays: the ghosts are the same hull outlines, baked. The blend stays too, and for a concrete reason — `ARENA_COLOR_DEFAULTS.floor` is `0xEBEBEB`, and an additive draw over near-white adds nothing, so ADD would not dim the ghosts, it would erase them. R4 is satisfied either way: the ghosts sit on the `Cars` band and take that band's blend rather than choosing one.

- [ ] **Step 1: Add `worldContainer` to `render/layers.ts`**

```ts
/**
 * A world container on a band.
 *
 * Children of a container inherit its depth and its blend mode, so a car's body sprite and its
 * hitbox box are placed by adding them here rather than by going through `worldSprite` — which is
 * the one legitimate exception to "worldSprite is the only way an object gets a depth", and the
 * reason it lives beside it instead of in a renderer.
 */
export function worldContainer(
  scene: Phaser.Scene,
  layer: Layer,
  offset: number,
): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0);
  container.setDepth(depthOf(layer, offset));
  container.setBlendMode(LAYER_BLEND[layer]);
  return container;
}
```

Add to `layers.test.ts`:

```ts
  it("puts a container on the same depth a sprite on that band would take", () => {
    // A pure check of the arithmetic the factory uses; the factory itself needs a scene.
    expect(depthOf(Layer.Cars, CAR_BAND.body)).toBe(LAYER_DEPTH[Layer.Cars]);
  });
```

- [ ] **Step 2: Write `scenes/arena/car-sprites.ts`**

```ts
// packages/client/src/scenes/arena/car-sprites.ts
import type Phaser from "phaser";
import { DRIVE_CONFIG, ManeuverKind, type SimBody } from "@motor-combat-moba/shared";
import { BAKED_ATLAS } from "../../render/atlas.js";
import {
  BAKED_ARROW,
  BAKED_CAR_OUTLINE_CHARGE,
  BAKED_CAR_OUTLINE_GHOST,
  BAKED_HP_BAR,
  BAKED_LOCK,
  BAKE_DEFAULT_TIER,
  BAKE_SUPERSAMPLE,
  worldFrameScale,
} from "../../render/bake.js";
import { CAR_BAND, Layer, worldSprite } from "../../render/layers.js";
import { SpritePool } from "../../render/sprite-pool.js";
import { carFillOf } from "../car-visual.js";
import { hpBarAnchor, hpBarColor, type Allegiance } from "../combat-visual.js";
import { dashGhostAlphas, dashGhostOffsets, dashGhostPose, maneuverOutline } from "../maneuver-visual.js";
import {
  ARROW_ALPHA,
  ARROW_COLOR,
  HP_BAR_BACK,
  HP_BAR_GEOMETRY,
  HP_BAR_STEPS,
  LOCK_COLOR,
  hpBarStepIndex,
} from "./world-style.js";

/**
 * Everything drawn AROUND a car — its hp bar, its lock bracket, its manoeuvre outlines and the
 * countdown arrow — as retained sprites off `baked-atlas`.
 *
 * Four `Graphics` objects used to be cleared and refilled here every frame, which meant Phaser
 * re-transformed and re-triangulated every one of their points per frame per camera (spec section
 * 1). Every shape they drew is the same picture at a different transform, so every one of them is
 * a baked frame now (R1). Each is baked WHITE and tinted at draw time, which is what lets one hp
 * bar frame serve the backing plate and both allegiances, and one outline frame serve six player
 * colours and `wildcharge`'s gold.
 *
 * A frame is `begin()`, calls, `end()`. The bracket and the arrow are single sprites rather than
 * pools because there is at most one of each on screen: the bracket follows the camera's subject
 * and the arrow marks the local car during the countdown.
 */
export class CarDecor {
  private readonly unit = worldFrameScale(BAKE_SUPERSAMPLE[BAKE_DEFAULT_TIER]);
  private readonly tracks: SpritePool<Phaser.GameObjects.Image>;
  private readonly fills: SpritePool<Phaser.GameObjects.Image>;
  private readonly ghosts: SpritePool<Phaser.GameObjects.Image>;
  private readonly bracket: Phaser.GameObjects.Image;
  private readonly arrow: Phaser.GameObjects.Image;
  private bracketUsed = false;
  private arrowUsed = false;

  constructor(scene: Phaser.Scene) {
    // The bar grows from its draining end, so the origin is that end and the length is `scaleY` —
    // see `hpBarAnchor`. The backing plate never changes tint or length, so both are set once.
    this.tracks = new SpritePool(() =>
      worldSprite(scene, Layer.Cars, CAR_BAND.hpBar, BAKED_ATLAS, BAKED_HP_BAR)
        .setOrigin(0.5, 0)
        .setTint(HP_BAR_BACK)
        .setAlpha(0.85),
    );
    this.fills = new SpritePool(() =>
      worldSprite(scene, Layer.Cars, CAR_BAND.hpBar, BAKED_ATLAS, BAKED_HP_BAR).setOrigin(0.5, 0),
    );
    this.ghosts = new SpritePool(() =>
      worldSprite(scene, Layer.Cars, CAR_BAND.ghost, BAKED_ATLAS, BAKED_CAR_OUTLINE_GHOST).setOrigin(0.5, 0.5),
    );
    this.bracket = worldSprite(scene, Layer.Cars, CAR_BAND.bracket, BAKED_ATLAS, BAKED_LOCK)
      .setOrigin(0.5, 0.5)
      .setScale(this.unit)
      .setTint(LOCK_COLOR)
      .setAlpha(0.9);
    // Origin on the APEX, which is what `countdownArrowPoints` positions: the arrow points DOWN at
    // the car, so its position is the car's `y - ARROW_GAP_PX + bob` and nothing has to be derived.
    this.arrow = worldSprite(scene, Layer.Cars, CAR_BAND.arrow, BAKED_ATLAS, BAKED_ARROW)
      .setOrigin(0.5, 1)
      .setScale(this.unit)
      .setTint(ARROW_COLOR)
      .setAlpha(ARROW_ALPHA);
  }

  begin(): void {
    this.tracks.begin();
    this.fills.begin();
    this.ghosts.begin();
    this.bracketUsed = false;
    this.arrowUsed = false;
  }

  /**
   * One car's hp bar: the backing plate at full length, the remaining hp over it, both riding in
   * the car's own frame so they turn with the chassis.
   *
   * `fraction` is the EASED value the caller keeps; `hpBarStepIndex` quantises it so the length is
   * one of `HP_BAR_STEPS` and the ease writes at most that many times instead of once per frame.
   * Length is the whole of the health channel; colour says allegiance and nothing else (D1).
   */
  hpBar(pose: SimBody, fraction: number, allegiance: Allegiance): void {
    const anchor = hpBarAnchor(pose, HP_BAR_GEOMETRY);
    this.tracks
      .next()
      .setPosition(anchor.x, anchor.y)
      .setRotation(pose.angle)
      .setScale(this.unit, this.unit);
    const step = hpBarStepIndex(fraction);
    // An empty bar shows the plate and nothing over it, exactly as the two `fillPoints` did.
    if (step <= 0) return;
    this.fills
      .next()
      .setPosition(anchor.x, anchor.y)
      .setRotation(pose.angle)
      .setScale(this.unit, (this.unit * step) / HP_BAR_STEPS)
      .setTint(hpBarColor(allegiance));
  }

  /**
   * The wild-charge outline and the thunderclap dash streak: two render-only reads of the pose's
   * `maneuver` field, drawn for every car including remotes and the spectated one.
   *
   * `maneuverOutline` / `dashGhostAlphas` / `dashGhostOffsets` / `dashGhostPose` still do all the
   * deciding; this only turns their answers into transforms. A charging car gets one outline in
   * `wildcharge`'s own colour; a dashing car gets three ghosts in the car's OWN paint, so the streak
   * reads as "this car, a moment ago" rather than as a second weapon effect.
   */
  maneuver(pose: SimBody, colorId: number): void {
    const outline = maneuverOutline(pose.maneuver);
    if (outline) {
      this.ghosts
        .next()
        .setFrame(BAKED_CAR_OUTLINE_CHARGE)
        .setPosition(pose.x, pose.y)
        .setRotation(pose.angle)
        .setScale(this.unit)
        .setAlpha(1)
        .setTint(outline.color);
      return;
    }
    if (pose.maneuver !== ManeuverKind.DASH) return;
    const fill = carFillOf(colorId);
    const alphas = dashGhostAlphas();
    const offsets = dashGhostOffsets();
    for (let i = 0; i < alphas.length; i++) {
      const ghost = dashGhostPose(pose, pose.maneuverAngle, offsets[i]!);
      this.ghosts
        .next()
        .setFrame(BAKED_CAR_OUTLINE_GHOST)
        .setPosition(ghost.x, ghost.y)
        .setRotation(ghost.angle)
        .setScale(this.unit)
        .setAlpha(alphas[i]!)
        .setTint(fill);
    }
  }

  /** The corner bracket around the camera subject's locked target. Unrotated, like the hp bar. */
  lockBracket(x: number, y: number): void {
    this.bracket.setPosition(x, y).setVisible(true);
    this.bracketUsed = true;
  }

  /** The countdown marker over the local car. `y` is the apex, bob included. */
  countdownArrow(x: number, y: number): void {
    this.arrow.setPosition(x, y).setVisible(true);
    this.arrowUsed = true;
  }

  end(): void {
    this.tracks.end();
    this.fills.end();
    this.ghosts.end();
    // The marker going away is a hidden sprite, which is the retained equivalent of the absence of
    // a draw call the cleared `Graphics` used to be: no fade, nothing to cancel (D4).
    if (!this.bracketUsed) this.bracket.setVisible(false);
    if (!this.arrowUsed) this.arrow.setVisible(false);
  }

  destroy(): void {
    this.tracks.destroy();
    this.fills.destroy();
    this.ghosts.destroy();
    this.bracket.destroy();
    this.arrow.destroy();
  }
}

/** The hull's size, for the silhouette and hitbox sprites `car-renderer.ts` builds per car. */
export const HULL = { width: DRIVE_CONFIG.carWidth, height: DRIVE_CONFIG.carHeight } as const;
```

- [ ] **Step 3: Rewrite the `Graphics` out of `CarRenderer`**

Substitutions against the file the preparation plan's Task 5 produced:

| Was | Becomes |
|---|---|
| the fields `hpGfx`, `lockGfx`, `arrowGfx`, `maneuverGfx` and their four `this.scene.add.graphics().setDepth(...)` lines | one field: `private readonly decor = new CarDecor(scene);` |
| the four `?.clear()` calls at the top of `render` and their comments | `this.decor.begin();` — the comment about the arrow going away moves onto `CarDecor.end` |
| `private drawHpBar(gfx, player, pose, allegiance)` and `private drawManeuverVisuals(gfx, player, pose)` | **deleted**; their doc comments move onto `CarDecor.hpBar` and `CarDecor.maneuver` |
| `private drawCountdownArrow(gfx, frame, pose)` | keeps its two guards and its doc comment, and its body becomes `this.decor.countdownArrow(pose.x, pose.y - ARROW_GAP_PX + arrowBobOffset(performance.now()));` — the same three numbers `countdownArrowPoints` used to compute its apex from |
| the lock-bracket block's `lock.lineStyle(...)` and its eight-call loop | `this.decor.lockBracket(at.x, at.y);` — the `SHOW_LOCK_BRACKET && at` guard is unchanged |
| `if (hp && player.alive) { ... this.drawHpBar(...) }` | the eased-hp block below |
| `if (maneuver && player.alive) this.drawManeuverVisuals(maneuver, player, pose);` | `if (car.alive) this.decor.maneuver(pose, car.colorId);` |
| `silhouette(carId, fill, w, h)` returning a `Graphics` | returns an `Image`: see below |
| the hitbox `const box = this.scene.add.graphics(); box.lineStyle(...); box.strokeRect(...)` block | the `Image` below; its whole "always BUILT and toggled by visibility" comment is unchanged and still true |
| `syncCar`'s `if (box instanceof Phaser.GameObjects.Graphics)` | `if (box instanceof Phaser.GameObjects.Image)` |
| `this.scene.add.container(0, 0)` in `drawCar`, and its `container.setDepth(CAR_DEPTH)` line | `worldContainer(this.scene, Layer.Cars, CAR_BAND.body)` — one call, and the depth comment moves to `CAR_BAND` |
| `this.spriteFor`'s `this.scene.add.image(0, 0, resolved.key)` | `artImage(this.scene, 0, 0, resolved.key)` |
| `destroy()`'s four `?.destroy()` lines | `this.decor.destroy();` |
| the constants `HP_BAR_GEOMETRY`, `HP_BAR_BACK`, `LOCK_COLOR`, `LOCK_WIDTH`, `ARROW_COLOR`, `ARROW_ALPHA`, `DASH_GHOST_WIDTH`, `PHASED_ALPHA`, `HITBOX_*` and the depth block | **deleted** — imported from `./world-style.js` and `../../render/layers.js` (Task 2 moved them) |

The two replaced bodies in full:

```ts
  /** The procedural chassis, as a baked frame tinted to the player's colour. */
  private silhouette(carId: string, fill: number): Phaser.GameObjects.Image {
    // Baked white, so a MULTIPLY tint IS the fill: one frame per shape serves every colour in
    // `COLOR_TABLE`, where a `Graphics` needed its colour re-filled into the path.
    return this.scene.add
      .image(0, 0, ...bakedFrame(bakedCarFrame(carId)))
      .setScale(this.unit)
      .setTint(fill);
  }
```

```ts
    // The hitbox is the OBB the sim actually collides with, which is not the drawn silhouette for
    // bullseye or bastion. Hidden in ordinary play so a player sees the shape, not the box.
    //
    // Always BUILT and toggled by visibility, never built conditionally: the playground can turn
    // this on mid-session, and a car container is only rebuilt when its `visualKeyOf` changes — so
    // a conditional build would leave every car already on the field boxless until it happened to
    // change colour or chassis. One always-hidden sprite per car is nothing; a stale one is a bug
    // report. It is the same rectangle for every chassis, which is why it is a baked frame rather
    // than a `Graphics` stroked per car.
    const box = this.scene.add.image(0, 0, ...bakedFrame(BAKED_CAR_HITBOX));
    box.setName(HITBOX_NAME);
    box.setScale(this.unit);
    box.setTint(HITBOX_STROKE);
    box.setVisible(hitboxesVisible(this.debug));
    container.add(box);
```

and the eased hp block inside `render`'s per-car loop, replacing the `if (hp && player.alive)` block:

```ts
      if (car.alive) {
        const allegiance = viewer ? allegianceOf(viewer, { sessionId, team: car.team }, mode) : "enemy";
        // The bar eases toward the reported hp instead of snapping to it, so a hit reads as damage
        // draining rather than as a bar that was always shorter. Purely visual: `car.hp` is what
        // every other read uses, and a car whose bar is still draining is already dead if its hp is
        // 0. The first frame a car is seen starts AT its value, so joining mid-match does not play
        // a 400 ms drain of somebody else's damage.
        const target = hpFraction(car.hp, car.carId);
        const drawn = easeHpFraction(this.hpDrawn.get(sessionId) ?? target, target, deltaMs);
        this.hpDrawn.set(sessionId, drawn);
        this.decor.hpBar(pose, drawn, allegiance);
      }
```

with two new fields and one line at the top of `render`:

```ts
  /** The eased bar length per car, so a hit drains rather than jumps. Pruned with the car. */
  private readonly hpDrawn = new Map<string, number>();
  private lastNowMs = 0;
```

```ts
    // Milliseconds since the last drawn frame, from the frame's own clock rather than Phaser's, so
    // the ease runs on the same timebase everything else in the frame does. Clamped, because a tab
    // that was backgrounded must not drain every bar in one step.
    const deltaMs = this.lastNowMs === 0 ? 0 : Math.min(100, frame.nowMs - this.lastNowMs);
    this.lastNowMs = frame.nowMs;
```

`this.hpDrawn.delete(sessionId)` goes beside every existing `this.visualKeys.delete(sessionId)` — the death-fade branch and the departed sweep — so the map cannot outlive its cars. Add `this.decor.end();` as the last statement of `render`, before the `return departed`.

Add the imports:

```ts
import { BAKED_CAR_HITBOX, BAKE_DEFAULT_TIER, BAKE_SUPERSAMPLE, bakedCarFrame, bakedFrame, worldFrameScale } from "../../render/bake.js";
import { CAR_BAND, Layer, worldContainer } from "../../render/layers.js";
import { artImage } from "../../render/atlas.js";
import { CarDecor } from "./car-sprites.js";
import { ARROW_GAP_PX, arrowBobOffset } from "../countdown-arrow.js";
import { HITBOX_NAME, HITBOX_STROKE, PHASED_ALPHA, easeHpFraction } from "./world-style.js";
```

and the field `private readonly unit = worldFrameScale(BAKE_SUPERSAMPLE[BAKE_DEFAULT_TIER]);`.

- [ ] **Step 4: Name the floor, and hand its depth to the layer plan**

The arena floor is the one world `Graphics` that stays a `Graphics` and is **not** V3's. Two reasons it is not baked: it is drawn once at match start and never cleared, so it is not on the frame path at all; and a `DynamicTexture` big enough for it would be 2560 x 1440 at supersample 2, roughly 14 MB of VRAM, to save the re-walk of about forty points a frame. The floor is V5's territory (the "floor ambience" row), not V2's.

In `scenes/arena/arena-floor.ts` (V0's):

| Was | Becomes |
|---|---|
| `export const ARENA_DEPTH = -10;` and its comment | **deleted**; the one `setDepth(ARENA_DEPTH)` call becomes `setDepth(depthOf(Layer.Floor))` |
| the `scene.add.graphics()` line | `.setName(WORLD_GFX_FLOOR)` appended, so the census can allow-list it |

```ts
/** The `name` the arena floor's `Graphics` carries. See `WORLD_GFX_BEAMS` for why names exist. */
export const WORLD_GFX_FLOOR = "arena.floor";
```

- [ ] **Step 5: Verify in a browser**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
cd packages/client && npm run typecheck && cd ../..
npm run dev
```

Open `http://localhost:5173/?dev=bench`: six cars, each with an hp bar across its tail turning with the chassis, and a yellow bracket around the local car's target. Then a real match (`npm run dev`, Practice): take damage and watch the bar drain rather than jump; press wild charge on Bastion for the gold outline; dash with Mirage for the three ghosts; watch the countdown for the arrow. With `?debug=1`, every car's OBB box is still drawn.

In the console:

```js
game.scene.getScene("arena").children.list.filter((o) => o.type === "Graphics").map((o) => o.name)
```

must print exactly `["arena.floor", "shots.beams"]`.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/scenes/arena/car-sprites.ts packages/client/src/scenes/arena/car-renderer.ts \
  packages/client/src/render/layers.ts packages/client/src/render/layers.test.ts \
  packages/client/src/scenes/arena/arena-floor.ts
git commit -m "perf(client): hp bars, brackets, ghosts, arrows and silhouettes as baked sprites

Deletes hpGfx, lockGfx, arrowGfx and maneuverGfx; the world now holds two Graphics objects, the
floor (drawn once) and the beam layer (V3's).

Moves no playtest probe number: no sim, table, tick order or prediction code is touched. The hp bar
gains a purely visual ease toward the reported hp; PlayerState.hp is unchanged and is still what
every non-drawing read uses."
```

---
