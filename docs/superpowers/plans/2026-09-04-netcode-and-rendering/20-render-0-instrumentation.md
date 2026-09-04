# Rendering Phase V0: Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the client the three measuring instruments every later rendering phase is judged against — a `?debug=perf` overlay that splits a frame into sim / frame build / draw / Phaser / render and counts GL draw calls, a `?dev=bench` scene that runs the visual ceiling with no server, and two scripts (`bench-visual.mjs` for the pure builders in node, `bench-arena.mjs` for the bench scene under Playwright on Chromium and Firefox) — and record the baseline numbers.

**Architecture:** `render/perf-overlay.ts` hooks Phaser's four game-step events (`PRE_STEP`, `POST_STEP`, `PRE_RENDER`, `POST_RENDER`) and counts draw calls by wrapping `WebGLRenderer.drawElements` / `drawInstancedArrays`, the two methods every render node submits through; the scene adds three marks (`sim`, `build`, `draw`) between them. All statistics live in a pure, tested `render/perf-stats.ts`. `dev/bench-frame.ts` is a pure builder that fabricates a `RenderFrame` for the ceiling (six cars, twelve `afterburner` flames, two `lance` bolts, forty instances) from `WEAPON_TABLE` ids; `dev/BenchScene.ts` draws it with the preparation plan's renderer classes unchanged, so the bench measures the same code a match runs. The scripts print numbers; nothing asserts a number — the acceptance table (spec R25) is read by a person.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest in the node environment, Phaser 4.2.1, `node --test` for `scripts/*.test.mjs`, Playwright 1.62.1 (Chromium and Firefox), `tsx` for importing a `.ts` builder from a node script, Vite's `build --mode development` for a dev-tool-bearing client build.

**Spec:** [`../../specs/2026-09-04-client-rendering-architecture-design.md`](../../specs/2026-09-04-client-rendering-architecture-design.md) — §1 (the measurements), §9 R23 (perf overlay), R24 (bench scene, Playwright runner, `bench-visual.mjs`), R25 (acceptance table), §10 V0 row. Ledger: [`interfaces.md`](interfaces.md) §Client → Rendering (V-plans). Prior plan: [`01-prep-arena-scene-split-and-render-frame.md`](01-prep-arena-scene-split-and-render-frame.md) (assumed landed: `match/render-frame.ts`, `scenes/arena/*`, `scripts/smoke-arena.mjs`, Playwright in root `devDependencies`). Netcode companion for the netgraph hook: [`../../specs/2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) §7 (`?debug=net`).

## Global Constraints

- Rebuild shared before testing (`npm run build -w @motor-combat-moba/shared`).
- Verify with root `npm test`, never a per-workspace run alone.
- `.js` import specifiers on every local import; shared is imported as `@motor-combat-moba/shared` and consumed as built `dist`.
- Nothing under `packages/client/src/match/` imports Phaser and no test imports Phaser. `dev/bench-frame.ts`, `render/perf-stats.ts` and `config/client-mode.ts` are Phaser-free for the same reason: their tests run under vitest's node environment.
- Do not touch `packages/server/playtest/` except to fix a compile break, and say loudly in the task's commit step which probe numbers your change moves. **This plan moves none:** it adds instrumentation around the sim and never edits `sim/`, a table, the tick order or the client's prediction; no probe reads a client scene or a script.
- Do not edit `docs/ideas/` or `docs/invariants/`.
- Commit after every task on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch off it).
- No magic numbers in logic: every threshold, window, position and count in this plan is a named constant in a config object (`PERF_OVERLAY_CONFIG`, `BENCH_CEILING`, `BENCH_LAYOUT`, `BENCH_ARENA_DEFAULTS`).
- The bench scene is dev-only: it renders `DEV_TOOL_MARKER` and is reached only through `dev/registry.ts`, so `scripts/build-release.mjs`'s `assertNoDevOnlyCode` strips it exactly as it strips the playground. Never import it statically from anything that ships.
- This plan changes no balance table, drive constant, `TICK_RATE_HZ`, weapon row, status row, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `AIM_CONFIG.lockRange` or `ARENA_WIDTH`, so neither `npm run build:manual` nor `docs/turn-tuning.md` is owed a change. If a task's diff touches one of those by accident, stop.

## File Structure

| File | Responsibility |
|---|---|
| `packages/client/src/config/client-mode.ts` (modify) | `debugFlags`, `hasDebugFlag`, `PERF_DEBUG_FLAG`; `isDebugEnabled` reads the same comma list |
| `packages/client/src/render/perf-stats.ts` (create) | Pure: `SampleRing`, `percentile`, `PerfRings`, `PerfReport`, `formatPerfLines`, `PERF_OVERLAY_CONFIG` |
| `packages/client/src/render/perf-overlay.ts` (create) | `PerfOverlay`: Phaser event hooks, draw-call wrap, the `Text`, `report()`, the netgraph hook |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | Construct the overlay under `?debug=perf`; three marks in `update` |
| `packages/client/src/scenes/arena/arena-floor.ts` (create) | `drawArenaFloor`, the floor and camera setup extracted from `ArenaScene.drawArena` so the bench draws the same floor |
| `packages/client/src/dev/bench-frame.ts` (create) | Pure: `BENCH_CEILING`, `BENCH_LAYOUT`, `benchFrame(tick, nowMs, arena)` |
| `packages/client/src/dev/BenchScene.ts` (create) | `?dev=bench`: the ceiling drawn by the preparation plan's renderers; publishes `window.__bench` |
| `packages/client/src/dev/registry.ts` (modify) | Register `bench` |
| `scripts/bench-visual.mjs` (create) | Node microbenchmark: `beamDrawLayers` × 12 flames, earcut over every polygon, the rest of the shot layer |
| `scripts/bench-arena.mjs` (create) | Playwright runner: dev-mode client build, LAN server, `?dev=bench` on Chromium and Firefox, p50/p95 table |
| `package.json` (modify) | `bench:visual`, `bench:arena` scripts; `tsx` dev dependency |
| `docs/render-bench.md` (create), `CLAUDE.md`, `packages/client/CLAUDE.md`, `docs/project-structure.md` (modify) | How to run the instruments, and the V0 baseline numbers |

---

### Task 1: `?debug=perf` — debug flags are a comma list

**Files:**
- Modify: `packages/client/src/config/client-mode.ts:1-7`
- Test: `packages/client/src/config/client-mode.test.ts`

**Interfaces:**
- Produces: `debugFlags(search?: string): ReadonlySet<string>`; `hasDebugFlag(flag: string, search?: string): boolean`; `PERF_DEBUG_FLAG = "perf"`; `isDebugEnabled` keeps its signature and now means `hasDebugFlag("1")`. Tasks 3 and 5 consume `hasDebugFlag` and `PERF_DEBUG_FLAG`. The netcode stream's `?debug=net` overlay is expected to read `hasDebugFlag("net")` from here too, so `?debug=1,perf,net` turns on all three.

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/src/config/client-mode.test.ts`, and extend the `debugFlags` import:

```ts
import { PERF_DEBUG_FLAG, debugFlags, detectServerEndpoint, devToolId, hasDebugFlag, isDebugEnabled } from "./client-mode.js";

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
 * Every developer overlay asked for in the URL, as `?debug=<a>,<b>`: `1` draws the car OBB outline
 * in the arena, `perf` the frame-time overlay, `net` the netgraph. One comma list rather than a
 * flag per overlay, so two can be on at once. A bare `?debug` or a blank entry asks for nothing —
 * an overlay has to be named deliberately.
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
Expected: PASS — the existing `isDebugEnabled` cases (`?debug`, `?debug=0`, `?debug=true` all false) still hold, because none of those lists contains the entry `1`.

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
- Produces (Task 3, Task 5 and `scripts/bench-arena.mjs` consume them):

```ts
export const PERF_OVERLAY_CONFIG: { x: number; y: number; fontPx: number; depth: number; refreshMs: number; windowFrames: number; drawCallsUnavailable: number }
export function percentile(sorted: ArrayLike<number>, length: number, p: number): number
export class SampleRing { constructor(capacity: number); push(value: number): void; readonly length: number; percentile(p: number): number; max(): number; clear(): void }
export interface PerfSample { frameMs; jsMs; simMs; buildMs; drawMs; phaserMs; renderMs; drawCalls }   // all number
export interface PerfReport {
  frames: number;
  frameMs: { p50: number; p95: number };
  jsMs: { p50: number; p95: number };
  split: { sim: number; build: number; draw: number; phaser: number; render: number };   // p50 ms each
  drawCalls: { p50: number; max: number };   // PERF_OVERLAY_CONFIG.drawCallsUnavailable on the Canvas renderer
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
import {
  PERF_OVERLAY_CONFIG,
  PerfRings,
  SampleRing,
  formatPerfLines,
  percentile,
  type PerfSample,
} from "./perf-stats.js";

const sample = (over: Partial<PerfSample> = {}): PerfSample => ({
  frameMs: 16.7, jsMs: 3, simMs: 0.5, buildMs: 0.7, drawMs: 1.2, phaserMs: 0.3, renderMs: 0.6, drawCalls: 9,
  ...over,
});

describe("percentile", () => {
  it("is nearest-rank over the sorted prefix", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 100, 50)).toBe(50);
    expect(percentile(sorted, 100, 95)).toBe(95);
    expect(percentile(sorted, 100, 100)).toBe(100);
    expect(percentile(sorted, 10, 95)).toBe(10);
  });

  it("is 0 over nothing", () => {
    expect(percentile([], 0, 50)).toBe(0);
  });
});

describe("SampleRing", () => {
  it("keeps the newest `capacity` samples and reads percentiles off them", () => {
    const ring = new SampleRing(4);
    for (const v of [100, 1, 2, 3, 4]) ring.push(v);
    expect(ring.length).toBe(4);
    expect(ring.max()).toBe(4);
    expect(ring.percentile(50)).toBe(2);
    expect(ring.percentile(95)).toBe(4);
  });

  it("does not disturb the stored order when it sorts for a percentile", () => {
    const ring = new SampleRing(3);
    for (const v of [3, 1, 2]) ring.push(v);
    ring.percentile(50);
    ring.push(9);
    // After the push the oldest (3) is gone; had percentile() sorted in place, 1 would have been.
    expect(ring.max()).toBe(9);
    expect(ring.percentile(1)).toBe(1);
  });
});

describe("PerfRings", () => {
  it("reports p50/p95 of every channel and the extra counters it is handed", () => {
    const rings = new PerfRings(8);
    for (let i = 1; i <= 8; i++) rings.push(sample({ frameMs: i, jsMs: i / 2, drawCalls: i }));
    const report = rings.report(14, 0, "medium");
    expect(report.frames).toBe(8);
    expect(report.frameMs).toEqual({ p50: 4, p95: 8 });
    expect(report.jsMs).toEqual({ p50: 2, p95: 4 });
    expect(report.split).toEqual({ sim: 0.5, build: 0.7, draw: 1.2, phaser: 0.3, render: 0.6 });
    expect(report.drawCalls).toEqual({ p50: 4, max: 8 });
    expect(report.textures).toBe(14);
    expect(report.particles).toBe(0);
    expect(report.tier).toBe("medium");
  });

  it("defaults its window to PERF_OVERLAY_CONFIG.windowFrames", () => {
    const rings = new PerfRings();
    for (let i = 0; i < PERF_OVERLAY_CONFIG.windowFrames + 5; i++) rings.push(sample());
    expect(rings.frames).toBe(PERF_OVERLAY_CONFIG.windowFrames);
  });
});

describe("formatPerfLines", () => {
  it("prints three lines with one decimal and names the draw-call gap on Canvas", () => {
    const rings = new PerfRings(4);
    rings.push(sample({ drawCalls: PERF_OVERLAY_CONFIG.drawCallsUnavailable }));
    const lines = formatPerfLines(rings.report(12, 0, "medium"));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("frame 16.7 / 16.7 ms  js 3.0 / 3.0 ms  (p50 / p95, 1 frames)");
    expect(lines[1]).toBe("sim 0.5  build 0.7  draw 1.2  phaser 0.3  render 0.6  (p50 ms)");
    expect(lines[2]).toBe("draws n/a (canvas)  textures 12  particles 0  tier medium");
  });

  it("prints draw calls as p50 (max) on WebGL", () => {
    const rings = new PerfRings(4);
    rings.push(sample({ drawCalls: 9 }));
    rings.push(sample({ drawCalls: 11 }));
    expect(formatPerfLines(rings.report(12, 0, "medium"))[2]).toBe(
      "draws 9 (max 11)  textures 12  particles 0  tier medium",
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
 * The numbers behind the `?debug=perf` overlay (rendering spec R23), kept Phaser-free so they can
 * be tested and so `scripts/bench-arena.mjs` can read the same `PerfReport` shape out of the page.
 *
 * Everything on the per-frame path here is preallocated: rings are typed arrays sized once, a
 * percentile sorts a scratch copy, and `PerfRings.push` writes eight numbers and allocates nothing
 * (spec R6 — an instrument that allocates per frame would show up in its own GC column).
 */

export const PERF_OVERLAY_CONFIG = {
  /** Screen position of the text block, in canvas pixels. */
  x: 8,
  y: 8,
  fontPx: 12,
  /** Above every HUD element; the overlay is the last thing drawn (layer 7 in spec §4). */
  depth: 1000,
  /**
   * How often the text is re-rasterised. A `Text.setText` re-uploads a canvas-backed texture (spec
   * §1), so the overlay refreshes at 4 Hz rather than per frame to keep its own cost off the
   * numbers it shows. V1 replaces the `Text` with `BitmapText`, which has no such cost.
   */
  refreshMs: 250,
  /** Rolling window: 10 s at 60 Hz, the same window the bench reports over (R24). */
  windowFrames: 600,
  /** The draw-call value reported when the renderer is Canvas, where there are no GL draw calls. */
  drawCallsUnavailable: -1,
} as const;

/**
 * Nearest-rank percentile over the first `length` entries of an already-sorted sequence. `p` is in
 * [0, 100]. Over nothing the answer is 0, so an overlay on its first frame prints zeros rather
 * than NaN.
 */
export function percentile(sorted: ArrayLike<number>, length: number, p: number): number {
  if (length <= 0) return 0;
  const rank = Math.ceil((p / 100) * length);
  return sorted[Math.min(length - 1, Math.max(0, rank - 1))]!;
}

/** A fixed-capacity ring of numbers that can answer a percentile and a max without allocating. */
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

  clear(): void {
    this.next = 0;
    this.count = 0;
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

/** One frame's measurements, as `PerfOverlay` fills them in. All milliseconds except `drawCalls`. */
export interface PerfSample {
  /** Wall time between this frame and the previous one — `game.loop.rawDelta`. */
  frameMs: number;
  /** Everything the game's JavaScript did this frame: the whole step plus the whole render. */
  jsMs: number;
  /** The scene's `sim` mark: input pump and prediction. 0 in the bench scene, which has no sim. */
  simMs: number;
  /** The scene's `build` mark: `RenderFrame` construction. */
  buildMs: number;
  /** The scene's `draw` mark: the renderer classes updating Phaser objects. */
  drawMs: number;
  /** The rest of Phaser's step outside the scene's own marks: input, tweens, other scenes. */
  phaserMs: number;
  /** `PRE_RENDER` to `POST_RENDER`: scene-graph walk, tessellation, batch submission. */
  renderMs: number;
  /** GL draw calls submitted during the render, or `PERF_OVERLAY_CONFIG.drawCallsUnavailable`. */
  drawCalls: number;
}

export interface PerfReport {
  frames: number;
  frameMs: { p50: number; p95: number };
  jsMs: { p50: number; p95: number };
  /** p50 of each bucket, so the five roughly add up to `jsMs.p50`. */
  split: { sim: number; build: number; draw: number; phaser: number; render: number };
  drawCalls: { p50: number; max: number };
  textures: number;
  /** Live particles. 0 until V4's `ParticleService` exists to report one. */
  particles: number;
  /** The quality tier. The literal "medium" until V5's `TierManager` exists to report one. */
  tier: string;
}

export class PerfRings {
  private readonly frame: SampleRing;
  private readonly js: SampleRing;
  private readonly sim: SampleRing;
  private readonly build: SampleRing;
  private readonly draw: SampleRing;
  private readonly phaser: SampleRing;
  private readonly render: SampleRing;
  private readonly draws: SampleRing;

  constructor(windowFrames: number = PERF_OVERLAY_CONFIG.windowFrames) {
    this.frame = new SampleRing(windowFrames);
    this.js = new SampleRing(windowFrames);
    this.sim = new SampleRing(windowFrames);
    this.build = new SampleRing(windowFrames);
    this.draw = new SampleRing(windowFrames);
    this.phaser = new SampleRing(windowFrames);
    this.render = new SampleRing(windowFrames);
    this.draws = new SampleRing(windowFrames);
  }

  get frames(): number {
    return this.frame.length;
  }

  push(sample: PerfSample): void {
    this.frame.push(sample.frameMs);
    this.js.push(sample.jsMs);
    this.sim.push(sample.simMs);
    this.build.push(sample.buildMs);
    this.draw.push(sample.drawMs);
    this.phaser.push(sample.phaserMs);
    this.render.push(sample.renderMs);
    this.draws.push(sample.drawCalls);
  }

  report(textures: number, particles: number, tier: string): PerfReport {
    return {
      frames: this.frame.length,
      frameMs: { p50: this.frame.percentile(50), p95: this.frame.percentile(95) },
      jsMs: { p50: this.js.percentile(50), p95: this.js.percentile(95) },
      split: {
        sim: this.sim.percentile(50),
        build: this.build.percentile(50),
        draw: this.draw.percentile(50),
        phaser: this.phaser.percentile(50),
        render: this.render.percentile(50),
      },
      drawCalls: { p50: this.draws.percentile(50), max: this.draws.max() },
      textures,
      particles,
      tier,
    };
  }
}

const ms = (value: number): string => value.toFixed(1);

/** The three lines the overlay shows, in the order the spec lists the counters (R23). */
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
Expected: PASS (8 tests). In the `SampleRing` "keeps the newest" case the stored values are `[1, 2, 3, 4]`: nearest-rank p50 of four is the 2nd (`2`), p95 the 4th (`4`).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/perf-stats.ts packages/client/src/render/perf-stats.test.ts
git commit -m "feat(client): perf-stats — rings, percentiles and the PerfReport shape for the perf overlay"
```

---

### Task 3: `PerfOverlay` and the three marks in `ArenaScene`

**Files:**
- Create: `packages/client/src/render/perf-overlay.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (the composer the preparation plan's Task 9 produced: its `create`, `update`, `resetMatchState`, and the field list)

**Interfaces:**
- Consumes: Task 1's `hasDebugFlag`, `PERF_DEBUG_FLAG`; Task 2's `PerfRings`, `PerfSample`, `PerfReport`, `formatPerfLines`, `PERF_OVERLAY_CONFIG`; `ArenaLayers.hud` from the preparation plan.
- Produces (the ledger's `PerfOverlay`, plus the extras Task 5 and the netgraph need):

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
  /** "webgl" | "canvas" — which renderer the numbers describe. */
  readonly rendererKind: "webgl" | "canvas";
  /** Every object the overlay owns, for the caller to register with `ArenaLayers.hud`. */
  gameObjects(): Phaser.GameObjects.GameObject[];
  destroy(): void;
}
```

Where the counters come from, named exactly (all verified in `node_modules/phaser` 4.2.1):

| Counter | Source |
|---|---|
| frame time | `game.loop.rawDelta` — `Phaser.Core.TimeStep.step` (`src/core/TimeStep.js:718-750`) sets `this.rawDelta = time - this.lastTime` before calling `Game.step`, so reading it in `PRE_STEP` gives this frame's interval |
| step / render boundaries | `Game.step` (`src/core/Game.js:454-502`) emits `Phaser.Core.Events.PRE_STEP`, then `scene.update`, then `POST_STEP`, then `renderer.preRender()`, `PRE_RENDER`, `scene.render`, `renderer.postRender()`, `POST_RENDER` |
| draw calls | there is **no** counter in 4.2.1's `WebGLRenderer` or `RenderNodeManager`; every batch handler submits through `WebGLRenderer.drawElements` (`src/renderer/webgl/WebGLRenderer.js:2068`, "the primary render method") or `drawInstancedArrays` (`:2103`), so the overlay wraps those two on the renderer instance and counts calls |
| textures | `Object.keys(scene.textures.list).length` — `TextureManager.list` (`src/textures/TextureManager.js:100`) |
| particles | the literal `0` until V4 |
| tier | the literal `"medium"` until V5 |

- [ ] **Step 1: Write the overlay**

```ts
// packages/client/src/render/perf-overlay.ts
import Phaser from "phaser";
import {
  PERF_OVERLAY_CONFIG,
  PerfRings,
  formatPerfLines,
  type PerfReport,
  type PerfSample,
} from "./perf-stats.js";

export type PerfMark = "sim" | "build" | "draw";

/** The literals the overlay prints until the phases that own them ship (V4 particles, V5 tiers). */
const PARTICLES_UNTIL_V4 = 0;
const TIER_UNTIL_V5 = "medium";

type DrawMethod = "drawElements" | "drawInstancedArrays";
const DRAW_METHODS: readonly DrawMethod[] = ["drawElements", "drawInstancedArrays"];

/**
 * Counts GL draw calls by wrapping the two `WebGLRenderer` methods every render node submits
 * through (4.2.1 keeps no counter of its own). The wrap is an own property on the renderer
 * instance, so it shadows the prototype method and `delete` restores it. Returns the unpatch.
 */
function countDrawCalls(game: Phaser.Game, onDraw: () => void): () => void {
  if (game.config.renderType !== Phaser.WEBGL) return () => {};
  const renderer = game.renderer as unknown as Record<DrawMethod, (...args: unknown[]) => void>;
  for (const method of DRAW_METHODS) {
    const original = renderer[method];
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
 * The `?debug=perf` overlay (rendering spec R23): frame time split into the scene's own marks
 * (`sim`, `build`, `draw`), the rest of Phaser's step, and the render; GL draw calls; texture
 * count; particles; tier.
 *
 * The scene brackets its `update` with `frameStart()` … `mark()` … `frameEnd()`; the overlay hooks
 * the game's step events for everything outside that bracket. A frame with no `frameStart` (a
 * scene that does not mark) still records frame, phaser and render time with zero marks.
 */
export class PerfOverlay {
  readonly rendererKind: "webgl" | "canvas";
  private readonly game: Phaser.Game;
  private readonly text: Phaser.GameObjects.Text;
  private readonly rings = new PerfRings();
  private readonly sample: PerfSample = {
    frameMs: 0, jsMs: 0, simMs: 0, buildMs: 0, drawMs: 0, phaserMs: 0, renderMs: 0, drawCalls: 0,
  };
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
    const spent = now - this.lastMarkMs;
    this.lastMarkMs = now;
    if (label === "sim") this.sample.simMs += spent;
    else if (label === "build") this.sample.buildMs += spent;
    else this.sample.drawMs += spent;
  }

  frameEnd(): void {
    this.sceneMs = performance.now() - this.frameStartMs;
  }

  attachNetgraph(lines: () => readonly string[]): void {
    this.netgraph = lines;
  }

  report(): PerfReport {
    return this.rings.report(this.textureCount(), PARTICLES_UNTIL_V4, TIER_UNTIL_V5);
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

  private textureCount(): number {
    return Object.keys(this.scene.textures.list).length;
  }

  private onPreStep(): void {
    this.stepStartMs = performance.now();
    this.sample.frameMs = this.game.loop.rawDelta;
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
    const sample = this.sample;
    sample.renderMs = now - this.renderStartMs;
    sample.jsMs = this.stepMs + sample.renderMs;
    // What Phaser did in the step that was not inside the scene's own bracket.
    sample.phaserMs = Math.max(0, this.stepMs - this.sceneMs);
    sample.drawCalls =
      this.rendererKind === "webgl" ? this.drawCalls : PERF_OVERLAY_CONFIG.drawCallsUnavailable;
    this.rings.push(sample);
    sample.simMs = 0;
    sample.buildMs = 0;
    sample.drawMs = 0;
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

Two notes for the implementer. `Phaser.Core.Events.PRE_STEP` and friends are the string constants at `types/phaser.d.ts:6576-6601`; `game.config.renderType` (`:6032`) is `Phaser.WEBGL` (`2`) once Phaser has resolved `AUTO`. `delete renderer[method]` is the restore rather than reassigning the original, because the original is a prototype method and reassigning it would leave an own property that a second overlay would wrap twice.

- [ ] **Step 2: Wire the overlay into `ArenaScene`**

The composer from the preparation plan (Task 9) is the file being edited; apply these four edits.

Imports — add:

```ts
import { PERF_DEBUG_FLAG, hasDebugFlag, isDebugEnabled } from "../config/client-mode.js";
import { PerfOverlay } from "../render/perf-overlay.js";
```

Fields — after `private layers: ArenaLayers | undefined;` add:

```ts
private perf: PerfOverlay | undefined;
```

`create` — immediately after `this.layers = new ArenaLayers(this);`:

```ts
if (hasDebugFlag(PERF_DEBUG_FLAG)) {
  this.perf = new PerfOverlay(this);
  for (const obj of this.perf.gameObjects()) this.layers.hud(obj);
}
```

`update` — the preparation plan's body with the bracket added. The substitution table names each insertion against that plan's lines:

| After this line of the preparation plan's `update` | Insert |
|---|---|
| `if (!room \|\| !this.arena \|\| !net) return;` | `this.perf?.frameStart();` |
| `if (pumped.activeInput) this.banners?.hideIdleWarning();` | `this.perf?.mark("sim");` |
| `this.lastFrame = frame;` | `this.perf?.mark("build");` |
| `this.hudRenderer?.render(frame, this.spectate?.hudTarget(frame) ?? frame.localSessionId);` | `this.perf?.mark("draw");` then `this.perf?.frameEnd();` |

`syncBanners` builds a second frame before `pumpInput` runs; that cost lands in `sim`. It is small and it is what the game does, so the bucket is honest; note it in the doc (Task 8) rather than hiding it.

`resetMatchState` — before `this.layers = undefined;`:

```ts
this.perf?.destroy();
this.perf = undefined;
```

- [ ] **Step 3: Typecheck and the client suite**

Run: `cd packages/client && npm run typecheck && npx vitest run`
Expected: typecheck clean; every client test green (no test imports the overlay, which imports Phaser).

- [ ] **Step 4: Look at it**

Run `npm run dev`, open `http://localhost:5173/?debug=perf`, Practice → Start. Expected: three monospace lines top-left, refreshing four times a second, `draws` a small integer, `sim`/`build`/`draw` all non-zero once the match runs, `textures` in the teens. Open `?debug=1,perf` and confirm hitboxes and the overlay are both on.

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
- Consumes: `RenderFrame`, `RenderCar`, `RenderInstance` (preparation plan Task 1); `WEAPON_TABLE`, `weaponDefOf`, `slotsOf`, `hpOf`, `muzzleOf`, `COLOR_TABLE`, `WeaponKind`, `PlayerStatus`, `RoomPhase`, `GameMode`, `ArenaDef` from shared.
- Produces (Task 5 and `scripts/bench-visual.mjs` read the same counts):

```ts
export const BENCH_CEILING: { cars: 6; afterburners: 12; lances: 2; predators: 6; thumpers: 6; magmablasts: 6; pepperboxes: 8 }
export const BENCH_INSTANCE_COUNT: number          // 40
export const BENCH_LAYOUT: { carRing: number; shotRing: number; carOrbitRadPerTick: number; shotOrbitRadPerTick: number; lanceX: number; lanceYs: readonly number[]; beamAgeTicks: number }
export function benchFrame(tick: number, nowMs: number, arena: ArenaDef): RenderFrame
```

The ceiling is a superposition, not a legal match: the six cars cycle through the three chassis so every silhouette is drawn, and the instances are fabricated by weapon id without regard to who could carry them. Twelve `afterburner` flames sit at the two muzzles (`muzzles: [0, 180]`) of every car; the two `lance` bolts are fixed 1200-unit beams across the floor (a lance's `attached: true` matters to the sim, not to the drawing); the twenty-six projectiles orbit on a ring. `12 + 2 + 6 + 6 + 6 + 8 = 40`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/dev/bench-frame.test.ts
import { describe, expect, it } from "vitest";
import {
  ACTIVE_ARENA_ID,
  WeaponKind,
  getArena,
  isWeaponId,
  weaponDefOf,
} from "@motor-combat-moba/shared";
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
    expect(count(frame, "predator")).toBe(BENCH_CEILING.predators);
    expect(count(frame, "thumper")).toBe(BENCH_CEILING.thumpers);
    expect(count(frame, "magmablast")).toBe(BENCH_CEILING.magmablasts);
    expect(count(frame, "pepperbox")).toBe(BENCH_CEILING.pepperboxes);
    for (const instance of frame.instances) expect(isWeaponId(instance.weaponId)).toBe(true);
  });

  it("draws every beam at full extent and full alpha", () => {
    const frame = benchFrame(100, 0, arena);
    for (const instance of frame.instances) {
      if (instance.kind !== WeaponKind.BEAM) continue;
      expect(instance.extent).toBe(weaponDefOf(instance.weaponId as "afterburner" | "lance").range);
      expect(
        beamFadeAlpha(instance.kind, instance.weaponId, instance.spawnTick, frame.tick, false),
      ).toBe(1);
    }
  });

  it("is a match frame with one local car, sorted by session id, every car on the field", () => {
    const frame = benchFrame(100, 0, arena);
    expect(frame.cars.map((c) => c.sessionId)).toEqual([...frame.cars.map((c) => c.sessionId)].sort());
    expect(frame.cars.filter((c) => c.isLocal)).toHaveLength(1);
    expect(frame.localSessionId).toBe(frame.cars.find((c) => c.isLocal)!.sessionId);
    expect(frame.cars.every((c) => c.onField && c.alive)).toBe(true);
    expect(frame.cars.map((c) => c.carId)).toEqual([
      "mirage", "bullseye", "bastion", "mirage", "bullseye", "bastion",
    ]);
    expect(frame.cars.every((c) => c.weapons.length === 3)).toBe(true);
    expect(frame.events).toEqual([]);
    expect(frame.arenaId).toBe(arena.id);
  });

  it("keeps every car and projectile inside the arena as the ring turns", () => {
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
  });

  it("is deterministic in tick and moves between ticks", () => {
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
  COLOR_TABLE,
  GameMode,
  PlayerStatus,
  RoomPhase,
  WeaponKind,
  hpOf,
  muzzleOf,
  slotsOf,
  weaponDefOf,
  type ArenaDef,
  type CarId,
  type SimBody,
  type WeaponId,
} from "@motor-combat-moba/shared";
import type { RenderCar, RenderFrame, RenderInstance, RenderSlot } from "../match/render-frame.js";

/**
 * The visual ceiling the rendering spec measures against (§1, R24): six cars, every one burning
 * `afterburner` from both muzzles, two `lance` bolts, and enough projectiles to make forty
 * instances. A superposition, not a legal match — nobody checks who could carry what.
 */
export const BENCH_CEILING = {
  cars: 6,
  afterburners: 12,
  lances: 2,
  predators: 6,
  thumpers: 6,
  magmablasts: 6,
  pepperboxes: 8,
} as const;

export const BENCH_INSTANCE_COUNT =
  BENCH_CEILING.afterburners +
  BENCH_CEILING.lances +
  BENCH_CEILING.predators +
  BENCH_CEILING.thumpers +
  BENCH_CEILING.magmablasts +
  BENCH_CEILING.pepperboxes;

/** Where things sit, in world units and radians per tick. Rings are centred on the arena. */
export const BENCH_LAYOUT = {
  /** Radius of the ring the cars drive around. */
  carRing: 200,
  /** Radius of the ring the projectiles fly around, outside the cars. */
  shotRing: 300,
  carOrbitRadPerTick: 0.006,
  shotOrbitRadPerTick: 0.02,
  /** The two lances start here and run the full `range` to the right. */
  lanceX: 40,
  lanceYs: [300, 420],
  /** A beam this many ticks old is still at full alpha (`beamFadeAlpha`) and past its spawn tick. */
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

function benchCar(index: number, tick: number, arena: ArenaDef): RenderCar {
  const carId = CHASSIS_CYCLE[index % CHASSIS_CYCLE.length]!;
  const theta = (TWO_PI * index) / BENCH_CEILING.cars + tick * BENCH_LAYOUT.carOrbitRadPerTick;
  const x = arena.width / 2 + Math.cos(theta) * BENCH_LAYOUT.carRing;
  const y = arena.height / 2 + Math.sin(theta) * BENCH_LAYOUT.carRing;
  // Heading along the ring, so the car faces the way it is moving.
  const pose = body(x, y, theta + Math.PI / 2);
  const weapons: RenderSlot[] = slotsOf(carId).map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
  }));
  const sessionId = sessionIdOf(index);
  return {
    sessionId,
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

function instance(
  id: number,
  ownerSessionId: string,
  weaponId: WeaponId,
  x: number,
  y: number,
  angle: number,
  tick: number,
): RenderInstance {
  const def = weaponDefOf(weaponId);
  const beam = def.kind === "beam";
  return {
    id: `bench-shot-${id}`,
    ownerSessionId,
    weaponId,
    kind: beam ? WeaponKind.BEAM : WeaponKind.PROJECTILE,
    x,
    y,
    angle,
    // A beam is drawn fully grown; a projectile's extent is unused by the drawing.
    extent: beam ? def.range : 0,
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
    const forward = muzzleOf(car.pose);
    const rear = muzzleOf({ x: car.pose.x, y: car.pose.y, angle: car.pose.angle + Math.PI });
    instances.push(instance(next++, car.sessionId, "afterburner", forward.x, forward.y, car.pose.angle, tick));
    instances.push(instance(next++, car.sessionId, "afterburner", rear.x, rear.y, car.pose.angle + Math.PI, tick));
  }

  // Bolts: fixed across the floor, owned by the first two cars.
  for (let i = 0; i < BENCH_CEILING.lances; i++) {
    instances.push(instance(next++, cars[i]!.sessionId, "lance", BENCH_LAYOUT.lanceX, BENCH_LAYOUT.lanceYs[i]!, 0, tick));
  }

  // Projectiles: evenly spaced on the outer ring, heading along it, each owned by some car.
  const projectiles: WeaponId[] = [];
  for (let i = 0; i < BENCH_CEILING.predators; i++) projectiles.push("predator");
  for (let i = 0; i < BENCH_CEILING.thumpers; i++) projectiles.push("thumper");
  for (let i = 0; i < BENCH_CEILING.magmablasts; i++) projectiles.push("magmablast");
  for (let i = 0; i < BENCH_CEILING.pepperboxes; i++) projectiles.push("pepperbox");
  projectiles.forEach((weaponId, i) => {
    const theta = (TWO_PI * i) / projectiles.length + tick * BENCH_LAYOUT.shotOrbitRadPerTick;
    const x = arena.width / 2 + Math.cos(theta) * BENCH_LAYOUT.shotRing;
    const y = arena.height / 2 + Math.sin(theta) * BENCH_LAYOUT.shotRing;
    instances.push(instance(next++, cars[i % cars.length]!.sessionId, weaponId, x, y, theta + Math.PI / 2, tick));
  });

  return {
    tick,
    phase: RoomPhase.MATCH,
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

`muzzleOf` takes a pose (`packages/shared/src/sim/weapons/lock.ts:40`) and is exported from shared's index. `FFA_DEATHMATCH` with `matchEndsTick: 0` is the practice room's combination, which hides the clock and keeps the kills panel — the HUD the bench should draw.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/client && npx vitest run src/dev/bench-frame.test.ts`
Expected: PASS (5 tests). `beamFadeAlpha` returns 1 for a 2-tick-old `afterburner` (lifetime 2000 ms, fade window `BEAM_FADE_OUT_MS` = 100 ms) and `lance` (1500 ms).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/bench-frame.ts packages/client/src/dev/bench-frame.test.ts
git commit -m "feat(client): bench-frame — the visual ceiling as a pure RenderFrame"
```

---

### Task 5: `BenchScene` (`?dev=bench`) and the shared floor

**Files:**
- Create: `packages/client/src/scenes/arena/arena-floor.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`drawArena`, today `ArenaScene.ts:927-960`; after the preparation plan it is the boolean-returning method its Task 9 Step 3 describes)
- Create: `packages/client/src/dev/BenchScene.ts`
- Modify: `packages/client/src/dev/registry.ts`, `packages/client/src/dev/registry.test.ts`

**Interfaces:**
- Consumes: Task 3's `PerfOverlay`; Task 4's `benchFrame`; `ArenaLayers`, `CarRenderer`, `ShotRenderer`, `HudRenderer`, `MatchBanners`, `SpectateView` from the preparation plan; `DEV_TOOL_MARKER`.
- Produces: `drawArenaFloor(scene, layers, arena): { gfx: Phaser.GameObjects.Graphics; staticCamera: boolean }`; the `bench` dev tool; `window.__bench: BenchProbe` (`{ ready: true; renderer: "webgl" | "canvas"; frames(): number; report(): PerfReport }`), which `scripts/bench-arena.mjs` reads.

- [ ] **Step 1: Extract the floor**

`drawArena`'s body is the floor, the camera viewport, background, zoom, bounds and the fit test. Move it into a function so the bench draws the same floor with the same camera, using this substitution table against the preparation plan's `drawArena`:

| In `ArenaScene.drawArena` | In `drawArenaFloor` |
|---|---|
| `this.add.graphics()` (wrapped in `this.layers!.world(...)`) | `layers.world(scene.add.graphics())` |
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

/** Border stroke width, moved from `ArenaScene`'s `ARENA_BORDER_PX`. */
export const ARENA_BORDER_PX = 4;
/** The floor everything else is drawn on, moved from `ArenaScene`'s `ARENA_DEPTH`. */
export const ARENA_DEPTH = -10;

/**
 * The arena floor and the world camera's setup, shared by `ArenaScene` and the bench scene so a
 * benchmark draws exactly the floor a match does. Body moved verbatim from `ArenaScene.drawArena`;
 * see that method's comments for why the viewport is set before `centerOn` and why the camera
 * reads `ARENA_VIEW_WIDTH` rather than `VIEW_WIDTH`.
 */
export function drawArenaFloor(
  scene: Phaser.Scene,
  layers: ArenaLayers,
  arena: ArenaDef,
): { gfx: Phaser.GameObjects.Graphics; staticCamera: boolean } {
  const colors = arenaColorsOf(arena);
  const gfx = layers.world(scene.add.graphics().setDepth(ARENA_DEPTH));
  gfx.fillStyle(colors.obstacle, 1);
  for (const obstacle of arena.obstacles) {
    gfx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
  }
  gfx.lineStyle(ARENA_BORDER_PX, colors.border, 1);
  const border = arenaBorderRect(arena, ARENA_BORDER_PX);
  gfx.strokeRect(border.x, border.y, border.w, border.h);

  const cam = scene.cameras.main;
  cam.setViewport(0, 0, ARENA_VIEW_WIDTH, VIEW_HEIGHT);
  cam.setBackgroundColor(colors.floor);
  cam.setZoom(CAMERA_CONFIG.zoom);
  cam.setBounds(0, 0, arena.width, arena.height);
  const staticCamera = fitsViewport(
    arena,
    { width: ARENA_VIEW_WIDTH, height: VIEW_HEIGHT },
    CAMERA_CONFIG.zoom,
  );
  if (staticCamera) cam.centerOn(arena.width / 2, arena.height / 2);
  return { gfx, staticCamera };
}
```

In `ArenaScene`, delete the `ARENA_BORDER_PX` and `ARENA_DEPTH` constants (import `ARENA_DEPTH` only if something else in the scene still reads it; today nothing does) and replace `drawArena`'s body with:

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
import { MatchBanners, type SpectateView } from "../scenes/arena/match-banners.js";
import { ShotRenderer } from "../scenes/arena/shot-renderer.js";
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
 * composes, so what this measures is what a match costs. There is no sim here, so the overlay's
 * `sim` bucket reads 0 — the `build` and `draw` buckets are the ones the rendering phases move.
 *
 * `BootScene`'s dev branch adds this under the key `dev.bench` (it overrides the key given to
 * `super()` at its `scene.add` call), which is why the runner finds the scene through
 * `window.__bench` rather than by key. Never started by anything that ships: the registry is the
 * only way in, and `DEV_TOOL_MARKER` below is what `build-release.mjs` asserts absent.
 */
export class BenchScene extends Phaser.Scene {
  private arena: ArenaDef = getArena(ACTIVE_ARENA_ID);
  private layers: ArenaLayers | undefined;
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
    this.layers = layers;
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
    const tick = Math.floor(this.elapsedMs / MS_PER_TICK);
    const frame = benchFrame(tick, performance.now(), this.arena);
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
    this.carRenderer = undefined;
    this.shotRenderer = undefined;
    this.hudRenderer = undefined;
    this.banners = undefined;
    this.perf = undefined;
    this.layers = undefined;
  }
}
```

`MS_PER_TICK` is read from shared, so when N1 moves the sim to 60 Hz the bench's tick clock follows without an edit.

- [ ] **Step 3: Register the tool**

In `packages/client/src/dev/registry.ts`, add to `DEV_TOOLS`:

```ts
  bench: async () => (await import("./BenchScene.js")).BenchScene,
```

In `registry.test.ts`, change the expected id list to `["assets", "playground", "bench"]` and add `expect(isDevToolId("bench")).toBe(true);` to the same test.

- [ ] **Step 4: Typecheck, test, look**

Run: `cd packages/client && npm run typecheck && npx vitest run`
Expected: clean; PASS.

Run `npm run dev`, open `http://localhost:5173/?dev=bench`. Expected: the arena floor, six cars driving a ring, twelve flames, two bolts across the floor, twenty-six projectiles on the outer ring, the slot bar and roster, the perf overlay top-left, `MOTOR DEV TOOL` bottom-left; `?dev=bench&debug=1` outlines every hitbox. In the console, `window.__bench.report()` returns a `PerfReport`.

- [ ] **Step 5: Confirm the release strips it**

Run: `npm run build:release`
Expected: succeeds; `assertNoDevOnlyCode` passes because `BenchScene` is reached only by the dynamic import behind `import.meta.env.DEV`. Then `grep -l "MOTOR DEV TOOL" dist-release/motor-combat-moba/packages/client/dist/assets/*.js` prints nothing.

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
- Consumes: `beamDrawLayers`, `projectileDrawLayers`, `instanceDrawShape` from `packages/client/src/scenes/combat-visual.ts` (imported through `tsx`'s `tsImport`, since the file is TypeScript and imports only `@motor-combat-moba/shared`); Phaser's earcut at `node_modules/phaser/src/geom/polygon/Earcut.js` (CommonJS, loaded by an absolute-path `require`, which bypasses Phaser's `exports` map); `BENCH_CEILING`'s counts, restated here as `CEILING` because a `.mjs` cannot import the client's `.ts` constant without the same loader.
- Produces: `runVisualBench({ frames?, nowStepMs? }): Promise<VisualBenchResult>`; `formatVisualRows(result): string[]`; `npm run bench:visual`.

The two microbenchmarks are the ones spec §1 was written from. Row 1 times `beamDrawLayers("afterburner", …)` twelve times per frame at full range and counts vertices and polygons. Row 2 times earcut over every polygon row 1 produced — what Phaser's `FillPath` render node does per fill per frame (`renderNodes/FillPath.js:63-91`: it flattens the path to `[x0, y0, x1, y1, …]` and calls `Earcut(polygonCache)`). Row 3 is the rest of the shot layer: two lances through `beamDrawLayers`, and the projectiles through `projectileDrawLayers` where a style exists, else the `instanceDrawShape` polygon or circle (a `fillCircle` is a 101-point path, `GraphicsWebGLRenderer.js:225-278`).

- [ ] **Step 1: Add the dependency and the script**

In root `package.json`: add `"tsx": "^4.16.0"` to `devDependencies` (the server already declares the same range, so the lockfile does not move) and `"bench:visual": "npm run build -w @motor-combat-moba/shared && node scripts/bench-visual.mjs"` to `scripts`. Run `npm install`.

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
    assert.equal(flame.polygons % CEILING.afterburners, 0, "every flame has the same layer count");
    assert.equal(earcut.name, "flame earcut");
    assert.equal(earcut.polygons, flame.polygons);
    assert.ok(earcut.triangles > 0);
    assert.equal(rest.name, "rest of the shot layer");
    assert.ok(rest.vertices > 0);
    for (const row of result.rows) assert.ok(row.msPerFrame >= 0, `${row.name} has a time`);
    assert.ok(result.totalMs >= flame.msPerFrame + earcut.msPerFrame + rest.msPerFrame - 1e-9);
  });

  it("prints one line per row plus a total, with ms/frame", async () => {
    const lines = formatVisualRows(await runVisualBench({ frames: 2 }));
    assert.equal(lines.length, 1 + 3 + 1);
    assert.match(lines[0], /ms\/frame/);
    assert.match(lines.at(-1), /^\s*total/);
  });

  it("runs from the command line", () => {
    const out = execFileSync(process.execPath, [SCRIPT, "--frames", "2"], { encoding: "utf8" });
    assert.match(out, /flame geometry/);
    assert.match(out, /ms\/frame/);
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
 * The pure builders at the visual ceiling, timed in node (rendering spec §1, R24).
 *
 * Three rows, median ms per frame over `--frames` (default 200):
 *   1. flame geometry — `beamDrawLayers("afterburner")` x12 at full range: the CPU cost of building
 *      the flame polygons. This is the number the spec's 2.65 ms came from.
 *   2. flame earcut   — Phaser's earcut over every polygon row 1 built, which is what the WebGL
 *      `FillPath` render node does per fill per frame (`renderNodes/FillPath.js:63-91`). The 3.88 ms.
 *   3. rest of layer  — two lances, and the projectiles through `projectileDrawLayers` or, where a
 *      weapon has no style, the raw `instanceDrawShape` polygon (a circle counts as the 101-point
 *      path `fillCircle` records, `GraphicsWebGLRenderer.js:225-278`).
 *
 * Absolute numbers are this machine's; read the ratios and the vertex counts. V2/V3 turn the
 * builders into boot-time bakes, and this script is what says how long a bake costs.
 *
 * `combat-visual.ts` is TypeScript that imports only built shared, so it is loaded through tsx's
 * `tsImport` rather than compiled first. Earcut is Phaser's own CommonJS module, required by
 * absolute path because Phaser's `exports` map does not expose it.
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
export const CEILING = {
  afterburners: 12,
  lances: 2,
  predators: 6,
  thumpers: 6,
  magmablasts: 6,
  pepperboxes: 8,
};

const DEFAULT_FRAMES = 200;
/** A 60 Hz frame; advancing `nowMs` by this per frame exercises the crackle and flicker clocks. */
const DEFAULT_NOW_STEP_MS = 1000 / 60;
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
const LANCES = [
  { x: 40, y: 300, angle: 0 },
  { x: 40, y: 420, angle: 0 },
];
const PROJECTILES = [
  ...Array(CEILING.predators).fill("predator"),
  ...Array(CEILING.thumpers).fill("thumper"),
  ...Array(CEILING.magmablasts).fill("magmablast"),
  ...Array(CEILING.pepperboxes).fill("pepperbox"),
].map((weaponId, i, all) => ({ weaponId, ...ring(all.length, 300)[i] }));

/** Runs `beamDrawLayers` for every flame; returns the polygons it built. */
function buildFlames(cv, nowMs) {
  const polys = [];
  const range = weaponDefOf("afterburner").range;
  for (const f of FLAMES) {
    for (const layer of cv.beamDrawLayers("afterburner", f.x, f.y, f.angle, range, 0, nowMs)) {
      polys.push(layer.points);
    }
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
  const lanceRange = weaponDefOf("lance").range;
  for (const l of LANCES) {
    for (const layer of cv.beamDrawLayers("lance", l.x, l.y, l.angle, lanceRange, 0, nowMs)) {
      vertices += layer.points.length;
      polygons += 1;
    }
  }
  for (const p of PROJECTILES) {
    const instance = { weaponId: p.weaponId, isExplosion: false, x: p.x, y: p.y, angle: p.angle, extent: 0 };
    const layers = cv.projectileDrawLayers(instance, 0);
    if (layers.length > 0) {
      for (const layer of layers) {
        vertices += layer.points.length;
        polygons += 1;
      }
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
function measure(fn, frames, nowStepMs) {
  let last;
  for (let i = 0; i < WARMUP_FRAMES; i++) last = fn(i * nowStepMs);
  const times = [];
  for (let i = 0; i < frames; i++) {
    const nowMs = (WARMUP_FRAMES + i) * nowStepMs;
    const start = performance.now();
    last = fn(nowMs);
    times.push(performance.now() - start);
  }
  return { msPerFrame: median(times), last };
}

export async function runVisualBench({ frames = DEFAULT_FRAMES, nowStepMs = DEFAULT_NOW_STEP_MS } = {}) {
  const cv = await loadBuilders();

  const flame = measure((nowMs) => buildFlames(cv, nowMs), frames, nowStepMs);
  const flamePolys = flame.last;
  const flameVertices = flamePolys.reduce((sum, poly) => sum + poly.length, 0);

  const tri = measure(() => triangulate(flamePolys), frames, nowStepMs);
  const rest = measure((nowMs) => buildRest(cv, nowMs), frames, nowStepMs);

  const rows = [
    {
      name: "flame geometry",
      detail: `beamDrawLayers x${CEILING.afterburners}`,
      msPerFrame: flame.msPerFrame,
      vertices: flameVertices,
      polygons: flamePolys.length,
      triangles: 0,
    },
    {
      name: "flame earcut",
      detail: `Earcut x${flamePolys.length}`,
      msPerFrame: tri.msPerFrame,
      vertices: 0,
      polygons: flamePolys.length,
      triangles: tri.last,
    },
    {
      name: "rest of the shot layer",
      detail: `${CEILING.lances} lance, ${PROJECTILES.length} projectiles`,
      msPerFrame: rest.msPerFrame,
      vertices: rest.last.vertices,
      polygons: rest.last.polygons,
      triangles: 0,
    },
  ];
  return { frames, rows, totalMs: rows.reduce((sum, row) => sum + row.msPerFrame, 0) };
}

const cell = (value, width) => String(value).padStart(width);
const dash = (value) => (value === 0 ? "-" : value);

export function formatVisualRows(result) {
  const lines = [
    `bench-visual: builders at the ceiling, median of ${result.frames} frames  ` +
      `${cell("ms/frame", 9)} ${cell("vertices", 9)} ${cell("polygons", 9)} ${cell("triangles", 10)}`,
  ];
  for (const row of result.rows) {
    lines.push(
      `  ${row.name.padEnd(24)} ${row.detail.padEnd(30)} ${cell(row.msPerFrame.toFixed(3), 9)} ` +
        `${cell(dash(row.vertices), 9)} ${cell(dash(row.polygons), 9)} ${cell(dash(row.triangles), 10)}`,
    );
  }
  lines.push(`  ${"total".padEnd(24)} ${"".padEnd(30)} ${cell(result.totalMs.toFixed(3), 9)}`);
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
  const result = await runVisualBench({ frames: framesArg(argv) });
  for (const line of formatVisualRows(result)) console.log(line);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked && invoked === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
```

- [ ] **Step 5: Run the test to verify it passes, then run the bench**

Run: `npm run build -w @motor-combat-moba/shared && node --test scripts/bench-visual.test.mjs`
Expected: PASS (3 tests).

Run: `npm run bench:visual`
Expected: the header line and four rows; on this container the spec's figures were 2.65 ms / 12,600 vertices / 144 polygons for row 1 and 3.88 ms / 12,132 triangles for row 2 — expect the same vertex, polygon and triangle counts exactly (they are geometry, not timing) and times within a factor of two either way.

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
- Consumes: the server-boot code of `scripts/smoke-arena.mjs` (preparation plan Task 10: `spawn(process.execPath, ["packages/server/dist/index.js"], { env: { DEPLOY_MODE: "lan", PORT, CLIENT_ORIGIN } })` and `waitForHealth`), reproduced here on port 2598 so both scripts can run at once; Task 5's `window.__bench`; Playwright's `chromium` and `firefox`.
- Produces: `parseBenchArgs(argv)`, `formatBenchRows(rows, seconds)`, `npm run bench:arena`; exit 1 on a hard failure only.

Why the client is rebuilt first: a production `vite build` replaces `import.meta.env.DEV` with `false` and drops the dev branch, so `?dev=bench` cannot exist in `packages/client/dist` as `npm run build` leaves it. The script builds the client with `NODE_ENV=development vite build --mode development` — Vite's `resolveConfig` keeps a `NODE_ENV` that is already set and takes the mode from the flag, so `import.meta.env.DEV` is `true` and the dev chunks are emitted — serves that through the LAN server exactly as the smoke check does, and rebuilds the production client afterwards so the tree is left as `npm run build` leaves it (`--keep-dist` skips the restore for a repeat run).

- [ ] **Step 1: Write the failing test**

```js
// scripts/bench-arena.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BENCH_ARENA_DEFAULTS, formatBenchRows, parseBenchArgs } from "./bench-arena.mjs";

describe("parseBenchArgs", () => {
  it("defaults to both browsers, the spec's ten seconds, and restoring dist", () => {
    assert.deepEqual(parseBenchArgs([]), {
      browsers: [...BENCH_ARENA_DEFAULTS.browsers],
      seconds: BENCH_ARENA_DEFAULTS.seconds,
      keepDist: false,
    });
    assert.deepEqual(BENCH_ARENA_DEFAULTS.browsers, ["chromium", "firefox"]);
    assert.equal(BENCH_ARENA_DEFAULTS.seconds, 10);
  });

  it("reads --browsers, --seconds and --keep-dist", () => {
    assert.deepEqual(parseBenchArgs(["--browsers", "firefox", "--seconds", "3", "--keep-dist"]), {
      browsers: ["firefox"],
      seconds: 3,
      keepDist: true,
    });
  });

  it("rejects an unknown browser or a bad duration", () => {
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

  it("prints a measured browser and a skipped one", () => {
    const lines = formatBenchRows(
      [
        { browser: "chromium", renderer: "webgl", report },
        { browser: "firefox", skipped: "Executable doesn't exist" },
      ],
      10,
    );
    assert.match(lines[0], /10 s/);
    assert.match(lines[2], /^\s*chromium\s+598\s+16\.7 \/ 17\.9\s+4\.1 \/ 6\.3\s+9 \/ 11\s+14\s+webgl/);
    assert.match(lines[3], /^\s*firefox\s+skipped: Executable doesn't exist/);
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
 * The bench scene (`?dev=bench`, rendering spec R24) under Playwright, on Chromium and Firefox,
 * printing p50/p95 frame time, the JavaScript split and GL draw calls per browser. Numbers are
 * REPORTED, never asserted: the acceptance table (spec R25) is read by a person on the reference
 * machine, and under software GL in CI the absolute values mean little — what CI watches is a
 * jump between two runs of the same commit range. Exit 1 only on a hard failure: a browser error,
 * a page that never publishes `window.__bench`, or no browser at all.
 *
 * The client is rebuilt in development mode first, because a production build strips `?dev=`
 * (see the comment at `buildClient`), served by the LAN server the same way `smoke-arena.mjs`
 * serves the production one, and rebuilt for production afterwards.
 *
 * Flags: `--browsers chromium,firefox` `--seconds 10` `--keep-dist`. A browser Playwright has not
 * installed is reported as skipped (`npx playwright install firefox` fixes it) rather than failing
 * the run, so a machine with only Chromium still gets a number.
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
  /** How long to wait for the page to publish `window.__bench` — the dev-mode bundle is larger. */
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

/**
 * `vite build` replaces `import.meta.env.DEV` with `false` unless NODE_ENV is development, and
 * Vite's `resolveConfig` keeps a NODE_ENV that is already set while taking the mode from the flag
 * — so both are given, and `BootScene`'s dev branch (and the `bench` chunk behind it) survive.
 */
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
    await page.waitForFunction(() => window.__bench?.ready === true, null, {
      timeout: BENCH_ARENA_DEFAULTS.readyTimeoutMs,
    });
    await page.waitForFunction((n) => window.__bench.frames() >= n, BENCH_ARENA_DEFAULTS.warmupFrames, {
      timeout: BENCH_ARENA_DEFAULTS.readyTimeoutMs,
    });
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
    if (args.keepDist) {
      console.log("[bench] packages/client/dist is a DEVELOPMENT build (--keep-dist); `npm run build` restores it");
    } else {
      buildClient("production");
    }
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked && invoked === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
```

- [ ] **Step 4: Add the script and run the tests**

In root `package.json` `scripts`, add `"bench:arena": "npm run build && node scripts/bench-arena.mjs"` (the full build first, because the LAN server bundle inlines shared and the script rebuilds only the client).

Run: `node --test scripts/bench-arena.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the bench**

Run: `npm run bench:arena`
Expected: the dev-mode client build, the server log, then the table with a `chromium` row (`renderer webgl` under SwiftShader; if the software context is refused Phaser's `AUTO` falls back and the row reads `canvas` with `draws -1 / -1` — a real number for the split either way) and a `firefox` row that is either measured or `skipped: Executable doesn't exist …` on this container, where only Chromium is installed; then the production rebuild. Exit 0. If Chromium cannot launch at all, set `SMOKE_CHROMIUM` to the path `ls /opt/pw-browsers` shows, as the smoke check documents.

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
- Consumes: everything above.
- Produces: the V0 baseline — the spec's migration row ships "baseline numbers", and this page is where they live.

- [ ] **Step 1: Record the baselines**

Run, and keep both outputs:

```bash
npm run bench:visual
npm run bench:arena
```

- [ ] **Step 2: Write `docs/render-bench.md`**

Write the page below, then paste the two outputs verbatim into the fenced blocks under "Baseline", followed by one line naming the machine (`node -p "os.cpus()[0].model + ', ' + os.cpus().length + ' cores'"` prints it) and the commit (`git rev-parse --short HEAD`).

```markdown
# Render benchmarks

Three instruments measure what the client costs per frame. They report; nothing asserts a number.
The rendering spec's acceptance table
([R25](superpowers/specs/2026-09-04-client-rendering-architecture-design.md#9-tiers-governor-and-measurement))
is read off them on the reference machine by a person.

| Instrument | Command | Measures |
|---|---|---|
| `?debug=perf` overlay (`render/perf-overlay.ts`) | any match URL with `?debug=perf` (`?debug=1,perf,net` combines overlays) | the live split of one frame: `sim` (input pump, prediction, and the banner frame `syncBanners` builds first), `build` (the `RenderFrame`), `draw` (the renderer classes), `phaser` (the rest of the step), `render` (`PRE_RENDER` to `POST_RENDER`), GL draw calls, texture count, particles, tier |
| `?dev=bench` scene (`dev/BenchScene.ts`) | `npm run dev`, then `http://localhost:5173/?dev=bench` | the ceiling — six cars, twelve `afterburner` flames, two `lance` bolts, forty instances — drawn by the match's own renderers with no server; `sim` reads 0 there by construction |
| `npm run bench:visual` (`scripts/bench-visual.mjs`) | node, no browser | the pure builders at the ceiling: flame geometry, earcut over it, the rest of the shot layer — ms/frame and vertex counts |
| `npm run bench:arena` (`scripts/bench-arena.mjs`) | Playwright, Chromium and Firefox, software GL | the bench scene's p50/p95 frame time, JavaScript split and draw calls over 10 s; the CI regression check |

Draw calls are counted by wrapping `WebGLRenderer.drawElements` and `drawInstancedArrays`, the
two methods every render node submits through — Phaser 4.2.1 keeps no counter of its own. On the
Canvas renderer the column reads `n/a`. `particles` is 0 until V4 and `tier` is the literal
`medium` until V5; both are placeholders for the phases that own them.

Two things the numbers are not. `bench:arena` under SwiftShader is the CPU side only — the GPU
fill budget is measured on a laptop, not in CI. And the overlay's own `Text` re-rasterises four
times a second, which is inside the numbers it shows until V1 swaps it for `BitmapText`.

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
```

The two `(paste …)` markers and the machine line must be replaced before the commit; `grep -c "(paste" docs/render-bench.md` must print `0`.

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

Under `dev/`, after the `PlaygroundScene.ts` line, add:

```text
        │   ├── BenchScene.ts      # ?dev=bench: the visual ceiling drawn by the match renderers, no server (R24)
        │   ├── bench-frame.ts     # pure: BENCH_CEILING, benchFrame(tick, nowMs, arena) -> RenderFrame
```

Add a `render/` entry before `scenes/`:

```text
        ├── render/
        │   ├── perf-stats.ts      # pure: SampleRing, percentile, PerfRings, PerfReport, formatPerfLines
        │   └── perf-overlay.ts    # ?debug=perf: Phaser step-event hooks, draw-call wrap, the Text (R23)
```

Under `scenes/arena/`, add:

```text
        │   │   ├── arena-floor.ts      # drawArenaFloor: the floor and world-camera setup ArenaScene and BenchScene share
```

After the `scripts/build-release.mjs` line at the top of the tree, add:

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

**Spec coverage.** §1's two measurements are Task 6's rows 1 and 2, with the "everything else" row as row 3. R23's overlay: frame split (Task 3, five buckets), draw calls (Task 3, the wrap), live particles and tier (Task 3, literals with their owners named), texture count (Task 3), the netgraph beside it (`attachNetgraph`, Task 3, not depended on), `?debug=perf` (Task 1). R24's bench scene: six cars burning, two lances, forty instances (Task 4), no server (Task 5), stripped from release like the playground (Task 5 Step 5), p50/p95 and draw calls over 10 s (Task 3's rings, Task 7's window), Playwright on Chromium and Firefox (Task 7), `bench-visual.mjs` (Task 6). R24's "scripted stream of hit and ram events" and "400 particles" are V4's — the ledger's coupling 2 says V4's bench synthesises events, and there is no particle service to spawn 400 of anything yet; `events: []` is what Task 4 ships. R24's "measures bake time" is V2's meaning of the same script; today the builders are the frame path and that is what Task 6 times. R25's table is the Acceptance section below. §10 V0 row: perf overlay, bench scene, `bench-visual.mjs`, baseline numbers (Task 8) — nothing deleted, matching the row's `—`.

**Placeholder scan.** Task 8's `(paste …)` markers are the one thing a step leaves for the executor, and the step says what fills them and checks with `grep -c` that none survives. No "TBD", no "handle edge cases"; every code step prints code.

**Type consistency.** `PerfOverlay.mark` takes `PerfMark` (`"sim" | "build" | "draw"`), which is what Task 3's `ArenaScene` inserts and Task 5's `BenchScene` calls. `PerfReport` (Task 2) is what `PerfOverlay.report()` (Task 3), `BenchProbe.report()` (Task 5) and `formatBenchRows` (Task 7, reading `frames`, `frameMs`, `jsMs`, `split`, `drawCalls`, `textures`) agree on. `PERF_OVERLAY_CONFIG.drawCallsUnavailable` is the value `PerfOverlay` pushes on Canvas and `formatPerfLines` prints as `n/a`. `drawArenaFloor` (Task 5) returns `{ gfx, staticCamera }` and `ArenaScene.drawArena` reads both. `hasDebugFlag(PERF_DEBUG_FLAG)` (Task 1) is the gate in Task 3's `create`. `window.__bench.frames()` / `.report()` / `.renderer` / `.ready` (Task 5) are the four members Task 7's `page.evaluate` calls read. `CEILING` in Task 6 restates `BENCH_CEILING` from Task 4 by value; the test in Task 6 checks polygon counts divide by `CEILING.afterburners`, not the client constant.

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

V0 is the instrument, not the result: today's numbers are expected to *fail* the first two rows — that is the baseline `docs/render-bench.md` records, and V1–V5 are judged as deltas from it. The command that demonstrates V0 itself is `npm test` green plus `npm run bench:visual` and `npm run bench:arena` each printing a table and exiting 0.

## Handoff

Exports beyond the ledger, for V1–V5 and the netcode stream:

| Export | Where | For |
|---|---|---|
| `debugFlags`, `hasDebugFlag`, `PERF_DEBUG_FLAG` | `config/client-mode.ts` | N0's `?debug=net` overlay reads `hasDebugFlag("net")`; overlays combine as `?debug=1,perf,net` |
| `PerfOverlay.attachNetgraph(lines: () => readonly string[])`, `.report(): PerfReport`, `.rendererKind`, `.gameObjects()` | `render/perf-overlay.ts` | N0 hands its netgraph lines in; V1 registers the objects in `HudScene` and swaps the `Text` for `BitmapText`; V4 and V5 replace the `PARTICLES_UNTIL_V4` / `TIER_UNTIL_V5` literals with `ParticleService` and `TierManager` readings |
| `PerfMark` (`"sim" \| "build" \| "draw"`) | `render/perf-overlay.ts` | any scene that brackets its `update` |
| `PERF_OVERLAY_CONFIG`, `SampleRing`, `percentile`, `PerfRings`, `PerfSample`, `PerfReport`, `formatPerfLines` | `render/perf-stats.ts` | V5's `FrameGovernor` and `TierManager` measure p95 over rolling windows — `SampleRing` is that window |
| `drawArenaFloor`, `ARENA_BORDER_PX`, `ARENA_DEPTH` | `scenes/arena/arena-floor.ts` | V2 replaces the `Graphics` floor with the baked image in one place; `render/layers.ts` takes over `ARENA_DEPTH` |
| `BENCH_CEILING`, `BENCH_INSTANCE_COUNT`, `BENCH_LAYOUT`, `benchFrame` | `dev/bench-frame.ts` | V4 adds the scripted event stream and particle bursts to the same frame; V3 reads the flame and bolt instances it bakes against |
| `BenchProbe`, `window.__bench` | `dev/BenchScene.ts` | `scripts/bench-arena.mjs`; V5 adds a `tier` query to pin the tier under test |
| `CEILING`, `runVisualBench`, `formatVisualRows` | `scripts/bench-visual.mjs` | V2 adds a bake-time row; V3 re-reads rows 1 and 2 after the flame becomes a flipbook |
| `BENCH_ARENA_DEFAULTS`, `parseBenchArgs`, `formatBenchRows` | `scripts/bench-arena.mjs` | CI wiring (the repository has no workflow file today; `npm run bench:arena` is the command to call) |
| `npm run bench:visual`, `npm run bench:arena` | root `package.json` | everyone |
