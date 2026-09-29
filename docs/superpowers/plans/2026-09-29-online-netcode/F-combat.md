# Phase F — combat under latency

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shooter on 80 ms loses almost nothing to latency (capped at 100 ms), their own shot appears the moment they press, and every player judges dodges against where shots really are relative to their own car.

**Architecture:** Each input frame carries `viewTick`. The server turns it into a clamped per-press compensation `k` and `runCombat` steps a freshly born instance `k` extra times through the same per-instance code path. On the client, a `ShotView` draws enemy shots advanced to the local predicted tick with the shared instance motion (no car hits), and the shooter's own press draws a provisional shot that the server's instance later replaces.

**Tech Stack:** TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-online-netcode-redesign-design.md` (NR35–NR41)

## Global Constraints

- `NET_CONFIG.shotCompCapMs: 100`.
- Fast-forward applies to projectile and beam instances only; never to maneuvers, statuses, or contact.
- A provisional shot never damages, never spawns impact FX, never feeds prediction.
- `combat.ts`'s existing phase order is preserved for `k = 0` — every existing combat test passes unchanged.

## Review Focus

- A client claiming `viewTick = 0` on every frame gets at most `capTicks`, and at most `allowedTicks` for its measured link — pinned in F1.
- A shot fast-forwarded into a wall detonates/ends at the wall on the spawn tick, exactly as if fired `k` ticks earlier — pinned in F2.
- A target standing inside the first `k` ticks of travel is hit on the spawn tick — pinned in F2.
- A press the server refuses (no stock) leaves no lingering provisional shot beyond `rtt + 100 ms` — pinned in F4.
- A bouncing projectile drawn at present by `ShotView` bounces off walls where the server's does — pinned in F3.

---

### Task F1: `viewTick` and the server's compensation budget

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`sendInputTick` sets `frame.viewTick = this.lastRenderTick`)
- Create: `packages/server/src/net/shot-comp.ts` (+ test)
- Modify: `packages/server/src/sim/tick.ts` (`TickResult.viewTicks: Map<string, number>` — the pressing frame's `viewTick`, when present)
- Modify: `packages/server/src/rooms/tick-pipeline.ts` (compute `compTicks` and pass it to `runCombat`), `packages/shared/src/config/net-config.ts` (`shotCompCapMs`)

**Interfaces:**
- Produces:
  ```ts
  export interface CompInputs { pressTick: number; viewTick: number | undefined; rttMs: number | undefined; slackMeanTicks: number; slackStdTicks: number }
  export function shotCompTicks(i: CompInputs): number;
  ```
  `k = clamp(pressTick − viewTick, 0, min(capTicks, allowedTicks))`, `capTicks = msToTicks(shotCompCapMs)`, `allowedTicks = ceil((rttMs / 2 + slackMeanTicks × MS_PER_TICK + 2 × (1000 / SNAPSHOT_RATE_HZ) + 2 × slackStdTicks × MS_PER_TICK) / MS_PER_TICK)`. `viewTick` or `rttMs` undefined → 0 (bots and harnesses get none).

- [ ] **Step 1: Tests**

```ts
// packages/server/src/net/shot-comp.test.ts
import { describe, expect, it } from "vitest";
import { NET_CONFIG, msToTicks } from "@motor-combat-moba/shared";
import { shotCompTicks } from "./shot-comp.js";

const cap = msToTicks(NET_CONFIG.shotCompCapMs);

describe("shotCompTicks (NR36)", () => {
  it("gives an honest 80 ms client its staleness, up to the cap", () => {
    expect(shotCompTicks({ pressTick: 1000, viewTick: 994, rttMs: 80, slackMeanTicks: 1.5, slackStdTicks: 0.3 })).toBe(Math.min(6, cap));
  });
  it("caps a liar at what its link allows", () => {
    const lan = shotCompTicks({ pressTick: 1000, viewTick: 0, rttMs: 1, slackMeanTicks: 1.5, slackStdTicks: 0 });
    expect(lan).toBeLessThan(cap);
    expect(lan).toBeGreaterThanOrEqual(1);
  });
  it("never exceeds the cap", () => {
    expect(shotCompTicks({ pressTick: 1000, viewTick: 0, rttMs: 500, slackMeanTicks: 10, slackStdTicks: 5 })).toBe(cap);
  });
  it("is zero without a viewTick or a measured RTT, and never negative", () => {
    expect(shotCompTicks({ pressTick: 1000, viewTick: undefined, rttMs: 80, slackMeanTicks: 1, slackStdTicks: 0 })).toBe(0);
    expect(shotCompTicks({ pressTick: 1000, viewTick: 994, rttMs: undefined, slackMeanTicks: 1, slackStdTicks: 0 })).toBe(0);
    expect(shotCompTicks({ pressTick: 1000, viewTick: 1005, rttMs: 80, slackMeanTicks: 1, slackStdTicks: 0 })).toBe(0);
  });
});
```

- [ ] **Step 2: Implement** `shot-comp.ts` exactly per the formula above.
- [ ] **Step 3: Thread it** — `serverTick` records `viewTicks.set(id, taken.frame.viewTick)` for a pressing frame; the pipeline builds `compTicks: Map<string, number>` with `shotCompTicks({ pressTick: state.tick, viewTick, rttMs: ctx.rttMsOf?.(id), slackMeanTicks, slackStdTicks })` (`PipelineCtx.rttMsOf` optional; rooms pass `(id) => sessions.rttMs(id)`, harnesses leave it undefined). Bump `PROTOCOL_VERSION`.
- [ ] **Step 4: Commit** `feat(net): per-press shot compensation budget (NR35, NR36)`.

---

### Task F2: Fast-forward inside `runCombat`

**Files:**
- Modify: `packages/shared/src/sim/combat.ts` (`CombatInput.fastForward?: ReadonlyMap<string, number>`)
- Test: `packages/shared/src/sim/combat.test.ts`

**Interfaces:** `CombatInput.fastForward` — owner session id → extra ticks for instances that owner spawns this tick.

- [ ] **Step 1: Read `runCombat` phases 2–4** (existing instances step, new presses spawn, hits resolve) and identify the per-instance body of phase 2 (`stepInstance` + homing target lookup + write-back) and of phase 4 (expiry, `hitsWorld`, car hits, `detonate`).
- [ ] **Step 2: Write the failing tests**

```ts
describe("shot fast-forward (NR37)", () => {
  it("a projectile fired with k=3 is where one fired 3 ticks earlier is", () => {
    // world A: press on tick T with fastForward {a: 3}; world B: press on tick T-3, then run 3 plain ticks.
    // Same empty arena, no targets. Compare the instance's x, y, angle after tick T in both worlds.
  });
  it("hits a target inside the first k ticks of travel on the spawn tick", () => {
    // target placed 2 ticks of flight ahead of the muzzle; k = 4; the target's hp drops on tick T.
  });
  it("ends at a wall inside the first k ticks, like an earlier shot would", () => {
    // wall 1 tick of flight ahead; k = 4; the instance is gone (or detonated) after tick T, same as world B.
  });
  it("k = 0 or absent changes nothing", () => {
    // run the same tick with fastForward undefined and with {a: 0}; results are deep-equal.
  });
});
```

Build these worlds with the helpers `combat.test.ts` already uses for its projectile cases (a shooter with one projectile weapon and full stocks, `world.tick` set explicitly).

- [ ] **Step 3: Implement** — extract phase 2's per-instance step into `advanceInstance(instance, …): WeaponInstance | undefined` and phase 4's per-instance resolution into `resolveInstance(instance, before, …)`. After spawning (phase 3), for each newly spawned instance whose owner has `k > 0` and whose kind is projectile or beam, loop `k` times: `before = inst; inst = advanceInstance(inst); resolveInstance(inst, before)`; stop early when it dies. Everything else about the tick is unchanged. The per-tick `world.tick` used inside the loop is the current tick (the shot lives in the present; only its travel is advanced).
- [ ] **Step 4: Wire** — the pipeline passes `fastForward: compTicks` into `runCombat`.
- [ ] **Step 5: Tests; commit** `feat(sim): fast-forward freshly fired shots by the shooter's clamped staleness (NR37, NR38)`.

---

### Task F3: `ShotView` — enemy shots drawn at present

**Files:**
- Create: `packages/shared/src/net/shot-view.ts` (+ test)
- Modify: `packages/client/src/scenes/ArenaScene.ts` / `combat-visual.ts` (use it instead of `extrapolateShot`; delete `extrapolateShot` and its test)

**Interfaces:**
```ts
export class ShotView {
  constructor(maxTicks: number);
  /** A snapshot's instance at its snapshot tick. */
  update(id: string, tick: number, instance: WeaponInstance, world: StepInstanceContext): void;
  /** The instance advanced to (fractional) tick with the shared motion, cars ignored, capped. */
  at(id: string, tick: number): WeaponInstance | undefined;
  forget(id: string): void;
}
```

- [ ] **Step 1: Tests** — a straight projectile at speed `v` advanced 3 ticks moves `3 × v × dt`; a bouncing projectile advanced across a wall reflects like `stepInstance` + `bounceOffWorld` do; capped at `maxTicks`.
- [ ] **Step 2: Implement** by stepping with `stepInstance` (and `bounceOffWorld` for bouncing rows, as `runCombat` does), cached per snapshot like `RemoteReckoner`; `maxTicks = msToTicks(maxExtrapolateMs + maxDelayMs)`.
- [ ] **Step 3: Wire** — enemy (non-own) instances draw at `ShotView.at(id, predictedTick)`; own instances draw at the same (they are the shooter's present); instances vanish when the server removes them.
- [ ] **Step 4: Commit** `feat(net): draw shots at the local present (NR40)`.

---

### Task F4: Provisional own shots

**Files:**
- Create: `packages/shared/src/net/provisional-shots.ts` (+ test)
- Modify: `packages/client/src/scenes/ArenaScene.ts`

**Interfaces:**
```ts
export interface Provisional { key: string; ownerId: string; slot: number; spawnTick: number; instance: WeaponInstance; bornAtMs: number }
export class ProvisionalShots {
  /** On a local press the client predicts will fire. */
  add(p: Provisional): void;
  /** Server instances seen this frame: matching provisionals (same owner, weapon, |spawnTick − p.spawnTick| ≤ 2) are confirmed and removed; returns the confirmed pairs. */
  confirm(serverInstances: readonly { id: string; ownerSessionId: string; weaponId: string; spawnTick: number }[]): { provisionalKey: string; serverId: string }[];
  /** Drop provisionals older than ttlMs. */
  expire(nowMs: number, ttlMs: number): string[];
  list(): readonly Provisional[];
}
```

- [ ] **Step 1: Tests** — add + confirm by matching tick window; a non-matching weapon does not confirm; expire after ttl.
- [ ] **Step 2: Wire** — on a press whose local slot state allows firing (stock > 0, `refireLockUntilTick` and `switchLockUntilTick` passed, not pending — read from the local player's slots), spawn a provisional with `spawnInstances` at the predicted muzzle for `spawnTick = P + windUpTicks`, advanced by the client's own `min(P − viewTick, capTicks)` with `ShotView` motion; draw provisionals with the same style as real shots; on confirm, hand the drawn position over by easing from the provisional's to the server instance's over 100 ms; `expire(now, clock.rttMs() + 100)`.
- [ ] **Step 3: Commit** `feat(net): draw your own shot the moment you fire (NR39)`.

---

### Task F5: Measure and document

- [ ] **Step 1:** Extend the netsim drivers with occasional fire presses (fixed seed) and add two metrics: `ownShotDelayMs` (press → first drawn frame of the shooter's shot, provisional or confirmed) and `shotConfirmJumpP95` (distance between a provisional and its confirming instance at hand-over). Record in EXECUTION.md.
- [ ] **Step 2:** `docs/networking.md` "Client — combat" rewritten for NR35–NR41 (the "v1 hit detection is current-tick" paragraph is replaced by the fast-forward rule and its cap); `docs/combat-model.md` gets a short "Latency" section pointing at it.
- [ ] **Step 3:** Summary says loudly: **combat's per-tick resolution changed for pressed shots with k > 0; the weapon probes (`weapons.ts`, `weapons2.ts`) run without latency so k = 0 there, but recommend `npm run playtest` anyway.**
- [ ] **Step 4: Commit** `docs(net): phase F numbers and docs`.
