# Phase E — remote cars and local prediction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remote cars glide on a tick-keyed timeline with a delay that adapts to the link, survive short stalls by dead reckoning, and are collided against at the pose they will have when your own inputs land.

**Architecture:** A shared `RemoteReckoner` steps a remote's newest snapshot forward with `stepSim` and its last known keys. A shared `TickInterpolation` draws each remote at render tick `R = serverTickNow − delay`, extrapolating through the reckoner (capped) when `R` passes the newest snapshot. Local prediction puts remotes into `StepContext.others` at their reckoned pose at `P`. Near contact, the drawn remote blends toward that same pose.

**Tech Stack:** TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-online-netcode-redesign-design.md` (NR29–NR34)

## Global Constraints

- `NET_CONFIG` values introduced here: `minDelayMs: 33`, `maxDelayMs: 250`, `maxExtrapolateMs: 100`, `extrapolateSettleMs: 100`, `contactBlendRangeCars: 2`.
- Interpolation and reckoning are keyed on snapshot ticks; arrival time is used only to measure lateness.
- The drawn pose of a remote never jumps by more than the car moved plus the settle ease (no teleports on a late snapshot).
- Reckoned poses are cached per snapshot and extended incrementally (NR32), never recomputed per frame from scratch.

## Review Focus

- A remote that stops sending (its snapshot stream continues but the car is coasting) must not be extrapolated past 100 ms of its newest snapshot — pinned in E2.
- A snapshot arriving after the renderer already extrapolated past it must ease, not snap — pinned in E2.
- A remote dead-reckoned into a wall stops at the wall (same `stepSim`) — pinned in E1.
- Spectating a remote (camera follows an interpolated car) still works with the new timeline — the existing `followCamera`/spectate tests stay green.
- A remote that dies or respawns resets its interpolation and reckoning (no slide from the death pose to the spawn) — pinned in E2.

---

### Task 1 (E1): `lastSteer`/`lastThrottle` and the `RemoteReckoner`

**Files:**
- Modify: `packages/shared/src/schema/PlayerState.ts` (`@type("int8") lastSteer = 0; @type("int8") lastThrottle = 0;`)
- Modify: `packages/server/src/sim/tick.ts` (write both from `taken.keys` every tick, also for a car that is not stepped)
- Create: `packages/shared/src/net/remote-reckoner.ts` (+ test); export from shared index
- Modify: `packages/shared/src/constants.ts` (`PROTOCOL_VERSION` + 1)

**Interfaces:**
- Produces:
  ```ts
  export interface ReckonSource { tick: number; body: SimBody; keys: InputKeys; ctx: StepContext }
  export class RemoteReckoner {
    constructor(maxTicks: number);
    /** A new authoritative snapshot for this car; drops the cache if tick moved. */
    update(id: string, source: ReckonSource): void;
    /** Pose at (fractional) tick, stepped from the newest snapshot, capped at maxTicks past it. */
    poseAt(id: string, tick: number): SimBody | undefined;
    /** How far past its newest snapshot `tick` is, in ticks (0 when at or before it). */
    overshoot(id: string, tick: number): number;
    forget(id: string): void;
  }
  ```

- [ ] **Step 1: Tests**

```ts
// packages/shared/src/net/remote-reckoner.test.ts
import { describe, expect, it } from "vitest";
import { stepSim } from "../sim/step.js";
import { MS_PER_TICK } from "../constants.js";
import { RemoteReckoner } from "./remote-reckoner.js";
// build `ctx` for an open arena and for one with a wall 30 u ahead the way step.test.ts builds its contexts

describe("RemoteReckoner", () => {
  it("steps the newest snapshot with the last keys, one tick at a time", () => {
    const r = new RemoteReckoner(6);
    r.update("a", { tick: 10, body, keys: { steer: 1, throttle: 1, fireSlots: 0 }, ctx });
    const expected = stepSim(stepSim(body, keys, MS_PER_TICK / 1000, ctx), keys, MS_PER_TICK / 1000, ctx);
    expect(r.poseAt("a", 12)).toEqual(expected);
  });
  it("interpolates between whole ticks", () => { /* poseAt(10.5) lies between poseAt(10) and poseAt(11) */ });
  it("never goes past maxTicks", () => { expect(r.poseAt("a", 100)).toEqual(r.poseAt("a", 16)); });
  it("stops at a wall because it is the same stepSim", () => { /* reckon toward the wall ctx; x never exceeds wall face − half hull */ });
  it("forgets a car", () => { r.forget("a"); expect(r.poseAt("a", 11)).toBeUndefined(); });
});
```

Fill the bodies using the same pose/ctx builders `packages/shared/src/sim/step.test.ts` uses (copy them into the test file).

- [ ] **Step 2: Implement**

```ts
// packages/shared/src/net/remote-reckoner.ts
import { MS_PER_TICK } from "../constants.js";
import { stepSim, type SimBody, type StepContext } from "../sim/step.js";
import { blendPose } from "./interpolation.js";
import type { InputKeys } from "./tick-input.js";

export interface ReckonSource { tick: number; body: SimBody; keys: InputKeys; ctx: StepContext }

const DT = MS_PER_TICK / 1000;

/** Dead reckoning for a remote car with the shared `stepSim` (NR31, NR32). */
export class RemoteReckoner {
  private readonly cars = new Map<string, { source: ReckonSource; steps: SimBody[] }>();

  constructor(private readonly maxTicks: number) {}

  update(id: string, source: ReckonSource): void {
    const cur = this.cars.get(id);
    if (cur && cur.source.tick === source.tick) return;
    this.cars.set(id, { source, steps: [source.body] });
  }

  private stepTo(id: string, whole: number): SimBody | undefined {
    const car = this.cars.get(id);
    if (!car) return undefined;
    const n = Math.max(0, Math.min(this.maxTicks, whole - car.source.tick));
    while (car.steps.length <= n) {
      car.steps.push(stepSim(car.steps[car.steps.length - 1]!, car.source.keys, DT, car.source.ctx));
    }
    return car.steps[n];
  }

  poseAt(id: string, tick: number): SimBody | undefined {
    const car = this.cars.get(id);
    if (!car) return undefined;
    const capped = Math.min(tick, car.source.tick + this.maxTicks);
    const lo = Math.floor(capped);
    const a = this.stepTo(id, lo);
    const b = this.stepTo(id, lo + 1);
    if (!a || !b) return a;
    return blendPose(a, b, capped - lo);
  }

  overshoot(id: string, tick: number): number {
    const car = this.cars.get(id);
    return car ? Math.max(0, tick - car.source.tick) : 0;
  }

  forget(id: string): void {
    this.cars.delete(id);
  }
}
```

(If `blendPose` does not carry every `SimBody` field, extend it to lerp `vx`, `vy`, `angVel` and copy the maneuver fields from `b` — check its current body first.)

- [ ] **Step 3: Server writes the keys**; `PROTOCOL_VERSION` + 1; tests green; commit

```bash
git add packages
git commit -m "feat(net): remote dead reckoning with the shared stepSim (NR31-NR33)"
```

---

### Task 2 (E2): `TickInterpolation` with adaptive delay and capped extrapolation

**Files:**
- Create: `packages/shared/src/net/tick-interpolation.ts` (+ test); export it
- Modify: `packages/shared/src/net/interpolation.ts` — delete `InterpolationBuffer` (keep `blendPose`)
- Modify: `packages/client/src/scenes/ArenaScene.ts` — replace `interps` and `remotePose`'s sampling
- Modify: `packages/server/src/netsim/tick-client.ts` (use it)

**Interfaces:**
- Consumes: E1 `RemoteReckoner`; D2 `ClockSync`.
- Produces:
  ```ts
  export class DisplayDelay {
    /** Record one snapshot's lateness: how far the server clock had moved past its tick on arrival. */
    onSnapshot(arrivalServerTick: number, snapshotTick: number): void;
    /** Current delay in ticks, moved at most 1 ms per call toward its target. */
    ticks(frameMs: number): number;
  }
  export class TickInterpolation {
    push(tick: number, body: SimBody): void;        // ascending ticks; out-of-order older ones ignored
    sample(renderTick: number): { body: SimBody; beyond: boolean } | undefined; // beyond = renderTick > newest tick
    newestTick(): number | undefined;
    reset(): void;
  }
  ```

- [ ] **Step 1: Tests**

```ts
// packages/shared/src/net/tick-interpolation.test.ts
import { describe, expect, it } from "vitest";
import { MS_PER_TICK, SNAPSHOT_RATE_HZ, TICK_RATE_HZ } from "../constants.js";
import { DisplayDelay, TickInterpolation } from "./tick-interpolation.js";

const at = (x: number) => ({ x, y: 0, angle: 0, vx: 0, vy: 0, angVel: 0, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0 });

describe("TickInterpolation", () => {
  it("interpolates by tick, not by arrival", () => {
    const b = new TickInterpolation();
    b.push(10, at(0));
    b.push(12, at(20));
    expect(b.sample(11)!.body.x).toBeCloseTo(10);
    expect(b.sample(11)!.beyond).toBe(false);
  });
  it("reports beyond past the newest snapshot and holds its pose", () => {
    const b = new TickInterpolation();
    b.push(10, at(0));
    expect(b.sample(13)).toMatchObject({ beyond: true, body: { x: 0 } });
  });
  it("ignores a snapshot older than the newest", () => {
    const b = new TickInterpolation();
    b.push(12, at(20));
    b.push(10, at(0));
    expect(b.newestTick()).toBe(12);
  });
});

describe("DisplayDelay", () => {
  it("settles near lateness p95 plus one snapshot interval, within the clamps", () => {
    const d = new DisplayDelay();
    for (let i = 0; i < 200; i++) d.onSnapshot(100 + i + 40 / MS_PER_TICK, 100 + i); // 40 ms late, no jitter
    let t = 0;
    for (let i = 0; i < 2000; i++) t = d.ticks(1000 / 60);
    const expectMs = 40 + 1000 / SNAPSHOT_RATE_HZ;
    expect(t * MS_PER_TICK).toBeCloseTo(expectMs, 0);
    expect(TICK_RATE_HZ).toBeGreaterThan(0);
  });
  it("never goes below minDelayMs on a perfect link", () => {
    const d = new DisplayDelay();
    for (let i = 0; i < 200; i++) d.onSnapshot(100 + i, 100 + i);
    let t = 0;
    for (let i = 0; i < 2000; i++) t = d.ticks(1000 / 60);
    expect(t * MS_PER_TICK).toBeGreaterThanOrEqual(33 - 1e-9);
  });
});
```

- [ ] **Step 2: Implement** — `TickInterpolation` keeps ≤ 64 snapshots, `sample` brackets by tick with `blendPose`; `DisplayDelay` keeps the last 120 lateness samples, target `clamp(p95(lateness) * MS_PER_TICK + 1000 / SNAPSHOT_RATE_HZ, minDelayMs, maxDelayMs)`, current moves ≤ 1 ms per `ticks()` call, starting at the target of its first sample.

- [ ] **Step 3: Wire `ArenaScene`** — on each snapshot (the existing state-change hook): `delay.onSnapshot(clock.serverTick(performance.now()), room.state.tick)`; for each remote: `interp.push(room.state.tick, bodyOf(player))` and `reckoner.update(id, { tick, body, keys: { steer: player.lastSteer, throttle: player.lastThrottle, fireSlots: 0 }, ctx: remoteCtx(id) })` where `remoteCtx` is `buildStepContext` for that car with its own modifiers and `others: []`. `remotePose(id)`:

```ts
const R = this.clock.serverTick(performance.now()) - this.delay.ticks(this.game.loop.delta);
const s = this.interps.get(id)?.sample(R);
if (!s) return fallback;
if (!s.beyond) return this.settle(id, s.body);
return this.settle(id, this.reckoner.poseAt(id, R) ?? s.body);
```

`settle(id, pose)` eases from the previous drawn pose when the previous frame was extrapolated and this one is not (over `extrapolateSettleMs`). On death, respawn, or a teleport (> 3 car lengths in one snapshot), `interp.reset()` and `reckoner.forget(id)`. (As built: `RemoteTimeline.forget(id)` does both; `interp.reset()` does not exist.)

Also record `viewTick = Math.floor(R)` on the scene for Phase F (`this.lastRenderTick`).

- [ ] **Step 4: netsim** — the tick client draws remotes the same way. Run `NETSIM_REPORT=1 npx vitest run --root packages/server src/netsim`.

- [ ] **Step 5: Commit**

```bash
git add -A packages
git commit -m "feat(net): tick-keyed interpolation, adaptive delay, capped extrapolation (NR29-NR31)"
```

---

### Task 3 (E3): Remotes at their reckoned pose in local prediction

**Files:**
- Modify: `packages/shared/src/net/step-context.ts` (`buildStepContext` gains `poseOf?: (sessionId: string) => { x: number; y: number; angle: number } | undefined`, used for every entry except `self`)
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`stepContext` passes `(id) => this.reckoner.poseAt(id, this.predictedTick)`)
- Test: `packages/shared/src/net/step-context.test.ts`

**Interfaces:** `buildStepContext(arena, state, self, tick, modifiers, poseOf?)`.

- [ ] **Step 1: Test** — with `poseOf` returning `{ x: 999, y: 999, angle: 0 }` for `"b"`, the built context's `others` hull for `b` is centred at (999, 999); without `poseOf` it is at `b`'s state pose.
- [ ] **Step 2: Implement** — override `x`, `y`, `angle` of each non-self `ContextPlayer` before it reaches `otherCarHulls` when `poseOf(id)` is defined.
- [ ] **Step 3: Wire** — `predictedTick` is the tick of the newest predicted frame (`scheduler`'s last produced tick). Reconcile's replay uses the same context.
- [ ] **Step 4: Tests; commit**

```bash
git add packages
git commit -m "feat(net): predict against remotes where they will be (NR32)"
```

---

### Task 4 (E4): Contact blend

**Files:**
- Create: `packages/shared/src/net/contact-blend.ts` (+ test)
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`remotePose` applies it)

**Interfaces:** `contactBlendWeight(distance: number, carLength: number, rangeCars: number): number` — 0 at ≥ `rangeCars × carLength`, 1 at ≤ `carLength`, linear between.

- [ ] **Step 1: Test** the three regions and monotonicity.
- [ ] **Step 2: Implement** and apply: `drawn = blendPose(interpolated, reckonedAtPredictedTick, contactBlendWeight(hypot(interpolated − localPredicted), DRIVE_CONFIG.carWidth, NET_CONFIG.contactBlendRangeCars))` (car length is the hull's long side, `carWidth` in this codebase — check `carHullOf`).
- [ ] **Step 3: Commit**

```bash
git add packages
git commit -m "feat(net): draw nearby remotes where you can hit them (NR34)"
```

---

### Task 5 (E5): Measure and document

- [ ] **Step 1:** `npm run build -w @motor-combat-moba/shared && NETSIM_BASELINE=1 NETSIM_REPORT=1 npx vitest run --root packages/server src/netsim`; fill the "after E" column from the mean over seeds 1–3 (the baseline's shape). Targets: path error p95 ≤ 12 u, hold ≤ 1 %, LAN display delay no worse than baseline with its interpolation component ≤ 50 ms (the harness measures the total: interpolation + snapshot age + link + frame). Misses are recorded as deviations with the tuning tried.
- [ ] **Step 2:** `docs/networking.md` — rewrite "Interpolation" and "Prediction context" for NR29–NR34; `docs/config-reference.md` NET_CONFIG rows; `docs/schema-reference.md` `lastSteer`/`lastThrottle`.
- [ ] **Step 3:** EXECUTION.md row → `Landed`; summary notes the playtest `prediction` probe measures a changed client; recommend a playtest run.
- [ ] **Step 4: Commit** `docs(net): phase E numbers and docs`.
