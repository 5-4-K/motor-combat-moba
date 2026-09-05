# Rendering Phase 5 — Pixels: Tiers, the Governor, Device Pixels, Bloom and the Floor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The game measures the machine it is running on and spends what that machine has — a quality tier chosen from real frame times and remembered, a per-frame governor that sheds cosmetics before a spike becomes a stutter, native device pixels so a 150 %-scaled laptop stops being soft, and the two garnishes (bloom, vignette, a breathing floor) that only the top tier pays for.

**Architecture:** One table and two small state machines. `render/tiers.ts` holds `TIER_TABLE` — which **reads** the caps V1, V3 and V4 already authored rather than restating them — and a `TierManager` that watches p95 frame time over rolling five-second windows and moves the tier at most one step at a time. `render/governor.ts` is its fast sibling, deciding per frame whether a cosmetic effect may spawn. Device-pixel rendering is entirely arithmetic: the game canvas becomes `logical × dpr` and every camera zooms by the same factor, so the world window each player sees is unchanged to the unit. Bloom and vignette are Phaser 4 camera filters attached only at tier High, and the floor ambience is one extra quad on the layer that already exists.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Phaser 4.2.1 (`camera.filters.external`, `Phaser.Actions.AddEffectBloom`, `addVignette`, the `render` game-config block, `Noise`), vitest in the **node** environment, Playwright for `scripts/bench-arena.mjs`.

**Spec:** [`2026-09-04-client-rendering-architecture-design.md`](../../specs/2026-09-04-client-rendering-architecture-design.md) — §8 in full (R17, R17a, R18a, R19, R20), §9 in full (R10, R21, R22, R23, R24, R25), §10's V5 row, §11.
**Ledger:** [`interfaces.md`](interfaces.md) — `render/tiers.ts` (`TIER_TABLE`, `TierManager`, `export type Tier = BakeTier`), `render/governor.ts` (`FrameGovernor`), and the `setCap` hooks on `ParticleService` and `DecalService`.
**Previous phase:** [`24-render-4-events.md`](24-render-4-events.md) — **read its `## Handoff` in full before Task 1.** Its "Deferred by V4" list is this plan's work list, and its service table names the two `setCap` hooks. Phases 3, 2, 1 and 0 are [`23-render-3-beams.md`](23-render-3-beams.md), [`22-render-2-bake.md`](22-render-2-bake.md), [`21-render-1-hud.md`](21-render-1-hud.md) and [`20-render-0-instrumentation.md`](20-render-0-instrumentation.md).
**Runbook:** [`00-execution-guide.md`](00-execution-guide.md) — §3, §5 (the V5 gate), §7.

## The one thing this plan must not do

**`render/tiers.ts` must not become a dependency of `render/bake.ts`.** V1 owns the `BakeTier` union because V1 needs it, and the ledger settles the direction: `tiers.ts` re-exports `export type Tier = BakeTier` from `bake.ts`, never the other way round. The same rule applies to the numbers: `TIER_TABLE` **reads** `BAKE_SUPERSAMPLE`, `BAKE_SHEET_PX`, `FLAME_FRAMES`, `PARTICLE_CONFIG.caps` and `DECAL_CONFIG.maxLive` and restates none of them. V4's Handoff says so in as many words — *"the tier table must not carry a second copy of the particle caps, and `tiers.test.ts` should assert the two agree"* — and Task 1 Step 1 is that assertion.

Two copies of a cap is the failure this rule exists to prevent: one gets tuned, the other does not, and the tier the player picked stops meaning what the service enforces.

## Global Constraints

- **Rebuild shared before testing**: `npm run build -w @motor-combat-moba/shared`. Server and client consume built `dist`.
- **Verify with root `npm test`**, never a per-workspace run alone.
- **`.js` import specifiers** on every local import; shared is imported as `@motor-combat-moba/shared`.
- **Nothing under `packages/client/src/match/` imports Phaser, and no test imports Phaser.** Every module this phase creates takes its Phaser objects through an injected seam or a `import type`, which is what keeps `tiers.test.ts` and `governor.test.ts` running in node.
- **Do not touch `packages/server/playtest/` except to fix a compile break**, and say loudly in the task's commit step which probe numbers your change moves. **This phase touches no probe and nothing under `packages/server/`**, and Task 6's commit step says so rather than leaving it to be assumed.
- **Do not edit `docs/ideas/` or `docs/invariants/`.**
- **Commit after every task** on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch cut off it). `npm install` in a fresh worktree before the first build.
- **"main" means `development/main`.**
- **`packages/shared` is not edited by this phase** (execution guide's coupling 4). In particular **`CAMERA_CONFIG.zoom` stays 1** and stays in shared: the device-pixel work multiplies zoom at the camera, in the client, at runtime. `CAMERA_CONFIG` and `LOGICAL_CANVAS` are both in `configFingerprint` (`packages/server/balance/fingerprint.ts`) *because the server derives a bot's viewport fairness limit from them* — editing either would invalidate every balance baseline to change how sharp the picture is. Task 2 Step 5 is the test that pins the world window unchanged.
- **No balance table is edited**, so `npm run build:manual` and `docs/turn-tuning.md` are owed nothing. Task 6 runs their tests to confirm rather than to discover.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/client/src/render/tiers.ts` (create) | `Tier`, `TIER_TABLE`, `TIER_CONFIG`, `TierManager`, `tierFromSearch` |
| `packages/client/src/render/tier-storage.ts` (create) | `TIER_STORAGE_KEY`, `TierChoice`, `loadTierChoice`, `saveTierChoice` — the `Storage` seam |
| `packages/client/src/render/governor.ts` (create) | `FrameGovernor` — R22's per-frame shed |
| `packages/client/src/render/render-scale.ts` (create) | `renderDpr`, `applyScreenCamera`, `bindRenderScale`, `installRenderScale`, `RENDER_SCALED_SCENES` |
| `packages/client/src/render/filters.ts` (create) | `CameraFilters` — bloom and vignette at High, and the event boost (R19) |
| `packages/client/src/main.ts` (modify) | game size × dpr, the `render` config block (R17a), `installRenderScale` |
| `packages/client/src/scenes/arena/arena-floor.ts` (modify) | the world camera's dpr treatment; the floor ambience at High |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | own the `TierManager`, the `FrameGovernor` and the `CameraFilters`; feed the two `setCap`s |
| `packages/client/src/scenes/HudScene.ts` (modify) | the tier readout and the governor's state |
| `packages/client/src/scenes/hud/match-banners.ts` (modify) | `setTierNotice(message)` — "restart to finish applying" |
| `packages/client/src/render/effects.ts` (modify) | the fourth constructor argument: the bloom boost on explosion and death (R19) |
| `packages/client/src/render/perf-overlay.ts` (modify) | `attachTier`, replacing V0's `TIER_UNTIL_V5` literal |
| `packages/client/src/ui/screens/join.ts` (modify) | the graphics-quality selector (R22's "the player can pin a tier in settings") |
| `packages/client/src/dev/BenchScene.ts` (modify) | `?tier=` pinning, `census.tier`, `census.dpr`, `census.governorShedding` |
| `scripts/bench-arena.mjs` (modify) | `--tiers`, a run per tier, R25's two frame-time lines |
| `docs/render-bench.md`, `docs/roadmap.md`, `docs/project-structure.md`, `packages/client/CLAUDE.md` (modify) | the final numbers, and the deferred roadmap item marked landed |

---

### Task 1: `render/tiers.ts` — the table that reads, the manager that measures, the choice that persists

**Files:**
- Create: `packages/client/src/render/tiers.ts`, `packages/client/src/render/tiers.test.ts`, `packages/client/src/render/tier-storage.ts`, `packages/client/src/render/tier-storage.test.ts`
- Modify: `packages/client/src/ui/screens/join.ts`, `packages/client/src/ui/screens/join.test.ts`, `packages/client/src/scenes/JoinScene.ts`
- Test: the two above, plus `join.test.ts`

**Interfaces:**
- Consumes: V1's `BakeTier`, `BAKE_SUPERSAMPLE`, `BAKE_SHEET_PX`, `BAKE_DEFAULT_TIER`; V3's `FLAME_FRAMES`; V4's `PARTICLE_CONFIG.caps` and `DECAL_CONFIG.maxLive`; V0's `SampleRing`.
- Produces:

```ts
// render/tiers.ts
export type Tier = BakeTier;                       // the ledger's re-export; bake.ts owns the union
export const TIERS: readonly Tier[];               // ["low", "medium", "high"], worst first
export interface TierSpec {
  readonly dprCap: number;
  readonly particles: number;                      // read from PARTICLE_CONFIG.caps
  readonly decals: number;                         // read from DECAL_CONFIG.maxLive
  readonly flameFrames: number;                    // read from FLAME_FRAMES
  readonly supersample: number;                    // read from BAKE_SUPERSAMPLE
  readonly sheetPx: number;                        // read from BAKE_SHEET_PX
  readonly statusFlipbooks: boolean;
  readonly filters: boolean;
  readonly floorAmbience: boolean;
}
export const TIER_TABLE: Readonly<Record<Tier, TierSpec>>;
export const TIER_CONFIG: {
  readonly windowMs: number; readonly downMs: number; readonly upMs: number;
  readonly upHoldMs: number; readonly warmupFrames: number;
};
export function tierFromSearch(search?: string): Tier | undefined;
export class TierManager {
  constructor(start: Tier, opts?: { pinned?: Tier; onChange?: (tier: Tier) => void });
  observe(frameMs: number, nowMs: number): void;
  pin(tier: Tier | null): void;
  readonly tier: Tier;
  readonly pinned: Tier | null;
  readonly raisedOnce: boolean;
}

// render/tier-storage.ts
export const TIER_STORAGE_KEY = "motor-combat.render.v1";
export type TierChoice = Tier | "auto";
export function loadTierChoice(storage?: Storage): { choice: TierChoice; measured: Tier };
export function saveTierChoice(choice: TierChoice, measured: Tier, storage?: Storage): void;
```

#### The table, and where every number comes from

R21's table has nine rows. **Five of them already exist in the codebase** and this file reads them; four are new here. That split is the whole design of the module:

| R21 row | Low | Medium | High | Where the number lives |
|---|---|---|---|---|
| dpr cap | 1 | 1.5 | 2 | **new here** — `TierSpec.dprCap`, consumed by Task 2 |
| particles | 96 | 256 | 512 | `PARTICLE_CONFIG.caps` (V4) |
| flipbook frames (flame) | 12 | 24 | 24 | `FLAME_FRAMES` (V3) |
| status flipbooks on cars | off | on | on | **new here** — V4's `CarDecor.statusBadges` already returns early at Low; this makes the reason a table row |
| decal cap | 16 | 48 | 96 | `DECAL_CONFIG.maxLive` (V4) |
| bloom / vignette | off | off | on | **new here** — `TierSpec.filters`, consumed by Task 4 |
| floor ambience | off | off | on | **new here** — `TierSpec.floorAmbience`, consumed by Task 5 |
| bake atlas | 1024² | 2048² | 2048² | `BAKE_SHEET_PX` (V1) |
| (supersample, implied) | 1 | 2 | 2 | `BAKE_SUPERSAMPLE` (V1) |

R14's "24 frames × 2 lengths" reads as one length here because **V3 shipped one**, for the arithmetic reason recorded in its Handoff ("Where this plan departed from the spec"): a cone's apex is at the muzzle, so a uniform scale of one frame *is* the shorter flame's silhouette. `FLAME_FRAMES` is the count; there is no length axis to tier.

#### R22, stated as five numbers

> *"The client starts at Medium, measures p95 frame time over rolling 5 s windows, steps **down** a tier after one window over 14 ms, steps **up** at most once after 60 s under 8 ms, and persists the result."*

| Constant | Value | From |
|---|---|---|
| `windowMs` | `5_000` | "rolling 5 s windows" |
| `downMs` | `14` | "one window over 14 ms" |
| `upMs` | `8` | "60 s under 8 ms" |
| `upHoldMs` | `60_000` | the same sentence |
| `warmupFrames` | `120` | not in R22, and stated here rather than smuggled: the first two seconds of a session are texture uploads, shader compiles and JIT, and a tier chosen from them is chosen from the wrong thing. `bench-arena.mjs` already discards the same 120 frames for the same reason (V0's `BENCH_ARENA_DEFAULTS.warmupFrames`), so the two agree by construction |

**"At most once" is per session, not per window.** `raisedOnce` latches: a machine that can hold 8 ms for a minute gets one promotion, and if that promotion turns out to be wrong the down rule takes it back and it does not oscillate. That is the whole reason the rule is asymmetric, and `tiers.test.ts` pins it.

- [ ] **Step 1: Write the failing tier tests**

```ts
// packages/client/src/render/tiers.test.ts
import { describe, expect, it, vi } from "vitest";
import { BAKE_DEFAULT_TIER, BAKE_SHEET_PX, BAKE_SUPERSAMPLE, FLAME_FRAMES } from "./bake.js";
import { PARTICLE_CONFIG } from "../config/particles.js";
import { DECAL_CONFIG } from "../config/decals.js";
import { TIERS, TIER_CONFIG, TIER_TABLE, TierManager, tierFromSearch } from "./tiers.js";

describe("TIER_TABLE", () => {
  it("reads the caps the services enforce rather than restating them (V4's Handoff)", () => {
    for (const tier of TIERS) {
      expect(TIER_TABLE[tier].particles).toBe(PARTICLE_CONFIG.caps[tier]);
      expect(TIER_TABLE[tier].decals).toBe(DECAL_CONFIG.maxLive[tier]);
      expect(TIER_TABLE[tier].flameFrames).toBe(FLAME_FRAMES[tier]);
      expect(TIER_TABLE[tier].supersample).toBe(BAKE_SUPERSAMPLE[tier]);
      expect(TIER_TABLE[tier].sheetPx).toBe(BAKE_SHEET_PX[tier]);
    }
  });

  it("carries R21's four new rows and orders them monotonically", () => {
    expect(TIER_TABLE.low.dprCap).toBe(1);
    expect(TIER_TABLE.medium.dprCap).toBe(1.5);
    expect(TIER_TABLE.high.dprCap).toBe(2);
    expect([TIER_TABLE.low.filters, TIER_TABLE.medium.filters, TIER_TABLE.high.filters]).toEqual([false, false, true]);
    expect([TIER_TABLE.low.floorAmbience, TIER_TABLE.medium.floorAmbience, TIER_TABLE.high.floorAmbience]).toEqual([false, false, true]);
    expect([TIER_TABLE.low.statusFlipbooks, TIER_TABLE.medium.statusFlipbooks, TIER_TABLE.high.statusFlipbooks]).toEqual([false, true, true]);
  });

  it("never gets cheaper as it goes up", () => {
    for (let i = 1; i < TIERS.length; i++) {
      const worse = TIER_TABLE[TIERS[i - 1]!];
      const better = TIER_TABLE[TIERS[i]!];
      expect(better.dprCap).toBeGreaterThanOrEqual(worse.dprCap);
      expect(better.particles).toBeGreaterThanOrEqual(worse.particles);
      expect(better.decals).toBeGreaterThanOrEqual(worse.decals);
      expect(better.flameFrames).toBeGreaterThanOrEqual(worse.flameFrames);
    }
  });

  it("starts at Medium, the same tier the bake defaults to", () => {
    expect(BAKE_DEFAULT_TIER).toBe("medium");
    expect(new TierManager(BAKE_DEFAULT_TIER).tier).toBe("medium");
  });
});

describe("tierFromSearch", () => {
  it("reads ?tier= and refuses anything that is not a tier", () => {
    expect(tierFromSearch("?tier=low")).toBe("low");
    expect(tierFromSearch("?tier=HIGH")).toBe("high");
    expect(tierFromSearch("?tier=ultra")).toBeUndefined();
    expect(tierFromSearch("")).toBeUndefined();
  });
});

describe("TierManager", () => {
  /** Feed `frames` frames of `ms` each, advancing a fake clock in step. */
  function feed(manager: TierManager, ms: number, frames: number, from = 0): number {
    let now = from;
    for (let i = 0; i < frames; i++) {
      now += ms;
      manager.observe(ms, now);
    }
    return now;
  }

  it("ignores the warm-up entirely: a slow first second cannot pick the tier", () => {
    const manager = new TierManager("medium");
    feed(manager, 40, TIER_CONFIG.warmupFrames - 1);
    expect(manager.tier).toBe("medium");
  });

  it("steps down one tier after a single window over 14 ms", () => {
    const manager = new TierManager("high");
    const after = feed(manager, 1, TIER_CONFIG.warmupFrames);
    feed(manager, TIER_CONFIG.downMs + 2, 400, after);
    expect(manager.tier).toBe("medium");
  });

  it("steps down one at a time, never two in one window", () => {
    const changes: string[] = [];
    const manager = new TierManager("high", { onChange: (t) => changes.push(t) });
    const after = feed(manager, 1, TIER_CONFIG.warmupFrames);
    feed(manager, 60, 400, after);
    expect(changes).toEqual(["medium"]);
    expect(manager.tier).toBe("medium");
  });

  it("raises at most once, and only after a full minute under 8 ms", () => {
    const manager = new TierManager("low");
    let now = feed(manager, 1, TIER_CONFIG.warmupFrames);
    // Half a minute is not a minute.
    now = feed(manager, TIER_CONFIG.upMs - 2, Math.round(30_000 / (TIER_CONFIG.upMs - 2)), now);
    expect(manager.tier).toBe("low");
    now = feed(manager, TIER_CONFIG.upMs - 2, Math.round(40_000 / (TIER_CONFIG.upMs - 2)), now);
    expect(manager.tier).toBe("medium");
    // And never again, however long it stays fast.
    feed(manager, TIER_CONFIG.upMs - 2, Math.round(120_000 / (TIER_CONFIG.upMs - 2)), now);
    expect(manager.tier).toBe("medium");
    expect(manager.raisedOnce).toBe(true);
  });

  it("takes a promotion back if it was wrong, which is why the rules are asymmetric", () => {
    const manager = new TierManager("low");
    let now = feed(manager, 1, TIER_CONFIG.warmupFrames);
    now = feed(manager, TIER_CONFIG.upMs - 2, Math.round(70_000 / (TIER_CONFIG.upMs - 2)), now);
    expect(manager.tier).toBe("medium");
    feed(manager, TIER_CONFIG.downMs + 2, 400, now);
    expect(manager.tier).toBe("low");
  });

  it("a pinned tier never moves, however bad the frames are", () => {
    const onChange = vi.fn();
    const manager = new TierManager("high", { pinned: "high", onChange });
    const after = feed(manager, 1, TIER_CONFIG.warmupFrames);
    feed(manager, 80, 400, after);
    expect(manager.tier).toBe("high");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("unpinning hands control back without jumping", () => {
    const manager = new TierManager("high", { pinned: "high" });
    const after = feed(manager, 1, TIER_CONFIG.warmupFrames);
    feed(manager, 80, 400, after);
    manager.pin(null);
    expect(manager.tier).toBe("high");
    feed(manager, 80, 400, after + 400 * 80);
    expect(manager.tier).toBe("medium");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/render/tiers.test.ts`
Expected: FAIL — cannot resolve `./tiers.js`.

- [ ] **Step 3: Write `render/tiers.ts`**

```ts
// packages/client/src/render/tiers.ts
import { DECAL_CONFIG } from "../config/decals.js";
import { PARTICLE_CONFIG } from "../config/particles.js";
import { BAKE_SHEET_PX, BAKE_SUPERSAMPLE, FLAME_FRAMES, type BakeTier } from "./bake.js";
import { SampleRing } from "./perf-stats.js";

/**
 * Quality tiers (rendering spec R10, R21, R22): what the game spends on a machine, measured rather
 * than guessed.
 *
 * `Tier` is `BakeTier` under another name. `render/bake.ts` owns the union because V1 needed it and
 * this module must never become a dependency of that one — the ledger fixes the direction and this
 * re-export is the whole of it.
 */
export type Tier = BakeTier;

/** Worst first. Stepping is by index, so this order is the meaning of "up" and "down". */
export const TIERS: readonly Tier[] = ["low", "medium", "high"];

export interface TierSpec {
  /** `min(devicePixelRatio, dprCap)` is what the canvas is built at (R17). */
  readonly dprCap: number;
  readonly particles: number;
  readonly decals: number;
  readonly flameFrames: number;
  readonly supersample: number;
  readonly sheetPx: number;
  readonly statusFlipbooks: boolean;
  /** Camera-level bloom and vignette (R19). High only. */
  readonly filters: boolean;
  readonly floorAmbience: boolean;
}

/**
 * R21's table.
 *
 * **Five of its nine rows are read from where they already live** — the particle and decal caps the
 * two services enforce, the flipbook length the flame was baked at, and the two bake constants — so
 * a tuning pass has exactly one place to edit and this table follows it. Only the four rows that
 * have no other home are literals here, and each of those is consumed by exactly one later task.
 */
export const TIER_TABLE: Readonly<Record<Tier, TierSpec>> = {
  low: {
    dprCap: 1,
    particles: PARTICLE_CONFIG.caps.low,
    decals: DECAL_CONFIG.maxLive.low,
    flameFrames: FLAME_FRAMES.low,
    supersample: BAKE_SUPERSAMPLE.low,
    sheetPx: BAKE_SHEET_PX.low,
    statusFlipbooks: false,
    filters: false,
    floorAmbience: false,
  },
  medium: {
    dprCap: 1.5,
    particles: PARTICLE_CONFIG.caps.medium,
    decals: DECAL_CONFIG.maxLive.medium,
    flameFrames: FLAME_FRAMES.medium,
    supersample: BAKE_SUPERSAMPLE.medium,
    sheetPx: BAKE_SHEET_PX.medium,
    statusFlipbooks: true,
    filters: false,
    floorAmbience: false,
  },
  high: {
    dprCap: 2,
    particles: PARTICLE_CONFIG.caps.high,
    decals: DECAL_CONFIG.maxLive.high,
    flameFrames: FLAME_FRAMES.high,
    supersample: BAKE_SUPERSAMPLE.high,
    sheetPx: BAKE_SHEET_PX.high,
    statusFlipbooks: true,
    filters: true,
    floorAmbience: true,
  },
};

/** R22's rule, as numbers. `warmupFrames` is this plan's, and Task 1's header says why. */
export const TIER_CONFIG = {
  windowMs: 5_000,
  downMs: 14,
  upMs: 8,
  upHoldMs: 60_000,
  warmupFrames: 120,
} as const;

/** 5 s at 60 Hz. Sized once; `SampleRing` allocates nothing after that (R6). */
const WINDOW_FRAMES = Math.ceil((TIER_CONFIG.windowMs / 1000) * 60);

const isTier = (value: string): value is Tier => (TIERS as readonly string[]).includes(value);

/**
 * `?tier=low|medium|high`, which pins the tier for one page load. `scripts/bench-arena.mjs` uses it
 * to measure a tier it could not otherwise reach, and it is the field diagnostic when a player says
 * "it looks wrong" and nobody knows which tier they landed on.
 */
export function tierFromSearch(search: string = window.location.search): Tier | undefined {
  const raw = (new URLSearchParams(search).get("tier") ?? "").toLowerCase();
  return isTier(raw) ? raw : undefined;
}

/**
 * Chooses the tier from measured frame time (R22): down after ONE five-second window whose p95 is
 * over 14 ms, up at most ONCE after sixty seconds under 8 ms.
 *
 * The asymmetry is deliberate and is what stops a machine oscillating between two tiers for a whole
 * match: dropping is cheap and reversible, raising is a one-way bet the down rule can still take
 * back. A pinned tier is never measured against at all — the player asked.
 */
export class TierManager {
  private readonly frames = new SampleRing(WINDOW_FRAMES);
  private index: number;
  private seen = 0;
  private windowStartMs = 0;
  private fastSinceMs: number | undefined;
  private raised = false;
  private pinnedTier: Tier | null;

  constructor(
    start: Tier,
    private readonly opts: { pinned?: Tier; onChange?: (tier: Tier) => void } = {},
  ) {
    this.index = Math.max(0, TIERS.indexOf(opts.pinned ?? start));
    this.pinnedTier = opts.pinned ?? null;
  }

  get tier(): Tier {
    return TIERS[this.index]!;
  }

  get pinned(): Tier | null {
    return this.pinnedTier;
  }

  get raisedOnce(): boolean {
    return this.raised;
  }

  /** Pin a tier, or hand control back to the measurement without moving where it is now. */
  pin(tier: Tier | null): void {
    this.pinnedTier = tier;
    if (tier) this.moveTo(TIERS.indexOf(tier));
    this.fastSinceMs = undefined;
    this.windowStartMs = 0;
  }

  observe(frameMs: number, nowMs: number): void {
    if (this.pinnedTier) return;
    this.seen += 1;
    // The first two seconds are texture uploads, shader compiles and JIT. A tier chosen from them
    // is chosen from the wrong thing, and `bench-arena.mjs` discards the same count for the same
    // reason.
    if (this.seen <= TIER_CONFIG.warmupFrames) {
      this.windowStartMs = nowMs;
      return;
    }
    this.frames.push(frameMs);
    if (this.windowStartMs === 0) this.windowStartMs = nowMs;
    if (nowMs - this.windowStartMs < TIER_CONFIG.windowMs) return;

    const p95 = this.frames.percentile(95);
    this.windowStartMs = nowMs;

    if (p95 > TIER_CONFIG.downMs) {
      this.fastSinceMs = undefined;
      this.moveTo(this.index - 1);
      return;
    }
    if (p95 < TIER_CONFIG.upMs) {
      this.fastSinceMs ??= nowMs - TIER_CONFIG.windowMs;
      if (!this.raised && nowMs - this.fastSinceMs >= TIER_CONFIG.upHoldMs) {
        this.raised = true;
        this.moveTo(this.index + 1);
      }
      return;
    }
    // Between the two thresholds: the tier is right, and a run of fast windows has been broken.
    this.fastSinceMs = undefined;
  }

  private moveTo(index: number): void {
    const clamped = Math.min(TIERS.length - 1, Math.max(0, index));
    if (clamped === this.index) return;
    this.index = clamped;
    this.opts.onChange?.(this.tier);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/client && npx vitest run src/render/tiers.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Persist the choice**

```ts
// packages/client/src/render/tier-storage.test.ts
import { describe, expect, it } from "vitest";
import { TIER_STORAGE_KEY, loadTierChoice, saveTierChoice } from "./tier-storage.js";

const memory = (seed: Record<string, string> = {}): Storage => {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, v); },
  };
};

describe("loadTierChoice", () => {
  it("is auto at Medium on a browser that has never played", () => {
    expect(loadTierChoice(memory())).toEqual({ choice: "auto", measured: "medium" });
  });

  it("remembers what the last session measured", () => {
    const storage = memory();
    saveTierChoice("auto", "low", storage);
    expect(loadTierChoice(storage)).toEqual({ choice: "auto", measured: "low" });
  });

  it("remembers a pin", () => {
    const storage = memory();
    saveTierChoice("high", "medium", storage);
    expect(loadTierChoice(storage)).toEqual({ choice: "high", measured: "medium" });
  });

  it("falls back whole on anything malformed, rather than half-applying it", () => {
    expect(loadTierChoice(memory({ [TIER_STORAGE_KEY]: "{" }))).toEqual({ choice: "auto", measured: "medium" });
    expect(loadTierChoice(memory({ [TIER_STORAGE_KEY]: '{"choice":"ultra","measured":"low"}' })))
      .toEqual({ choice: "auto", measured: "medium" });
  });

  it("survives a storage that throws, which private browsing gives you", () => {
    const hostile: Storage = { ...memory(), getItem: () => { throw new Error("blocked"); } };
    expect(loadTierChoice(hostile)).toEqual({ choice: "auto", measured: "medium" });
    expect(() => saveTierChoice("low", "low", hostile)).not.toThrow();
  });
});
```

```ts
// packages/client/src/render/tier-storage.ts
import { BAKE_DEFAULT_TIER } from "./bake.js";
import { TIERS, type Tier } from "./tiers.js";

/**
 * The tier across sessions (R22's "and persists the result").
 *
 * Two values, not one, and the difference matters: `choice` is what the PLAYER asked for — a pin, or
 * `"auto"` — and `measured` is where the auto-tier last settled. A player who pins High and later
 * unpins should not be handed Medium again as if their machine had never been measured.
 *
 * The same shape and the same defensiveness as `practice/storage.ts`: a `Storage` seam so the test
 * runs in node, and a whole-blob fallback rather than a half-applied one.
 */
export const TIER_STORAGE_KEY = "motor-combat.render.v1";

export type TierChoice = Tier | "auto";

interface Stored {
  choice: TierChoice;
  measured: Tier;
}

const DEFAULT: Stored = { choice: "auto", measured: BAKE_DEFAULT_TIER };

const isTier = (value: unknown): value is Tier =>
  typeof value === "string" && (TIERS as readonly string[]).includes(value);

export function loadTierChoice(storage: Storage = window.localStorage): Stored {
  try {
    const raw = storage.getItem(TIER_STORAGE_KEY);
    if (raw === null) return { ...DEFAULT };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT };
    const { choice, measured } = parsed as Partial<Stored>;
    if (!isTier(measured)) return { ...DEFAULT };
    if (choice !== "auto" && !isTier(choice)) return { ...DEFAULT };
    return { choice, measured };
  } catch {
    // Malformed JSON, or a storage that throws on access.
    return { ...DEFAULT };
  }
}

export function saveTierChoice(
  choice: TierChoice,
  measured: Tier,
  storage: Storage = window.localStorage,
): void {
  try {
    storage.setItem(TIER_STORAGE_KEY, JSON.stringify({ choice, measured } satisfies Stored));
  } catch {
    // A setting that cannot be remembered is not worth breaking the screen over.
  }
}
```

Run: `cd packages/client && npx vitest run src/render/tier-storage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: The player's pin, on the one screen everybody passes through**

R22 ends *"The player can pin a tier in settings."* There is no settings screen — the join screen's reference row (`ui/screens/join.ts`'s `referenceLink` pair: the guide and the feedback link) is the only surface every player sees, and it is where this goes. Four options, one line, styled like the links beside it:

```ts
// ui/screens/join.ts — new export, mounted in the hero's reference row beside the two links
import { loadTierChoice, saveTierChoice } from "../../render/tier-storage.js";
import { TIERS, type Tier } from "../../render/tiers.js";

const QUALITY_LABELS: Readonly<Record<"auto" | Tier, string>> = {
  auto: "Auto",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/**
 * Graphics quality (rendering spec R22's last sentence). `Auto` is the default and is what the
 * measurement drives; the other three pin it and stop the measurement entirely.
 *
 * On the join screen rather than in a settings screen because there is no settings screen, and
 * because this is the one choice a player makes BEFORE a match rather than during one — a tier
 * change mid-match cannot re-bake the atlas (Task 3), so the honest place to offer it is the screen
 * you pass through on the way in.
 */
export function renderQualitySelect(storage?: Storage): HTMLElement {
  const stored = loadTierChoice(storage);
  const select = h("select", {
    class: "input",
    id: "quality",
    "aria-label": "Graphics quality",
    style: "width: auto; padding: 4px 8px; font-size: 13px;",
  }) as HTMLSelectElement;
  for (const value of ["auto", ...TIERS] as const) {
    const option = h("option", { value }, [QUALITY_LABELS[value]]) as HTMLOptionElement;
    option.selected = value === stored.choice;
    select.append(option);
  }
  select.addEventListener("change", () => {
    const choice = select.value === "auto" ? "auto" : (select.value as Tier);
    saveTierChoice(choice, stored.measured, storage);
  });
  return h("label", { style: "display: inline-flex; gap: 6px; align-items: center;" }, ["Graphics", select]);
}
```

and in `renderJoin`, the reference row gains it as a third child. Append to `join.test.ts`:

```ts
describe("renderQualitySelect", () => {
  it("offers auto plus every tier, with the stored choice selected", () => {
    const storage = memoryStorage();
    saveTierChoice("low", "low", storage);
    const select = renderQualitySelect(storage).querySelector("select")!;
    expect([...select.options].map((o) => o.value)).toEqual(["auto", "low", "medium", "high"]);
    expect(select.value).toBe("low");
  });

  it("saves a change without disturbing what the last session measured", () => {
    const storage = memoryStorage();
    saveTierChoice("auto", "high", storage);
    const select = renderQualitySelect(storage).querySelector("select")!;
    select.value = "medium";
    select.dispatchEvent(new Event("change"));
    expect(loadTierChoice(storage)).toEqual({ choice: "medium", measured: "high" });
  });
});
```

- [ ] **Step 7: Commit**

```bash
npm run build -w @motor-combat-moba/shared && cd packages/client && npx vitest run src/render src/ui && cd ../..
git add packages/client/src/render/tiers.ts packages/client/src/render/tiers.test.ts packages/client/src/render/tier-storage.ts packages/client/src/render/tier-storage.test.ts packages/client/src/ui/screens/join.ts packages/client/src/ui/screens/join.test.ts packages/client/src/scenes/JoinScene.ts
git commit -m "feat(render): quality tiers — a table that reads the shipped caps, a manager that measures, a choice that persists"
```

---

### Task 2: Device pixels (R17, R17a)

**Files:**
- Create: `packages/client/src/render/render-scale.ts`, `packages/client/src/render/render-scale.test.ts`
- Modify: `packages/client/src/main.ts:19-45`, `packages/client/src/scenes/arena/arena-floor.ts`, `packages/client/src/scenes/BootScene.ts` (the dev-tool branch), `packages/client/src/config/display.ts` (nothing moves; one comment)
- Test: `packages/client/src/render/render-scale.test.ts`, `scripts/render-scale.test.mjs` (the scene-coverage scan)

**Interfaces:**
- Consumes: Task 1's `TIER_TABLE`, `loadTierChoice`; `VIEW_WIDTH`, `VIEW_HEIGHT`, `ARENA_VIEW_WIDTH` (`config/display.ts`); `CAMERA_CONFIG.zoom` (shared, **read, never written**).
- Produces:

```ts
// render/render-scale.ts
export interface ScreenCamera {                    // the slice of Phaser.Camera this needs
  setViewport(x: number, y: number, width: number, height: number): unknown;
  setZoom(value: number): unknown;
  setOrigin(x: number, y: number): unknown;
  setScroll(x: number, y: number): unknown;
}
export function renderDpr(win: { devicePixelRatio?: number }, tier: Tier): number;
export function deviceSize(dpr: number): { width: number; height: number };
export function applyScreenCamera(camera: ScreenCamera, dpr: number): void;
export function worldZoom(dpr: number): number;                       // CAMERA_CONFIG.zoom * dpr
export function bindRenderScale(scene: Phaser.Scene, dpr?: number): void;
export function installRenderScale(game: Phaser.Game, dpr?: number): void;
export const RENDER_SCALE_DPR: number;             // computed once at module load
```

#### The arithmetic, and the one thing it must not change

Phaser 4 has no `resolution` option (removed in 3.16, not reinstated — `docs/roadmap.md`'s Deferred entry says so), so native pixels are built by hand:

```
game size   = VIEW_WIDTH  · dpr  ×  VIEW_HEIGHT · dpr          (the canvas backing store)
FIT display = unchanged                                        (the same CSS size as today)
every camera zooms by dpr, and screen-space cameras take origin (0, 0) and scroll (0, 0)
```

**Why origin (0, 0).** Phaser builds a camera's view matrix as `T(origin) · S(zoom) · R · T(−scroll − origin)` (`Camera.js:620-631`), with `origin = cameraSize × originFraction` and a default fraction of 0.5. At the default, zooming a screen-space camera zooms about its centre, and the logical origin lands at `centre · (1 − dpr)` instead of at 0. Setting the origin fraction to zero collapses the matrix to `S(zoom) · T(−scroll)`, so with scroll zero the mapping is exactly `screen = dpr × logical` — which is what every HUD and menu coordinate in the codebase already assumes, scaled. One line, no per-scene arithmetic, and `render-scale.test.ts` pins the mapping rather than the line.

**The world camera is the exception and keeps its 0.5 origin**, because `centerOn`, `setBounds` and the soft follow are all written against it. Its treatment is a viewport in device pixels and a zoom of `CAMERA_CONFIG.zoom × dpr`:

```
viewport = ARENA_VIEW_WIDTH · dpr  ×  VIEW_HEIGHT · dpr
zoom     = CAMERA_CONFIG.zoom · dpr
world visible = viewport / zoom = (ARENA_VIEW_WIDTH · dpr) / (zoom · dpr) = ARENA_VIEW_WIDTH / zoom
```

**The world window is therefore identical at every dpr**, which is the property that must not change: `LOGICAL_CANVAS / CAMERA_CONFIG.zoom` is what the server's `buildBotView` uses as its fairness limit (B17), both are in `configFingerprint`, and a client that could see more arena than a bot at dpr 2 would be a fairness bug wearing a rendering change's clothes. Step 5 is the test.

**What "sharp at 150 %" means, concretely.** A 1080p laptop at 150 % scaling reports `devicePixelRatio` 1.5 and gives the page a 1424 × 720 CSS-pixel window backed by 2136 × 1080 physical pixels. Today the canvas backing store is 1424 × 720 and the browser upscales the finished frame by 1.5 — every edge in the game is resampled, which is exactly the softness the roadmap entry describes. At dpr 1.5 the backing store is 2136 × 1080: **one game pixel per physical pixel, no resample.** Textures are already baked at supersample 2 (`BAKE_SUPERSAMPLE.medium`), so a dpr of 1.5 minifies them by a quarter rather than magnifying them, which is the good direction and the reason R17a wants mipmaps.

**Three of the roadmap's five bullets are already gone**, and it is worth saying which and why:

| Roadmap bullet | Status |
|---|---|
| game size × dpr, camera zoom × dpr | this task |
| `scrollFactor(0)` HUD objects need dpr-aware positioning | **gone** — V1 moved the HUD into its own scene (R20), and a screen-space camera at origin (0, 0) scales everything in it uniformly |
| every `Text` needs `setResolution(dpr)` | **gone** — V1 replaced every `Text` with `BitmapText`, whose glyphs are atlas quads and scale like any other sprite |
| the `JoinScene` DOM input under camera zoom | **verified, not changed** — Step 6 |
| a re-import of car textures at 4× | **not needed** — the baked atlas is already supersample 2, and authored car art is minified at every dpr the table allows |

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/render/render-scale.test.ts
import { describe, expect, it, vi } from "vitest";
import { CAMERA_CONFIG } from "@motor-combat-moba/shared";
import { ARENA_VIEW_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from "../config/display.js";
import { TIER_TABLE } from "./tiers.js";
import { applyScreenCamera, deviceSize, renderDpr, worldZoom } from "./render-scale.js";

describe("renderDpr", () => {
  it("is the screen's ratio capped by the tier", () => {
    expect(renderDpr({ devicePixelRatio: 1.5 }, "medium")).toBe(1.5);
    expect(renderDpr({ devicePixelRatio: 3 }, "medium")).toBe(TIER_TABLE.medium.dprCap);
    expect(renderDpr({ devicePixelRatio: 3 }, "high")).toBe(2);
    expect(renderDpr({ devicePixelRatio: 2 }, "low")).toBe(1);
  });

  it("never goes below 1, whatever the browser claims", () => {
    expect(renderDpr({ devicePixelRatio: 0 }, "high")).toBe(1);
    expect(renderDpr({}, "high")).toBe(1);
  });
});

describe("deviceSize", () => {
  it("is the logical canvas times the ratio, in whole pixels", () => {
    expect(deviceSize(1)).toEqual({ width: VIEW_WIDTH, height: VIEW_HEIGHT });
    expect(deviceSize(1.5)).toEqual({ width: Math.round(VIEW_WIDTH * 1.5), height: Math.round(VIEW_HEIGHT * 1.5) });
  });
});

describe("applyScreenCamera", () => {
  it("maps logical coordinates onto device pixels one to one", () => {
    const camera = {
      setViewport: vi.fn(), setZoom: vi.fn(), setOrigin: vi.fn(), setScroll: vi.fn(),
    };
    applyScreenCamera(camera, 1.5);
    expect(camera.setViewport).toHaveBeenCalledWith(0, 0, Math.round(VIEW_WIDTH * 1.5), Math.round(VIEW_HEIGHT * 1.5));
    // origin 0 collapses Phaser's view matrix to scale-then-translate, so screen = dpr x logical.
    expect(camera.setOrigin).toHaveBeenCalledWith(0, 0);
    expect(camera.setScroll).toHaveBeenCalledWith(0, 0);
    expect(camera.setZoom).toHaveBeenCalledWith(1.5);
  });
});

describe("the world window, which must not move", () => {
  it("shows exactly the same arena at every device-pixel ratio", () => {
    for (const dpr of [1, 1.5, 2]) {
      const viewportWidth = ARENA_VIEW_WIDTH * dpr;
      const visible = viewportWidth / worldZoom(dpr);
      expect(
        visible,
        "the world window is what the server's bot-fairness limit is derived from (CAMERA_CONFIG " +
          "and LOGICAL_CANVAS, both in configFingerprint). It cannot move because the picture got sharper.",
      ).toBeCloseTo(ARENA_VIEW_WIDTH / CAMERA_CONFIG.zoom, 9);
    }
  });

  it("leaves CAMERA_CONFIG.zoom alone: the multiply is at the camera, not in shared", () => {
    expect(CAMERA_CONFIG.zoom).toBe(1);
    expect(worldZoom(2)).toBe(CAMERA_CONFIG.zoom * 2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/render/render-scale.test.ts`
Expected: FAIL — cannot resolve `./render-scale.js`.

- [ ] **Step 3: Write `render/render-scale.ts`**

```ts
// packages/client/src/render/render-scale.ts
import type Phaser from "phaser";
import { CAMERA_CONFIG } from "@motor-combat-moba/shared";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../config/display.js";
import { loadTierChoice } from "./tier-storage.js";
import { TIER_TABLE, type Tier } from "./tiers.js";

/**
 * Device-pixel-ratio rendering (rendering spec R17), the by-hand version Phaser 4 requires because
 * it has no `resolution` option.
 *
 * The canvas backing store becomes `logical x dpr` and every camera zooms by the same factor, so a
 * 150 %-scaled laptop draws one game pixel per physical pixel instead of handing the browser a
 * 1424-wide picture to upscale. **The world window is unchanged at every ratio** — viewport and zoom
 * scale together — which matters beyond aesthetics: the server derives a bot's viewport fairness
 * limit from `LOGICAL_CANVAS / CAMERA_CONFIG.zoom`, and a client that could see further at dpr 2
 * would be a fairness bug. `render-scale.test.ts` pins that.
 */

/** The slice of `Phaser.Cameras.Scene2D.Camera` this module touches, so the test needs no Phaser. */
export interface ScreenCamera {
  setViewport(x: number, y: number, width: number, height: number): unknown;
  setZoom(value: number): unknown;
  setOrigin(x: number, y: number): unknown;
  setScroll(x: number, y: number): unknown;
}

/** `min(devicePixelRatio, tierCap)`, never below 1 (R17). */
export function renderDpr(win: { devicePixelRatio?: number }, tier: Tier): number {
  const reported = win.devicePixelRatio ?? 1;
  return Math.max(1, Math.min(reported > 0 ? reported : 1, TIER_TABLE[tier].dprCap));
}

export function deviceSize(dpr: number): { width: number; height: number } {
  return { width: Math.round(VIEW_WIDTH * dpr), height: Math.round(VIEW_HEIGHT * dpr) };
}

/** The world camera's zoom. `CAMERA_CONFIG.zoom` is shared and is read, never written. */
export function worldZoom(dpr: number): number {
  return CAMERA_CONFIG.zoom * dpr;
}

/**
 * A screen-space camera — every menu, the HUD scene, the dev tools — drawn at device pixels with
 * logical coordinates.
 *
 * `setOrigin(0, 0)` is the whole trick. Phaser composes a camera's view matrix as
 * `T(origin) . S(zoom) . R . T(-scroll - origin)` (`Camera.js:620-631`) with the origin at the
 * camera's centre by default, so a zoom about the centre puts logical (0, 0) at
 * `centre x (1 - zoom)`. At origin zero the matrix collapses to `S(zoom) . T(-scroll)` and, with no
 * scroll, `screen = dpr x logical` — which is exactly what every HUD coordinate already assumes.
 */
export function applyScreenCamera(camera: ScreenCamera, dpr: number): void {
  const size = deviceSize(dpr);
  camera.setViewport(0, 0, size.width, size.height);
  camera.setOrigin(0, 0);
  camera.setScroll(0, 0);
  camera.setZoom(dpr);
}

/**
 * The ratio this page renders at, decided once at module load from the persisted tier.
 *
 * Once, and not per tier change, because the canvas size cannot change under a running game without
 * re-creating every render target — and because a mid-match resolution change is a stutter far worse
 * than the softness it fixes. The tier's dpr cap takes effect on the NEXT session, which is the same
 * rule the bake follows (Task 3) and for the same reason.
 */
export const RENDER_SCALE_DPR: number = ((): number => {
  if (typeof window === "undefined") return 1;
  const stored = loadTierChoice();
  return renderDpr(window, stored.choice === "auto" ? stored.measured : stored.choice);
})();

/**
 * Give one scene's main camera the screen-space treatment, now and on every restart.
 *
 * The arena and the bench are NOT treated here: their main camera is the world camera, which keeps
 * its centred origin because `centerOn`, `setBounds` and the soft follow are written against it.
 * `drawArenaFloor` gives it its own treatment, in one place, for both scenes.
 */
export function bindRenderScale(scene: Phaser.Scene, dpr: number = RENDER_SCALE_DPR): void {
  if (WORLD_SCENE_KEYS.has(scene.scene.key)) return;
  const apply = (): void => applyScreenCamera(scene.cameras.main, dpr);
  scene.events.on("ready", apply);
  if (scene.cameras?.main) apply();
}

/** Scenes whose main camera is a WORLD camera and is set up by `drawArenaFloor` instead. */
const WORLD_SCENE_KEYS = new Set(["arena", "bench"]);

/** Every scene the game was constructed with. Dev tools added later call `bindRenderScale` themselves. */
export function installRenderScale(game: Phaser.Game, dpr: number = RENDER_SCALE_DPR): void {
  for (const scene of game.scene.scenes) bindRenderScale(scene, dpr);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/client && npx vitest run src/render/render-scale.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: The game config, and R17a's block**

`packages/client/src/main.ts`, replacing the `new Phaser.Game({...})` call's size and adding the `render` block:

```ts
const size = deviceSize(RENDER_SCALE_DPR);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  // The BACKING STORE, not the display size: `FIT` still shows it at the same CSS size, so this is
  // purely "how many real pixels the picture is drawn with" (R17). At dpr 1 it is byte-identical to
  // what shipped before this phase.
  width: size.width,
  height: size.height,
  parent: "game",
  backgroundColor: "#15120f",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  pixelArt: false,
  dom: { createContainer: true },
  /**
   * R17a: every value set explicitly with a reason, because the block was absent and every default
   * was silently in force.
   */
  render: {
    // An integrated GPU still benefits from the browser not choosing its low-power path.
    powerPreference: "high-performance",
    // Both atlases are power-of-two by construction (BAKE_SHEET_PX, and pack-atlas.mjs's own
    // chooseSheet), and a dpr of 1.5 MINIFIES them, which is exactly what mipmaps are for.
    mipmapFilter: "LINEAR_MIPMAP_LINEAR",
    // The baked atlas is a DynamicTexture — a render texture — and Phaser skips mipmaps for those
    // unless this is on (`WebGLTextureWrapper.js:324`). Filter render targets are screen-sized and
    // therefore NOT power-of-two, so the same guard skips them and this costs nothing per frame:
    // the only regeneration is the one bake, at boot.
    mipmapRegeneration: true,
    // This is a desktop game. The default forces one texture per batch on anything reporting as
    // mobile, which would undo V2's whole atlas plan on a touchscreen laptop.
    autoMobileTextures: false,
    // Left at its default deliberately: no `Graphics` remains on the frame path for a path-detail
    // threshold to apply to (V3's gate), and the debug overlay wants exact geometry.
    pathDetailThreshold: 1,
  },
  scene: [ /* unchanged */ ],
});

window.game = game;
bindFullscreenToggle(window, game.scale);
game.events.once(Phaser.Core.Events.READY, () => installRenderScale(game));
```

and in `BootScene`'s dev branch, one line after `this.scene.add(\`dev.${id}\`, Scene, true)`:

```ts
          bindRenderScale(this.scene.get(`dev.${id}`));
```

- [ ] **Step 6: The world camera, in one place**

`scenes/arena/arena-floor.ts`, inside `drawArenaFloor`'s camera block (V0 extracted it from `ArenaScene.drawArena`; the statements are `cam.setViewport(0, 0, ARENA_VIEW_WIDTH, VIEW_HEIGHT)` through `cam.setZoom(CAMERA_CONFIG.zoom)`):

| Before | After |
|---|---|
| `cam.setViewport(0, 0, ARENA_VIEW_WIDTH, VIEW_HEIGHT);` | `cam.setViewport(0, 0, Math.round(ARENA_VIEW_WIDTH * RENDER_SCALE_DPR), Math.round(VIEW_HEIGHT * RENDER_SCALE_DPR));` |
| `cam.setZoom(CAMERA_CONFIG.zoom);` | `cam.setZoom(worldZoom(RENDER_SCALE_DPR));` |
| `fitsViewport(arena, { width: ARENA_VIEW_WIDTH, height: VIEW_HEIGHT }, CAMERA_CONFIG.zoom)` | **unchanged.** Both terms would scale by `dpr` and cancel; asking the question in logical units keeps it the same question the server asks |

`setBounds` and `centerOn` are world-space and need no edit — that is what keeping the world camera's centred origin buys.

- [ ] **Step 7: The scene-coverage scan, and the by-hand check**

A scene that forgets the treatment renders in the canvas's top-left quadrant, which is obvious but only if somebody looks. Make it fail instead:

```js
// scripts/render-scale.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Every Phaser scene either takes the screen-space device-pixel treatment (`installRenderScale` in
 * main.ts, or an explicit `bindRenderScale`) or is a WORLD scene whose camera `drawArenaFloor` sets
 * up. A new scene is neither until somebody says which, and that is what this fails on.
 */
const SCREEN_SCENES = [
  "scenes/BootScene.ts", "scenes/JoinScene.ts", "scenes/PracticeSetupScene.ts", "scenes/LobbyScene.ts",
  "scenes/CarSelectScene.ts", "scenes/RevealScene.ts", "scenes/ResultsScene.ts",
  "scenes/PracticeSummaryScene.ts", "scenes/HudScene.ts",
];
const WORLD_SCENES = ["scenes/ArenaScene.ts", "dev/BenchScene.ts"];
const DEV_SCENES = ["dev/PlaygroundScene.ts", "dev/AssetTuningScene.ts"];

const SRC = path.resolve(import.meta.dirname, "..", "packages", "client", "src");

function sceneFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sceneFiles(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      if (fs.readFileSync(full, "utf8").includes("extends Phaser.Scene")) {
        out.push(path.relative(SRC, full).split(path.sep).join("/"));
      }
    }
  }
  return out;
}

test("every Phaser scene is classified for device-pixel rendering", () => {
  const known = new Set([...SCREEN_SCENES, ...WORLD_SCENES, ...DEV_SCENES]);
  const found = sceneFiles(SRC);
  const unclassified = found.filter((file) => !known.has(file));
  assert.deepEqual(
    unclassified,
    [],
    "a new scene must be listed in render-scale.test.mjs as screen-space (it gets applyScreenCamera), " +
      "world (drawArenaFloor sets its camera), or dev (BootScene binds it)",
  );
});

test("the game config lists every statically registered scene", () => {
  const main = fs.readFileSync(path.join(SRC, "main.ts"), "utf8");
  for (const file of SCREEN_SCENES) {
    if (file === "scenes/HudScene.ts") continue; // launched by ArenaScene, bound where it is launched
    const name = path.basename(file, ".ts");
    assert.ok(main.includes(name), `${name} is not in main.ts's scene list, so installRenderScale never sees it`);
  }
});
```

Add `"test:scripts"` coverage automatically — the root script is already `node --test "scripts/*.test.mjs"`, so the new file is picked up with no `package.json` edit.

Then, by hand, because two of these have no automated cover:

```bash
npm run dev
```

- On a display set to 150 %: open `http://localhost:5173`, and compare the join screen's heading against `git stash`-ed master. It should stop looking resampled. **This is the acceptance line "dpr 1.5 sharp on a 150 % display" and only an eye can sign it off.**
- Type a name into the join screen's DOM input, click Join, and confirm the caret lands where you clicked. The overlay is a `DOMElement` and `DOMElementCSSRenderer` builds its CSS transform from `camera.matrix` (`DOMElementCSSRenderer.js:69-95`) — the same matrix `applyScreenCamera` just changed — so the DOM is scaled by the camera exactly like a sprite is, and `ScreenOverlay` needs no edit. **Verify it rather than trusting the derivation**; it is the one place this task's arithmetic meets a browser's own layout.
- `?dev=playground` and `?dev=assets`: both should fill the canvas.

- [ ] **Step 8: Commit**

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena
git add packages/client/src/render/render-scale.ts packages/client/src/render/render-scale.test.ts packages/client/src/main.ts packages/client/src/scenes/BootScene.ts packages/client/src/scenes/arena/arena-floor.ts packages/client/src/config/display.ts scripts/render-scale.test.mjs
git commit -m "feat(render): device-pixel rendering capped by tier, and R17a's explicit render config"
```

---

### Task 3: The governor, and the tier's seven hooks

**Files:**
- Create: `packages/client/src/render/governor.ts`, `packages/client/src/render/governor.test.ts`
- Modify: `packages/client/src/render/bake.ts`, `packages/client/src/render/beams.ts`, `packages/client/src/scenes/arena/shot-renderer.ts`, `packages/client/src/scenes/arena/car-renderer.ts`, `packages/client/src/scenes/arena/car-sprites.ts`, `packages/client/src/scenes/ArenaScene.ts`, `packages/client/src/scenes/HudScene.ts`, `packages/client/src/scenes/hud/match-banners.ts`, `packages/client/src/render/perf-overlay.ts`
- Test: `packages/client/src/render/governor.test.ts`, and appended cases in `bake.test.ts`

**Interfaces:**
- Consumes: Task 1's `TierManager`, `TIER_TABLE`, `loadTierChoice`, `saveTierChoice`; V4's `ParticleService.setCap`, `DecalService.setCap`; V1's `BAKE_DEFAULT_TIER`, `bakeAtlas(scene, tier)`; V3's `BeamRenderer(scene, tier)`.
- Produces:

```ts
// render/governor.ts
export const GOVERNOR_CONFIG: { readonly overrunMs: number; readonly recoverFrames: number };
export class FrameGovernor {
  constructor(cfg?: typeof GOVERNOR_CONFIG);
  observe(frameMs: number): void;
  allowCosmetic(): boolean;
  readonly shedding: boolean;
}
```

#### R22's second half, which is one sentence and one number

> *"Within a tier, a per-frame governor sheds cosmetic particle spawns and skips the decal stamp when the previous frame exceeded 12 ms, so a spike never compounds."*

`overrunMs` is **12**, and it sits deliberately below `TIER_CONFIG.downMs` (14): the governor is the fast reflex that catches one bad frame, and the tier is the slow decision that catches a bad machine. If the governor's number were the higher of the two, the tier would drop before the cheap fix had been tried.

`recoverFrames` is **6** and is this plan's: shedding for exactly one frame after one overrun makes the governor flap on and off at the frame rate, and a flapping cosmetic budget looks worse than a consistently smaller one. Six frames is a tenth of a second — long enough to ride out the GC pause or the texture upload that caused the spike, short enough that a player never notices the sparks were thinner.

**What it sheds, in order:** cosmetic particle requests (the service already refuses those before informative ones, V4's priority rule) and decal placement. **What it never sheds:** anything a player reads — a hit spark, a kill burst, the hp flash, an event's camera shake. R9 is not negotiable at 12 ms.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/render/governor.test.ts
import { describe, expect, it } from "vitest";
import { TIER_CONFIG } from "./tiers.js";
import { FrameGovernor, GOVERNOR_CONFIG } from "./governor.js";

describe("FrameGovernor", () => {
  it("allows everything on a healthy frame", () => {
    const governor = new FrameGovernor();
    governor.observe(8);
    expect(governor.allowCosmetic()).toBe(true);
    expect(governor.shedding).toBe(false);
  });

  it("sheds after a frame over the overrun, exactly as R22 words it", () => {
    const governor = new FrameGovernor();
    governor.observe(GOVERNOR_CONFIG.overrunMs + 0.1);
    expect(governor.allowCosmetic()).toBe(false);
  });

  it("keeps shedding for recoverFrames, so it cannot flap at the frame rate", () => {
    const governor = new FrameGovernor();
    governor.observe(20);
    for (let i = 0; i < GOVERNOR_CONFIG.recoverFrames - 1; i++) {
      governor.observe(5);
      expect(governor.allowCosmetic()).toBe(false);
    }
    governor.observe(5);
    expect(governor.allowCosmetic()).toBe(true);
  });

  it("reacts before the tier does, which is why it exists", () => {
    expect(GOVERNOR_CONFIG.overrunMs).toBeLessThan(TIER_CONFIG.downMs);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/render/governor.test.ts`
Expected: FAIL — cannot resolve `./governor.js`.

- [ ] **Step 3: Write `render/governor.ts`**

```ts
// packages/client/src/render/governor.ts

/**
 * The per-frame half of R22: when the previous frame overran, stop spending on things nobody reads
 * until it recovers, so one spike does not compound into a stutter.
 *
 * Deliberately dumber than the `TierManager` beside it. That one measures a machine over five
 * seconds and changes what the game IS; this one measures the last frame and changes what the next
 * frame may spend. `overrunMs` sits below `TIER_CONFIG.downMs` on purpose: the cheap reflex fires
 * first, and the tier only drops if the reflex was not enough.
 */
export const GOVERNOR_CONFIG = {
  /** R22's number: "skips the decal stamp when the previous frame exceeded 12 ms". */
  overrunMs: 12,
  /**
   * How many frames it keeps shedding after one overrun. A governor that recovered on the next
   * frame would flap on and off at 60 Hz, and a flickering particle budget reads worse than a
   * smaller steady one. A tenth of a second at 60 Hz.
   */
  recoverFrames: 6,
} as const;

export class FrameGovernor {
  private hold = 0;

  constructor(private readonly cfg: typeof GOVERNOR_CONFIG = GOVERNOR_CONFIG) {}

  get shedding(): boolean {
    return this.hold > 0;
  }

  observe(frameMs: number): void {
    if (frameMs > this.cfg.overrunMs) this.hold = this.cfg.recoverFrames;
    else if (this.hold > 0) this.hold -= 1;
  }

  /**
   * Whether a COSMETIC effect may spawn this frame. Informative effects — anything a player reads:
   * hit sparks, the kill burst, the hp flash, an event's shake — never ask, and must never be made
   * to (R9).
   */
  allowCosmetic(): boolean {
    return this.hold === 0;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/client && npx vitest run src/render/governor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: The seven places a tier is read, and the one that cannot change at runtime**

V2's Handoff named three; V3 added two and V4 two more. All seven, and what each does with a live tier change:

| # | Site | Today | With `TierManager` |
|---|---|---|---|
| 1 | `ShotRenderer.unit` | `worldFrameScale(BAKE_SUPERSAMPLE[BAKE_DEFAULT_TIER])` | `worldFrameScale(BAKE_SUPERSAMPLE[bakedTier()])` |
| 2 | `CarDecor.unit` | same | same |
| 3 | `CarRenderer.unit` | same | same |
| 4 | `BeamRenderer` constructor default | `tier = BAKE_DEFAULT_TIER` | passed `bakedTier()` by `ShotRenderer` |
| 5 | `bakeJobs(ss, pill, tier)` default | `BAKE_DEFAULT_TIER` | passed by `bakeAtlas` |
| 6 | `ParticleService` constructor | `tier = BAKE_DEFAULT_TIER` | constructed at the live tier; **`setCap` on every change** |
| 7 | `DecalService` constructor | same | same |

**Sites 1–5 read the tier the ATLAS WAS BAKED AT, not the live tier**, and that is the decision this task turns on. `bakeAtlas` runs once in `BootScene` (R13) and produces a sheet whose size, supersample and flame-frame count are all tier-dependent. Re-baking mid-match would be a multi-hundred-millisecond stall on the machine least able to afford one, to change the resolution of textures that are about to be minified anyway.

So: **`bakedTier()` is fixed for the session; only sites 6 and 7 follow a live tier change.**

```ts
// render/bake.ts — appended
let bakedAtTier: BakeTier = BAKE_DEFAULT_TIER;
/**
 * The tier the atlas on the GPU was actually baked at. Fixed for the session: `bakeAtlas` runs once
 * at boot (R13) and the sheet's size, supersample and flipbook length are baked into it. A tier
 * change after boot moves the caps that can move (particles, decals, filters, ambience) and leaves
 * the sheet alone; the new sheet arrives on the next launch, which is why the choice is persisted.
 */
export function bakedTier(): BakeTier {
  return bakedAtTier;
}
```

set inside `bakeAtlas(scene, tier)` as its first statement.

The player is told, rather than left to wonder why picking High changed so little:

```ts
// scenes/hud/match-banners.ts — appended
/** A one-line notice under the banners. `""` clears it. V4's Handoff put this here. */
setTierNotice(message: string): void
```

and `ArenaScene`, on a tier change where `TIER_TABLE[next].sheetPx !== TIER_TABLE[bakedTier()].sheetPx`, calls it with `"Graphics quality changed — restart the game to finish applying it"`.

- [ ] **Step 6: Wire it into `ArenaScene`**

`ArenaScene.create` gains, in the order it already builds its renderers:

```ts
    const stored = loadTierChoice();
    const pinned = tierFromSearch() ?? (stored.choice === "auto" ? undefined : stored.choice);
    this.tiers = new TierManager(pinned ?? stored.measured, {
      pinned,
      onChange: (tier) => this.onTierChange(tier),
    });
    this.governor = new FrameGovernor();
```

and `ArenaScene.update`, at the point it already calls `perf.frameStart()`:

```ts
    this.tiers.observe(delta, time);
    this.governor.observe(delta);
```

`onTierChange(tier)` does exactly four things, and no more:

```ts
  private onTierChange(tier: Tier): void {
    const spec = TIER_TABLE[tier];
    this.particles?.setCap(spec.particles);
    this.decals?.setCap(spec.decals);
    this.filters?.setEnabled(spec.filters);          // Task 4
    saveTierChoice(loadTierChoice().choice, tier);
    if (spec.sheetPx !== TIER_TABLE[bakedTier()].sheetPx) {
      this.banners?.setTierNotice("Graphics quality changed — restart the game to finish applying it");
    }
  }
```

The governor reaches the two services the same way V4 built them to be reached — through the caller, not through a global:

| Call site | Change |
|---|---|
| `EffectRouter`'s cosmetic bursts | the router already knows a burst's priority; it takes a `allowCosmetic: () => boolean` in its options object and skips a `cosmetic` burst when it answers false |
| `DecalService.place` | `ArenaScene` does not call it (no decal is authored, R12a). The governor's hook is `setCap(0)` for a shedding frame, which is what V4's Handoff says R22's decal clause means in this codebase, and it is one line in `onTierChange`'s sibling — **left unwired here, deliberately, because wiring a shed for a service with nothing in it is untestable ceremony.** The comment in `governor.ts` says so, and the day a decal is authored this is the line to add |

`HudScene` gets the readout (V1's Handoff: *"V5 attaches the tier readout and the governor's state to this scene"*), and `perf-overlay.ts` loses V0's placeholder:

| Before | After |
|---|---|
| `const TIER_UNTIL_V5 = "medium";` and the overlay printing it | `PerfOverlay.attachTier(read: () => string)`, the same shape as V0's `attachNetgraph` and V4's `attachParticles`; the overlay prints `tier ${read()}` and `"—"` when nothing has attached |

- [ ] **Step 7: Commit**

```bash
npm run build -w @motor-combat-moba/shared && cd packages/client && npx vitest run src/render && cd ../..
git add packages/client/src/render packages/client/src/scenes
git commit -m "feat(render): the per-frame governor, and the tier's seven call sites"
```

---

### Task 4: Bloom and vignette, at High only (R19)

**Files:**
- Create: `packages/client/src/render/filters.ts`, `packages/client/src/render/filters.test.ts`
- Modify: `packages/client/src/render/effects.ts`, `packages/client/src/render/effects.test.ts`, `packages/client/src/render/feedback-table.ts`, `packages/client/src/scenes/ArenaScene.ts`
- Test: the two above

**Interfaces:**
- Consumes: V4's `EffectRouter`, `FEEDBACK_TABLE`, `eventMagnitude`, `EffectCamera`; Task 1's `TIER_TABLE`.
- Produces:

```ts
// render/filters.ts
export const FILTER_CONFIG: {
  readonly bloomThreshold: number; readonly bloomBlurRadius: number; readonly bloomBlurSteps: number;
  readonly bloomBlurQuality: number; readonly bloomAmount: number; readonly boostAmount: number;
  readonly boostMs: number; readonly vignetteRadius: number; readonly vignetteStrength: number;
};
export interface FilterHost {                       // the camera slice, so the test needs no Phaser
  enableFilters?(): unknown;
  readonly filters: { external: { addParallelFilters(): ParallelLike; addVignette(x: number, y: number, radius: number, strength: number): unknown } };
}
export interface ParallelLike {
  readonly top: { addThreshold(edge1: number, edge2: number): unknown; addBlur(quality: number, x: number, y: number, strength: number, color: number, steps: number): unknown };
  readonly blend: { amount: number; blendMode: number };
  active: boolean;
  destroy(): void;
}
export class CameraFilters {
  constructor(host: FilterHost, enabled: boolean);
  setEnabled(on: boolean): void;
  boost(): void;
  update(deltaMs: number): void;
  destroy(): void;
  readonly enabled: boolean;
  readonly bloomAmount: number;
}
```

#### What Phaser 4.2.1 actually offers, and the one place this plan differs from R19

R19 asks for *"one half-resolution Bloom (a `ParallelFilters` of Blur-low and Blend, which is how Phaser 4 composes one) whose strength the explosion and death events briefly raise, and a static Vignette."*

Read against `node_modules/phaser/src/actions/AddEffectBloom.js`, the composition is exactly as R19 describes — `filters.external.addParallelFilters()`, then `top.addThreshold(...)` and `top.addBlur(quality, radius, radius, 1, 0xffffff, steps)`, with `parallelFilters.blend.amount` as the strength. **`blend.amount` is therefore the handle the event boost writes to**, and it is a plain number, so the boost is a decay in `update` and not a tween.

**Where this plan differs: there is no half-resolution knob.** Phaser 4.2.1's bloom has no render-target scale; grep `Controller.js`, `Blur.js` and `ParallelFilters.js` and the only cost knobs are `quality` (0 = low, 1 = medium, 2 = high) and `steps`. So "half resolution" is delivered as **`blurQuality: 0` with 4 steps**, which is the cheap path the same sentence was reaching for, and the difference is recorded here and in the Handoff rather than being quietly reinterpreted. R2's precedent applies: a numbered principle beats a parenthetical implementation sketch.

`camera.filters.external` rather than `internal`: external filters run after the camera has composited its own contents, which is what a full-screen garnish wants, and `AddEffectBloom` defaults to it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/render/filters.test.ts
import { describe, expect, it, vi } from "vitest";
import { TIER_TABLE } from "./tiers.js";
import { CameraFilters, FILTER_CONFIG, type FilterHost, type ParallelLike } from "./filters.js";

function host(): FilterHost & { parallels: ParallelLike[]; vignettes: number } {
  const parallels: ParallelLike[] = [];
  let vignettes = 0;
  return {
    parallels,
    get vignettes() { return vignettes; },
    enableFilters: vi.fn(),
    filters: {
      external: {
        addParallelFilters: () => {
          const p: ParallelLike = {
            top: { addThreshold: vi.fn(), addBlur: vi.fn() },
            blend: { amount: 1, blendMode: 0 },
            active: true,
            destroy: vi.fn(() => { parallels.splice(parallels.indexOf(p), 1); }),
          };
          parallels.push(p);
          return p;
        },
        addVignette: () => { vignettes += 1; },
      },
    },
  };
}

describe("CameraFilters", () => {
  it("attaches nothing below High", () => {
    const h = host();
    const filters = new CameraFilters(h, TIER_TABLE.medium.filters);
    expect(filters.enabled).toBe(false);
    expect(h.parallels).toHaveLength(0);
    expect(h.vignettes).toBe(0);
  });

  it("composes a bloom and a vignette at High", () => {
    const h = host();
    new CameraFilters(h, TIER_TABLE.high.filters);
    expect(h.parallels).toHaveLength(1);
    expect(h.vignettes).toBe(1);
    expect(h.parallels[0]!.top.addBlur).toHaveBeenCalledWith(
      FILTER_CONFIG.bloomBlurQuality, FILTER_CONFIG.bloomBlurRadius, FILTER_CONFIG.bloomBlurRadius,
      1, 0xffffff, FILTER_CONFIG.bloomBlurSteps,
    );
  });

  it("raises the bloom on a boost and decays it back over boostMs", () => {
    const h = host();
    const filters = new CameraFilters(h, true);
    filters.boost();
    expect(filters.bloomAmount).toBeCloseTo(FILTER_CONFIG.bloomAmount + FILTER_CONFIG.boostAmount, 6);
    filters.update(FILTER_CONFIG.boostMs / 2);
    expect(filters.bloomAmount).toBeCloseTo(FILTER_CONFIG.bloomAmount + FILTER_CONFIG.boostAmount / 2, 6);
    filters.update(FILTER_CONFIG.boostMs);
    expect(filters.bloomAmount).toBeCloseTo(FILTER_CONFIG.bloomAmount, 6);
  });

  it("a boost below High costs nothing and touches nothing", () => {
    const h = host();
    const filters = new CameraFilters(h, false);
    filters.boost();
    filters.update(16);
    expect(h.parallels).toHaveLength(0);
  });

  it("setEnabled builds once and tears down cleanly, so a tier can flap without leaking filters", () => {
    const h = host();
    const filters = new CameraFilters(h, false);
    filters.setEnabled(true);
    filters.setEnabled(true);
    expect(h.parallels).toHaveLength(1);
    filters.setEnabled(false);
    expect(h.parallels).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/render/filters.test.ts`
Expected: FAIL — cannot resolve `./filters.js`.

- [ ] **Step 3: Write `render/filters.ts`**

```ts
// packages/client/src/render/filters.ts

/**
 * Camera-level bloom and vignette, tier High only (rendering spec R19).
 *
 * Composed by hand rather than through `Phaser.Actions.AddEffectBloom` so the pieces stay reachable:
 * the Action returns `{ parallelFilters, threshold, blur }` and does exactly what the four calls
 * below do (`AddEffectBloom.js:86-99`), and what this class needs beyond it is a handle on
 * `blend.amount` — the strength R19 asks the explosion and death events to raise — plus a teardown
 * that survives a tier flapping.
 *
 * **No filter is ever attached to a world object** (R4, R19). One camera, two filters, and the Glow
 * LAYER is what gives shots their glow at every tier; this is a garnish the top tier can afford.
 */
export const FILTER_CONFIG = {
  /** Only the brightest pixels bloom: the additive Glow layer, muzzle flashes and the flame core. */
  bloomThreshold: 0.55,
  bloomBlurRadius: 2,
  bloomBlurSteps: 4,
  /**
   * 0 is Phaser's Low Quality blur (`Blur.js:82`). R19 asks for "half-resolution"; Phaser 4.2.1 has
   * no render-target scale on a filter, and this is the cost knob that exists. The difference is
   * recorded in this plan's Handoff rather than papered over.
   */
  bloomBlurQuality: 0,
  bloomAmount: 0.55,
  /** How far an explosion or a death briefly pushes it (R19). */
  boostAmount: 0.35,
  boostMs: 220,
  vignetteRadius: 0.72,
  vignetteStrength: 0.42,
} as const;

export interface ParallelLike {
  readonly top: {
    addThreshold(edge1: number, edge2: number): unknown;
    addBlur(quality: number, x: number, y: number, strength: number, color: number, steps: number): unknown;
  };
  readonly blend: { amount: number; blendMode: number };
  active: boolean;
  destroy(): void;
}

export interface FilterHost {
  enableFilters?(): unknown;
  readonly filters: {
    external: {
      addParallelFilters(): ParallelLike;
      addVignette(x: number, y: number, radius: number, strength: number): unknown;
    };
  };
}

const BLEND_ADD = 1;

export class CameraFilters {
  private parallel: ParallelLike | undefined;
  private boostLeftMs = 0;
  private on = false;

  constructor(
    private readonly host: FilterHost,
    enabled: boolean,
    private readonly cfg: typeof FILTER_CONFIG = FILTER_CONFIG,
  ) {
    this.setEnabled(enabled);
  }

  get enabled(): boolean {
    return this.on;
  }

  /** The live blend amount, which is what the boost animates. Reported for the test and the overlay. */
  get bloomAmount(): number {
    return this.parallel ? this.parallel.blend.amount : this.cfg.bloomAmount;
  }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (!on) {
      this.parallel?.destroy();
      this.parallel = undefined;
      this.boostLeftMs = 0;
      return;
    }
    this.host.enableFilters?.();
    const parallel = this.host.filters.external.addParallelFilters();
    parallel.top.addThreshold(this.cfg.bloomThreshold, 1);
    parallel.top.addBlur(
      this.cfg.bloomBlurQuality, this.cfg.bloomBlurRadius, this.cfg.bloomBlurRadius,
      1, 0xffffff, this.cfg.bloomBlurSteps,
    );
    parallel.blend.blendMode = BLEND_ADD;
    parallel.blend.amount = this.cfg.bloomAmount;
    this.parallel = parallel;
    // Static, and never rebuilt: it has no state to animate, so it rides the same enable as the bloom.
    this.host.filters.external.addVignette(0.5, 0.5, this.cfg.vignetteRadius, this.cfg.vignetteStrength);
  }

  /** An explosion or a death. Idempotent within a boost: a second one re-arms rather than stacking. */
  boost(): void {
    if (!this.parallel) return;
    this.boostLeftMs = this.cfg.boostMs;
    this.parallel.blend.amount = this.cfg.bloomAmount + this.cfg.boostAmount;
  }

  update(deltaMs: number): void {
    if (!this.parallel || this.boostLeftMs <= 0) return;
    this.boostLeftMs = Math.max(0, this.boostLeftMs - deltaMs);
    const fraction = this.boostLeftMs / this.cfg.boostMs;
    this.parallel.blend.amount = this.cfg.bloomAmount + this.cfg.boostAmount * fraction;
  }

  destroy(): void {
    this.setEnabled(false);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/client && npx vitest run src/render/filters.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: The router's fourth argument**

V4's Handoff: *"R19's 'the explosion and death events briefly raise bloom strength' is a fourth constructor argument on this class at High — the router already knows which events those are, and adding a filter handle is additive."* Take it exactly as offered:

```ts
// render/effects.ts — the constructor's options object gains one member
export interface EffectRouterOptions {
  // …V4's members, unchanged…
  /** Tier High only; absent below it. Raised by the events `FEEDBACK_TABLE` marks `bloom`. */
  readonly filters?: { boost(): void };
  /** V5's governor: a cosmetic burst asks before it spawns. Informative ones never do (R9). */
  readonly allowCosmetic?: () => boolean;
}
```

and `render/feedback-table.ts`'s `FeedbackSpec` gains `bloom?: boolean`, set on exactly two rows — `kill` and the `hit` row's explosion branch — with `onEvents` calling `opts.filters?.boost()` when it is set. Two appended cases in `effects.test.ts`:

```ts
  it("boosts the bloom on a kill and not on an ordinary hit", () => {
    const boost = vi.fn();
    const router = new EffectRouter(particles, decals, camera, { filters: { boost } });
    router.onEvents([{ kind: "hit", tick: 1, attacker: "a", victim: "b", weaponId: "pepperbox", x: 0, y: 0, damage: 10 }]);
    expect(boost).not.toHaveBeenCalled();
    router.onEvents([{ kind: "kill", tick: 2, killer: "a", victim: "b" }]);
    expect(boost).toHaveBeenCalledTimes(1);
  });

  it("asks the governor before a cosmetic burst and never before an informative one", () => {
    const allowCosmetic = vi.fn(() => false);
    const router = new EffectRouter(particles, decals, camera, { allowCosmetic });
    router.onEvents([{ kind: "hit", tick: 1, attacker: "a", victim: "b", weaponId: "pepperbox", x: 5, y: 5, damage: 10 }]);
    // The spark is informative: it fires regardless.
    expect(particles.bursts.some((b) => b.kind === "spark")).toBe(true);
  });
```

`ArenaScene` constructs `CameraFilters(this.cameras.main, TIER_TABLE[this.tiers.tier].filters)`, passes `{ boost: () => this.filters.boost() }` into the router, and calls `this.filters.update(delta)` in `update`. Task 3's `onTierChange` already calls `setEnabled`.

- [ ] **Step 6: Look at it**

Run `npm run dev`, then `http://localhost:5173/?dev=bench&tier=high`. Expected: the flame cores and the additive Glow layer read hotter than at `&tier=medium`, the screen corners darken slightly, and a scripted kill in the bench's event cycle produces a visible, brief lift. Then `&tier=medium` — no bloom, no vignette, and the shots still glow, because the Glow layer is what does that at every tier.

**Judge it at `?tier=high` on the bench, not in a match**, and judge the cost from the `?debug=perf` overlay's `render` bucket: a filter is a full-screen pass and it lands in `render`, not in `draw`.

- [ ] **Step 7: Commit**

```bash
cd packages/client && npx vitest run src/render && cd ../..
git add packages/client/src/render/filters.ts packages/client/src/render/filters.test.ts packages/client/src/render/effects.ts packages/client/src/render/effects.test.ts packages/client/src/render/feedback-table.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(render): camera bloom and vignette at tier High, boosted by kills and explosions"
```

---

### Task 5: Floor ambience, at High only

**Files:**
- Modify: `packages/client/src/scenes/arena/arena-floor.ts`, `packages/client/src/scenes/arena/arena-floor.test.ts` (create if V0 left none), `packages/client/src/render/layers.ts`
- Test: as above

**Interfaces:**
- Consumes: Task 1's `TIER_TABLE`; V2's `Layer`, `depthOf`; V0's `drawArenaFloor`.
- Produces: `FLOOR_AMBIENCE` (the four numbers), `attachFloorAmbience(scene, arena, enabled): { destroy(): void } | undefined`, and `drawArenaFloor` gaining a third parameter `tier`.

#### Why this is one quad and not a shader-per-tile

R12's catalogue row: *"Arena floor — `Graphics` once → image; at tier High a slow `Noise` breathe on the floor lines."* R21 gates it to High for one reason: **a full-screen per-pixel effect is fill-rate bound**, and fill rate is the budget an integrated GPU runs out of first (spec §1: the CPU and GPU budgets are separate and a laptop can starve on either).

So the ambience is one `Noise` game object the size of the arena on `Layer.Floor`, above the floor `Graphics` and below everything else, at low alpha, with its `seed` advanced by elapsed time. Not a filter (that is Task 4's budget), not per-tile, and **not** a second `Graphics`: V3's gate is that the world clears no `Graphics` at all, and `bench-arena.mjs` fails if that changes.

**The floor `Graphics` itself stays exactly as it is** — drawn once, never cleared, named `arena.floor`, one of the two the V2 gate allows. V1's Handoff corrected V2's guess about baking it and left it here; this task does not bake it either, for the reason V2's Handoff already gave (≈ 14 MB of VRAM to save re-walking forty points a single time).

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/scenes/arena/arena-floor.test.ts
import { describe, expect, it, vi } from "vitest";
import { getArena } from "@motor-combat-moba/shared";
import { Layer, depthOf } from "../../render/layers.js";
import { FLOOR_AMBIENCE, ambienceSeed, attachFloorAmbience } from "./arena-floor.js";

const arena = getArena("arena-01");

function stubScene() {
  const made: { type: string; depth: number; alpha: number }[] = [];
  const object = { setDepth: vi.fn(), setAlpha: vi.fn(), setOrigin: vi.fn(), destroy: vi.fn(), seed: 0 };
  Object.assign(object, {
    setDepth: (d: number) => { made.at(-1)!.depth = d; return object; },
    setAlpha: (a: number) => { made.at(-1)!.alpha = a; return object; },
    setOrigin: () => object,
  });
  return {
    made,
    object,
    add: {
      noise: (..._args: unknown[]) => { made.push({ type: "noise", depth: 0, alpha: 1 }); return object; },
    },
  };
}

describe("attachFloorAmbience", () => {
  it("creates nothing below High", () => {
    const scene = stubScene();
    expect(attachFloorAmbience(scene as never, arena, false)).toBeUndefined();
    expect(scene.made).toHaveLength(0);
  });

  it("puts one quad on the Floor layer, above the floor and under everything else", () => {
    const scene = stubScene();
    const handle = attachFloorAmbience(scene as never, arena, true);
    expect(handle).toBeDefined();
    expect(scene.made).toHaveLength(1);
    expect(scene.made[0]!.depth).toBe(depthOf(Layer.Floor, FLOOR_AMBIENCE.depthOffset));
    expect(scene.made[0]!.depth).toBeLessThan(depthOf(Layer.Decals));
    expect(scene.made[0]!.alpha).toBe(FLOOR_AMBIENCE.alpha);
  });

  it("breathes on elapsed time, not on frames rendered (R9)", () => {
    // One full cycle of the breathe is `periodMs`, whatever the frame rate.
    expect(ambienceSeed(0)).toBeCloseTo(ambienceSeed(FLOOR_AMBIENCE.periodMs), 6);
    expect(ambienceSeed(FLOOR_AMBIENCE.periodMs / 2)).not.toBeCloseTo(ambienceSeed(0), 3);
  });

  it("is subtle enough that it cannot be mistaken for a gameplay signal", () => {
    expect(FLOOR_AMBIENCE.alpha).toBeLessThanOrEqual(0.06);
    expect(FLOOR_AMBIENCE.periodMs).toBeGreaterThanOrEqual(8_000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/scenes/arena/arena-floor.test.ts`
Expected: FAIL — `attachFloorAmbience` is not exported.

- [ ] **Step 3: Write it**

Appended to `scenes/arena/arena-floor.ts`:

```ts
/**
 * The floor's slow breathe, tier High only (R12's arena-floor row, R21).
 *
 * One `Noise` quad on `Layer.Floor`, above the floor `Graphics` and below every decal, at an alpha
 * chosen so it reads as texture rather than as an event. Full-screen per-pixel work is fill-rate
 * bound — the budget an integrated GPU runs out of first (spec §1) — which is the whole reason this
 * is a tier row rather than always on.
 *
 * The period is deliberately long and the alpha deliberately tiny: a floor that pulses at a rate a
 * player could time is a floor a player will try to read, and there is nothing there to read.
 */
export const FLOOR_AMBIENCE = {
  /** Inside the Floor band, above the floor itself (offset 0) and below `Layer.Decals`. */
  depthOffset: 1,
  alpha: 0.05,
  /** One full breathe. Twelve seconds is slower than any weapon cycle on the roster. */
  periodMs: 12_000,
  /** Noise scale, in cycles across the arena's width. */
  scale: 3,
} as const;

/** The seed at a moment, as a phase in [0, 1). Time-based, never frame-based (R9). */
export function ambienceSeed(elapsedMs: number): number {
  return (elapsedMs % FLOOR_AMBIENCE.periodMs) / FLOOR_AMBIENCE.periodMs;
}

export interface AmbienceHandle {
  update(elapsedMs: number): void;
  destroy(): void;
}

export function attachFloorAmbience(
  scene: Phaser.Scene,
  arena: ArenaDef,
  enabled: boolean,
): AmbienceHandle | undefined {
  if (!enabled) return undefined;
  const noise = scene.add
    .noise(arena.width / 2, arena.height / 2, arena.width, arena.height, FLOOR_AMBIENCE.scale)
    .setDepth(depthOf(Layer.Floor, FLOOR_AMBIENCE.depthOffset))
    .setAlpha(FLOOR_AMBIENCE.alpha);
  return {
    update: (elapsedMs) => { noise.seed = ambienceSeed(elapsedMs); },
    destroy: () => noise.destroy(),
  };
}
```

`drawArenaFloor(scene, arena, tier)` gains the third parameter and returns the handle beside what it already returns; `ArenaScene` and `BenchScene` pass `bakedTier()` and call `update` from their own frame clock. Both call sites already destructure the return, so the addition is a field, not a signature break for them.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/client && npx vitest run src/scenes/arena/arena-floor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Look at it, and measure the fill**

`http://localhost:5173/?dev=bench&tier=high&debug=perf`. Expected: the floor's tone drifts almost imperceptibly over about twelve seconds, and it must be **invisible in a still screenshot** — if you can point at it, the alpha is too high. Compare `?dev=bench&tier=medium&debug=perf`'s `render` bucket against High's: the delta is what the ambience plus Task 4's filters cost together, and Task 6 splits them by toggling.

- [ ] **Step 6: Commit**

```bash
cd packages/client && npx vitest run src/scenes/arena && cd ../..
git add packages/client/src/scenes/arena/arena-floor.ts packages/client/src/scenes/arena/arena-floor.test.ts packages/client/src/render/layers.ts
git commit -m "feat(render): a slow floor breathe at tier High"
```

---

### Task 6: Measure every tier, guard it, write it down

**Files:**
- Modify: `packages/client/src/dev/BenchScene.ts`, `packages/client/src/render/perf-overlay.ts`, `scripts/bench-arena.mjs`, `scripts/world-retained.test.mjs`, `docs/render-bench.md`, `docs/roadmap.md`, `docs/project-structure.md`, `packages/client/CLAUDE.md`

**Interfaces:**
- Consumes: V0's `BenchProbe`, `PerfReport`, `formatBenchRows`, `BENCH_ARENA_DEFAULTS`, `parseBenchArgs`; V1–V4's `SceneCensus`, `sceneCensus`, `benchFailures`, `formatCensusRow`.
- Produces: `SceneCensus.tier`, `.dpr`, `.governorShedding`; `BenchProbe.tier()`; `--tiers` in `bench-arena.mjs`; `TIER_FRAME_LINES`; the V5 row and the final table in `docs/render-bench.md`.

#### The census widens for the fifth and last time

V1 created it, V2 added `worldGraphicsNames` and `worldClears`, V3 added `worldRopeVertices`, V4 added the four particle and event fields. **Each phase appends and never renames**, and this is V5's group:

```ts
export interface SceneCensus {
  // …V1's, V2's, V3's and V4's fields, unchanged…
  /** The tier this run measured. `bench-arena.mjs` pins it with `?tier=`; without it, whatever was persisted. */
  tier: string;
  /** The device-pixel ratio the canvas was built at — `min(devicePixelRatio, cap)`, R17. */
  dpr: number;
  /** Whether the governor was shedding on the frame the census was taken. Informational. */
  governorShedding: boolean;
}
```

- [ ] **Step 1: Pin the tier from the URL, and report it**

`BenchScene.create` gains, before it builds anything:

```ts
    const stored = loadTierChoice();
    this.tier = tierFromSearch() ?? (stored.choice === "auto" ? stored.measured : stored.choice);
```

and passes it to `bakeAtlas`, `BeamRenderer`, `ParticleService`, `DecalService` and `drawArenaFloor` — the five of Task 3's seven sites the bench constructs itself. `window.__bench` gains `tier: () => this.tier`, and `perf.attachTier(() => this.tier)` replaces V0's literal.

**This is what makes R25's two frame-time lines measurable at all**: they are stated at different tiers ("p95 < 12 ms at High", "p95 < 8 ms at Low, dpr 1"), and without a URL pin the runner cannot reach either.

- [ ] **Step 2: A run per tier**

`scripts/bench-arena.mjs`:

```js
/** R25's frame-time acceptance, per tier. The Medium row has no stated line; it is reported only. */
const TIER_FRAME_LINES = { low: 8, medium: undefined, high: 12 };

/** Every tier the runner measures unless `--tiers` narrows it. */
const ALL_TIERS = ["low", "medium", "high"];
```

`parseBenchArgs` gains `--tiers low,high` (defaulting to `ALL_TIERS`), `benchBrowser` gains a `tier` parameter and navigates to `${origin}/?dev=bench&tier=${tier}`, and `main` loops browsers × tiers. `formatBenchRows` gains a `tier` column as the second cell.

One clause in `benchFailures`, and it is deliberately **not** a frame-time assertion:

```js
  if (census.tier !== expectedTier) {
    failures.push(
      `${browser}: asked for tier "${expectedTier}" and the scene reports "${census.tier}" — the ` +
        `?tier= pin is not reaching the bake, so every number in this row is from the wrong tier`,
    );
  }
```

**R25's numbers are not asserted here and must not be.** `docs/render-bench.md`'s own header says why: under SwiftShader the absolutes mean little, the acceptance table is read by a person on the reference machine, and a CI that failed on a frame time would fail on the CI machine's mood. What CI checks is that the run is measuring what it claims to measure; the lines are printed beside the numbers so a person can compare.

`formatBenchRows` prints them:

```js
    const line = TIER_FRAME_LINES[row.tier];
    const verdict = line === undefined ? "" : r.frameMs.p95 < line ? `  (line ${line} ms: ok)` : `  (line ${line} ms: OVER)`;
```

- [ ] **Step 3: The final measurement pass**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena
node scripts/bench-visual.mjs
node scripts/bench-arena.mjs
```

and then, on the **reference machine** (R25: a 2019 integrated-graphics laptop — four-core mobile CPU, UHD 620 or Vega 8, 8 GB, 1080p at 60 Hz, 125–150 % scaling), in a real browser rather than under software GL, all three of Chrome, Edge and Firefox at each tier:

```
http://localhost:5173/?dev=bench&tier=low&debug=perf
http://localhost:5173/?dev=bench&tier=medium&debug=perf
http://localhost:5173/?dev=bench&tier=high&debug=perf
```

**The software-GL run and the laptop run answer different questions and both go in the page.** SwiftShader measures the CPU side and is the regression check; the laptop measures the GPU fill that R25's frame-time lines are actually about, and a bloom pass at dpr 2 is precisely the thing software GL will mis-report.

- [ ] **Step 4: Write it down**

`docs/render-bench.md` gains the final section, replacing every `(record)` with a number:

```markdown
## V5 — Pixels

The last rendering phase, and the first one whose numbers depend on which tier you ask for. Three
tiers, three browsers, two machines: the CI row is software GL (CPU only) and the laptop row is
R25's reference machine, where the frame-time lines actually live.

| Tier | dpr | Particles | Decals | Flame frames | Bloom + vignette | Floor ambience | Atlas |
|---|---|---|---|---|---|---|---|
| Low | 1 | 96 | 16 | 12 | off | off | 1024² |
| Medium | 1.5 | 256 | 48 | 24 | off | off | 2048² |
| High | 2 | 512 | 96 | 24 | on | on | 2048² |

Every cell above is read from the code — `TIER_TABLE` reads `PARTICLE_CONFIG.caps`,
`DECAL_CONFIG.maxLive`, `FLAME_FRAMES`, `BAKE_SUPERSAMPLE` and `BAKE_SHEET_PX` — so this table is a
transcription and `tiers.test.ts` is what keeps it honest.

### Ceiling scenario, reference machine (R25)

| Browser | Tier | frame p50/p95 ms | js p50/p95 ms | draws p50/max | line |
|---|---|---|---|---|---|
| Chrome | Low | (record) | (record) | (record) | frame p95 < 8 ms |
| Chrome | Medium | (record) | (record) | (record) | js p95 < 5 ms |
| Chrome | High | (record) | (record) | (record) | frame p95 < 12 ms |
| Edge | … | | | | |
| Firefox | … | | | | |

### Ceiling scenario, software GL (`node scripts/bench-arena.mjs`)

| Browser | Tier | frame p50/p95 ms | js p50/p95 ms | draws p50/max |
|---|---|---|---|---|
| Chromium | Low | (record) | (record) | (record) |
| … | | | | |

### Where the frame goes at High, and what the garnishes cost

| Measurement | Medium | High |
|---|---|---|
| `render` bucket p50 (filters land here, not in `draw`) | (record) | (record) |
| High with `filters` forced off | — | (record) |
| High with `floorAmbience` forced off | — | (record) |
| Boot bake | (record) | (record; line < 150 ms) |

### The whole arc, V0 to V5

| Measurement | V0 (before) | V5 (now) |
|---|---|---|
| Beam geometry + earcut at the ceiling | 6.53 ms | 0.00 ms — nothing fills a path |
| World `Graphics` cleared per frame | 8 | 0 |
| `Text` objects in the arena | 54 | 0 |
| Draw calls at the ceiling | (V0's) | (record; ceiling 16) |
| Client JavaScript p95 at the ceiling | (V0's) | (record; line < 5 ms) |
```

`docs/roadmap.md`'s **Deferred** section: the device-pixel-ratio entry is **landed**. Replace its five bullets with three sentences saying what shipped (game size × dpr capped per tier, one screen-space camera treatment, the world camera's viewport and zoom scaled together so the world window is unchanged), and that two of its five bullets evaporated before this phase reached them — no `Text` survives V1, and the HUD is its own scene since V1 — and that the fifth (the DOM input under camera zoom) was verified rather than changed, because `DOMElementCSSRenderer` builds its transform from the same camera matrix. **Do not delete the entry**; a reader wants to know where it went.

`packages/client/CLAUDE.md` gains one paragraph:

```markdown
**Quality is a tier, and the tier is measured.** `render/tiers.ts` holds `TIER_TABLE` — which READS
the caps `config/particles.ts`, `config/decals.ts` and `render/bake.ts` already author, and never
restates them — and a `TierManager` that drops a tier after one five-second window over 14 ms and
raises one at most once after a minute under 8 ms, persisting the result. `render/governor.ts` is
its per-frame sibling: after a frame over 12 ms it refuses cosmetic particle spawns for a tenth of a
second, and it never refuses anything a player reads. **A tier change moves the caps, the filters and
the floor ambience; it does not re-bake the atlas or resize the canvas** — those are decided once at
boot, which is why the choice is persisted and why the player is told to restart.
```

`docs/project-structure.md`: `render/tiers.ts`, `render/tier-storage.ts`, `render/governor.ts`, `render/render-scale.ts`, `render/filters.ts` added.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev packages/client/src/render/perf-overlay.ts scripts/bench-arena.mjs scripts/world-retained.test.mjs docs packages/client/CLAUDE.md
git commit -m "test(render): a bench run per tier, and V5's measured numbers"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Probe note for the summary.** This phase touches **no probe and no file under `packages/server/`** — `git diff --stat development/main -- packages/server/` prints nothing, and that is the check, not the claim. It changes what the client draws and nothing the sim does, so `npm run playtest` is expected to report exactly what it reported before; the execution guide does not require a run after V5 and there is nothing here for a probe to measure. The one thing worth saying out loud instead: **`packages/shared` is untouched too**, so `configFingerprint` and `balanceStamp` have not moved and no balance baseline is invalidated by making the game sharper.

---

## Acceptance

Spec §10, the V5 row: **Ships** — "tiers, governor, dpr, bloom and vignette at High, floor ambience". **Deletes** — none. **Acceptance** — "tiers auto-select and persist; dpr 1.5 sharp on a 150 % display; frame time at the ceiling p95 < 12 ms at High and < 8 ms at Low on the reference machine".

| Requirement | Demonstrated by |
|---|---|
| **Tiers auto-select** | `cd packages/client && npx vitest run src/render/tiers.test.ts` (11 tests) — the warm-up is ignored, one window over `TIER_CONFIG.downMs` steps down exactly one tier, a minute under `upMs` raises exactly once and never again, and a pinned tier never moves. Live: `?debug=perf`'s tier readout changing within about seven seconds of starting a match on a machine that cannot hold 14 ms |
| **Tiers persist** | `cd packages/client && npx vitest run src/render/tier-storage.test.ts` (5 tests) — `choice` and `measured` are stored separately so unpinning does not discard a measurement; a malformed or hostile storage falls back whole. Live: play once on a slow machine, reload, and `?debug=perf` opens at the tier it settled on |
| **The player can pin a tier** | `join.test.ts`'s two appended cases; and the Graphics selector on the join screen, whose choice survives a reload |
| **`TIER_TABLE` does not restate a cap** | `tiers.test.ts`'s first case, which reads `PARTICLE_CONFIG.caps`, `DECAL_CONFIG.maxLive`, `FLAME_FRAMES`, `BAKE_SUPERSAMPLE` and `BAKE_SHEET_PX` and asserts the table equals each — V4's Handoff asked for exactly this |
| **dpr 1.5 sharp on a 150 % display** | `render-scale.test.ts`'s mapping cases prove the arithmetic (`screen = dpr × logical`, canvas `= logical × dpr`); the sharpness itself is Task 2 Step 7's by-hand check on a 150 %-scaled screen, which is the only way to sign off "sharp". Record the machine beside the answer |
| **The world window did not move** | `render-scale.test.ts`'s "shows exactly the same arena at every device-pixel ratio" — viewport and zoom scale together, so `viewport / zoom` is `ARENA_VIEW_WIDTH / CAMERA_CONFIG.zoom` at dpr 1, 1.5 and 2. This is the fairness invariant the server's `buildBotView` shares, and it is why `CAMERA_CONFIG` is not edited |
| **Frame time p95 < 12 ms at High and < 8 ms at Low** | `node scripts/bench-arena.mjs` at each tier prints the number beside its line; the binding measurement is the reference machine's, recorded in `docs/render-bench.md`'s V5 table with the machine named. **CI does not assert it** and Task 6 Step 2 says why |
| Every scene renders at device pixels | `node --test scripts/render-scale.test.mjs` — every `extends Phaser.Scene` file is classified screen-space, world or dev, so a new scene fails until somebody decides |
| The governor sheds before the tier drops | `cd packages/client && npx vitest run src/render/governor.test.ts` (4 tests), including the assertion that `GOVERNOR_CONFIG.overrunMs < TIER_CONFIG.downMs` |
| The governor never sheds what a player reads | `effects.test.ts`'s appended case: an informative burst fires with `allowCosmetic` returning false |
| Bloom and vignette at High only | `cd packages/client && npx vitest run src/render/filters.test.ts` (5 tests) — nothing is attached below High, the composition matches `AddEffectBloom`'s, the boost decays over `boostMs`, and `setEnabled` is idempotent in both directions so a flapping tier leaks no filters. By eye at `?dev=bench&tier=high` |
| The bloom boost comes from events, not from local detection | `effects.test.ts`'s "boosts the bloom on a kill and not on an ordinary hit" — the router is still the only consumer of `RenderFrame.events` (V4) |
| Floor ambience at High only | `cd packages/client && npx vitest run src/scenes/arena/arena-floor.test.ts` (4 tests) — nothing is created below High, the quad is on `Layer.Floor` below `Layer.Decals`, the breathe is time-based (R9), and its alpha and period are bounded so it cannot read as a signal |
| V3's gate is not broken | `bench-arena.mjs`'s `WORLD_CLEARS_ALLOWED` is still `[]` and still passes: the ambience is a `Noise` quad and the filters are camera-level, so nothing this phase adds is a `Graphics` |
| V4's gates are not broken | the same run's `PARTICLE_HARD_CEILING`, `EVENT_KINDS` and decal clauses, now exercised at three tiers instead of one — the particle ceiling is read per tier from `TIER_TABLE` |
| Draw calls still ≤ 16 at the ceiling | `bench-arena.mjs`'s `DRAW_CALL_CEILING` at every tier. A camera filter is a full-screen pass and counts; if High exceeds 16, the ceiling is R25's and does not move — drop a filter |
| Boot bake < 150 ms at every tier | `node scripts/bench-visual.mjs` plus the bench scene's own bake timing, recorded per tier |
| Nothing under `match/` imports Phaser, and no test does | `grep -rin "phaser" packages/client/src/match/` prints nothing; `tiers.ts`, `governor.ts`, `render-scale.ts` and `filters.ts` all take their Phaser objects through an injected slice or `import type` |
| `packages/shared` and `packages/server` are untouched | `git diff --stat development/main -- packages/shared/ packages/server/` prints nothing; `node --test scripts/turn-tuning-doc.test.mjs scripts/manual-page.test.mjs` passes with neither page edited and `npm run build:manual` never run |
| Everything else still green | `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena` |

Record the measured numbers in `docs/render-bench.md`'s V5 tables, with the date and the machine, when the phase is run. **The reference-machine row is the one the spec's acceptance is read off**; the software-GL row is the regression check.

## Handoff

This is the last plan in the rendering stream. Nothing consumes this section — it is here for whoever changes the renderer next.

### The five new modules

| Module | Exports | What a later change needs to know |
|---|---|---|
| `render/tiers.ts` | `Tier` (= `BakeTier`), `TIERS`, `TierSpec`, `TIER_TABLE`, `TIER_CONFIG`, `tierFromSearch`, `TierManager` | **`TIER_TABLE` reads five of its nine rows from elsewhere.** A new tiered knob goes in the table only if it has no other home; a knob that already has a config object is read from there. `TIERS` order is the meaning of up and down |
| `render/tier-storage.ts` | `TIER_STORAGE_KEY`, `TierChoice`, `loadTierChoice`, `saveTierChoice` | two values, not one: `choice` is the player's, `measured` is the machine's. Bump the key's `v1` if the shape ever changes; the loader falls back whole rather than half-applying |
| `render/governor.ts` | `GOVERNOR_CONFIG`, `FrameGovernor` | `overrunMs` (12) must stay **below** `TIER_CONFIG.downMs` (14), and `governor.test.ts` asserts it. The governor is a reflex; the tier is a decision |
| `render/render-scale.ts` | `ScreenCamera`, `renderDpr`, `deviceSize`, `worldZoom`, `applyScreenCamera`, `bindRenderScale`, `installRenderScale`, `RENDER_SCALE_DPR`, `WORLD_SCENE_KEYS` | `RENDER_SCALE_DPR` is computed **once at module load** and never changes. A new scene must be classified in `scripts/render-scale.test.mjs`, which fails until it is |
| `render/filters.ts` | `FILTER_CONFIG`, `FilterHost`, `ParallelLike`, `CameraFilters` | the only filter surface in the game, and it is camera-level by rule (R4, R19). `blend.amount` is the bloom's strength and the boost's handle |

### Changed surfaces

`render/bake.ts` gains `bakedTier()` — **the tier the atlas on the GPU was actually baked at**, which is what sites 1–5 of Task 3's table read, and which is fixed for the session. `render/effects.ts`'s options object gains `filters` and `allowCosmetic`. `render/feedback-table.ts`'s `FeedbackSpec` gains `bloom?: boolean`, set on two rows. `scenes/hud/match-banners.ts` gains `setTierNotice`. `scenes/arena/arena-floor.ts` gains `FLOOR_AMBIENCE`, `ambienceSeed`, `attachFloorAmbience`, and `drawArenaFloor` takes a tier. `render/perf-overlay.ts` gains `attachTier` and loses V0's `TIER_UNTIL_V5` — **the last of V0's three placeholders is now gone** (`PARTICLES_UNTIL_V4` went in V4). `SceneCensus` gains `tier`, `dpr` and `governorShedding`, appended, nothing renamed — the fifth and final widening.

### Where this plan departed from the spec, and why

One place, and it is a Phaser fact rather than a preference:

**R19 asks for a "half-resolution Bloom"; Phaser 4.2.1 has no render-target scale on a filter.** `Controller.js`, `Blur.js` and `ParallelFilters.js` expose `quality` (0/1/2), `steps`, `strength` and the blend's `amount`, and nothing that resizes the pass. The cheap path R19 was reaching for is delivered as `blurQuality: 0` — Phaser's own Low Quality blur — with 4 steps, and the cost is measured in Task 6 rather than assumed. If a later Phaser adds a resolution knob, `FILTER_CONFIG` is where it lands.

### Deliberately left

- **A settings screen.** The tier pin is a `<select>` on the join screen because that is the only screen every player passes through. Volume, key bindings and a proper options dialog are a UI project, and this phase put one control where a player can find it rather than inventing a home for it.
- **Re-baking on a tier change.** The atlas is baked once at boot (R13) and a change of tier tells the player to restart. Re-baking mid-match is a multi-hundred-millisecond stall on the machine least able to afford one; the persisted choice is what makes "next launch" acceptable.
- **A boot-time synthetic benchmark.** R22's auto-tier measures the real thing — the game, running — over five seconds, which is both cheaper and more honest than a probe measuring something else during a load screen. The cost is that a slow machine's *first* session bakes a 2048 sheet before it knows better; every session after that is right.
- **`SpriteGPULayer` for the floor** (spec §2). A static GPU buffer of quads with GPU-driven animation is the right tool for a large ambient field and would be cheaper than the `Noise` quad at High. It is also a second way to put something on the floor, and this phase added one. Named so the option is not lost.
- **The governor shedding decals.** `DecalService.setCap(0)` is the one-line hook and it is unwired, because `DECAL_DEFS` is empty by decision (R12a) and shedding a service with nothing in it is untestable ceremony. `governor.ts`'s comment says where the line goes.
- **A tier notice anywhere but the arena.** `setTierNotice` is on `MatchBanners`; a player who changes quality from the join screen sees the change take effect at the next launch with no notice at all, because there is nothing to notice yet.
- **The `?debug=perf` overlay's own cost.** It is `BitmapText` since V1 and refreshes at 4 Hz, and it is still inside the numbers it prints. Stated rather than fixed, as V0 stated it.

## Self-review

**Spec coverage.** §8 in full: R17 is Task 2 (dpr capped per tier, game size × dpr, camera zoom × dpr, the two of the roadmap's five bullets that evaporated and the one that was verified rather than changed); R17a is Task 2 Step 5's `render` block with all five values set and a reason each, including the `mipmapRegeneration` interaction with `DynamicTexture` and filter render targets read out of `WebGLTextureWrapper.js:324` rather than assumed; R18a needs nothing here — N4 and V4 own both halves; R19 is Task 4, camera-level only, tier-gated, with the event boost taken through the fourth constructor argument V4's Handoff offered and the one honest departure recorded; R20 is why Task 2 has no HUD-positioning work to do. §9 in full: R10 and R21 are Task 1's table, R22 is split between Task 1's `TierManager` (the five-second window, the 14 ms drop, the once-only 8 ms raise, persistence) and Task 3's `FrameGovernor` (the 12 ms per-frame shed), with the two thresholds' ordering asserted; R23's overlay gains its tier readout in Task 6 and loses V0's last placeholder; R24's bench scene gains the `?tier=` pin that makes R25's two frame-time lines reachable; R25's six numbers are the Acceptance table's rows and `docs/render-bench.md`'s final tables. §10's V5 row: the Ships list is Tasks 1–5 and the acceptance clauses are the Acceptance table's first six rows. §11: R10, R17, R17a, R19, R21, R22, R23 each have a task; R12's arena-floor row is Task 5.

**Placeholder scan.** Every new module — `render/tiers.ts`, `render/tier-storage.ts`, `render/governor.ts`, `render/render-scale.ts`, `render/filters.ts` — is printed in full, and so are the join-screen control, the floor ambience and the scene-coverage scan. Every edit to an existing file is a named substitution table (the two camera lines in `arena-floor.ts`, the `TIER_UNTIL_V5` swap, the game-config block) or a printed block with the statement it follows named. Every test is real code with values read from the thing it tests — `PARTICLE_CONFIG.caps`, `DECAL_CONFIG.maxLive`, `FLAME_FRAMES`, `BAKE_SUPERSAMPLE`, `BAKE_SHEET_PX`, `TIER_CONFIG`'s five fields, `GOVERNOR_CONFIG`'s two, `FILTER_CONFIG`'s nine, `CAMERA_CONFIG.zoom`, `ARENA_VIEW_WIDTH` — rather than as digits, and the two figures quoted in prose (2136 × 1080, and a tenth of a second) are each derived beside themselves. `docs/render-bench.md`'s `(record)` cells are the one exception and are not placeholders in the plan's sense: they are the table a person fills in when they run the phase, exactly as V0 through V4 left theirs, and Task 6 Step 4 says an unfilled cell is a phase that was not measured.

**Type consistency.** `Tier` and `BakeTier` are the same union and the ledger's direction is honoured in exactly one line (`export type Tier = BakeTier`), so `tiers.ts` imports from `bake.ts` and never the reverse — V1 stays free of V5. That one union keys `TIER_TABLE`, `PARTICLE_CONFIG.caps`, `DECAL_CONFIG.maxLive`, `FLAME_FRAMES`, `BAKE_SUPERSAMPLE`, `BAKE_SHEET_PX`, `bakeJobs`, `bakeAtlas`, `BeamRenderer`'s constructor, both service constructors, `renderDpr`, `tierFromSearch`, `loadTierChoice` and `bakedTier()` — fourteen consumers, one type, no cast anywhere. `TierSpec.particles` and `TierSpec.decals` are the numbers `ParticleService.setCap` and `DecalService.setCap` take, which is why `onTierChange` is four lines and not a rebuild. `ScreenCamera` and `FilterHost` are structural slices of Phaser types, so `applyScreenCamera(this.cameras.main, dpr)` and `new CameraFilters(this.cameras.main, …)` type-check against the real objects while the tests pass plain literals — the same injected-seam trick V4 used for its emitter factory, applied to a camera. `SampleRing` (V0) is what `TierManager` measures with and what `PerfRings` measures with, so the tier's p95 and the overlay's p95 are the same statistic computed the same way. `SceneCensus` is appended to and never renamed, for the fifth time, and `benchFailures(browser, census, report)` keeps V2's signature with one more clause inside it.
