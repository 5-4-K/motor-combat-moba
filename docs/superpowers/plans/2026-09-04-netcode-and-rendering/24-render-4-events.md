# Rendering Phase 4 — Events: Particles, Decals and Feedback That Comes From the Server

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every piece of feedback in the game stops being guessed at and starts arriving as a server event. A hit sparks at the server's contact point on the server's tick; a kill punches the camera; a ram throws debris; a respawn shimmers. Underneath that, a particle service with a hard budget per tier so a firefight cannot cost more than it is allowed to, and the decal *mechanism* — pooled fading ground sprites — present, tested and carrying **no decals at all**.

**Architecture:** Three new modules and one deletion. `render/particles.ts` owns one emitter per (frame, layer) pair and a global cap the service enforces rather than the callers. `render/decals.ts` owns a pool of ground sprites with an empty definition table. `render/effects.ts` is the router: it takes `RenderFrame.events` and turns each kind into a burst, a flash, a shake or a zoom punch, from a small table in `render/feedback-table.ts`. And `scenes/impact-feedback.ts` — the local contact detection whose own doc comment documents that it compares two timebases and can spark on a miss — is deleted, because the event that replaces it is the server's.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), npm workspaces, Phaser 4.2.1 (`ParticleEmitter`, `Camera.shake`, tweened zoom), vitest in the **node** environment, Playwright for the bench runner.

**Spec:** [`2026-09-04-client-rendering-architecture-design.md`](../../specs/2026-09-04-client-rendering-architecture-design.md) — §5's transient rows in full, §7 in full (R5, R16), §11's R12a, R18, R9, §10's V4 row. Also [`2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) §6.8 (N23a) — the six event kinds and their payloads, which this plan consumes and does not define.
**Ledger:** [`interfaces.md`](interfaces.md) — `render/particles.ts`, `render/decals.ts`, `render/effects.ts`, `render/layers.ts`, `render/bake.ts`, `MatchEvent`. **Previous phase:** [`23-render-3-beams.md`](23-render-3-beams.md) — **read its `## Handoff` in full before Task 1**, especially "Deliberately deferred by V3", which is this plan's work list. Also [`22-render-2-bake.md`](22-render-2-bake.md) (the layer plan, the sprite pool, the bake) and [`20-render-0-instrumentation.md`](20-render-0-instrumentation.md) (the bench scene and `dev/bench-frame.ts`). **Runbook:** [`00-execution-guide.md`](00-execution-guide.md) — §1 coupling 2, §3, §5 (the V4 gate).

## Coupling 2, and why it is already discharged

The execution guide says: *"V4 consumes `RenderFrame.events`, which N4 fills; V4's bench scene synthesises events until then,"* and the assignment for this plan says the one-line switch to real events lives here.

**It is one line, and it is a constructor argument rather than an edit.** Both halves read the same field:

- `ArenaScene` passes `frame.events` to `EffectRouter.onEvents`, and `RenderFrame.events` is filled by `MatchClient.frame` once the netcode work's phase 4 has merged. Until then it is `[]`, exactly as the preparation plan defined it, and every renderer already behaves correctly on an empty list.
- `BenchScene` passes `benchEvents(tick)` — a scripted stream from `dev/bench-frame.ts` — into the same call, because a bench scene has no server at all and never will.

So there is nothing to switch on when N4 lands: the arena starts receiving real events the moment the field stops being empty, and the bench keeps its synthetic ones forever because that is what a bench is. **This plan can therefore be executed before or after N4 merges**, and the only difference is whether a live match shows the effects. Say which it was in the merge commit.

## Global Constraints

- **Rebuild shared before testing**: `npm run build -w @motor-combat-moba/shared`.
- **Verify with root `npm test`**, never a per-workspace run alone.
- **`.js` import specifiers** on every local import; shared is imported as `@motor-combat-moba/shared`.
- **Nothing under `packages/client/src/match/` imports Phaser, and no test imports Phaser.** This plan touches `match/` only to delete a dead import; every new module takes its Phaser objects through a small injected interface or a factory, which is what makes the caps and the timings unit-testable at all.
- **Do not touch `packages/server/playtest/`.** This plan does not, at all.
- **Do not edit `docs/ideas/` or `docs/invariants/`.**
- **Commit after every task** on branch `claude/gameplay-netcode-architecture-bgp8f6`. `npm install` in a fresh worktree before the first build.
- **"main" means `development/main`.**
- **This plan does not edit `packages/shared`.** Ledger coupling 4. Every event kind and payload it consumes is `net/events.ts`'s, defined by the netcode spec's N23a and shipped by that stream's phase 2; every status id it draws a badge for is `STATUS_TABLE`'s.
- **No balance table is edited**, so `npm run build:manual` and `docs/turn-tuning.md` are not owed an update.
- **No decal is authored (R12a).** The mechanism ships; `DECAL_DEFS` ships empty; `decals.test.ts` asserts it is empty. Every §5 row that names a scorch, skid or blast decal is a *candidate*, and the spec says so in the sentence directly under the catalogue. Authoring one is a table row and an atlas frame, in some later pass that is not this one.
- **Zero allocation on the frame path (R6).** A burst is `emitter.emitParticleAt(x, y, count)`; a decal update walks a fixed array; the router walks `events` with a `for…of` and creates no closures. The one place this is tested rather than asserted is Task 6's census.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/client/src/config/particles.ts` (create) | `PARTICLE_CONFIG`, `PARTICLE_DEFS`, `ParticleKind`, `ParticlePriority` |
| `packages/client/src/config/decals.ts` (create) | `DECAL_CONFIG`, `DecalDef`, `DECAL_DEFS` (empty) |
| `packages/client/src/render/particles.ts` (create) | `ParticleService` — one emitter per kind, one global cap |
| `packages/client/src/render/decals.ts` (create) | `DecalService` — a pooled fading ground sprite, and nothing to place |
| `packages/client/src/render/feedback-table.ts` (create) | `FEEDBACK_TABLE` — event kind → shake, zoom punch, burst (R18) |
| `packages/client/src/render/effects.ts` (create) | `EffectRouter` — the only consumer of `RenderFrame.events` |
| `packages/client/src/render/bake.ts` (modify) | `fxBakeJobs(ss, tier)`: particle frames, the status flipbooks, the car shadow, the muzzle flash |
| `packages/client/src/render/layers.ts` (modify) | `CAR_BAND.shadow`, `CAR_BAND.status` |
| `packages/client/src/scenes/arena/car-sprites.ts` (modify) | `shadow(pose)`, `statusBadges(car, tick)`, the hit-flash tint |
| `packages/client/src/scenes/arena/shot-renderer.ts` (modify) | the muzzle flash off a birth tick |
| `packages/client/src/scenes/impact-feedback.ts` (delete) | local contact detection, replaced by the `ram` event |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | owns the three services and hands the router `frame.events` |
| `packages/client/src/dev/bench-frame.ts` (modify) | `benchEvents(tick)`, the scripted stream R24 asks for |
| `packages/client/src/dev/BenchScene.ts` (modify) | the census gains `particlesLive` and `effectsByKind` |
| `packages/client/src/render/perf-overlay.ts` (modify) | `PARTICLES_UNTIL_V4` becomes a real reading |
| `scripts/bench-arena.mjs` (modify) | the particle-cap and every-kind-drives-an-effect failures |
| `docs/render-bench.md`, `docs/project-structure.md`, `packages/client/CLAUDE.md` (modify) | what feedback is now |

---

### Task 1: The particle service (R5, R16)

**Files:**
- Create: `packages/client/src/config/particles.ts`, `packages/client/src/render/particles.ts`, `packages/client/src/render/particles.test.ts`
- Modify: `packages/client/src/render/bake.ts`, `packages/client/src/render/bake.test.ts`

**Interfaces:**
- Consumes: V2's `Layer`, `depthOf`, `LAYER_BLEND`, `BAKED_ATLAS`, `bakedFrame`, `BakeJob`, `BakeGraphics`, `BakeTier`, `BAKE_DEFAULT_TIER`; V3's `beamBakeJobs` pattern and `bakeJobs`' three-way concatenation.
- Produces (the ledger's `render/particles.ts` row, plus the config it reads):

```ts
// config/particles.ts
export type ParticleKind = "spark" | "ember" | "smoke" | "dust" | "debris" | "shimmer";
export type ParticlePriority = "informative" | "cosmetic";
export interface ParticleDef {
  readonly kind: ParticleKind;
  readonly frame: string;              // a `baked.fx.*` frame name
  readonly layer: Layer;
  readonly lifespanMs: number;
  readonly speed: readonly [number, number];
  readonly scale: readonly [number, number];
  readonly alpha: readonly [number, number];
  readonly maxParticles: number;       // this emitter's own hard cap
  readonly tint?: number;
}
export const PARTICLE_DEFS: Readonly<Record<ParticleKind, ParticleDef>>;
export const PARTICLE_CONFIG: {
  readonly caps: Readonly<Record<BakeTier, number>>;   // 96 / 256 / 512 (spec R21)
  readonly informativeHeadroom: number;                 // 1.25
};

// render/particles.ts
export interface ParticleEmitterLike {
  emitParticleAt(x: number, y: number, count: number): unknown;
  getAliveParticleCount(): number;
  stop(): unknown;
  start(): unknown;
  setQuantity(q: number): unknown;
  destroy(): void;
}
export class ParticleService {
  constructor(make: (def: ParticleDef) => ParticleEmitterLike, tier?: BakeTier);
  burst(kind: ParticleKind, x: number, y: number, count: number, priority: ParticlePriority): number;
  stream(kind: ParticleKind, follow: { x: number; y: number }, rate: number): void;
  setCap(n: number): void;
  /** Per-frame: advances the streams and re-reads the live count. */
  update(deltaMs: number): void;
  readonly live: number;
  readonly cap: number;
  readonly refused: number;
  clear(): void;
  destroy(): void;
}
export function makePhaserEmitter(scene: Phaser.Scene): (def: ParticleDef) => ParticleEmitterLike;
```

#### The cap is the service's job, not the callers'

R16 is explicit: *"A global cap per tier (Low 96, Medium 256, High 512 live particles) is enforced by the service, not by callers: when the cap is hit, the lowest-priority request is refused."* That has one awkward consequence worth stating up front — a request cannot be refused *retroactively*, so "the lowest-priority request is refused" has to mean "a request that would take the count past the cap is refused if it is the low-priority kind".

The rule, in full:

| Situation | What happens |
|---|---|
| `live + count <= cap` | admitted whole |
| over the cap, priority `cosmetic` | **refused entirely** and counted in `refused` |
| over the cap, priority `informative` | admitted, clamped so `live` never exceeds `cap × informativeHeadroom` (1.25) |
| over that too | refused, whatever the priority — the hard ceiling |

The headroom exists because of what "informative" means: hit sparks, the death burst and ram debris are how a player learns what happened, and a firefight busy enough to fill the cap with exhaust smoke is exactly the moment they most need to. **A quarter is the whole allowance**, and Task 6's bench failure reads the hard ceiling rather than the soft one.

Every caller passes a priority and none of them checks anything. `EffectRouter` (Task 3) is the only caller that passes `informative`.

- [ ] **Step 1: `config/particles.ts`**

```ts
// packages/client/src/config/particles.ts
import { Layer } from "../render/layers.js";
import type { BakeTier } from "../render/bake.js";

/**
 * The six particle kinds, and what each one is for. A kind is a (texture frame, layer) pair — which
 * is the unit Phaser batches by — so adding a seventh means adding an emitter, and adding a colour
 * or a size does not.
 *
 * Render-only: nothing here is read by the sim, none of it is networked, and two clients showing
 * different numbers of embers disagree about nothing that matters.
 */
export type ParticleKind = "spark" | "ember" | "smoke" | "dust" | "debris" | "shimmer";

/**
 * Whether a request tells the player something (R16).
 *
 * `informative` — hit sparks, the death burst, ram debris, the respawn shimmer: the player learns
 * what happened from these, and losing them to a busy frame is losing information.
 * `cosmetic` — exhaust, embers, tyre dust: pure texture, and the first thing to go.
 */
export type ParticlePriority = "informative" | "cosmetic";

export interface ParticleDef {
  readonly kind: ParticleKind;
  readonly frame: string;
  readonly layer: Layer;
  readonly lifespanMs: number;
  /** Emission speed range, world units per second. */
  readonly speed: readonly [number, number];
  /** Scale from birth to death. */
  readonly scale: readonly [number, number];
  /** Alpha from birth to death. */
  readonly alpha: readonly [number, number];
  /** This emitter's own hard cap, so one kind cannot eat the whole global budget. */
  readonly maxParticles: number;
  readonly tint?: number;
}

export const PARTICLE_DEFS: Readonly<Record<ParticleKind, ParticleDef>> = {
  /** Impact. Fast, short, additive, and the most informative thing in the list. */
  spark:   { kind: "spark",   frame: "baked.fx.spark",   layer: Layer.Glow,     lifespanMs: 280,  speed: [140, 340], scale: [0.9, 0], alpha: [1, 0],    maxParticles: 160 },
  /** Fire shedding off a flame. `afterburner`'s AUTHORED embers are baked into its flipbook (V3);
   *  these are the extra ones §5's catalogue asks for, and they are cosmetic. */
  ember:   { kind: "ember",   frame: "baked.fx.ember",   layer: Layer.Glow,     lifespanMs: 700,  speed: [30, 90],   scale: [0.7, 0], alpha: [0.9, 0],  maxParticles: 120 },
  /** Death and explosions. Slow, large, normal-blended so it reads as mass rather than light. */
  smoke:   { kind: "smoke",   frame: "baked.fx.smoke",   layer: Layer.OverlayFx, lifespanMs: 1200, speed: [10, 50],   scale: [0.6, 1.6], alpha: [0.5, 0], maxParticles: 96 },
  /** Under the cars: tyre dust, a zone's ground haze. */
  dust:    { kind: "dust",    frame: "baked.fx.dust",    layer: Layer.GroundFx, lifespanMs: 900,  speed: [15, 60],   scale: [0.5, 1.3], alpha: [0.35, 0], maxParticles: 96 },
  /** Ram, slam, death: chunks. Rotates, falls to nothing. */
  debris:  { kind: "debris",  frame: "baked.fx.debris",  layer: Layer.GroundFx, lifespanMs: 800,  speed: [90, 260],  scale: [1, 0.4], alpha: [1, 0],    maxParticles: 96 },
  /** Respawn: a ring of light coming in. The one kind that is emitted in a circle. */
  shimmer: { kind: "shimmer", frame: "baked.fx.shimmer", layer: Layer.OverlayFx, lifespanMs: 600,  speed: [-120, -40], scale: [0.4, 0], alpha: [0.8, 0], maxParticles: 64 },
};

export const PARTICLE_CONFIG = {
  /**
   * Live particles allowed at once, per tier (spec R21). The service enforces it; no caller checks.
   */
  caps: { low: 96, medium: 256, high: 512 } as Readonly<Record<BakeTier, number>>,
  /**
   * How far an `informative` request may push past the cap. A quarter, and no more: a firefight
   * busy enough to fill the budget with exhaust is exactly when a player most needs to see a hit,
   * but a ceiling that can be exceeded without limit is not a ceiling.
   */
  informativeHeadroom: 1.25,
} as const;
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/client/src/render/particles.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { PARTICLE_CONFIG, PARTICLE_DEFS, type ParticleDef } from "../config/particles.js";
import { ParticleService, type ParticleEmitterLike } from "./particles.js";

/** A stub emitter: it counts what it was asked to emit and ages nothing. */
function stubEmitters() {
  const made: { def: ParticleDef; emitter: StubEmitter }[] = [];
  class StubEmitter implements ParticleEmitterLike {
    alive = 0;
    quantity = 0;
    running = false;
    emitParticleAt(_x: number, _y: number, count: number) { this.alive += count; return this; }
    getAliveParticleCount() { return this.alive; }
    stop() { this.running = false; return this; }
    start() { this.running = true; return this; }
    setQuantity(q: number) { this.quantity = q; return this; }
    destroy() { this.alive = 0; }
  }
  return {
    made,
    make: (def: ParticleDef) => {
      const emitter = new StubEmitter();
      made.push({ def, emitter });
      return emitter;
    },
    of: (kind: string) => made.find((m) => m.def.kind === kind)!.emitter,
  };
}

describe("ParticleService", () => {
  let stubs: ReturnType<typeof stubEmitters>;
  let service: ParticleService;

  beforeEach(() => {
    stubs = stubEmitters();
    service = new ParticleService(stubs.make, "medium");
  });

  it("makes one emitter per kind, once, at construction", () => {
    expect(stubs.made).toHaveLength(Object.keys(PARTICLE_DEFS).length);
    service.burst("spark", 0, 0, 4, "informative");
    expect(stubs.made).toHaveLength(Object.keys(PARTICLE_DEFS).length);
  });

  it("takes its cap from the tier", () => {
    expect(service.cap).toBe(PARTICLE_CONFIG.caps.medium);
    expect(new ParticleService(stubEmitters().make, "low").cap).toBe(PARTICLE_CONFIG.caps.low);
    expect(new ParticleService(stubEmitters().make, "high").cap).toBe(PARTICLE_CONFIG.caps.high);
  });

  it("admits a burst that fits, and reports what it emitted", () => {
    expect(service.burst("spark", 10, 20, 8, "informative")).toBe(8);
    expect(stubs.of("spark").alive).toBe(8);
    service.update(16);
    expect(service.live).toBe(8);
  });

  it("refuses a cosmetic burst once the cap is full, and counts the refusal", () => {
    service.burst("spark", 0, 0, PARTICLE_CONFIG.caps.medium, "informative");
    service.update(16);
    expect(service.burst("ember", 0, 0, 10, "cosmetic")).toBe(0);
    expect(service.refused).toBe(1);
    expect(stubs.of("ember").alive).toBe(0);
  });

  it("lets an informative burst into the headroom, and not past it", () => {
    const cap = PARTICLE_CONFIG.caps.medium;
    const ceiling = Math.floor(cap * PARTICLE_CONFIG.informativeHeadroom);
    service.burst("smoke", 0, 0, cap, "informative");
    service.update(16);
    const got = service.burst("spark", 0, 0, 999, "informative");
    service.update(16);
    expect(got).toBe(ceiling - cap);
    expect(service.live).toBe(ceiling);
    expect(service.burst("spark", 0, 0, 4, "informative")).toBe(0);
  });

  it("never lets one kind eat the whole budget", () => {
    const def = PARTICLE_DEFS.shimmer;
    expect(service.burst("shimmer", 0, 0, def.maxParticles * 4, "informative")).toBe(def.maxParticles);
  });

  it("streams by rate and stops when the rate is zero", () => {
    service.stream("dust", { x: 5, y: 5 }, 20);
    service.update(1000);
    expect(stubs.of("dust").alive).toBe(20);
    service.stream("dust", { x: 5, y: 5 }, 0);
    service.update(1000);
    expect(stubs.of("dust").alive).toBe(20);
  });

  it("re-caps on a tier change without rebuilding anything", () => {
    service.setCap(PARTICLE_CONFIG.caps.low);
    expect(service.cap).toBe(PARTICLE_CONFIG.caps.low);
    expect(stubs.made).toHaveLength(Object.keys(PARTICLE_DEFS).length);
  });

  it("is empty after a clear, which is what a match start gets", () => {
    service.burst("spark", 0, 0, 8, "informative");
    service.clear();
    service.update(16);
    expect(service.live).toBe(0);
    expect(service.refused).toBe(0);
  });
});
```

- [ ] **Step 3: Write `render/particles.ts`**

```ts
// packages/client/src/render/particles.ts
import type Phaser from "phaser";
import { PARTICLE_CONFIG, PARTICLE_DEFS, type ParticleDef, type ParticleKind, type ParticlePriority } from "../config/particles.js";
import { BAKED_ATLAS } from "./atlas.js";
import { BAKE_DEFAULT_TIER, bakedFrame, type BakeTier } from "./bake.js";
import { LAYER_BLEND, depthOf } from "./layers.js";

/**
 * Transients are particles (spec R5), and the budget is the service's (R16).
 *
 * **One emitter per kind, created once and reused for the life of the scene.** Nothing is
 * constructed on an event: `burst` is one `emitParticleAt` call and `stream` is a quantity change,
 * so the frame path allocates nothing (R6). Today's impact spark — a `Graphics` circle and a tween
 * per hit — is exactly what this replaces, and Task 5 deletes it.
 *
 * **The cap is enforced here.** Callers pass a priority and check nothing, because a caller that
 * checks is a caller that will forget: the death burst and the exhaust stream are written in
 * different files by people asking different questions, and only this class can see both.
 *
 * The emitter factory is injected so the whole budget is unit-testable in node. `makePhaserEmitter`
 * is the one production implementation, and it is three lines.
 */
export interface ParticleEmitterLike {
  emitParticleAt(x: number, y: number, count: number): unknown;
  getAliveParticleCount(): number;
  stop(): unknown;
  start(): unknown;
  setQuantity(q: number): unknown;
  destroy(): void;
}

interface Stream {
  follow: { x: number; y: number };
  /** Particles per second. 0 is off. */
  rate: number;
  /** Fractional particles carried between frames, so a slow stream still emits. */
  debt: number;
}

export class ParticleService {
  private readonly emitters = new Map<ParticleKind, ParticleEmitterLike>();
  private readonly streams = new Map<ParticleKind, Stream>();
  private liveCount = 0;
  private refusedCount = 0;
  private capacity: number;

  constructor(
    make: (def: ParticleDef) => ParticleEmitterLike,
    tier: BakeTier = BAKE_DEFAULT_TIER,
  ) {
    this.capacity = PARTICLE_CONFIG.caps[tier];
    for (const def of Object.values(PARTICLE_DEFS)) this.emitters.set(def.kind, make(def));
  }

  /**
   * Emit `count` particles at a point. Returns how many actually went out, which is 0 for a refused
   * request — the return value exists for the counters and for tests, and no production caller
   * reads it.
   */
  burst(kind: ParticleKind, x: number, y: number, count: number, priority: ParticlePriority): number {
    const emitter = this.emitters.get(kind);
    const def = PARTICLE_DEFS[kind];
    if (!emitter || count <= 0) return 0;

    // Each kind's own ceiling first, so one burst cannot spend the whole global budget.
    let allowed = Math.min(count, def.maxParticles);
    const room = this.capacity - this.liveCount;
    if (allowed > room) {
      if (priority === "cosmetic") {
        this.refusedCount += 1;
        return 0;
      }
      const ceiling = Math.floor(this.capacity * PARTICLE_CONFIG.informativeHeadroom);
      allowed = Math.min(allowed, ceiling - this.liveCount);
      if (allowed <= 0) {
        this.refusedCount += 1;
        return 0;
      }
    }
    emitter.emitParticleAt(x, y, allowed);
    this.liveCount += allowed;
    return allowed;
  }

  /**
   * Follow a moving point at `rate` particles a second. Calling it again with the same kind
   * replaces the stream; calling it with `rate` 0 stops it.
   *
   * `follow` is held by reference on purpose: the caller updates a pose it already owns, and this
   * reads it — which is what keeps a per-frame stream from allocating a point.
   */
  stream(kind: ParticleKind, follow: { x: number; y: number }, rate: number): void {
    if (rate <= 0) {
      this.streams.delete(kind);
      return;
    }
    const existing = this.streams.get(kind);
    if (existing) {
      existing.follow = follow;
      existing.rate = rate;
      return;
    }
    this.streams.set(kind, { follow, rate, debt: 0 });
  }

  setCap(n: number): void {
    this.capacity = Math.max(0, n);
  }

  /**
   * Per frame: run the streams, then re-read the truth from the emitters.
   *
   * `liveCount` is incremented optimistically by `burst` so a burst inside one frame cannot exceed
   * the cap by itself, and corrected here from the emitters, which are the only things that know
   * what has died. Both are needed: the optimistic count is what makes the cap tight within a
   * frame, and the correction is what stops it drifting upward forever.
   */
  update(deltaMs: number): void {
    for (const [kind, stream] of this.streams) {
      stream.debt += (stream.rate * deltaMs) / 1000;
      const whole = Math.floor(stream.debt);
      if (whole > 0) {
        stream.debt -= whole;
        this.burst(kind, stream.follow.x, stream.follow.y, whole, "cosmetic");
      }
    }
    let live = 0;
    for (const emitter of this.emitters.values()) live += emitter.getAliveParticleCount();
    this.liveCount = live;
  }

  get live(): number {
    return this.liveCount;
  }

  get cap(): number {
    return this.capacity;
  }

  get refused(): number {
    return this.refusedCount;
  }

  /** Match start: no particle survives into a new match. */
  clear(): void {
    this.streams.clear();
    this.refusedCount = 0;
    this.liveCount = 0;
    for (const emitter of this.emitters.values()) {
      emitter.stop();
      emitter.start();
    }
  }

  destroy(): void {
    for (const emitter of this.emitters.values()) emitter.destroy();
    this.emitters.clear();
    this.streams.clear();
  }
}

/**
 * The one production factory. Each emitter is born on its `baked.fx.*` frame so it joins the baked
 * atlas's batch from its first particle, and takes its blend from its layer rather than setting one
 * (R4) — which is why `spark` and `ember` are on `Layer.Glow` rather than carrying ADD themselves.
 */
export function makePhaserEmitter(scene: Phaser.Scene): (def: ParticleDef) => ParticleEmitterLike {
  return (def) => {
    const [key, frame] = bakedFrame(def.frame);
    const emitter = scene.add.particles(0, 0, key, {
      frame,
      lifespan: def.lifespanMs,
      speed: { min: def.speed[0], max: def.speed[1] },
      scale: { start: def.scale[0], end: def.scale[1] },
      alpha: { start: def.alpha[0], end: def.alpha[1] },
      maxParticles: def.maxParticles,
      emitting: false,
      ...(def.tint === undefined ? {} : { tint: def.tint }),
    });
    emitter.setDepth(depthOf(def.layer));
    emitter.setBlendMode(LAYER_BLEND[def.layer]);
    return emitter as unknown as ParticleEmitterLike;
  };
}
```

`BAKED_ATLAS` is imported for the doc comment's claim and may be dropped if the compiler reports it unused; `bakedFrame` already resolves to that texture.

- [ ] **Step 4: The six particle frames, baked**

`render/bake.ts` gains a fourth job list — the same shape V3's `beamBakeJobs` has, and `bakeJobs` becomes a four-way concatenation:

```ts
export function bakeJobs(ss: number, pill: PillHeights, tier: BakeTier = BAKE_DEFAULT_TIER): BakeJob[] {
  return [...hudBakeJobs(ss, pill), ...worldBakeJobs(ss), ...beamBakeJobs(ss, tier), ...fxBakeJobs(ss, tier)];
}
```

```ts
/** Particle frames, status flipbooks, the car shadow and the muzzle flash (spec §5's V4 rows). */
export function fxBakeJobs(ss: number, tier: BakeTier): BakeJob[] {
  const jobs: BakeJob[] = [];
  const pad = BAKE_WORLD_PAD_PX;

  // Every particle frame is WHITE and tinted at emit time, so one 16-unit disc serves a spark, an
  // ember and a shimmer at three colours and three sizes. The exception is `debris`, which is a
  // shard rather than a dot and cannot be a scaled circle.
  const dot = Math.ceil(8 * ss);
  for (const name of ["spark", "ember", "shimmer"] as const) {
    jobs.push({
      name: `baked.fx.${name}`,
      width: dot * 2 + pad * 2,
      height: dot * 2 + pad * 2,
      pad,
      draw: (gfx) => radialFalloff(gfx, dot, dot, dot, 0xffffff, 1, 8),
    });
  }
  const puff = Math.ceil(20 * ss);
  for (const name of ["smoke", "dust"] as const) {
    jobs.push({
      name: `baked.fx.${name}`,
      width: puff * 2 + pad * 2,
      height: puff * 2 + pad * 2,
      pad,
      // Softer and wider than a spark: a puff has no core.
      draw: (gfx) => radialFalloff(gfx, puff, puff, puff, 0xffffff, 0.85, 16),
    });
  }
  const shard = Math.ceil(6 * ss);
  jobs.push({
    name: "baked.fx.debris",
    width: shard * 2 + pad * 2,
    height: shard + pad * 2,
    pad,
    draw(gfx) {
      gfx.fillStyle(0xffffff, 1);
      gfx.fillRect(0, 0, shard * 2, shard);
    },
  });

  jobs.push(...shadowBakeJob(ss, pad), ...muzzleBakeJobs(ss, pad), ...statusBakeJobs(ss, pad, tier));
  return jobs;
}
```

`radialFalloff` is V3's helper, already in this file. `shadowBakeJob`, `muzzleBakeJobs` and `statusBakeJobs` are Task 4's and are written there; declare them in Task 4 and land the whole of `fxBakeJobs` in that task's commit if it is easier — the packing test is what holds either order honest.

One case appended to `bake.test.ts`:

```ts
  it("bakes a frame for every particle kind", () => {
    const names = fxBakeJobs(2, "medium").map((job) => job.name);
    for (const def of Object.values(PARTICLE_DEFS)) expect(names).toContain(def.frame);
  });
```

- [ ] **Step 5: Run and commit**

Run: `cd packages/client && npx vitest run src/render/particles.test.ts src/render/bake.test.ts && npm run typecheck`

```bash
git add packages/client/src/config/particles.ts packages/client/src/render/particles.ts packages/client/src/render/particles.test.ts packages/client/src/render/bake.ts packages/client/src/render/bake.test.ts
git commit -m "feat(client): a particle service with a per-tier budget it enforces itself (R5, R16)"
```

---
### Task 2: The decal mechanism, with no decals (R12a)

**Files:**
- Create: `packages/client/src/config/decals.ts`, `packages/client/src/render/decals.ts`, `packages/client/src/render/decals.test.ts`

**Interfaces:**
- Consumes: V2's `SpritePool`, `PoolSprite`, `Layer`, `depthOf`, `worldSprite`; `BakeTier`.
- Produces (the ledger's `render/decals.ts` row):

```ts
// config/decals.ts
export interface DecalDef {
  readonly id: string;
  /** An atlas frame name. Nothing names one yet, because nothing is authored. */
  readonly frame: string;
  readonly widthUnits: number;
  readonly heightUnits: number;
  /** Overrides `DECAL_CONFIG.fadeMs` for this decal alone. */
  readonly fadeMs?: number;
  readonly holdMs?: number;
}
export const DECAL_CONFIG: {
  readonly holdMs: number;
  readonly fadeMs: number;
  readonly maxLive: Readonly<Record<BakeTier, number>>;   // 16 / 48 / 96 (spec R21)
};
/** **Empty, deliberately (R12a).** Authoring the first decal is a row here and an atlas frame. */
export const DECAL_DEFS: readonly DecalDef[] = [];

// render/decals.ts
export interface DecalSprite extends PoolSprite {
  setPosition(x: number, y: number): unknown;
  setRotation(r: number): unknown;
  setDisplaySize(w: number, h: number): unknown;
  setAlpha(a: number): unknown;
  setTexture(key: string, frame?: string): unknown;
}
export class DecalService {
  constructor(make: () => DecalSprite, tier?: BakeTier);
  place(def: DecalDef, x: number, y: number, angle: number): boolean;
  /** Per frame. Ages every live decal and returns whatever expired to the pool. */
  update(deltaMs: number): void;
  setCap(n: number): void;
  clear(): void;
  destroy(): void;
  readonly live: number;
  readonly cap: number;
}
export function makeDecalSprite(scene: Phaser.Scene): () => DecalSprite;
```

#### Why a mechanism with nothing in it is the deliverable

The rendering spec's §12 resolved this on 2026-09-04 and R12a states it: *"decals fade after a few seconds, the time from a global config overridable per decal, and none is authored now; only the mechanism ships"*. The V4 row's acceptance says the same thing a third way: **"decal service empty and tested"**.

So this task ships a pool, a timer, a cap and a test, and `DECAL_DEFS.length === 0` is one of the assertions. That is not a placeholder — it is the decision. Three §5 rows name a decal (a scorch on death, a skid on a ram, a blast ring on an explosion) and all three are candidates; the sentence under the catalogue says so. **Authoring one is out of scope for this plan**, and `EffectRouter` (Task 3) therefore calls `place` from nowhere. The service is still built, still capped, still tested, and still wired into `ArenaScene`'s update, because a mechanism that is not run is a mechanism that does not work.

Why per-sprite rather than one stamped texture, which is the cheaper classic: *because each decal fades on its own clock*, and a stamped texture cannot un-stamp one mark. R12a says so, and the cost is one batched quad per live decal against a hard cap — 96 at the top tier, on the layer directly above the floor.

- [ ] **Step 1: `config/decals.ts`**

```ts
// packages/client/src/config/decals.ts
import type { BakeTier } from "../render/bake.js";

/**
 * One kind of mark on the ground (spec R12a). **No definition ships**; this type exists so the
 * first one is a table row rather than a code change.
 */
export interface DecalDef {
  readonly id: string;
  readonly frame: string;
  readonly widthUnits: number;
  readonly heightUnits: number;
  /** This decal's own fade, if it wants one. Absent takes `DECAL_CONFIG.fadeMs`. */
  readonly fadeMs?: number;
  readonly holdMs?: number;
}

export const DECAL_CONFIG = {
  /** Full alpha for this long before the fade starts. */
  holdMs: 1200,
  /** Then linearly to zero over this. "A few seconds" (R12a) is 1.2 + 2.8. */
  fadeMs: 2800,
  /**
   * Live decals allowed at once, per tier (spec R21). The oldest is recycled first, so a busy
   * floor loses its history rather than its newest mark.
   */
  maxLive: { low: 16, medium: 48, high: 96 } as Readonly<Record<BakeTier, number>>,
} as const;

/**
 * **Empty on purpose (R12a), and `decals.test.ts` asserts it.**
 *
 * The rendering spec's §5 names three candidates — a scorch where a car died, a skid where one was
 * rammed, a blast ring under an explosion — and its own sentence under the catalogue says every one
 * of them is "a candidate for the mechanism in R12a, not a commitment". Authoring the first is a row
 * here plus an atlas frame plus one `DecalService.place` call; nothing else has to change, which is
 * the whole point of shipping the mechanism first.
 */
export const DECAL_DEFS: readonly DecalDef[] = [];
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/client/src/render/decals.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { DECAL_CONFIG, DECAL_DEFS, type DecalDef } from "../config/decals.js";
import { DecalService, type DecalSprite } from "./decals.js";

function stubSprites() {
  const made: StubSprite[] = [];
  class StubSprite implements DecalSprite {
    visible = false;
    alpha = 1;
    x = 0;
    y = 0;
    rotation = 0;
    destroyed = false;
    setVisible(v: boolean) { this.visible = v; return this; }
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
    setRotation(r: number) { this.rotation = r; return this; }
    setDisplaySize() { return this; }
    setAlpha(a: number) { this.alpha = a; return this; }
    setTexture() { return this; }
    destroy() { this.destroyed = true; }
  }
  return { made, make: () => { const s = new StubSprite(); made.push(s); return s; } };
}

const SCORCH: DecalDef = { id: "test-scorch", frame: "baked.fx.smoke", widthUnits: 40, heightUnits: 40 };

describe("DECAL_DEFS", () => {
  it("is empty — the mechanism ships without decals (R12a)", () => {
    expect(DECAL_DEFS).toEqual([]);
  });
});

describe("DecalService", () => {
  let stubs: ReturnType<typeof stubSprites>;
  let decals: DecalService;

  beforeEach(() => {
    stubs = stubSprites();
    decals = new DecalService(stubs.make, "medium");
  });

  it("takes its cap from the tier", () => {
    expect(decals.cap).toBe(DECAL_CONFIG.maxLive.medium);
    expect(new DecalService(stubSprites().make, "low").cap).toBe(DECAL_CONFIG.maxLive.low);
  });

  it("places one and holds it at full alpha through holdMs", () => {
    expect(decals.place(SCORCH, 100, 200, 0.5)).toBe(true);
    expect(decals.live).toBe(1);
    expect(stubs.made[0]!.x).toBe(100);
    expect(stubs.made[0]!.rotation).toBe(0.5);
    decals.update(DECAL_CONFIG.holdMs - 1);
    expect(stubs.made[0]!.alpha).toBe(1);
  });

  it("fades linearly and returns to the pool at the end", () => {
    decals.place(SCORCH, 0, 0, 0);
    decals.update(DECAL_CONFIG.holdMs);
    decals.update(DECAL_CONFIG.fadeMs / 2);
    expect(stubs.made[0]!.alpha).toBeCloseTo(0.5, 3);
    decals.update(DECAL_CONFIG.fadeMs / 2 + 1);
    expect(decals.live).toBe(0);
    expect(stubs.made[0]!.visible).toBe(false);
    expect(stubs.made[0]!.destroyed).toBe(false);   // pooled, not destroyed
  });

  it("honours a per-decal fade override", () => {
    const quick: DecalDef = { ...SCORCH, holdMs: 0, fadeMs: 100 };
    decals.place(quick, 0, 0, 0);
    decals.update(50);
    expect(stubs.made[0]!.alpha).toBeCloseTo(0.5, 3);
    decals.update(51);
    expect(decals.live).toBe(0);
  });

  it("recycles the oldest when the cap is reached, and never grows past it", () => {
    for (let i = 0; i < DECAL_CONFIG.maxLive.medium; i++) {
      decals.place(SCORCH, i, 0, 0);
      decals.update(1);
    }
    expect(decals.live).toBe(DECAL_CONFIG.maxLive.medium);
    decals.place(SCORCH, 999, 0, 0);
    expect(decals.live).toBe(DECAL_CONFIG.maxLive.medium);
    expect(stubs.made).toHaveLength(DECAL_CONFIG.maxLive.medium);
    // The oldest sprite was reused rather than a new one made.
    expect(stubs.made.some((s) => s.x === 999)).toBe(true);
    expect(stubs.made.some((s) => s.x === 0)).toBe(false);
  });

  it("is empty after a clear, which is what a match start gets", () => {
    decals.place(SCORCH, 0, 0, 0);
    decals.clear();
    expect(decals.live).toBe(0);
    expect(stubs.made[0]!.visible).toBe(false);
  });
});
```

- [ ] **Step 3: Write `render/decals.ts`**

```ts
// packages/client/src/render/decals.ts
import type Phaser from "phaser";
import { DECAL_CONFIG, type DecalDef } from "../config/decals.js";
import { BAKED_ATLAS } from "./atlas.js";
import { BAKE_DEFAULT_TIER, bakedFrame, type BakeTier } from "./bake.js";
import { Layer, worldSprite } from "./layers.js";
import type { PoolSprite } from "./sprite-pool.js";

/**
 * Marks on the ground that fade on their own clocks (spec R12a).
 *
 * **The mechanism ships and no decal does.** `DECAL_DEFS` is empty, `EffectRouter` calls `place`
 * from nowhere, and `decals.test.ts` asserts both — that is the decision §12 recorded on
 * 2026-09-04, not a gap. What ships is a pool, a hold-then-fade timer with a per-decal override, a
 * per-tier cap that recycles the oldest, and the wiring, so authoring the first decal is a table
 * row and an atlas frame.
 *
 * Why a sprite each rather than one stamped `DynamicTexture`, which is cheaper: **because each
 * decal fades on its own clock**, and a stamp cannot un-stamp one mark. The cost is one batched
 * quad per live decal, bounded by the cap, on the layer directly above the floor.
 *
 * The sprite factory is injected so the timing and the cap are testable in node without Phaser.
 */
export interface DecalSprite extends PoolSprite {
  setPosition(x: number, y: number): unknown;
  setRotation(r: number): unknown;
  setDisplaySize(w: number, h: number): unknown;
  setAlpha(a: number): unknown;
  setTexture(key: string, frame?: string): unknown;
}

interface Live {
  sprite: DecalSprite;
  ageMs: number;
  holdMs: number;
  fadeMs: number;
}

export class DecalService {
  /** Oldest first, so the head is what a full pool recycles. */
  private readonly live: Live[] = [];
  private readonly free: DecalSprite[] = [];
  private capacity: number;

  constructor(
    private readonly make: () => DecalSprite,
    tier: BakeTier = BAKE_DEFAULT_TIER,
  ) {
    this.capacity = DECAL_CONFIG.maxLive[tier];
  }

  /**
   * Put a mark down. Returns false only when the cap is 0 — otherwise the oldest is recycled, which
   * is the right answer for a floor: a player reads the newest marks, and the history is what they
   * can afford to lose.
   */
  place(def: DecalDef, x: number, y: number, angle: number): boolean {
    if (this.capacity <= 0) return false;
    const sprite = this.take();
    if (!sprite) return false;
    const [key, frame] = bakedFrame(def.frame);
    sprite.setTexture(key, frame);
    sprite.setPosition(x, y);
    sprite.setRotation(angle);
    sprite.setDisplaySize(def.widthUnits, def.heightUnits);
    sprite.setAlpha(1);
    sprite.setVisible(true);
    this.live.push({
      sprite,
      ageMs: 0,
      holdMs: def.holdMs ?? DECAL_CONFIG.holdMs,
      fadeMs: def.fadeMs ?? DECAL_CONFIG.fadeMs,
    });
    return true;
  }

  /** Age everything. Walks a bounded array and allocates nothing (R6). */
  update(deltaMs: number): void {
    if (deltaMs <= 0 || this.live.length === 0) return;
    let write = 0;
    for (let read = 0; read < this.live.length; read++) {
      const entry = this.live[read]!;
      entry.ageMs += deltaMs;
      const into = entry.ageMs - entry.holdMs;
      if (into >= entry.fadeMs) {
        entry.sprite.setVisible(false);
        this.free.push(entry.sprite);
        continue;
      }
      entry.sprite.setAlpha(into <= 0 ? 1 : 1 - into / entry.fadeMs);
      this.live[write++] = entry;
    }
    this.live.length = write;
  }

  setCap(n: number): void {
    this.capacity = Math.max(0, n);
    while (this.live.length > this.capacity) this.recycleOldest();
  }

  get cap(): number {
    return this.capacity;
  }

  get liveCount(): number {
    return this.live.length;
  }

  clear(): void {
    for (const entry of this.live) {
      entry.sprite.setVisible(false);
      this.free.push(entry.sprite);
    }
    this.live.length = 0;
  }

  destroy(): void {
    for (const entry of this.live) entry.sprite.destroy();
    for (const sprite of this.free) sprite.destroy();
    this.live.length = 0;
    this.free.length = 0;
  }

  private take(): DecalSprite | undefined {
    if (this.live.length >= this.capacity) this.recycleOldest();
    return this.free.pop() ?? this.make();
  }

  private recycleOldest(): void {
    const oldest = this.live.shift();
    if (!oldest) return;
    oldest.sprite.setVisible(false);
    this.free.push(oldest.sprite);
  }
}

/** The one production factory: a sprite on the Decals band, born invisible. */
export function makeDecalSprite(scene: Phaser.Scene): () => DecalSprite {
  return () => worldSprite(scene, Layer.Decals, 0, BAKED_ATLAS) as unknown as DecalSprite;
}
```

`live` is a private array and `liveCount` is the public reading; the ledger's row names `place` and nothing else, and the test reads `decals.live` — **so expose `get live(): number` and rename the array to `entries`.** Do that when typing it in; the tests above are written against the public name.

- [ ] **Step 4: Run and commit**

Run: `cd packages/client && npx vitest run src/render/decals.test.ts && npm run typecheck`

```bash
git add packages/client/src/config/decals.ts packages/client/src/render/decals.ts packages/client/src/render/decals.test.ts
git commit -m "feat(client): the decal mechanism, with no decals authored (R12a)"
```

---

### Task 3: `EffectRouter` — every event kind drives an effect (R9, R18)

**Files:**
- Create: `packages/client/src/render/feedback-table.ts`, `packages/client/src/render/effects.ts`, `packages/client/src/render/effects.test.ts`

**Interfaces:**
- Consumes: `MatchEvent` (shared `net/events.ts`, N23a); Task 1's `ParticleService`; Task 2's `DecalService`; `weaponFillOf`; `COMBAT_CONFIG.hpPerRating` for the damage scale.
- Produces (the ledger's `render/effects.ts` row, plus the table R18 names):

```ts
// render/feedback-table.ts
export interface CameraPunch { shakeMs: number; shakeIntensity: number; zoom: number; zoomMs: number }
export interface BurstSpec { kind: ParticleKind; count: number; priority: ParticlePriority }
export interface FeedbackSpec {
  readonly bursts: readonly BurstSpec[];
  readonly punch?: CameraPunch;
  /** Scales `count` and `shakeIntensity` by the event's own magnitude, 0..1. */
  readonly scaleByMagnitude: boolean;
}
export const FEEDBACK_TABLE: Readonly<Record<MatchEvent["kind"], FeedbackSpec>>;
/** 0..1 for the one number each kind carries: damage, severity, or nothing. */
export function eventMagnitude(event: MatchEvent): number;

// render/effects.ts
export interface EffectCamera {
  shake(durationMs: number, intensity: number): unknown;
  readonly zoom: number;
  punchZoom(to: number, durationMs: number): void;
}
export class EffectRouter {
  constructor(particles: ParticleService, decals: DecalService, camera: EffectCamera, opts?: { isLocal?: (sessionId: string) => boolean });
  onEvents(events: readonly MatchEvent[]): void;
  /** Which kinds fired since the last read, for the bench census. Cleared by reading it. */
  drainSeen(): Record<MatchEvent["kind"], number>;
}
export function makeEffectCamera(scene: Phaser.Scene): EffectCamera;
```

#### The table, and what each kind does

R18: *"`cameras.main.shake` and a 60 ms zoom punch on a kill are native, cost nothing, and are driven by events with magnitudes from a small table (`render/feedback-table.ts`), not from local detection."* R9: an effect a player reads is *"seeded from `(instance id, tick)` or comes from a server event"* — everything here is the second, which is the stronger of the two.

| Event | Bursts | Camera | Magnitude |
|---|---|---|---|
| `hit` | 10 `spark`, informative, at `(x, y)` | shake 90 ms scaled by damage, **only when the local car is the victim** | `damage / hpPerRating`, clamped to 1 |
| `kill` | 18 `smoke` + 14 `debris`, informative, at the victim's pose | 60 ms zoom punch to 1.04 and a 160 ms shake | fixed |
| `ram` | 12 `debris` + 8 `dust`, informative, at `(x, y)` | shake 120 ms scaled by severity, only when the local car is in the pair | `severity` |
| `slam` | 20 `debris` + 12 `smoke`, informative, at `(x, y)` | shake 200 ms at full, only when the local car is the victim | fixed |
| `respawn` | 24 `shimmer`, informative, at the car's pose | none | fixed |
| `refused` | 6 `spark` at the car's muzzle, **cosmetic** | none | fixed |

Three rules the table encodes and the tests pin:

1. **Only the local player's camera shakes.** A kill across the arena punches the zoom for everyone, because a kill is a match event; a hit shakes only the car that took it, because a shake is a *feeling* about your own car and shaking on someone else's hit is the fastest way to make a game unreadable.
2. **`refused` is the one cosmetic entry.** It says "that press did nothing", which is information — but it fires on a press the player already knows failed, and it must never be the thing that pushes a hit spark out of the budget.
3. **The router places no decal.** `DecalService` is constructed, updated and capped, and `place` is called from nowhere (R12a). The test asserts that, so the day a decal is authored, the assertion is what has to be deliberately changed.

**`hit` events carry no attacker-side effect**, deliberately: the shooter learns they hit from the victim's hp bar flashing (netcode N25, landed in that stream's phase 4) and from the hit marker the HUD draws. Adding a second, spatial effect at the victim's position for the shooter as well would double every impact on screen in a duel.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/render/effects.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMBAT_CONFIG, type MatchEvent } from "@motor-combat-moba/shared";
import { DECAL_DEFS } from "../config/decals.js";
import { FEEDBACK_TABLE, eventMagnitude } from "./feedback-table.js";
import { EffectRouter, type EffectCamera } from "./effects.js";

function harness() {
  const bursts: { kind: string; x: number; y: number; count: number; priority: string }[] = [];
  const particles = {
    burst: (kind: string, x: number, y: number, count: number, priority: string) => {
      bursts.push({ kind, x, y, count, priority });
      return count;
    },
    stream: vi.fn(),
  };
  const decals = { place: vi.fn() };
  const camera: EffectCamera = { shake: vi.fn(), zoom: 1, punchZoom: vi.fn() };
  const router = new EffectRouter(
    particles as never, decals as never, camera,
    { isLocal: (sid) => sid === "me" },
  );
  return { bursts, decals, camera, router };
}

const hit = (over: Partial<Extract<MatchEvent, { kind: "hit" }>> = {}): MatchEvent => ({
  kind: "hit", tick: 100, attacker: "them", victim: "me",
  weaponId: "predator", x: 10, y: 20, damage: 45, ...over,
});

describe("FEEDBACK_TABLE", () => {
  it("has an entry for every event kind — the V4 acceptance line", () => {
    const kinds: MatchEvent["kind"][] = ["hit", "kill", "ram", "slam", "respawn", "refused"];
    for (const kind of kinds) {
      expect(FEEDBACK_TABLE[kind], `${kind} has no feedback`).toBeDefined();
      expect(FEEDBACK_TABLE[kind]!.bursts.length).toBeGreaterThan(0);
    }
  });

  it("scales a hit by its damage against a chassis's hp", () => {
    expect(eventMagnitude(hit({ damage: 0 }))).toBe(0);
    expect(eventMagnitude(hit({ damage: COMBAT_CONFIG.hpPerRating * 100 }))).toBe(1);
    expect(eventMagnitude(hit({ damage: 45 }))).toBeGreaterThan(0);
    expect(eventMagnitude(hit({ damage: 45 }))).toBeLessThan(1);
  });
});

describe("EffectRouter", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it("sparks at the server's point, not at anything the client derived", () => {
    h.router.onEvents([hit({ x: 640, y: 360 })]);
    const spark = h.bursts.find((b) => b.kind === "spark")!;
    expect(spark.x).toBe(640);
    expect(spark.y).toBe(360);
    expect(spark.priority).toBe("informative");
  });

  it("shakes for a hit on the local car and not for one on somebody else's", () => {
    h.router.onEvents([hit({ victim: "me" })]);
    expect(h.camera.shake).toHaveBeenCalledTimes(1);
    h.router.onEvents([hit({ victim: "them", attacker: "other" })]);
    expect(h.camera.shake).toHaveBeenCalledTimes(1);
  });

  it("punches the zoom on any kill, whoever it was", () => {
    h.router.onEvents([{ kind: "kill", tick: 1, killer: "other", victim: "another" }]);
    expect(h.camera.punchZoom).toHaveBeenCalledTimes(1);
  });

  it("scales a shake by severity for a ram the local car is in", () => {
    h.router.onEvents([{ kind: "ram", tick: 1, attacker: "me", victim: "them", x: 0, y: 0, severity: 0.2 }]);
    h.router.onEvents([{ kind: "ram", tick: 2, attacker: "them", victim: "me", x: 0, y: 0, severity: 0.9 }]);
    const [soft, hard] = (h.camera.shake as ReturnType<typeof vi.fn>).mock.calls;
    expect(hard![1]).toBeGreaterThan(soft![1]);
  });

  it("drives an effect for every kind, which is the acceptance line", () => {
    h.router.onEvents([
      hit(),
      { kind: "kill", tick: 1, killer: "me", victim: "them" },
      { kind: "ram", tick: 1, attacker: "me", victim: "them", x: 0, y: 0, severity: 0.5 },
      { kind: "slam", tick: 1, car: "me", x: 0, y: 0 },
      { kind: "respawn", tick: 1, car: "me" },
      { kind: "refused", tick: 1, car: "me", slot: 0 },
    ]);
    const seen = h.router.drainSeen();
    for (const kind of ["hit", "kill", "ram", "slam", "respawn", "refused"] as const) {
      expect(seen[kind], `${kind} drove nothing`).toBeGreaterThan(0);
    }
    expect(h.router.drainSeen().hit).toBe(0);   // draining clears
  });

  it("places no decal, because none is authored (R12a)", () => {
    h.router.onEvents([
      hit(),
      { kind: "kill", tick: 1, killer: "me", victim: "them" },
      { kind: "slam", tick: 1, car: "them", x: 0, y: 0 },
    ]);
    expect(h.decals.place).not.toHaveBeenCalled();
    expect(DECAL_DEFS).toEqual([]);
  });

  it("does nothing at all on an empty list", () => {
    h.router.onEvents([]);
    expect(h.bursts).toHaveLength(0);
    expect(h.camera.shake).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write `render/feedback-table.ts`**

```ts
// packages/client/src/render/feedback-table.ts
import { COMBAT_CONFIG, type MatchEvent } from "@motor-combat-moba/shared";
import type { ParticleKind, ParticlePriority } from "../config/particles.js";

/**
 * What each server event feels like (spec R18).
 *
 * A table rather than a switch, because the numbers are the design: a slam should shake harder than
 * a graze, a kill should punch the zoom and a refused press should barely register, and those are
 * comparisons somebody has to be able to read side by side. Nothing here is networked and nothing
 * is read by the sim.
 */
export interface CameraPunch {
  readonly shakeMs: number;
  /** Phaser's shake intensity: a fraction of the viewport, so 0.005 is subtle and 0.02 is violent. */
  readonly shakeIntensity: number;
  /** Multiplier on the camera's resting zoom. 1 is no punch. */
  readonly zoom: number;
  readonly zoomMs: number;
}

export interface BurstSpec {
  readonly kind: ParticleKind;
  readonly count: number;
  readonly priority: ParticlePriority;
}

export interface FeedbackSpec {
  readonly bursts: readonly BurstSpec[];
  readonly punch?: CameraPunch;
  /** Whether `count` and `shakeIntensity` are multiplied by `eventMagnitude`. */
  readonly scaleByMagnitude: boolean;
  /** Whether the camera reacts at all when the local car is not involved. */
  readonly cameraForEveryone: boolean;
}

export const FEEDBACK_TABLE: Readonly<Record<MatchEvent["kind"], FeedbackSpec>> = {
  hit: {
    bursts: [{ kind: "spark", count: 10, priority: "informative" }],
    punch: { shakeMs: 90, shakeIntensity: 0.006, zoom: 1, zoomMs: 0 },
    scaleByMagnitude: true,
    // A shake is a feeling about YOUR car. Shaking on someone else's hit is the fastest way to make
    // a six-player arena unreadable.
    cameraForEveryone: false,
  },
  kill: {
    bursts: [
      { kind: "smoke", count: 18, priority: "informative" },
      { kind: "debris", count: 14, priority: "informative" },
    ],
    // R18's "60 ms zoom punch on a kill", and a shake long enough to read as an ending.
    punch: { shakeMs: 160, shakeIntensity: 0.008, zoom: 1.04, zoomMs: 60 },
    scaleByMagnitude: false,
    // A kill is a match event, not a personal one: everyone's camera acknowledges it.
    cameraForEveryone: true,
  },
  ram: {
    bursts: [
      { kind: "debris", count: 12, priority: "informative" },
      { kind: "dust", count: 8, priority: "informative" },
    ],
    punch: { shakeMs: 120, shakeIntensity: 0.010, zoom: 1, zoomMs: 0 },
    scaleByMagnitude: true,
    cameraForEveryone: false,
  },
  slam: {
    bursts: [
      { kind: "debris", count: 20, priority: "informative" },
      { kind: "smoke", count: 12, priority: "informative" },
    ],
    // The hardest hit in the game gets the hardest shake; a slam is severity 1 by construction.
    punch: { shakeMs: 200, shakeIntensity: 0.016, zoom: 1, zoomMs: 0 },
    scaleByMagnitude: false,
    cameraForEveryone: false,
  },
  respawn: {
    bursts: [{ kind: "shimmer", count: 24, priority: "informative" }],
    scaleByMagnitude: false,
    cameraForEveryone: false,
  },
  refused: {
    // The one cosmetic entry in the table. It says "that press did nothing", which the player
    // already half knows, and it must never be what pushes a hit spark out of the budget.
    bursts: [{ kind: "spark", count: 6, priority: "cosmetic" }],
    scaleByMagnitude: false,
    cameraForEveryone: false,
  },
};

/**
 * The one number an event carries, normalised to 0..1.
 *
 * `hit` uses damage against the biggest chassis's hp, so a 45-point graze and a 250-point slam
 * scale against the same yardstick rather than against each other. `ram` already carries a graded
 * severity. Everything else is a fixed-size occurrence and returns 1.
 */
export function eventMagnitude(event: MatchEvent): number {
  if (event.kind === "hit") {
    const fullHp = COMBAT_CONFIG.hpPerRating * 100;
    return Math.max(0, Math.min(1, event.damage / fullHp));
  }
  if (event.kind === "ram") return Math.max(0, Math.min(1, event.severity));
  return 1;
}
```

- [ ] **Step 3: Write `render/effects.ts`**

```ts
// packages/client/src/render/effects.ts
import type Phaser from "phaser";
import type { MatchEvent } from "@motor-combat-moba/shared";
import type { DecalService } from "./decals.js";
import type { ParticleService } from "./particles.js";
import { FEEDBACK_TABLE, eventMagnitude } from "./feedback-table.js";

/**
 * Server events in, effects out — and the **only** consumer of `RenderFrame.events`.
 *
 * This is what the rendering spec's §5 means by "on the server `hit` event" and what the netcode
 * spec's N23a means by "events are what the client's feedback layer consumes". A spark lands at the
 * server's contact point on the server's tick, which is what makes it right on every screen at once
 * — and it is what lets `scenes/impact-feedback.ts`, whose own doc comment documents that it
 * compares two timebases and "can spark on a near-miss or miss a real graze", be deleted (Task 5).
 *
 * **Determinism (R9), stated precisely.** The *event* is deterministic and shared: every client
 * gets the same kind, at the same tick, at the same point, with the same magnitude, so every client
 * agrees about what happened and where. The individual sparks inside a burst are ambience and use
 * the emitter's own RNG, which R9 explicitly allows ("pure ambience may use a free-running clock").
 * Nothing a player reads depends on which way a particular ember went.
 *
 * **It places no decal.** `DecalService` is held, so authoring one is a call added here and nothing
 * else, and `effects.test.ts` asserts the call does not exist yet (R12a).
 */
export interface EffectCamera {
  shake(durationMs: number, intensity: number): unknown;
  readonly zoom: number;
  punchZoom(to: number, durationMs: number): void;
}

type Kind = MatchEvent["kind"];

const ZERO_SEEN: Record<Kind, number> = { hit: 0, kill: 0, ram: 0, slam: 0, respawn: 0, refused: 0 };

export class EffectRouter {
  private readonly seen: Record<Kind, number> = { ...ZERO_SEEN };
  private readonly isLocal: (sessionId: string) => boolean;

  constructor(
    private readonly particles: ParticleService,
    private readonly decals: DecalService,
    private readonly camera: EffectCamera,
    opts?: { isLocal?: (sessionId: string) => boolean },
  ) {
    this.isLocal = opts?.isLocal ?? (() => false);
    void this.decals;   // held for R12a; nothing places a decal yet
  }

  /**
   * One frame's events. Allocation-free: a `for…of` over the caller's array, a table lookup and a
   * couple of numbers per event (R6).
   */
  onEvents(events: readonly MatchEvent[]): void {
    for (const event of events) {
      const spec = FEEDBACK_TABLE[event.kind];
      if (!spec) continue;
      this.seen[event.kind] += 1;

      const magnitude = spec.scaleByMagnitude ? eventMagnitude(event) : 1;
      const at = pointOf(event);
      for (const burst of spec.bursts) {
        const count = Math.max(1, Math.round(burst.count * magnitude));
        this.particles.burst(burst.kind, at.x, at.y, count, burst.priority);
      }

      const punch = spec.punch;
      if (!punch) continue;
      if (!spec.cameraForEveryone && !this.involvesLocal(event)) continue;
      if (punch.shakeMs > 0 && punch.shakeIntensity > 0) {
        this.camera.shake(punch.shakeMs, punch.shakeIntensity * magnitude);
      }
      if (punch.zoom !== 1 && punch.zoomMs > 0) {
        this.camera.punchZoom(this.camera.zoom * punch.zoom, punch.zoomMs);
      }
    }
  }

  /** The bench census reads this; reading clears it. */
  drainSeen(): Record<Kind, number> {
    const out = { ...this.seen };
    for (const kind of Object.keys(this.seen) as Kind[]) this.seen[kind] = 0;
    return out;
  }

  private involvesLocal(event: MatchEvent): boolean {
    switch (event.kind) {
      case "hit":
        // The VICTIM only: the shooter learns they hit from the hp bar's flash (netcode N25), and a
        // second spatial effect for them would double every impact on screen in a duel.
        return this.isLocal(event.victim);
      case "ram":
        return this.isLocal(event.attacker) || this.isLocal(event.victim);
      case "kill":
        return this.isLocal(event.killer) || this.isLocal(event.victim);
      case "slam":
      case "respawn":
      case "refused":
        return this.isLocal(event.car);
    }
  }
}

/**
 * Where an event happened. Four kinds carry a point; `kill`, `respawn` and `refused` do not, and
 * the caller supplies the car's drawn pose through `EffectRouter`'s frame wiring instead — until
 * then they burst at the origin, which is why `ArenaScene` resolves the pose before calling
 * (Task 5).
 */
function pointOf(event: MatchEvent): { x: number; y: number } {
  return "x" in event ? { x: event.x, y: event.y } : ORIGIN;
}

const ORIGIN = { x: 0, y: 0 };

/** The one production camera: Phaser's own shake, and a tween for the zoom punch. */
export function makeEffectCamera(scene: Phaser.Scene): EffectCamera {
  const camera = scene.cameras.main;
  const resting = camera.zoom;
  return {
    shake: (durationMs, intensity) => camera.shake(durationMs, intensity),
    get zoom() {
      return resting;
    },
    punchZoom(to, durationMs) {
      // Out fast and back over the same window — R18's "60 ms zoom punch", native and free.
      scene.tweens.add({
        targets: camera,
        zoom: to,
        duration: durationMs,
        yoyo: true,
        ease: "Quad.easeOut",
        onComplete: () => {
          camera.zoom = resting;
        },
      });
    },
  };
}
```

**`pointOf`'s three point-less kinds are the one loose end in this module**, and Task 5 closes it: `ArenaScene` resolves `kill`, `respawn` and `refused` to the named car's drawn pose before handing the list over, by rewriting those three events' coordinates into a reused scratch object. That is stated here rather than hidden because a burst at the origin is a visible bug and the reader should know where it is prevented.

- [ ] **Step 4: Run and commit**

Run: `cd packages/client && npx vitest run src/render/effects.test.ts && npm run typecheck`

```bash
git add packages/client/src/render/feedback-table.ts packages/client/src/render/effects.ts packages/client/src/render/effects.test.ts
git commit -m "feat(client): EffectRouter — every MatchEvent kind drives an effect from one table (R9, R18)"
```

---
### Task 4: Shadows, status flipbooks and the muzzle flash

**Files:**
- Modify: `packages/client/src/render/bake.ts`, `packages/client/src/render/bake.test.ts`, `packages/client/src/render/layers.ts`, `packages/client/src/scenes/arena/car-sprites.ts`, `packages/client/src/scenes/arena/car-renderer.ts`, `packages/client/src/scenes/arena/shot-renderer.ts`, `packages/client/src/scenes/arena/world-style.ts`
- Test: `packages/client/src/scenes/arena/status-badges.test.ts` (create)

**Interfaces:**
- Consumes: `STATUS_TABLE`, `isStatusId`, `msToTicks`, `TICK_RATE_HZ`; `statusFillOf` (`scenes/status-hud.ts`); V2's `CarDecor`, `SpritePool`, `CAR_BAND`, `worldSprite`, `HULL`; V3's `flameFrameIndex` (the same age-in-ticks rule); N4's `RenderCar.hpFlashUntilTick`.
- Produces:

```ts
// render/layers.ts — CAR_BAND gains two offsets
shadow: -2,          // under the body, still far above Layer.Shots at -100
status: 40,          // above the body, below the arrow at 52

// scenes/arena/world-style.ts
export const SHADOW_OFFSET_UNITS: { x: number; y: number };   // { x: 3, y: 5 }
export const SHADOW_ALPHA: number;                            // 0.28
export const STATUS_BADGE_UNITS: number;                      // 14
export const STATUS_BADGE_GAP_UNITS: number;                  // 3
export const HIT_FLASH_TINT: number;                          // 0xffffff
export const MUZZLE_FLASH_UNITS: number;                      // 26

// scenes/arena/status-badges.ts (create) — pure, node-tested
export interface CarBadge { statusId: string; frame: string; tint: number; offsetUnits: number }
export function carBadges(statuses: readonly StatusRow[], tick: number, out: CarBadge[]): number;
export function statusFlipbookFrames(statusId: string): number;

// render/bake.ts
export function bakedStatusFrame(statusId: string, index: number): string;   // `baked.fx.status.<id>.<n>`
export const BAKED_SHADOW: string;                                          // `baked.fx.shadow`
export function bakedMuzzleFrame(index: number): string;                    // `baked.fx.muzzle.<n>`
export const STATUS_FLIPBOOK_FRAMES: number;                                // 4
export const STATUS_TICKS_PER_FRAME: number;                                // 8
export const MUZZLE_FLASH_TICKS: number;                                    // 4

// scenes/arena/car-sprites.ts — on CarDecor
shadow(pose: SimBody): void;
statusBadges(car: RenderCar, tick: number): void;
```

#### Three §5 rows, and the one rule they share

| §5 row | What ships |
|---|---|
| "Car shadow — none today → one soft blob sprite under each car; sells height and speed for a quad" | one baked radial blob on `CAR_BAND.shadow`, offset by a fixed vector so every car's light comes from the same place, at `SHADOW_ALPHA` |
| "Statuses on a car — HUD badge only → badge sprite on the car: looping flipbooks" | a four-frame flipbook per status, played from the row's own `startTick`, stacked above the hull. **Off at tier Low** (R21) |
| "Muzzle flash — none today → 2-frame flipbook on the Glow layer at the muzzle, from the ghost shot's birth tick" | a two-frame flipbook drawn for any instance whose `spawnTick` is within `MUZZLE_FLASH_TICKS` of the frame's tick — which covers a ghost and its authoritative twin identically |

The rule all three share is **V3's**: a flipbook's frame index comes from a tick, never from a wall clock (R9). `flameFrameIndex(spawnTick, tick, frames, ticksPerFrame)` is already exactly that function, and all three reuse it rather than growing a second one — a status badge from the row's `startTick`, a muzzle flash from the instance's `spawnTick`.

**Which statuses get a flipbook is derived from `STATUS_TABLE`, not listed.** §5 names five (burning for `overheated`, drip for `corroded`, sparks for `stunned`, spikes for `spiked`, a shield ring for `fortified`), and the table has eight rows: `overhauled` and `armored` have no applier in the game yet (their own comments say they are pickup-tier rows waiting), and `phased` is already drawn as alpha plus a pulsing outline by V2 and must not gain a second representation. So the bake walks `STATUS_TABLE`, **skips `phased`**, and gives every other row a flipbook — with a generic pulsing ring for one that has no authored glyph, tinted by `statusFillOf`, which is the colour the HUD strip already uses for it. A ninth status therefore arrives with a badge and no code change, which is the property that matters.

- [ ] **Step 1: Write the failing pure test**

```ts
// packages/client/src/scenes/arena/status-badges.test.ts
import { describe, expect, it } from "vitest";
import { STATUS_TABLE, type StatusRow } from "@motor-combat-moba/shared";
import { STATUS_FLIPBOOK_FRAMES, STATUS_TICKS_PER_FRAME, bakedStatusFrame } from "../../render/bake.js";
import { carBadges, statusFlipbookFrames, type CarBadge } from "./status-badges.js";
import { statusFillOf } from "../status-hud.js";

const row = (statusId: string, startTick: number, endsTick: number): StatusRow =>
  ({ statusId, startTick, endsTick, sourceSessionId: "" });

const scratch: CarBadge[] = [];

describe("carBadges", () => {
  it("gives every live status a badge except phased", () => {
    const rows = [row("overheated", 100, 200), row("phased", 100, 200), row("spiked", 100, 200)];
    const count = carBadges(rows, 150, scratch);
    expect(count).toBe(2);
    expect(scratch.slice(0, count).map((b) => b.statusId).sort()).toEqual(["overheated", "spiked"]);
  });

  it("drops an expired row", () => {
    expect(carBadges([row("stunned", 100, 140)], 150, scratch)).toBe(0);
  });

  it("stacks them at a fixed spacing, in a stable order", () => {
    const rows = [row("spiked", 100, 300), row("overheated", 100, 300), row("fortified", 100, 300)];
    const count = carBadges(rows, 150, scratch);
    const first = carBadges(rows, 150, scratch);
    expect(count).toBe(first);
    const offsets = scratch.slice(0, count).map((b) => b.offsetUnits);
    expect(new Set(offsets).size).toBe(count);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it("advances the flipbook from the row's own startTick", () => {
    const rows = [row("overheated", 100, 400)];
    carBadges(rows, 100, scratch);
    const atStart = scratch[0]!.frame;
    carBadges(rows, 100 + STATUS_TICKS_PER_FRAME, scratch);
    expect(scratch[0]!.frame).not.toBe(atStart);
    carBadges(rows, 100 + STATUS_TICKS_PER_FRAME * STATUS_FLIPBOOK_FRAMES, scratch);
    expect(scratch[0]!.frame).toBe(atStart);     // loops
  });

  it("tints a badge the colour the HUD strip already uses for it", () => {
    carBadges([row("corroded", 100, 300)], 150, scratch);
    expect(scratch[0]!.tint).toBe(statusFillOf("corroded"));
  });

  it("names a frame that the bake registers, for every status that can appear", () => {
    for (const def of Object.values(STATUS_TABLE)) {
      if (def.id === "phased") continue;
      expect(statusFlipbookFrames(def.id)).toBe(STATUS_FLIPBOOK_FRAMES);
      expect(bakedStatusFrame(def.id, 0)).toContain(def.id);
    }
  });

  it("allocates nothing: it fills the caller's array and returns a count", () => {
    const out: CarBadge[] = [];
    carBadges([row("spiked", 100, 300)], 150, out);
    const held = out[0];
    carBadges([row("stunned", 100, 300)], 150, out);
    expect(out[0]).toBe(held);      // the same object, rewritten
  });
});
```

- [ ] **Step 2: The three bake job groups**

Appended to `render/bake.ts`, and called from Task 1's `fxBakeJobs`:

```ts
/** Frames in a status badge's loop, and how long each is held. 4 x 8 ticks is a 32-tick,
 *  533 ms loop at 60 Hz — slow enough to read as a pulse rather than a flicker. */
export const STATUS_FLIPBOOK_FRAMES = 4;
export const STATUS_TICKS_PER_FRAME = 8;
/** How long a muzzle flash lasts, in ticks. Two frames over four ticks is 67 ms — one blink. */
export const MUZZLE_FLASH_TICKS = 4;

export const BAKED_SHADOW = "baked.fx.shadow";
const MUZZLE_NAMES = ["baked.fx.muzzle.0", "baked.fx.muzzle.1"] as const;
export function bakedMuzzleFrame(index: number): string {
  return MUZZLE_NAMES[Math.max(0, Math.min(MUZZLE_NAMES.length - 1, index))]!;
}
export function bakedStatusFrame(statusId: string, index: number): string {
  return `baked.fx.status.${statusId}.${index % STATUS_FLIPBOOK_FRAMES}`;
}

/** One soft blob, sized to the hull, tinted black at draw time. */
function shadowBakeJob(ss: number, pad: number): BakeJob[] {
  const w = Math.ceil(DRIVE_CONFIG.carWidth * ss);
  const h = Math.ceil(DRIVE_CONFIG.carHeight * ss);
  return [{
    name: BAKED_SHADOW,
    width: w + pad * 2,
    height: h + pad * 2,
    pad,
    draw(gfx) {
      // An ellipse rather than the hull's rectangle: a shadow has no corners, and a soft one under
      // a hard-edged car is what sells the height §5 asks for.
      for (let s = 6; s >= 1; s--) {
        gfx.fillStyle(0xffffff, 1 / 6);
        gfx.fillEllipse(w / 2, h / 2, (w * s) / 6, (h * s) / 6);
      }
    },
  }];
}

/** Two frames: a bright four-point star, then a wider, dimmer ring. */
function muzzleBakeJobs(ss: number, pad: number): BakeJob[] {
  const r = Math.ceil((MUZZLE_FLASH_UNITS / 2) * ss);
  return MUZZLE_NAMES.map((name, index) => ({
    name,
    width: r * 2 + pad * 2,
    height: r * 2 + pad * 2,
    pad,
    draw(gfx) {
      const scale = index === 0 ? 1 : 0.7;
      radialFalloff(gfx, r, r, r * scale, 0xffffff, index === 0 ? 1 : 0.5, 8);
      if (index !== 0) return;
      // Four spikes on the first frame only — the shape of a flash, gone by the second.
      gfx.fillStyle(0xffffff, 0.9);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        gfx.fillRect(r + dx * r * 0.2 - r * 0.06, r + dy * r * 0.2 - r * 0.06, r * 0.12, r * 0.12);
      }
    },
  }));
}

/**
 * A four-frame loop per status, white and tinted at draw time by `statusFillOf` — so a status's
 * badge on the car is the same colour as its badge on the HUD strip, without either side owning
 * the other's palette.
 *
 * Walks `STATUS_TABLE` rather than a list, so a ninth status gets a badge with no edit here.
 * `phased` is skipped: V2 already draws a phasing car as alpha plus a pulsing outline, and a second
 * representation of one state is how a player ends up unsure which one to believe.
 *
 * **Off at tier Low** (spec R21): no job is emitted at all, so the sheet is smaller as well as the
 * frame cheaper.
 */
function statusBakeJobs(ss: number, pad: number, tier: BakeTier): BakeJob[] {
  if (tier === "low") return [];
  const size = Math.ceil(STATUS_BADGE_UNITS * ss);
  const jobs: BakeJob[] = [];
  for (const def of Object.values(STATUS_TABLE)) {
    if (def.id === "phased") continue;
    for (let i = 0; i < STATUS_FLIPBOOK_FRAMES; i++) {
      jobs.push({
        name: bakedStatusFrame(def.id, i),
        width: size + pad * 2,
        height: size + pad * 2,
        pad,
        draw(gfx) {
          // A pulsing ring: radius and thickness breathe over the loop. Generic on purpose — the
          // colour carries the identity, exactly as the HUD strip's badge does, and an authored
          // glyph per status is an art pass rather than a rendering one.
          const t = i / STATUS_FLIPBOOK_FRAMES;
          const pulse = 0.72 + 0.28 * Math.sin(t * Math.PI * 2);
          const radius = (size / 2) * pulse;
          gfx.lineStyle(Math.max(1, size * 0.16), 0xffffff, 1);
          gfx.strokeCircle(size / 2, size / 2, radius);
          gfx.fillStyle(0xffffff, 0.35);
          gfx.fillCircle(size / 2, size / 2, radius * 0.45);
        },
      });
    }
  }
  return jobs;
}
```

`BakeGraphics` gains `fillEllipse` if V2 did not already add it (V2's Handoff says it did, for the ellipse silhouette); `bake.test.ts`'s recorder implements it.

Sheet cost, at Medium and supersample 2: seven statuses × 4 frames × a 36-pixel tile is 28 tiles on one shelf of 36 pixels; the shadow is 104 × 72 and the two muzzle frames are 60 × 60. **About 40 pixels of shelf height plus one 72-pixel shelf**, against V3's 540 — negligible, and `bake.test.ts`'s three-tier packing case is still the authority.

- [ ] **Step 3: Write `scenes/arena/status-badges.ts`**

```ts
// packages/client/src/scenes/arena/status-badges.ts
import { STATUS_TABLE, isStatusId, type StatusRow } from "@motor-combat-moba/shared";
import { STATUS_FLIPBOOK_FRAMES, STATUS_TICKS_PER_FRAME, bakedStatusFrame } from "../../render/bake.js";
import { flameFrameIndex } from "../combat-visual.js";
import { statusFillOf } from "../status-hud.js";
import { STATUS_BADGE_GAP_UNITS, STATUS_BADGE_UNITS } from "./world-style.js";

/**
 * The badges to draw above one car this frame.
 *
 * Pure, and written into the caller's array rather than returned as a new one (spec R6): this runs
 * once per car per frame, six times over, and a fresh array each time is thirty-six allocations a
 * frame for nothing.
 *
 * The frame index comes from the row's own `startTick` through V3's `flameFrameIndex` — the same
 * age-in-ticks rule the flame uses, for the same R9 reason: two cars that caught fire a tick apart
 * pulse out of step, and every client watching either agrees about which frame it is on.
 *
 * `phased` is deliberately absent: V2 draws a phasing car as alpha plus a pulsing outline, and one
 * state with two representations is one the player cannot read.
 */
export interface CarBadge {
  statusId: string;
  frame: string;
  tint: number;
  /** How far above the hull's top this badge sits, in world units. */
  offsetUnits: number;
}

export function statusFlipbookFrames(statusId: string): number {
  return isStatusId(statusId) && statusId !== "phased" ? STATUS_FLIPBOOK_FRAMES : 0;
}

export function carBadges(statuses: readonly StatusRow[], tick: number, out: CarBadge[]): number {
  let count = 0;
  // `STATUS_TABLE`'s own order, so the stack is stable frame to frame rather than following
  // whatever order the wire happened to carry the rows in.
  for (const def of Object.values(STATUS_TABLE)) {
    if (def.id === "phased") continue;
    const row = statuses.find((r) => r.statusId === def.id && r.endsTick > tick);
    if (!row) continue;
    while (out.length <= count) out.push({ statusId: "", frame: "", tint: 0, offsetUnits: 0 });
    const badge = out[count]!;
    badge.statusId = def.id;
    badge.frame = bakedStatusFrame(def.id, flameFrameIndex(row.startTick, tick, STATUS_FLIPBOOK_FRAMES, STATUS_TICKS_PER_FRAME));
    badge.tint = statusFillOf(def.id);
    badge.offsetUnits = count * (STATUS_BADGE_UNITS + STATUS_BADGE_GAP_UNITS);
    count += 1;
  }
  return count;
}
```

`statuses.find` inside the loop is the one allocation-free-but-quadratic thing here, and it is fine: both lists are at most eight long and the whole scan is 64 comparisons per car per frame against a budget measured in milliseconds. **Do not "optimise" it into a `Map`, which would allocate one per car per frame** — that is the actual cost.

- [ ] **Step 4: Draw them**

`scenes/arena/car-sprites.ts` — `CarDecor` gains two methods and one pool each, following the class's existing shape exactly (`begin()` … calls … `end()`):

| Member | Layer and band | Notes |
|---|---|---|
| `shadow(pose)` | `Layer.Cars`, `CAR_BAND.shadow` (−2) | one `BAKED_SHADOW` sprite per car, offset by `SHADOW_OFFSET_UNITS`, rotated with the hull, tinted `0x000000` at `SHADOW_ALPHA`. Under the body, and still 98 depth units above `Layer.Shots` |
| `statusBadges(car, tick)` | `Layer.Cars`, `CAR_BAND.status` (40) | `carBadges` into a module-level scratch array, then one sprite per badge above the hull's top edge |

`CarRenderer.render` calls `decor.shadow(car.pose)` first for every on-field car (so every shadow is under every body, not just its own) and `decor.statusBadges(car, frame.tick)` in the same pass it already draws hp bars in. **At tier Low, `statusBadges` returns immediately** — the frames were never baked, and `bakedFrame` would fall back to a missing texture.

The **hit flash** is the third §5 row here and it is one line: N4 put `RenderCar.hpFlashUntilTick` on the frame and `car-renderer.ts` already reads it for the hp bar. The car body reads the same field:

```ts
      // §5's "target hit-flash via FILL tint for 60 ms". The clock is N4's, on the frame, in tick
      // time — so it is the same 60 ms on a 30 fps laptop as on a 144 Hz monitor.
      const flashing = frame.tick < car.hpFlashUntilTick;
      body.setTintFill(flashing ? HIT_FLASH_TINT : undefined);
```

using Phaser 4's `setTintFill` where a plain `setTint` multiplies. If the car body is a `Container` rather than an `Image` after V2, apply it to the body image inside it — `CarRenderer` knows which.

- [ ] **Step 5: The muzzle flash**

`scenes/arena/shot-renderer.ts`, inside the instance loop V3 left, before the beam/projectile fork:

```ts
      // §5: "2-frame flipbook on the Glow layer at the muzzle, from the ghost shot's birth tick".
      // Any instance whose birth is within MUZZLE_FLASH_TICKS gets it, which covers a predicted
      // ghost and its authoritative twin identically — the ghost flashes on the press tick, and the
      // real shot that replaces it is already past the window, so nothing flashes twice.
      const age = frame.tick - instance.spawnTick;
      if (age >= 0 && age < MUZZLE_FLASH_TICKS) {
        this.beamRenderer.muzzle(
          bakedMuzzleFrame(flameFrameIndex(instance.spawnTick, frame.tick, 2, MUZZLE_FLASH_TICKS / 2)),
          instance.x, instance.y, instance.angle,
          weaponFillOf(instance.weaponId),
        );
      }
```

`BeamRenderer` gains one method beside `flame`/`bolt`/`zone`, reusing its existing halo pool (which is already on `Layer.Glow` with the band's ADD blend):

```ts
  /** A muzzle flash, on the Glow band. Two frames, four ticks, one quad. */
  muzzle(frame: string, x: number, y: number, angle: number, tint: number): void {
    const sprite = this.halos.next();
    const [key, f] = bakedFrame(frame);
    sprite.setTexture(key, f);
    sprite.setPosition(x, y);
    sprite.setRotation(angle);
    sprite.setScale(this.unit);
    sprite.setAlpha(1);
    sprite.setTint(tint);
  }
```

Sharing the halo pool is safe under V2's order-based contract **because every one of the five setters is called on both paths** — that is precisely the property the contract exists to keep, and it is worth a comment at the pool's declaration naming both callers.

- [ ] **Step 6: Run and commit**

Run: `cd packages/client && npx vitest run src/scenes/arena/status-badges.test.ts src/render/bake.test.ts && npm run typecheck`

```bash
git add packages/client/src/render/bake.ts packages/client/src/render/bake.test.ts packages/client/src/render/layers.ts packages/client/src/render/beams.ts packages/client/src/scenes/arena
git commit -m "feat(client): car shadows, status flipbooks on the car, the hit flash and the muzzle flash"
```

---

### Task 5: Delete the local detection, and wire the three services

**Files:**
- Delete: `packages/client/src/scenes/impact-feedback.ts`, `packages/client/src/scenes/impact-feedback.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts`, `packages/client/src/scenes/arena/car-renderer.ts`, `packages/client/src/dev/bench-frame.ts`, `packages/client/src/dev/BenchScene.ts`

**Interfaces:**
- Consumes: Tasks 1–3's three services; V0's `benchFrame`, `BENCH_CEILING`.
- Produces:

```ts
// dev/bench-frame.ts
/** The scripted event stream R24 asks for: hits, rams, kills and respawns on a fixed cadence. */
export function benchEvents(tick: number, out: MatchEvent[]): number;
export const BENCH_EVENT_PERIOD_TICKS: number;
```

#### What is deleted, and why it can be

`scenes/impact-feedback.ts` is 90 lines, half of which is a doc comment explaining that it cannot be correct:

> *"The two poses this compares do not share a timebase, and the mismatch is not corrected… the two clocks can therefore disagree by on the order of 50-100+ ms depending on latency… enough that this can spark on a near-miss or miss a real graze. This is accepted, not fixed, and deliberately not restructured: correcting it means either lagging the spark behind the local car's own prediction… or predicting every remote car forward instead of interpolating it, which is the source spec's §9.1 netcode rework."*

Both of the things it says would be needed have happened. The netcode work's phase 3 predicts every remote forward, and its phase 4 puts the server's own `ram` event on the wire with the attacker, the victim, the graded severity and a point. So the file's own stated condition for deletion is met, and the rendering spec's V4 row says to delete it by name.

`freshImpacts`, `newImpactTracker`, `ImpactTracker`, `ImpactPose` and `Impact` all go with it. `grep -rn "impact-feedback\|freshImpacts\|ImpactTracker" packages/` must print nothing when this task is done.

- [ ] **Step 1: The scene owns the three services**

`ArenaScene`, in `create`:

```ts
    this.particles = new ParticleService(makePhaserEmitter(this), BAKE_DEFAULT_TIER);
    this.decals = new DecalService(makeDecalSprite(this), BAKE_DEFAULT_TIER);
    this.effects = new EffectRouter(this.particles, this.decals, makeEffectCamera(this), {
      isLocal: (sessionId) => sessionId === this.net.drivenSid(),
    });
```

in `update`, after the frame is built and before the renderers draw it:

```ts
    // Events first: a spark should be in the same frame as the hp change that caused it.
    this.effects.onEvents(this.locateEvents(frame));
    this.particles.update(deltaMs);
    this.decals.update(deltaMs);
```

and in `shutdown`: `this.particles.destroy(); this.decals.destroy();`, with `this.particles.clear(); this.decals.clear();` wherever the scene already resets for a new match.

`locateEvents` closes the loose end Task 3 named — three of the six kinds carry no point:

```ts
  /**
   * Give `kill`, `respawn` and `refused` a place to happen.
   *
   * Those three name a car and no coordinates (netcode N23a's payloads), and a burst at the origin
   * is a visible bug. The car's DRAWN pose is the right answer rather than its server pose: the
   * effect belongs where the player is looking at the car, which after phase 3 is the blended,
   * offset pose the frame already carries.
   *
   * Rewrites into a reused array of reused objects — this runs every frame and must allocate
   * nothing (R6). The three kinds that do carry a point are passed through untouched.
   */
  private locateEvents(frame: RenderFrame): readonly MatchEvent[] {
    if (frame.events.length === 0) return frame.events;
    this.locatedEvents.length = 0;
    for (const event of frame.events) {
      if ("x" in event) {
        this.locatedEvents.push(event);
        continue;
      }
      const car = carOf(frame, event.kind === "kill" ? event.victim : event.car);
      if (!car) continue;
      this.locatedEvents.push({ ...event, x: car.pose.x, y: car.pose.y } as MatchEvent);
    }
    return this.locatedEvents;
  }
```

The spread inside the loop **does** allocate, once per point-less event, and those are rare — a kill, a respawn and a refused press are single-digit events per second at the very most, against the sixty frames a second this claim is about. Note it rather than pretending otherwise: R6's target is the *frame path*, and this is an event path that shares its call site.

- [ ] **Step 2: Delete the local detection**

| File | Action |
|---|---|
| `packages/client/src/scenes/impact-feedback.ts` | delete |
| `packages/client/src/scenes/impact-feedback.test.ts` | delete |
| `packages/client/src/scenes/arena/car-renderer.ts` | remove the `ImpactTracker` field, the `freshImpacts` call, and the spark it drew (a `Graphics` circle plus a tween per hit — the thing R5 names as what the particle service replaces) |
| `packages/client/src/scenes/ArenaScene.ts` | remove the tracker's construction and its reset |

Then `grep -rn "impact-feedback\|freshImpacts\|newImpactTracker\|ImpactTracker\|ImpactPose" packages/ scripts/` — every hit must be gone. The one place a mention may survive is a doc paragraph, and Task 6 rewrites those.

- [ ] **Step 3: The bench's scripted events**

`dev/bench-frame.ts` gains the stream R24 has asked for since V0 and nothing has produced:

```ts
/** How often the bench fires a scripted event. Twelve ticks is 200 ms — five a second, which is a
 *  busy firefight and is what "a scripted stream of hit and ram events" (R24) has to mean. */
export const BENCH_EVENT_PERIOD_TICKS = 12;

const BENCH_EVENT_SCRIPT = ["hit", "hit", "ram", "hit", "slam", "kill", "hit", "respawn", "refused"] as const;

/**
 * The bench's synthetic events (execution guide coupling 2).
 *
 * A bench scene has no server, so it never gets real events and never will — this is not a stand-in
 * that gets switched off when the netcode work's phase 4 lands. `ArenaScene` reads
 * `RenderFrame.events`, which that phase fills; `BenchScene` reads this. Both call the same
 * `EffectRouter.onEvents`.
 *
 * The script cycles every kind so the bench exercises the whole `FEEDBACK_TABLE`, which is what
 * makes "every event kind drives an effect" measurable rather than asserted (Task 6).
 *
 * Written into the caller's array, like everything else on this path.
 */
export function benchEvents(tick: number, out: MatchEvent[]): number {
  out.length = 0;
  if (tick % BENCH_EVENT_PERIOD_TICKS !== 0) return 0;
  const kind = BENCH_EVENT_SCRIPT[Math.floor(tick / BENCH_EVENT_PERIOD_TICKS) % BENCH_EVENT_SCRIPT.length]!;
  const a = BENCH_LAYOUT[0]!;
  const b = BENCH_LAYOUT[1 % BENCH_LAYOUT.length]!;
  switch (kind) {
    case "hit":
      out.push({ kind: "hit", tick, attacker: a.sessionId, victim: b.sessionId, weaponId: "predator", x: b.x, y: b.y, damage: 45 });
      break;
    case "ram":
      out.push({ kind: "ram", tick, attacker: a.sessionId, victim: b.sessionId, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, severity: 0.7 });
      break;
    case "slam":
      out.push({ kind: "slam", tick, car: b.sessionId, x: b.x, y: b.y });
      break;
    case "kill":
      out.push({ kind: "kill", tick, killer: a.sessionId, victim: b.sessionId });
      break;
    case "respawn":
      out.push({ kind: "respawn", tick, car: b.sessionId });
      break;
    case "refused":
      out.push({ kind: "refused", tick, car: a.sessionId, slot: 0 });
      break;
  }
  return out.length;
}
```

`BenchScene` calls `benchEvents(tick, this.eventScratch)` each tick and assigns the result to the frame's `events` before handing it to the renderers, so the bench's `EffectRouter` sees exactly what the arena's would.

R24 also asks the ceiling scenario for **400 particles**. With the script above at Medium's 256 cap the service refuses the excess, which is the *right* behaviour and not a measurement of it — so the bench additionally runs a cosmetic `stream("dust", …)` under each of the six cars at a rate chosen to sit the live count near the cap. State the rate in the scene: `BENCH_DUST_RATE = 24` per car per second, six cars, 900 ms lifespan ≈ 130 live, on top of the script's bursts.

- [ ] **Step 4: Run it, and look at it**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena
npm run dev
```

Then in a browser:

| Check | Where | What "right" looks like |
|---|---|---|
| the events actually fire | `?dev=bench`, then `window.__bench.census().effectsByKind` | every one of the six kinds non-zero after a few seconds |
| a hit sparks where the server said | a Practice match, shooting the bot | the spark on the bot's hull, not near it; the camera does **not** shake when the bot is hit |
| taking a hit shakes | let the bot shoot back | a shake scaled by the damage; the hp bar flashes in the same frame (N4's clock) |
| a ram throws debris | ram the bot | debris and dust at the contact, a shake scaled by severity |
| shadows and badges | any match | one soft shadow per car, offset consistently; a status badge pulsing above a burning car; **no** badge for a phasing car, which is drawn as alpha plus an outline |
| the muzzle flashes | hold a fire key | one blink at the muzzle per shot, on the ghost's tick if the netcode phase 4 has merged |

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/scenes packages/client/src/dev
git rm packages/client/src/scenes/impact-feedback.ts packages/client/src/scenes/impact-feedback.test.ts
git commit -m "feat(client): feedback comes from server events; impact-feedback's local detection deleted"
```

---
### Task 6: Measure it, guard it, write it down

**Files:**
- Modify: `packages/client/src/dev/BenchScene.ts`, `packages/client/src/render/perf-overlay.ts`, `scripts/bench-arena.mjs`, `scripts/world-retained.test.mjs`, `docs/render-bench.md`, `docs/project-structure.md`, `packages/client/CLAUDE.md`

**Interfaces:**
- Consumes: V0's `BenchProbe`, `PerfReport`, `formatBenchRows`, `PARTICLES_UNTIL_V4`; V1/V2/V3's `SceneCensus`, `sceneCensus`, `benchFailures`, `formatCensusRow`; Tasks 1–3's services.
- Produces: `SceneCensus.particlesLive`, `.particlesRefused`, `.decalsLive`, `.effectsByKind`; `PARTICLE_HARD_CEILING` and `EVENT_KINDS` in `bench-arena.mjs`; the V4 row of `docs/render-bench.md`.

#### The census widens for the fourth time

V1 created it, V2 added `worldGraphicsNames` and `worldClears`, V3 added `worldRopeVertices`. **Each phase appends and never renames**, and this is V4's group:

```ts
export interface SceneCensus {
  // …V1's, V2's and V3's fields, unchanged…
  /** Live particles, from `ParticleService.live`. The V4 acceptance line is "capped per tier". */
  particlesLive: number;
  /** Requests the cap refused. Non-zero is normal at the ceiling; it is what the cap is for. */
  particlesRefused: number;
  /** Live decals. **Zero for the life of this phase**, because no decal is authored (R12a). */
  decalsLive: number;
  /** How many effects each event kind has driven since the scene started. */
  effectsByKind: Record<string, number>;
}
```

`effectsByKind` accumulates rather than draining, because the bench's question is "has every kind ever fired", not "did one fire this frame". `EffectRouter.drainSeen` is what feeds it, summed into the census's running total by `BenchScene` each frame.

- [ ] **Step 1: The three guard clauses**

`scripts/bench-arena.mjs`:

```js
/**
 * The absolute ceiling on live particles: the tier cap times the informative headroom (R16). The
 * bench runs at the default tier, so this is Medium's 256 x 1.25. Exceeding it means the service
 * is not enforcing its own budget, which is the V4 acceptance line.
 */
const PARTICLE_HARD_CEILING = Math.floor(256 * 1.25);

/** Every `MatchEvent` kind. The V4 acceptance line is that each one drives an effect. */
const EVENT_KINDS = ["hit", "kill", "ram", "slam", "respawn", "refused"];
```

and three clauses in `benchFailures`:

```js
  if (census.particlesLive > PARTICLE_HARD_CEILING) {
    failures.push(
      `${browser}: ${census.particlesLive} live particles, over the ${PARTICLE_HARD_CEILING} ceiling ` +
        `(spec R16: the cap is the service's to enforce, not the callers')`,
    );
  }
  for (const kind of EVENT_KINDS) {
    if ((census.effectsByKind?.[kind] ?? 0) === 0) {
      failures.push(`${browser}: no effect ever fired for a "${kind}" event (spec §10, the V4 acceptance line)`);
    }
  }
  if (census.decalsLive !== 0) {
    failures.push(
      `${browser}: ${census.decalsLive} live decals, and NO decal is authored (spec R12a). ` +
        `If this phase is where the first one lands, this check is what has to change deliberately.`,
    );
  }
```

The third is the unusual one and it is the point: **a guard that fails when the feature starts working** is exactly right for a decision that was made once and must not drift by accident. The day somebody authors a decal, this line is what makes them say so.

`formatCensusRow` gains a third line: `particles ${census.particlesLive}/${PARTICLE_HARD_CEILING} (refused ${census.particlesRefused})  decals ${census.decalsLive}  events ${EVENT_KINDS.map((k) => `${k}:${census.effectsByKind?.[k] ?? 0}`).join(" ")}`.

`scripts/world-retained.test.mjs`: V3 widened its scan to `render/` as well as `scenes/arena/`. `particles.ts`, `decals.ts`, `effects.ts` and `feedback-table.ts` join the retained list; none of them creates a `Graphics`, so none goes on the `Graphics`-allowed list, and the union rule keeps holding.

- [ ] **Step 2: The perf overlay stops lying**

V0 left a literal: `PARTICLES_UNTIL_V4`, with a comment naming this phase as the one that replaces it (V0's Handoff says so). Replace it with a reading:

| Before | After |
|---|---|
| `const PARTICLES_UNTIL_V4 = 0;` and the overlay printing it | `PerfOverlay.attachParticles(() => particles.live)`, the same shape as V0's `attachNetgraph(lines)`; the overlay prints `particles ${read()}` and `0` when nothing has attached |

`TIER_UNTIL_V5` stays exactly as it is — that one is V5's.

- [ ] **Step 3: Record the numbers**

`docs/render-bench.md` gains a V4 section beside V0's, V1's, V2's and V3's:

```markdown
## V4 — Events

V3 left the world with no per-frame `Graphics` at all. V4 adds the first thing that can grow without
bound — particles — and the whole of this row is about the ceiling holding.

| Measurement | Before (V3) | After (V4) |
|---|---|---|
| Live particles at the ceiling | 0 | (record; hard ceiling 320 at the default tier) |
| Particle requests refused at the ceiling | — | (record; non-zero is the cap working) |
| Live decals | 0 | **0** — no decal is authored (R12a), and `bench-arena.mjs` fails if this is not zero |
| Event kinds driving an effect | 0 of 6 | **6 of 6** on the bench's scripted stream |
| Draw calls at the ceiling | (V3's) | (record; ceiling 16 — the six emitters are six batches at worst, one per texture-and-layer pair) |
| Client JavaScript p95, ceiling, Chromium | (V3's) | (record; line < 5 ms) |
| Client JavaScript p95, ceiling, Firefox | (V3's) | (record) |
| Boot bake | (V3's) | (record; line < 150 ms) |
```

Fill every `(record)` from Step 4's run. **The draw-call row is the one to watch**: six emitters on four layers is up to four extra batches, and V2's ceiling of 16 was measured before any of them existed. If it is exceeded, the fix is to merge kinds onto fewer layers rather than to raise the ceiling — the ceiling is R25's.

- [ ] **Step 4: Run it**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena
node scripts/bench-visual.mjs
node scripts/bench-arena.mjs
```

Expected: `bench-arena.mjs` green on Chromium **and** Firefox with `benchFailures` empty — live particles at or under 320, every event kind non-zero, decals at zero, draw calls at or under 16, and the world still clearing no `Graphics` (V3's gate, which this phase must not break: nothing added here is a `Graphics`).

- [ ] **Step 5: The pages**

`docs/project-structure.md`: `config/particles.ts`, `config/decals.ts`, `render/particles.ts`, `render/decals.ts`, `render/effects.ts`, `render/feedback-table.ts`, `scenes/arena/status-badges.ts` added; `scenes/impact-feedback.ts` removed.

`packages/client/CLAUDE.md` — two edits. First, the paragraph V3 rewrote about beams gains a sentence at the end:

```markdown
Transients are particles, never tweened objects created per event: `render/particles.ts` owns one
emitter per kind with a global cap it enforces itself (Low 96, Medium 256, High 512), and callers
pass a priority and check nothing.
```

Second, **the sentence naming `scenes/impact-feedback.ts` must go**, and what replaces it is the whole point of this phase:

```markdown
**Feedback is never detected locally.** Every spark, flash, shake, kill punch and hit marker comes
from a `MatchEvent` in the snapshot, routed by `render/effects.ts` through the table in
`render/feedback-table.ts`. `scenes/impact-feedback.ts` — which compared the local car's predicted
pose against a remote's interpolated one, and documented at length that it could spark on a
near-miss — is deleted: both of the things its own comment said would be needed to fix it have
happened, in the netcode work's phases 3 and 4.

The decal **mechanism** ships and no decal does (`render/decals.ts`, `config/decals.ts`). That is a
decision, not a gap: `DECAL_DEFS` is empty, `decals.test.ts` asserts it is empty, and
`scripts/bench-arena.mjs` fails if a decal is ever live. Authoring the first one is a table row, an
atlas frame and one `place` call in `render/effects.ts`.
```

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/dev packages/client/src/render/perf-overlay.ts scripts/bench-arena.mjs scripts/world-retained.test.mjs docs packages/client/CLAUDE.md
git commit -m "test(render): particle-cap and every-kind-fires guards; V4's measured numbers"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Probe note.** This phase touches no probe and no file under `packages/server/`. It changes what the client draws and nothing the sim does, so `npm run playtest` is expected to report exactly what it reported before — the execution guide does not require a run after V4, and the honest statement is that there is nothing here for a probe to measure.

---

## Acceptance

Spec §10, the V4 row: **Ships** — "particle service, decal mechanism with no decals authored (R12a), event-driven feedback, status flipbooks, shadows, muzzle flash". **Deletes** — "`impact-feedback.ts`'s local detection". **Acceptance** — "particles capped per tier; every event kind drives an effect on synthetic events; decal service empty and tested".

| Requirement | Demonstrated by |
|---|---|
| **Particles capped per tier** | `cd packages/client && npx vitest run src/render/particles.test.ts` (9 tests) — the cap comes from the tier, a cosmetic burst past it is refused whole, an informative one is clamped to `cap × 1.25` and no further, and no single kind can spend the whole budget. Measured live by `node scripts/bench-arena.mjs`, whose `PARTICLE_HARD_CEILING` clause fails the run |
| **Every event kind drives an effect on synthetic events** | `cd packages/client && npx vitest run src/render/effects.test.ts` — `FEEDBACK_TABLE` has an entry with at least one burst for all six kinds, and `drainSeen()` is non-zero for every one after a list containing each. Measured live by `bench-arena.mjs`'s `EVENT_KINDS` clause against `census.effectsByKind`, fed by `benchEvents`'s scripted cycle |
| **Decal service empty and tested** | `cd packages/client && npx vitest run src/render/decals.test.ts` (7 tests) — `DECAL_DEFS` is `[]`, the hold-then-fade timing is exact, a per-decal override works, the cap recycles the oldest and the pool never grows past it. `effects.test.ts` asserts the router places none, and `bench-arena.mjs` **fails if any decal is ever live** |
| `impact-feedback.ts`'s local detection is deleted | `grep -rn "impact-feedback\|freshImpacts\|newImpactTracker\|ImpactTracker\|ImpactPose" packages/ scripts/ docs/` prints nothing |
| Event-driven feedback lands at the server's point | `effects.test.ts`'s "sparks at the server's point"; and by eye per Task 5 Step 4, shooting the practice bot and watching the spark land on its hull |
| Only the local player's camera shakes for a personal event | `effects.test.ts`'s two camera cases: a hit on the local car shakes and one on another car does not; any kill punches the zoom for everyone |
| Status flipbooks | `cd packages/client && npx vitest run src/scenes/arena/status-badges.test.ts` (7 tests) — one badge per live status **except `phased`**, in `STATUS_TABLE` order, advancing from each row's own `startTick`, tinted with the HUD strip's own colour; and `bake.test.ts`, which registers four frames per status at Medium and **none at Low** (R21) |
| Shadows and the muzzle flash | `bake.test.ts` registers `BAKED_SHADOW` and both muzzle frames; and by eye per Task 5 Step 4 |
| The hit flash is in tick time | `car-renderer.ts` reads `RenderCar.hpFlashUntilTick` against `frame.tick` — the netcode work's phase 4 clock, so the flash is the same 60 ms at every frame rate |
| Zero allocation on the frame path (R6) | `carBadges` and `benchEvents` write into caller-owned arrays; `ParticleService.burst` is one emitter call; `DecalService.update` walks a fixed array. The one exception is named rather than hidden: `ArenaScene.locateEvents` spreads a point-less event, at single-digit events a second |
| Nothing under `match/` imports Phaser, and no test does | `grep -rin "phaser" packages/client/src/match/` prints nothing; every new module here takes its Phaser objects through an injected factory, which is what makes the caps and timings testable at all |
| V3's gate is not broken | `bench-arena.mjs`'s `WORLD_CLEARS_ALLOWED` is still `[]` and still passes: nothing this phase adds is a `Graphics` |
| Draw calls still ≤ 16 at the ceiling | `bench-arena.mjs`'s `DRAW_CALL_CEILING`, with the six new emitters in the scene. If it is exceeded, merge kinds onto fewer layers — the ceiling is R25's and does not move |
| No balance table moved, and `packages/shared` is untouched | `git diff --stat development/main -- packages/shared/` prints nothing; `node --test scripts/turn-tuning-doc.test.mjs scripts/manual-page.test.mjs` passes with neither page edited |
| Everything else still green | `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena` |

Record the measured numbers in `docs/render-bench.md`'s V4 row, with the date and the machine, when the phase is run — **and say in the merge commit whether the netcode work's phase 4 had merged**, because that decides whether a live match showed any of this or only the bench did.

## Handoff

Everything below is beyond the ledger. V5 is written against this section.

### The three services

| Module | Exports | Notes for V5 |
|---|---|---|
| `render/particles.ts` | `ParticleService` (`burst`, `stream`, `setCap`, `update`, `clear`, `destroy`, `live`, `cap`, `refused`), `ParticleEmitterLike`, `makePhaserEmitter` | **`setCap` is V5's hook.** `TierManager` calls it on a tier change; nothing is rebuilt, because the emitters are per-kind and the cap is one number. `FrameGovernor` sheds by calling `setCap` low for a frame or by refusing cosmetics — the service already refuses those first |
| `render/decals.ts` | `DecalService` (`place`, `update`, `setCap`, `clear`, `destroy`, `live`, `cap`), `DecalSprite`, `makeDecalSprite` | same `setCap` hook, same reason. R12a's "skip the decal stamp when the previous frame exceeded 12 ms" (R22) is `setCap(0)` for a frame |
| `render/effects.ts` | `EffectRouter` (`onEvents`, `drainSeen`), `EffectCamera`, `makeEffectCamera` | R19's "the explosion and death events briefly raise bloom strength" is a **fourth constructor argument** on this class at High — the router already knows which events those are, and adding a filter handle is additive |
| `render/feedback-table.ts` | `FEEDBACK_TABLE`, `eventMagnitude`, `FeedbackSpec`, `BurstSpec`, `CameraPunch` | the one place a feel number lives. V5 adds no row; it may add a `bloom` field |

### Configuration

`config/particles.ts`: `ParticleKind`, `ParticlePriority`, `ParticleDef`, `PARTICLE_DEFS`, `PARTICLE_CONFIG` (`caps` 96/256/512 per R21, `informativeHeadroom` 1.25).
`config/decals.ts`: `DecalDef`, `DECAL_CONFIG` (`holdMs` 1200, `fadeMs` 2800, `maxLive` 16/48/96 per R21), **`DECAL_DEFS = []`**.

Both keyed by `BakeTier`, so V5's `TIER_TABLE` reads them rather than restating their numbers — **the tier table must not carry a second copy of the particle caps**, and `tiers.test.ts` should assert the two agree.

### `render/bake.ts` (extended for the fourth time)

`fxBakeJobs(ss, tier)` — the fourth job list, and `bakeJobs` is now a four-way concatenation. `BAKED_SHADOW`, `bakedMuzzleFrame(index)`, `bakedStatusFrame(statusId, index)`, `STATUS_FLIPBOOK_FRAMES` (4), `STATUS_TICKS_PER_FRAME` (8), `MUZZLE_FLASH_TICKS` (4). **The status flipbooks are the second thing on the sheet that varies by tier** (V3's flame flipbook was the first): at Low no status job is emitted at all, so `bakedStatusFrame` must never be called there — `CarDecor.statusBadges` returns immediately at Low, and that guard is load-bearing.

### `render/layers.ts` and the bands

`CAR_BAND` gains `shadow: -2` and `status: 40`. The band now runs from −2 to 60 inside a gap of 100, which `layers.test.ts`'s existing "the widest offset is under the gap to `Glow`" assertion still covers — extend it to check the *lowest* is above the gap to `Shots` as well, since this is the first negative offset anyone has used.

**`Layer.Decals`, `Layer.GroundFx` and `Layer.OverlayFx` all have tenants now**, which V2's Handoff listed as empty: decals (none live, but the pool's sprites are born there), `dust` and `debris`, and `smoke` and `shimmer` respectively. Every layer in the enum is now occupied except `Debug`, which is occupied only under `?debug=1`.

### `dev/bench-frame.ts` and the census

`benchEvents(tick, out)`, `BENCH_EVENT_PERIOD_TICKS` (12), `BENCH_DUST_RATE` (24). `SceneCensus` gains `particlesLive`, `particlesRefused`, `decalsLive` and `effectsByKind`. `scripts/bench-arena.mjs` gains `PARTICLE_HARD_CEILING`, `EVENT_KINDS` and three `benchFailures` clauses — including **one that fails when a decal is live**, which is a guard against a decision drifting rather than against a bug.

### Deliberately deferred by V4

- **Tiers and the governor.** Every cap is read at construction from `BAKE_DEFAULT_TIER` and never varied; `setCap` exists on both services and nothing calls it. **V5.**
- **Bloom, vignette, dpr, floor ambience** (R17, R19). `EffectRouter` is where the explosion and death bloom boost hooks in and it does not yet. **V5.**
- **No decal is authored.** Three §5 rows name one; none ships (R12a).
- **`predator`'s exhaust emitter and 2-frame flicker** (§5's projectile row). The service supports a stream and the kinds exist; wiring one per live `predator` instance is a shot-renderer change nobody has asked for at a measured cost. Left, and named so it is not forgotten.
- **A hit marker on the HUD.** §5's impact row mentions the shooter learning they connected; the HUD is V1's scene and a marker there is a HUD change, not a world one.
- **The wreck fading to a decal** (§5's death row). Needs an authored decal, so it needs R12a to be lifted first.

## Self-review

**Spec coverage.** R5: transients are pooled emitter output and the `Graphics`-circle-plus-tween spark is deleted (Tasks 1, 5). R16 in full: one emitter per (frame, layer) pair, `burst`/`stream`, tiered caps of 96/256/512 enforced by the service and not the callers, priority as informative-over-cosmetic, emitters created once per match and reused (Task 1, with the headroom rule stated because "refuse the lowest-priority request" cannot be applied retroactively). R12a in full: a pooled ground sprite, a global fade overridable per decal, a per-tier cap recycling the oldest, the service present, empty and unit-tested, and authoring declared out of scope in four places including a bench failure (Task 2). R18: `cameras.main.shake` and a 60 ms zoom punch, from `render/feedback-table.ts` by name, driven by events and not by local detection (Task 3). R9: every informative effect comes from a server event — the stronger of R9's two options — with the ambience/informative split stated where a reader would otherwise wonder about particle RNG (Task 3); the status and muzzle flipbooks advance from a tick through V3's own `flameFrameIndex` (Task 4). §5's transient rows: hit sparks and flash, kill burst and punch, ram and slam debris, respawn shimmer, status flipbooks, car shadow, muzzle flash (Tasks 3, 4); the rows needing an authored decal or a tier are named as deferred with their reasons. §10's V4 row: the Ships list is Tasks 1–4, the Deletes list is Task 5, and the three acceptance clauses are the Acceptance table's first three rows. Execution guide coupling 2: discharged by construction, with the reason written in the header rather than left as a step somebody has to remember.

**Placeholder scan.** Every new module — `config/particles.ts`, `config/decals.ts`, `render/particles.ts`, `render/decals.ts`, `render/feedback-table.ts`, `render/effects.ts`, `scenes/arena/status-badges.ts` — is printed in full, and so are the three bake job groups and `benchEvents`. Every edit to an existing file is a named substitution table or a printed block with the statement it follows named. Every test is real code with values read from the config it tests — `PARTICLE_CONFIG.caps`, `informativeHeadroom`, `PARTICLE_DEFS[kind].maxParticles`, `DECAL_CONFIG.holdMs`/`fadeMs`/`maxLive`, `STATUS_TABLE`, `COMBAT_CONFIG.hpPerRating`, `STATUS_FLIPBOOK_FRAMES` — rather than as digits. Two places name a thing to fix while typing rather than leaving it wrong: `DecalService`'s public `live` accessor against its private array, and `BAKED_ATLAS`'s possibly-unused import.

**Type consistency.** `MatchEvent` (shared, N23a, unchanged) is what `benchEvents` builds, what `RenderFrame.events` carries, what `ArenaScene.locateEvents` rewrites, what `EffectRouter.onEvents` walks, and what `FEEDBACK_TABLE` and `eventMagnitude` are keyed and switched on — one union, six consumers, and the exhaustive `switch` in `involvesLocal` is what makes a seventh kind a compile error rather than a silent no-op. `ParticleKind` is the key of `PARTICLE_DEFS`, the first parameter of `burst` and `stream`, and the `kind` field of `BurstSpec`; `ParticlePriority` is `burst`'s last parameter and `BurstSpec.priority`. `BakeTier` (V1, owned by `bake.ts`) keys `PARTICLE_CONFIG.caps` and `DECAL_CONFIG.maxLive` and is both services' constructor parameter — which is what lets V5's `TIER_TABLE` read those two objects instead of restating them. `DecalSprite` extends V2's `PoolSprite`, so a decal sprite satisfies the same contract every other pooled sprite does. `CarBadge` is filled by `carBadges` into a caller-owned array and read by `CarDecor.statusBadges`, field for field, with no intermediate shape.
