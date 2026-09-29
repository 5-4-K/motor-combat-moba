# Phase B — netsim harness and today's baseline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, headless harness that runs the real server pipeline against simulated clients over simulated links, and records today's numbers before anything changes.

**Architecture:** The client's pure net modules move to shared so the server package can run them. A `Link` models delay, jitter and TCP-style loss per direction. A runner advances one global millisecond clock, ticks a server world, delivers messages, and runs client frames. Metrics are computed against the server's own per-tick truth.

**Tech Stack:** TypeScript, vitest (node), `@motor-combat-moba/shared` built `dist`.

**Spec:** `docs/superpowers/specs/2026-09-29-online-netcode-redesign-design.md` (NR57–NR59, §1 metrics)

## Global Constraints

- The harness never imports Phaser, Colyseus, or anything under `packages/client/src/scenes/`.
- Deterministic: every random draw comes from a seeded PRNG passed in; the same seed gives byte-identical metrics.
- Each netsim test finishes in under 20 s on the CI container.
- Metric names and units are exactly those in EXECUTION.md's table.

## Review Focus

- A link with 0 jitter and 0 loss must deliver in send order at exactly `oneWayMs` — pinned in B2.
- A lost message must delay every later message on the same link (TCP head-of-line), not just itself — pinned in B2.
- Two runs with the same seed produce identical metrics — pinned in B3.
- A remote car that is standing still must not count as "held" — pinned in B3's hold metric test.
- The moved modules keep their tests passing unchanged in shared (only import paths move) — B1.

---

### Task 1 (B1): Move the client's pure net modules into shared

**Files:**
- Move: `packages/client/src/net/prediction.ts` → `packages/shared/src/net/prediction.ts` (and its test)
- Move: `packages/client/src/net/interpolation.ts` → `packages/shared/src/net/interpolation.ts` (and its test)
- Move: `packages/client/src/net/step-context.ts` → `packages/shared/src/net/step-context.ts` (and its test)
- Modify: `packages/shared/src/index.ts` (export all three)
- Modify: `packages/client/src/scenes/ArenaScene.ts:101-104` (import from `@motor-combat-moba/shared`)
- Modify: `packages/server/playtest/common/prediction.ts:33` (import from `@motor-combat-moba/shared`)
- Modify: comments naming the old paths: `packages/server/src/sim/tick.ts:118,318`, `packages/server/src/sim/tick.test.ts:866`, `docs/networking.md`

**Interfaces:**
- Produces (from `@motor-combat-moba/shared`): `PredictionBuffer`, `PendingInput`, `InterpolationBuffer`, `blendPose`, `buildStepContext`, `localModifiers`, `ContextState` — names and signatures unchanged.

- [ ] **Step 1: Move with git so history follows**

```bash
cd packages
for f in prediction interpolation step-context; do
  git mv client/src/net/$f.ts shared/src/net/$f.ts
  git mv client/src/net/$f.test.ts shared/src/net/$f.test.ts
done
```

- [ ] **Step 2: Fix imports inside the moved files**

In the three moved files and their tests, `from "@motor-combat-moba/shared"` becomes relative imports of the shared modules they use (e.g. `from "../constants.js"`, `from "../sim/step.js"`), following how neighbouring files in `packages/shared/src/net/` import. Run `npm run typecheck -w @motor-combat-moba/shared` until clean.

- [ ] **Step 3: Export from shared's index**

Add to `packages/shared/src/index.ts`:

```ts
export * from "./net/prediction.js";
export * from "./net/interpolation.js";
export * from "./net/step-context.js";
```

- [ ] **Step 4: Repoint consumers and typecheck everything**

Replace the four ArenaScene imports with one `import { InterpolationBuffer, PredictionBuffer, blendPose, buildStepContext, localModifiers } from "@motor-combat-moba/shared";` merged into its existing shared import. Same for `playtest/common/prediction.ts`. Update the comments that name the old paths.

Run: `npm run build -w @motor-combat-moba/shared && npm run typecheck`
Expected: clean.

- [ ] **Step 5: Tests**

Run: `npx vitest run --root packages/shared src/net && npx vitest run --root packages/client`
Expected: the moved tests pass in shared; the client suite has the same counts minus the moved files.

- [ ] **Step 6: Commit**

```bash
git add -A packages docs/networking.md
git commit -m "refactor(net): move prediction, interpolation and step context into shared (NR59)"
```

---

### Task 2 (B2): The `Link` model

**Files:**
- Create: `packages/server/src/netsim/rng.ts`
- Create: `packages/server/src/netsim/link.ts`
- Test: `packages/server/src/netsim/link.test.ts`

**Interfaces:**
- Produces:
  - `mulberry32(seed: number): () => number` (uniform [0, 1))
  - `interface LinkProfile { name: string; oneWayMs: number; jitterMs: number; lossPct: number }`
  - `const LINKS: { lan: LinkProfile; net80: LinkProfile; net150: LinkProfile }`
  - `class Link<T> { constructor(profile: LinkProfile, rng: () => number); send(nowMs: number, msg: T): void; receive(nowMs: number): T[]; readonly profile: LinkProfile }`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/server/src/netsim/link.test.ts
import { describe, expect, it } from "vitest";
import { LINKS, Link } from "./link.js";
import { mulberry32 } from "./rng.js";

describe("Link", () => {
  it("delivers in order at exactly oneWayMs with no jitter or loss", () => {
    const link = new Link<number>({ name: "t", oneWayMs: 40, jitterMs: 0, lossPct: 0 }, mulberry32(1));
    link.send(0, 1);
    link.send(5, 2);
    expect(link.receive(39)).toEqual([]);
    expect(link.receive(40)).toEqual([1]);
    expect(link.receive(44)).toEqual([]);
    expect(link.receive(45)).toEqual([2]);
  });

  it("never reorders, even with jitter", () => {
    const link = new Link<number>({ name: "t", oneWayMs: 40, jitterMs: 20, lossPct: 0 }, mulberry32(7));
    for (let i = 0; i < 200; i++) link.send(i, i);
    const got: number[] = [];
    for (let t = 0; t < 1000; t++) got.push(...link.receive(t));
    expect(got).toEqual([...Array(200).keys()]);
  });

  it("a lost message delays everything behind it by one round trip (head-of-line)", () => {
    const always = () => 0; // rng 0 < lossPct/100 → every message is 'lost' once
    const link = new Link<number>({ name: "t", oneWayMs: 40, jitterMs: 0, lossPct: 100 }, always);
    link.send(0, 1);
    link.send(1, 2);
    expect(link.receive(80)).toEqual([]);
    expect(link.receive(120)).toEqual([1]);
    expect(link.receive(121)).toEqual([2]);
  });

  it("the named profiles are the spec's", () => {
    expect(LINKS.lan).toMatchObject({ oneWayMs: 0.5, jitterMs: 0, lossPct: 0 });
    expect(LINKS.net80).toMatchObject({ oneWayMs: 40, jitterMs: 10, lossPct: 1 });
    expect(LINKS.net150).toMatchObject({ oneWayMs: 75, jitterMs: 15, lossPct: 1 });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root packages/server src/netsim/link.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

```ts
// packages/server/src/netsim/rng.ts
/** Small seeded PRNG so every netsim run is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

```ts
// packages/server/src/netsim/link.ts
export interface LinkProfile {
  name: string;
  oneWayMs: number;
  jitterMs: number;
  lossPct: number;
}

/** Spec NR1's link and the two it is judged beside. RTT = 2 × oneWayMs. */
export const LINKS = {
  lan: { name: "lan", oneWayMs: 0.5, jitterMs: 0, lossPct: 0 },
  net80: { name: "net80", oneWayMs: 40, jitterMs: 10, lossPct: 1 },
  net150: { name: "net150", oneWayMs: 75, jitterMs: 15, lossPct: 1 },
} as const satisfies Record<string, LinkProfile>;

/**
 * One direction of a WebSocket: in-order, reliable. Jitter varies each message's delay; a "lost"
 * message is retransmitted one round trip later, and because delivery is in order, everything sent
 * after it waits too — which is what TCP does to a game stream.
 */
export class Link<T> {
  private queue: { at: number; msg: T }[] = [];
  private lastAt = -Infinity;

  constructor(readonly profile: LinkProfile, private readonly rng: () => number) {}

  send(nowMs: number, msg: T): void {
    const { oneWayMs, jitterMs, lossPct } = this.profile;
    let at = nowMs + oneWayMs + (this.rng() * 2 - 1) * jitterMs;
    if (this.rng() < lossPct / 100) at += 2 * oneWayMs;
    at = Math.max(at, this.lastAt, nowMs);
    this.lastAt = at;
    this.queue.push({ at, msg });
  }

  receive(nowMs: number): T[] {
    let n = 0;
    while (n < this.queue.length && this.queue[n]!.at <= nowMs) n++;
    return this.queue.splice(0, n).map((e) => e.msg);
  }
}
```

Note the loss test's `always = () => 0`: jitter term is `(0*2-1)*0 = 0`, loss triggers, so message 1 lands at 0+40+80 = 120 and message 2 at max(1+40+80, 120) = 121.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run --root packages/server src/netsim/link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/netsim
git commit -m "test(netsim): seeded link model with jitter and head-of-line loss (NR57)"
```

---

### Task 3 (B3): Runner, legacy client model, metrics and the baseline

**Files:**
- Create: `packages/server/src/netsim/metrics.ts`
- Create: `packages/server/src/netsim/drivers.ts`
- Create: `packages/server/src/netsim/server-world.ts`
- Create: `packages/server/src/netsim/legacy-client.ts`
- Create: `packages/server/src/netsim/run.ts`
- Test: `packages/server/src/netsim/metrics.test.ts`, `packages/server/src/netsim/netsim.test.ts`
- Modify: `docs/superpowers/plans/2026-09-29-online-netcode/EXECUTION.md` (Baseline column)

**Interfaces:**
- Consumes: B1's shared exports; B2's `Link`, `LINKS`, `mulberry32`.
- Produces:
  - `percentile(values: number[], p: number): number` (p in [0,100], nearest-rank; empty → 0)
  - `interface NetsimMetrics { stepsPerTickMax: number; repeatedInputRate: number | null; remotePathErrorP95: number; remoteDisplayDelayMs: number; remoteHoldRate: number; reconcileErrorP95: number; inputToServerMs: number }`
  - `type ClientModel = "legacy"` (Phase D adds `"tick"`)
  - `runNetsim(opts: { link: LinkProfile; model: ClientModel; seconds: number; seed: number; cars?: number }): NetsimMetrics`
  - `interface ScriptedDriver { inputFor(tick: number): { steer: -1|0|1; throttle: -1|0|1; fireSlots: number } }` and `makeDriver(rng: () => number): ScriptedDriver`
  - `class ServerWorld` (see Step 3) — later phases swap its input path.

**Metric definitions (write these into `metrics.ts`'s doc comment):**
- `stepsPerTickMax` — the most `stepSim` calls any one car received in a single server tick.
- `repeatedInputRate` — share of car-ticks simulated on a repeated input; `null` for the legacy model.
- `remotePathErrorP95` — each client frame, for each remote car that is alive: distance from the drawn pose to the nearest point of that car's true trajectory over the last 400 ms (truth sampled per tick, linearly interpolated). p95 over all samples.
- `remoteDisplayDelayMs` — mean of (now − the truth time of that nearest point).
- `remoteHoldRate` — share of those samples where the drawn position equals the previous frame's drawn position (distance < 0.01 u) while the true car moved more than 1 u since the previous frame.
- `reconcileErrorP95` — at each snapshot the client reconciles, distance between its current predicted position and the replayed target, p95.
- `inputToServerMs` — mean of (the server time a car's input was simulated − the client time it was produced).

- [ ] **Step 1: Write the metrics test**

```ts
// packages/server/src/netsim/metrics.test.ts
import { describe, expect, it } from "vitest";
import { nearestOnPath, percentile } from "./metrics.js";

describe("netsim metrics", () => {
  it("percentile is nearest-rank", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
  });

  it("nearestOnPath finds the closest point and its time on a sampled path", () => {
    const path = [
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 100, y: 0 },
    ];
    const hit = nearestOnPath(path, 50, 10);
    expect(hit.distance).toBeCloseTo(10);
    expect(hit.t).toBeCloseTo(50);
  });
});
```

- [ ] **Step 2: Implement `metrics.ts`**

```ts
// packages/server/src/netsim/metrics.ts
/** (Paste the metric definitions from the plan here as the module doc.) */
export interface NetsimMetrics {
  stepsPerTickMax: number;
  repeatedInputRate: number | null;
  remotePathErrorP95: number;
  remoteDisplayDelayMs: number;
  remoteHoldRate: number;
  reconcileErrorP95: number;
  inputToServerMs: number;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

export interface PathPoint { t: number; x: number; y: number }

/** Closest point to (x, y) on the polyline through `path` (sorted by t), with its interpolated time. */
export function nearestOnPath(path: readonly PathPoint[], x: number, y: number): { distance: number; t: number } {
  let best = { distance: Infinity, t: path[0]?.t ?? 0 };
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1] ?? a;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const px = a.x + dx * u;
    const py = a.y + dy * u;
    const d = Math.hypot(x - px, y - py);
    if (d < best.distance) best = { distance: d, t: a.t + (b.t - a.t) * u };
  }
  return best;
}

export const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length);
```

Run: `npx vitest run --root packages/server src/netsim/metrics.test.ts` → PASS.

- [ ] **Step 3: `drivers.ts` and `server-world.ts`**

```ts
// packages/server/src/netsim/drivers.ts
export interface DriveKeys { steer: -1 | 0 | 1; throttle: -1 | 0 | 1; fireSlots: number }
export interface ScriptedDriver { inputFor(tick: number): DriveKeys }

/**
 * Weaving, mostly full throttle, a short reverse now and then — enough turning and contact to make
 * prediction and interpolation earn their keep. No firing in the baseline: combat is Phase F's.
 */
export function makeDriver(rng: () => number): ScriptedDriver {
  let until = 0;
  let keys: DriveKeys = { steer: 0, throttle: 1, fireSlots: 0 };
  return {
    inputFor(tick: number): DriveKeys {
      if (tick >= until) {
        const r = rng();
        const steer = r < 0.33 ? -1 : r < 0.66 ? 0 : 1;
        const throttle = rng() < 0.1 ? -1 : 1;
        keys = { steer, throttle, fireSlots: 0 };
        until = tick + 10 + Math.floor(rng() * 40);
      }
      return keys;
    },
  };
}
```

`server-world.ts` wraps the real pipeline the way `packages/server/playtest/modes/shared.ts`'s `World` does (copy its constructor, `add`, `ctx()` and `tick()` shape — `state.tick += 1`, `respawnSweep` when the mode respawns, `runPipeline`), under `withMode(modeConfigOf(GameMode.FFA_DEATHMATCH), …)` for every call. Cars spawn at `getArena("arena-01").ffaSpawns[i]` with `carId` cycling `["mirage", "bullseye", "bastion"]`. It exposes:

```ts
export class ServerWorld {
  readonly state: ArenaState;
  /** Legacy path: today's per-player queues. Phase D replaces this with tick input buffers. */
  readonly inputQueues: Map<string, InputMessage[]>;
  /** Server time in ms of each completed tick: tick * MS_PER_TICK. */
  timeOfTick(tick: number): number;
  /** Per car, the (tick, x, y) truth recorded after every tick. */
  readonly truth: Map<string, { t: number; x: number; y: number }[]>;
  /** Most `stepSim` calls one car got in the last tick (for legacy: min(queue length, maxInputsPerTick)). */
  lastTickMaxSteps: number;
  /** For each car, the seq → server ms at which that input was simulated. */
  readonly appliedAt: Map<string, Map<number, number>>;
  constructor(cars: number);
  tick(): void; // one pipeline tick; records truth, lastTickMaxSteps, appliedAt
  snapshot(): Snapshot;
}
export interface Snapshot {
  tick: number;
  cars: { id: string; body: SimBody; alive: boolean; lastProcessedInputSeq: number }[];
}
```

Record `lastTickMaxSteps` and `appliedAt` by inspecting each queue before `runPipeline` (length capped at `NET_CONFIG.maxInputsPerTick`, and the seqs that will be simulated).

- [ ] **Step 4: `legacy-client.ts` — today's client, headless**

Mirror `ArenaScene`'s current behaviour exactly (read `pumpInput`, `sendInputTick`, `reconcileLocal`, `remotePose` before writing):

```ts
export class LegacyClient {
  constructor(id: string, driver: ScriptedDriver, arena: ArenaDef);
  /** One render frame at client time nowMs; returns the input messages to send this frame. */
  frame(nowMs: number, deltaMs: number): InputMessage[];
  /** A snapshot arrived at client time nowMs. */
  onSnapshot(nowMs: number, snap: Snapshot): void;
  /** What this client would draw for a remote car right now (undefined if unknown). */
  drawnRemote(id: string, nowMs: number): { x: number; y: number } | undefined;
  /** Every reconcile's |predicted − target| distance, appended as it happens. */
  readonly reconcileErrors: number[];
  /** clientMs at which each seq was produced. */
  readonly producedAt: Map<number, number>;
}
```

- `frame`: `acc = min(acc + delta, MS_PER_TICK * NET_CONFIG.maxInputsPerTick)`; for each whole tick emit `{ seq: ++seq, ...driver.inputFor(seq), aimAngle: undefined }`, predict through `PredictionBuffer.predict` with `buildStepContext(arena, stateView, id, lastSnapTick, NEUTRAL_MODIFIERS)` where `stateView.players.forEach` walks the last snapshot's cars as `ContextPlayer`s.
- `onSnapshot`: push each remote's pose into its `InterpolationBuffer` at `nowMs`; reconcile the own car with `lastProcessedInputSeq`, recording `hypot(target − predicted)` by calling `reconcile` twice is wrong — instead compute the replayed target first (copy `reconcile`'s replay loop into a small helper `replayTarget(...)` in this file) and record its distance to the current predicted pose, then call `reconcile`.
- `drawnRemote`: `InterpolationBuffer.sample(nowMs)`.

- [ ] **Step 5: `run.ts`**

```ts
export function runNetsim(opts: { link: LinkProfile; model: ClientModel; seconds: number; seed: number; cars?: number }): NetsimMetrics
```

One loop over integer milliseconds `now = 0 … seconds*1000`:
1. Server: when `now >= nextTickAt`, `world.tick()`; every `1000 / DEFAULT_PATCH_RATE_HZ` ms after a tick, send `world.snapshot()` down each client's link.
2. Deliver: each client's up link → push `InputMessage`s into `world.inputQueues`; each down link → `client.onSnapshot(now, snap)`.
3. Clients: each client has its own frame phase (`i * 2.7 ms`) and runs `frame(now, 1000/60)` every 1000/60 ms, sending returned inputs up.
4. Sampling: on every client frame, for every other alive car, call `drawnRemote`, compute `nearestOnPath(truth window of the last 400 ms)`, and the hold test against the previous frame's drawn pose and truth.

Aggregate into `NetsimMetrics` using `percentile` and `mean`. `inputToServerMs` = mean over all (appliedAt − producedAt).

- [ ] **Step 6: The baseline test**

```ts
// packages/server/src/netsim/netsim.test.ts
import { describe, expect, it } from "vitest";
import { LINKS } from "./link.js";
import { runNetsim } from "./run.js";

const report = (label: string, m: object) => {
  if (process.env.NETSIM_REPORT) console.log(label, JSON.stringify(m));
};

describe("netsim — legacy client (today's netcode)", () => {
  it("is deterministic for a seed", () => {
    const a = runNetsim({ link: LINKS.net80, model: "legacy", seconds: 5, seed: 3 });
    const b = runNetsim({ link: LINKS.net80, model: "legacy", seconds: 5, seed: 3 });
    expect(a).toEqual(b);
  });

  for (const link of [LINKS.lan, LINKS.net80, LINKS.net150]) {
    it(`produces finite metrics on ${link.name}`, () => {
      const m = runNetsim({ link, model: "legacy", seconds: 20, seed: 1 });
      report(`legacy/${link.name}`, m);
      for (const v of Object.values(m)) if (v !== null) expect(Number.isFinite(v)).toBe(true);
      expect(m.stepsPerTickMax).toBeGreaterThanOrEqual(1);
    });
  }
});
```

Run: `npm run build -w @motor-combat-moba/shared && NETSIM_REPORT=1 npx vitest run --root packages/server src/netsim`
Expected: PASS, three JSON lines printed.

- [ ] **Step 7: Record the baseline**

Copy the printed numbers into EXECUTION.md's Baseline column (net80 for the net80 rows, lan for the lan rows; add a line under the table with the net150 values). Update the Phase B row to `Landed`, in-flight → Phase C, Task C1.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/netsim docs/superpowers/plans/2026-09-29-online-netcode/EXECUTION.md
git commit -m "test(netsim): runner, legacy client model and recorded baseline (NR57, NR58)"
```
