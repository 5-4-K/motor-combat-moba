# Rendering Phase 3 — Beams: The Last Geometry Leaves the Frame Path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the last per-frame `Graphics` from the world. The `afterburner` flame becomes a flipbook baked from its own procedural authoring code, the `lance` bolt becomes four `Rope` strips of forty vertices each along a jittered spine, and `tremor`'s cone and `magmablast`'s detonation ring become scaled sprites. After this phase the only `Graphics` the arena can create is the `?debug=1` hitbox outline pass, and it is created only when that flag is set.

**Why it is the largest single win in the rendering spec.** Spec §1 measured the shipped flame at the roster's realistic ceiling — six Mirages all burning `afterburner`, twelve flame instances — at **2.65 ms of geometry plus 3.88 ms of earcut inside Phaser's `FillPath` node: 6.53 ms of CPU per frame**, against a whole JavaScript budget of about 6 ms. One weapon's cosmetics cost more than the frame. This phase replaces those 12,600 vertices and 12,132 triangles with twelve frame indices and twelve quads.

**Architecture:** `combat-visual.ts` stays the authoring source (R2) and is split the way V2 split the projectile builders: the parts that are constant up to a transform move into a bake job, and the part that genuinely changes per frame — the bolt's spine, and nothing else — becomes a pure builder that writes into a preallocated buffer. `render/bake.ts` gains a third job list. A new `render/beams.ts` owns the retained objects: one animated-sprite pool for flames, one `Rope` pool for bolts, one sprite pool for zones and halos. `ShotRenderer` loses `drawBeam` and its `Graphics` field.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), npm workspaces, Phaser 4.2.1, vitest in the **node** environment, `node --test` for `scripts/*.test.mjs`, Playwright for the bench runner.

**Spec:** [`2026-09-04-client-rendering-architecture-design.md`](../../specs/2026-09-04-client-rendering-architecture-design.md) — §1 (the measured cost this phase removes), §2 (`Rope`, the render-node cost model), §3 (R2, R3, R4, R6, R7, R8, R9), §5 (the catalogue's beam rows), §6 (R13, R14), §7, §9 (R24, R25), §10 the V3 row, §11.
**Ledger:** [`interfaces.md`](interfaces.md) — `render/beams.ts`, `render/layers.ts`, `render/bake.ts`, `render/atlas.ts`, the census. **Previous phase:** [`22-render-2-bake.md`](22-render-2-bake.md) — **read its `## Handoff` in full before Task 1**; everything this plan consumes is named there. Also [`21-render-1-hud.md`](21-render-1-hud.md) (which produced `bake.ts` and `atlas.ts`) and [`20-render-0-instrumentation.md`](20-render-0-instrumentation.md) (the bench scene and its two scripts). **Runbook:** [`00-execution-guide.md`](00-execution-guide.md) — §1 coupling 1, §3, §5 (the V3 gate), §7.

**`11-netcode-1-time.md` must have merged before this plan starts.** That is the execution guide's coupling 1, and it is not a formality: this phase authors every beam timing in ticks, and the tick is 60 Hz only after N1. The flame's flipbook cadence (`FLAME_TICKS_PER_FRAME`) and the ceiling measurement both read `TICK_RATE_HZ`; authoring them at 30 and re-pinning later would mean baking the sheet twice. Confirm with `grep -n "TICK_RATE_HZ" packages/shared/src/constants.ts` before Task 1.

**This plan does not edit `packages/shared`.** Ledger coupling 4: the rendering stream reads shared and never writes it. Every number this phase needs — `WEAPON_TABLE`'s ranges, hitboxes and colours, `TICK_RATE_HZ`, `MS_PER_TICK` — is already exported.

## Global Constraints

- **Rebuild shared before testing**: `npm run build -w @motor-combat-moba/shared`. Server and client consume built `dist`.
- **Verify with root `npm test`**, never a per-workspace run alone.
- **`.js` import specifiers** on every local import; shared is imported as `@motor-combat-moba/shared`.
- **Nothing under `packages/client/src/match/` imports Phaser, and no test imports Phaser.** This plan touches `match/` not at all; every test in it runs in vitest's node environment against pure builders, or in `node --test` against a source scan.
- **Do not touch `packages/server/playtest/` except to fix a compile break**, and say loudly in the task's commit step which probe numbers your change moves. **This plan touches no probe**, and the one thing it does move is a paragraph of `playtest/README.md`'s prose — see Task 5.
- **Do not edit `docs/ideas/` or `docs/invariants/`.**
- **Commit after every task** on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch cut off it). `npm install` in a fresh worktree before the first build.
- **"main" means `development/main`.**
- **No balance table is edited.** No weapon row, chassis row, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `STATUS_TABLE` or `TICK_RATE_HZ` value changes, so `npm run build:manual` and `docs/turn-tuning.md` are **not** owed an update. Every number this phase bakes is *read* from `WEAPON_TABLE` and `WEAPON_BEAM_STYLES`, so a future re-tune moves the picture with no edit here.
- **`WEAPON_BEAM_STYLES` is not re-authored.** Its layers, colours, crackle rates and ember counts are the art, and this phase changes how they are drawn, not what they say. The two places the picture provably changes are named in Task 1 and are consequences of R2, not choices.
- **Zero allocation on the frame path (R6).** Every per-frame builder writes into a preallocated `Float64Array` or mutates an existing `Vector2`; nothing on the beam path calls `map`, `filter`, spread or `[...]` after boot. `combat-visual.ts`'s `JET_*` scratch buffers are the model and the rule.
- **The honesty rule (D19) survives.** Every beam still draws inside its own hitbox, and the `?debug=1` outline still comes from `instanceDrawShape` — the sim's own shape — so it is the ground truth for what a sprite claims, not a second opinion about it.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/client/src/scenes/combat-visual.ts` (modify) | split: `flameFrameLayers` (bake), `boltSpineInto` + `boltStripHalf` (frame path, factored out of `rectPoints`), `coneFanAtRest`, `auraRingAtRest`, `flameFrameIndex`, `boltShaftStart` |
| `packages/client/src/scenes/combat-visual.test.ts` (modify) | the four identity tests that hold the split to the originals |
| `packages/client/src/scenes/beam-style.test.ts` (modify) | containment re-stated for the rope: strip half-width plus drift never leaves the hitbox |
| `packages/client/src/render/bake.ts` (modify) | `beamBakeJobs(ss, tier)`, the third list; `BAKE_FLAME_SCALE`, `FLAME_FRAMES`, `FLAME_TICKS_PER_FRAME`, `flameFrameScale`, and the eight new frame names |
| `packages/client/src/render/bake.test.ts` (modify) | the new jobs drawn into the recorder; the sheet still packs at both tiers |
| `packages/client/src/render/beams.ts` (create) | `BeamRenderer`: the flame flipbook pool, the `Rope` pool, the zone/halo pool |
| `packages/client/src/scenes/arena/shot-renderer.ts` (modify) | `drawBeam` deleted; `BeamRenderer` in its place; the debug `Graphics` becomes lazy and is renamed |
| `packages/client/src/dev/BenchScene.ts` (modify) | `SceneCensus.worldRopeVertices`; the ceiling scenario keeps two lances burning |
| `packages/client/src/scenes/arena/world-style.ts` (modify) | `BOLT_ROPE_POINTS`, `FLAME_HALO_ALPHA`, `AURA_BAKE_RADIUS`, `TREMOR_BAKE_REACH` |
| `scripts/bench-arena.mjs` (modify) | `ROPE_VERTEX_CEILING`; `WORLD_CLEARS_ALLOWED` becomes `[]`; the rope row |
| `scripts/world-retained.test.mjs` (modify) | `render/beams.ts` joins the retained list; `WORLD_GRAPHICS_ALLOWED` loses the beam entry |
| `docs/render-bench.md` (modify) | the V3 row beside V0, V1 and V2 |
| `packages/client/CLAUDE.md`, `docs/project-structure.md`, `docs/asset-pipeline.md`, `packages/server/playtest/README.md` (modify) | beams are baked now |

---

### Task 1: Split the beam builders

**Files:**
- Modify: `packages/client/src/scenes/combat-visual.ts`, `packages/client/src/scenes/arena/world-style.ts`
- Test: `packages/client/src/scenes/combat-visual.test.ts`, `packages/client/src/scenes/beam-style.test.ts`

**Interfaces:**
- Consumes: `WEAPON_BEAM_STYLES`, `WEAPON_TABLE`, `beamGrownExtent`, `conePoints`, `rectPoints`, `flowingNoise`, `rotateBy`, `hexToFill`, `clamp01`, `isAuraInstance`, `AURA_RING_WIDTH`, `AURA_FILL_ALPHA`, `BEAM_FADE_OUT_MS`, `beamFadeAlpha`; `TICK_RATE_HZ`, `MS_PER_TICK`.
- Produces:

```ts
// scenes/combat-visual.ts
/** One frame of the baked flame: every layer's polygon plus its embers, in bake-local coordinates. */
export function flameFrameLayers(weaponId: string, reach: number, frameIndex: number, frames: number): DrawBeamLayer[];
/** Which flipbook frame a beam instance is showing, from ITS OWN age in ticks (R9). */
export function flameFrameIndex(spawnTick: number, tick: number, frames: number, ticksPerFrame: number): number;
/** The half-width the bolt's strip texture is baked at, in world units, for one layer. */
export function boltStripHalf(weaponId: string, layerIndex: number): number;
/** Where a bolt's shafts begin: the outermost layer's dome, so one nose frame covers every layer. */
export function boltShaftStart(weaponId: string): number;
/**
 * The rope spine for one bolt layer, written into `out` as x,y pairs. Returns the point count.
 * Allocation-free (R6): `out.length` must be at least `2 * BOLT_ROPE_POINTS`.
 */
export function boltSpineInto(
  weaponId: string, layerIndex: number,
  x: number, y: number, heading: number, extent: number, nowMs: number,
  out: Float64Array,
): number;
/** The static fan a non-animating cone beam draws, in bake-local coordinates at `reach`. */
export function coneFanAtRest(weaponId: string, reach: number): DrawBeamLayer[];
/** The aura's ring and wash, in bake-local coordinates at `radius`. */
export function auraRingAtRest(radius: number): { ring: number; wash: number; ringWidth: number };
```

#### What splits, what stays, and the two places the picture changes

| Beam | Today, per frame | After | Class |
|---|---|---|---|
| `afterburner` flame | 5 jetting cone polygons of 194 vertices each + 8 ember polygons of 10, per instance, rebuilt every frame from `nowMs` | one flipbook sprite, frame index from the instance's own age in ticks, plus one additive heat halo | A + S |
| `lance` bolt | 4 rect polygons of ~415 vertices each, rebuilt from `nowMs` | one nose sprite + four `Rope` strips of 20 points (40 vertices) along a spine rebuilt per frame | S + T |
| `tremor` cone | 2 static cone polygons, rebuilt every frame from constants | one sprite scaled by `extent` | S |
| aura (`magmablast`'s detonation) | a ring stroke and a low-alpha wash, rebuilt every frame | one sprite scaled by `extent` | S |

**The two places the picture provably changes, and why R2 requires both.**

1. **The bolt's thickness stops varying along its length.** `rectPoints` tears the near and far edges *independently*, so today's bolt is thinner where it has torn and thicker where it has not. A `Rope` has one spine and a width fixed by its frame's height (`Rope.js:960`, `frameSize = this.frame.halfHeight`), so that variation cannot survive as geometry. It moves into the texture: the strip is baked with a soft alpha falloff over its outer eighth, which is what reads as a ragged edge. This is precisely R2's trade — "textured strips of a few dozen vertices with the detail in the texture" — and it is the reason the bolt costs 40 vertices instead of 830.

2. **The flame's animation becomes deterministic and per-instance.** Today `beamDrawLayers` takes `nowMs`, a free-running wall clock, so two flames alive at once flicker in lockstep and two clients watching the same flame see different frames of it — a defect spec §1 and R9 both name. The flipbook's frame index comes from `(spawnTick, tick)` instead, so two flames born a tick apart are out of step with each other and every client agrees about both. Nothing informative rides on a flame's phase, so this is strictly an improvement; it is called out because it is a visible change, not because it is a risk.

Everything else is preserved exactly, and Step 4's tests are what say so rather than this paragraph.

- [ ] **Step 1: The new constants in `world-style.ts`**

```ts
/**
 * Points in a bolt's rope spine. Twenty points is **forty vertices** (`Rope` emits two per point,
 * `Rope.js:962-993`), which is exactly R2's ceiling for a textured strip. The rendering spec's
 * catalogue says "a `Rope` of 24 segments"; 24 segments is 25 points and 50 vertices, over that
 * ceiling, so the principle wins over the sketch and the count is 20. At `lance`'s 1200-unit reach
 * that is one station every 63 units against a tear amplitude of about 12, which still reads as a
 * torn edge rather than as a polyline.
 */
export const BOLT_ROPE_POINTS = 20;

/**
 * Alpha of the flame's additive heat halo, and the first thing the game has ever put on the Glow
 * layer. R8 allows an additive halo out to 1.5x the hitbox at 25 % alpha; this is inside both — the
 * disc's radius is half the flame's reach, well under the cone's own tip half-width.
 */
export const FLAME_HALO_ALPHA = 0.22;

/**
 * The radius the aura's ring and wash are baked at, in world units. The frame is scaled by
 * `extent / AURA_BAKE_RADIUS`, so its OUTER edge always lands exactly on the hitbox and the client
 * doc's promise — "the ring sits exactly on the hitbox" — survives the change to a sprite.
 *
 * 64 rather than `magmablast`'s own 60 so the one shipped burst draws at 0.94 of the baked size:
 * a burst is born at full extent and never grows, so the scale is constant in practice, and a
 * re-tune up to 64 units needs no new frame. The ring's *stroke* scales with the disc rather than
 * staying `AURA_RING_WIDTH` units, which at 0.94 is 2.8 units against 3.
 */
export const AURA_BAKE_RADIUS = 64;

/**
 * The reach `tremor`'s cone is baked at, in world units, and scaled from. A cone's apex is at the
 * muzzle, so scaling its reach scales its spread by the same factor and yields a similar triangle
 * sharing the apex — `BeamLayer`'s own comment states it, and it is what makes ONE frame correct at
 * every extent rather than a size ladder. 128 keeps the tile small; `tremor` reaches 492.
 */
export const TREMOR_BAKE_REACH = 128;
```

- [ ] **Step 2: Write the failing identity tests**

```ts
// packages/client/src/scenes/combat-visual.test.ts — appended
import {
  auraRingAtRest, boltShaftStart, boltSpineInto, boltStripHalf, coneFanAtRest,
  flameFrameIndex, flameFrameLayers,
} from "./combat-visual.js";
import { AURA_FILL_ALPHA, AURA_RING_WIDTH } from "./combat-visual.js";
import { BOLT_ROPE_POINTS } from "./arena/world-style.js";
import { WEAPON_TABLE, TICK_RATE_HZ } from "@motor-combat-moba/shared";

describe("the beam split (V3)", () => {
  it("bakes the same flame `beamDrawLayers` would have drawn at the same phase", () => {
    const frames = 24;
    const reach = WEAPON_TABLE.afterburner.range;
    // Frame `i` is the flame at `i / frames` of the loop, and the loop is one period of the
    // SLOWEST authored layer rate. `flameFrameLayers` must reproduce `beamDrawLayers` at that time.
    const loopMs = 1000 / 1.2;
    for (const i of [0, 7, 23]) {
      const nowMs = (loopMs * i) / frames;
      const live = beamDrawLayers("afterburner", 0, 0, 0, reach, 0, nowMs);
      const baked = flameFrameLayers("afterburner", reach, i, frames);
      expect(baked).toHaveLength(live.length);
      for (const [k, layer] of baked.entries()) {
        expect(layer.fill).toBe(live[k]!.fill);
        expect(layer.points.length).toBe(live[k]!.points.length);
        expect(layer.points[0]!.x).toBeCloseTo(live[k]!.points[0]!.x, 9);
        expect(layer.points[0]!.y).toBeCloseTo(live[k]!.points[0]!.y, 9);
      }
    }
  });

  it("advances the flipbook from the instance's own age, so two flames are out of step", () => {
    const frames = 24;
    expect(flameFrameIndex(1000, 1000, frames, 2)).toBe(0);
    expect(flameFrameIndex(1000, 1001, frames, 2)).toBe(0);
    expect(flameFrameIndex(1000, 1002, frames, 2)).toBe(1);
    // Wraps, and never reads a tick before the spawn.
    expect(flameFrameIndex(1000, 1000 + frames * 2, frames, 2)).toBe(0);
    expect(flameFrameIndex(1000, 999, frames, 2)).toBe(0);
    // Two instances a tick apart show different frames — the R9 fix, stated as a test.
    expect(flameFrameIndex(1000, 1002, frames, 2)).not.toBe(flameFrameIndex(1001, 1002, frames, 2));
  });

  it("keeps the whole flipbook loop inside 5 % of the slowest authored flame rate", () => {
    const frames = 24;
    const ticksPerFrame = 2;
    const loopMs = ((frames * ticksPerFrame) / TICK_RATE_HZ) * 1000;
    const slowestHz = 1.2;   // afterburner's outermost layer, WEAPON_BEAM_STYLES
    expect(Math.abs(loopMs - 1000 / slowestHz) / (1000 / slowestHz)).toBeLessThan(0.05);
  });

  it("writes a bolt spine of exactly BOLT_ROPE_POINTS points, allocation-free", () => {
    const out = new Float64Array(BOLT_ROPE_POINTS * 2);
    const count = boltSpineInto("lance", 0, 100, 200, 0, 1200, 0, out);
    expect(count).toBe(BOLT_ROPE_POINTS);
    // The first point sits at the shaft start, the last at the beam's tip.
    expect(out[0]).toBeCloseTo(100 + boltShaftStart("lance"), 6);
    expect(out[(count - 1) * 2]).toBeCloseTo(100 + 1200, 6);
    // The same call twice gives the same answer and touches nothing else.
    const again = new Float64Array(BOLT_ROPE_POINTS * 2);
    boltSpineInto("lance", 0, 100, 200, 0, 1200, 0, again);
    expect([...again]).toEqual([...out]);
  });

  it("keeps every layer's strip inside its own share of the hitbox", () => {
    const width = WEAPON_TABLE.lance.hitbox.shape === "rect" ? WEAPON_TABLE.lance.hitbox.width : 0;
    const style = WEAPON_BEAM_STYLES.lance!;
    for (const [i, layer] of style.layers.entries()) {
      const half = (width / 2) * layer.crossScale;
      const strip = boltStripHalf("lance", i);
      expect(strip).toBeGreaterThan(0);
      expect(strip).toBeLessThanOrEqual(half);
    }
    // The core has no crackle, so its strip IS its half-width: nothing is given up for a drift
    // that never happens.
    const core = style.layers.length - 1;
    expect(boltStripHalf("lance", core)).toBeCloseTo((width / 2) * style.layers[core]!.crossScale, 9);
  });

  it("bakes tremor's cone at the canonical reach and nothing else", () => {
    const fan = coneFanAtRest("tremor", TREMOR_BAKE_REACH);
    expect(fan).toHaveLength(WEAPON_BEAM_STYLES.tremor!.layers.length);
    const live = beamDrawLayers("tremor", 0, 0, 0, TREMOR_BAKE_REACH, 0, 0);
    expect(fan.map((l) => l.fill)).toEqual(live.map((l) => l.fill));
    expect(fan[0]!.points.length).toBe(live[0]!.points.length);
  });

  it("gives the aura its shipped ring and wash", () => {
    const aura = auraRingAtRest(AURA_BAKE_RADIUS);
    expect(aura.ringWidth).toBe(AURA_RING_WIDTH);
    expect(aura.wash).toBeCloseTo(AURA_FILL_ALPHA, 9);
  });
});
```

Run: `cd packages/client && npx vitest run src/scenes/combat-visual.test.ts`
Expected: FAIL — the seven exports do not exist.

- [ ] **Step 3: Write the split**

`flameFrameLayers`, `coneFanAtRest` and `auraRingAtRest` are thin, because everything they need already exists:

```ts
/**
 * One frame of the baked flame flipbook (R14), in bake-local coordinates: apex at the origin,
 * heading along +x.
 *
 * The frames sample ONE PERIOD of the slowest authored layer rate. The faster layers therefore do
 * not close their own loop exactly at the seam, and that is accepted: a jet flame is turbulent, the
 * seam is one 33 ms step out of 800, and the alternative — a period that is a common multiple of
 * 1.2, 1.3, 1.4, 1.5 and 1.7 Hz — is minutes long.
 *
 * `beamDrawLayers` is called, not reimplemented. This is the whole of R2's "the existing geometry
 * stays as the authoring source": the flame's five jetting layers, its embers, its containment and
 * every knob in `WEAPON_BEAM_STYLES` are unchanged, and the only thing that moved is *when* they
 * run.
 */
export function flameFrameLayers(
  weaponId: string,
  reach: number,
  frameIndex: number,
  frames: number,
): DrawBeamLayer[] {
  const style = isWeaponId(weaponId) ? WEAPON_BEAM_STYLES[weaponId] : undefined;
  if (!style || frames <= 0) return [];
  const slowestHz = slowestFlameHz(style);
  const loopMs = slowestHz > 0 ? 1000 / slowestHz : 0;
  const nowMs = (loopMs * (frameIndex % frames)) / frames;
  return beamDrawLayers(weaponId, 0, 0, 0, reach, 0, nowMs);
}

/** The lowest rate any layer of this style animates at — the loop the flipbook is cut to. */
function slowestFlameHz(style: BeamStyle): number {
  let slowest = Number.POSITIVE_INFINITY;
  for (const layer of style.layers) {
    const hz = layer.flameHz ?? style.flameHz ?? 0;
    if (hz > 0 && hz < slowest) slowest = hz;
  }
  return Number.isFinite(slowest) ? slowest : 0;
}

/**
 * Which flipbook frame this instance is showing.
 *
 * From the instance's OWN age in ticks, never a wall clock (R9): two flames born a tick apart are
 * out of step with each other, and every client watching either one agrees about which frame it is
 * on. The shipped flame did the opposite on both counts.
 */
export function flameFrameIndex(
  spawnTick: number,
  tick: number,
  frames: number,
  ticksPerFrame: number,
): number {
  if (frames <= 0 || ticksPerFrame <= 0) return 0;
  const age = Math.max(0, tick - spawnTick);
  return Math.floor(age / ticksPerFrame) % frames;
}

/** `tremor`'s two static cone layers at a canonical reach, apex at the origin, along +x. */
export function coneFanAtRest(weaponId: string, reach: number): DrawBeamLayer[] {
  return beamDrawLayers(weaponId, 0, 0, 0, reach, 0, 0);
}

/** The aura's shipped ring-and-wash, restated as three numbers so the bake job needs no branch. */
export function auraRingAtRest(radius: number): { ring: number; wash: number; ringWidth: number } {
  void radius;
  return { ring: 1, wash: AURA_FILL_ALPHA, ringWidth: AURA_RING_WIDTH };
}
```

`coneFanAtRest` is deliberately a one-line delegation rather than an inlined copy: `tremor` authors no `flameHz`, so `conePoints` takes its frozen-fan branch and `nowMs` is ignored — which the test above asserts rather than assumes, so a future `flameHz` on `tremor` fails there instead of silently baking one arbitrary phase of an animation.

The bolt is the real work. Three functions, all factored **out of** `rectPoints` so the two cannot disagree:

```ts
/**
 * The half-width one bolt layer's strip texture is baked at, in world units.
 *
 * A `Rope`'s width is fixed by its frame's height, so the per-station width variation `rectPoints`
 * produces cannot survive as geometry (see this plan's Task 1 note). The strip gives up half the
 * layer's crackle amplitude, and the spine is allowed to drift by exactly what it gave up — so
 * `strip + |drift| <= half` for every station, and the beam is still inside its own hitbox at every
 * point. That is containment by construction, the same property `BeamLayer`'s comment claims for
 * the polygon version, and `beam-style.test.ts` holds it.
 */
export function boltStripHalf(weaponId: string, layerIndex: number): number {
  const geo = boltGeometry(weaponId, layerIndex);
  if (!geo) return 0;
  return geo.half * (1 - geo.crackle / 2);
}

/**
 * Where every layer's shaft begins: the OUTERMOST layer's dome.
 *
 * `rectPoints` starts each layer at its own `domeScale * halfWidth * crossScale`, which for
 * `lance`'s four layers is four different points. One nose sprite covering `[0, boltShaftStart]`
 * draws all four layers' domes AND their shafts over that stretch, exactly as `rectPoints` does,
 * so the ropes can all begin at the same place with no seam and no notch.
 */
export function boltShaftStart(weaponId: string): number {
  const geo = boltGeometry(weaponId, 0);
  return geo ? geo.dome : 0;
}

/**
 * One bolt layer's rope spine, in world coordinates, written into `out` as `x, y` pairs.
 *
 * The station maths is `rectPoints`' own, at `BOLT_ROPE_POINTS` stations instead of
 * `BOLT_STATIONS + 1`: the same `flowingNoise` roll, the same `crackleHz`, the same `wander`. What
 * it keeps is the CENTRELINE (`drift`); what it drops is the per-station half-width, which is now
 * the texture's job.
 *
 * Allocation-free (R6). `out` is the caller's preallocated buffer and is never resized.
 */
export function boltSpineInto(
  weaponId: string,
  layerIndex: number,
  x: number,
  y: number,
  heading: number,
  extent: number,
  nowMs: number,
  out: Float64Array,
): number {
  const geo = boltGeometry(weaponId, layerIndex);
  if (!geo) return 0;
  const reach = Math.max(0, extent);
  const start = Math.min(boltShaftStart(weaponId), reach);
  if (reach <= start) return 0;

  const wave = flowingNoise(nowMs, geo.crackleHz, layerIndex);
  const strip = boltStripHalf(weaponId, layerIndex);
  const room = geo.half - strip;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const last = BOLT_ROPE_POINTS - 1;

  for (let i = 0; i < BOLT_ROPE_POINTS; i++) {
    const t = i / last;
    const along = start + (reach - start) * t;
    // Station 0 sits dead centre so the shaft meets the nose sprite with no kink — the same rule
    // `rectPoints` applies at its own station 0, for the same reason.
    const drift =
      i === 0 || room <= 0
        ? 0
        : (wave(i, 31) - 0.5) * 2 * room * (0.25 + 0.75 * wave(i >> 2, 555));
    out[i * 2] = x + along * cos - drift * sin;
    out[i * 2 + 1] = y + along * sin + drift * cos;
  }
  return BOLT_ROPE_POINTS;
}

/** The four numbers every bolt function above needs, resolved from the tables exactly once. */
function boltGeometry(
  weaponId: string,
  layerIndex: number,
): { half: number; crackle: number; crackleHz: number; dome: number } | null {
  const def = isWeaponId(weaponId) ? weaponDefOf(weaponId) : null;
  if (!def || def.kind !== "beam" || def.hitbox.shape !== "rect") return null;
  const style = WEAPON_BEAM_STYLES[def.id];
  const layer = style?.layers[layerIndex];
  if (!style || !layer) return null;
  const halfWidth = def.hitbox.width / 2;
  return {
    half: halfWidth * clamp01(layer.crossScale),
    crackle: clamp01(layer.crackle ?? 0),
    crackleHz: layer.crackleHz ?? style.crackleHz ?? 0,
    dome: Math.max(0, style.domeScale ?? 0) * halfWidth * clamp01(style.layers[0]!.crossScale),
  };
}
```

**`rectPoints` is not deleted and not edited.** It is the authoring source for the nose frame (Task 2 bakes `[0, boltShaftStart]` of it) and it is what `combat-visual.test.ts` and `beam-style.test.ts` still pin, so a re-tune of `WEAPON_BEAM_STYLES.lance` is still caught by the tests that have always caught it. Its `BOLT_STATIONS` walk simply no longer runs sixty times a second.

- [ ] **Step 4: Re-state containment for the rope**

`packages/client/src/scenes/beam-style.test.ts` asserts today that every layer's `extentScale` and `crossScale` are inside `(0, 1]`, which is what keeps a drawn flame inside its hitbox. The rope needs the same property stated in its own terms; append:

```ts
describe("bolt strips stay inside the hitbox (V3)", () => {
  const width = WEAPON_TABLE.lance.hitbox.shape === "rect" ? WEAPON_TABLE.lance.hitbox.width : 0;

  it("strip half-width plus the spine's drift never leaves the layer's own half-width", () => {
    const out = new Float64Array(BOLT_ROPE_POINTS * 2);
    for (const [i, layer] of WEAPON_BEAM_STYLES.lance!.layers.entries()) {
      const half = (width / 2) * layer.crossScale;
      const strip = boltStripHalf("lance", i);
      // Sweep the noise: a single roll measures one arbitrary phase of a moving edge.
      for (let ms = 0; ms < 2000; ms += 37) {
        const count = boltSpineInto("lance", i, 0, 0, 0, WEAPON_TABLE.lance.range, ms, out);
        for (let p = 0; p < count; p++) {
          const across = Math.abs(out[p * 2 + 1]!);   // heading 0, so y IS the across offset
          expect(across + strip).toBeLessThanOrEqual(half + 1e-9);
        }
      }
    }
  });
});
```

Run: `cd packages/client && npx vitest run src/scenes/`
Expected: PASS — the appended describes plus every existing assertion in both files, unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/scenes/combat-visual.ts packages/client/src/scenes/combat-visual.test.ts packages/client/src/scenes/beam-style.test.ts packages/client/src/scenes/arena/world-style.ts
git commit -m "refactor(client): split the beam builders into a bake half and a spine, with identity tests"
```

Nothing draws differently yet: `beamDrawLayers` is still what `ShotRenderer` calls. Task 4 is where the switch happens.

---
### Task 2: The beam bake jobs

**Files:**
- Modify: `packages/client/src/render/bake.ts`, `packages/client/src/render/bake.test.ts`

**Interfaces:**
- Consumes: V1's `BakeGraphics`, `BakeJob`, `bakeJobs`, `packShelf`, `bakeAtlas`, `BakeTier`, `BAKE_SUPERSAMPLE`, `BAKE_SHEET_PX`, `BAKE_DEFAULT_TIER`, `bakedFrame`; V2's `worldBakeJobs`, `BakeJob.pad`, `worldFrameScale`, `BAKE_WORLD_PAD_PX`; Task 1's `flameFrameLayers`, `coneFanAtRest`, `auraRingAtRest`, `boltStripHalf`, `boltShaftStart`; `rectPoints` through `beamDrawLayers`.
- Produces:

```ts
// render/bake.ts
/** Texture pixels per world unit for the flame flipbook and its halo. */
export const BAKE_FLAME_SCALE: Record<BakeTier, number> = { low: 0.5, medium: 0.75, high: 0.75 };
/** Flipbook frames per tier (spec R21: 12 at Low, 24 above). */
export const FLAME_FRAMES: Record<BakeTier, number> = { low: 12, medium: 24, high: 24 };
/** Ticks each flipbook frame is held for, so the loop is the same 800 ms at every tier. */
export const FLAME_TICKS_PER_FRAME: Record<BakeTier, number> = { low: 4, medium: 2, high: 2 };
export function flameFrameScale(tier: BakeTier): number;      // 1 / BAKE_FLAME_SCALE[tier]
export function beamBakeJobs(ss: number, tier: BakeTier): BakeJob[];
export function bakedFlameFrame(index: number): string;        // `baked.world.flame.<nn>`
export const BAKED_FLAME_HALO: string;                         // `baked.world.flame.halo`
export function bakedBoltStripFrame(layerIndex: number): string;  // `baked.world.bolt.strip.<n>`
export const BAKED_BOLT_NOSE: string;                          // `baked.world.bolt.nose`
export const BAKED_TREMOR_CONE: string;                        // `baked.world.zone.tremor`
export const BAKED_AURA_RING: string;                          // `baked.world.zone.aura`
// bakeJobs becomes a three-way concatenation:
export function bakeJobs(ss: number, pill: PillHeights, tier: BakeTier = BAKE_DEFAULT_TIER): BakeJob[];
```

#### The three scales, and why they are not one

V2 bakes every world job at `BAKE_SUPERSAMPLE[tier]` and draws it at `worldFrameScale(ss) = 1/ss`, so a tier that bakes at 2 and renders at a device-pixel ratio of 2 draws it 1:1. Beams need two exceptions, both forced by what the thing is:

| Job | Texture pixels per world unit | Why |
|---|---|---|
| flame flipbook, heat halo | `BAKE_FLAME_SCALE`: **0.75** at Medium and High, 0.5 at Low | A flame is the one thing in the game with **no hard edge**. Every silhouette it has is soft, torn and moving, so magnifying it by a third is invisible — and it is 24 tiles, by far the largest thing on the sheet. At supersample 2 the twenty-four frames would be 9.7 M pixels against a 4.19 M-pixel sheet: not a preference, an impossibility. The arithmetic is printed below. |
| bolt strips | **1, at every tier** | A `Rope`'s half-width **is** its frame's half-height (`Rope.js:960`) measured in the same space as its points, and its points are world coordinates. One texture pixel per world unit is the only ratio at which the strip is as wide as the layer it is drawing, and it is why the ropes are never scaled. |
| bolt nose, tremor cone, aura ring | `BAKE_SUPERSAMPLE[tier]`, like every other world job | Ordinary sprites with hard edges, drawn through `worldFrameScale`. |

#### The sheet, computed

`afterburner` is a 55-degree cone reaching `WEAPON_TABLE.afterburner.range` = 220 units, so its half-angle is 27.5 degrees and its tip half-width is `220 × tan(27.5°)` = **114.5 units**. The flipbook's content is therefore 220 × 229.1 world units, and `BAKE_WORLD_PAD_PX` (4) is added on every side:

| Tier | Scale | Content px | Tile px | Frames | Per shelf | Shelves | Sheet height used |
|---|---|---|---|---|---|---|---|
| High / Medium | 0.75 | 165 × 172 | 173 × 180 | 24 | `floor(2048 / 173)` = 11 | 3 | **540** of 2048 |
| Low | 0.5 | 110 × 115 | 118 × 123 | 12 | `floor(1024 / 118)` = 8 | 2 | **246** of 1024 |

The other five jobs are small: the heat halo is one 173-pixel tile at Medium; `tremor`'s cone is baked at `TREMOR_BAKE_REACH` (128 units, 60-degree cone, tip half-width `128 × tan(30°)` = 73.9) so its tile is 264 × 304 at supersample 2; the aura is 264 × 264; the four bolt strips are 8 pixels wide by `2 × boltStripHalf` tall — 46, 34, 19 and 7 — and the nose is 53 × 66. Roughly **910 pixels of shelf height added at Medium**, against V1's six shelves and V2's two.

**`bake.test.ts`'s packing case is the authority, not this table.** V2's Handoff says so explicitly, and it is why the case exists: if the sheet does not fit, that test fails rather than the atlas silently truncating. If it does fail, the lever is `FLAME_FRAMES.medium` and `.high` down to 16 with `FLAME_TICKS_PER_FRAME` up to 3, which keeps the 800 ms loop and takes two shelves instead of three; do not reach for it speculatively.

#### The flipbook's cadence, derived

`WEAPON_BEAM_STYLES.afterburner`'s five layers animate at 1.2, 1.3, 1.4, 1.5 and 1.7 Hz. The flipbook is cut to one period of the **slowest**, 1.2 Hz — 833 ms — because a loop shorter than the slowest layer's period would visibly stutter that layer, while the faster ones only lose their own seam.

At 60 Hz, 24 frames held for 2 ticks each is a **48-tick, 800 ms loop**: 4 % faster than the authored 1.2 Hz, which Task 1's third test pins at under 5 %. Two ticks per frame is 33.3 ms, so the flame animates at 30 fps — half the display rate, which for a turbulent flame is the point at which frames stop reading as distinct pictures. At Low, 12 frames held for 4 ticks is the same 48-tick loop at 15 fps.

A flame's whole life is `range / speed + lifetimeMs` = `220 / 1100 × 1000 + 2000` = 2200 ms — **2.75 loops**, so the seam is crossed twice per press and must be as small as it is.

#### One length, not two

Spec R14 says "24 frames × 2 lengths at High". One length ships, and the reason is geometric rather than economical: **a cone's apex is at the muzzle**, so scaling its reach scales its spread by the same factor and produces a similar triangle sharing the apex — `BeamLayer`'s own comment in `combat-visual.ts` states it, and it is what `beam-style.test.ts` already relies on for containment. A uniform scale of one baked frame is therefore *exactly* the shorter flame's silhouette; what it does not scale is the absolute size of the noise structure, so a half-length flame has half-size tongues rather than the same tongues in a shorter cone.

That error exists only while the beam is growing, which is `range / speed` = 200 ms — **12 ticks of a 132-tick life, 9 %** — during which the flame is small and moving at 1100 units a second. Against it, the second length would double the sheet's largest item. Recorded in `## Handoff` as the one place this plan deviates from the spec's own number.

- [ ] **Step 1: Write the failing bake test**

```ts
// packages/client/src/render/bake.test.ts — appended
import {
  BAKED_AURA_RING, BAKED_BOLT_NOSE, BAKED_FLAME_HALO, BAKED_TREMOR_CONE,
  BAKE_FLAME_SCALE, FLAME_FRAMES, FLAME_TICKS_PER_FRAME,
  bakedBoltStripFrame, bakedFlameFrame, beamBakeJobs, flameFrameScale,
} from "./bake.js";
import { WEAPON_BEAM_STYLES } from "../scenes/combat-visual.js";
import { WEAPON_TABLE, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { BOLT_ROPE_POINTS } from "../scenes/arena/world-style.js";

describe("beamBakeJobs", () => {
  it("registers one frame per flipbook frame, plus the halo, strips, nose and two zones", () => {
    const jobs = beamBakeJobs(2, "medium");
    const names = jobs.map((job) => job.name);
    for (let i = 0; i < FLAME_FRAMES.medium; i++) expect(names).toContain(bakedFlameFrame(i));
    expect(names).toContain(BAKED_FLAME_HALO);
    expect(names).toContain(BAKED_BOLT_NOSE);
    expect(names).toContain(BAKED_TREMOR_CONE);
    expect(names).toContain(BAKED_AURA_RING);
    for (let i = 0; i < WEAPON_BEAM_STYLES.lance!.layers.length; i++) {
      expect(names).toContain(bakedBoltStripFrame(i));
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("bakes fewer, smaller flame frames at Low", () => {
    const low = beamBakeJobs(1, "low").filter((j) => j.name.startsWith("baked.world.flame."));
    const high = beamBakeJobs(2, "high").filter((j) => j.name.startsWith("baked.world.flame."));
    // 12 frames + the halo against 24 + the halo.
    expect(low).toHaveLength(FLAME_FRAMES.low + 1);
    expect(high).toHaveLength(FLAME_FRAMES.high + 1);
    expect(low[0]!.width).toBeLessThan(high[0]!.width);
  });

  it("sizes the flame tile from the weapon's own cone, not from a constant", () => {
    const [first] = beamBakeJobs(2, "medium");
    const reach = WEAPON_TABLE.afterburner.range;
    const halfAngle = ((WEAPON_TABLE.afterburner.hitbox as { angleDeg: number }).angleDeg * Math.PI) / 360;
    const pad = 4;
    expect(first!.width).toBe(Math.ceil(reach * BAKE_FLAME_SCALE.medium) + pad * 2);
    expect(first!.height).toBe(Math.ceil(2 * reach * Math.tan(halfAngle) * BAKE_FLAME_SCALE.medium) + pad * 2);
  });

  it("bakes the bolt strips at one texture pixel per world unit, whatever the tier", () => {
    const one = beamBakeJobs(1, "low").filter((j) => j.name.startsWith("baked.world.bolt.strip."));
    const two = beamBakeJobs(2, "high").filter((j) => j.name.startsWith("baked.world.bolt.strip."));
    expect(one.map((j) => j.height)).toEqual(two.map((j) => j.height));
    // A rope's width IS its frame's height, so the outermost strip must be the layer's own width.
    expect(one[0]!.height).toBe(Math.ceil(2 * boltStripHalf("lance", 0)));
  });

  it("draws every flame frame: five layers and eight embers, into the recorder", () => {
    const gfx = recorder();                       // the stub this file already uses
    const jobs = beamBakeJobs(2, "medium").filter((j) => j.name.startsWith("baked.world.flame.0"));
    jobs[0]!.draw(gfx);
    // afterburner authors 5 layers and `embers.count` flecks; every one is a fillPoints.
    const expected = WEAPON_BEAM_STYLES.afterburner!.layers.length + WEAPON_BEAM_STYLES.afterburner!.embers!.count;
    expect(gfx.calls.filter((c) => c.op === "fillPoints")).toHaveLength(expected);
  });

  it("keeps the whole atlas inside every tier's sheet", () => {
    // V2's case, re-run with the beam jobs in it. This is the authority on the sheet arithmetic.
    expect(packShelf(bakeJobs(2, PILL, "high"), 2048)).not.toBeNull();
    expect(packShelf(bakeJobs(2, PILL, "medium"), 2048)).not.toBeNull();
    expect(packShelf(bakeJobs(1, PILL, "low"), 1024)).not.toBeNull();
  });

  it("holds the flipbook loop to 800 ms at every tier", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      const loopTicks = FLAME_FRAMES[tier] * FLAME_TICKS_PER_FRAME[tier];
      expect(loopTicks).toBe(48);
      expect((loopTicks / TICK_RATE_HZ) * 1000).toBeCloseTo(800, 6);
    }
  });

  it("scales a flame sprite back to world units", () => {
    expect(flameFrameScale("medium")).toBeCloseTo(1 / BAKE_FLAME_SCALE.medium, 9);
    expect(flameFrameScale("low")).toBeCloseTo(2, 9);
  });
});
```

The existing `packShelf(bakeJobs(2, PILL), 2048)` case is **replaced** by the three-tier case above rather than kept beside it: `bakeJobs` now takes a tier, and a call that omits it defaults to `BAKE_DEFAULT_TIER`, which is what the two-argument form was testing.

Run: `cd packages/client && npx vitest run src/render/bake.test.ts`
Expected: FAIL — `beamBakeJobs` does not exist.

- [ ] **Step 2: Write the jobs**

```ts
// packages/client/src/render/bake.ts — appended, beside worldBakeJobs

/**
 * Texture pixels per world unit for the flame flipbook and its halo — the one world job that does
 * not use `BAKE_SUPERSAMPLE`.
 *
 * A flame has no hard edge: every silhouette it draws is torn, soft and moving, so magnifying it by
 * a third costs nothing a player can see. The flipbook is also by far the largest thing on the
 * sheet — at supersample 2 its twenty-four frames would be 9.7 million pixels against a 4.19
 * million-pixel sheet, so this is arithmetic rather than taste. See the plan's Task 2 table.
 */
export const BAKE_FLAME_SCALE: Record<BakeTier, number> = { low: 0.5, medium: 0.75, high: 0.75 };

/** Flipbook frames per tier (spec R21). */
export const FLAME_FRAMES: Record<BakeTier, number> = { low: 12, medium: 24, high: 24 };

/**
 * Ticks each flipbook frame is held for. Chosen so `FLAME_FRAMES x FLAME_TICKS_PER_FRAME` is 48
 * ticks — 800 ms at 60 Hz — at every tier, which is one period of `afterburner`'s SLOWEST authored
 * layer rate (1.2 Hz, 833 ms) to within 4 %. Low plays the same loop at half the frame rate rather
 * than at half the speed.
 */
export const FLAME_TICKS_PER_FRAME: Record<BakeTier, number> = { low: 4, medium: 2, high: 2 };

/** How much to scale a baked flame frame so it draws at its real world size. */
export function flameFrameScale(tier: BakeTier): number {
  return 1 / BAKE_FLAME_SCALE[tier];
}

const FLAME_PREFIX = "baked.world.flame.";
/** Built once at module load, never per frame — the `SWEEP_FRAME_NAMES` rule (V1). */
const FLAME_FRAME_NAMES: string[] = Array.from(
  { length: Math.max(...Object.values(FLAME_FRAMES)) },
  (_, i) => `${FLAME_PREFIX}${String(i).padStart(2, "0")}`,
);
export function bakedFlameFrame(index: number): string {
  return FLAME_FRAME_NAMES[index] ?? FLAME_FRAME_NAMES[0]!;
}
export const BAKED_FLAME_HALO = `${FLAME_PREFIX}halo`;

const BOLT_STRIP_NAMES: string[] = Array.from(
  { length: 8 },
  (_, i) => `baked.world.bolt.strip.${i}`,
);
export function bakedBoltStripFrame(layerIndex: number): string {
  return BOLT_STRIP_NAMES[layerIndex] ?? BOLT_STRIP_NAMES[0]!;
}
export const BAKED_BOLT_NOSE = "baked.world.bolt.nose";
export const BAKED_TREMOR_CONE = "baked.world.zone.tremor";
export const BAKED_AURA_RING = "baked.world.zone.aura";

/** Fraction of a bolt strip's half-width given to a soft alpha falloff — the ragged edge (R2). */
const BOLT_EDGE_SOFT = 0.18;
/** Alpha steps the falloff is drawn in. Eight is invisible at the strip's 46-pixel tallest. */
const BOLT_EDGE_STEPS = 8;
/** Alpha steps the flame's halo and the aura's wash are drawn in. */
const RADIAL_STEPS = 24;

/**
 * The beam jobs (spec R14, and the V3 row of §10). Every one runs a builder that already existed
 * and that `combat-visual.test.ts` already pins; nothing here decides what a beam looks like.
 */
export function beamBakeJobs(ss: number, tier: BakeTier): BakeJob[] {
  const jobs: BakeJob[] = [];
  const pad = BAKE_WORLD_PAD_PX;
  const flameScale = BAKE_FLAME_SCALE[tier];
  const frames = FLAME_FRAMES[tier];

  /* ---- the flame flipbook, and its halo ---------------------------------- */

  const flameDef = weaponDefOf("afterburner");
  const reach = flameDef.range;
  const halfAngle =
    flameDef.kind === "beam" && flameDef.hitbox.shape === "cone"
      ? (flameDef.hitbox.angleDeg * Math.PI) / 360
      : 0;
  const flameW = Math.ceil(reach * flameScale);
  const flameH = Math.ceil(2 * reach * Math.tan(halfAngle) * flameScale);

  for (let i = 0; i < frames; i++) {
    jobs.push({
      name: bakedFlameFrame(i),
      width: flameW + pad * 2,
      height: flameH + pad * 2,
      pad,
      draw(gfx) {
        // Bake-local: the apex sits on the tile's left edge, vertically centred, and the cone runs
        // along +x — which is what lets the sprite's origin be (0, 0.5) at the muzzle.
        const layers = flameFrameLayers("afterburner", reach, i, frames);
        for (const layer of layers) {
          gfx.fillStyle(layer.fill, 1);
          gfx.fillPoints(intoScratch(layer.points, flameScale, 0, flameH / 2), true);
        }
      },
    });
  }

  // The heat halo: the first thing the game has ever put on the Glow layer (V2's Handoff). A soft
  // additive disc at the flame's mid-length, radius half its reach — inside R8's 1.5x-the-hitbox
  // allowance, since the cone's own tip half-width is larger than this.
  const haloR = Math.ceil((reach / 2) * flameScale);
  jobs.push({
    name: BAKED_FLAME_HALO,
    width: haloR * 2 + pad * 2,
    height: haloR * 2 + pad * 2,
    pad,
    draw(gfx) {
      radialFalloff(gfx, haloR, haloR, haloR, 0xffffff, FLAME_HALO_ALPHA, RADIAL_STEPS);
    },
  });

  /* ---- the bolt: four strips at 1 texel per unit, plus one nose ---------- */

  const boltLayers = WEAPON_BEAM_STYLES.lance?.layers ?? [];
  for (const [i, layer] of boltLayers.entries()) {
    const stripH = Math.max(1, Math.ceil(2 * boltStripHalf("lance", i)));
    jobs.push({
      name: bakedBoltStripFrame(i),
      // Eight pixels wide: a `Rope` stretches its frame's U across the whole strip, so the length
      // carries no detail. The HEIGHT is the load-bearing number — it IS the rope's width.
      width: 8,
      height: stripH,
      draw(gfx) {
        // White, so the layer's colour is a GPU tint and a re-tune of `WEAPON_BEAM_STYLES.lance`
        // needs no new bake. The soft outer eighth is where the per-station width variation the
        // polygon used to carry now lives (R2).
        const half = stripH / 2;
        const soft = half * BOLT_EDGE_SOFT;
        gfx.fillStyle(0xffffff, 1);
        gfx.fillRect(0, soft, 8, stripH - soft * 2);
        for (let s = 1; s <= BOLT_EDGE_STEPS; s++) {
          const t = s / BOLT_EDGE_STEPS;
          gfx.fillStyle(0xffffff, 1 - t);
          gfx.fillRect(0, soft * (1 - t), 8, soft * 0.5);
          gfx.fillRect(0, stripH - soft * (1 - t) - soft * 0.5, 8, soft * 0.5);
        }
        void layer;
      },
    });
  }

  const noseLen = boltShaftStart("lance");
  const boltDef = weaponDefOf("lance");
  const boltW = boltDef.kind === "beam" && boltDef.hitbox.shape === "rect" ? boltDef.hitbox.width : 0;
  jobs.push({
    name: BAKED_BOLT_NOSE,
    width: Math.ceil(noseLen * ss) + pad * 2,
    height: Math.ceil(boltW * ss) + pad * 2,
    pad,
    draw(gfx) {
      // `rectPoints` itself, clipped to the nose: every layer's rounded origin AND its shaft over
      // this stretch, in the colours the table authors, exactly as the polygon drew them.
      for (const layer of beamDrawLayers("lance", 0, 0, 0, noseLen, 0, 0)) {
        gfx.fillStyle(layer.fill, 1);
        gfx.fillPoints(intoScratch(layer.points, ss, 0, (boltW * ss) / 2), true);
      }
    },
  });

  /* ---- the two zones ----------------------------------------------------- */

  const tremorHalf =
    weaponDefOf("tremor").kind === "beam" &&
    (weaponDefOf("tremor") as { hitbox: { shape: string; angleDeg?: number } }).hitbox.shape === "cone"
      ? ((weaponDefOf("tremor") as { hitbox: { angleDeg: number } }).hitbox.angleDeg * Math.PI) / 360
      : 0;
  const tremorW = Math.ceil(TREMOR_BAKE_REACH * ss);
  const tremorH = Math.ceil(2 * TREMOR_BAKE_REACH * Math.tan(tremorHalf) * ss);
  jobs.push({
    name: BAKED_TREMOR_CONE,
    width: tremorW + pad * 2,
    height: tremorH + pad * 2,
    pad,
    draw(gfx) {
      for (const layer of coneFanAtRest("tremor", TREMOR_BAKE_REACH)) {
        gfx.fillStyle(layer.fill, 1);
        gfx.fillPoints(intoScratch(layer.points, ss, 0, tremorH / 2), true);
      }
    },
  });

  const auraR = Math.ceil(AURA_BAKE_RADIUS * ss);
  jobs.push({
    name: BAKED_AURA_RING,
    width: auraR * 2 + pad * 2,
    height: auraR * 2 + pad * 2,
    pad,
    draw(gfx) {
      // White and tinted at draw time, because the aura takes its owner weapon's colour.
      const aura = auraRingAtRest(AURA_BAKE_RADIUS);
      gfx.fillStyle(0xffffff, aura.wash);
      gfx.fillCircle(auraR, auraR, auraR);
      gfx.lineStyle(Math.max(1, aura.ringWidth * ss), 0xffffff, aura.ring);
      // Inset by half the stroke so the ring's OUTER edge lands on the tile's edge, which is what
      // makes "the ring sits exactly on the hitbox" survive an arbitrary scale.
      gfx.strokeCircle(auraR, auraR, auraR - (aura.ringWidth * ss) / 2);
    },
  });

  return jobs;
}
```

Two small helpers beside them, both allocation-free after boot (they run at bake time, but the scratch pattern is the house style and keeps the recorder's assertions simple):

```ts
/** Scratch for a bake job's polygon, sized to the largest thing any beam builder produces. */
const BEAM_SCRATCH: Phaser.Math.Vector2[] = [];

/**
 * Move a builder's world-space points into bake-local texture pixels: scale, then shift so the
 * apex sits on the tile's left edge at `originY`.
 */
function intoScratch(
  points: readonly { x: number; y: number }[],
  scale: number,
  originX: number,
  originY: number,
): Phaser.Math.Vector2[] {
  while (BEAM_SCRATCH.length < points.length) BEAM_SCRATCH.push(new Phaser.Math.Vector2());
  for (let i = 0; i < points.length; i++) {
    BEAM_SCRATCH[i]!.set(originX + points[i]!.x * scale, originY + points[i]!.y * scale);
  }
  return BEAM_SCRATCH.length === points.length ? BEAM_SCRATCH : BEAM_SCRATCH.slice(0, points.length);
}

/** A soft radial disc, drawn as `steps` concentric fills. The cheapest gradient a `Graphics` has. */
function radialFalloff(
  gfx: BakeGraphics,
  cx: number,
  cy: number,
  radius: number,
  color: number,
  peakAlpha: number,
  steps: number,
): void {
  for (let s = steps; s >= 1; s--) {
    const t = s / steps;
    gfx.fillStyle(color, (peakAlpha / steps) * (1 - t + 1 / steps));
    gfx.fillCircle(cx, cy, radius * t);
  }
}
```

`BEAM_SCRATCH` is the one place this module still touches a Phaser value at runtime, and V2's Handoff asks that `bake.ts` keep `import type Phaser` only. Resolve it the way V2 resolved `flameScratch`: declare the scratch as `PointLike[]` (`{ x: number; y: number; set(x: number, y: number): void }`) with a tiny local class, and let `BakeGraphics.fillPoints` take that shape. `bake.test.ts`'s recorder already implements `fillPoints`, so nothing else changes.

Finally, `bakeJobs` becomes the three-way concatenation V2's Handoff describes:

```ts
export function bakeJobs(ss: number, pill: PillHeights, tier: BakeTier = BAKE_DEFAULT_TIER): BakeJob[] {
  return [...hudBakeJobs(ss, pill), ...worldBakeJobs(ss), ...beamBakeJobs(ss, tier)];
}
```

and `bakeAtlas` passes its own `tier` through: `packShelf(bakeJobs(ss, pill, tier), sheetPx)`.

Run: `cd packages/client && npx vitest run src/render/bake.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/render/bake.ts packages/client/src/render/bake.test.ts
git commit -m "feat(client): bake the flame flipbook, the bolt strips and the two zone sprites (R14)"
```

Still nothing draws differently: the atlas has eight new frame classes and no reader.

---

### Task 3: `render/beams.ts` — the retained beam objects

**Files:**
- Create: `packages/client/src/render/beams.ts`
- Modify: `packages/client/src/render/layers.ts` (one export), `packages/client/src/scenes/arena/world-style.ts` (already done in Task 1)

**Interfaces:**
- Consumes: V2's `Layer`, `depthOf`, `worldSprite`, `LAYER_BLEND`, `SpritePool`, `BAKED_ATLAS`, `bakedFrame`, `worldFrameScale`, `BAKE_SUPERSAMPLE`, `BAKE_DEFAULT_TIER`; Task 1's `boltSpineInto`, `boltShaftStart`, `flameFrameIndex`; Task 2's `bakedFlameFrame`, `BAKED_FLAME_HALO`, `bakedBoltStripFrame`, `BAKED_BOLT_NOSE`, `BAKED_TREMOR_CONE`, `BAKED_AURA_RING`, `flameFrameScale`, `FLAME_FRAMES`, `FLAME_TICKS_PER_FRAME`; `beamGrownExtent`, `beamFadeAlpha`, `weaponFillOf`, `isAuraInstance`, `WEAPON_BEAM_STYLES`.
- Produces (the ledger's `render/beams.ts` row):

```ts
export class BeamRenderer {
  constructor(scene: Phaser.Scene, tier?: BakeTier);
  begin(): void;
  /** An `afterburner`-style cone that animates: one flipbook sprite plus its additive halo. */
  flame(weaponId: string, x: number, y: number, angle: number, extent: number, spawnTick: number, tick: number, alpha: number): void;
  /** A `lance`-style rect beam: one nose sprite plus one rope per authored layer. */
  bolt(weaponId: string, x: number, y: number, angle: number, extent: number, nowMs: number, alpha: number): void;
  /** A static shape scaled to its extent: `tremor`'s cone, or an aura's ring. */
  zone(kind: "cone" | "aura", weaponId: string, x: number, y: number, angle: number, extent: number, alpha: number): void;
  end(): void;
  destroy(): void;
  /** Live rope vertices this frame — the bench census reads it (R2's ceiling, checkable). */
  readonly ropeVertices: number;
}
```

#### Which beam takes which path, decided from the tables and not from a list of ids

```ts
/**
 * The three beam looks, chosen from the weapon's own hitbox and style rather than from its id, so a
 * new beam row lands on the right path with no edit here.
 *
 *   disc hitbox                      -> `zone("aura")`      (magmablast's detonation)
 *   rect hitbox                      -> `bolt`             (lance)
 *   cone hitbox, any layer animates  -> `flame`            (afterburner)
 *   cone hitbox, nothing animates    -> `zone("cone")`     (tremor)
 *
 * A row with no `WEAPON_BEAM_STYLES` entry at all still falls to the flat `weaponFillOf` sprite the
 * shipped code fell to, which is `BAKED_SHOT_UNKNOWN` — the same grey dot, now a quad.
 */
export function beamPathOf(weaponId: string, isExplosion: boolean): "flame" | "bolt" | "aura" | "cone" | "none";
```

- [ ] **Step 1: Write the failing pure test**

`BeamRenderer` itself owns Phaser objects and cannot be unit-tested (no test imports Phaser), so what is tested is the routing and the arithmetic that decides what it draws. Both are pure and both live in `render/beams.ts` beside the class.

```ts
// packages/client/src/render/beams.test.ts
import { describe, expect, it } from "vitest";
import { WEAPON_TABLE } from "@motor-combat-moba/shared";
import { beamPathOf, boltRopeCount, flameSpriteScale } from "./beams.js";
import { BAKE_FLAME_SCALE, FLAME_FRAMES } from "./bake.js";
import { WEAPON_BEAM_STYLES } from "../scenes/combat-visual.js";

describe("beamPathOf", () => {
  it("routes every shipped beam from its own hitbox and style", () => {
    expect(beamPathOf("afterburner", false)).toBe("flame");
    expect(beamPathOf("lance", false)).toBe("bolt");
    expect(beamPathOf("tremor", false)).toBe("cone");
    // magmablast is a PROJECTILE whose EXPLOSION is a centre-origin disc beam.
    expect(beamPathOf("magmablast", true)).toBe("aura");
    expect(beamPathOf("magmablast", false)).toBe("none");
    expect(beamPathOf("predator", false)).toBe("none");
    expect(beamPathOf("not-a-weapon", false)).toBe("none");
  });

  it("would route a cone that gained a rate to the flipbook, and one that lost it to a sprite", () => {
    // The routing reads the style, so this is a property of the table, stated as a test rather
    // than a comment: `tremor` authors no flameHz today.
    expect(WEAPON_BEAM_STYLES.tremor!.flameHz ?? 0).toBe(0);
    expect(WEAPON_BEAM_STYLES.tremor!.layers.every((l) => (l.flameHz ?? 0) === 0)).toBe(true);
    expect(WEAPON_BEAM_STYLES.afterburner!.layers.some((l) => (l.flameHz ?? 0) > 0)).toBe(true);
  });
});

describe("boltRopeCount", () => {
  it("is one rope per authored layer", () => {
    expect(boltRopeCount("lance")).toBe(WEAPON_BEAM_STYLES.lance!.layers.length);
    expect(boltRopeCount("afterburner")).toBe(0);
  });
});

describe("flameSpriteScale", () => {
  it("scales the baked frame back to the beam's own extent", () => {
    const reach = WEAPON_TABLE.afterburner.range;
    // At full extent the sprite is the baked frame at its own world size.
    expect(flameSpriteScale("medium", reach, reach)).toBeCloseTo(1 / BAKE_FLAME_SCALE.medium, 9);
    // Half the extent is half the cone — a similar triangle sharing the apex.
    expect(flameSpriteScale("medium", reach / 2, reach)).toBeCloseTo(0.5 / BAKE_FLAME_SCALE.medium, 9);
    expect(FLAME_FRAMES.medium).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Write `render/beams.ts`**

```ts
// packages/client/src/render/beams.ts
import type Phaser from "phaser";
import { isWeaponId, weaponDefOf, instanceDefOf } from "@motor-combat-moba/shared";
import { BAKED_ATLAS } from "./atlas.js";
import {
  BAKED_AURA_RING, BAKED_BOLT_NOSE, BAKED_FLAME_HALO, BAKED_TREMOR_CONE,
  BAKE_DEFAULT_TIER, BAKE_FLAME_SCALE, BAKE_SUPERSAMPLE, FLAME_FRAMES, FLAME_TICKS_PER_FRAME,
  bakedBoltStripFrame, bakedFlameFrame, bakedFrame, flameFrameScale, worldFrameScale,
  type BakeTier,
} from "./bake.js";
import { Layer, depthOf, worldSprite } from "./layers.js";
import { SpritePool } from "./sprite-pool.js";
import { WEAPON_BEAM_STYLES, boltShaftStart, boltSpineInto, flameFrameIndex, weaponFillOf } from "../scenes/combat-visual.js";
import { BOLT_ROPE_POINTS, FLAME_HALO_ALPHA, AURA_BAKE_RADIUS, TREMOR_BAKE_REACH } from "../scenes/arena/world-style.js";

/**
 * Beams, retained (spec R3) and off the geometry path (R2).
 *
 * This class is the whole of what the rendering spec's V3 row ships, and what it deletes is the
 * 6.53 ms of CPU per frame §1 measured at the ceiling — 2.65 ms of `beamDrawLayers` plus 3.88 ms of
 * earcut inside Phaser's `FillPath` node, for twelve flames. After this the same twelve flames are
 * twelve frame indices and twelve quads.
 *
 * Three pools, all order-based (`SpritePool`'s contract, V2's Handoff): the Nth object of this frame
 * may belong to a different beam than the Nth of the last, so **every property is set on every
 * call** — texture, frame, position, rotation, scale, alpha and tint, without exception.
 *
 * The ropes are the one thing here that still builds geometry per frame, and they are what R2
 * allows: twenty points, forty vertices, with the detail in the texture. `ropeVertices` reports the
 * live total so the bench can hold that ceiling rather than trust it.
 */

export function beamPathOf(weaponId: string, isExplosion: boolean): "flame" | "bolt" | "aura" | "cone" | "none" {
  if (!isWeaponId(weaponId)) return "none";
  const def = instanceDefOf(weaponId, isExplosion);
  if (def.kind !== "beam") return "none";
  if (def.hitbox.shape === "disc") return "aura";
  const style = WEAPON_BEAM_STYLES[def.id];
  if (!style) return "none";
  if (def.hitbox.shape === "rect") return "bolt";
  const animates =
    (style.flameHz ?? 0) > 0 || style.layers.some((layer) => (layer.flameHz ?? 0) > 0);
  return animates ? "flame" : "cone";
}

/** How many ropes one bolt needs: one per authored layer. */
export function boltRopeCount(weaponId: string): number {
  if (!isWeaponId(weaponId)) return 0;
  const def = weaponDefOf(weaponId);
  if (def.kind !== "beam" || def.hitbox.shape !== "rect") return 0;
  return WEAPON_BEAM_STYLES[def.id]?.layers.length ?? 0;
}

/**
 * The scale a flame sprite is drawn at.
 *
 * `extent / bakedReach` is the cone's own similar-triangle scale — apex at the muzzle, so reach and
 * spread scale together — and `flameFrameScale` converts baked texture pixels back to world units.
 */
export function flameSpriteScale(tier: BakeTier, extent: number, bakedReach: number): number {
  if (bakedReach <= 0) return 0;
  return (extent / bakedReach) * flameFrameScale(tier);
}

/** The spine buffer, one per rope slot, allocated at boot and never resized (R6). */
const SPINE = new Float64Array(BOLT_ROPE_POINTS * 2);

export class BeamRenderer {
  private readonly flames: SpritePool<Phaser.GameObjects.Image>;
  private readonly halos: SpritePool<Phaser.GameObjects.Image>;
  private readonly zones: SpritePool<Phaser.GameObjects.Image>;
  private readonly ropes: SpritePool<Phaser.GameObjects.Rope>;
  private readonly unit: number;
  private ropeVertexCount = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly tier: BakeTier = BAKE_DEFAULT_TIER,
  ) {
    this.unit = worldFrameScale(BAKE_SUPERSAMPLE[tier]);
    this.flames = new SpritePool(() => worldSprite(scene, Layer.Shots, 2, ...bakedFrame(bakedFlameFrame(0))).setOrigin(0, 0.5));
    // The Glow band is ADD (V2's `LAYER_BLEND`), so the halo takes its blend from the band and never
    // sets one of its own — R4, and the reason a halo is a sprite on that layer rather than a
    // blend mode on the flame.
    this.halos = new SpritePool(() => worldSprite(scene, Layer.Glow, 0, ...bakedFrame(BAKED_FLAME_HALO)).setOrigin(0.5, 0.5));
    this.zones = new SpritePool(() => worldSprite(scene, Layer.Shots, 1, ...bakedFrame(BAKED_TREMOR_CONE)).setOrigin(0, 0.5));
    this.ropes = new SpritePool(() => {
      const [key, frame] = bakedFrame(bakedBoltStripFrame(0));
      const rope = scene.add.rope(0, 0, key, frame, BOLT_ROPE_POINTS, true);
      rope.setDepth(depthOf(Layer.Shots, 3)).setVisible(false);
      return rope;
    });
  }

  begin(): void {
    this.ropeVertexCount = 0;
    this.flames.begin();
    this.halos.begin();
    this.zones.begin();
    this.ropes.begin();
  }

  /**
   * One animating cone: a flipbook sprite anchored at the muzzle plus one additive halo.
   *
   * The frame comes from the instance's own age in ticks, never a wall clock — so every client
   * watching this flame sees the same frame of it and two flames born a tick apart are out of step
   * (R9). The shipped flame was wrong on both counts.
   */
  flame(
    weaponId: string, x: number, y: number, angle: number, extent: number,
    spawnTick: number, tick: number, alpha: number,
  ): void {
    const def = weaponDefOf(weaponId as never);
    if (def.kind !== "beam") return;
    const index = flameFrameIndex(spawnTick, tick, FLAME_FRAMES[this.tier], FLAME_TICKS_PER_FRAME[this.tier]);
    const scale = flameSpriteScale(this.tier, extent, def.range);
    const sprite = this.flames.next();
    const [key, frame] = bakedFrame(bakedFlameFrame(index));
    sprite.setTexture(key, frame);
    sprite.setPosition(x, y);
    sprite.setRotation(angle);
    sprite.setScale(scale);
    sprite.setAlpha(alpha);

    const halo = this.halos.next();
    const [hk, hf] = bakedFrame(BAKED_FLAME_HALO);
    halo.setTexture(hk, hf);
    // Mid-length along the beam's own axis, so the glow sits in the fire rather than at the nozzle.
    halo.setPosition(x + Math.cos(angle) * extent * 0.5, y + Math.sin(angle) * extent * 0.5);
    halo.setRotation(0);
    halo.setScale(scale);
    halo.setAlpha(alpha * FLAME_HALO_ALPHA);
    halo.setTint(weaponFillOf(weaponId));
  }

  /** One rect beam: the nose sprite, then one rope per authored layer along its own spine. */
  bolt(
    weaponId: string, x: number, y: number, angle: number, extent: number,
    nowMs: number, alpha: number,
  ): void {
    const start = boltShaftStart(weaponId);
    const nose = this.zones.next();
    const [nk, nf] = bakedFrame(BAKED_BOLT_NOSE);
    nose.setTexture(nk, nf);
    nose.setPosition(x, y);
    nose.setRotation(angle);
    nose.setScale(this.unit);
    nose.setAlpha(alpha);
    nose.setTint(0xffffff);
    if (extent <= start) return;

    const layers = WEAPON_BEAM_STYLES[weaponId as never]?.layers ?? [];
    for (let i = 0; i < layers.length; i++) {
      const count = boltSpineInto(weaponId, i, x, y, angle, extent, nowMs, SPINE);
      if (count < 2) continue;
      const rope = this.ropes.next();
      const [rk, rf] = bakedFrame(bakedBoltStripFrame(i));
      rope.setTexture(rk, rf);
      rope.setPosition(0, 0);
      rope.setRotation(0);
      rope.setScale(1);          // the points ARE world coordinates; see the strip's bake comment
      rope.setAlpha(alpha);
      rope.setTint(hexFill(layers[i]!.color));
      for (let p = 0; p < count; p++) {
        rope.points[p]!.set(SPINE[p * 2]!, SPINE[p * 2 + 1]!);
      }
      rope.setDirty();
      this.ropeVertexCount += count * 2;
    }
  }

  /** A static shape scaled to its extent: `tremor`'s cone, or an explosion's aura ring. */
  zone(
    kind: "cone" | "aura", weaponId: string,
    x: number, y: number, angle: number, extent: number, alpha: number,
  ): void {
    const sprite = this.zones.next();
    if (kind === "cone") {
      const [key, frame] = bakedFrame(BAKED_TREMOR_CONE);
      sprite.setTexture(key, frame);
      sprite.setOrigin(0, 0.5);
      sprite.setPosition(x, y);
      sprite.setRotation(angle);
      sprite.setScale((extent / TREMOR_BAKE_REACH) * this.unit);
    } else {
      const [key, frame] = bakedFrame(BAKED_AURA_RING);
      sprite.setTexture(key, frame);
      sprite.setOrigin(0.5, 0.5);
      sprite.setPosition(x, y);
      sprite.setRotation(0);
      sprite.setScale((extent / AURA_BAKE_RADIUS) * this.unit);
    }
    sprite.setAlpha(alpha);
    sprite.setTint(weaponFillOf(weaponId));
  }

  end(): void {
    this.flames.end();
    this.halos.end();
    this.zones.end();
    this.ropes.end();
  }

  get ropeVertices(): number {
    return this.ropeVertexCount;
  }

  destroy(): void {
    this.flames.destroy();
    this.halos.destroy();
    this.zones.destroy();
    this.ropes.destroy();
  }
}

/** `#RRGGBB` to a Phaser fill. The one-line twin of `combat-visual.ts`'s private `hexToFill`. */
function hexFill(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16);
}
```

**The zone pool serves three shapes**, which is why every call sets `setOrigin`, `setTexture`, `setRotation` and `setTint`: a bolt nose, a `tremor` cone and an aura ring can share a slot from one frame to the next. That is the `SpritePool` contract V2's Handoff spells out, and forgetting one setter is the exact bug it warns about.

**`hexFill` duplicates `combat-visual.ts`'s private `hexToFill`** rather than exporting it, for the reason that file's own `rotateBy` comment gives: a hex parse has no tuning knob in it to drift, and it is draw-only. If a third caller ever appears, export the original instead.

Run: `cd packages/client && npx vitest run src/render/beams.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/render/beams.ts packages/client/src/render/beams.test.ts
git commit -m "feat(client): BeamRenderer — flipbook flame, rope bolt, sprite zones (R2, R3)"
```

---
### Task 4: `ShotRenderer` sheds its `Graphics`

**Files:**
- Modify: `packages/client/src/scenes/arena/shot-renderer.ts`, `packages/client/CLAUDE.md`

**Interfaces:**
- Consumes: Task 3's `BeamRenderer`, `beamPathOf`; `beamGrownExtent`, `beamFadeAlpha`, `instanceDrawShape`, `hitboxesVisible`, `HITBOX_PX`, `HITBOX_STROKE`.
- Produces: `WORLD_GFX_DEBUG = "shots.debug"` replaces `WORLD_GFX_BEAMS`; `ShotRenderer`'s constructor, `render(frame)`, `invalidateVisuals()` and `destroy()` keep their signatures, so `ArenaScene` and `BenchScene` are **not edited by this task**.

#### The substitution

| In `shot-renderer.ts` after V2 | After V3 |
|---|---|
| `export const WORLD_GFX_BEAMS = "shots.beams";` | `export const WORLD_GFX_DEBUG = "shots.debug";` — the name changes because what the object is for changes; V2's Handoff names the three files that record the decision, and Task 5 edits all three |
| the field `private readonly beams: Phaser.GameObjects.Graphics`, created in the constructor at `depthOf(Layer.Shots, 1)` | `private debugGfx: Phaser.GameObjects.Graphics \| undefined` — **created lazily, the first time `hitboxesVisible(this.debug)` is true.** A tree with `?debug=1` unset therefore has *no* world `Graphics` at all, which is what makes the phase's gate ("`WORLD_CLEARS_ALLOWED` becomes `[]`") true rather than argued |
| the field initialisation | plus `private readonly beamRenderer = new BeamRenderer(scene);` |
| `render`'s first two lines, `const gfx = this.beams; gfx.clear();` | `this.beamRenderer.begin();` — and `this.debugGfx?.clear()` moved down into the debug branch |
| the `instance.kind === WeaponKind.BEAM` branch, `this.drawBeam(instance, frame, elapsedMs, nowMs, gfx); continue;` | the block below |
| the whole `drawBeam` method | **deleted**, with the aura branch, the polygon branch and the flat-fill fallback |
| the `if (hitboxesVisible(this.debug))` pass | unchanged in body; wrapped in the lazy-creation guard below |
| the imports of `beamDrawLayers`, `isAuraInstance`, `AURA_FILL_ALPHA`, `AURA_RING_WIDTH`, `weaponFillOf`, `pts` | deleted; the typecheck names them |
| `destroy()` | plus `this.beamRenderer.destroy(); this.debugGfx?.destroy();` |

- [ ] **Step 1: The beam branch**

```ts
      if (instance.kind === WeaponKind.BEAM) {
        // The extent the beam has grown to since the snapshot, exactly as the polygon path measured
        // it — `beamGrownExtent` is unchanged and is still the one answer to "how long is it now".
        const extent = beamGrownExtent(instance, elapsedMs);
        const alpha = beamFadeAlpha(
          instance.kind, instance.weaponId, instance.spawnTick, frame.tick, instance.isExplosion,
        );
        switch (beamPathOf(instance.weaponId, instance.isExplosion)) {
          case "flame":
            this.beamRenderer.flame(
              instance.weaponId, instance.x, instance.y, instance.angle, extent,
              instance.spawnTick, frame.tick, alpha,
            );
            break;
          case "bolt":
            this.beamRenderer.bolt(
              instance.weaponId, instance.x, instance.y, instance.angle, extent, nowMs, alpha,
            );
            break;
          case "cone":
            this.beamRenderer.zone("cone", instance.weaponId, instance.x, instance.y, instance.angle, extent, alpha);
            break;
          case "aura":
            this.beamRenderer.zone("aura", instance.weaponId, instance.x, instance.y, instance.angle, extent, alpha);
            break;
          case "none":
            // A beam row with no authored style. The shipped code drew one flat `weaponFillOf`
            // polygon here; a flat shape is the definition of a baked sprite, so it takes the same
            // grey-dot frame an unrecognised projectile takes and costs a quad instead of a fill.
            this.sprites.body(BAKED_SHOT_UNKNOWN, instance.x, instance.y, instance.angle, this.unit);
            break;
        }
        continue;
      }
```

`frame.tick` is the **local** tick after the netcode work's phase 3, which is what the flipbook index must be measured against: the flame on screen belongs to the world on screen. It is available on `RenderFrame` and needs nothing new.

- [ ] **Step 2: The debug pass, created only when it is wanted**

```ts
    // The ONLY `Graphics` the world can create, and only when `?debug=1` asked for it. Everything
    // else on the shot layer is a sprite or a rope now (spec R3). Created lazily so a tree with the
    // flag unset has no world `Graphics` at all — which is what `scripts/bench-arena.mjs`'s empty
    // `WORLD_CLEARS_ALLOWED` list asserts.
    if (hitboxesVisible(this.debug)) {
      const gfx = (this.debugGfx ??= this.scene.add
        .graphics()
        .setDepth(depthOf(Layer.Debug))
        .setName(WORLD_GFX_DEBUG));
      gfx.clear();
      gfx.lineStyle(HITBOX_PX, HITBOX_STROKE, 1);
      for (const instance of frame.instances) {
        if (!instance.alive) continue;
        const shape = instanceDrawShape(instance, elapsedMs);
        if (shape.kind === "circle") gfx.strokeCircle(shape.x, shape.y, shape.radius);
        else if (shape.points.length > 0) gfx.strokePoints(pts(shape.points), true);
      }
    }
```

Two changes beyond the laziness, both consequences of the beams leaving:

- **The depth moves from `depthOf(Layer.Shots, 1)` to `depthOf(Layer.Debug)`.** V2 put the outlines one step above the sprite bodies so a beam's polygon could draw over them from the same object; there is no polygon now, and `Layer.Debug` is the band V2 created for exactly this and left empty.
- **The outline is still `instanceDrawShape`'s**, which is the sim's own shape and therefore the ground truth for D19 — the whole point of keeping this pass. A flame drawn as a flipbook is now *checked* by the outline rather than being the outline, which is a stronger statement than the polygon path could make: `?debug=1` over a burning car is what proves the flipbook still sits inside its cone.

- [ ] **Step 3: `render`'s frame ends by closing the pools**

`this.sprites.end();` gains `this.beamRenderer.end();` beside it, before the debug pass, so the rope pool's tail is hidden in the same place every other pool's is.

- [ ] **Step 4: Update the client's own doc paragraph**

`packages/client/CLAUDE.md`. V2 rewrote the three-table paragraph's first sentence to say beams were the exception; they no longer are. Replace its last two sentences:

```markdown
Beams are baked too, and in three different ways because a beam is three different problems.
`afterburner` is a **flipbook** — `render/bake.ts` runs the same `conePoints`/`jetProfile` code the
old per-frame path ran, twenty-four times at boot, and the arena plays the strip from the
instance's own age in ticks. `lance` is a **rope**: one baked nose sprite plus one twenty-point
strip per authored layer along a spine that is still rebuilt every frame, because a bolt's tear is
the one beam shape that genuinely changes. `tremor` and the aura are plain sprites scaled to their
extent, because a cone's apex is at the muzzle and scaling its reach scales its spread with it.
Nothing in the world builds a filled polygon any more; the only `Graphics` the arena can create is
the `?debug=1` hitbox outline, and it is not created at all unless that flag is set.
```

Leave the `predator` and `lance` style paragraphs exactly as they are: every word of them is about `WEAPON_BEAM_STYLES`, which is unchanged.

- [ ] **Step 5: Verify by eye, and by the census**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena
npm run dev
```

Then, in a browser:

| Check | Where | What "right" looks like |
|---|---|---|
| the flame | Practice as Mirage, hold slot 3 | two cones, nose and tail, animating out of step with each other; the additive halo glowing through them; the whole thing inside the cone `?debug=1` draws |
| the bolt | `?dev=playground`, Bullseye, slot 3 | the 700 ms charge orb (V2's sprite), then a 1200-unit bolt with a rounded nose, a torn blue envelope and a straight white core |
| the zones | `?dev=playground` with `tremor` on a slot, and Mirage's `magmablast` into a wall | the bronze cone growing out over a second; the detonation's ring landing exactly on the outline `?debug=1` draws |
| no world `Graphics` | `?dev=bench`, then `window.__bench.census()` in the console | `worldGraphicsNames` contains only `arena.floor`; `worldClears` is `{}` |

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/scenes/arena/shot-renderer.ts packages/client/CLAUDE.md
git commit -m "feat(client): beams draw as sprites and ropes; the world's last per-frame Graphics is gone"
```

---

### Task 5: Measure it, guard it, write it down

**Files:**
- Modify: `packages/client/src/dev/BenchScene.ts`, `scripts/bench-arena.mjs`, `scripts/world-retained.test.mjs`, `scripts/bench-visual.mjs`, `docs/render-bench.md`, `docs/project-structure.md`, `docs/asset-pipeline.md`, `packages/server/playtest/README.md`

**Interfaces:**
- Consumes: V0's `BenchProbe`, `window.__bench`, `formatBenchRows`, `BENCH_ARENA_DEFAULTS`, `PerfReport`; V1/V2's `sceneCensus`, `SceneCensus`, `formatCensusRow`, `benchFailures`, `WORLD_GRAPHICS_ALLOWED`, `WORLD_CLEARS_ALLOWED`, `DRAW_CALL_CEILING`; Task 3's `BeamRenderer.ropeVertices`.
- Produces: `SceneCensus.worldRopeVertices`; `ROPE_VERTEX_CEILING` in `bench-arena.mjs`; the V3 row of `docs/render-bench.md`.

#### The census widens once more

V2's Handoff calls the census "a surface three phases widen: V1 creates it, V2 adds `worldGraphicsNames` and `worldClears`, V3 widens it again. Each phase appends fields and never renames one." V3 appends exactly one:

```ts
export interface SceneCensus {
  // …V1's and V2's fields, unchanged…
  /**
   * Live rope vertices in the world this frame. R2 caps a textured strip at 40 vertices, and a
   * `Rope` emits two per point (`Rope.js:962-993`), so this is the number that says whether the
   * bolt is still inside its budget — checkable rather than aspirational.
   */
  worldRopeVertices: number;
}
```

filled from `BeamRenderer.ropeVertices` through the `ShotRenderer` the bench scene already owns. `sceneCensus(game)`'s signature is unchanged.

- [ ] **Step 1: The three guard lists, and the gate**

`scripts/bench-arena.mjs`:

```js
/**
 * `Graphics` objects the world is allowed to own. After V3 this is the arena floor alone: it is
 * drawn ONCE at match start and never cleared, so it is not on the frame path at all (V2 Task 6
 * Step 4 explains why it is not baked). The `?debug=1` outline pass is not here because it does not
 * exist unless that flag is set, and the bench never sets it.
 */
const WORLD_GRAPHICS_ALLOWED = [WORLD_GFX_FLOOR];

/**
 * `Graphics` objects the world is allowed to CLEAR each frame. Empty, and that is the V3 gate:
 * "no per-frame `Graphics` on the world path except debug" is now a list with nothing in it rather
 * than a sentence somebody has to believe.
 */
const WORLD_CLEARS_ALLOWED = [];

/** R2's ceiling for one textured strip, times the most ropes the ceiling scenario can show. */
const ROPE_VERTEX_CEILING = 40 * 4 * 2;   // 40 per rope, 4 layers per bolt, 2 bolts at the ceiling
```

and one clause in `benchFailures`:

```js
  if (census.worldRopeVertices > ROPE_VERTEX_CEILING) {
    failures.push(
      `${browser}: ${census.worldRopeVertices} rope vertices in the world, over the ${ROPE_VERTEX_CEILING} ceiling ` +
        `(spec R2: a textured strip is at most 40 vertices, and a Rope emits two per point)`,
    );
  }
```

`formatCensusRow`'s second line gains ` ropes ${census.worldRopeVertices}v` after the `Graphics` names.

`scripts/world-retained.test.mjs` carries three lists whose union must cover every non-test `.ts` in `scenes/arena/`. Two edits:

- `WORLD_GRAPHICS_ALLOWED` loses `shot-renderer.ts` — it no longer creates a `Graphics` unconditionally — and the debug-allowed list gains it, because the lazy one it can create is a debug object.
- The retained list is where `render/beams.ts` would go, except that the scan covers `scenes/arena/` and this file is under `render/`. **Widen the scan to `render/` as well**, with `bake.ts` and `layers.ts` on the "may call `Graphics` methods" list (they take a `BakeGraphics`, not a scene object) and `beams.ts` on the retained list. That is the same "a new file fails the suite until somebody decides which it is" property the test already has, extended over the directory this phase's new file actually lives in.

- [ ] **Step 2: The ceiling scenario keeps two bolts alive**

`dev/BenchScene.ts`'s ceiling scenario is spec R24's: "six cars burning, two lances, forty instances, a scripted stream of hit and ram events, 400 particles". The two lances are already in it (V0 built the scenario against the spec) — verify by reading, and if the scenario spawns lance instances only briefly, extend their scripted lifetime so both bolts are alive for the whole ten-second window. **A ceiling that does not include the thing this phase changed measures the wrong frame**, and `lance` is the only rope in the game.

Nothing else about the scenario changes: the six burning cars are what §1 measured and what this phase's number is compared against.

- [ ] **Step 3: `bench-visual.mjs` measures the bake, not the frame**

V0's node microbenchmark measures the pure builders. Two of them — `beamDrawLayers` for `afterburner` and for `lance` — are no longer on the frame path, and R24 says the script now measures **bake** time, which is what the builders cost. Add two rows and re-label:

| Row | What it times | Why |
|---|---|---|
| `flameFrameLayers × FLAME_FRAMES.medium` | one whole flipbook | the largest single item of the boot bake; R25's budget for the whole bake is **< 150 ms** |
| `boltSpineInto × 4 layers × 1000` | the one builder still on the frame path | per-frame cost of the only geometry left in the world |

The existing `beamDrawLayers` rows stay, relabelled "bake-only (was per-frame before V3)", because they are still what the flipbook runs; keeping them is what lets the report show the before and after side by side.

- [ ] **Step 4: Record the numbers**

`docs/render-bench.md` gains a V3 row beside V0's, V1's and V2's, in the table's existing shape, and **the before/after that is this phase's whole point** stated above it:

```markdown
## V3 — Beams

Spec §1 measured the shipped beam path at the roster's realistic ceiling — six Mirages all burning
`afterburner`, twelve flame instances — at **2.65 ms building the geometry plus 3.88 ms of earcut
inside Phaser's `FillPath` node: 6.53 ms of CPU per frame**, against a whole JavaScript budget of
about 6 ms. Two `lance` bolts added ~3,300 vertices on top.

After V3 the same scene builds **no polygons at all**. Twelve flames are twelve frame indices and
twelve quads; two bolts are two quads plus eight ropes of forty vertices, and the only geometry
left in the world is the 160 spine points those ropes are laid along.

| Measurement | Before (V2) | After (V3) |
|---|---|---|
| Beam geometry, ceiling, per frame | 2.65 ms | (record) |
| Earcut inside `FillPath`, ceiling, per frame | 3.88 ms | 0.00 ms — nothing fills a path |
| World `Graphics` cleared per frame | 1 | **0** |
| Rope vertices at the ceiling | 0 | (record; ceiling 320) |
| Client JavaScript p95, ceiling, Chromium | (V2's) | (record; line < 5 ms) |
| Client JavaScript p95, ceiling, Firefox | (V2's) | (record) |
| Draw calls at the ceiling | (V2's) | (record; ceiling 16) |
| Boot bake | (V2's) | (record; line < 150 ms) |
```

Fill every `(record)` from the run in Step 5 — the page is the phase's evidence, and an unfilled cell is a phase that was not measured.

- [ ] **Step 5: Run it**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena
node scripts/bench-visual.mjs
node scripts/bench-arena.mjs
```

Expected: `bench-arena.mjs` green on Chromium **and** Firefox, with `benchFailures` empty — which means draw calls at or under 16, no world `Graphics` outside `arena.floor`, **no world clears at all**, and rope vertices at or under 320. Client JavaScript p95 under 5 ms at the ceiling on the reference machine (R25); if the machine running it is not that machine, record what it is beside the number, exactly as V0 recorded its baseline.

- [ ] **Step 6: The remaining pages**

`docs/project-structure.md`: add `render/beams.ts` under client `render/`.

`docs/asset-pipeline.md`: the baked-atlas section gains the eight new frame classes (`baked.world.flame.<nn>`, `.flame.halo`, `.bolt.strip.<n>`, `.bolt.nose`, `.zone.tremor`, `.zone.aura`) and one sentence: "The flame flipbook is the largest thing on the sheet and is the one job baked at less than the world supersample — 0.75 texture pixels per world unit — because a flame has no hard edge and twenty-four frames at supersample 2 would not fit a 2048-pixel sheet."

`packages/server/playtest/README.md`: the file quotes beam reach and flight figures in its `weapons.ts` paragraph. **None of those numbers moved** — this phase changes no weapon row — but the README also describes the client's per-frame cost in its prediction paragraph. Re-read both and correct only what this phase actually made untrue; do not update a probe.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/dev/BenchScene.ts scripts/bench-arena.mjs scripts/world-retained.test.mjs scripts/bench-visual.mjs docs/render-bench.md docs/project-structure.md docs/asset-pipeline.md packages/server/playtest/README.md
git commit -m "test(render): rope-vertex ceiling, an empty world-clears list, and V3's measured numbers"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Probe note for the summary.** This phase touches no probe file. `packages/server/playtest/` is unchanged except for prose in its README, and no probe measures anything the renderer does. **What it does move is the numbers spec §1 quotes**, and the execution guide §7 asks for a `playtest` run after V3 anyway — run `npm run playtest` and hand the report over, so the record shows the sim did not move when the drawing did.

---
## Acceptance

Spec §10, the V3 row: **Ships** — "flame flipbook, lance rope, tremor and aura sprites". **Deletes** — "the last per-frame `Graphics` in the world path; `beamDrawLayers` becomes bake-only". **Acceptance** — "no per-frame `Graphics` on the world path except debug; client JavaScript at the ceiling p95 < 5 ms on the reference machine" (§9's R25 line).

| Requirement | Demonstrated by |
|---|---|
| No per-frame `Graphics` on the world path except debug | `node scripts/bench-arena.mjs` — `benchFailures` empty on Chromium and Firefox, with `WORLD_CLEARS_ALLOWED` now `[]`, so **any** world `Graphics` that clears is a failure; and `window.__bench.census()` in `?dev=bench` showing `worldGraphicsNames: ["arena.floor"]` and `worldClears: {}` |
| `beamDrawLayers` is bake-only | `grep -rn "beamDrawLayers" packages/client/src/` — every hit is in `render/bake.ts`, `scenes/combat-visual.ts` or a `.test.ts`; none in `scenes/arena/` |
| Client JavaScript at the ceiling p95 < 5 ms | `node scripts/bench-arena.mjs`, the ceiling scenario's p95 column, recorded in `docs/render-bench.md`'s V3 row with the machine named beside it (R25's reference machine, or what was actually used) |
| Flame flipbook | `cd packages/client && npx vitest run src/render/bake.test.ts` — one frame per `FLAME_FRAMES[tier]`, sized from `WEAPON_TABLE.afterburner`'s own cone, drawn through `flameFrameLayers`; and `combat-visual.test.ts`'s identity case, which asserts a baked frame **is** what `beamDrawLayers` drew at that phase |
| The flipbook is deterministic and per-instance (R9) | `combat-visual.test.ts`'s "advances the flipbook from the instance's own age" case, including the assertion that two instances a tick apart show different frames |
| Lance rope, inside R2's 40 vertices | `cd packages/client && npx vitest run src/render/beams.test.ts src/scenes/combat-visual.test.ts` — `BOLT_ROPE_POINTS` is 20 and `boltSpineInto` writes exactly that many; `scripts/bench-arena.mjs`'s `ROPE_VERTEX_CEILING` (320 = 40 × 4 layers × 2 bolts) fails the run if the live total exceeds it |
| Tremor and aura sprites | the two `beamBakeJobs` cases plus `beamPathOf`'s routing test; and by eye per Task 4 Step 5, with `?debug=1` showing the aura's ring on the outline rather than near it |
| Containment (D19) survives the rope | `cd packages/client && npx vitest run src/scenes/beam-style.test.ts` — the appended case sweeps the crackle noise over two seconds and asserts `|drift| + stripHalf <= layerHalf` at every station of every layer |
| The atlas still fits every tier's sheet | `bake.test.ts`'s three-tier `packShelf` case — the authority on the arithmetic printed in Task 2 |
| Boot bake < 150 ms (R25) | `node scripts/bench-visual.mjs`'s flipbook row plus the bench scene's own bake timing, recorded in `docs/render-bench.md` |
| Draw calls at the ceiling ≤ 16 | `bench-arena.mjs`'s `DRAW_CALL_CEILING`, unchanged from V2 and now including the rope and halo batches |
| Nothing under `packages/client/src/match/` was touched, and no test imports Phaser | `git diff --stat development/main -- packages/client/src/match/` prints nothing; `grep -rln "from \"phaser\"" packages/client/src/**/*.test.ts` prints nothing |
| No balance table moved | `git diff development/main -- packages/shared/` prints **no changes**; `node --test scripts/turn-tuning-doc.test.mjs scripts/manual-page.test.mjs` passes with neither page edited and `npm run build:manual` never run |
| Everything else still green | `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena` |
| The sim did not move when the drawing did | `npm run playtest` (execution guide §7), the report handed to the user with the summary |

Record the measured numbers in `docs/render-bench.md`'s V3 row, with the date and the machine, when the phase is run.

## Handoff

Everything below is beyond the ledger. V4 is written against this section; V5 consumes the tier hooks.

### `scenes/combat-visual.ts` (extended)

| Export | Shape | For |
|---|---|---|
| `flameFrameLayers(weaponId, reach, frameIndex, frames)` | `DrawBeamLayer[]` | the bake, and nothing else. Delegates to `beamDrawLayers` at the phase frame `frameIndex` sits on, so the flipbook **is** the old picture rather than a copy of it |
| `flameFrameIndex(spawnTick, tick, frames, ticksPerFrame)` | `number` | the frame path. Deterministic per instance (R9) |
| `boltSpineInto(weaponId, layer, x, y, heading, extent, nowMs, out)` | `number` | the only geometry left in the world. Writes into a caller-owned `Float64Array`; allocates nothing |
| `boltStripHalf(weaponId, layer)` | `number` | the bake sizes the strip from it; the frame path bounds the drift by `layerHalf − it` |
| `boltShaftStart(weaponId)` | `number` | where the ropes begin and the nose sprite ends — the OUTERMOST layer's dome, so one nose frame serves every layer |
| `coneFanAtRest(weaponId, reach)`, `auraRingAtRest(radius)` | `DrawBeamLayer[]`, `{ ring, wash, ringWidth }` | the two static zone jobs |

**`rectPoints`, `conePoints`, `jetProfile`, `emberPolys` and `flowingNoise` are unchanged and are not deleted.** They are the authoring source R2 asks to keep, they are what the bake runs, and they are what `combat-visual.test.ts` and `beam-style.test.ts` still pin — so a re-tune of `WEAPON_BEAM_STYLES` is caught by the tests that have always caught it. What changed is that they run twenty-four times at boot instead of sixty times a second.

### `render/bake.ts` (extended for the third time)

`BAKE_FLAME_SCALE`, `FLAME_FRAMES`, `FLAME_TICKS_PER_FRAME`, `flameFrameScale(tier)`, `beamBakeJobs(ss, tier)`, `bakedFlameFrame(index)`, `BAKED_FLAME_HALO`, `bakedBoltStripFrame(layerIndex)`, `BAKED_BOLT_NOSE`, `BAKED_TREMOR_CONE`, `BAKED_AURA_RING`.

**`bakeJobs` now takes a tier**: `bakeJobs(ss, pill, tier = BAKE_DEFAULT_TIER)`, a three-way concatenation of `hudBakeJobs`, `worldBakeJobs` and `beamBakeJobs`. `bakeAtlas` passes its own tier through. **V5's tier work therefore has one more call site than V2's Handoff listed**: the three `worldFrameScale(BAKE_SUPERSAMPLE[BAKE_DEFAULT_TIER])` sites V2 named, plus `BeamRenderer`'s constructor default and `bakeJobs`' own default.

**Three scales now exist and are not interchangeable** — `BAKE_SUPERSAMPLE` for ordinary world jobs, `BAKE_FLAME_SCALE` (0.75 / 0.5) for the flipbook and its halo, and a hard 1 for the bolt strips because a `Rope`'s width **is** its frame's pixel height in the space its points are in. A new beam job must state which of the three it uses and why.

### `render/beams.ts` (new)

`BeamRenderer` with the ledger's constructor plus `begin`/`flame`/`bolt`/`zone`/`end`/`destroy` and `ropeVertices`; the pure `beamPathOf(weaponId, isExplosion)`, `boltRopeCount(weaponId)` and `flameSpriteScale(tier, extent, bakedReach)`.

**`beamPathOf` routes from the tables, never from a list of ids** — a disc hitbox is an aura, a rect is a bolt, a cone that animates is a flipbook and one that does not is a sprite — so a new beam row lands on the right path with no edit. Its test states the table property each branch depends on, so a `flameHz` added to `tremor` fails there rather than baking one arbitrary phase of an animation.

**The four pools are order-based**, so every call sets every property. The zone pool is shared by three shapes (bolt nose, `tremor` cone, aura ring) and therefore sets `setOrigin` too, which the other pools do not need to.

### `scenes/arena/shot-renderer.ts`

`WORLD_GFX_DEBUG = "shots.debug"` **replaces** `WORLD_GFX_BEAMS`, and the object it names is created **lazily**, only when `hitboxesVisible(this.debug)` is true, at `depthOf(Layer.Debug)` — the band V2 created and left empty. `ShotRenderer`'s constructor, `render(frame)`, `invalidateVisuals()` and `destroy()` are unchanged, so `ArenaScene` and `BenchScene` were not edited by this phase.

`drawBeam` is **deleted**, with the aura branch, the polygon branch and the flat-fill fallback. A beam row with no authored style now draws `BAKED_SHOT_UNKNOWN`, the same grey dot an unrecognised projectile draws.

### `dev/BenchScene.ts` and the guards

`SceneCensus.worldRopeVertices` is appended (V1 created the census, V2 added `worldGraphicsNames` and `worldClears`, this is V3's field; nothing was renamed). `scripts/bench-arena.mjs` gains `ROPE_VERTEX_CEILING` (320) and a `benchFailures` clause, and **`WORLD_CLEARS_ALLOWED` is now `[]`** — the phase's gate as a list rather than a sentence. `scripts/world-retained.test.mjs`'s scan is widened from `scenes/arena/` to `scenes/arena/` **and** `render/`, so `beams.ts` is covered and a future file under `render/` fails the suite until somebody classifies it.

### Where this plan departed from the spec, and why

Two places, both arithmetic rather than preference, both re-checkable:

1. **One flipbook length, not two (R14 says "24 frames × 2 lengths").** A cone's apex is at the muzzle, so a uniform scale of one frame is *exactly* the shorter flame's silhouette — `BeamLayer`'s own comment states the property and `beam-style.test.ts` already relies on it. What the second length would buy is noise structure at the right absolute size while the beam is growing, which is 12 ticks of a 132-tick life; what it costs is doubling the sheet's largest item. If a later pass wants it, `beamBakeJobs` grows a second inner loop over `[0.5, 1]` and `BeamRenderer.flame` picks by `extent / def.range`.
2. **Twenty rope points, not the catalogue's "24 segments".** A `Rope` emits two vertices per point (`Rope.js:962-993`), so 24 segments is 50 vertices and R2's ceiling for a textured strip is 40. The principle wins over the sketch.

### Deliberately deferred by V3

- **Everything that needs `RenderFrame.events` or particles.** The flame's ember emitter, the bolt's impact flash, `tremor`'s ground dust, the explosion's burst and blast decal, the muzzle flash, the car shadow, the status flipbooks, the hp bar's white flash: every §5 row marked P or D. **V4.** Note that the flame's *authored* embers are baked into the flipbook frames — they are part of `beamDrawLayers`' output and are clamped to the cone — so V4's "ember emitter (P)" row is a garnish on top of something that already draws, not the first embers in the game.
- **`Layer.Glow` now has exactly one tenant**, the flame's heat halo. `Layer.Decals`, `Layer.GroundFx` and `Layer.OverlayFx` are still empty and are still V4's.
- **Tiers.** `BeamRenderer` takes a `BakeTier` and defaults it, and `bakeJobs` now does too; nothing varies it. **V5.**
- **`mipmapFilter` and the dpr work** (R17, R17a). The baked atlas is power-of-two and the flipbook is baked below the world supersample, which is exactly the case mipmapping exists for — a flame minified at dpr 1 is the most visible thing on the sheet. **V5**, and worth doing there for this reason specifically.
- **A shader for the bolt.** §12's resolved question keeps shaders for genuinely per-pixel effects; a rope with a soft-edged strip is the cheap expression and this is it. Nothing here forecloses one later.
- **The arena floor stays a `Graphics`**, drawn once and never cleared, exactly as V2 left it. It is V5's "floor ambience" row.

## Self-review

**Spec coverage.** §1: the 6.53 ms this phase removes is quoted in the header, in `docs/render-bench.md`'s V3 section and in the bench-visual rows, with the before and after side by side (Task 5 Step 4). §2: `Rope` is used as the "textured strip along a path" the facility table describes, and its cost model — two vertices per point, the width from the frame's half-height — is read out of `Rope.js` rather than assumed (Tasks 1, 3, 5). §3: R2 is the whole plan (geometry only for the bolt's spine, as strips of ≤ 40 vertices, detail in the texture); R3 is the four pools; R4 is the halo taking `Layer.Glow`'s ADD rather than setting a blend mode; R6 is `SPINE`, `BEAM_SCRATCH` and the "every property every call" pool contract; R7 is Task 5; R8 is the halo's 0.22 alpha and half-reach radius; R9 is `flameFrameIndex` off `(spawnTick, tick)`, which is also the fix for §1's "two `lance` beams crackle in step and different clients see different frames". §5: the four beam rows of the catalogue, each with its class named (A, T, S, S). §6: R13 is honoured — every job runs an existing pure builder through a scratch `Graphics`, and `bake.test.ts` draws them into the recorder; R14 is the flipbook, baked from `jetProfile`/`conePoints` by way of `beamDrawLayers`, with the frame count and cadence derived from the authored rates and the tick. §7: no particles ship here, and the one row that could be mistaken for them — the flame's embers — is named as already-baked. §9: R24's ceiling scenario is checked to include both bolts (Task 5 Step 2); R25's two lines, the p95 and the boot bake, are the Acceptance table's second and eleventh rows. §10 and execution guide §5: the Acceptance table. §11: R1–R9 each have a task or a named test.

**Placeholder scan.** Every new module is printed in full. Every edit to an existing file is a named substitution table or a printed block with the statement it follows named. Every test is real code with values computed from the live tables — `WEAPON_TABLE.afterburner.range`, its cone's `angleDeg`, `WEAPON_BEAM_STYLES.lance.layers`, `WEAPON_TABLE.lance.hitbox.width`, `TICK_RATE_HZ` — and the four figures quoted in prose (114.5 units, 540 pixels, 800 ms, 320 vertices) are each derived in the text from the field they come from. The one number this plan states without deriving it is 6.53 ms, which is spec §1's own measurement and is cited as such.

**Type consistency.** `DrawBeamLayer` (`combat-visual.ts`, unchanged) is what `flameFrameLayers`, `coneFanAtRest` and `beamDrawLayers` all return and what every bake job's `draw` consumes. `BakeJob` and `BakeGraphics` (V1, extended by V2) are what `beamBakeJobs` produces and what `bake.test.ts`'s recorder implements; the `pad` field V2 added is what every beam job uses. `BakeTier` (V1, owned by `bake.ts` per the ledger) is the key of `BAKE_FLAME_SCALE`, `FLAME_FRAMES` and `FLAME_TICKS_PER_FRAME` and the parameter of `flameFrameScale`, `beamBakeJobs`, `bakeJobs`, `flameSpriteScale` and `BeamRenderer`'s constructor — one union, six consumers, and V5's `Tier` is already an alias of it. `SpritePool<T extends PoolSprite>` (V2) is instantiated four times here, once at `Phaser.GameObjects.Rope`, which satisfies `PoolSprite` through `setVisible` and `destroy`. `Layer` and `depthOf` (V2) are the only source of a depth in this plan, and `worldSprite` is the only way a world image is created — which is what `scripts/world-retained.test.mjs` greps for. `RenderInstance` (P, unchanged) supplies `spawnTick`, `isExplosion`, `extent` and `angle` to `beamPathOf`, `beamFadeAlpha` and `BeamRenderer` without a single new field: this phase adds nothing to the frame.
