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

### Task 7: Measure it, guard it, write it down

**Files:**
- Create: `scripts/world-retained.test.mjs`
- Modify: `packages/client/src/dev/BenchScene.ts` (the census on `window.__bench`)
- Modify: `scripts/bench-arena.mjs`, `scripts/bench-arena.test.mjs`
- Modify: `docs/render-bench.md`, `CLAUDE.md`, `packages/client/CLAUDE.md`, `docs/project-structure.md`

**Interfaces:**
- Consumes: V0's `BenchProbe`, `window.__bench`, `formatBenchRows`, `BENCH_ARENA_DEFAULTS`, `PerfReport.drawCalls`; V1's `sceneCensus`, `SceneCensus`, `BenchProbe.census()`, `formatCensusRow`, `HUD_SCENE_KEY`; Task 5's `WORLD_GFX_BEAMS`; Task 6's `WORLD_GFX_FLOOR`.
- Produces: `SceneCensus.worldGraphicsNames`, `SceneCensus.worldClears`, `UNNAMED_GRAPHICS` (`dev/BenchScene.ts`); `DRAW_CALL_CEILING`, `WORLD_GRAPHICS_ALLOWED`, `WORLD_CLEARS_ALLOWED`, `DRAW_CALLS_UNAVAILABLE`, `benchFailures` and a widened `formatCensusRow` (`scripts/bench-arena.mjs`); `scripts/world-retained.test.mjs`. V3 tightens all three lists.

**How the two acceptance facts are checked without eyes.** The V2 gate is two sentences — "no
per-frame `Graphics` on the world path except beams and debug" and "draw calls ≤ 16 at the ceiling"
— and neither is a p95, so neither is read off a chart. Each is checked twice, the same way V1
checked its two:

1. **A source guard in `npm test`** (`scripts/world-retained.test.mjs`) — the world's own files may
   not name a `Graphics`, a `Text`, an immediate-mode fill, a blend mode or a bare depth. It catches
   the regression at the moment it is typed, in the suite everyone runs, and it is the only one of
   the two that runs without a browser.
2. **A live census in `npm run bench:arena`** — the bench walks every active scene's display list,
   counts objects by type, **names** every world `Graphics` it finds, and counts how many times each
   one `clear()`ed per rendered frame. Three of those become hard failures that exit 1. This is the
   one that cannot be fooled by a re-export or a dynamic `add`: it counts what the renderer actually
   holds while it is being measured.

**Why the guard counts CLEARS, not `Graphics` objects.** V2 deliberately leaves two `Graphics` in
the world and they are not the same kind of thing. The arena floor is drawn **once** at match start
and never touched again — retained, by R3's own definition, and costing one draw call for the life of
the match. The beam layer is cleared and refilled every frame, which is exactly what R3 forbids and
exactly what V3 deletes. A guard that counted objects would have to allow both and could then not
tell a third one apart from the floor; a guard that counts clears allows the floor to exist while
failing anything else that refills itself, **including a repaint of the floor**. That is why the
census carries `worldClears` keyed by object name and not a single number.

**The draw-call arithmetic this is checking.** Bottom to top at the bench ceiling, with the batch
breaking wherever the texture changes:

| Band | What is in it | Texture | Draw calls |
|---|---|---|---|
| `Floor` | `arena.floor`, drawn once | none (`Graphics`) | 1 |
| `Shots` | every projectile body and charge orb | `baked-atlas` | 1 |
| `Shots` +1 | `shots.beams` — 12 flames and 2 bolts | none (`Graphics`) | 1–3, depending on how often the flame's triangle count overruns Phaser's batch |
| `Cars` | six car bodies, each in its own container | `art-atlas` | 1 — or up to 6 if some chassis have art and some fall back to the baked silhouette, because the texture then alternates per car |
| `Cars` band offsets | hp bars, bracket, ghosts, arrow | `baked-atlas` | 1 |
| H0–H2 | the HUD's chrome and its text | `baked-atlas`, `hud-font` | 2–4 (V1's number) |

**7–13 at the ceiling, against a limit of 16.** The two places it can go wrong are both visible in
the row above: a mixed car roster costs up to five extra calls, and a `setBlendMode` anywhere in the
world flushes the batch on every object that carries it — which is the concrete reason R4 forbids
per-object blends and `world-retained.test.mjs` greps for them. If the printed number is over 16,
read the census row first: the object count says which band grew.

- [ ] **Step 1: Write the source guard**

```js
// scripts/world-retained.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientSrc = path.join(rootDir, "packages", "client", "src");
const arenaDir = path.join(clientSrc, "scenes", "arena");

/**
 * The world's retained sources: after V2 every shape they put on screen is a frame out of
 * `baked-atlas` or `art-atlas`, placed, rotated, scaled and tinted, and nothing they own is
 * cleared and refilled. This is `scripts/hud-retained.test.mjs` one scene over.
 */
const WORLD_RETAINED = [
  "scenes/ArenaScene.ts",
  "scenes/arena/car-renderer.ts",
  "scenes/arena/car-sprites.ts",
  "scenes/arena/shot-sprites.ts",
  "scenes/arena/hitbox-toggle.ts",
  "scenes/arena/spectate-camera.ts",
  "scenes/arena/world-style.ts",
];

/**
 * The two files allowed to hold a world `Graphics`, and the `name` each one's object carries.
 *
 * The names are the contract between this guard and the live census in `scripts/bench-arena.mjs`:
 * the runner allow-lists exactly these two strings, so a `Graphics` that reaches the screen under
 * any other name fails there even though this file cannot see it. Both halves are needed, which is
 * why the constant's VALUE is asserted below and not just its presence.
 */
const WORLD_GRAPHICS_ALLOWED = {
  "scenes/arena/arena-floor.ts": "arena.floor",
  "scenes/arena/shot-renderer.ts": "shots.beams",
};

/**
 * Debug overlays, which are allowed everything: spec section 4's layer 7 is `Graphics` by design
 * and R3's rule ends "except behind a debug flag". Nothing here is on a match's frame path — the
 * netgraph exists only under `?debug=net` — so the census never sees one either.
 *
 * Listed rather than pattern-matched so a new overlay has to be added on purpose. A file named here
 * that does not exist yet is skipped: `netgraph-overlay.ts` arrives with the netcode stream's phase
 * 0, and the two streams merge independently.
 */
const WORLD_DEBUG_ALLOWED = ["scenes/arena/netgraph-overlay.ts"];

/**
 * Immediate-mode drawing, canvas text, per-object blends and bare depths — the four things the
 * world may no longer do.
 *
 * A `Graphics` is re-transformed and re-triangulated every frame per camera whether or not it was
 * refilled, and `FillPath` runs earcut per fill with nothing cached (rendering spec section 1). A
 * per-object `setBlendMode` flushes the batch, which is R4's whole point: the band owns the blend
 * and `render/layers.ts` applies it once at creation. A bare `setDepth` is a layer whose position
 * is an accident of insertion order, which is what `depthOf` exists to stop.
 */
const FORBIDDEN = [
  [/\badd\.graphics\b/, "add.graphics — bake the shape in render/bake.ts and place a worldSprite"],
  [/\bGameObjects\.Graphics\b/, "a Graphics field — the world is retained sprites"],
  [/\badd\.text\b/, "add.text — the world draws no strings; HudScene owns text"],
  [/\bGameObjects\.Text\b/, "a Text field — the world draws no strings"],
  [/\.fill(Circle|Rect|Ellipse|RoundedRect|Points|Triangle)\(/, "an immediate-mode fill"],
  [/\.stroke(Circle|Rect|Points|Path)\(/, "an immediate-mode stroke"],
];

/** Forbidden everywhere in the world, including the two files that may hold a `Graphics`. */
const FORBIDDEN_EVERYWHERE = [
  [/\.setBlendMode\(/, "setBlendMode — the band owns the blend (R4); use a Layer, not a mode"],
  [/\.setDepth\((?!depthOf\()/, "a bare setDepth — every world depth comes from depthOf(Layer…)"],
];

/** `null` for a file this tree does not have yet; see `WORLD_DEBUG_ALLOWED`. */
function readIfPresent(relative) {
  const abs = path.join(clientSrc, relative);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function hits(source, rules) {
  return rules.filter(([pattern]) => pattern.test(source)).map(([, why]) => why);
}

describe("the world is retained", () => {
  for (const relative of WORLD_RETAINED) {
    it(`${relative} draws no Graphics and no Text`, () => {
      const source = readIfPresent(relative);
      assert.notEqual(source, null, `${relative} is missing`);
      assert.deepEqual(hits(source, FORBIDDEN), []);
    });
  }

  for (const relative of [...WORLD_RETAINED, ...Object.keys(WORLD_GRAPHICS_ALLOWED)]) {
    it(`${relative} sets no blend mode and no bare depth`, () => {
      const source = readIfPresent(relative);
      assert.notEqual(source, null, `${relative} is missing`);
      assert.deepEqual(hits(source, FORBIDDEN_EVERYWHERE), []);
    });
  }
});

describe("the two world Graphics V2 leaves behind", () => {
  for (const [relative, name] of Object.entries(WORLD_GRAPHICS_ALLOWED)) {
    it(`${relative} creates exactly one Graphics and names it "${name}"`, () => {
      const source = readIfPresent(relative);
      assert.notEqual(source, null, `${relative} is missing`);
      assert.equal((source.match(/\badd\.graphics\b/g) ?? []).length, 1);
      assert.match(source, /\.setName\(WORLD_GFX_[A-Z]+\)/);
      // The name the census allow-lists, pinned at its definition rather than at its use.
      assert.match(source, new RegExp(`WORLD_GFX_[A-Z]+ = "${name.replace(/\./g, "\\.")}"`));
    });
  }
});

describe("the guard covers the whole world", () => {
  it("names every arena source that exists, so a new file cannot sidestep it", () => {
    const known = new Set([
      ...WORLD_RETAINED,
      ...Object.keys(WORLD_GRAPHICS_ALLOWED),
      ...WORLD_DEBUG_ALLOWED,
    ]);
    const onDisk = fs
      .readdirSync(arenaDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => `scenes/arena/${f}`);
    assert.deepEqual(
      onDisk.filter((f) => !known.has(f)),
      [],
    );
  });

  it("keeps setBlendMode to the one file that owns it", () => {
    const layers = fs.readFileSync(path.join(clientSrc, "render", "layers.ts"), "utf8");
    assert.match(layers, /\.setBlendMode\(LAYER_BLEND\[layer\]\)/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `node --test scripts/world-retained.test.mjs`
Expected: PASS after Tasks 5 and 6. If a case fails, the named file still holds a `Graphics`, a
blend mode or a bare depth and the task that was meant to remove it is not finished — fix the
source, never the list.

- [ ] **Step 3: Extend the census in `dev/BenchScene.ts`**

V1's `SceneCensus` gains two fields and the module gains a clear counter. Everything V1 wrote stays;
the substitutions are additive.

Widen the interface:

```ts
/** What the renderer is actually holding, counted off the live display lists. */
export interface SceneCensus {
  /** Every `Text` in every active scene. V1's acceptance number: 0. */
  text: number;
  /** `Graphics` in the HUD scene. V1's other acceptance number: 0. */
  hudGraphics: number;
  /** `Graphics` outside the HUD scene. V2 leaves two; V3 leaves one. */
  worldGraphics: number;
  /**
   * The `name` of each of them, sorted — `"(unnamed)"` for one that carries none.
   *
   * The count alone cannot say whether the two that survived are the two that were meant to, and a
   * regression usually ADDS an object rather than replacing one. The names are what let the runner
   * fail with "world Graphics cars.hp" instead of "3 (expected 2)".
   */
  worldGraphicsNames: string[];
  /**
   * `Graphics.clear()` calls per rendered frame, by object name, since the previous census.
   *
   * This is the number the V2 gate is actually about. A `Graphics` that never clears was drawn once
   * and is retained (the arena floor); one that clears every frame is immediate-mode drawing. Only
   * `shots.beams` may appear here, and V3 empties the list.
   */
  worldClears: Record<string, number>;
  bitmapText: number;
  images: number;
  total: number;
}

/** A `Graphics` with no `name`, so an offender is reported rather than counted as blank. */
export const UNNAMED_GRAPHICS = "(unnamed)";
```

Add the counter above `sceneCensus`:

```ts
/** Clears since the previous census, by object name, and the frames they were spread over. */
const graphicsClears = new Map<string, number>();
let framesSinceCensus = 0;
let clearCounterInstalled = false;

/**
 * Count every `Graphics.clear()` in the game, by the object's `name`.
 *
 * A prototype patch rather than a wrapper per object, because the point is to catch a `Graphics`
 * nobody wrote down — one added by a future renderer, or by a library — and a wrapper can only
 * count the ones somebody remembered to wrap. It lives in `dev/BenchScene.ts`, which
 * `scripts/build-release.mjs` asserts is absent from a release, so no shipped build carries it.
 *
 * It counts the HUD's clears too. That is harmless: `hudGraphics` is already 0 and failing, so a
 * HUD `Graphics` is reported by the check above before this one can be confused by it. Only the
 * bench and the HUD scene are running while the census is read.
 */
function installClearCounter(): void {
  if (clearCounterInstalled) return;
  clearCounterInstalled = true;
  const proto = Phaser.GameObjects.Graphics.prototype;
  const original = proto.clear;
  proto.clear = function countedClear(this: Phaser.GameObjects.Graphics) {
    const key = this.name || UNNAMED_GRAPHICS;
    graphicsClears.set(key, (graphicsClears.get(key) ?? 0) + 1);
    return original.call(this);
  };
}
```

and read the counter in `sceneCensus`, whose signature is unchanged so `window.__bench.census()` and
`formatCensusRow` need no edit at their ends:

```ts
export function sceneCensus(game: Phaser.Game): SceneCensus {
  const out: SceneCensus = {
    text: 0,
    hudGraphics: 0,
    worldGraphics: 0,
    worldGraphicsNames: [],
    worldClears: {},
    bitmapText: 0,
    images: 0,
    total: 0,
  };
  for (const scene of game.scene.getScenes(true)) {
    const hud = scene.scene.key === HUD_SCENE_KEY;
    for (const obj of scene.children.list) {
      out.total += 1;
      if (obj.type === "Text") out.text += 1;
      else if (obj.type === "Graphics") {
        if (hud) out.hudGraphics += 1;
        else {
          out.worldGraphics += 1;
          out.worldGraphicsNames.push(obj.name || UNNAMED_GRAPHICS);
        }
      } else if (obj.type === "BitmapText") out.bitmapText += 1;
      else if (obj.type === "Image" || obj.type === "NineSlice") out.images += 1;
    }
  }
  out.worldGraphicsNames.sort();
  // A rate, so one census over ten seconds and one over one second answer the same thing. The
  // window is "since the previous census", which for the runner's single call is the whole run.
  const frames = Math.max(1, framesSinceCensus);
  for (const [name, count] of graphicsClears) out.worldClears[name] = count / frames;
  graphicsClears.clear();
  framesSinceCensus = 0;
  return out;
}
```

Two calls in the scene itself: `installClearCounter();` as the first statement of
`BenchScene.create`, and `framesSinceCensus += 1;` as the last statement of `BenchScene.update`,
after `perf.frameEnd()` — a frame the renderers did not finish is not a frame the clears belong to.
Since `framesSinceCensus` is module-scoped, add the one-line helper beside the counter rather than
reaching into it from the class:

```ts
/** One rendered frame, for the clear RATE. Called at the end of `BenchScene.update`. */
function noteRenderedFrame(): void {
  framesSinceCensus += 1;
}
```

> The census walks each scene's **top-level** display list, so a `Graphics` hidden inside a
> `Container` would not be counted. Nothing puts one there — after Task 6 a car's container holds
> two `Image`s — and `world-retained.test.mjs` is what keeps it that way, which is the division of
> labour between the two checks: the source guard sees what the census cannot reach, and the census
> sees what the source guard cannot prove.

- [ ] **Step 4: Write the failing test for the runner's new failures**

Append to `scripts/bench-arena.test.mjs`, extending its import from `./bench-arena.mjs` with
`DRAW_CALLS_UNAVAILABLE`, `DRAW_CALL_CEILING`, `benchFailures`, `formatCensusRow`,
`WORLD_CLEARS_ALLOWED` and `WORLD_GRAPHICS_ALLOWED`:

```js
/** The shape V2 is supposed to leave behind, as the census reports it. */
const CLEAN_CENSUS = {
  text: 0,
  hudGraphics: 0,
  worldGraphics: 2,
  worldGraphicsNames: ["arena.floor", "shots.beams"],
  worldClears: { "shots.beams": 1 },
  bitmapText: 41,
  images: 96,
  total: 139,
};
const CLEAN_REPORT = { drawCalls: { p50: 9, max: 11 } };

describe("benchFailures", () => {
  it("passes the shape V2 leaves behind", () => {
    assert.deepEqual(benchFailures("chromium", CLEAN_CENSUS, CLEAN_REPORT), []);
    assert.deepEqual(WORLD_GRAPHICS_ALLOWED, ["arena.floor", "shots.beams"]);
    assert.deepEqual(WORLD_CLEARS_ALLOWED, ["shots.beams"]);
    assert.equal(DRAW_CALL_CEILING, 16);
  });

  it("fails a world Graphics nobody allowed, and names it", () => {
    const census = {
      ...CLEAN_CENSUS,
      worldGraphics: 3,
      worldGraphicsNames: ["arena.floor", "cars.hp", "shots.beams"],
    };
    assert.deepEqual(benchFailures("chromium", census, CLEAN_REPORT), [
      "chromium: world Graphics cars.hp (allowed: arena.floor, shots.beams)",
    ]);
  });

  it("fails a Graphics that refills itself even when the object itself is allowed", () => {
    const census = { ...CLEAN_CENSUS, worldClears: { "arena.floor": 1, "shots.beams": 1 } };
    assert.deepEqual(benchFailures("chromium", census, CLEAN_REPORT), [
      'chromium: "arena.floor" cleared 1.00 times per frame (only shots.beams may clear)',
    ]);
  });

  it("fails the draw-call ceiling on p50, and reports the number that failed", () => {
    assert.deepEqual(benchFailures("firefox", CLEAN_CENSUS, { drawCalls: { p50: 17, max: 22 } }), [
      "firefox: 17 draw calls at the ceiling (must be <= 16)",
    ]);
    // Exactly at the line passes, and a single spiking frame is reported but not fatal.
    assert.deepEqual(benchFailures("firefox", CLEAN_CENSUS, { drawCalls: { p50: 16, max: 40 } }), []);
  });

  it("does not fail a Canvas run, which counts no draw calls at all", () => {
    const canvas = { drawCalls: { p50: DRAW_CALLS_UNAVAILABLE, max: DRAW_CALLS_UNAVAILABLE } };
    assert.deepEqual(benchFailures("firefox", CLEAN_CENSUS, canvas), []);
  });

  it("still catches V1's two", () => {
    assert.deepEqual(benchFailures("chromium", { ...CLEAN_CENSUS, text: 2 }, CLEAN_REPORT), [
      "chromium: 2 Text objects in the arena (must be 0)",
    ]);
    assert.deepEqual(benchFailures("chromium", { ...CLEAN_CENSUS, hudGraphics: 1 }, CLEAN_REPORT), [
      "chromium: 1 Graphics in the HUD scene (must be 0)",
    ]);
  });
});

describe("formatCensusRow", () => {
  it("names the world's Graphics and their clear rates, so a failure says which object", () => {
    const line = formatCensusRow("chromium", CLEAN_CENSUS);
    assert.match(line, /worldGraphics\s+2/);
    assert.match(line, /world \[arena\.floor, shots\.beams\]/);
    assert.match(line, /clears \[shots\.beams 1\.00\/f\]/);
  });

  it("says so when nothing cleared at all — which is what V3 looks like", () => {
    assert.match(formatCensusRow("firefox", { ...CLEAN_CENSUS, worldClears: {} }), /clears \[none\]/);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `node --test scripts/bench-arena.test.mjs`
Expected: FAIL — `benchFailures` is not exported.

- [ ] **Step 6: Extend `scripts/bench-arena.mjs`**

Beside `BENCH_ARENA_DEFAULTS`:

```js
/**
 * The acceptance ceiling on draw calls at the ceiling scene, world plus HUD (rendering spec R25).
 *
 * Asserted on p50, not on max: the first frames after the warm-up can bind a texture the steady
 * state does not, and one such frame is not a regression. `max` is printed beside it so a spike is
 * still visible to a person, which is the same division V0 drew between reported and asserted.
 */
export const DRAW_CALL_CEILING = 16;

/**
 * The world `Graphics` V2 leaves alive, by the `name` each carries: the arena floor, drawn once at
 * match start and never cleared, and the beam layer, which is V3's to delete. Any other name on the
 * display list is a `Graphics` somebody added without writing it down.
 */
export const WORLD_GRAPHICS_ALLOWED = ["arena.floor", "shots.beams"];

/**
 * The only world `Graphics` allowed to clear itself on the frame path. V3 empties this list, which
 * is the whole of its gate: "no per-frame `Graphics` on the world path except debug".
 */
export const WORLD_CLEARS_ALLOWED = ["shots.beams"];

/** `PERF_OVERLAY_CONFIG.drawCallsUnavailable`, restated: the Canvas renderer counts none. */
export const DRAW_CALLS_UNAVAILABLE = -1;

/**
 * Every hard failure the census and the report can produce, as messages.
 *
 * Pure and exported so `node --test` covers the decisions rather than the plumbing — the runner
 * below only collects what this returns. V1's two checks moved in here unchanged; V2 adds three.
 * Every one of them is exact on any machine, which is why they may exit 1 while a frame time,
 * which is not, is only ever printed.
 */
export function benchFailures(browser, census, report) {
  const out = [];
  if (census.text !== 0) {
    out.push(`${browser}: ${census.text} Text objects in the arena (must be 0)`);
  }
  if (census.hudGraphics !== 0) {
    out.push(`${browser}: ${census.hudGraphics} Graphics in the HUD scene (must be 0)`);
  }
  const strays = (census.worldGraphicsNames ?? []).filter(
    (name) => !WORLD_GRAPHICS_ALLOWED.includes(name),
  );
  if (strays.length > 0) {
    out.push(
      `${browser}: world Graphics ${strays.join(", ")} (allowed: ${WORLD_GRAPHICS_ALLOWED.join(", ")})`,
    );
  }
  for (const [name, perFrame] of Object.entries(census.worldClears ?? {})) {
    if (perFrame > 0 && !WORLD_CLEARS_ALLOWED.includes(name)) {
      out.push(
        `${browser}: "${name}" cleared ${perFrame.toFixed(2)} times per frame ` +
          `(only ${WORLD_CLEARS_ALLOWED.join(", ")} may clear)`,
      );
    }
  }
  const draws = report.drawCalls.p50;
  if (draws !== DRAW_CALLS_UNAVAILABLE && draws > DRAW_CALL_CEILING) {
    out.push(`${browser}: ${draws} draw calls at the ceiling (must be <= ${DRAW_CALL_CEILING})`);
  }
  return out;
}
```

Widen V1's `formatCensusRow` with a second line — the counts say how much, the names say what:

```js
/** Two lines per browser: what the renderer held while it was measured, and what refilled itself. */
export function formatCensusRow(browser, census) {
  const clears = Object.entries(census.worldClears ?? {})
    .map(([name, perFrame]) => `${name} ${perFrame.toFixed(2)}/f`)
    .sort();
  return (
    `${browser.padEnd(9)} text ${String(census.text).padStart(3)}  hudGraphics ${String(census.hudGraphics).padStart(3)}` +
    `  worldGraphics ${String(census.worldGraphics).padStart(3)}  bitmapText ${String(census.bitmapText).padStart(4)}` +
    `  images ${String(census.images).padStart(4)}\n` +
    `${" ".repeat(9)} world [${(census.worldGraphicsNames ?? []).join(", ")}]  ` +
    `clears [${clears.join(", ") || "none"}]`
  );
}
```

and in the runner, replace V1's two inline `if` statements with the one call — the `census` and
`report` are already read there:

| Was | Becomes |
|---|---|
| `if (census.text !== 0) failures.push(…)` and `if (census.hudGraphics !== 0) failures.push(…)` | `failures.push(...benchFailures(browser, census, report));` |

The `if (failures.length > 0) { … process.exitCode = 1; }` block at the end of `main` is V1's and is
unchanged.

- [ ] **Step 7: Run the whole thing and record the numbers**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
npm run bench:visual
npm run bench:arena
node -p "os.cpus()[0].model + ', ' + os.cpus().length + ' cores'"
git rev-parse --short HEAD
```

Expected: `bench:arena` prints its per-browser rows, then two two-line census blocks reading
`text 0`, `hudGraphics 0`, `worldGraphics 2`, `world [arena.floor, shots.beams]` and
`clears [shots.beams 1.00/f]`, with `draws p50` at or under 16 — and exits 0.

`npm run bench:visual` is expected to be **unchanged** by this phase in the sense that matters and
changed in the sense that does not: it times the pure builders, which V2 did not make slower or
faster, but three of them are now called through a thinner at-rest half (Task 2). Run it and record
it, so V3 — which does move those numbers, because `beamDrawLayers` is its whole subject — has a
figure taken after the split rather than before it.

If `draws p50` is over 16, do not raise `DRAW_CALL_CEILING`. Read the census's object counts against
the table at the head of this task: an `images` count that jumped says a pool grew, and a
`worldGraphics` over 2 says the guard should already have failed.

- [ ] **Step 8: Write the V2 section of `docs/render-bench.md`**

Append after the `## V1 — HUD` section, replacing each `(paste …)` with the real output —
`grep -c "(paste" docs/render-bench.md` must print `0` before the commit:

````markdown
## V2 — Bake

Every static world shape became a sprite. `render/bake.ts` runs `projectileDrawLayers`,
`glowBandsAtRest`, `chargeOrbBandsAtRest`, `hexagonPoints`, `hullOutlinePoints`, `lockBracketArms`
and `countdownArrowPoints` **once at boot** into `baked-atlas`; `scripts/pack-atlas.mjs` packs the
twelve authored PNGs into `art-atlas` at build time; `render/layers.ts` replaced the six scattered
depth constants with one banded plan. Deleted: `hpGfx`, `lockGfx`, `arrowGfx`, `maneuverGfx`, the
per-car silhouette and hitbox `Graphics`, and the projectile half of `shotGfx`. The world holds two
`Graphics` objects now — the floor, drawn once, and the beam layer, which is V3's.

`js` and `draw` are the buckets this phase moves; `sim` is 0 in the bench and always has been.

| Metric (`npm run bench:arena`) | V0 baseline | V1 | V2 |
|---|---|---|---|
| frame p50 / p95, Chromium | (paste) | (paste) | (paste) |
| js p50 / p95, Chromium | (paste) | (paste) | (paste) |
| draws p50 / max, Chromium | (paste) | (paste) | (paste) |
| frame p50 / p95, Firefox | (paste) | (paste) | (paste) |
| js p50 / p95, Firefox | (paste) | (paste) | (paste) |
| textures | (paste) | (paste) | (paste) |

Full output, and `npm run bench:visual` — which times the builders V2 moved off the frame path and
onto the boot path, so its numbers are now a **bake** cost rather than a frame cost:

```text
(paste both outputs)
```

### The census

`npm run bench:arena` now has five hard failures, and exits 1 on any of them: a `Text` anywhere, a
`Graphics` in the HUD scene, a world `Graphics` whose name is not `arena.floor` or `shots.beams`, a
world `Graphics` other than `shots.beams` that clears itself on the frame path, and a draw-call p50
over 16.

```text
(paste the two census blocks)
```

`scripts/world-retained.test.mjs` is the same guarantee at the source level and runs in `npm test`:
no world source may name a `Graphics`, a `Text`, an immediate-mode fill, a `setBlendMode` or a
`setDepth` that does not come from `depthOf`, and the two files that may hold a `Graphics` must
create exactly one each and name it.

### Boot cost

The atlas is bigger by sixteen world frames and the client now loads a packed art sheet before the
loose PNGs. Both are once-per-boot:

```text
(paste: the browser console's bake timing, and `performance.getEntriesByName` for art-atlas.png)
```

Machine: (paste). Commit: (paste).
````

- [ ] **Step 9: Update the prose that names the old code**

| File | Edit |
|---|---|
| `CLAUDE.md` (root) | In the Commands block, after the `npm run check:art` line, add the `pack:atlas` line below. In the **Art is the exception** section, after the paragraph that begins "`npm run check:art` is the guardrail for art that did **not** come through an importer", add the paragraph below. |
| `packages/client/CLAUDE.md` | Replace the paragraph that begins "**Adding detail to shots is cheap; four specific things are not.**" with the version below, and append the world-retained paragraph after it. |
| `docs/project-structure.md` | Five edits, listed below. |

For root `CLAUDE.md`'s Commands block:

```text
npm run pack:atlas     # repacks public/art/art-atlas.{png,json} from the loose PNGs (committed artefacts)
```

For root `CLAUDE.md`'s art section:

```markdown
**Repainting a PNG in place now owes one more command: `npm run pack:atlas`.** Every manifest sprite
is packed into `public/art/art-atlas.{png,json}` at build time and the client draws the packed frame,
falling back to the loose PNG only for a key the sheet has no row for. The atlas carries a
fingerprint of the source bytes; `npm run check:art` reports a mismatch as a **blocker** and
`scripts/check-art.test.mjs` runs the blockers inside `npm test`, so a stale sheet fails the suite
with the command to run rather than quietly shipping last week's icon. The importers still write the
loose PNG and the manifest row and do **not** repack — run `npm run pack:atlas` after an import too,
and commit both generated files.
```

For `packages/client/CLAUDE.md`, replacing the shot-detail paragraph:

```markdown
**Adding detail to shots is nearly free, and three specific things are not.** Shots are **baked
sprites**: `render/bake.ts` runs `projectileDrawLayers`, `glowBandsAtRest` and
`chargeOrbBandsAtRest` once at boot, draws each weapon's body into one frame of `baked-atlas`, and
`scenes/arena/shot-sprites.ts` draws a live shot as a quad — a position, a rotation, and, for a
weapon with a flicker or a wind-up, a scale. A band therefore costs atlas area once instead of one
`fillCircle` per shot per frame, and the fill count that used to be the budget is not a budget any
more. **Stop and warn before** a per-object `setBlendMode` (forbidden outright in the world:
`render/layers.ts` owns one blend per band, and a per-object mode flushes the batch — one draw call
becomes one per shot), a shape whose geometry genuinely changes per frame (that is a beam, and beams
are the one thing still allowed to build geometry), or a bake job whose tile does not fit the sheet
at tier Low, which `render/bake.test.ts` fails on. See
[How much detail a shot can afford](../../docs/asset-pipeline.md#how-much-detail-a-shot-can-afford).
`afterburner` is still the high-water mark and still the one to measure: a flame is 12 fills and
~1,040 vertices per instance, fires TWO instances per press, and a room of six Mirages all burning
is ~144 fills and 12,500 vertices a frame — all of it per frame, because a beam's shape changes.
**Fills were never the problem — the CPU geometry was.** The first cut of the jet cost 3.8 ms a
frame to build at that load, 23% of a 60fps budget for one weapon's cosmetics, and none of it was
where it looked: not the trig, not `Math.pow`, not the allocation. It was re-hashing the same handful
of noise values ~14 times each and calling through a closure per octave per station. Pre-sampling
each octave into a per-station array took it to 1.1 ms, bit-identical output. **So the number to
check a new authored beam against is `ms` to build one frame's worth at the realistic ceiling**, and
the way to check it is `npm run bench:visual`, not a guess. `carFillOf(colorId)` paints a car,
`weaponFillOf(weaponId)` paints every instance of a weapon — the same grey for every car's
`predator`, and only where a weapon has no entry in the three style tables. Drawing a shot needs no
owner lookup at all (the client never reads `ownerSessionId`), so do not reach for the shooter's
`PlayerState`; that route was deleted on purpose. `WEAPON_TABLE.color` is render-only and stays off
the wire.

**The world is retained too, and it holds exactly two `Graphics`.** `arena.floor` is drawn once at
match start and never cleared; `shots.beams` carries the beam polygons and the `?debug=1` hitbox
outlines, and is the last per-frame `Graphics` in the world. Everything else — projectile bodies,
glow bands, charge orbs, hp bars, lock brackets, dash ghosts, charge outlines, countdown arrows, car
silhouettes and hitbox boxes — is a sprite off `baked-atlas` or `art-atlas`, placed by
`render/layers.ts`'s `worldSprite`, which is the only thing in the world that assigns a depth or a
blend mode. Depths are bands (`Layer`, `LAYER_DEPTH`, `CAR_BAND`), never bare numbers, and a look
that needs additive goes on the Glow band rather than setting a mode.
`scripts/world-retained.test.mjs` fails the suite if a world source names a `Graphics`, a `Text`, an
immediate-mode fill, a `setBlendMode` or a `setDepth` that is not `depthOf(...)`, and
`npm run bench:arena` counts the live display lists, names every world `Graphics` and counts how
often each one clears, exiting non-zero on a stray or on a draw-call p50 over 16.
```

For `docs/project-structure.md`:

| Where | Edit |
|---|---|
| the `public/art/` block | add `art-atlas.png` and `art-atlas.json` under `manifest.json`, both commented `# generated by npm run pack:atlas, committed` |
| the top-level `scripts/` lines | add `scripts/pack-atlas.mjs` and `scripts/world-retained.test.mjs` beside V1's `scripts/build-bitmap-font.mjs` and `scripts/hud-retained.test.mjs` |
| the `render/` block (V1 added it) | add `layers.ts   # Layer/LAYER_DEPTH/CAR_BAND/depthOf/worldSprite: the world's bands` and `sprite-pool.ts # grow-once, order-based pool; zero allocation per frame` |
| the `scenes/arena/` block | add `world-style.ts  # every world paint constant, plus the hp bar's steps and ease (Phaser-free)`, `car-sprites.ts   # CarDecor: hp bars, bracket, ghosts, arrow as retained sprites` and `shot-sprites.ts  # ShotSprites: the projectile and orb pools` |
| the closing paragraph "Client tests run in the **node** environment and never import Phaser — `dev/registry.ts` and `assets/car-sprite.ts` reference it as `import type` only" | extend the list with `render/layers.ts`, `render/bake.ts` and `scenes/arena/world-style.ts`, and add `world-style` to the list of plain modules `ArenaScene`'s logic lives in |

- [ ] **Step 10: Full verification and commit**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
npm run typecheck
npm run build
npm run smoke:arena
npm run check:art
npm run build:release
grep -c "(paste" docs/render-bench.md
```

Expected: every suite green, including `scripts/world-retained.test.mjs`, `scripts/pack-atlas.test.mjs`,
`scripts/check-art.test.mjs` and `scripts/bench-arena.test.mjs`; typecheck clean; the build, the
smoke check and the release all succeed; `check:art` prints its `PACKED ATLAS` block as `current`;
`grep -c` prints `0`.

```bash
git add scripts/world-retained.test.mjs scripts/bench-arena.mjs scripts/bench-arena.test.mjs \
  packages/client/src/dev/BenchScene.ts \
  docs/render-bench.md CLAUDE.md packages/client/CLAUDE.md docs/project-structure.md
git commit -m "test(client): guard the retained world and record the V2 render numbers

Five hard failures in bench:arena now: a Text anywhere, a Graphics in the HUD scene, a world
Graphics that is not arena.floor or shots.beams, a world Graphics other than shots.beams that
clears itself per frame, and a draw-call p50 over 16.

Moves no playtest probe number: instrumentation, guards and docs only. No probe imports a client
scene, and nothing in this phase touches sim/, a balance table, the tick order, prediction or
step-context assembly."
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

---

## Acceptance

The spec's migration row (§10):

> | V2 Bake | `bake.ts`, `baked-atlas`, `pack-atlas.mjs`; projectiles, glows, orbs, hp bars, brackets, ghosts, arrows as sprites | `shotGfx` for projectiles, `hpGfx`, `lockGfx`, `arrowGfx`, `maneuverGfx` |

and the execution guide's gate row:

> | V2 | no per-frame `Graphics` on the world path except beams and debug; draw calls ≤ 16 at the ceiling |

| Number | How it is demonstrated |
|---|---|
| No per-frame `Graphics` on the world path except beams and debug | `npm run bench:arena` → the census block's `world [arena.floor, shots.beams]` and `clears [shots.beams 1.00/f]`, both checked in `benchFailures` and exiting 1 otherwise; and `npm test` → `scripts/world-retained.test.mjs`, which fails if a world source so much as names a `Graphics`, and which pins the two allowed files to one `add.graphics` each. Live: `game.scene.getScene("arena").children.list.filter(o => o.type === "Graphics").map(o => o.name)` is `["arena.floor", "shots.beams"]`. The floor is on the list but not on the *frame* path: it is drawn once at match start and never cleared, which is what `clears` measures and `arena.floor`'s absence from it proves. |
| Draw calls ≤ 16 at the ceiling | `npm run bench:arena` → the `draws p50 / max` column, with p50 asserted against `DRAW_CALL_CEILING` in `benchFailures` and the run exiting 1 above it. Skipped, not failed, on a Canvas run, which counts no draw calls (`DRAW_CALLS_UNAVAILABLE`); the `renderer` column says which happened. The expected breakdown is the table at the head of Task 7: 5–9 world plus V1's 2–4 HUD. |
| The deletions actually happened | `grep -rn "hpGfx\|lockGfx\|arrowGfx\|maneuverGfx\|shotGfx\|SHOT_DEPTH\|HP_BAR_DEPTH\|LOCK_DEPTH\|ARROW_DEPTH\|CAR_DEPTH\|MANEUVER_DEPTH\|ARENA_DEPTH" packages/client/src` prints nothing. `git log --stat` shows `shot-sprites.ts`, `car-sprites.ts`, `world-style.ts`, `layers.ts` and `sprite-pool.ts` added. |
| The picture did not change | `npm test` → `combat-visual.test.ts`'s existing assertions, unchanged, plus Task 2's identity tests (`glowBandsAtRest × glowFlickerScale === instanceGlowBands`, `chargeOrbBandsAtRest × radius/max === chargeOrbBands`, `instanceDrawCentre` is the mean of `instanceDrawShape`'s capsule); and `render/bake.test.ts`, which draws every world job into a recorder and asserts the calls against the same builders. Then by eye, per Tasks 5 and 6: `?dev=bench` for the five projectile bodies, a Practice match for the bar drain, the gold charge outline, the three dash ghosts, the bracket and the countdown arrow, and `?debug=1` for the outlines landing **on** the sprites rather than near them. |
| D19 still holds — a drawn shot never exceeds its hitbox | `render/bake.test.ts`'s "sizes every shot tile to its own hitbox plus the pad" case: a body frame is baked at the hitbox's own extents, and the only live scale on it is the flicker, which R8's `flickerDepth` rule makes shrink-only. `combat-visual.test.ts` keeps enforcing the builder side. |
| The atlas is current and ships | `npm test` → `check-art.test.mjs`'s "ships a packed atlas built from exactly this art"; `npm run check:art` → the `PACKED ATLAS` block reading `current`; `npm run build:release` → `assertAtlasShipped`, and `unzip -l motor-combat-moba-release.zip \| grep art-atlas` lists both files. |
| Boot bake still inside spec R25's < 150 ms | read off the browser console at `?dev=bench` and recorded in `docs/render-bench.md`'s "Boot cost" block. Not asserted: it is a one-off measured on the reference machine, exactly as R25 says. |
| bench p95 no worse than V1 | `npm run bench:arena` on the same machine, read against the V0 and V1 rows now printed beside V2's in `docs/render-bench.md`. Deliberately not asserted by the runner, for V1's reason: a frame-time threshold on shared hardware fails for reasons that are not the renderer's, and the numbers that *are* exact are asserted instead. |
| Nothing else changed | root `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke:arena`, `npm run build:release` all pass. `npm run build:manual` is **not** run and is not owed: no balance table, weapon row, chassis row, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `STATUS_TABLE`, `AIM_CONFIG.lockRange`, `TICK_RATE_HZ` or `ARENA_WIDTH` moved, and the guide still links the loose PNGs, which are untouched. |

Spec R25's acceptance table is still read off the instruments by a person on the reference machine.
V2 moves the world's share of the draw-call row and the client-JavaScript row, and is judged as a
delta from `docs/render-bench.md`'s V0 and V1 rows — with the one exception that the draw-call
number, unlike the times, is exact and is therefore asserted rather than read.

## Handoff

Everything below is beyond the ledger. V3 is written against this section; V4 and V5 consume the
layer plan and the pool.

### `render/layers.ts` (new)

| Export | Shape | For |
|---|---|---|
| `enum Layer` | `Floor, Decals, GroundFx, Cars, Shots, Glow, OverlayFx, Debug` — the ledger's member order | every later phase names its band from here and never a number |
| `LAYER_DEPTH` | `Readonly<Record<Layer, number>>`, bands 100 apart from `-400` | the authority on what draws over what. **`Shots` is `-100` and `Cars` is `0`** — shots draw UNDER cars (D7), which is where the enum's declaration order and the drawn order disagree, on purpose, pinned by `layers.test.ts` |
| `LAYER_BLEND` | `Readonly<Record<Layer, number>>` | one blend per band. `Glow` and `OverlayFx` are `BLEND_ADD`; everything else is `BLEND_NORMAL` |
| `BLEND_NORMAL`, `BLEND_ADD` | `0`, `1` | Phaser's `BlendModes` values restated so the module needs no runtime Phaser import; `layers.test.ts` pins both, so a Phaser upgrade that renumbers them fails there |
| `CAR_BAND` | `{ body: 0, ghost: 2, arrow: 52, bracket: 55, hpBar: 60 }` | offsets inside the `Cars` band. `layers.test.ts` asserts the widest is under the gap to `Glow`, so a new offset cannot climb into the band above |
| `depthOf(layer, offset = 0)` | `number` | the only arithmetic anyone does on a depth |
| `worldSprite(scene, layer, offset, texture, frame?)` | `Phaser.GameObjects.Image`, created **invisible** | the single entry point for a world image. It sets depth and blend once and never again. `scripts/world-retained.test.mjs` greps for `setBlendMode` and for a `setDepth` that is not `depthOf(` in every world source, which is what makes R4 checkable rather than aspirational |
| `worldContainer(scene, layer, offset)` | `Phaser.GameObjects.Container` | the one legitimate exception: children inherit the container's depth and blend, so a car's body and hitbox are added to it rather than going through `worldSprite` |

**Bands that have no inhabitant after V2**, and whose first tenant is named:

- `Decals` — V4's `DecalService` (R12a). Empty table, nothing placed.
- `GroundFx` — V4's under-car particles.
- **`Glow`** — **nothing is on it yet, and V3 puts the first thing there.** V2 bakes a projectile's
  glow bands *into its body frame* rather than as a separate additive sprite, because the shipped
  picture draws them opaque under the body and moving them to ADD would change the art, not the
  cost. §5's "one baked radial-gradient disc per weapon on the Glow layer" is therefore only half
  delivered: the disc is baked, the layer is empty. V3's flame heat halo is the first genuine Glow
  sprite, and R8's halo allowance (1.5× the hitbox at ≤ 25 % alpha) is entirely unclaimed.
- `OverlayFx` — V4's death burst and respawn shimmer.
- `Debug` — nothing uses it: the `?debug=1` outlines ride `shots.beams` at the Shots band so they
  draw over the sprites they outline, and the netgraph and perf overlays are HUD-scene `BitmapText`.

### `render/sprite-pool.ts` (new)

```ts
export interface PoolSprite { setVisible(value: boolean): unknown; destroy(): void }
export class SpritePool<T extends PoolSprite = PoolSprite> {
  constructor(make: () => T);
  get size(): number;      // the high-water mark: how many it has ever needed at once
  begin(): void;
  next(): T;               // makes one if the pool has never been this busy; sets it visible
  end(): void;             // hides the tail, never destroys it
  destroy(): void;
}
```

**The contract V3 must honour.** The pool is **order-based, not keyed**: the Nth sprite of this
frame may belong to a different object than the Nth of the last frame. So every property a caller
ever sets must be set on **every** call, not only when it changes — frame, position, rotation,
scale, **alpha and tint included**. `CarDecor.maneuver` is the example that does it right: it sets
alpha and tint on both branches because a ghost and a charge outline share the `ghosts` pool.
`ShotSprites.body` sets neither, which is safe only because nothing ever tints a body sprite; the
first thing that does must also reset it. The guarded-setter trick V1 used on the HUD does **not**
apply here for the same reason.

### `scenes/arena/world-style.ts` (new, Phaser-free, node-tested)

Moved out of `car-renderer.ts` and `shot-renderer.ts` unchanged: `HITBOX_STROKE`, `HITBOX_PX`,
`HITBOX_NAME`, `HP_BAR_GEOMETRY`, `HP_BAR_BACK`, `LOCK_COLOR`, `LOCK_WIDTH`, `ARROW_COLOR`,
`ARROW_ALPHA`, `DASH_GHOST_WIDTH`, `PHASED_ALPHA`. New here: `BAKE_WORLD_PAD_PX` (4 supersampled
pixels, sized against `wildcharge`'s 3-unit charge outline), `HP_BAR_STEPS` (128),
`HP_BAR_EASE_PER_SECOND` (2.5), `hpBarStepIndex(fraction)`, `easeHpFraction(drawn, target, deltaMs)`.
Depths are **not** here — `render/layers.ts` owns the stack. A new world paint constant goes in this
file so the bake and the frame path read the same number.

### `scenes/combat-visual.ts` (extended)

`UNKNOWN_WEAPON_COLOR`, `UNKNOWN_WEAPON_RADIUS` (newly exported), `glowFlickerScale`,
`glowBandsAtRest`, `chargeOrbMaxRadius`, `chargeOrbRadius`, `chargeOrbBandsAtRest`,
`instanceDrawCentre`, `hpBarAnchor`.

The pattern V3 repeats for beams: a builder that folds a time-varying scale into its shape is split
into an **at-rest half the bake calls** and a **scale the frame path applies to the sprite**, with
the original rebuilt out of the two so every existing caller and test keeps its exact answer.
`instanceDrawCentre` is shared by the sprite path and by `instanceDrawShape`, which is what
guarantees the `?debug=1` outline sits on the sprite rather than near it — V3's beam path must keep
outlining through `instanceDrawShape` for the same reason.

### `render/bake.ts` (extended; V1 produced it)

| Export | For |
|---|---|
| `hudBakeJobs(ss, pill)` | V1's list, renamed. Unchanged body |
| `worldBakeJobs(ss)` | the sixteen world jobs. **V3 appends its flame flipbook and lance strip as a third list**, and `bakeJobs` becomes a three-way concatenation the same way |
| `bakeJobs(ss, pill)` | `[...hudBakeJobs(ss, pill), ...worldBakeJobs(ss)]`. Signature unchanged, so `bakeAtlas` needed no edit |
| `bakedShotWeaponIds()`, `bakedOrbWeaponIds()` | derived from `WEAPON_TABLE`, so a new weapon gets a frame with no edit here |
| `bakedShotFrame(weaponId)`, `bakedOrbFrame(weaponId)`, `bakedCarFrame(carId)` | name → frame; `bakedShotFrame` falls to `BAKED_SHOT_UNKNOWN` for anything unrecognised |
| `BAKED_SHOT_UNKNOWN`, `BAKED_CAR_HITBOX`, `BAKED_CAR_OUTLINE_CHARGE`, `BAKED_CAR_OUTLINE_GHOST`, `BAKED_HP_BAR`, `BAKED_LOCK`, `BAKED_ARROW` | the fixed frame names |
| `worldFrameScale(ss)` | `1 / ss`. **Read at exactly three sites** — `ShotRenderer.unit`, `CarDecor.unit`, `CarRenderer.unit`, each as `worldFrameScale(BAKE_SUPERSAMPLE[BAKE_DEFAULT_TIER])`. V5 replaces the literal default tier at those three and nowhere else |
| `BakeJob.pad?: number` | the transparent margin baked around a job's content; the registered atlas frame is the tile inset by it, so no origin has to know it exists. HUD jobs leave it 0 |
| `BakeGraphics.fillEllipse`, `.moveTo`, `.lineTo` | added for the ellipse silhouette and the bracket's eight arms; `bake.test.ts`'s recorder implements all three |

**The world frame-name convention is `baked.world.<class>.<id>`** — `shot`, `orb`, `car`, plus the
three flat names `hpbar`, `lock`, `arrow`. V3's flipbook frames should follow it
(`baked.world.flame.<nn>`), with the names built once at module load exactly as V1's
`SWEEP_FRAME_NAMES` are, never per frame.

**Two conventions every job follows**, and V3's should too: a shape drawn in **one** colour is baked
white and tinted at draw time (which is what lets one hp-bar frame serve the plate and both
allegiances, and one outline frame serve six player colours plus `wildcharge`'s gold); a shape drawn
in **several** carries its own colours (`predator`'s missile, `magmablast`'s three-band ramp).

**Sheet headroom.** `bake.test.ts`'s "packs the whole atlas into every tier's sheet" case is the
authority and the place V3 will find out: it asserts `packShelf(bakeJobs(2, PILL), 2048)` and
`packShelf(bakeJobs(1, PILL), 1024)` both fit. V1's HUD jobs take roughly six shelves of the
2048 sheet and V2's sixteen world tiles take two more; the flame flipbook is the largest thing left
to land, and if it does not fit, that test fails rather than the sheet silently truncating.

**`import type Phaser`.** Task 3 Step 1 removed the last runtime Phaser reference from this module
(`flameScratch` became `PointLike[]`), so `bake.test.ts` no longer pulls Phaser in transitively.
Keep it that way: a new job that wants a Phaser value wants a plain number instead.

### `render/atlas.ts` (extended; V1 produced it)

`ART_ATLAS` (`"art-atlas"`), `ART_ATLAS_PNG` (`"art/art-atlas.png"`), `ART_ATLAS_JSON`,
`ArtTextureLookup` (the two-method narrowing of Phaser's `TextureManager`), `atlasHasFrame`,
`artFrame`, `artFrameExists`, `artFrameSize`, `artImage`, `loadArtAtlas`.

**The rule: never name an authored-art texture directly again.** `artFrame(textures, key)` returns
the `[texture, frame]` pair to spread into `add.image`, resolving the packed sheet first and the
loose PNG second, so a tree whose packer never ran draws exactly what it drew before. `artFrameSize`
exists because this is the one thing an atlas breaks silently: `getSourceImage()` on an atlased key
answers the whole 512-pixel sheet, and `fitSprite` would then draw every chassis at a fortieth of its
size. The four consumers wired in Task 4 are `assets/car-sprite.ts`'s `phaserTextures`,
`scenes/hud/slot-bar.ts`'s `SlotView.applyWeapon`, and the two `add.image` calls in
`dev/AssetTuningScene.ts`.

**Loading order in `BootScene.loadArt`, which V3 and V4 must not reshuffle:** manifest → **pass one,
the packed atlas alone** (`loadArtAtlas`, awaited; a missing sheet warns and continues) → **pass two,
only the manifest keys the atlas did not carry** as loose PNGs → the missing-texture sweep. Loading
both would upload the same picture twice and hand the GPU a second texture to bind for nothing.
`BootScene.runLoader(queue)` is the extracted one-batch helper the two passes share.

### `scripts/pack-atlas.mjs` (new) and the checks around it

`ATLAS_PAD_PX` (2), `ATLAS_MAX_PX` (4096), `PACKER_VERSION` (1), `ATLAS_PNG`, `ATLAS_JSON`,
`packRects`, `chooseSheet`, `atlasJson`, `sourceFingerprint`, `readSources`, `main`; the command
`npm run pack:atlas`; the committed artefacts `packages/client/public/art/art-atlas.png` and
`.json`. In `scripts/check-art.mjs`: `NON_SPRITE_FILES`, `checkAtlasCoverage`, `atlasSourceSizes`.
In `scripts/build-release.mjs`: `assertAtlasShipped`.

Everything above `main` is pure and unit-tested; only `main` touches the filesystem or `sharp`. The
manifest is **not** rewritten to atlas form (R15), the loose PNGs still ship and are still what the
importers, `?dev=assets` and `manual.html` read, and `docs/asset-pipeline.md`'s "Deferred" bullet
now records this as landed with its three original objections beside their answers.

### `scenes/arena/` (the renderers)

| Export | Where | For |
|---|---|---|
| `class ShotSprites` | `shot-sprites.ts` | `begin()`, `body(frame, x, y, angle, scale)`, `orb(frame, x, y, scale)`, `end()`, `destroy()`. Two pools, both on `Layer.Shots`, both born on a `baked-atlas` frame so they join that texture's batch from their first draw |
| `WORLD_GFX_BEAMS = "shots.beams"` | `shot-renderer.ts` | **the last per-frame world `Graphics`, and V3's to delete.** It sits at `depthOf(Layer.Shots, 1)` — one above the sprite bodies — and carries two things: `drawBeam` (the beam polygon branch and the aura's ring-and-wash) and the `?debug=1` hitbox outline pass. V3 removes the first; the second must survive, so V3 either keeps this object renamed for debug alone or gives the outlines their own named `Graphics`. **Whichever it picks, `WORLD_GRAPHICS_ALLOWED` and `WORLD_CLEARS_ALLOWED` in `scripts/bench-arena.mjs` and `WORLD_GRAPHICS_ALLOWED` in `scripts/world-retained.test.mjs` are the three places that decision is recorded**, and V3's gate is `WORLD_CLEARS_ALLOWED` becoming `[]` |
| `class CarDecor`, `HULL` | `car-sprites.ts` | `begin()`, `hpBar(pose, fraction, allegiance)`, `maneuver(pose, colorId)`, `lockBracket(x, y)`, `countdownArrow(x, y)`, `end()`, `destroy()`. Three pools plus two singletons (there is at most one bracket and one arrow on screen) |
| `WORLD_GFX_FLOOR = "arena.floor"` | `arena-floor.ts` | the floor's `name`. `ARENA_DEPTH` is **deleted**; the floor takes `depthOf(Layer.Floor)` |

`CarRenderer(scene, debug)` and `ShotRenderer(scene, debug)` keep their constructors,
`render(frame, cameraTargetSid): string[]` / `render(frame)`, `invalidateVisuals()` and `destroy()`,
so `ArenaScene` and `BenchScene` were not edited by Tasks 5 or 6.

`CarRenderer` gains two private fields V3 should leave alone: `hpDrawn: Map<string, number>` (the
eased bar length per car, pruned wherever `visualKeys` is pruned) and `lastNowMs` (the frame-clock
delta, clamped to 100 ms so a backgrounded tab does not drain every bar in one step). The ease is
purely visual; `RenderCar.hp` is unchanged and is still what every non-drawing read uses.

### `dev/BenchScene.ts` and the two guards

`SceneCensus` gains `worldGraphicsNames: string[]` and `worldClears: Record<string, number>`;
`UNNAMED_GRAPHICS` is exported. `sceneCensus(game)`'s signature is unchanged. `scripts/bench-arena.mjs`
gains `DRAW_CALL_CEILING`, `WORLD_GRAPHICS_ALLOWED`, `WORLD_CLEARS_ALLOWED`,
`DRAW_CALLS_UNAVAILABLE` and `benchFailures(browser, census, report)`, and `formatCensusRow` now
prints a second line naming the world's `Graphics` and their clear rates.
`scripts/world-retained.test.mjs` carries three lists — retained, `Graphics`-allowed, debug-allowed —
whose union must cover every non-test `.ts` in `scenes/arena/`, so a new file fails the suite until
somebody decides which it is.

### Deliberately deferred by V2

- **Beams.** `beamDrawLayers`, the aura's ring-and-wash, the flame, the lance bolt and the tremor
  cone are untouched and still build geometry every frame. V3.
- **The arena floor stays a `Graphics`.** V1's Handoff guessed V2 would bake it; it does not, and the
  reasoning is in Task 6 Step 4 — it is drawn once and never cleared, so it is not on the frame path
  at all, and a `DynamicTexture` big enough for it would be ~14 MB of VRAM to save re-walking about
  forty points once. It is V5's "floor ambience" row.
- **Dash ghosts stay outlines on the `Cars` band**, not solid body copies on ADD as §5's row says.
  V2's mandate is cost, not art; and `ARENA_COLOR_DEFAULTS.floor` is `0xEBEBEB`, so an additive draw
  over near-white would erase them rather than dim them. R4 is satisfied either way: they take their
  band's blend rather than choosing one.
- **The lock bracket is one frame, not §5's four arm sprites.** It is unrotated, fixed-size, and
  there is at most one on screen, so one quad beats four — and this way the frame is drawn by
  `lockBracketArms` itself, vertex for vertex.
- **The car shadow, the phased outline pulse, the status flipbooks on the car, the hp bar's white
  flash on `hit`, `predator`'s exhaust and 2-frame flicker** — every §5 row that needs particles or
  `RenderFrame.events`. V4.
- **Tiers.** `BAKE_DEFAULT_TIER` is passed everywhere and never varied; `render/tiers.ts` does not
  exist. V5, at the three `worldFrameScale` sites named above.
- **`mipmapFilter` on the two power-of-two sheets** (R17a). The packer emits a power-of-two sheet
  precisely so V5 can turn it on; V2 does not.
- **The multi-wave `VolleyDef` machinery** stays dormant: no weapon row authors more than one volley,
  and nothing here changes that.

## Self-review

**Spec coverage.**

- **R1 (bake, don't build).** Task 3 bakes sixteen world frames: five projectile bodies, the unknown
  dot, the charge orb, three silhouettes, the hitbox box, two hull outlines, the hp bar, the bracket
  and the arrow. Task 2 is what makes three of them bakeable at all — the glow flicker, the orb's
  wind-up and the projectile's extrapolation were folded into the shapes, and R1's "up to position,
  rotation, scale, alpha and tint" only holds once they are split out.
- **R2 (geometry only when the shape changes).** The fork is one line, `instance.kind`, and the table
  in Task 5 states it: `PROJECTILE` becomes a sprite, `BEAM` keeps its `Graphics` because
  `beamDrawLayers` genuinely rebuilds the polygon. Nothing else in the world builds geometry.
- **R3 (retained, not immediate).** Four `Graphics` deleted in Task 6, the projectile half of a fifth
  in Task 5, plus the per-car silhouette and hitbox `Graphics`. What survives is one object drawn
  once (the floor) and one on the frame path (beams, plus the debug outlines R3 explicitly exempts).
  Task 7's clear counter is what tells those two apart mechanically.
- **R4 (planned batches).** Task 1's banded plan: one depth range and one blend per band, applied
  once at creation by `worldSprite` and `worldContainer`, with `layers.test.ts` asserting band
  headroom and that exactly `Glow` and `OverlayFx` are additive. `world-retained.test.mjs` greps
  `setBlendMode` and non-`depthOf` `setDepth` out of every world source, which is what makes the
  principle enforceable rather than aspirational. The one disagreement with §4's table — `Shots`
  below `Cars` — is D7, is deliberate, and is pinned by a test so nobody "fixes" it.
- **R6 (zero allocation on the frame path).** `SpritePool` grows once and then allocates nothing;
  `end()` hides rather than destroys. `CarDecor`'s bracket and arrow are singletons. The hp bar's
  `HP_BAR_STEPS` quantisation exists so a guarded setter writes at most 128 times over an ease
  instead of once per frame per car. `placed()` and `tile()` allocate, and only at boot.
- **R11 (two atlases).** `baked-atlas` gains the world jobs (Task 3); `art-atlas` is new (Task 4),
  named exactly as the ledger has it, with `render/atlas.ts` holding both keys.
- **R13 (`bake.ts` runs the existing pure builders).** Every job calls a function the client already
  runs: `projectileDrawLayers`, `glowBandsAtRest`, `chargeOrbBandsAtRest`, `projectileShapeAt`,
  `hexagonPoints`, `hullOutlinePoints`, `maneuverOutline`, `lockBracketArms`,
  `countdownArrowPoints`, `weaponFillOf`. No new art code was written, and `bake.test.ts` asserts the
  calls against a stub recorder, which is R13's own stated device.
- **R15 (one build-time packer).** `scripts/pack-atlas.mjs`, sharp-based, a shelf packer, emitting
  `public/art/art-atlas.{png,json}` from the manifest; `check-art.mjs` gains the coverage check R15
  asks for; the importers, `?dev=assets` and `manual.html` are untouched, exactly as R15 requires.
- **§5's catalogue, row by row.** Car body → Task 6's `artImage` plus the baked silhouette fallback;
  player colour → a `MULTIPLY` tint over a white-baked frame, which is the same picture §5's
  "`FILL` for silhouettes" describes through one code path instead of two; hp bar → Task 6's two
  sprites with the visual ease §5 names (the white flash on `hit` needs events, V4); dash ghosts,
  charge outline, lock bracket, countdown arrow → Task 6, with the two documented deviations above;
  projectile bodies and glow bands → Tasks 3 and 5 (the exhaust emitter and the 2-frame flicker are
  V4's); phased → `PHASED_ALPHA` kept as-is, the pulsing outline is V4's. Every other row is V3's,
  V4's or V5's and is named as such in the Handoff's deferral list, so no row is silently skipped.
- **§9/R25.** The draw-call row (≤ 16) is asserted by Task 7. The client-JavaScript row and the
  frame-time rows are recorded beside V0's and V1's and read by a person, per R25's own framing. The
  boot-bake row (< 150 ms) gains a recorded number in the same section.
- **§10's V2 row.** Ships all seven named things; deletes all five named `Graphics`, plus two the row
  does not name (the per-car silhouette and hitbox `Graphics`), which the Acceptance table's `grep`
  proves.

**Placeholder scan.** The `(paste …)` markers in Task 7 Step 8 are the only deferred content in the
plan; they are measurements that cannot exist before the code does, the step names the command that
produces each, and Step 10's `grep -c "(paste" docs/render-bench.md` must print `0` before the
commit — the same device V0's Task 8 and V1's Task 5 used. No "TBD", no "handle the edge cases", no
"as in Task N". Every new module is printed in full; every moved body has a file:line range and a
substitution table. Task 2 Step 8 is the one step that deliberately leaves the tree in a state where
`npm run typecheck` reports errors, and it says so, says why, and gives the alternative.

**Type consistency.** `Layer` is produced by `layers.ts` and indexed by `LAYER_DEPTH`, `LAYER_BLEND`,
`depthOf`, `worldSprite` and `worldContainer` — every consumer takes the enum, never a number.
`SpritePool<Phaser.GameObjects.Image>` is instantiated in `ShotSprites` and `CarDecor`; `PoolSprite`
is the two-method structural type the node-environment test stubs, which is why neither file needs
Phaser at test time. `BakeJob` gained `pad?` and every world job sets it to `BAKE_WORLD_PAD_PX`,
which `bakeAtlas` subtracts once when it registers the frame — so `job.width` is the tile and the
registered frame is the content, and `bake.test.ts` asserts both ends of that arithmetic.
`BakeGraphics` remains the interface the recorder implements and `Phaser.GameObjects.Graphics`
structurally satisfies at the single call site in `bakeAtlas`; the three added methods are on both
sides. `bakedFrame(name)` returns the `[texture, frame]` pair every `add.image` spreads, and
`bakedShotFrame`/`bakedOrbFrame`/`bakedCarFrame` return the *name* that goes into it — one indirection,
consistently. `artFrame(textures, key)` returns the same pair shape for the authored sheet, and
`ArtTextureLookup` is the narrowing both it and `artFrameSize` take, satisfied structurally by
Phaser's `TextureManager` at the four call sites. `DrawBand` and `ChargeOrbBand` are unchanged and
are what `glowBandsAtRest` and `chargeOrbBandsAtRest` return to both the bake and the frame path.
`HpBarGeometry` is what `hpBarPoints` and `hpBarAnchor` both take, so the sprite's anchor and the
quad's corners cannot drift. `SceneCensus` is produced by `sceneCensus`, exposed by
`BenchProbe.census()`, and read by `formatCensusRow` and `benchFailures` — the two new fields are
added at all four points. `PerfReport.drawCalls` is V0's shape and `benchFailures` reads only its
`p50`, with `DRAW_CALLS_UNAVAILABLE` mirroring `PERF_OVERLAY_CONFIG.drawCallsUnavailable` because a
`.mjs` script cannot import the client's TypeScript constant.
