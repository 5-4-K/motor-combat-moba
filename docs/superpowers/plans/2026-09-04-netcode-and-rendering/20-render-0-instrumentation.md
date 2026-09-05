# Rendering Phase V0: Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the client the measuring instruments every later rendering phase is judged against — a `?debug=perf` overlay that splits a frame into sim / build / draw / Phaser / render and counts GL draw calls, a `?dev=bench` scene that runs the visual ceiling with no server, `scripts/bench-visual.mjs` for the pure builders in node, `scripts/bench-arena.mjs` for the bench scene under Playwright on Chromium and Firefox — and record the baseline numbers.

**Architecture:** `render/perf-overlay.ts` hooks Phaser's four game-step events (`PRE_STEP`, `POST_STEP`, `PRE_RENDER`, `POST_RENDER`) and counts draw calls by wrapping `WebGLRenderer.drawElements` / `drawInstancedArrays`, the two methods every render node submits through; the scene adds three marks (`sim`, `build`, `draw`) between them. Statistics live in a pure, tested `render/perf-stats.ts`. `dev/bench-frame.ts` fabricates a `RenderFrame` for the ceiling (six cars, twelve `afterburner` flames, two `lance` bolts, forty instances) from `WEAPON_TABLE` ids; `dev/BenchScene.ts` draws it with the preparation plan's renderer classes unchanged, so the bench measures the code a match runs. The scripts print numbers; nothing asserts a number — the acceptance table (spec R25) is read by a person.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest in the node environment, Phaser 4.2.1, `node --test` for `scripts/*.test.mjs`, Playwright 1.62.1 (Chromium and Firefox), `tsx` to import a `.ts` builder from a node script, Vite `build --mode development` for a dev-tool-bearing client build.

**Spec:** [`../../specs/2026-09-04-client-rendering-architecture-design.md`](../../specs/2026-09-04-client-rendering-architecture-design.md) — §1 (the measurements), §9 R23 (perf overlay), R24 (bench scene, Playwright runner, `bench-visual.mjs`), R25 (acceptance table), §10 V0 row. Ledger: [`interfaces.md`](interfaces.md) §Client → Rendering (V-plans). Prior plan: [`01-prep-arena-scene-split-and-render-frame.md`](01-prep-arena-scene-split-and-render-frame.md), assumed landed (`match/render-frame.ts`, `scenes/arena/*`, `scripts/smoke-arena.mjs`, Playwright in root `devDependencies`). Netcode companion for the netgraph hook: [`../../specs/2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) §7 (`?debug=net`).

## Global Constraints

- Rebuild shared before testing (`npm run build -w @motor-combat-moba/shared`).
- Verify with root `npm test`, never a per-workspace run alone.
- `.js` import specifiers on every local import; shared is imported as `@motor-combat-moba/shared` and consumed as built `dist`.
- Nothing under `packages/client/src/match/` imports Phaser and no test imports Phaser. `dev/bench-frame.ts`, `render/perf-stats.ts` and `config/client-mode.ts` are Phaser-free for the same reason: their tests run under vitest's node environment.
- Do not touch `packages/server/playtest/` except to fix a compile break, and say loudly in the task's commit step which probe numbers your change moves. **This plan moves none:** it adds instrumentation around the sim and never edits `sim/`, a table, the tick order or the client's prediction; no probe reads a client scene or a script.
- Do not edit `docs/ideas/` or `docs/invariants/`.
- Commit after every task on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch off it).
- No magic numbers in logic: every threshold, window, position and count is a named constant (`PERF_OVERLAY_CONFIG`, `BENCH_CEILING`, `BENCH_LAYOUT`, `BENCH_ARENA_DEFAULTS`).
- The bench scene is dev-only: it renders `DEV_TOOL_MARKER` and is reached only through `dev/registry.ts`, so `scripts/build-release.mjs`'s `assertNoDevOnlyCode` strips it as it strips the playground. Never import it statically from anything that ships.
- No balance table, drive constant, `TICK_RATE_HZ`, weapon row, status row, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `AIM_CONFIG.lockRange` or `ARENA_WIDTH` changes here, so neither `npm run build:manual` nor `docs/turn-tuning.md` is owed an edit. If a diff touches one by accident, stop.

## File Structure

| File | Responsibility |
|---|---|
| `packages/client/src/config/client-mode.ts` (modify) | `debugFlags`, `hasDebugFlag`, `PERF_DEBUG_FLAG`; `isDebugEnabled` reads the same comma list |
| `packages/client/src/render/perf-stats.ts` (create) | Pure: `SampleRing`, `percentile`, `PerfRings`, `PerfReport`, `formatPerfLines`, `PERF_OVERLAY_CONFIG` |
| `packages/client/src/render/perf-overlay.ts` (create) | `PerfOverlay`: game-event hooks, draw-call wrap, the `Text`, `report()`, the netgraph hook |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | Construct the overlay under `?debug=perf`; three marks in `update`; `drawArena` delegates to `drawArenaFloor` |
| `packages/client/src/scenes/arena/arena-floor.ts` (create) | `drawArenaFloor`, the floor and camera setup extracted from `ArenaScene.drawArena` |
| `packages/client/src/dev/bench-frame.ts` (create) | Pure: `BENCH_CEILING`, `BENCH_LAYOUT`, `benchFrame(tick, nowMs, arena)` |
| `packages/client/src/dev/BenchScene.ts` (create) | `?dev=bench`: the ceiling drawn by the match renderers; publishes `window.__bench` |
| `packages/client/src/dev/registry.ts` (modify) | Register `bench` |
| `scripts/bench-visual.mjs` (create) | Node microbenchmark: `beamDrawLayers` × 12 flames, earcut over every polygon, the rest of the shot layer |
| `scripts/bench-arena.mjs` (create) | Playwright runner: dev-mode client build, LAN server, `?dev=bench` on Chromium and Firefox |
| `package.json` (modify) | `bench:visual`, `bench:arena`; `tsx` dev dependency |
| `docs/render-bench.md` (create), `CLAUDE.md`, `packages/client/CLAUDE.md`, `docs/project-structure.md` (modify) | How to run the instruments, and the V0 baseline numbers |

---

### Task 1: `?debug=perf` — debug flags are a comma list

**Files:**
- Modify: `packages/client/src/config/client-mode.ts:1-7`
- Test: `packages/client/src/config/client-mode.test.ts`

**Interfaces:**
- Produces: `debugFlags(search?: string): ReadonlySet<string>`; `hasDebugFlag(flag: string, search?: string): boolean`; `PERF_DEBUG_FLAG = "perf"`; `isDebugEnabled` keeps its signature and now means `hasDebugFlag("1")`. Tasks 3 and 5 consume `hasDebugFlag` and `PERF_DEBUG_FLAG`; the netcode stream's `?debug=net` overlay is expected to read `hasDebugFlag("net")` here, so `?debug=1,perf,net` turns on all three.

- [ ] **Step 1: Write the failing tests**

Append to `client-mode.test.ts`, extending the import to `{ PERF_DEBUG_FLAG, debugFlags, detectServerEndpoint, devToolId, hasDebugFlag, isDebugEnabled }`:

```ts
describe("debugFlags", () => {
  it("splits a comma list and trims each entry", () => {
    expect([...debugFlags("?debug=1,perf, net")]).toEqual(["1", "perf", "net"]);
  });

  it("is empty when absent, bare or blank", () => {
    expect(debugFlags("").size).toBe(0);
    expect(debugFlags("?debug").size).toBe(0);
    expect(debugFlags("?debug=,").size).toBe(0);
  });

  it("answers hasDebugFlag per entry and keeps isDebugEnabled meaning the '1' flag", () => {
    expect(hasDebugFlag(PERF_DEBUG_FLAG, "?debug=perf")).toBe(true);
    expect(hasDebugFlag(PERF_DEBUG_FLAG, "?debug=1")).toBe(false);
    expect(isDebugEnabled("?debug=1,perf")).toBe(true);
    expect(isDebugEnabled("?debug=perf")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/client && npx vitest run src/config/client-mode.test.ts`
Expected: FAIL — `debugFlags` is not exported.

- [ ] **Step 3: Replace the `isDebugEnabled` block (`client-mode.ts:1-7`)**

```ts
/** The `?debug=` entry that turns on the frame-time overlay (rendering spec R23). */
export const PERF_DEBUG_FLAG = "perf";

const NO_FLAGS: ReadonlySet<string> = new Set();

/**
 * Every developer overlay asked for in the URL, as `?debug=<a>,<b>`: `1` draws the car OBB outline,
 * `perf` the frame-time overlay, `net` the netgraph. One comma list rather than a flag per overlay,
 * so two can be on at once. A bare `?debug` or a blank entry asks for nothing.
 */
export function debugFlags(search: string = window.location.search): ReadonlySet<string> {
  const raw = new URLSearchParams(search).get("debug");
  if (!raw) return NO_FLAGS;
  const flags = new Set<string>();
  for (const entry of raw.split(",")) {
    const flag = entry.trim();
    if (flag) flags.add(flag);
  }
  return flags;
}

export function hasDebugFlag(flag: string, search: string = window.location.search): boolean {
  return debugFlags(search).has(flag);
}

/** `?debug=1` (alone or in the list) turns on the car OBB outline in the arena. */
export function isDebugEnabled(search: string = window.location.search): boolean {
  return hasDebugFlag("1", search);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/client && npx vitest run src/config/client-mode.test.ts`
Expected: PASS — the existing cases (`?debug`, `?debug=0`, `?debug=true` all false) still hold, since none of those lists contains the entry `1`.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/config/client-mode.ts packages/client/src/config/client-mode.test.ts
git commit -m "feat(client): ?debug= is a comma list of overlays; add the perf flag"
```

---

### Task 2: `render/perf-stats.ts` — the pure statistics

**Files:**
- Create: `packages/client/src/render/perf-stats.ts`
- Test: `packages/client/src/render/perf-stats.test.ts`

**Interfaces:**
- Produces (Tasks 3, 5 and `scripts/bench-arena.mjs` consume them):

```ts
export const PERF_OVERLAY_CONFIG: { x; y; fontPx; depth; refreshMs; windowFrames; drawCallsUnavailable }  // all number
export function percentile(sorted: ArrayLike<number>, length: number, p: number): number
export class SampleRing { constructor(capacity: number); push(v: number): void; readonly length: number; percentile(p: number): number; max(): number }
export type PerfChannel = "frame" | "js" | "sim" | "build" | "draw" | "phaser" | "render" | "draws"
export type PerfSample = Record<PerfChannel, number>
export interface PerfReport {
  frames: number;
  frameMs: { p50: number; p95: number };
  jsMs: { p50: number; p95: number };
  split: { sim: number; build: number; draw: number; phaser: number; render: number };   // p50 ms each
  drawCalls: { p50: number; max: number };   // PERF_OVERLAY_CONFIG.drawCallsUnavailable on Canvas
  textures: number;
  particles: number;   // 0 until V4's ParticleService reports
  tier: string;        // "medium" until V5's TierManager reports
}
export class PerfRings { constructor(windowFrames?: number); push(sample: PerfSample): void; report(textures: number, particles: number, tier: string): PerfReport; readonly frames: number }
export function formatPerfLines(report: PerfReport): string[]
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/client/src/render/perf-stats.test.ts
import { describe, expect, it } from "vitest";
import { PERF_OVERLAY_CONFIG, PerfRings, SampleRing, formatPerfLines, percentile, type PerfSample } from "./perf-stats.js";

const sample = (over: Partial<PerfSample> = {}): PerfSample => ({
  frame: 16.7, js: 3, sim: 0.5, build: 0.7, draw: 1.2, phaser: 0.3, render: 0.6, draws: 9, ...over,
});

describe("percentile", () => {
  it("is nearest-rank over the sorted prefix, and 0 over nothing", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 100, 50)).toBe(50);
    expect(percentile(sorted, 100, 95)).toBe(95);
    expect(percentile(sorted, 10, 95)).toBe(10);
    expect(percentile([], 0, 50)).toBe(0);
  });
});

describe("SampleRing", () => {
  it("keeps the newest `capacity` samples and reads percentiles off them without reordering", () => {
    const ring = new SampleRing(4);
    for (const v of [100, 1, 2, 3, 4]) ring.push(v);
    expect(ring.length).toBe(4);
    expect(ring.max()).toBe(4);
    expect(ring.percentile(50)).toBe(2);
    expect(ring.percentile(95)).toBe(4);
    ring.push(9); // overwrites the oldest (1), not the smallest-after-sort
    expect(ring.percentile(1)).toBe(2);
  });
});

describe("PerfRings", () => {
  it("reports p50/p95 of every channel and the counters it is handed", () => {
    const rings = new PerfRings(8);
    for (let i = 1; i <= 8; i++) rings.push(sample({ frame: i, js: i / 2, draws: i }));
    const report = rings.report(14, 0, "medium");
    expect(report.frames).toBe(8);
    expect(report.frameMs).toEqual({ p50: 4, p95: 8 });
    expect(report.jsMs).toEqual({ p50: 2, p95: 4 });
    expect(report.split).toEqual({ sim: 0.5, build: 0.7, draw: 1.2, phaser: 0.3, render: 0.6 });
    expect(report.drawCalls).toEqual({ p50: 4, max: 8 });
    expect([report.textures, report.particles, report.tier]).toEqual([14, 0, "medium"]);
  });

  it("defaults its window to PERF_OVERLAY_CONFIG.windowFrames", () => {
    const rings = new PerfRings();
    for (let i = 0; i < PERF_OVERLAY_CONFIG.windowFrames + 5; i++) rings.push(sample());
    expect(rings.frames).toBe(PERF_OVERLAY_CONFIG.windowFrames);
  });
});

describe("formatPerfLines", () => {
  it("prints three lines with one decimal, naming the draw-call gap on Canvas", () => {
    const rings = new PerfRings(4);
    rings.push(sample({ draws: PERF_OVERLAY_CONFIG.drawCallsUnavailable }));
    expect(formatPerfLines(rings.report(12, 0, "medium"))).toEqual([
      "frame 16.7 / 16.7 ms  js 3.0 / 3.0 ms  (p50 / p95, 1 frames)",
      "sim 0.5  build 0.7  draw 1.2  phaser 0.3  render 0.6  (p50 ms)",
      "draws n/a (canvas)  textures 12  particles 0  tier medium",
    ]);
    rings.push(sample({ draws: 11 }));
    expect(formatPerfLines(rings.report(12, 0, "medium"))[2]).toBe(
      "draws 11 (max 11)  textures 12  particles 0  tier medium",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/client && npx vitest run src/render/perf-stats.test.ts`
Expected: FAIL — cannot resolve `./perf-stats.js`.

- [ ] **Step 3: Write the module**

```ts
// packages/client/src/render/perf-stats.ts
/**
 * The numbers behind the `?debug=perf` overlay (rendering spec R23), Phaser-free so they can be
 * tested and so `scripts/bench-arena.mjs` reads the same `PerfReport` shape out of the page.
 * Everything on the per-frame path is preallocated: rings are typed arrays sized once, a percentile
 * sorts a scratch copy, and `PerfRings.push` allocates nothing (spec R6).
 */

export const PERF_OVERLAY_CONFIG = {
  /** Screen position of the text block, canvas pixels. */
  x: 8,
  y: 8,
  fontPx: 12,
  /** Above every HUD element — the overlay is layer 7 in spec §4. */
  depth: 1000,
  /**
   * How often the text re-rasterises. A `Text.setText` re-uploads a canvas texture (spec §1), so the
   * overlay refreshes at 4 Hz to keep its own cost off the numbers. V1 swaps it for `BitmapText`.
   */
  refreshMs: 250,
  /** Rolling window: 10 s at 60 Hz, the window the bench reports over (R24). */
  windowFrames: 600,
  /** The draw-call value reported on the Canvas renderer, where there are no GL draw calls. */
  drawCallsUnavailable: -1,
} as const;

/** Nearest-rank percentile (`p` in [0, 100]) over the first `length` entries of a sorted sequence. */
export function percentile(sorted: ArrayLike<number>, length: number, p: number): number {
  if (length <= 0) return 0;
  const rank = Math.ceil((p / 100) * length);
  return sorted[Math.min(length - 1, Math.max(0, rank - 1))]!;
}

/** A fixed-capacity ring of numbers answering a percentile and a max without allocating. */
export class SampleRing {
  private readonly values: Float64Array;
  private readonly scratch: Float64Array;
  private next = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.values = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  push(value: number): void {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  percentile(p: number): number {
    // Sort a copy: the ring's own order is its age order, which `push` relies on.
    const view = this.scratch.subarray(0, this.count);
    view.set(this.values.subarray(0, this.count));
    view.sort();
    return percentile(view, this.count, p);
  }

  max(): number {
    let best = 0;
    for (let i = 0; i < this.count; i++) if (this.values[i]! > best) best = this.values[i]!;
    return best;
  }
}

/**
 * The per-frame channels, all milliseconds except `draws`: `frame` is wall time between frames
 * (`game.loop.rawDelta`); `js` the whole step plus the whole render; `sim`, `build`, `draw` the
 * scene's own marks; `phaser` the rest of the step outside them; `render` `PRE_RENDER` to
 * `POST_RENDER`; `draws` GL draw calls or `drawCallsUnavailable`.
 */
export type PerfChannel = "frame" | "js" | "sim" | "build" | "draw" | "phaser" | "render" | "draws";
export const PERF_CHANNELS: readonly PerfChannel[] = ["frame", "js", "sim", "build", "draw", "phaser", "render", "draws"];
export type PerfSample = Record<PerfChannel, number>;

export interface PerfReport {
  frames: number;
  frameMs: { p50: number; p95: number };
  jsMs: { p50: number; p95: number };
  /** p50 of each bucket, so the five roughly add up to `jsMs.p50`. */
  split: { sim: number; build: number; draw: number; phaser: number; render: number };
  drawCalls: { p50: number; max: number };
  textures: number;
  /** Live particles: 0 until V4's `ParticleService` exists to report one. */
  particles: number;
  /** The quality tier: the literal "medium" until V5's `TierManager` exists to report one. */
  tier: string;
}

export class PerfRings {
  private readonly rings: Record<PerfChannel, SampleRing>;

  constructor(windowFrames: number = PERF_OVERLAY_CONFIG.windowFrames) {
    this.rings = {} as Record<PerfChannel, SampleRing>;
    for (const channel of PERF_CHANNELS) this.rings[channel] = new SampleRing(windowFrames);
  }

  get frames(): number {
    return this.rings.frame.length;
  }

  push(sample: PerfSample): void {
    for (const channel of PERF_CHANNELS) this.rings[channel].push(sample[channel]);
  }

  report(textures: number, particles: number, tier: string): PerfReport {
    const r = this.rings;
    return {
      frames: r.frame.length,
      frameMs: { p50: r.frame.percentile(50), p95: r.frame.percentile(95) },
      jsMs: { p50: r.js.percentile(50), p95: r.js.percentile(95) },
      split: {
        sim: r.sim.percentile(50),
        build: r.build.percentile(50),
        draw: r.draw.percentile(50),
        phaser: r.phaser.percentile(50),
        render: r.render.percentile(50),
      },
      drawCalls: { p50: r.draws.percentile(50), max: r.draws.max() },
      textures,
      particles,
      tier,
    };
  }
}

const ms = (value: number): string => value.toFixed(1);

/** The three lines the overlay shows, in the order R23 lists the counters. */
export function formatPerfLines(report: PerfReport): string[] {
  const draws =
    report.drawCalls.p50 === PERF_OVERLAY_CONFIG.drawCallsUnavailable
      ? "draws n/a (canvas)"
      : `draws ${report.drawCalls.p50} (max ${report.drawCalls.max})`;
  return [
    `frame ${ms(report.frameMs.p50)} / ${ms(report.frameMs.p95)} ms  js ${ms(report.jsMs.p50)} / ${ms(report.jsMs.p95)} ms  (p50 / p95, ${report.frames} frames)`,
    `sim ${ms(report.split.sim)}  build ${ms(report.split.build)}  draw ${ms(report.split.draw)}  phaser ${ms(report.split.phaser)}  render ${ms(report.split.render)}  (p50 ms)`,
    `${draws}  textures ${report.textures}  particles ${report.particles}  tier ${report.tier}`,
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/client && npx vitest run src/render/perf-stats.test.ts`
Expected: PASS (5 tests). In the `SampleRing` case the stored values are `[1, 2, 3, 4]`, so nearest-rank p50 of four is the 2nd (`2`) and p95 the 4th (`4`); after `push(9)` they are `[2, 3, 4, 9]` and p1 is `2`. In the second `formatPerfLines` call the two `draws` samples are `-1` and `11`, whose nearest-rank p50 is `11`.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/perf-stats.ts packages/client/src/render/perf-stats.test.ts
git commit -m "feat(client): perf-stats — rings, percentiles and the PerfReport shape for the perf overlay"
```

---

### Task 3: `PerfOverlay` and the three marks in `ArenaScene`

**Files:**
- Create: `packages/client/src/render/perf-overlay.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (the composer the preparation plan's Task 9 produced: its fields, `create`, `update`, `resetMatchState`)

**Interfaces:**
- Consumes: Task 1's `hasDebugFlag`, `PERF_DEBUG_FLAG`; Task 2's `PerfRings`, `PerfSample`, `PerfReport`, `formatPerfLines`, `PERF_OVERLAY_CONFIG`; `ArenaLayers.hud` from the preparation plan.
- Produces (the ledger's `PerfOverlay` plus the members Task 5 and the netgraph need):

```ts
export type PerfMark = "sim" | "build" | "draw";
export class PerfOverlay {
  constructor(scene: Phaser.Scene);
  frameStart(): void;
  mark(label: PerfMark): void;
  frameEnd(): void;
  /** N0's netgraph overlay hands its lines here to sit under the perf block; absent, nothing is drawn. */
  attachNetgraph(lines: () => readonly string[]): void;
  report(): PerfReport;
  readonly rendererKind: "webgl" | "canvas";
  /** Every object the overlay owns, for the caller to register with `ArenaLayers.hud`. */
  gameObjects(): Phaser.GameObjects.GameObject[];
  destroy(): void;
}
```

Where each counter comes from, verified in `node_modules/phaser` 4.2.1:

| Counter | Source |
|---|---|
| frame time | `game.loop.rawDelta` — `TimeStep.step` (`src/core/TimeStep.js:718-750`) sets it before calling `Game.step`, so reading it in `PRE_STEP` gives this frame's interval |
| step / render boundaries | `Game.step` (`src/core/Game.js:454-502`) emits `Phaser.Core.Events.PRE_STEP`, runs `scene.update`, emits `POST_STEP`, then `renderer.preRender()`, `PRE_RENDER`, `scene.render`, `renderer.postRender()`, `POST_RENDER` |
| draw calls | there is **no** counter in 4.2.1's `WebGLRenderer` or `RenderNodeManager`; every batch handler submits through `WebGLRenderer.drawElements` (`src/renderer/webgl/WebGLRenderer.js:2068`, "the primary render method") or `drawInstancedArrays` (`:2103`), so the overlay wraps those two on the renderer instance and counts calls |
| textures | `Object.keys(scene.textures.list).length` — `TextureManager.list` (`src/textures/TextureManager.js:100`) |
| particles / tier | the literals `0` and `"medium"` until V4 / V5 |

- [ ] **Step 1: Write the overlay**

```ts
// packages/client/src/render/perf-overlay.ts
import Phaser from "phaser";
import { PERF_OVERLAY_CONFIG, PerfRings, formatPerfLines, type PerfReport, type PerfSample } from "./perf-stats.js";

export type PerfMark = "sim" | "build" | "draw";

/** What the overlay prints until the phases that own the counters ship (V4 particles, V5 tiers). */
const PARTICLES_UNTIL_V4 = 0;
const TIER_UNTIL_V5 = "medium";

type DrawMethod = "drawElements" | "drawInstancedArrays";
type DrawFn = (...args: unknown[]) => void;
const DRAW_METHODS: readonly DrawMethod[] = ["drawElements", "drawInstancedArrays"];

/**
 * Counts GL draw calls by wrapping the two `WebGLRenderer` methods every render node submits
 * through (4.2.1 keeps no counter). The wrap is an own property shadowing the prototype method, so
 * `delete` restores it — reassigning the original would leave an own property a second overlay
 * would wrap twice. Returns the unpatch.
 */
function countDrawCalls(game: Phaser.Game, onDraw: () => void): () => void {
  if (game.config.renderType !== Phaser.WEBGL) return () => {};
  const renderer = game.renderer as unknown as Partial<Record<DrawMethod, DrawFn>>;
  for (const method of DRAW_METHODS) {
    const original = renderer[method];
    if (!original) continue;
    renderer[method] = function (this: unknown, ...args: unknown[]) {
      onDraw();
      return original.apply(this, args);
    };
  }
  return () => {
    for (const method of DRAW_METHODS) delete renderer[method];
  };
}

/**
 * The `?debug=perf` overlay (rendering spec R23). The scene brackets its `update` with
 * `frameStart()` … `mark()` … `frameEnd()`; the overlay hooks the game's step events for everything
 * outside that bracket. A frame with no `frameStart` still records frame, phaser and render time.
 */
export class PerfOverlay {
  readonly rendererKind: "webgl" | "canvas";
  private readonly game: Phaser.Game;
  private readonly text: Phaser.GameObjects.Text;
  private readonly rings = new PerfRings();
  private readonly sample: PerfSample = { frame: 0, js: 0, sim: 0, build: 0, draw: 0, phaser: 0, render: 0, draws: 0 };
  private readonly unpatch: () => void;
  private netgraph: (() => readonly string[]) | undefined;
  private stepStartMs = 0;
  private stepMs = 0;
  private sceneMs = 0;
  private frameStartMs = 0;
  private lastMarkMs = 0;
  private renderStartMs = 0;
  private drawCalls = 0;
  private lastRefreshMs = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.game = scene.game;
    this.rendererKind = this.game.config.renderType === Phaser.WEBGL ? "webgl" : "canvas";
    this.text = scene.add
      .text(PERF_OVERLAY_CONFIG.x, PERF_OVERLAY_CONFIG.y, "", {
        fontFamily: "monospace",
        fontSize: `${PERF_OVERLAY_CONFIG.fontPx}px`,
        color: "#ffffff",
        backgroundColor: "#000000b0",
      })
      .setScrollFactor(0)
      .setDepth(PERF_OVERLAY_CONFIG.depth);
    this.unpatch = countDrawCalls(this.game, () => {
      this.drawCalls += 1;
    });
    const events = this.game.events;
    events.on(Phaser.Core.Events.PRE_STEP, this.onPreStep, this);
    events.on(Phaser.Core.Events.POST_STEP, this.onPostStep, this);
    events.on(Phaser.Core.Events.PRE_RENDER, this.onPreRender, this);
    events.on(Phaser.Core.Events.POST_RENDER, this.onPostRender, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  frameStart(): void {
    this.frameStartMs = performance.now();
    this.lastMarkMs = this.frameStartMs;
  }

  /** Attributes the time since the previous mark (or `frameStart`) to `label`. */
  mark(label: PerfMark): void {
    const now = performance.now();
    this.sample[label] += now - this.lastMarkMs;
    this.lastMarkMs = now;
  }

  frameEnd(): void {
    this.sceneMs = performance.now() - this.frameStartMs;
  }

  attachNetgraph(lines: () => readonly string[]): void {
    this.netgraph = lines;
  }

  report(): PerfReport {
    return this.rings.report(Object.keys(this.scene.textures.list).length, PARTICLES_UNTIL_V4, TIER_UNTIL_V5);
  }

  gameObjects(): Phaser.GameObjects.GameObject[] {
    return [this.text];
  }

  destroy(): void {
    const events = this.game.events;
    events.off(Phaser.Core.Events.PRE_STEP, this.onPreStep, this);
    events.off(Phaser.Core.Events.POST_STEP, this.onPostStep, this);
    events.off(Phaser.Core.Events.PRE_RENDER, this.onPreRender, this);
    events.off(Phaser.Core.Events.POST_RENDER, this.onPostRender, this);
    this.unpatch();
    this.text.destroy();
  }

  private onPreStep(): void {
    this.stepStartMs = performance.now();
    this.sample.frame = this.game.loop.rawDelta;
  }

  private onPostStep(): void {
    this.stepMs = performance.now() - this.stepStartMs;
  }

  private onPreRender(): void {
    this.renderStartMs = performance.now();
    this.drawCalls = 0;
  }

  private onPostRender(): void {
    const now = performance.now();
    const s = this.sample;
    s.render = now - this.renderStartMs;
    s.js = this.stepMs + s.render;
    // What Phaser did in the step outside the scene's own bracket: input, tweens, other scenes.
    s.phaser = Math.max(0, this.stepMs - this.sceneMs);
    s.draws = this.rendererKind === "webgl" ? this.drawCalls : PERF_OVERLAY_CONFIG.drawCallsUnavailable;
    this.rings.push(s);
    s.sim = s.build = s.draw = 0;
    this.sceneMs = 0;

    if (now - this.lastRefreshMs >= PERF_OVERLAY_CONFIG.refreshMs) {
      this.lastRefreshMs = now;
      const lines = formatPerfLines(this.report());
      if (this.netgraph) lines.push(...this.netgraph());
      this.text.setText(lines);
    }
  }
}
```

`Phaser.Core.Events.PRE_STEP` and friends are the string constants at `types/phaser.d.ts:6576-6601`; `game.config.renderType` (`:6032`) is `Phaser.WEBGL` (`2`) once Phaser has resolved `AUTO`; `TextureManager.list` is typed `object`, which `Object.keys` accepts.

- [ ] **Step 2: Wire the overlay into `ArenaScene`**

Imports — add `PERF_DEBUG_FLAG, hasDebugFlag` to the `../config/client-mode.js` import and `import { PerfOverlay } from "../render/perf-overlay.js";`. Fields — after `private layers: ArenaLayers | undefined;` add `private perf: PerfOverlay | undefined;`. In `create`, immediately after `this.layers = new ArenaLayers(this);`:

```ts
if (hasDebugFlag(PERF_DEBUG_FLAG)) {
  this.perf = new PerfOverlay(this);
  for (const obj of this.perf.gameObjects()) this.layers.hud(obj);
}
```

In `update`, insert against the preparation plan's body:

| After this line of the preparation plan's `update` | Insert |
|---|---|
| `if (!room \|\| !this.arena \|\| !net) return;` | `this.perf?.frameStart();` |
| `if (pumped.activeInput) this.banners?.hideIdleWarning();` | `this.perf?.mark("sim");` |
| `this.lastFrame = frame;` | `this.perf?.mark("build");` |
| `this.hudRenderer?.render(frame, this.spectate?.hudTarget(frame) ?? frame.localSessionId);` | `this.perf?.mark("draw");` then `this.perf?.frameEnd();` |

`syncBanners` builds a second frame before `pumpInput` runs, and that cost lands in `sim`; it is small and it is what the game does, so the bucket is honest — Task 8's doc says so. In `resetMatchState`, before `this.layers = undefined;`, add `this.perf?.destroy(); this.perf = undefined;`.

- [ ] **Step 3: Typecheck and the client suite**

Run: `cd packages/client && npm run typecheck && npx vitest run`
Expected: typecheck clean; every client test green (no test imports the overlay).

- [ ] **Step 4: Look at it**

Run `npm run dev`, open `http://localhost:5173/?debug=perf`, Practice → Start. Expected: three monospace lines top-left refreshing four times a second, `draws` a small integer, `sim`/`build`/`draw` non-zero once the match runs, `textures` in the teens. `?debug=1,perf` shows hitboxes and the overlay together.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/perf-overlay.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(client): ?debug=perf overlay — frame split, draw calls, textures (R23)"
```

---

### Task 4: `dev/bench-frame.ts` — the ceiling as a pure `RenderFrame`

**Files:**
- Create: `packages/client/src/dev/bench-frame.ts`
- Test: `packages/client/src/dev/bench-frame.test.ts`

**Interfaces:**
- Consumes: `RenderFrame`, `RenderCar`, `RenderInstance`, `RenderSlot` (preparation plan Task 1); `weaponDefOf`, `slotsOf`, `hpOf`, `muzzleOf`, `COLOR_TABLE`, `WeaponKind`, `PlayerStatus`, `RoomPhase`, `GameMode`, `ArenaDef` from shared.
- Produces (Task 5 draws it; `scripts/bench-visual.mjs` restates the same counts):

```ts
export const BENCH_CEILING: { cars: 6; afterburners: 12; lances: 2; predators: 6; thumpers: 6; magmablasts: 6; pepperboxes: 8 }
export const BENCH_INSTANCE_COUNT: number   // 40
export const BENCH_LAYOUT: { carRing; shotRing; carOrbitRadPerTick; shotOrbitRadPerTick; lanceX; lanceYs; beamAgeTicks }
export function benchFrame(tick: number, nowMs: number, arena: ArenaDef): RenderFrame
```

The ceiling is a superposition, not a legal match: the six cars cycle through the three chassis so every silhouette is drawn, and instances are fabricated by weapon id without regard to who could carry them. Twelve `afterburner` flames sit at the two muzzles (`muzzles: [0, 180]`) of every car; the two `lance` bolts are fixed 1200-unit beams across the floor (a lance's `attached: true` matters to the sim, not the drawing); twenty-six projectiles orbit an outer ring. `12 + 2 + 6 + 6 + 6 + 8 = 40`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/dev/bench-frame.test.ts
import { describe, expect, it } from "vitest";
import { ACTIVE_ARENA_ID, WeaponKind, getArena, isWeaponId, weaponDefOf } from "@motor-combat-moba/shared";
import { beamFadeAlpha } from "../scenes/combat-visual.js";
import { BENCH_CEILING, BENCH_INSTANCE_COUNT, benchFrame } from "./bench-frame.js";

const arena = getArena(ACTIVE_ARENA_ID);
const count = (frame: ReturnType<typeof benchFrame>, weaponId: string) =>
  frame.instances.filter((i) => i.weaponId === weaponId).length;

describe("benchFrame", () => {
  it("spawns the ceiling: six cars and forty instances in the spec's mix", () => {
    const frame = benchFrame(100, 0, arena);
    expect(frame.cars).toHaveLength(BENCH_CEILING.cars);
    expect(frame.instances).toHaveLength(BENCH_INSTANCE_COUNT);
    expect(BENCH_INSTANCE_COUNT).toBe(40);
    expect(count(frame, "afterburner")).toBe(BENCH_CEILING.afterburners);
    expect(count(frame, "lance")).toBe(BENCH_CEILING.lances);
    expect(count(frame, "predator") + count(frame, "thumper") + count(frame, "magmablast") + count(frame, "pepperbox")).toBe(26);
    for (const instance of frame.instances) expect(isWeaponId(instance.weaponId)).toBe(true);
  });

  it("draws every beam at full extent and full alpha", () => {
    const frame = benchFrame(100, 0, arena);
    for (const instance of frame.instances) {
      if (instance.kind !== WeaponKind.BEAM) continue;
      expect(instance.extent).toBe(weaponDefOf(instance.weaponId as "afterburner" | "lance").range);
      expect(beamFadeAlpha(instance.kind, instance.weaponId, instance.spawnTick, frame.tick, false)).toBe(1);
    }
  });

  it("is a match frame: one local car, sorted session ids, every chassis, all on the field", () => {
    const frame = benchFrame(100, 0, arena);
    const ids = frame.cars.map((c) => c.sessionId);
    expect(ids).toEqual([...ids].sort());
    expect(frame.cars.filter((c) => c.isLocal).map((c) => c.sessionId)).toEqual([frame.localSessionId]);
    expect(frame.cars.every((c) => c.onField && c.alive && c.weapons.length === 3)).toBe(true);
    expect(frame.cars.map((c) => c.carId)).toEqual(["mirage", "bullseye", "bastion", "mirage", "bullseye", "bastion"]);
    expect(frame.events).toEqual([]);
    expect(frame.arenaId).toBe(arena.id);
  });

  it("keeps cars and projectiles inside the arena as the rings turn, deterministically in tick", () => {
    for (const tick of [0, 250, 1000, 4000]) {
      const frame = benchFrame(tick, 0, arena);
      for (const car of frame.cars) {
        expect(car.pose.x).toBeGreaterThan(0);
        expect(car.pose.x).toBeLessThan(arena.width);
        expect(car.pose.y).toBeGreaterThan(0);
        expect(car.pose.y).toBeLessThan(arena.height);
      }
      for (const instance of frame.instances) {
        if (instance.kind === WeaponKind.BEAM) continue;
        expect(instance.x).toBeGreaterThan(0);
        expect(instance.x).toBeLessThan(arena.width);
      }
    }
    expect(benchFrame(7, 123, arena).cars).toEqual(benchFrame(7, 456, arena).cars);
    expect(benchFrame(7, 0, arena).cars[0]!.pose.x).not.toBe(benchFrame(8, 0, arena).cars[0]!.pose.x);
    expect(benchFrame(7, 999, arena).nowMs).toBe(999);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/client && npx vitest run src/dev/bench-frame.test.ts`
Expected: FAIL — cannot resolve `./bench-frame.js`.

- [ ] **Step 3: Write the builder**

```ts
// packages/client/src/dev/bench-frame.ts
import {
  COLOR_TABLE, GameMode, PlayerStatus, RoomPhase, WeaponKind, hpOf, muzzleOf, slotsOf, weaponDefOf,
  type ArenaDef, type CarId, type SimBody, type WeaponId,
} from "@motor-combat-moba/shared";
import type { RenderCar, RenderFrame, RenderInstance, RenderSlot } from "../match/render-frame.js";

/**
 * The visual ceiling the rendering spec measures against (§1, R24): six cars, every one burning
 * `afterburner` from both muzzles, two `lance` bolts, and enough projectiles to make forty
 * instances. A superposition, not a legal match — nobody checks who could carry what.
 */
export const BENCH_CEILING = {
  cars: 6, afterburners: 12, lances: 2, predators: 6, thumpers: 6, magmablasts: 6, pepperboxes: 8,
} as const;

export const BENCH_INSTANCE_COUNT =
  BENCH_CEILING.afterburners + BENCH_CEILING.lances + BENCH_CEILING.predators +
  BENCH_CEILING.thumpers + BENCH_CEILING.magmablasts + BENCH_CEILING.pepperboxes;

/** Where things sit, in world units and radians per tick. Rings are centred on the arena. */
export const BENCH_LAYOUT = {
  carRing: 200,
  shotRing: 300,
  carOrbitRadPerTick: 0.006,
  shotOrbitRadPerTick: 0.02,
  /** The two lances start here and run their full `range` to the right. */
  lanceX: 40,
  lanceYs: [300, 420],
  /** A beam this many ticks old is past its spawn tick and still at full alpha (`beamFadeAlpha`). */
  beamAgeTicks: 2,
} as const;

/** The chassis order around the ring — every silhouette drawn, twice. */
const CHASSIS_CYCLE: readonly CarId[] = ["mirage", "bullseye", "bastion"];
const LOCAL_CAR = 0;
const TWO_PI = Math.PI * 2;

const body = (x: number, y: number, angle: number): SimBody => ({
  x, y, angle, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0,
  authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
});

const sessionIdOf = (index: number): string => `bench-${index}`;

function onRing(index: number, count: number, radius: number, radPerTick: number, tick: number, arena: ArenaDef) {
  const theta = (TWO_PI * index) / count + tick * radPerTick;
  return {
    x: arena.width / 2 + Math.cos(theta) * radius,
    y: arena.height / 2 + Math.sin(theta) * radius,
    // Heading along the ring, so a car faces the way it moves and a shot flies where it points.
    angle: theta + Math.PI / 2,
  };
}

function benchCar(index: number, tick: number, arena: ArenaDef): RenderCar {
  const carId = CHASSIS_CYCLE[index % CHASSIS_CYCLE.length]!;
  const at = onRing(index, BENCH_CEILING.cars, BENCH_LAYOUT.carRing, BENCH_LAYOUT.carOrbitRadPerTick, tick, arena);
  const pose = body(at.x, at.y, at.angle);
  const weapons: RenderSlot[] = slotsOf(carId).map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
  }));
  return {
    sessionId: sessionIdOf(index),
    isLocal: index === LOCAL_CAR,
    status: PlayerStatus.IN_MATCH,
    onField: true,
    alive: true,
    phased: false,
    pose,
    serverPose: pose,
    carId,
    colorId: index % COLOR_TABLE.length,
    name: `Bench ${index + 1}`,
    team: 0,
    joinedAtTick: index,
    hp: hpOf(carId),
    diedAtTick: 0,
    kills: index,
    deaths: 0,
    killedBySessionId: "",
    // The local car locks the next car round, so the bracket is drawn.
    lockTargetSessionId: index === LOCAL_CAR ? sessionIdOf(1) : "",
    statuses: [],
    weapons,
    level: 1,
    switchLockUntilTick: 0,
    pendingUntilTick: 0,
    lastFiredSlot: -1,
    lastProcessedInputSeq: 0,
  };
}

function instance(id: number, owner: string, weaponId: WeaponId, x: number, y: number, angle: number, tick: number): RenderInstance {
  const def = weaponDefOf(weaponId);
  return {
    id: `bench-shot-${id}`,
    ownerSessionId: owner,
    weaponId,
    kind: def.kind === "beam" ? WeaponKind.BEAM : WeaponKind.PROJECTILE,
    x,
    y,
    angle,
    // A beam is drawn fully grown; a projectile's extent is unused by the drawing.
    extent: def.kind === "beam" ? def.range : 0,
    spawnTick: tick - BENCH_LAYOUT.beamAgeTicks,
    alive: true,
    isExplosion: false,
  };
}

/** One frame of the ceiling. Pure in `tick`; `nowMs` only feeds the crackle clock. */
export function benchFrame(tick: number, nowMs: number, arena: ArenaDef): RenderFrame {
  const cars: RenderCar[] = [];
  for (let i = 0; i < BENCH_CEILING.cars; i++) cars.push(benchCar(i, tick, arena));

  const instances: RenderInstance[] = [];
  let next = 0;
  // Flames: both muzzles of every car (`afterburner.muzzles` is `[0, 180]`).
  for (const car of cars) {
    const fore = muzzleOf(car.pose);
    const aft = muzzleOf({ x: car.pose.x, y: car.pose.y, angle: car.pose.angle + Math.PI });
    instances.push(instance(next++, car.sessionId, "afterburner", fore.x, fore.y, car.pose.angle, tick));
    instances.push(instance(next++, car.sessionId, "afterburner", aft.x, aft.y, car.pose.angle + Math.PI, tick));
  }
  // Bolts: fixed across the floor, owned by the first two cars.
  for (let i = 0; i < BENCH_CEILING.lances; i++) {
    instances.push(instance(next++, cars[i]!.sessionId, "lance", BENCH_LAYOUT.lanceX, BENCH_LAYOUT.lanceYs[i]!, 0, tick));
  }
  // Projectiles: evenly spaced on the outer ring, each owned by some car.
  const projectiles: WeaponId[] = [
    ...Array<WeaponId>(BENCH_CEILING.predators).fill("predator"),
    ...Array<WeaponId>(BENCH_CEILING.thumpers).fill("thumper"),
    ...Array<WeaponId>(BENCH_CEILING.magmablasts).fill("magmablast"),
    ...Array<WeaponId>(BENCH_CEILING.pepperboxes).fill("pepperbox"),
  ];
  projectiles.forEach((weaponId, i) => {
    const at = onRing(i, projectiles.length, BENCH_LAYOUT.shotRing, BENCH_LAYOUT.shotOrbitRadPerTick, tick, arena);
    instances.push(instance(next++, cars[i % cars.length]!.sessionId, weaponId, at.x, at.y, at.angle, tick));
  });

  return {
    tick,
    phase: RoomPhase.MATCH,
    // The practice room's combination: hides the clock, keeps the kills panel — the HUD to draw.
    mode: GameMode.FFA_DEATHMATCH,
    arenaId: arena.id,
    countdownEndsTick: 0,
    matchStartedAtTick: 0,
    matchEndsTick: 0,
    winnerTeam: -1,
    winnerSessionId: "",
    paused: false,
    localSessionId: sessionIdOf(LOCAL_CAR),
    nowMs,
    sinceSnapshotMs: 0,
    tickFraction: 0,
    cars,
    instances,
    events: [],
  };
}
```

`muzzleOf` takes a pose (`packages/shared/src/sim/weapons/lock.ts:40`) and is exported from shared's index.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/client && npx vitest run src/dev/bench-frame.test.ts`
Expected: PASS (4 tests). `beamFadeAlpha` is 1 for a 2-tick-old `afterburner` (lifetime 2000 ms, fade window `BEAM_FADE_OUT_MS` = 100 ms) and `lance` (1500 ms); `hpOf` gives 700 / 650 / 900.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/bench-frame.ts packages/client/src/dev/bench-frame.test.ts
git commit -m "feat(client): bench-frame — the visual ceiling as a pure RenderFrame"
```

---

### Task 5: `BenchScene` (`?dev=bench`) and the shared floor

**Files:**
- Create: `packages/client/src/scenes/arena/arena-floor.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`drawArena`, today `ArenaScene.ts:927-960`; after the preparation plan it is the boolean-returning method its Task 9 Step 3 describes; the constants `ARENA_BORDER_PX` at `:147` and `ARENA_DEPTH` at `:204`)
- Create: `packages/client/src/dev/BenchScene.ts`
- Modify: `packages/client/src/dev/registry.ts`, `packages/client/src/dev/registry.test.ts`

**Interfaces:**
- Consumes: Task 3's `PerfOverlay`; Task 4's `benchFrame`; `ArenaLayers`, `CarRenderer`, `ShotRenderer`, `HudRenderer`, `MatchBanners` (`scenes/arena/*`) and `SpectateView` (`scenes/arena/spectate-camera.ts`) from the preparation plan; `DEV_TOOL_MARKER`.
- Produces: `drawArenaFloor(scene, layers, arena): { gfx: Phaser.GameObjects.Graphics; staticCamera: boolean }`; the `bench` dev tool; `window.__bench: BenchProbe` (`{ ready: true; renderer: "webgl" | "canvas"; frames(): number; report(): PerfReport }`), which `scripts/bench-arena.mjs` reads.

- [ ] **Step 1: Extract the floor**

Move `drawArena`'s body (the floor, the camera viewport, background, zoom, bounds and the fit test) into a function, with this substitution table against the preparation plan's `drawArena`:

| In `ArenaScene.drawArena` | In `drawArenaFloor` |
|---|---|
| `this.layers!.world(this.add.graphics().setDepth(ARENA_DEPTH))` | `layers.world(scene.add.graphics().setDepth(ARENA_DEPTH))` |
| `this.arenaGfx = gfx;` | delete — returned instead |
| `this.cameras.main` | `scene.cameras.main` |
| `return staticCamera;` | `return { gfx, staticCamera };` |

```ts
// packages/client/src/scenes/arena/arena-floor.ts
import type Phaser from "phaser";
import { CAMERA_CONFIG, type ArenaDef } from "@motor-combat-moba/shared";
import { ARENA_VIEW_WIDTH, VIEW_HEIGHT } from "../../config/display.js";
import { fitsViewport } from "../arena-camera.js";
import { arenaBorderRect, arenaColorsOf } from "../arena-visual.js";
import type { ArenaLayers } from "./arena-layers.js";

/** Border stroke width and the floor's depth, moved from `ArenaScene`. */
export const ARENA_BORDER_PX = 4;
export const ARENA_DEPTH = -10;

/**
 * The arena floor and the world camera's setup, shared by `ArenaScene` and the bench scene so a
 * benchmark draws exactly the floor a match does. Body moved verbatim from `ArenaScene.drawArena`,
 * whose comments (viewport before `centerOn`; `ARENA_VIEW_WIDTH`, never `VIEW_WIDTH`) move with it.
 */
export function drawArenaFloor(
  scene: Phaser.Scene,
  layers: ArenaLayers,
  arena: ArenaDef,
): { gfx: Phaser.GameObjects.Graphics; staticCamera: boolean } {
  const colors = arenaColorsOf(arena);
  const gfx = layers.world(scene.add.graphics().setDepth(ARENA_DEPTH));
  gfx.fillStyle(colors.obstacle, 1);
  for (const obstacle of arena.obstacles) gfx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
  gfx.lineStyle(ARENA_BORDER_PX, colors.border, 1);
  const border = arenaBorderRect(arena, ARENA_BORDER_PX);
  gfx.strokeRect(border.x, border.y, border.w, border.h);

  const cam = scene.cameras.main;
  cam.setViewport(0, 0, ARENA_VIEW_WIDTH, VIEW_HEIGHT);
  cam.setBackgroundColor(colors.floor);
  cam.setZoom(CAMERA_CONFIG.zoom);
  cam.setBounds(0, 0, arena.width, arena.height);
  const staticCamera = fitsViewport(arena, { width: ARENA_VIEW_WIDTH, height: VIEW_HEIGHT }, CAMERA_CONFIG.zoom);
  if (staticCamera) cam.centerOn(arena.width / 2, arena.height / 2);
  return { gfx, staticCamera };
}
```

In `ArenaScene`, delete the `ARENA_BORDER_PX` and `ARENA_DEPTH` constants and their comments (nothing else in the scene reads them) and replace `drawArena` with:

```ts
private drawArena(arena: ArenaDef): boolean {
  if (!this.layers) throw new Error("drawArena before ArenaLayers");
  const floor = drawArenaFloor(this, this.layers, arena);
  this.arenaGfx = floor.gfx;
  return floor.staticCamera;
}
```

- [ ] **Step 2: Write the scene**

```ts
// packages/client/src/dev/BenchScene.ts
import Phaser from "phaser";
import { ACTIVE_ARENA_ID, MS_PER_TICK, getArena, type ArenaDef } from "@motor-combat-moba/shared";
import { isDebugEnabled } from "../config/client-mode.js";
import { VIEW_HEIGHT } from "../config/display.js";
import { PerfOverlay } from "../render/perf-overlay.js";
import type { PerfReport } from "../render/perf-stats.js";
import { ArenaLayers } from "../scenes/arena/arena-layers.js";
import { drawArenaFloor } from "../scenes/arena/arena-floor.js";
import { CarRenderer } from "../scenes/arena/car-renderer.js";
import { HudRenderer } from "../scenes/arena/hud-renderer.js";
import { MatchBanners } from "../scenes/arena/match-banners.js";
import { ShotRenderer } from "../scenes/arena/shot-renderer.js";
import type { SpectateView } from "../scenes/arena/spectate-camera.js";
import { benchFrame } from "./bench-frame.js";
import { DEV_TOOL_MARKER } from "./registry.js";

/** What `scripts/bench-arena.mjs` reads off the page. */
export interface BenchProbe {
  ready: true;
  renderer: "webgl" | "canvas";
  frames(): number;
  report(): PerfReport;
}

declare global {
  interface Window {
    __bench?: BenchProbe;
  }
}

/** The bench never spectates: the camera is parked, the HUD follows the local car. */
const BENCH_VIEW: SpectateView = { spectating: false, freeRoam: false, targetSid: "" };
const MARKER_MARGIN_PX = 16;
const MARKER_FONT_PX = 14;

/**
 * `?dev=bench` (rendering spec R24): the visual ceiling with no server. Every frame is a
 * `benchFrame` at a tick derived from elapsed time, drawn by the SAME renderer classes `ArenaScene`
 * composes, so what this measures is what a match costs. There is no sim, so the overlay's `sim`
 * bucket reads 0 — `build` and `draw` are the buckets the rendering phases move.
 *
 * `BootScene`'s dev branch adds this under the key `dev.bench` (its `scene.add` call overrides the
 * key given to `super()`), which is why the runner finds the scene through `window.__bench` rather
 * than by key. The registry is the only way in, and `DEV_TOOL_MARKER` is what `build-release.mjs`
 * asserts absent from a release.
 */
export class BenchScene extends Phaser.Scene {
  private arena: ArenaDef = getArena(ACTIVE_ARENA_ID);
  private carRenderer: CarRenderer | undefined;
  private shotRenderer: ShotRenderer | undefined;
  private hudRenderer: HudRenderer | undefined;
  private banners: MatchBanners | undefined;
  private perf: PerfOverlay | undefined;
  private elapsedMs = 0;

  constructor() {
    super({ key: "bench" });
  }

  create(): void {
    this.elapsedMs = 0;
    this.arena = getArena(ACTIVE_ARENA_ID);
    const layers = new ArenaLayers(this);
    drawArenaFloor(this, layers, this.arena);
    const debug = isDebugEnabled();
    this.carRenderer = new CarRenderer(this, layers, debug);
    this.shotRenderer = new ShotRenderer(this, layers, debug);
    this.hudRenderer = new HudRenderer(this, layers);
    this.banners = new MatchBanners(this, layers);

    const perf = new PerfOverlay(this);
    this.perf = perf;
    for (const obj of perf.gameObjects()) layers.hud(obj);
    layers.hud(
      this.add
        .text(MARKER_MARGIN_PX, VIEW_HEIGHT - MARKER_MARGIN_PX - MARKER_FONT_PX, DEV_TOOL_MARKER, {
          fontSize: `${MARKER_FONT_PX}px`,
          color: "#ffffff",
        })
        .setScrollFactor(0),
    );

    window.__bench = {
      ready: true,
      renderer: perf.rendererKind,
      frames: () => perf.report().frames,
      report: () => perf.report(),
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  update(_time: number, delta: number): void {
    const perf = this.perf;
    if (!perf || !this.carRenderer || !this.shotRenderer || !this.hudRenderer || !this.banners) return;
    perf.frameStart();
    this.elapsedMs += delta;
    // `MS_PER_TICK` from shared, so N1's move to 60 Hz carries the bench's clock with it.
    const frame = benchFrame(Math.floor(this.elapsedMs / MS_PER_TICK), performance.now(), this.arena);
    perf.mark("build");
    this.carRenderer.render(frame, frame.localSessionId);
    this.shotRenderer.render(frame);
    this.hudRenderer.render(frame, frame.localSessionId);
    this.banners.sync(frame, BENCH_VIEW);
    perf.mark("draw");
    perf.frameEnd();
  }

  private onShutdown(): void {
    delete window.__bench;
    this.carRenderer?.destroy();
    this.shotRenderer?.destroy();
    this.hudRenderer?.destroy();
    this.banners?.destroy();
    this.perf?.destroy();
    this.carRenderer = this.shotRenderer = this.hudRenderer = this.banners = this.perf = undefined;
  }
}
```

- [ ] **Step 3: Register the tool**

In `dev/registry.ts`, add to `DEV_TOOLS`: `bench: async () => (await import("./BenchScene.js")).BenchScene,`. In `registry.test.ts`, change the expected id list to `["assets", "playground", "bench"]` and add `expect(isDevToolId("bench")).toBe(true);` to the same test.

- [ ] **Step 4: Typecheck, test, look**

Run: `cd packages/client && npm run typecheck && npx vitest run`
Expected: clean; PASS.

Run `npm run dev`, open `http://localhost:5173/?dev=bench`. Expected: the arena floor, six cars driving a ring, twelve flames, two bolts across the floor, twenty-six projectiles on the outer ring, the slot bar and roster, the perf overlay top-left, `MOTOR DEV TOOL` bottom-left; `?dev=bench&debug=1` outlines every hitbox; in the console `window.__bench.report()` returns a `PerfReport`.

- [ ] **Step 5: Confirm the release strips it**

Run: `npm run build:release`
Expected: succeeds — `assertNoDevOnlyCode` passes because `BenchScene` is reached only by the dynamic import behind `import.meta.env.DEV` — and `grep -l "MOTOR DEV TOOL" dist-release/motor-combat-moba/packages/client/dist/assets/*.js` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/scenes/arena/arena-floor.ts packages/client/src/scenes/ArenaScene.ts packages/client/src/dev/BenchScene.ts packages/client/src/dev/registry.ts packages/client/src/dev/registry.test.ts
git commit -m "feat(client): ?dev=bench draws the visual ceiling with the match renderers (R24)"
```

---

### Task 6: `scripts/bench-visual.mjs` — the builders at the ceiling, in node

**Files:**
- Create: `scripts/bench-visual.mjs`
- Test: `scripts/bench-visual.test.mjs`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: `beamDrawLayers`, `projectileDrawLayers`, `instanceDrawShape` from `packages/client/src/scenes/combat-visual.ts` (TypeScript that imports only `@motor-combat-moba/shared`, loaded through `tsx`'s `tsImport`); Phaser's earcut at `node_modules/phaser/src/geom/polygon/Earcut.js` (CommonJS — Phaser's `package.json` sets no `"type"` — loaded by an absolute-path `require`, which bypasses the package's `exports` map).
- Produces: `CEILING`, `runVisualBench({ frames? })`, `formatVisualRows(result)`, `npm run bench:visual`.

The two microbenchmarks are the ones spec §1 was written from. Row 1 times `beamDrawLayers("afterburner", …)` twelve times per frame at full range and counts vertices and polygons. Row 2 times earcut over every polygon row 1 produced — what the WebGL `FillPath` render node does per fill per frame (`renderNodes/FillPath.js:63-91` flattens the path to `[x0, y0, x1, y1, …]` and calls `Earcut(polygonCache)`). Row 3 is the rest of the shot layer: two lances through `beamDrawLayers`, and the projectiles through `projectileDrawLayers` where a style exists, else the `instanceDrawShape` polygon or circle (a `fillCircle` is a 101-point path, `GraphicsWebGLRenderer.js:225-278`).

- [ ] **Step 1: Add the dependency and the script**

In root `package.json`: add `"tsx": "^4.16.0"` to `devDependencies` (the server declares the same range, so the lockfile does not move) and `"bench:visual": "npm run build -w @motor-combat-moba/shared && node scripts/bench-visual.mjs"` to `scripts`. Run `npm install`.

- [ ] **Step 2: Write the failing test**

```js
// scripts/bench-visual.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CEILING, formatVisualRows, runVisualBench } from "./bench-visual.mjs";

const SCRIPT = fileURLToPath(new URL("./bench-visual.mjs", import.meta.url));

describe("runVisualBench", () => {
  it("builds twelve flames, triangulates every polygon, and times the rest of the layer", async () => {
    const result = await runVisualBench({ frames: 3 });
    assert.equal(result.frames, 3);
    const [flame, earcut, rest] = result.rows;
    assert.equal(flame.name, "flame geometry");
    assert.ok(flame.vertices > 0);
    // Every flame has at least its authored layers; embers may vary with the noise clock.
    assert.ok(flame.polygons >= CEILING.afterburners);
    assert.equal(earcut.name, "flame earcut");
    assert.equal(earcut.polygons, flame.polygons);
    assert.ok(earcut.triangles > 0);
    assert.equal(rest.name, "rest of the shot layer");
    assert.ok(rest.vertices > 0);
    for (const row of result.rows) assert.ok(row.msPerFrame >= 0, `${row.name} has a time`);
  });

  it("prints a header, one line per row and a total, with ms/frame", async () => {
    const lines = formatVisualRows(await runVisualBench({ frames: 2 }));
    assert.equal(lines.length, 1 + 3 + 1);
    assert.match(lines[0], /ms\/frame/);
    assert.match(lines.at(-1), /^\s*total/);
  });

  it("runs from the command line", () => {
    const out = execFileSync(process.execPath, [SCRIPT, "--frames", "2"], { encoding: "utf8" });
    assert.match(out, /flame geometry/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test scripts/bench-visual.test.mjs`
Expected: FAIL — cannot find module `./bench-visual.mjs`.

- [ ] **Step 4: Write the script**

```js
// scripts/bench-visual.mjs
/**
 * The pure builders at the visual ceiling, timed in node (rendering spec §1, R24). Three rows,
 * median ms per frame over `--frames` (default 200):
 *   1. flame geometry — `beamDrawLayers("afterburner")` x12 at full range (the spec's 2.65 ms).
 *   2. flame earcut   — Phaser's earcut over every polygon row 1 built, which the WebGL `FillPath`
 *      render node does per fill per frame (`renderNodes/FillPath.js:63-91`). The 3.88 ms.
 *   3. rest of layer  — two lances, and the projectiles through `projectileDrawLayers` or, where a
 *      weapon has no style, the raw `instanceDrawShape` polygon (a circle counts as the 101-point
 *      path `fillCircle` records).
 * Absolute numbers are this machine's; read the ratios and the vertex counts. V2/V3 turn the
 * builders into boot-time bakes, and this script is what says how long a bake costs.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

import { weaponDefOf } from "../packages/shared/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const earcut = require(path.join(ROOT, "node_modules/phaser/src/geom/polygon/Earcut.js"));

/** Same mix as `packages/client/src/dev/bench-frame.ts`'s `BENCH_CEILING`. */
export const CEILING = { afterburners: 12, lances: 2, predators: 6, thumpers: 6, magmablasts: 6, pepperboxes: 8 };

const DEFAULT_FRAMES = 200;
/** A 60 Hz frame: advancing `nowMs` by this per frame exercises the crackle and flicker clocks. */
const NOW_STEP_MS = 1000 / 60;
const WARMUP_FRAMES = 10;
/** Points in the path `Graphics.fillCircle` records, whatever the radius. */
const CIRCLE_PATH_POINTS = 101;
const TWO_PI = Math.PI * 2;

let builders;
async function loadBuilders() {
  builders ??= await tsImport("../packages/client/src/scenes/combat-visual.ts", import.meta.url);
  return builders;
}

function ring(count, radius, cx = 640, cy = 360) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const theta = (TWO_PI * i) / count;
    out.push({ x: cx + Math.cos(theta) * radius, y: cy + Math.sin(theta) * radius, angle: theta });
  }
  return out;
}

const FLAMES = ring(CEILING.afterburners, 200);
const LANCES = [{ x: 40, y: 300, angle: 0 }, { x: 40, y: 420, angle: 0 }];
const PROJECTILE_IDS = [
  ...Array(CEILING.predators).fill("predator"),
  ...Array(CEILING.thumpers).fill("thumper"),
  ...Array(CEILING.magmablasts).fill("magmablast"),
  ...Array(CEILING.pepperboxes).fill("pepperbox"),
];
const PROJECTILES = ring(PROJECTILE_IDS.length, 300).map((at, i) => ({ weaponId: PROJECTILE_IDS[i], ...at }));

/** Runs `beamDrawLayers` for every flame; returns the polygons it built. */
function buildFlames(cv, nowMs) {
  const polys = [];
  const range = weaponDefOf("afterburner").range;
  for (const f of FLAMES) {
    for (const layer of cv.beamDrawLayers("afterburner", f.x, f.y, f.angle, range, 0, nowMs)) polys.push(layer.points);
  }
  return polys;
}

/** What `FillPath` does per polygon: flatten, then earcut. Returns the triangle count. */
function triangulate(polys) {
  let triangles = 0;
  for (const poly of polys) {
    const flat = new Array(poly.length * 2);
    for (let i = 0; i < poly.length; i++) {
      flat[i * 2] = poly[i].x;
      flat[i * 2 + 1] = poly[i].y;
    }
    triangles += earcut(flat).length / 3;
  }
  return triangles;
}

/** Every other instance on the layer; returns `{ vertices, polygons }` for the frame. */
function buildRest(cv, nowMs) {
  let vertices = 0;
  let polygons = 0;
  const count = (layers) => {
    for (const layer of layers) {
      vertices += layer.points.length;
      polygons += 1;
    }
  };
  const lanceRange = weaponDefOf("lance").range;
  for (const l of LANCES) count(cv.beamDrawLayers("lance", l.x, l.y, l.angle, lanceRange, 0, nowMs));
  for (const p of PROJECTILES) {
    const instance = { weaponId: p.weaponId, isExplosion: false, x: p.x, y: p.y, angle: p.angle, extent: 0 };
    const layers = cv.projectileDrawLayers(instance, 0);
    if (layers.length > 0) {
      count(layers);
      continue;
    }
    const shape = cv.instanceDrawShape(instance, 0);
    vertices += shape.kind === "circle" ? CIRCLE_PATH_POINTS : shape.points.length;
    polygons += 1;
  }
  return { vertices, polygons };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Times `fn(nowMs)` per frame after a warm-up; returns the median ms and the last frame's value. */
function measure(fn, frames) {
  let last;
  for (let i = 0; i < WARMUP_FRAMES; i++) last = fn(i * NOW_STEP_MS);
  const times = [];
  for (let i = 0; i < frames; i++) {
    const start = performance.now();
    last = fn((WARMUP_FRAMES + i) * NOW_STEP_MS);
    times.push(performance.now() - start);
  }
  return { msPerFrame: median(times), last };
}

export async function runVisualBench({ frames = DEFAULT_FRAMES } = {}) {
  const cv = await loadBuilders();
  const flame = measure((nowMs) => buildFlames(cv, nowMs), frames);
  const polys = flame.last;
  const tri = measure(() => triangulate(polys), frames);
  const rest = measure((nowMs) => buildRest(cv, nowMs), frames);
  const rows = [
    { name: "flame geometry", detail: `beamDrawLayers x${CEILING.afterburners}`, msPerFrame: flame.msPerFrame,
      vertices: polys.reduce((sum, poly) => sum + poly.length, 0), polygons: polys.length, triangles: 0 },
    { name: "flame earcut", detail: `Earcut x${polys.length}`, msPerFrame: tri.msPerFrame,
      vertices: 0, polygons: polys.length, triangles: tri.last },
    { name: "rest of the shot layer", detail: `${CEILING.lances} lance, ${PROJECTILES.length} projectiles`,
      msPerFrame: rest.msPerFrame, vertices: rest.last.vertices, polygons: rest.last.polygons, triangles: 0 },
  ];
  return { frames, rows, totalMs: rows.reduce((sum, row) => sum + row.msPerFrame, 0) };
}

const cell = (value, width) => String(value === 0 ? "-" : value).padStart(width);

export function formatVisualRows(result) {
  const lines = [
    `bench-visual: builders at the ceiling, median of ${result.frames} frames` +
      `${"".padEnd(14)}${"ms/frame".padStart(9)}${"vertices".padStart(10)}${"polygons".padStart(10)}${"triangles".padStart(11)}`,
  ];
  for (const row of result.rows) {
    lines.push(
      `  ${row.name.padEnd(24)} ${row.detail.padEnd(32)}${row.msPerFrame.toFixed(3).padStart(9)}` +
        `${cell(row.vertices, 10)}${cell(row.polygons, 10)}${cell(row.triangles, 11)}`,
    );
  }
  lines.push(`  ${"total".padEnd(24)} ${"".padEnd(32)}${result.totalMs.toFixed(3).padStart(9)}`);
  return lines;
}

function framesArg(argv) {
  const at = argv.indexOf("--frames");
  if (at === -1) return DEFAULT_FRAMES;
  const value = Number(argv[at + 1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--frames wants a positive integer, got "${argv[at + 1]}"`);
  return value;
}

export async function main(argv = process.argv.slice(2)) {
  for (const line of formatVisualRows(await runVisualBench({ frames: framesArg(argv) }))) console.log(line);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked && invoked === path.resolve(fileURLToPath(import.meta.url))) await main();
```

- [ ] **Step 5: Run the test to verify it passes, then run the bench**

Run: `npm run build -w @motor-combat-moba/shared && node --test scripts/bench-visual.test.mjs`
Expected: PASS (3 tests).

Run: `npm run bench:visual`
Expected: the header and four rows. The spec's figures on this container were 2.65 ms / 12,600 vertices / 144 polygons for row 1 and 3.88 ms / 12,132 triangles for row 2 — expect the vertex, polygon and triangle counts to match exactly (geometry, not timing) and the times within a factor of two either way.

- [ ] **Step 6: Commit**

```bash
git add scripts/bench-visual.mjs scripts/bench-visual.test.mjs package.json package-lock.json
git commit -m "feat(scripts): bench-visual — the pure builders and earcut at the ceiling"
```

---

### Task 7: `scripts/bench-arena.mjs` — the bench scene under Playwright

**Files:**
- Create: `scripts/bench-arena.mjs`
- Test: `scripts/bench-arena.test.mjs`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: the server-boot code of `scripts/smoke-arena.mjs` (preparation plan Task 10: `spawn(process.execPath, ["packages/server/dist/index.js"], { env: { DEPLOY_MODE: "lan", PORT, CLIENT_ORIGIN } })` plus `waitForHealth`), reproduced here on port 2598 so both can run at once; Task 5's `window.__bench`; Playwright's `chromium` and `firefox`.
- Produces: `BENCH_ARENA_DEFAULTS`, `parseBenchArgs(argv)`, `formatBenchRows(rows, seconds)`, `npm run bench:arena`; exit 1 on a hard failure only.

Why the client is rebuilt first: a production `vite build` replaces `import.meta.env.DEV` with `false` and drops the dev branch, so `?dev=bench` cannot exist in `packages/client/dist` as `npm run build` leaves it. Vite's `resolveConfig` (`node_modules/vite/dist/node/chunks/dep-*.js`, `resolveConfig(inlineConfig, "build", "production", "production")`) keeps a `NODE_ENV` that is already set and takes the mode from the flag, so `NODE_ENV=development vite build --mode development` gives `import.meta.env.DEV === true` and emits the dev chunks. The script serves that through the LAN server exactly as the smoke check serves the production one, then rebuilds the production client so the tree is left as `npm run build` leaves it (`--keep-dist` skips the restore for a repeat run).

- [ ] **Step 1: Write the failing test**

```js
// scripts/bench-arena.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BENCH_ARENA_DEFAULTS, formatBenchRows, parseBenchArgs } from "./bench-arena.mjs";

describe("parseBenchArgs", () => {
  it("defaults to both browsers, the spec's ten seconds, and restoring dist", () => {
    assert.deepEqual(parseBenchArgs([]), { browsers: ["chromium", "firefox"], seconds: 10, keepDist: false });
    assert.deepEqual(BENCH_ARENA_DEFAULTS.browsers, ["chromium", "firefox"]);
  });

  it("reads --browsers, --seconds and --keep-dist, and rejects what it does not know", () => {
    assert.deepEqual(parseBenchArgs(["--browsers", "firefox", "--seconds", "3", "--keep-dist"]), {
      browsers: ["firefox"], seconds: 3, keepDist: true,
    });
    assert.throws(() => parseBenchArgs(["--browsers", "safari"]), /safari/);
    assert.throws(() => parseBenchArgs(["--seconds", "0"]), /--seconds/);
  });
});

describe("formatBenchRows", () => {
  const report = {
    frames: 598,
    frameMs: { p50: 16.66, p95: 17.9 },
    jsMs: { p50: 4.12, p95: 6.3 },
    split: { sim: 0, build: 0.6, draw: 1.4, phaser: 0.3, render: 1.8 },
    drawCalls: { p50: 9, max: 11 },
    textures: 14,
    particles: 0,
    tier: "medium",
  };

  it("prints a measured browser with its split, and a skipped one", () => {
    const lines = formatBenchRows(
      [{ browser: "chromium", renderer: "webgl", report }, { browser: "firefox", skipped: "Executable doesn't exist" }],
      10,
    );
    assert.match(lines[0], /10 s/);
    assert.match(lines[2], /^\s*chromium\s+598\s+16\.7 \/ 17\.9\s+4\.1 \/ 6\.3\s+9 \/ 11\s+14\s+webgl/);
    assert.match(lines[3], /split p50: sim 0\.0\s+build 0\.6\s+draw 1\.4\s+phaser 0\.3\s+render 1\.8/);
    assert.match(lines[4], /^\s*firefox\s+skipped: Executable doesn't exist/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/bench-arena.test.mjs`
Expected: FAIL — cannot find module `./bench-arena.mjs`.

- [ ] **Step 3: Write the script**

```js
// scripts/bench-arena.mjs
/**
 * The bench scene (`?dev=bench`, rendering spec R24) under Playwright on Chromium and Firefox,
 * printing p50/p95 frame time, the JavaScript split and GL draw calls per browser. Numbers are
 * REPORTED, never asserted: the acceptance table (R25) is read by a person on the reference
 * machine, and under software GL the absolutes mean little — CI watches for a jump between runs.
 * Exit 1 only on a hard failure: a browser error, a page that never publishes `window.__bench`,
 * or no browser at all. A browser Playwright has not installed is reported as skipped
 * (`npx playwright install firefox`), so a machine with only Chromium still gets a number.
 *
 * Flags: `--browsers chromium,firefox` `--seconds 10` `--keep-dist`.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_DIR = path.join(ROOT, "packages", "client");
const VITE_BIN = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
const SERVER_ENTRY = path.join(ROOT, "packages", "server", "dist", "index.js");

export const BENCH_ARENA_DEFAULTS = {
  browsers: ["chromium", "firefox"],
  /** The spec's window (R24): p50/p95 over 10 s. */
  seconds: 10,
  /** Frames to let the scene settle (texture uploads, JIT) before the window opens. */
  warmupFrames: 120,
  /** A port of its own so this and `smoke-arena.mjs` (2599) can run side by side. */
  port: 2598,
  /** How long to wait for the page to publish `window.__bench` — the dev bundle is larger. */
  readyTimeoutMs: 60_000,
  healthPolls: 100,
  healthPollMs: 100,
};

const BROWSER_TYPES = { chromium, firefox };

export function parseBenchArgs(argv) {
  const out = { browsers: [...BENCH_ARENA_DEFAULTS.browsers], seconds: BENCH_ARENA_DEFAULTS.seconds, keepDist: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep-dist") out.keepDist = true;
    else if (arg === "--browsers") {
      out.browsers = String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const name of out.browsers) {
        if (!(name in BROWSER_TYPES)) throw new Error(`unknown browser "${name}"; known: ${Object.keys(BROWSER_TYPES).join(", ")}`);
      }
    } else if (arg === "--seconds") {
      out.seconds = Number(argv[++i]);
      if (!Number.isFinite(out.seconds) || out.seconds <= 0) throw new Error(`--seconds wants a positive number, got "${argv[i]}"`);
    } else throw new Error(`unknown flag "${arg}"`);
  }
  return out;
}

const ms = (value) => value.toFixed(1);
const cell = (value, width) => String(value).padEnd(width);

export function formatBenchRows(rows, seconds) {
  const lines = [
    `bench-arena: ceiling scene (6 cars, 40 instances), ${seconds} s after ${BENCH_ARENA_DEFAULTS.warmupFrames} warm-up frames`,
    `  ${cell("browser", 10)} ${cell("frames", 7)} ${cell("frame p50/p95 ms", 18)} ${cell("js p50/p95 ms", 15)} ${cell("draws p50/max", 14)} ${cell("textures", 9)} renderer`,
  ];
  for (const row of rows) {
    if (row.skipped) {
      lines.push(`  ${cell(row.browser, 10)} skipped: ${row.skipped}`);
      continue;
    }
    const r = row.report;
    lines.push(
      `  ${cell(row.browser, 10)} ${cell(r.frames, 7)} ${cell(`${ms(r.frameMs.p50)} / ${ms(r.frameMs.p95)}`, 18)} ` +
        `${cell(`${ms(r.jsMs.p50)} / ${ms(r.jsMs.p95)}`, 15)} ${cell(`${r.drawCalls.p50} / ${r.drawCalls.max}`, 14)} ` +
        `${cell(r.textures, 9)} ${row.renderer}`,
    );
    lines.push(
      `  ${cell("", 10)} split p50: sim ${ms(r.split.sim)}  build ${ms(r.split.build)}  draw ${ms(r.split.draw)}  ` +
        `phaser ${ms(r.split.phaser)}  render ${ms(r.split.render)}`,
    );
  }
  return lines;
}

/** `NODE_ENV` and `--mode` both given: see the header of this plan's Task 7 for why. */
function buildClient(mode) {
  const result = spawnSync(process.execPath, [VITE_BIN, "build", "--mode", mode, "--logLevel", "warn"], {
    cwd: CLIENT_DIR,
    env: { ...process.env, NODE_ENV: mode },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`vite build --mode ${mode} exited with ${result.status}`);
}

function fail(message) {
  console.error(`[bench] ${message}`);
  process.exitCode = 1;
}

function launchOptions(name) {
  if (name === "chromium") {
    return {
      executablePath: process.env.SMOKE_CHROMIUM,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    };
  }
  return { firefoxUserPrefs: { "webgl.force-enabled": true, "webgl.disabled": false } };
}

async function waitForHealth(origin) {
  for (let i = 0; i < BENCH_ARENA_DEFAULTS.healthPolls; i++) {
    try {
      const res = await fetch(`${origin}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, BENCH_ARENA_DEFAULTS.healthPollMs));
  }
  throw new Error("server did not answer /health within 10 s");
}

async function benchBrowser(name, origin, seconds) {
  let browser;
  try {
    browser = await BROWSER_TYPES[name].launch(launchOptions(name));
  } catch (error) {
    return { browser: name, skipped: String(error.message ?? error).split("\n")[0] };
  }
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });
    await page.goto(`${origin}/?dev=bench`);
    const timeout = BENCH_ARENA_DEFAULTS.readyTimeoutMs;
    await page.waitForFunction(() => window.__bench?.ready === true, null, { timeout });
    await page.waitForFunction((n) => window.__bench.frames() >= n, BENCH_ARENA_DEFAULTS.warmupFrames, { timeout });
    await page.waitForTimeout(seconds * 1000);
    const report = await page.evaluate(() => window.__bench.report());
    const renderer = await page.evaluate(() => window.__bench.renderer);
    if (errors.length > 0) throw new Error(`${name} browser errors:\n  ${errors.join("\n  ")}`);
    return { browser: name, renderer, report };
  } finally {
    await browser.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseBenchArgs(argv);
  const origin = `http://127.0.0.1:${BENCH_ARENA_DEFAULTS.port}`;
  buildClient("development");
  const server = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, DEPLOY_MODE: "lan", PORT: String(BENCH_ARENA_DEFAULTS.port), CLIENT_ORIGIN: origin },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const rows = [];
  try {
    await waitForHealth(origin);
    for (const name of args.browsers) {
      try {
        rows.push(await benchBrowser(name, origin, args.seconds));
      } catch (error) {
        fail(String(error.message ?? error));
      }
    }
    for (const line of formatBenchRows(rows, args.seconds)) console.log(line);
    if (rows.every((row) => row.skipped)) fail("no browser could run the bench");
    for (const row of rows) {
      if (row.skipped) console.log(`[bench] ${row.browser} skipped — run \`npx playwright install ${row.browser}\``);
    }
  } catch (error) {
    fail(String(error.message ?? error));
  } finally {
    server.kill();
    if (args.keepDist) console.log("[bench] packages/client/dist is a DEVELOPMENT build (--keep-dist); `npm run build` restores it");
    else buildClient("production");
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked && invoked === path.resolve(fileURLToPath(import.meta.url))) await main();
```

- [ ] **Step 4: Add the script and run the tests**

In root `package.json` `scripts`, add `"bench:arena": "npm run build && node scripts/bench-arena.mjs"` — the full build first, because the LAN server bundle inlines shared and the script rebuilds only the client.

Run: `node --test scripts/bench-arena.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the bench**

Run: `npm run bench:arena`
Expected: the dev-mode client build, the server log, then the table with a `chromium` row (`renderer webgl` under SwiftShader; if the software context is refused Phaser's `AUTO` falls back and the row reads `canvas` with `draws -1 / -1` — a real split either way) and a `firefox` row that is either measured or `skipped: Executable doesn't exist …` on this container, where only Chromium is installed; then the production rebuild. Exit 0. If Chromium cannot launch at all, set `SMOKE_CHROMIUM` to the path `ls /opt/pw-browsers` shows, as the smoke check documents.

- [ ] **Step 6: Commit**

```bash
git add scripts/bench-arena.mjs scripts/bench-arena.test.mjs package.json
git commit -m "feat(scripts): bench-arena — the bench scene under Playwright on Chromium and Firefox"
```

---

### Task 8: Baseline numbers and documentation

**Files:**
- Create: `docs/render-bench.md`
- Modify: `CLAUDE.md` (root: the "Read the right doc" table and the "Commands" block), `packages/client/CLAUDE.md`, `docs/project-structure.md`

**Interfaces:**
- Produces: the V0 baseline — the spec's migration row ships "baseline numbers", and this page is where they live.

- [ ] **Step 1: Record the baselines**

Run `npm run bench:visual` and `npm run bench:arena` and keep both outputs. Print the machine with `node -p "os.cpus()[0].model + ', ' + os.cpus().length + ' cores'"` and the commit with `git rev-parse --short HEAD`.

- [ ] **Step 2: Write `docs/render-bench.md`**

Write the page below, then replace each `(paste …)` marker with the corresponding output verbatim. `grep -c "(paste" docs/render-bench.md` must print `0` before the commit.

````markdown
# Render benchmarks

Three instruments measure what the client costs per frame. They report; nothing asserts a number.
The rendering spec's acceptance table
([R25](superpowers/specs/2026-09-04-client-rendering-architecture-design.md#9-tiers-governor-and-measurement))
is read off them on the reference machine by a person.

| Instrument | Command | Measures |
|---|---|---|
| `?debug=perf` overlay (`render/perf-overlay.ts`) | any match URL with `?debug=perf` (`?debug=1,perf,net` combines overlays) | the live split of one frame: `sim` (input pump, prediction, and the banner frame `syncBanners` builds first), `build` (the `RenderFrame`), `draw` (the renderer classes), `phaser` (the rest of the step), `render` (`PRE_RENDER` to `POST_RENDER`); GL draw calls; texture count; particles; tier |
| `?dev=bench` scene (`dev/BenchScene.ts`) | `npm run dev`, then `http://localhost:5173/?dev=bench` | the ceiling — six cars, twelve `afterburner` flames, two `lance` bolts, forty instances — drawn by the match's own renderers with no server; `sim` reads 0 there by construction |
| `npm run bench:visual` (`scripts/bench-visual.mjs`) | node, no browser | the pure builders at the ceiling: flame geometry, earcut over it, the rest of the shot layer — ms/frame and vertex counts |
| `npm run bench:arena` (`scripts/bench-arena.mjs`) | Playwright, Chromium and Firefox, software GL | the bench scene's p50/p95 frame time, JavaScript split and draw calls over 10 s; the CI regression check |

Draw calls are counted by wrapping `WebGLRenderer.drawElements` and `drawInstancedArrays`, the two
methods every render node submits through — Phaser 4.2.1 keeps no counter of its own; on the Canvas
renderer the column reads `n/a`. `particles` is 0 until V4 and `tier` is the literal `medium` until
V5. Two things the numbers are not: `bench:arena` under SwiftShader is the CPU side only (the GPU fill
budget is measured on a laptop, not in CI), and the overlay's own `Text` re-rasterises four times a
second, which is inside the numbers it shows until V1 swaps it for `BitmapText`.

## Baseline

V0, before any renderer changed. Every later phase is judged as a delta from these.

### `npm run bench:visual`

```text
(paste the output)
```

### `npm run bench:arena`

```text
(paste the output)
```

Machine: (paste). Commit: (paste).
````

- [ ] **Step 3: Root `CLAUDE.md`**

In the "Read the right doc" table, after the `npm run ttk` row, add:

```markdown
| Whether a rendering change moved frame time; the perf overlay, the bench scene, and the V0 baselines | [`docs/render-bench.md`](docs/render-bench.md) |
```

In the "Commands" block, after the `npm run balance` lines, add:

```text
npm run bench:visual   # pure builders at the visual ceiling in node -> ms/frame, vertices, triangles
npm run bench:arena    # ?dev=bench under Playwright (Chromium + Firefox) -> p50/p95 frame time, draw calls
                       #   -- rebuilds the client in dev mode, serves it, then restores the production dist
```

- [ ] **Step 4: `packages/client/CLAUDE.md`**

Replace the sentence `` `?debug=1` draws the car OBB hitbox. `` with:

```markdown
`?debug=` is a comma list of overlays: `1` draws the car OBB hitbox, `perf` the frame-time overlay
(`render/perf-overlay.ts` — sim / build / draw / phaser / render split, draw calls, textures), `net`
the netgraph. `?dev=bench` draws the visual ceiling with the match's own renderers and no server;
see [`docs/render-bench.md`](../../docs/render-bench.md) for what each instrument measures and the
V0 baselines every rendering phase is judged against.
```

- [ ] **Step 5: `docs/project-structure.md`**

Under `dev/`, after the `PlaygroundScene.ts` line:

```text
        │   ├── BenchScene.ts      # ?dev=bench: the visual ceiling drawn by the match renderers, no server (R24)
        │   ├── bench-frame.ts     # pure: BENCH_CEILING, benchFrame(tick, nowMs, arena) -> RenderFrame
```

A `render/` entry before `scenes/`:

```text
        ├── render/
        │   ├── perf-stats.ts      # pure: SampleRing, percentile, PerfRings, PerfReport, formatPerfLines
        │   └── perf-overlay.ts    # ?debug=perf: game step-event hooks, draw-call wrap, the Text (R23)
```

Under `scenes/arena/`:

```text
        │   │   ├── arena-floor.ts      # drawArenaFloor: the floor and world-camera setup ArenaScene and BenchScene share
```

After the `scripts/build-release.mjs` line at the top of the tree:

```text
├── scripts/bench-visual.mjs      # pure builders + earcut at the ceiling, in node
├── scripts/bench-arena.mjs       # ?dev=bench under Playwright on Chromium and Firefox
```

- [ ] **Step 6: Full verification and commit**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
npm run typecheck
npm run build
```

Expected: every suite green including `scripts/bench-visual.test.mjs` and `scripts/bench-arena.test.mjs`; typecheck clean; the build succeeds and `packages/client/dist` is a production build (`grep -l "MOTOR DEV TOOL" packages/client/dist/assets/*.js` prints nothing).

```bash
git add docs/render-bench.md CLAUDE.md packages/client/CLAUDE.md docs/project-structure.md
git commit -m "docs(render): V0 baseline numbers and how to run the render benchmarks"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

---

## Self-review

**Spec coverage.** §1's two measurements are Task 6's rows 1 and 2, with the "everything else" row as row 3. R23: frame split (Task 3, five buckets), draw calls (Task 3, the wrap), particles and tier (Task 3, literals with their owners named), texture count (Task 3), the netgraph beside it (`attachNetgraph`, not depended on), `?debug=perf` (Task 1). R24: six cars burning, two lances, forty instances (Task 4), no server (Task 5), stripped from release like the playground (Task 5 Step 5), p50/p95 and draw calls over 10 s (Task 2's rings, Task 7's window), Playwright on Chromium and Firefox (Task 7), `bench-visual.mjs` (Task 6). R24's "scripted stream of hit and ram events" and "400 particles" are V4's — the ledger's coupling 2 says V4's bench synthesises events, and there is no particle service yet; `events: []` is what Task 4 ships. R24's "measures bake time" is V2's meaning of the same script; today the builders are the frame path and that is what Task 6 times. R25's table is the Acceptance section. §10 V0 row: perf overlay, bench scene, `bench-visual.mjs`, baseline numbers (Task 8); nothing deleted, matching the row's `—`.

**Placeholder scan.** Task 8's `(paste …)` markers are the one thing left to the executor; the step says what fills them and checks with `grep -c` that none survives. No deferred-work markers, no "handle edge cases"; every code step prints code.

**Type consistency.** `PerfOverlay.mark` takes `PerfMark` (`"sim" | "build" | "draw"`), which are also `PerfChannel` keys so `this.sample[label] += …` type-checks; Task 3's `ArenaScene` and Task 5's `BenchScene` call it with those literals. `PerfReport` (Task 2) is what `PerfOverlay.report()` (Task 3), `BenchProbe.report()` (Task 5) and `formatBenchRows` (Task 7, reading `frames`, `frameMs`, `jsMs`, `split`, `drawCalls`, `textures`) agree on. `PERF_OVERLAY_CONFIG.drawCallsUnavailable` is the value `PerfOverlay` pushes on Canvas and `formatPerfLines` prints as `n/a`. `drawArenaFloor` (Task 5) returns `{ gfx, staticCamera }` and `ArenaScene.drawArena` reads both. `hasDebugFlag(PERF_DEBUG_FLAG)` (Task 1) gates Task 3's `create`. `window.__bench.ready` / `.frames()` / `.report()` / `.renderer` (Task 5) are the four members Task 7's `page` calls read. `SpectateView` is imported from `spectate-camera.ts`, where the preparation plan's Task 8 defines it. `CEILING` (Task 6) restates `BENCH_CEILING` (Task 4) by value.

## Acceptance

The spec's migration row (§10):

> | V0 Instrument | perf overlay, bench scene, `bench-visual.mjs`, baseline numbers | — |

And the numbers the instruments must be able to print, from R25 (measured at 1080p, dpr 1.5, tier Medium on the reference machine — a 2019 integrated-graphics laptop):

| Metric | Required | Printed by |
|---|---|---|
| Client JavaScript per frame at the ceiling | p95 < 5 ms (sim + frame build + Phaser update + submit) | `npm run bench:arena` → `js p50/p95 ms`; live, `?dev=bench` → the overlay's `js` p95 |
| Draw calls at the ceiling | ≤ 16 world + HUD | `npm run bench:arena` → `draws p50/max`; live, the overlay's `draws` |
| GC pauses during a 10-minute match | none over 5 ms attributable to the renderer | not an instrument of this phase: the browser's performance panel over a `?debug=perf` match; the overlay's `frame` p95 against its `js` p95 shows the gap a pause leaves |
| Frame time at the ceiling, tier High | p95 < 12 ms | `?dev=bench` overlay `frame` p95, once V5 has a tier to pin |
| Frame time at the ceiling, tier Low, dpr 1 | p95 < 8 ms | same, once V5 has a tier to pin |
| Boot bake | < 150 ms | `npm run bench:visual` is the pre-bake cost of the same builders; V2 adds the bake row |

V0 is the instrument, not the result: today's numbers are expected to *fail* the first two rows — that is the baseline `docs/render-bench.md` records, and V1–V5 are judged as deltas from it. The commands that demonstrate V0 itself are `npm test` green plus `npm run bench:visual` and `npm run bench:arena` each printing a table and exiting 0.

## Handoff

Exports beyond the ledger, for V1–V5 and the netcode stream:

| Export | Where | For |
|---|---|---|
| `debugFlags`, `hasDebugFlag`, `PERF_DEBUG_FLAG` | `config/client-mode.ts` | N0's `?debug=net` overlay reads `hasDebugFlag("net")`; overlays combine as `?debug=1,perf,net` |
| `PerfOverlay.attachNetgraph(lines: () => readonly string[])`, `.report(): PerfReport`, `.rendererKind`, `.gameObjects()`; `PerfMark` | `render/perf-overlay.ts` | N0 hands its netgraph lines in; V1 registers the objects in `HudScene` and swaps the `Text` for `BitmapText`; V4 and V5 replace the `PARTICLES_UNTIL_V4` / `TIER_UNTIL_V5` literals with `ParticleService` and `TierManager` readings |
| `PERF_OVERLAY_CONFIG`, `SampleRing`, `percentile`, `PerfRings`, `PerfChannel`, `PERF_CHANNELS`, `PerfSample`, `PerfReport`, `formatPerfLines` | `render/perf-stats.ts` | V5's `FrameGovernor` and `TierManager` measure p95 over rolling windows — `SampleRing` is that window |
| `drawArenaFloor`, `ARENA_BORDER_PX`, `ARENA_DEPTH` | `scenes/arena/arena-floor.ts` | V2 replaces the `Graphics` floor with the baked image in one place; `render/layers.ts` takes over `ARENA_DEPTH` |
| `BENCH_CEILING`, `BENCH_INSTANCE_COUNT`, `BENCH_LAYOUT`, `benchFrame` | `dev/bench-frame.ts` | V4 adds the scripted event stream and particle bursts to the same frame; V3 bakes against the flame and bolt instances it places |
| `BenchProbe`, `window.__bench` | `dev/BenchScene.ts` | `scripts/bench-arena.mjs`; V5 adds a tier query to pin the tier under test |
| `CEILING`, `runVisualBench`, `formatVisualRows` | `scripts/bench-visual.mjs` | V2 adds a bake-time row; V3 re-reads rows 1 and 2 after the flame becomes a flipbook |
| `BENCH_ARENA_DEFAULTS`, `parseBenchArgs`, `formatBenchRows` | `scripts/bench-arena.mjs` | CI wiring — the repository has no workflow file today; `npm run bench:arena` is the command to call |
| `npm run bench:visual`, `npm run bench:arena`; `tsx` in root `devDependencies` | root `package.json` | everyone |
