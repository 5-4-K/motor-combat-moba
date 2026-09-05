# Netcode Phase 3 — The Shared World Step and Whole-World Prediction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the whole per-tick world loop — statuses, driving, contact — into one shared pure function `stepWorld`, and make the client run it for **every** car from the newest snapshot up to its own present tick, correcting by re-simulation and hiding the correction in a decaying render offset.

**Architecture:** `packages/shared/src/sim/world.ts` gains `stepWorld(world, inputs, arena)`. `stepSim` is unchanged inside it; `resolveWorld` and `resolveContacts` are moved behind it unedited. The contact memory (the edge-trigger pair set and the slam clocks) stops being room-private and becomes part of `WorldState`, so a client resim starts from the same memory the server had. On the server `runPipeline` calls `stepWorld` where it called `serverTick` + `contactTick`; `runCombat` is untouched. On the client `ArenaNet` becomes `MatchClient`: it decodes snapshots into a `WorldState`, predicts the whole world forward with the local car's real inputs and each remote's echoed `lastInput`, reconciles by resim, and turns the difference into a per-car render offset that decays over `NET_CONFIG.correctionMs`. Nothing under `packages/client/src/match/` imports Phaser.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), npm workspaces, Colyseus (lobby and flow only), vitest in the **node** environment for shared/server/client, `node --test` for `scripts/*.test.mjs`, `tsx` for the headless harnesses.

**Spec:** [`2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) — §4 (approaches B and C), §6.4 (N13–N15), §6.5 (N16–N19), §6.6 (N20, N21), §6.9 (N23), §6.12, §6.13, §7, §8 phase 3, §9, §11.
**Ledger:** [`interfaces.md`](interfaces.md) — every shared name. **Previous phase:** [`12-netcode-2-wire.md`](12-netcode-2-wire.md) (read its `## Handoff` in full before Task 1); phase 1 is [`11-netcode-1-time.md`](11-netcode-1-time.md) and the preparation plan is [`01-prep-arena-scene-split-and-render-frame.md`](01-prep-arena-scene-split-and-render-frame.md). **Runbook:** [`00-execution-guide.md`](00-execution-guide.md) — §3 (how to run a plan), §5 (the N3 gate), §6 (the approach-B checkpoint), §7 (the `playtest` + `balance` runs this phase ends with).

## Global Constraints

- **Rebuild shared before testing**: `npm run build -w @motor-combat-moba/shared`. Server and client consume built `dist`; a stale `dist` looks like "I changed constants and nothing happened".
- **Verify with root `npm test`**, never a per-workspace run alone.
- **`.js` import specifiers** on every local import; shared is imported as `@motor-combat-moba/shared`.
- **Nothing under `packages/client/src/match/` imports Phaser, and no test imports Phaser.** Every test in this plan runs in vitest's node environment.
- **Do not touch `packages/server/playtest/` except to fix a compile break**, and say loudly in the task's commit step which probe numbers your change moves. Task 6 is the one task that edits probes, and it edits exactly two, both of which this phase breaks or invalidates.
- **Do not edit `docs/ideas/` or `docs/invariants/`.**
- **Commit after every task** on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch cut off it). `npm install` in a fresh worktree before the first build.
- **"main" means `development/main`.**
- **No new probe files and no new probe scenarios.** Task 6 extends the columns of the one harness the specs created (`playtest/netcode.ts`) and re-pins the two rows of `playtest/prediction.ts` that this phase makes obsolete.
- **Balance tables are untouched by this phase.** No weapon row, chassis row, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `STATUS_TABLE`, `AIM_CONFIG.lockRange`, `ARENA_WIDTH` or `TICK_RATE_HZ` value changes, so `npm run build:manual` and `docs/turn-tuning.md` are **not** owed an update. `protocolHash()` therefore does not move for a table reason — it moves once, in Task 1, because `PROTOCOL_VERSION` is bumped for the snapshot layout change.
- **The stop-and-ask fence (root `CLAUDE.md`) is not crossed.** Spec §11 authorises moving `resolveWorld` and `resolveContacts` behind `stepWorld` **unchanged**; this plan moves them and edits neither. Task 1 Step 8 names the one thing that *would* need the user's word and does not do it.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/sim/world.ts` (create) | `stepWorld`, `WorldState`, `CarState`, `ContactMemoryState`, `SlamClocks`, `ContactEvent`, `WorldStepResult`, `emptyContactMemory` |
| `packages/shared/src/sim/context.ts` (modify) | `solidHulls(cars, self)` — the hull rule stated over `{onField, phased}`; `otherCarHulls` re-expressed over it, unchanged in behaviour |
| `packages/shared/src/net/codec.ts` (modify) | `SnapshotCar.maneuverWeaponId` on the wire; `PROTOCOL_VERSION` 1 → 2 |
| `packages/shared/src/config/net-config.ts` (modify) | add the seven phase-3 keys; delete `interpolationDelayMs` and the three `reconcile*` keys |
| `packages/shared/src/index.ts` (modify) | export `sim/world.ts` and `solidHulls` |
| `packages/server/src/sim/world-bridge.ts` (create) | `worldTick`: schema ⇄ `WorldState`, the ring reads, and the one `stepWorld` call site |
| `packages/server/src/sim/ram-bridge.ts` (modify) | reduced to `clearKnock` and `wallStunSweep`; `contactTick`, `ContactMemory`, `newContactMemory` deleted |
| `packages/server/src/sim/tick.ts` (delete) | `serverTick` is absorbed by `worldTick` |
| `packages/server/src/sim/status-bridge.ts` (modify) | `statusTick` deleted; `readStatuses`/`writeStatuses`/`clearPlayerStatuses`/`modifiersFor` stay |
| `packages/server/src/rooms/tick-pipeline.ts` (modify) | `runPipeline` calls `worldTick`, then `wallStunSweep`, then combat |
| `packages/server/src/rooms/{ArenaRoom,PracticeRoom,PlaygroundRoom}.ts` (modify) | the contact-memory field's type and constructor |
| `packages/server/src/net/snapshot-source.ts` (modify) | `buildSnapshot` fills `maneuverWeaponId` |
| `packages/client/src/match/local-inputs.ts` (create) | `LocalInputs` — the local input history keyed by tick, for resim |
| `packages/client/src/match/prediction.ts` (create) | `WorldPredictor` — baseline, predicted-world ring, remote extrapolation, resim |
| `packages/client/src/match/render-offset.ts` (create) | `RenderOffsets` — per-car correction offsets, decay, snap counting; `wrapAngle` |
| `packages/client/src/match/match-client.ts` (create) | `MatchClient` — the headless match state machine (`seed`, `pumpInput`, `onSnapshot`, `frame`) |
| `packages/client/src/match/arena-net.ts` (delete) | replaced by `match-client.ts` |
| `packages/client/src/net/prediction.ts` (delete) | `PredictionBuffer` is absorbed by `WorldPredictor` |
| `packages/client/src/net/interpolation.ts` (modify) | `InterpolationBuffer` deleted; `blendPose` stays |
| `packages/client/src/net/step-context.ts` (delete) | `buildStepContext`/`localModifiers` are absorbed by `stepWorld` |
| `packages/client/src/match/render-frame.ts` (modify) | `RenderCar.lastProcessedInputSeq` → `ackTick` |
| `packages/client/src/match/netgraph.ts` (modify) | `recordCorrection` reads `NET_CONFIG.snapUnits` |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | composes `MatchClient`; the connection-interrupted overlay |
| `packages/server/playtest/netcode.ts` (modify) | the three phase-3 acceptance columns and the checkpoint note |
| `packages/server/playtest/prediction.ts` (modify) | re-pinned: P1's verdict, P2's premise |
| `packages/server/playtest/world.ts` (modify) | compile break: the pipeline it mirrors changed |
| `packages/server/balance/match.ts` (modify) | compile break: `ctx.ram`'s type |
| `docs/superpowers/plans/2026-09-04-netcode-and-rendering/interfaces.md` (modify) | the three ledger additions, in Task 1's commit |
| root `CLAUDE.md`, `docs/networking.md`, `docs/architecture.md`, `docs/config-reference.md`, `docs/project-structure.md`, `docs/glossary.md`, `packages/*/CLAUDE.md` (modify) | invariants 4 and 8, and the pages the spec §12 lists |

---

### Task 1: `stepWorld` — the shared world step (N13, N15)

**Files:**
- Create: `packages/shared/src/sim/world.ts`
- Modify: `packages/shared/src/sim/context.ts:88-122` (the body of `otherCarHulls`), `packages/shared/src/net/codec.ts` (`PROTOCOL_VERSION`, `SnapshotCar`, the maneuver group), `packages/shared/src/config/net-config.ts`, `packages/shared/src/index.ts`, `docs/superpowers/plans/2026-09-04-netcode-and-rendering/interfaces.md`
- Test: `packages/shared/src/sim/world.test.ts`, `packages/shared/src/sim/context.test.ts` (append one describe), `packages/shared/src/net/codec.test.ts` (three byte figures and one field)

**Interfaces:**
- Consumes: `stepSim`/`SimBody`/`StepContext` (`sim/step.ts`), `resolveContacts`/`ContactCar` (`sim/contact.ts`), `expireStatuses`/`expireStatusesFromSource`/`toActiveStatuses`/`modifiersFromRows`/`isPhasedAt`/`hasStatus` (`sim/status/statuses.ts`), `forwardMaxSpeedOf` (`config/car-config.ts`), `SLAM_CONFIG`/`SLAM_TICKS`, `weaponDefOf`/`isWeaponId`, `NEUTRAL_INPUT`/`InputFrame` (`net/input.ts`), `MS_PER_TICK`, `ArenaDef`.
- Produces: the whole ledger block for `sim/world.ts`, plus `emptyContactMemory()`, `SlamClocks.bySessionId`, `CarState.team`, `CarState.maneuverWeaponId`, `WorldState.mode`; `solidHulls`/`SolidCar` in `sim/context.ts`; `SnapshotCar.maneuverWeaponId`; the seven `NET_CONFIG` keys. Tasks 2–6 consume all of it.

#### What moves, and what is authorised to move

Spec §11, verbatim on this point: *"Physics engine: none. `resolveWorld` and `resolveContacts` move behind `stepWorld` unchanged."* That is the authorisation this task uses and its exact limit.

| Code | Where it lives today | What this task does |
|---|---|---|
| `stepDrive`, `resolveWorld`, `resolveDash`, `stepSim` | `shared/src/sim/{drive,collide,step}.ts` | **not edited at all.** `stepWorld` calls `stepSim` once per on-field car per tick, exactly as `serverTick` does today |
| `resolveContacts`, `resolveRam`, `resolvePair`, `hullTouchesWorld` | `shared/src/sim/{contact,ram}.ts` | **not edited at all.** `stepWorld` calls `resolveContacts` with the same seven arguments `contactTick` passes today |
| the per-car drive loop | `server/src/sim/tick.ts:129-216` | moved into `stepWorld`, minus the schema |
| the contact bridge's pure half | `server/src/sim/ram-bridge.ts:154-236` | moved into `stepWorld`, minus the schema: `contactCarsOf`, the knock write, `endDash` on wall-blocked dashers, the one-target-per-dash rule, the slam clocks and the attacker's self-status expiry |
| the wall-stun sweep | `server/src/sim/ram-bridge.ts:238-268` | **stays on the server** as `wallStunSweep` (Task 2). It emits a `StatusRequest` on a *third* car, which N14 keeps server-only, and the client must not predict it (N21) |
| the status expiry sweep | `server/src/sim/status-bridge.ts:75-86` | moved into `stepWorld` so both halves sweep at the same tick, through the same function |

**Not authorised, and therefore not done.** `resolveContacts` returns `knocks`, the touching set and `{ dashHits, slams, wallBlockedDashers }`. It resolves an ordinary **ram** internally (`resolvePair` → `resolveRam` → the `best` map) and reports only the resulting knock, which names the victim and carries no attacker, no impact point and no severity. So `stepWorld` cannot emit a `ContactEvent` of kind `"ram"` without `resolveContacts` reporting the ram it already resolved. That would be a purely additive change to its return value with **no behavioural effect whatsoever** — but §11 authorises moving it *unchanged*, and the contact resolver sits behind the root `CLAUDE.md` fence, so this plan does not make it. `"ram"` stays in the `ContactEvent` union (the ledger types it) and `stepWorld` never emits one; Task 1 Step 4 pins that with a test. The feedback layer has what it needs without it: `WorldState.contact.touching` is on both machines, and a pair that appears in it this tick and not last tick **is** the ram, at the sim's own resolution and in one timebase — which is the F7 fix. If a later phase wants the severity and the impact point, ask the user for the additive `resolveContacts` return field first.

- [ ] **Step 1: Add the seven `NET_CONFIG` keys and delete the four this phase retires**

`packages/shared/src/config/net-config.ts` — delete `interpolationDelayMs`, `reconcileSnapPos`, `reconcileSnapAngle` and `reconcileEaseRate` (N1 already deleted `maxInputsPerTick` and `pendingInputCap`), and add:

```ts
  /**
   * Jitter buffer clamp, in ticks (N18). Snapshots are applied when they are
   * `ceil(2 * jitterMs / MS_PER_TICK) - snapshotEvery` ticks old, clamped to `[0, bufferTicksMax]`.
   * At 60 Hz snapshots on an ordinary link that expression is zero — the next snapshot covers a late
   * one — so the buffer costs nothing until the link is genuinely jittery.
   */
  bufferTicksMax: 4,
  /**
   * How far the client may predict past its newest baseline before it freezes the world and shows
   * the connection overlay (N18). 30 ticks is 500 ms at 60 Hz. It is also the hard bound on one
   * resim: the worst case is 30 `stepWorld` calls of six cars, once, on the snapshot that ends a
   * stall.
   */
  maxPredictionTicks: 30,
  /**
   * How far a remote may be extrapolated past the baseline on its echoed `lastInput` (N20). Past
   * this the car holds where it is: it stays solid, it takes no further input, and the next
   * snapshot corrects it. 8 ticks is 133 ms, just inside the 136 ms design-point window of §6.6.
   */
  maxExtrapolationTicks: 8,
  /**
   * How long an extrapolated remote keeps a HELD STEER before the predictor assumes it was released
   * (N20). Client-only and with no sim meaning: it changes what this machine guesses, never what
   * the server does. The harness reports which value minimises mean remote error.
   */
  remoteSteerHoldTicks: 6,
  /**
   * How long a correction takes to decay out of the renderer (N19). About 7 frames at 60 Hz.
   */
  correctionMs: 120,
  /**
   * A correction past either of these is applied with NO offset — a slow slide over a whole car
   * length reads worse than a cut — and counted in the netgraph as a snap. `snapUnits` is one car
   * length; §8's phase 3 acceptance is that this counter stays at zero at the design point.
   */
  snapUnits: 48,
  snapRadians: Math.PI / 2,
```

`NET_CONFIG` is `as const`, so `Math.PI / 2` is fine as a value expression; keep the object's existing `as const` suffix.

- [ ] **Step 2: `solidHulls` — the hull rule stated over `{onField, phased}`**

`stepWorld` has `CarState`, which carries `onField` and `phased` directly and carries neither `status` nor `alive`. `otherCarHulls` takes `ContextEntry[]` and derives both through `isSolid`. Rather than give `CarState` two redundant fields, state the rule once over the two booleans and express `otherCarHulls` in terms of it. Replace the **body** of `otherCarHulls` (`context.ts:88-122` — the doc comment above it is kept verbatim, including its two-direction rationale) and add `solidHulls` above it:

```ts
/** A car as the hull rule sees it: a pose plus the two gates. */
export interface SolidCar {
  sessionId: string;
  x: number;
  y: number;
  angle: number;
  /** The MOVER gate — `isOnField` on the server, `SnapshotCar.onField` on the client. */
  onField: boolean;
  /** The other half of the WALL gate — `isPhasedAt(statuses, tick)`, evaluated at the tick being simulated. */
  phased: boolean;
}

/**
 * Hulls of every *other* solid car, in the order `cars` are given — UNLESS the caller itself is not
 * solid, in which case this returns `[]` regardless of who else is on the field.
 *
 * This is the whole wall gate, in one place, over the two booleans that decide it. `otherCarHulls`
 * below is the `ContextPlayer` spelling of the same rule and delegates here, so a change to
 * intangibility is one edit and cannot land on one side of the lockstep only.
 *
 * Order is load-bearing rather than cosmetic: `resolveWorld` applies contacts sequentially over
 * `others`, and the last contact resolved is the one guaranteed to end separated. `stepWorld` passes
 * cars in car-index order; two hulls swapped here can settle a squeezed car on a different pose.
 */
export function solidHulls(cars: readonly SolidCar[], selfSessionId: string): Obb[] {
  const self = cars.find((car) => car.sessionId === selfSessionId);
  // A non-solid caller sees NOTHING, on top of being filtered out of everyone else's list below.
  // Both directions are required for real intangibility — see `otherCarHulls`' comment.
  if (self && !(self.onField && !self.phased)) return [];

  const hulls: Obb[] = [];
  for (const car of cars) {
    if (car.sessionId === selfSessionId) continue;
    if (!car.onField || car.phased) continue;
    hulls.push(carHullOf(car.x, car.y, car.angle));
  }
  return hulls;
}
```

and the new body of `otherCarHulls`:

```ts
export function otherCarHulls(
  entries: readonly ContextEntry[],
  selfSessionId: string,
  tick: number,
): Obb[] {
  return solidHulls(
    entries.map(({ sessionId, player }) => ({
      sessionId,
      x: player.x,
      y: player.y,
      angle: player.angle,
      onField: isOnField(player),
      phased: isPhasedAt(player.statuses, tick),
    })),
    selfSessionId,
  );
}
```

`isPhasedAt` is already imported by this file (it is what `isSolid` calls); add nothing. `isSolid` stays exactly as it is — `respawnSweep`, `phaseEndSweep`, `overlapsSolid` and the wall-stun sweep all still call it.

Append to `packages/shared/src/sim/context.test.ts`:

```ts
describe("solidHulls", () => {
  const at = (sessionId: string, x: number, over: Partial<SolidCar> = {}): SolidCar => ({
    sessionId, x, y: 360, angle: 0, onField: true, phased: false, ...over,
  });

  it("gives every other solid car's hull, in the order handed in", () => {
    const hulls = solidHulls([at("a", 100), at("b", 200), at("c", 300)], "b");
    expect(hulls.map((h) => h.x)).toEqual([100, 300]);
  });

  it("hides everyone from a phased caller, and hides a phased car from everyone", () => {
    expect(solidHulls([at("a", 100, { phased: true }), at("b", 200)], "a")).toEqual([]);
    expect(solidHulls([at("a", 100, { phased: true }), at("b", 200)], "b")).toEqual([]);
  });

  it("drops a car that is off the field, and defaults an unlisted caller to solid", () => {
    expect(solidHulls([at("a", 100, { onField: false }), at("b", 200)], "b")).toEqual([]);
    expect(solidHulls([at("a", 100), at("b", 200)], "zz").map((h) => h.x)).toEqual([100, 200]);
  });

  it("is what otherCarHulls answers, for the same roster", () => {
    const entries = [
      { sessionId: "a", player: { x: 100, y: 360, angle: 0, status: PlayerStatus.IN_MATCH, carId: "mirage", alive: true, statuses: [] } },
      { sessionId: "b", player: { x: 200, y: 360, angle: 0, status: PlayerStatus.IN_MATCH, carId: "mirage", alive: true, statuses: [] } },
    ];
    expect(otherCarHulls(entries, "a", 0)).toEqual(solidHulls([at("a", 100), at("b", 200)], "a"));
  });
});
```

- [ ] **Step 3: Write the failing `stepWorld` test**

```ts
// packages/shared/src/sim/world.test.ts
import { describe, expect, it } from "vitest";
import { getArena } from "../arena/registry.js";
import { SLAM_TICKS } from "../config/slam-config.js";
import { MS_PER_TICK } from "../constants.js";
import { NEUTRAL_INPUT, type InputFrame } from "../net/input.js";
import { ManeuverKind } from "./maneuver.js";
import { NEUTRAL_MODIFIERS } from "./status/modifiers.js";
import { stepSim } from "./step.js";
import {
  emptyContactMemory, stepWorld, type CarState, type WorldState,
} from "./world.js";

const ARENA = getArena("arena-01");
const DT = MS_PER_TICK / 1000;
const FORWARD: InputFrame = { steer: 0, throttle: 1, fireSlots: 0 };

function car(index: number, sessionId: string, x: number, over: Partial<CarState> = {}): CarState {
  return {
    index, sessionId, carId: "mirage", team: 0, onField: true, phased: false,
    maneuverWeaponId: "", statuses: [],
    x, y: 360, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0,
    authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
    ...over,
  };
}

function world(cars: CarState[], tick = 100): WorldState {
  return { tick, mode: "ffa", cars, contact: emptyContactMemory() };
}

describe("stepWorld — driving", () => {
  it("advances a lone car to exactly what stepSim answers, and names the next tick", () => {
    const before = world([car(0, "a", 300)]);
    const out = stepWorld(before, new Map([["a", FORWARD]]), ARENA);
    const expected = stepSim(before.cars[0]!, FORWARD, DT, {
      carId: "mirage", others: [], obstacles: ARENA.obstacles,
      bounds: { width: ARENA.width, height: ARENA.height }, modifiers: NEUTRAL_MODIFIERS,
    });
    expect(out.world.tick).toBe(101);
    expect(out.world.cars[0]!.x).toBe(expected.x);
    expect(out.world.cars[0]!.speed).toBe(expected.speed);
    expect(out.world.cars[0]!.angle).toBe(expected.angle);
  });

  it("steps a car with no input on neutral, so a knock decays without anyone talking", () => {
    const knocked = car(0, "a", 300, { angVel: 3, shoveX: 200, authority: 0.4 });
    const out = stepWorld(world([knocked]), new Map(), ARENA);
    const after = out.world.cars[0]!;
    expect(Math.abs(after.angVel)).toBeLessThan(3);
    expect(Math.abs(after.shoveX)).toBeLessThan(200);
    expect(after.authority).toBeGreaterThan(0.4);
  });

  it("never moves a car that is off the field", () => {
    const out = stepWorld(world([car(0, "a", 300, { onField: false })]), new Map([["a", FORWARD]]), ARENA);
    expect(out.world.cars[0]!.x).toBe(300);
    expect(out.world.cars[0]!.speed).toBe(0);
  });

  it("returns cars in car-index order however they arrive", () => {
    const out = stepWorld(world([car(2, "c", 500), car(0, "a", 300), car(1, "b", 400)]), new Map(), ARENA);
    expect(out.world.cars.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("records the speed every car carried INTO the tick, stepped or not", () => {
    const out = stepWorld(
      world([car(0, "a", 300, { speed: 120 }), car(1, "b", 900, { speed: 55, onField: false })]),
      new Map([["a", FORWARD]]),
      ARENA,
    );
    expect(out.approachSpeeds.get("a")).toBe(120);
    expect(out.approachSpeeds.get("b")).toBe(55);
    expect(out.world.cars[0]!.speed).toBeGreaterThan(120);
  });

  it("sweeps a status whose clock ran out before deriving the modifiers it drives under", () => {
    const slowed = car(0, "a", 300, {
      statuses: [{ statusId: "spiked", startTick: 50, endsTick: 101, sourceSessionId: "b" }],
    });
    const stillOn = stepWorld(world([slowed], 99), new Map([["a", FORWARD]]), ARENA).world.cars[0]!;
    const lapsed = stepWorld(world([slowed], 100), new Map([["a", FORWARD]]), ARENA).world.cars[0]!;
    expect(stillOn.statuses).toHaveLength(1);
    expect(lapsed.statuses).toHaveLength(0);
    expect(lapsed.speed).toBeGreaterThan(stillOn.speed);
  });

  it("derives `phased` from the swept rows rather than trusting the caller", () => {
    const respawning = car(0, "a", 300, {
      phased: false,
      statuses: [{ statusId: "phased", startTick: 90, endsTick: 200, sourceSessionId: "" }],
    });
    expect(stepWorld(world([respawning]), new Map(), ARENA).world.cars[0]!.phased).toBe(true);
  });
});

describe("stepWorld — contact", () => {
  const overlapping = (): CarState[] => [
    car(0, "a", 300, { speed: 300 }),
    car(1, "b", 330, { angle: Math.PI, speed: 300 }),
  ];

  it("writes a knock on a fresh touch and remembers the pair", () => {
    const out = stepWorld(world(overlapping()), new Map(), ARENA);
    expect([...out.world.contact.touching]).toEqual(["a|b"]);
    expect(out.world.cars.some((c) => c.authority < 1)).toBe(true);
  });

  it("is edge-triggered: the same pair still touching next tick writes no new knock", () => {
    const first = stepWorld(world(overlapping()), new Map(), ARENA);
    const held = { ...first.world, cars: first.world.cars.map((c) => ({ ...c, authority: 1, angVel: 0, shoveX: 0, shoveY: 0 })) };
    const second = stepWorld(held, new Map(), ARENA);
    expect([...second.world.contact.touching]).toEqual(["a|b"]);
    expect(second.world.cars.every((c) => c.authority === 1)).toBe(true);
  });

  it("emits no `ram` contact event — resolveContacts does not report one, by design", () => {
    const out = stepWorld(world(overlapping()), new Map(), ARENA);
    expect(out.contactEvents.filter((e) => e.kind === "ram")).toEqual([]);
  });

  it("reports a dash hit, ends the dash at the chassis cap, and hits only one car per tick", () => {
    const dasher = car(0, "a", 300, {
      maneuver: ManeuverKind.DASH, maneuverTicksLeft: 10, maneuverAngle: 0, maneuverSpeed: 1600,
      maneuverWeaponId: "thunderclap",
    });
    const out = stepWorld(world([dasher, car(1, "b", 330, { angle: Math.PI }), car(2, "c", 336, { angle: Math.PI })]), new Map(), ARENA);
    const hits = out.contactEvents.filter((e) => e.kind === "dashHit");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.attacker).toBe("a");
    expect(hits[0]!.tick).toBe(101);
    const after = out.world.cars.find((c) => c.sessionId === "a")!;
    expect(after.maneuver).toBe(ManeuverKind.NONE);
    expect(after.maneuverTicksLeft).toBe(0);
  });

  it("reports a slam, starts both clocks, and ends the charge keeping 70% of the approach speed", () => {
    const charger = car(0, "a", 300, {
      speed: 400, maneuver: ManeuverKind.CHARGE, maneuverTicksLeft: 300, maneuverWeaponId: "wildcharge",
    });
    const out = stepWorld(world([charger, car(1, "b", 330, { angle: Math.PI })]), new Map(), ARENA);
    const slams = out.contactEvents.filter((e) => e.kind === "slam");
    expect(slams).toHaveLength(1);
    expect(slams[0]!.severity).toBe(1);
    const clocks = out.world.contact.slammed.get("b")!;
    expect(clocks.bySessionId).toBe("a");
    expect(clocks.stunWindowUntilTick).toBe(101 + SLAM_TICKS.wallStunWindow);
    expect(clocks.immuneUntilTick).toBe(101 + SLAM_TICKS.reslamImmunity);
    expect(out.world.cars[0]!.maneuver).toBe(ManeuverKind.NONE);
    expect(out.world.cars[0]!.speed).toBeCloseTo(400 * 0.7, 6);
  });

  it("takes the charger's own statuses with the charge that ended", () => {
    const charger = car(0, "a", 300, {
      speed: 400, maneuver: ManeuverKind.CHARGE, maneuverTicksLeft: 300, maneuverWeaponId: "wildcharge",
      statuses: [{ statusId: "spiked", startTick: 90, endsTick: 400, sourceSessionId: "a" }],
    });
    const out = stepWorld(world([charger, car(1, "b", 330, { angle: Math.PI })]), new Map(), ARENA);
    expect(out.world.cars[0]!.statuses).toHaveLength(0);
  });

  it("forgets a slam record once both of its clocks have run out", () => {
    const done: WorldState = {
      ...world([car(0, "a", 300)], 900),
      contact: {
        touching: new Set(),
        slammed: new Map([["b", { bySessionId: "a", stunWindowUntilTick: 800, immuneUntilTick: 850 }]]),
      },
    };
    expect(stepWorld(done, new Map(), ARENA).world.contact.slammed.size).toBe(0);
  });

  it("leaves a phased car out of contact entirely", () => {
    const cars = overlapping();
    cars[1] = { ...cars[1]!, statuses: [{ statusId: "phased", startTick: 90, endsTick: 400, sourceSessionId: "" }] };
    const out = stepWorld(world(cars), new Map(), ARENA);
    expect([...out.world.contact.touching]).toEqual([]);
    expect(out.world.cars.every((c) => c.authority === 1)).toBe(true);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd packages/shared && npx vitest run src/sim/world.test.ts`
Expected: FAIL — cannot resolve `./world.js`.

- [ ] **Step 5: Write `sim/world.ts`**

```ts
// packages/shared/src/sim/world.ts
import type { ArenaDef } from "../arena/types.js";
import { forwardMaxSpeedOf } from "../config/car-config.js";
import { SLAM_CONFIG, SLAM_TICKS } from "../config/slam-config.js";
import type { CarId } from "../config/types.js";
import { isWeaponId, weaponDefOf } from "../config/weapon-config.js";
import type { WeaponId } from "../config/weapon-types.js";
import { MS_PER_TICK } from "../constants.js";
import { NEUTRAL_INPUT, type InputFrame } from "../net/input.js";
import type { Bounds } from "./collide.js";
import { solidHulls } from "./context.js";
import { resolveContacts, type ContactCar, type ContactHit } from "./contact.js";
import { stepSim, type SimBody, type StepContext } from "./step.js";
import {
  expireStatuses,
  expireStatusesFromSource,
  hasStatus,
  isPhasedAt,
  modifiersFromRows,
  toActiveStatuses,
  type StatusRow,
} from "./status/statuses.js";

/**
 * **The lockstep (netcode spec N13).** One tick of the world — statuses, driving, contact — as a
 * pure function of state plus inputs. The server calls it once per tick; the client calls it once
 * per predicted tick and again for every tick of every resim, which is what puts the local car and
 * the remotes it can touch on the same tick on the same screen (spec §4, approach C).
 *
 * `stepSim` is unchanged inside it: this is the loop around it that used to live in the server's
 * `sim/tick.ts` and `sim/ram-bridge.ts`. `resolveWorld` and `resolveContacts` are called with
 * exactly the arguments the server passed them, and neither is edited (spec §11).
 *
 * Nothing here reads a wall clock, a room, a schema or a config override. `dt` is derived from
 * `MS_PER_TICK` rather than passed, so the two halves of the lockstep cannot be handed different
 * step sizes (invariant 1).
 */

/**
 * One car, as the world step sees it: a `SimBody` plus the facts the step needs and cannot derive.
 *
 * `carId` and `team` are the two lobby facts that are fixed for a car's whole match — they come off
 * the Colyseus schema on both sides, not out of the snapshot, and the protocol hash and the roster
 * message are what pin them (invariant 8's restatement, N15). Everything else here changes per tick
 * and is therefore a snapshot field.
 *
 * `phased` is an OUTPUT as much as an input: `stepWorld` re-derives it from the swept status rows on
 * the tick it is simulating and writes the answer back, so a caller's stale value never decides
 * solidity. `onField` is not derived — a car leaves the field by dying, which is combat's business
 * (N14) — and is carried through untouched.
 */
export interface CarState extends SimBody {
  /** Wire identity, and the order cars are stepped in. */
  index: number;
  sessionId: string;
  carId: CarId;
  team: 0 | 1;
  /** The MOVER gate: may this car be simulated at all this tick? */
  onField: boolean;
  /** The other half of the WALL gate. Re-derived from `statuses` every step. */
  phased: boolean;
  /**
   * The weapon behind this car's running maneuver, or `""`. On the wire since phase 3 precisely
   * because `stepWorld` reads it: `resolveContacts` needs it to tell a dash from a charge and to
   * answer `slamsStunned`, and a client that predicts contact needs the same answer.
   */
  maneuverWeaponId: WeaponId | "";
  statuses: readonly StatusRow[];
}

/** One slammed victim's two independent clocks, and who started them. */
export interface SlamClocks {
  bySessionId: string;
  /** Wall contact before this tick stuns the victim. The server's `wallStunSweep` closes it early. */
  stunWindowUntilTick: number;
  immuneUntilTick: number;
}

/**
 * The contact memory: what used to be room-private state, now part of the world (N13).
 *
 * It is in `WorldState` so that a client resim starts from the same edge-trigger set and the same
 * slam clocks the server had, and so that the client's own contact prediction (N21) fires on entry
 * exactly as the server's does rather than on every tick a pair overlaps.
 */
export interface ContactMemoryState {
  /** Pairs touching at the end of the previous tick — `"a|b"` with `a < b` by session id. */
  touching: ReadonlySet<string>;
  slammed: ReadonlyMap<string, SlamClocks>;
}

export interface WorldState {
  /** The tick this state is the END of. `stepWorld` returns `tick + 1`. */
  tick: number;
  /**
   * `sidesOf(ArenaState.mode)`. Fixed for the life of a match and read from the lobby half of the
   * schema on both sides — see `CarState.carId` for why that is not an invariant-8 violation.
   */
  mode: "ffa" | "team";
  /** Sorted by `index`. The order is load-bearing: see `solidHulls`. */
  cars: readonly CarState[];
  contact: ContactMemoryState;
}

/**
 * One contact the step resolved. `"ram"` is in the union because the ledger types it and because a
 * later phase may fill it; `stepWorld` does not emit one today — see this module's own note and the
 * plan that created it. A ram is observable without an event: a pair in `contact.touching` this
 * tick that was not there last tick.
 */
export interface ContactEvent {
  kind: "ram" | "slam" | "dashHit";
  attacker: string;
  victim: string;
  /** The victim's position at the end of the tick. */
  x: number;
  y: number;
  /** 1 for a slam (a slam always outranks a graded ram), 0 for a dash hit. */
  severity: number;
  tick: number;
}

export interface WorldStepResult {
  world: WorldState;
  contactEvents: ContactEvent[];
  /**
   * Each car's speed as it ENTERED the tick, before `resolveWorld` could reflect it — the approach
   * term `resolveRam` needs, and the number the server's combat bridge prices a slam's self-cost
   * from. Recorded for every car, including ones this tick did not step.
   */
  approachSpeeds: ReadonlyMap<string, number>;
}

const DT_SECONDS = MS_PER_TICK / 1000;

export function emptyContactMemory(): ContactMemoryState {
  return { touching: new Set(), slammed: new Map() };
}

/** May this weapon's hard slam land on an already-stunned victim (O3)? `false` off any non-charge id. */
function slamsStunnedOf(weaponId: WeaponId | ""): boolean {
  if (!isWeaponId(weaponId)) return false;
  const def = weaponDefOf(weaponId);
  return def.kind === "maneuver" && def.maneuver.type === "charge" ? def.maneuver.slamsStunned : false;
}

/** Zero the four maneuver fields and set the exit speed — a dash, a wall-blocked dash, or a slam ending. */
function endDash(car: CarState, exitSpeed: number): CarState {
  return { ...car, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0, speed: exitSpeed };
}

export function stepWorld(
  world: WorldState,
  inputs: ReadonlyMap<string, InputFrame>,
  arena: ArenaDef,
): WorldStepResult {
  const tick = world.tick + 1;
  const bounds: Bounds = { width: arena.width, height: arena.height };

  // 1. Statuses FIRST, before anything reads a modifier — the rule `statusTick` used to hold on the
  //    server, moved here so the client sweeps at the same tick through the same function and no
  //    tick can simulate an effect whose last tick was the previous one.
  const cars: CarState[] = [...world.cars]
    .sort((a, b) => a.index - b.index)
    .map((car) => {
      const statuses = expireStatuses(toActiveStatuses(car.statuses), tick);
      return { ...car, statuses, phased: isPhasedAt(statuses, tick) };
    });
  const byId = new Map<string, number>();
  for (const [i, car] of cars.entries()) byId.set(car.sessionId, i);

  // 2. The speed carried INTO the tick, read before any stepping. See `WorldStepResult`.
  const approachSpeeds = new Map<string, number>();
  for (const car of cars) approachSpeeds.set(car.sessionId, car.speed);

  // 3. Drive, in car-index order, each car against the CURRENT poses of the others. Sequential
  //    resolution: a car stepped later already sees where the cars before it ended up. The order is
  //    a function of the wire's car indices, so both halves of the lockstep reproduce it exactly.
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]!;
    if (!car.onField) continue;
    const ctx: StepContext = {
      carId: car.carId,
      others: solidHulls(cars, car.sessionId),
      obstacles: arena.obstacles,
      bounds,
      modifiers: modifiersFromRows(car.statuses, tick),
    };
    cars[i] = { ...car, ...stepSim(car, inputs.get(car.sessionId) ?? NEUTRAL_INPUT, DT_SECONDS, ctx) };
  }

  // 4. Contact, after driving and before the caller's combat. The order is the rule: contacts are
  //    measured against the poses driving actually produced.
  const immuneUntil = new Map<string, number>();
  for (const [victimId, clocks] of world.contact.slammed) immuneUntil.set(victimId, clocks.immuneUntilTick);

  const contactCars: ContactCar[] = [];
  for (const car of cars) {
    if (!car.onField || car.phased) continue;
    contactCars.push({
      sessionId: car.sessionId,
      team: car.team,
      x: car.x,
      y: car.y,
      angle: car.angle,
      // The speed carried INTO the tick, not the one driving left behind — a post-collision read
      // makes the approach term negative on every tick a hull actually overlapped. See `RamCar.speed`.
      speed: approachSpeeds.get(car.sessionId) ?? car.speed,
      carId: car.carId,
      massMult: modifiersFromRows(car.statuses, tick).ramMass,
      maneuver: car.maneuver,
      maneuverWeaponId: car.maneuverWeaponId,
      stunned: hasStatus(toActiveStatuses(car.statuses), "stunned", tick),
      slamsStunned: slamsStunnedOf(car.maneuverWeaponId),
    });
  }

  const { knocks, contacts, events } = resolveContacts(
    contactCars,
    world.contact.touching,
    world.mode,
    tick,
    immuneUntil,
    arena.obstacles,
    bounds,
  );

  // 5. Knocks. Only a harder knock may overwrite a standing one — the "no rescue" rule, unchanged.
  for (const knock of knocks) {
    const i = byId.get(knock.sessionId);
    if (i === undefined) continue;
    const car = cars[i]!;
    if (knock.authority >= car.authority) continue;
    cars[i] = {
      ...car,
      angVel: knock.angVel,
      shoveX: knock.shoveX,
      shoveY: knock.shoveY,
      authority: knock.authority,
    };
  }

  // 6. A dash into a wall exits stopped, not at cap.
  for (const sessionId of events.wallBlockedDashers) {
    const i = byId.get(sessionId);
    if (i !== undefined) cars[i] = endDash(cars[i]!, 0);
  }

  const contactEvents: ContactEvent[] = [];

  // 7. One target per dash (O12): only the FIRST hit a dasher lands this tick counts, and the dash
  //    ends there. `events.dashHits` comes from a per-pair loop, so an attacker can appear more than
  //    once; every entry after its first is dropped.
  const dashedThisTick = new Set<string>();
  for (const hit of events.dashHits) {
    if (dashedThisTick.has(hit.attackerSessionId)) continue;
    dashedThisTick.add(hit.attackerSessionId);
    const i = byId.get(hit.attackerSessionId);
    if (i !== undefined) {
      const attacker = cars[i]!;
      // Exit at the drive model's cap for this tick, not the unmodified rating, so a dash that ends
      // on a hit while `topSpeed` is debuffed exits at the speed the car would actually be capped to.
      const topSpeed = modifiersFromRows(attacker.statuses, tick).topSpeed;
      cars[i] = endDash(attacker, forwardMaxSpeedOf(attacker.carId) * topSpeed);
    }
    contactEvents.push(eventOf("dashHit", hit, cars, byId, tick, 0));
  }

  // 8. Slams: both clocks start, and the charge ends on its first slam taking its own self-applied
  //    statuses with it (O2) — a power whose window closes early cannot leave a buff running past
  //    the thing that ended it.
  const slammed = new Map(world.contact.slammed);
  for (const hit of events.slams) {
    slammed.set(hit.targetSessionId, {
      bySessionId: hit.attackerSessionId,
      stunWindowUntilTick: tick + SLAM_TICKS.wallStunWindow,
      immuneUntilTick: tick + SLAM_TICKS.reslamImmunity,
    });
    const i = byId.get(hit.attackerSessionId);
    if (i !== undefined) {
      const attacker = cars[i]!;
      const restored = (approachSpeeds.get(hit.attackerSessionId) ?? attacker.speed) * SLAM_CONFIG.selfKeepFactor;
      const ended = endDash(attacker, restored);
      cars[i] = {
        ...ended,
        statuses: expireStatusesFromSource(toActiveStatuses(ended.statuses), hit.attackerSessionId, tick),
      };
    }
    contactEvents.push(eventOf("slam", hit, cars, byId, tick, 1));
  }

  // 9. Forget a slam record once BOTH clocks have run out. The wall-stun sweep that closes the stun
  //    window early is the server's (N14, N21): it applies a status to a third car, which is never
  //    predicted, and it only ever makes a record expire sooner — which reaches the client in the
  //    next snapshot like any other state.
  for (const [victimId, clocks] of [...slammed]) {
    if (tick >= clocks.stunWindowUntilTick && tick >= clocks.immuneUntilTick) slammed.delete(victimId);
  }

  return {
    world: { tick, mode: world.mode, cars, contact: { touching: contacts, slammed } },
    contactEvents,
    approachSpeeds,
  };
}

function eventOf(
  kind: ContactEvent["kind"],
  hit: ContactHit,
  cars: readonly CarState[],
  byId: ReadonlyMap<string, number>,
  tick: number,
  severity: number,
): ContactEvent {
  const i = byId.get(hit.targetSessionId);
  const victim = i === undefined ? undefined : cars[i];
  return {
    kind,
    attacker: hit.attackerSessionId,
    victim: hit.targetSessionId,
    x: victim?.x ?? 0,
    y: victim?.y ?? 0,
    severity,
    tick,
  };
}
```

Append to `packages/shared/src/index.ts`, in the `sim` block:

```ts
export {
  emptyContactMemory,
  stepWorld,
  type CarState,
  type ContactEvent,
  type ContactMemoryState,
  type SlamClocks,
  type WorldState,
  type WorldStepResult,
} from "./sim/world.js";
export { solidHulls, type SolidCar } from "./sim/context.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/shared && npx vitest run src/sim/world.test.ts src/sim/context.test.ts`
Expected: PASS (20 tests). Then `npx vitest run` in `packages/shared` — everything else green, `golden.test.ts` included: it pins `stepDrive` and `resolveWorld` on a single frozen body and this task edited neither.

- [ ] **Step 7: `maneuverWeaponId` on the wire, and the protocol bump**

`stepWorld` reads `CarState.maneuverWeaponId`, so invariant 8 (as this phase restates it) makes it a snapshot field. It is the **only** field this phase adds to the wire: `carId` and `team` stay on the lobby half of the schema because they are fixed for a car's whole match, and `mode` likewise.

In `packages/shared/src/net/codec.ts`:

| Where | Before | After |
|---|---|---|
| `PROTOCOL_VERSION` | `1` | `2` — the snapshot layout changed; `protocolHash()` already folds it in, so a mismatched build is refused at join with the message Task 3 of phase 2 wrote |
| `SnapshotCar` | (no maneuver-weapon field) | add `maneuverWeaponId: WeaponId \| "";` directly under `lastFiredSlot`, with the comment "The weapon behind the running maneuver, `\"\"` when none. On the wire because `stepWorld` reads it (N15): the contact pass needs it to tell a dash from a charge." |
| the group-3 writer | `u8 kind · u16 ticksLeft · u16 angle · u16 speed` (7 B) | append `· u8 weaponIndexOf(car.maneuverWeaponId) + 1` (0 = none), making the group **8 B** |
| the group-3 reader | reads four fields | reads a fifth: `const w = view.getUint8(o); car.maneuverWeaponId = w === 0 ? "" : weaponIdAt(w - 1);` |
| the group-3 delta mask predicate | compares the four maneuver fields with `!==` | compares five |

`weaponIndexOf`/`weaponIdAt` are the pair the codec already uses for a slot's `weaponId` and an instance's `weapon` byte; the `+ 1` sentinel is the convention already used for `lockTargetIndex` and `sourceIndex`. Nothing else in the layout moves.

The three byte figures the phase-2 codec test pins move by exactly one byte per car, in the full-snapshot cases only — a delta car that is merely driving does not carry the maneuver group at all, so the steady-state delta is unchanged. Update `codec.test.ts`'s expectations:

| Case | Before | After | Arithmetic |
|---|---|---|---|
| Full, 6 cars (3 slots, 1 status), 20 instances | 677 | **683** | `10 + 1 + 6 × 65 + 1 + 20 × 14 + 1` |
| Full, 6 cars (3 slots, no statuses), 20 instances | 641 | **647** | `10 + 1 + 6 × 59 + 1 + 20 × 14 + 1` |
| Full, a live 6-car match (1 status, 8 instances) | 509 | **515** | `10 + 1 + 384 + 6 + 1 + 112 + 1` |
| Delta, steady state (6 cars driving, 4 instances) | 125 | **125** | unchanged — no maneuver group in the mask |
| Delta, contact + volley | 330 | **330** | unchanged — the listed groups do not include maneuver |
| Delta, idle lobby | 31 | **31** | unchanged |

683 B still clears the §8 acceptance line of 700 B, and the steady-state delta is untouched at 125 B against a line of 350 B. Update the layout table's group-3 row and the "full car, 3 slots, 0 statuses: 58 B" line to 59 B in the codec's own header comment, and add one round-trip assertion:

```ts
it("round-trips the weapon behind a running maneuver, and `\"\"` when there is none", () => {
  const dashing = { ...car(0, 300), maneuverWeaponId: "thunderclap" as const };
  const idle = { ...car(1, 900), maneuverWeaponId: "" as const };
  const snap: Snapshot = { ...full(), cars: [dashing, idle] };
  const out = decodeSnapshot(encodeSnapshot(snap, undefined, ROSTER), undefined, ROSTER);
  expect(out.cars[0]!.maneuverWeaponId).toBe("thunderclap");
  expect(out.cars[1]!.maneuverWeaponId).toBe("");
});
```

- [ ] **Step 8: Edit the ledger in this commit**

`docs/superpowers/plans/2026-09-04-netcode-and-rendering/interfaces.md`, three additions (execution guide §4: a plan that needs a ledger change edits the ledger in the same commit):

1. In the `net/codec.ts` block, add `maneuverWeaponId: WeaponId | "";` to `SnapshotCar` under `lastFiredSlot`, and change `PROTOCOL_VERSION = 1` to `2` with the note "bumped by N3 for the maneuver-weapon byte".
2. In the `sim/world.ts` block, add `team: 0 | 1;` and `maneuverWeaponId: WeaponId | "";` to `CarState`; add `bySessionId: string;` to `SlamClocks`; add `mode: "ffa" | "team";` to `WorldState`; and append below the block: "`emptyContactMemory(): ContactMemoryState` is the constructor; `carId`, `team` and `mode` are read from the lobby half of the schema on both sides — they are fixed for a match, which is what invariant 8's restatement allows."
3. In the client block, under `match/prediction.ts`, add `setLocal(sessionId: string): void` and `readonly lastContacts: readonly ContactEvent[]` to `WorldPredictor`; under `match/arena-net.ts` → `match/match-client.ts`, add `attachLobby(state: ArenaState): void`, `drivenSid(): string`, `canDrive(): boolean`, `forgetRemote(sessionId: string): void`, `sinceLastSnapshotMs(nowMs: number): number` and `readonly stalled: boolean`.

- [ ] **Step 9: Commit**

```bash
npm run build -w @motor-combat-moba/shared && npm test
git add packages/shared/src/sim/world.ts packages/shared/src/sim/world.test.ts packages/shared/src/sim/context.ts packages/shared/src/sim/context.test.ts packages/shared/src/net/codec.ts packages/shared/src/net/codec.test.ts packages/shared/src/config/net-config.ts packages/shared/src/index.ts docs/superpowers/plans/2026-09-04-netcode-and-rendering/interfaces.md
git commit -m "feat(sim): stepWorld — the shared world step with the contact memory in state (N13, N15)"
```

**Probe note for the summary.** Nothing calls `stepWorld` yet, so no probe number moves in this commit. It nevertheless adds the code that will move them in Task 2, and the one behavioural difference to watch for is named there: **cars are driven in car-index order, where `serverTick` drove them in sorted-session-id order.** `resolveWorld` resolves sequentially and the last contact resolved is the one guaranteed to end separated, so a squeezed car can settle on a different pose. In `PlaytestWorld` the two orders coincide for every existing probe fixture (ids are added in the order they are listed, and every fixture lists them in ascending id order), so `collision.ts`, `ram.ts` and `geometry.ts` are expected to report the same numbers — expected, not assumed. Say so and recommend the run.

---

### Task 2: The server runs `stepWorld` (N13, N14)

**Files:**
- Create: `packages/server/src/sim/world-bridge.ts`, `packages/server/src/sim/world-bridge.test.ts`
- Delete: `packages/server/src/sim/tick.ts`, `packages/server/src/sim/tick.test.ts`
- Modify: `packages/server/src/sim/ram-bridge.ts` (delete `ContactMemory`'s old shape, `contactTick`, `contactCarsOf`, `immuneMapFrom`, `endDash`, `slamsStunnedOf`; keep `clearKnock`; add `wallStunSweep`), `packages/server/src/sim/status-bridge.ts:63-86` (delete `statusTick`), `packages/server/src/sim/status-bridge.test.ts` (drop its `statusTick` describe), `packages/server/src/rooms/tick-pipeline.ts:40-170`, `packages/server/src/net/snapshot-source.ts` (`SnapshotSourceCtx`, `buildSnapshot`), `packages/server/playtest/world.ts:110-165`
- Test: `packages/server/src/sim/world-bridge.test.ts`, `packages/server/src/rooms/tick-pipeline.test.ts` (if the suite names `statusTick`), `packages/server/src/net/snapshot-source.test.ts` (one assertion)

**Interfaces:**
- Consumes: Task 1's `stepWorld`, `CarState`, `WorldState`, `ContactMemoryState`, `emptyContactMemory`, `ContactEvent`; N1's `InputRing`/`RingRead`; N2's `buildSnapshot`/`SnapshotSourceCtx`.
- Produces: `worldTick(args: WorldTickArgs): WorldTickResult`; `ContactMemory` (now a one-field holder) and `newContactMemory()` keep their names and their call sites; `wallStunSweep(state, memory, arena, tick): StatusRequest[]`; `runPipeline` keeps returning `{ masks, combatPlayers, reads }`.

#### What the three rooms have to change: nothing

`ArenaRoom`, `PracticeRoom` and `PlaygroundRoom` each hold `private ram: ContactMemory = newContactMemory();` and pass `ram: this.ram` in `ctx()`. Both names survive this task with the same import path and the same construction, so **no room file is edited**. `ContactMemory` becomes a one-field mutable holder around the now-immutable `ContactMemoryState`, which is what lets `worldTick` hand a new memory back through a `ctx` the room built before the tick ran. `ArenaRoom.ts:515`'s `this.ram = newContactMemory()` on a fresh match keeps working unchanged.

- [ ] **Step 1: Write the failing bridge test**

`sim/tick.test.ts` is deleted and its scenarios move here, against the new signature. Keep every scenario that still applies; the drive-model ones are now Task 1's (`world.test.ts`), and what is left is what the *bridge* owns: ring reads, ack bookkeeping, press edges, the phase gate and the schema write-back.

```ts
// packages/server/src/sim/world-bridge.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  ArenaState, ManeuverKind, PlayerState, PlayerStatus, RoomPhase, getArena,
  type InputFrame, type WeaponId,
} from "@motor-combat-moba/shared";
import { InputRing } from "../net/input-ring.js";
import { newContactMemory } from "./ram-bridge.js";
import { worldTick } from "./world-bridge.js";

const ARENA = getArena("arena-01");
const FORWARD: InputFrame = { steer: 0, throttle: 1, fireSlots: 0 };
const FIRE: InputFrame = { steer: 0, throttle: 0, fireSlots: 1 };

function state(): ArenaState {
  const s = new ArenaState();
  s.arenaId = "arena-01";
  s.phase = RoomPhase.MATCH;
  s.tick = 100;
  for (const [i, id] of ["a", "b"].entries()) {
    const p = new PlayerState();
    p.sessionId = id;
    p.carIndex = i;
    p.carId = "mirage";
    p.status = PlayerStatus.IN_MATCH;
    p.alive = true;
    p.x = 300 + i * 600;
    p.y = 360;
    p.authority = 1;
    s.players.set(id, p);
  }
  return s;
}

/** A ring already carrying `input` for `tick`, accepted one tick early. */
function ringWith(tick: number, input: InputFrame): InputRing {
  const ring = new InputRing();
  ring.accept({ tick, ...input }, tick - 1);
  return ring;
}

function args(s: ArenaState, rings: Map<string, InputRing>, over: Partial<Parameters<typeof worldTick>[0]> = {}) {
  return {
    state: s,
    rings,
    roster: new Set(["a", "b"]),
    memory: newContactMemory(),
    phase: s.phase,
    mode: "ffa" as const,
    arena: ARENA,
    maneuverWeapons: new Map<string, WeaponId | "">(),
    ...over,
  };
}

describe("worldTick", () => {
  let s: ArenaState;
  let rings: Map<string, InputRing>;

  beforeEach(() => {
    s = state();
    rings = new Map([
      ["a", ringWith(100, FORWARD)],
      ["b", new InputRing()],
    ]);
  });

  it("drives the roster through stepWorld and writes the poses back onto the schema", () => {
    const before = s.players.get("a")!.x;
    worldTick(args(s, rings));
    expect(s.players.get("a")!.x).toBeGreaterThan(before);
    expect(s.players.get("a")!.speed).toBeGreaterThan(0);
  });

  it("reads every ring every tick and advances the ack, in every phase", () => {
    s.phase = RoomPhase.LOBBY;
    const before = s.players.get("a")!.x;
    const result = worldTick(args(s, rings, { phase: RoomPhase.LOBBY }));
    expect(s.players.get("a")!.ackTick).toBe(100);
    expect(s.players.get("b")!.ackTick).toBe(100);
    expect(result.reads.get("a")!.source).toBe("fresh");
    expect(s.players.get("a")!.x).toBe(before);
  });

  it("records the slack the ring reports, clamped into an int8", () => {
    worldTick(args(s, rings));
    expect(s.players.get("a")!.slackTicks).toBe(rings.get("a")!.inputFor(100).slackTicks);
  });

  it("reports only newly pressed slots, so a held trigger fires once", () => {
    const held = new InputRing();
    held.accept({ tick: 100, ...FIRE }, 99);
    held.accept({ tick: 101, ...FIRE }, 100);
    rings.set("a", held);
    expect(worldTick(args(s, rings)).masks.get("a")).toBe(1);
    s.tick = 101;
    expect(worldTick(args(s, rings)).masks.get("a")).toBeUndefined();
  });

  it("strips a mask past the real slot count before anything sees it", () => {
    rings.set("a", ringWith(100, { steer: 0, throttle: 0, fireSlots: 0xff }));
    expect(worldTick(args(s, rings)).masks.get("a")).toBe(0b111);
  });

  it("hands the new contact memory back through the holder", () => {
    s.players.get("b")!.x = 330;
    s.players.get("b")!.angle = Math.PI;
    s.players.get("a")!.speed = 300;
    s.players.get("b")!.speed = 300;
    const memory = newContactMemory();
    worldTick(args(s, rings, { memory }));
    expect([...memory.state.touching]).toEqual(["a|b"]);
  });

  it("gives the contact pass the weapon behind a running maneuver", () => {
    const a = s.players.get("a")!;
    a.maneuver = ManeuverKind.DASH;
    a.maneuverTicksLeft = 10;
    a.maneuverSpeed = 1600;
    const b = s.players.get("b")!;
    b.x = 330;
    b.angle = Math.PI;
    const result = worldTick(args(s, rings, {
      maneuverWeapons: new Map<string, WeaponId | "">([["a", "thunderclap"]]),
    }));
    expect(result.contactEvents.map((e) => e.kind)).toEqual(["dashHit"]);
    expect(s.players.get("a")!.maneuver).toBe(ManeuverKind.NONE);
  });

  it("sweeps the statuses of a player outside the roster too", () => {
    const c = new PlayerState();
    c.sessionId = "c";
    c.carIndex = 2;
    c.status = PlayerStatus.LOBBY;
    c.statuses.push(Object.assign(new (s.players.get("a")!.statuses.constructor as never)(), {}));
    // Written through the bridge's own helper so the fixture cannot drift from the schema shape:
    writeStatuses(c, [{ statusId: "spiked", startTick: 10, endsTick: 100, sourceSessionId: "" }]);
    s.players.set("c", c);
    rings.set("c", new InputRing());
    worldTick(args(s, rings));
    expect(c.statuses).toHaveLength(0);
  });
});
```

The last test imports `writeStatuses` from `./status-bridge.js`; drop the stray `statuses.push` line above it — it is there only to show that the row shape is never hand-built. Write the test with the `writeStatuses` call alone:

```ts
    const c = new PlayerState();
    c.sessionId = "c";
    c.carIndex = 2;
    c.status = PlayerStatus.LOBBY;
    writeStatuses(c, [{ statusId: "spiked", startTick: 10, endsTick: 100, sourceSessionId: "" }]);
    s.players.set("c", c);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && npx vitest run src/sim/world-bridge.test.ts`
Expected: FAIL — cannot resolve `./world-bridge.js`.

- [ ] **Step 3: Write the bridge**

```ts
// packages/server/src/sim/world-bridge.ts
import {
  RoomPhase,
  WEAPON_SLOT_CONFIG,
  carIdOf,
  expireStatuses,
  isOnField,
  stepWorld,
  toActiveStatuses,
  type ArenaDef,
  type ArenaState,
  type CarState,
  type ContactEvent,
  type InputFrame,
  type PlayerState,
  type WeaponId,
  type WorldState,
} from "@motor-combat-moba/shared";
import type { InputRing, RingRead } from "../net/input-ring.js";
import type { ContactMemory } from "./ram-bridge.js";
import { readStatuses, writeStatuses } from "./status-bridge.js";

/** Every bit at or beyond `maxWeaponSlots` is stripped before a wire mask reaches the sim. */
const SLOT_MASK = (1 << WEAPON_SLOT_CONFIG.maxWeaponSlots) - 1;

/** `PlayerState.slackTicks` is an int8; a stall longer than 127 ticks reads as 127 either way. */
const clampInt8 = (n: number): number => Math.max(-128, Math.min(127, n));

export interface WorldTickArgs {
  state: ArenaState;
  rings: ReadonlyMap<string, InputRing>;
  roster: ReadonlySet<string>;
  memory: ContactMemory;
  phase: RoomPhase;
  mode: "ffa" | "team";
  arena: ArenaDef;
  /** Which weapon started each player's running maneuver — `CombatMemory.maneuverWeapons`. */
  maneuverWeapons: ReadonlyMap<string, WeaponId | "">;
}

export interface WorldTickResult {
  /** Per session id, the validated slot bitmask of the slots newly PRESSED on this tick's input. */
  masks: Map<string, number>;
  /** Per session id, what the ring served this tick — the input log and the netgraph read these. */
  reads: Map<string, RingRead>;
  contactEvents: readonly ContactEvent[];
  approachSpeeds: ReadonlyMap<string, number>;
}

/**
 * The schema half of the world step: read `ArenaState` into a `WorldState`, run the pure shared
 * `stepWorld`, write the answer back.
 *
 * This is `serverTick` and `contactTick` collapsed into one call site, which is the whole point of
 * N13 — the client runs the same function on the same state, so a rule cannot live on one side of
 * the lockstep. Everything that used to be here and is a *rule* now lives in
 * `@motor-combat-moba/shared`'s `sim/world.ts`; this file knows about `MapSchema` and holds none.
 *
 * Three things happen for **every** player in the room, roster or not, in every phase (N6, N7):
 * their ring is read, their ack and slack are stamped, and their status list is swept. Only roster
 * players in `MATCH` are handed to `stepWorld`, which mirrors what `contactTick` always did and what
 * `serverTick` did in every shipped flow — a player outside the roster is either in the lobby or
 * spectating, and neither drives.
 */
export function worldTick(args: WorldTickArgs): WorldTickResult {
  const { state, rings, roster, memory, phase, mode, arena, maneuverWeapons } = args;
  const tick = state.tick;
  const reads = new Map<string, RingRead>();
  const masks = new Map<string, number>();
  const inputs = new Map<string, InputFrame>();

  const ids = [...state.players.keys()].sort();
  for (const sessionId of ids) {
    const player = state.players.get(sessionId);
    const ring = rings.get(sessionId);
    if (!player || !ring) continue;
    const read = ring.inputFor(tick);
    reads.set(sessionId, read);
    inputs.set(sessionId, read.input);
    player.ackTick = tick;
    player.slackTicks = clampInt8(read.slackTicks);
  }

  const stepping = phase === RoomPhase.MATCH && roster.size > 0;
  if (!stepping) {
    for (const sessionId of ids) sweepStatuses(state.players.get(sessionId));
    return { masks, reads, contactEvents: [], approachSpeeds: new Map() };
  }

  const cars: CarState[] = [];
  for (const sessionId of ids) {
    const player = state.players.get(sessionId);
    if (!player) continue;
    if (!roster.has(sessionId)) {
      // Not a participant: still swept, never stepped, never a contact.
      sweepStatuses(player);
      continue;
    }
    cars.push(carStateOf(sessionId, player, maneuverWeapons.get(sessionId) ?? ""));
  }

  const before: WorldState = { tick, mode, cars, contact: memory.state };
  const result = stepWorld(before, inputs, arena);
  memory.state = result.world.contact;

  for (const car of result.world.cars) {
    const player = state.players.get(car.sessionId);
    if (!player) continue;
    writeCar(player, car);
    // Firing rides the same gate as movement: a car the step did not move cannot buy a shot.
    if (!car.onField) continue;
    const read = reads.get(car.sessionId);
    if (!read) continue;
    const pressed = cleanMask(read.input.fireSlots) & ~cleanMask(read.previous.fireSlots);
    if (pressed !== 0) masks.set(car.sessionId, pressed);
  }

  return {
    masks,
    reads,
    contactEvents: result.contactEvents,
    approachSpeeds: result.approachSpeeds,
  };
}

/** Attacker-controlled wire data: non-integers and non-positives collapse to 0, then masked to the real slots. */
function cleanMask(raw: number): number {
  return Number.isInteger(raw) && raw > 0 ? raw & SLOT_MASK : 0;
}

/**
 * A player the world step is not simulating this tick still has its clocks run down. `expireStatuses`
 * returns the same array reference when nothing lapsed, which is what keeps this free for the cars
 * that are in no status at all — most cars, most ticks.
 */
function sweepStatuses(player: PlayerState | undefined): void {
  if (!player || player.statuses.length === 0) return;
  const before = readStatuses(player);
  const after = expireStatuses(before, player.ackTick);
  if (after !== before) writeStatuses(player, after);
}

function carStateOf(sessionId: string, player: PlayerState, maneuverWeaponId: WeaponId | ""): CarState {
  return {
    index: player.carIndex,
    sessionId,
    carId: carIdOf(player),
    team: player.team === 1 ? 1 : 0,
    onField: isOnField(player),
    // Re-derived inside `stepWorld` from the swept rows; the value handed in is never trusted.
    phased: false,
    maneuverWeaponId,
    statuses: readStatuses(player),
    x: player.x,
    y: player.y,
    angle: player.angle,
    speed: player.speed,
    reverseHold: player.reverseHold,
    angVel: player.angVel,
    shoveX: player.shoveX,
    shoveY: player.shoveY,
    authority: player.authority,
    maneuver: player.maneuver,
    maneuverTicksLeft: player.maneuverTicksLeft,
    maneuverAngle: player.maneuverAngle,
    maneuverSpeed: player.maneuverSpeed,
  };
}

function writeCar(player: PlayerState, car: CarState): void {
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  player.speed = car.speed;
  player.reverseHold = car.reverseHold;
  player.angVel = car.angVel;
  player.shoveX = car.shoveX;
  player.shoveY = car.shoveY;
  player.authority = car.authority;
  player.maneuver = car.maneuver;
  player.maneuverTicksLeft = car.maneuverTicksLeft;
  player.maneuverAngle = car.maneuverAngle;
  player.maneuverSpeed = car.maneuverSpeed;
  // Only touched when something is actually there, on either side: the common case is two empty
  // lists and no write at all.
  if (car.statuses.length > 0 || player.statuses.length > 0) {
    writeStatuses(player, toActiveStatuses(car.statuses));
  }
}
```

- [ ] **Step 4: Reduce `ram-bridge.ts` to the two things that stay on the server**

Delete `ram-bridge.ts:39-53` (`SlamRecord`, the old `ContactMemory`), `95-152` (`slamsStunnedOf`, `immuneMapFrom`, `contactCarsOf`), `71-93` (`endDash`), and the whole of `contactTick` (`154-236`) except the wall-stun sweep at `238-268`, which becomes the new exported function. Keep `clearKnock` (`60-70`) verbatim. The new head and tail of the file:

```ts
import {
  SLAM_CONFIG,
  SLAM_TICKS,
  carHullOf,
  emptyContactMemory,
  hullTouchesWorld,
  isSolid,
  type ArenaDef,
  type ArenaState,
  type ContactMemoryState,
  type PlayerState,
  type SlamClocks,
  type StatusRequest,
} from "@motor-combat-moba/shared";

/**
 * The two pieces of contact that are the SERVER's and not the world's.
 *
 * The pair loop, the knocks, the dash and slam resolution and the contact memory all moved into
 * shared `sim/world.ts` in phase 3, because a client that predicts contact (N21) has to run the
 * identical rules from the identical memory. What is left here is the room's mutable handle on that
 * memory, and the wall-stun sweep — which applies a status to a THIRD car and is therefore never
 * predicted (N14, N21): the client learns about the stun a round trip later, as a status row, by
 * which time the shove has already covered for it.
 */

/**
 * The room's handle on the world's contact memory. One mutable field around an immutable
 * `ContactMemoryState`, so a `PipelineCtx` built before the tick ran can still be handed the memory
 * the tick produced.
 */
export interface ContactMemory {
  state: ContactMemoryState;
}

export function newContactMemory(): ContactMemory {
  return { state: emptyContactMemory() };
}
```

and, in place of `contactTick`:

```ts
/**
 * Wall-stun sweep (O2's window): a car shoved by a slam that lands against level geometry within
 * `SLAM_TICKS.wallStunWindow` is stunned once.
 *
 * Immunity and the stun window are independent clocks, and this closes only its own — re-slam
 * immunity keeps running underneath it, and `stepWorld` is what finally forgets a record once both
 * have run out.
 *
 * `isSolid`, not `isOnField`: a victim who died and respawned phased inside the window is not in the
 * world (M13/M14), and spawn protection must not be broken by a stun from the old life.
 */
export function wallStunSweep(
  state: ArenaState,
  memory: ContactMemory,
  arena: ArenaDef,
  tick: number,
): StatusRequest[] {
  const requests: StatusRequest[] = [];
  const bounds = { width: arena.width, height: arena.height };
  let next: Map<string, SlamClocks> | undefined;

  for (const [victimId, clocks] of memory.state.slammed) {
    if (tick >= clocks.stunWindowUntilTick) continue;
    const player = state.players.get(victimId);
    if (!player || !isSolid(player, tick)) continue;
    if (!hullTouchesWorld(carHullOf(player.x, player.y, player.angle), arena.obstacles, bounds, SLAM_CONFIG.wallContactPad)) {
      continue;
    }
    requests.push({
      targetSessionId: victimId,
      statusId: "stunned",
      durationTicks: SLAM_TICKS.wallStunDuration,
      sourceSessionId: clocks.bySessionId,
    });
    next ??= new Map(memory.state.slammed);
    // Closes THIS window only, so the stun fires once per slam; immunity keeps its own clock.
    next.set(victimId, { ...clocks, stunWindowUntilTick: tick });
  }

  if (next) memory.state = { ...memory.state, slammed: next };
  return requests;
}
```

`ram-bridge.test.ts` keeps every `clearKnock` case; its `contactTick` describes move to `world.test.ts` (Task 1) in intent — do not port them a second time — and one new describe covers the sweep:

```ts
describe("wallStunSweep", () => {
  it("stuns a slammed car touching a wall, once, and leaves the immunity clock alone", () => {
    const s = matchState();
    const victim = s.players.get("b")!;
    victim.x = 20; // flush against the left wall
    const memory = newContactMemory();
    memory.state = {
      touching: new Set(),
      slammed: new Map([["b", { bySessionId: "a", stunWindowUntilTick: 130, immuneUntilTick: 160 }]]),
    };
    const first = wallStunSweep(s, memory, getArena("arena-01"), 100);
    expect(first).toEqual([
      { targetSessionId: "b", statusId: "stunned", durationTicks: SLAM_TICKS.wallStunDuration, sourceSessionId: "a" },
    ]);
    expect(memory.state.slammed.get("b")!.immuneUntilTick).toBe(160);
    expect(wallStunSweep(s, memory, getArena("arena-01"), 101)).toEqual([]);
  });

  it("never stuns a car that is phased", () => {
    const s = matchState();
    const victim = s.players.get("b")!;
    victim.x = 20;
    writeStatuses(victim, [{ statusId: "phased", startTick: 90, endsTick: 400, sourceSessionId: "" }]);
    const memory = newContactMemory();
    memory.state = {
      touching: new Set(),
      slammed: new Map([["b", { bySessionId: "a", stunWindowUntilTick: 130, immuneUntilTick: 160 }]]),
    };
    expect(wallStunSweep(s, memory, getArena("arena-01"), 100)).toEqual([]);
  });
});
```

- [ ] **Step 5: `runPipeline` calls `worldTick`, then the sweep, then combat**

`tick-pipeline.ts` substitutions:

| Before | After |
|---|---|
| imports `serverTick` from `../sim/tick.js`; `statusTick` from `../sim/status-bridge.js`; `contactTick`/`ContactTickResult` from `../sim/ram-bridge.js` | `worldTick` from `../sim/world-bridge.js`; `wallStunSweep` from `../sim/ram-bridge.js`; drop `statusTick` and `ContactTickResult`; add `MS_PER_TICK`, `sidesOf` (already imported), `isWeaponId`, `type ContactEvent`, `type ContactHit`, `type StatusRequest`, `type WeaponId` from shared |
| `PipelineCtx.ram: ContactMemory` | unchanged in name and type name; the type is now the holder |
| the doc line `` `statusTick` → `serverTick` → `contactTick` → combat. `` | `` `worldTick` (statuses, driving and contact, in shared `stepWorld`) → `wallStunSweep` → combat. `` |
| `runPipeline`'s body from `const dt = …` to the `return` | the code below |
| `combatTick(ctx, dt, masks, contact)` | `combatTick(ctx, masks, contactHits, statusRequests)`; inside it `const dt = MS_PER_TICK / 1000;` and `contactHits: contactHits, statusRequests: statusRequests` in the `runCombat` call |

```ts
export function runPipeline(ctx: PipelineCtx): {
  masks: ReadonlyMap<string, number>;
  combatPlayers: CombatResultPlayer[] | null;
  reads: ReadonlyMap<string, RingRead>;
} {
  const state = ctx.state;
  const arena = getArena(state.arenaId);
  // Statuses, driving and contact are one shared call now (N13): the client runs the identical
  // function over the identical state, which is what puts its local car and the remotes it can
  // touch on the same tick. Nothing here decides a rule; `world-bridge.ts` only moves the schema.
  const { masks, reads, contactEvents } = worldTick({
    state,
    rings: ctx.rings,
    roster: ctx.matchRoster,
    memory: ctx.ram,
    phase: state.phase,
    mode: sidesOf(state.mode),
    arena,
    maneuverWeapons: ctx.combat.maneuverWeapons,
  });

  // The one piece of contact the client must never predict: a status landing on a third car (N14).
  const statusRequests =
    state.phase === RoomPhase.MATCH && ctx.matchRoster.size > 0
      ? wallStunSweep(state, ctx.ram, arena, state.tick)
      : [];

  return {
    masks,
    reads,
    combatPlayers: combatTick(ctx, masks, contactHitsOf(contactEvents, ctx.combat.maneuverWeapons), statusRequests),
  };
}

/**
 * The dash and slam events `stepWorld` reported, priced as `ContactHit`s for combat.
 *
 * The weapon id comes from the room's own `maneuverWeapons` rather than off the event, which is
 * where it lived before this refactor too: `ContactEvent` names the two cars and the contact point,
 * and combat is the half that already knows which weapon each maneuver came from. A `ram` event is
 * never produced (see `sim/world.ts`) and would carry no weapon if it were.
 */
function contactHitsOf(
  events: readonly ContactEvent[],
  maneuverWeapons: ReadonlyMap<string, WeaponId | "">,
): ContactHit[] {
  const hits: ContactHit[] = [];
  for (const event of events) {
    if (event.kind === "ram") continue;
    const weaponId = maneuverWeapons.get(event.attacker) ?? "";
    if (!isWeaponId(weaponId)) continue;
    hits.push({ attackerSessionId: event.attacker, targetSessionId: event.victim, weaponId });
  }
  return hits;
}
```

`respawnSweep`'s doc line "Runs at the TOP of the tick, before `statusTick`" becomes "Runs at the TOP of the tick, before `worldTick` sweeps statuses" — the placement decision (M21) is unchanged and still correct: the `phased` row is written before the sweep that derives modifiers from it.

- [ ] **Step 6: Delete `statusTick`, and fill `maneuverWeaponId` on the wire**

`status-bridge.ts`: delete `statusTick` (`63-86`) and the now-unused `expireStatuses`/`modifiersOf` imports if they become so; keep `readStatuses`, `writeStatuses`, `clearPlayerStatuses` and `modifiersFor`. Update the file's header comment line 27 — "`statusTick` runs FIRST in the room tick" — to "The expiry sweep runs first inside shared `stepWorld`; this file is the schema adapter around it." Delete the `statusTick` describe from `status-bridge.test.ts`; every other describe stays.

`net/snapshot-source.ts`: `SnapshotSourceCtx` gains `maneuverWeapons: ReadonlyMap<string, WeaponId | "">`, and `buildSnapshot`'s per-car object gains `maneuverWeaponId: ctx.maneuverWeapons.get(sessionId) ?? ""` beside `lastFiredSlot`. Every call site is a room's `snapshotFor(sessionId)`, which already has `this.combat.maneuverWeapons` in hand — pass it. Add one assertion to `snapshot-source.test.ts`'s "lists cars by index…" test: `expect(snap.cars[0]!.maneuverWeaponId).toBe("thunderclap");` for a fixture whose `maneuverWeapons` names it.

- [ ] **Step 7: The two harnesses that mirror the pipeline (compile breaks)**

`playtest/world.ts` — its whole reason for existing is to run "the EXACT pipeline `ArenaRoom.tick` runs", so it follows the pipeline:

| Before | After |
|---|---|
| header comment `statusTick -> serverTick -> contactTick -> runCombat` | `worldTick (shared stepWorld) -> wallStunSweep -> runCombat` |
| `import { serverTick } from "../src/sim/tick.js";` and `import { statusTick } …` | `import { worldTick } from "../src/sim/world-bridge.js";` |
| `import { contactTick, newContactMemory, type ContactMemory, type ContactTickResult } …` | `import { newContactMemory, wallStunSweep, type ContactMemory } from "../src/sim/ram-bridge.js";` |
| `add()`: nothing sets a car index | `p.carIndex = this.roster.size;` before `this.state.players.set(...)`, so index order matches insertion order and therefore the order every existing fixture already lists its cars in |
| `tick()`'s body from `const statusMods = …` to the `runCombat` call's `contactHits`/`statusRequests` | the code below |

```ts
  /** One tick, in `ArenaRoom.tick`'s order. */
  tick(): void {
    this.state.tick += 1;
    const arena = getArena(this.state.arenaId);
    const { masks, contactEvents } = worldTick({
      state: this.state,
      rings: this.rings,
      roster: this.roster,
      memory: this.ram,
      phase: this.state.phase,
      mode: this.mode,
      arena,
      maneuverWeapons: this.combat.maneuverWeapons,
    });
    const statusRequests =
      this.state.phase === RoomPhase.MATCH && this.roster.size > 0
        ? wallStunSweep(this.state, this.ram, arena, this.state.tick)
        : [];
    if (this.state.phase !== RoomPhase.MATCH || this.roster.size === 0) return;

    const contactHits: ContactHit[] = [];
    for (const event of contactEvents) {
      if (event.kind === "ram") continue;
      const weaponId = this.combat.maneuverWeapons.get(event.attacker) ?? "";
      if (isWeaponId(weaponId)) {
        contactHits.push({ attackerSessionId: event.attacker, targetSessionId: event.victim, weaponId });
      }
    }

    const result = runCombat({
      world: {
        tick: this.state.tick,
        dt: DT,
        mode: this.mode,
        obstacles: arena.obstacles,
        bounds: { width: arena.width, height: arena.height },
      },
      players: toCombatPlayers(this.state, this.roster, masks, this.combat),
      instances: toInstances(this.combat),
      instanceSeq: this.combat.instanceSeq,
      contactHits,
      statusRequests,
    });
    applyCombatResult(this.state, result, this.combat);
    this.combat.instanceSeq = result.instanceSeq;
  }
```

`balance/match.ts`: the header comment's `statusTick -> serverTick -> contactTick -> combat` becomes `worldTick -> wallStunSweep -> combat`; `const ram: ContactMemory = newContactMemory();` compiles unchanged because both names survive; the seat loop must set `p.carIndex` the way the rooms do (`assignCarIndex`, phase 2) if it does not already — grep `carIndex` in that file and add `player.carIndex = index;` beside the seat's other fields if it is missing.

- [ ] **Step 8: Run everything on the server**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/server && npx vitest run && npm run typecheck`
Expected: PASS. The practice-room source scan still finds no `setTuning`; `tick-pipeline.test.ts` is green with no reference to `statusTick`.

Then the harnesses: `npx tsx playtest/netcode.ts && cd ../.. && npm run playtest`
Expected: both run to completion. **Read what moved** against phase 2's report folder before committing.

- [ ] **Step 9: Commit**

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run build
git add packages/server/src packages/server/playtest/world.ts packages/server/balance/match.ts
git commit -m "refactor(server): runPipeline calls shared stepWorld; contact memory moves into world state (N13, N14)"
```

**Say it loudly, in the summary and in the merge commit.** This commit moves the sim's whole per-tick loop and therefore reaches every probe that measures contact:

- **`collision.ts`** — every overlap-depth and tunneling row. `resolveWorld` is byte-identical, but cars are now driven in **car-index order** where they were driven in **sorted-session-id order**, and `resolveWorld` resolves sequentially: the last contact resolved is the one guaranteed to end separated. In `PlaytestWorld` the two orders coincide for every existing fixture (Step 7 assigns `carIndex` in insertion order and every fixture lists its cars in ascending id order), so row 1 ("Car-car tunneling at extreme closing speed") and row 2 ("Crush between a car and the wall") are expected to be unchanged — expected, not assumed.
- **`ram.ts` R1–R5** — the ram trigger rate. `approachSpeeds` is still the speed carried into the tick, computed at the same point in the tick; the pair loop is the same code. Expected unchanged.
- **`geometry.ts` G1–G7** — unchanged code paths; runs because `PlaytestWorld.tick` was rewritten around them.
- **`prediction.ts` P1/P2** and **`netcode.ts` N1–N3** — these move for real, and Task 6 is where they are re-pinned.

Recommend `npm run playtest` and hand the report to the user. Do not update a probe's expectation in this commit; Task 6 owns the two that need it.

---

### Task 3: `WorldPredictor` and `RenderOffsets` (N16, N17, N19, N20)

**Files:**
- Create: `packages/client/src/match/local-inputs.ts`, `packages/client/src/match/prediction.ts`, `packages/client/src/match/render-offset.ts`
- Test: `packages/client/src/match/local-inputs.test.ts`, `packages/client/src/match/prediction.test.ts`, `packages/client/src/match/render-offset.test.ts`
- Modify: `packages/client/src/match/netgraph.ts` (`recordCorrection`'s threshold)

**Interfaces:**
- Consumes: Task 1's `stepWorld`, `WorldState`, `CarState`, `ContactEvent`, `emptyContactMemory`; `NET_CONFIG`; `NEUTRAL_INPUT`/`InputFrame`; `NetStats` (N0).
- Produces:

```ts
export class LocalInputs {
  constructor(sizeTicks?: number);
  set(tick: number, input: InputFrame): void;
  /** `NEUTRAL_INPUT` for a tick the ring no longer holds — the same fallback the server's ring uses. */
  at(tick: number): InputFrame;
}
export interface CarDelta { dx: number; dy: number; dAngle: number }
export class WorldPredictor {
  constructor(arena: ArenaDef, cfg: Pick<typeof NET_CONFIG, "maxPredictionTicks" | "maxExtrapolationTicks" | "remoteSteerHoldTicks">);
  setLocal(sessionId: string): void;
  setBaseline(world: WorldState, inputsEcho: ReadonlyMap<string, InputFrame>): void;
  predictTick(localTick: number, localInput: InputFrame): WorldState;
  worldAt(tick: number): WorldState | undefined;
  resim(localTick: number, localInputs: (tick: number) => InputFrame): ReadonlyMap<string, CarDelta>;
  readonly baselineTick: number;
  readonly lastContacts: readonly ContactEvent[];
}
export function wrapAngle(delta: number): number;
export class RenderOffsets {
  constructor(cfg: Pick<typeof NET_CONFIG, "correctionMs" | "snapUnits" | "snapRadians">, stats: NetStats);
  add(sessionId: string, dx: number, dy: number, dAngle: number): void;
  decay(deltaMs: number): void;
  offsetOf(sessionId: string): CarDelta;
  forget(sessionId: string): void;
  clear(): void;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/client/src/match/local-inputs.test.ts
import { describe, expect, it } from "vitest";
import { NEUTRAL_INPUT, type InputFrame } from "@motor-combat-moba/shared";
import { LocalInputs } from "./local-inputs.js";

const FORWARD: InputFrame = { steer: 0, throttle: 1, fireSlots: 0 };
const LEFT: InputFrame = { steer: -1, throttle: 1, fireSlots: 0 };

describe("LocalInputs", () => {
  it("gives back exactly what was stored for a tick", () => {
    const inputs = new LocalInputs(8);
    inputs.set(100, FORWARD);
    inputs.set(101, LEFT);
    expect(inputs.at(100)).toEqual(FORWARD);
    expect(inputs.at(101)).toEqual(LEFT);
  });

  it("answers neutral for a tick it never held, and for one that has been overwritten", () => {
    const inputs = new LocalInputs(4);
    inputs.set(100, FORWARD);
    expect(inputs.at(99)).toEqual(NEUTRAL_INPUT);
    inputs.set(104, LEFT); // same slot as 100
    expect(inputs.at(100)).toEqual(NEUTRAL_INPUT);
    expect(inputs.at(104)).toEqual(LEFT);
  });
});
```

```ts
// packages/client/src/match/prediction.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  NET_CONFIG, NEUTRAL_INPUT, emptyContactMemory, getArena,
  type CarState, type InputFrame, type WorldState,
} from "@motor-combat-moba/shared";
import { WorldPredictor } from "./prediction.js";

const ARENA = getArena("arena-01");
const FORWARD: InputFrame = { steer: 0, throttle: 1, fireSlots: 0 };
const LEFT_FORWARD: InputFrame = { steer: -1, throttle: 1, fireSlots: 0 };

function car(index: number, sessionId: string, x: number, over: Partial<CarState> = {}): CarState {
  return {
    index, sessionId, carId: "mirage", team: 0, onField: true, phased: false,
    maneuverWeaponId: "", statuses: [],
    x, y: 360, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0,
    authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
    ...over,
  };
}

function baseline(tick = 1000, meX = 300, themX = 900): WorldState {
  return {
    tick, mode: "ffa",
    cars: [car(0, "me", meX), car(1, "them", themX, { angle: Math.PI })],
    contact: emptyContactMemory(),
  };
}

function xOf(world: WorldState | undefined, sessionId: string): number {
  return world?.cars.find((c) => c.sessionId === sessionId)?.x ?? Number.NaN;
}

function angleOf(world: WorldState | undefined, sessionId: string): number {
  return world?.cars.find((c) => c.sessionId === sessionId)?.angle ?? Number.NaN;
}

describe("WorldPredictor", () => {
  let predictor: WorldPredictor;

  beforeEach(() => {
    predictor = new WorldPredictor(ARENA, NET_CONFIG);
    predictor.setLocal("me");
  });

  it("predicts forward from the baseline and keeps every tick it produced", () => {
    predictor.setBaseline(baseline(), new Map([["them", NEUTRAL_INPUT]]));
    for (let tick = 1001; tick <= 1004; tick++) predictor.predictTick(tick, FORWARD);
    expect(predictor.worldAt(1000)!.tick).toBe(1000);
    expect(predictor.worldAt(1004)!.tick).toBe(1004);
    expect(xOf(predictor.worldAt(1004), "me")).toBeGreaterThan(xOf(predictor.worldAt(1001), "me"));
    expect(predictor.worldAt(1005)).toBeUndefined();
  });

  it("drives a remote on its echoed last input, so a car under throttle keeps moving", () => {
    predictor.setBaseline(baseline(), new Map([["them", FORWARD]]));
    predictor.predictTick(1001, NEUTRAL_INPUT);
    // "them" faces PI, so throttle moves it toward smaller x.
    expect(xOf(predictor.worldAt(1001), "them")).toBeLessThan(900);
  });

  it("drops a held steer after remoteSteerHoldTicks, so an extrapolation stops curving", () => {
    predictor.setBaseline(baseline(), new Map([["them", LEFT_FORWARD]]));
    const turned: number[] = [];
    for (let i = 1; i <= NET_CONFIG.remoteSteerHoldTicks + 2; i++) {
      predictor.predictTick(1000 + i, NEUTRAL_INPUT);
      turned.push(angleOf(predictor.worldAt(1000 + i), "them"));
    }
    const held = turned[NET_CONFIG.remoteSteerHoldTicks - 1]! - turned[NET_CONFIG.remoteSteerHoldTicks - 2]!;
    const released = turned.at(-1)! - turned.at(-2)!;
    expect(Math.abs(held)).toBeGreaterThan(0);
    expect(Math.abs(released)).toBeLessThan(Math.abs(held));
  });

  it("holds a remote where it is past maxExtrapolationTicks, and keeps predicting the local car", () => {
    predictor.setBaseline(baseline(), new Map([["them", FORWARD]]));
    const cap = NET_CONFIG.maxExtrapolationTicks;
    for (let i = 1; i <= cap + 2; i++) predictor.predictTick(1000 + i, FORWARD);
    expect(xOf(predictor.worldAt(1000 + cap + 2), "them")).toBe(xOf(predictor.worldAt(1000 + cap), "them"));
    expect(xOf(predictor.worldAt(1000 + cap + 2), "me")).toBeGreaterThan(xOf(predictor.worldAt(1000 + cap), "me"));
  });

  it("re-simulates from a corrected baseline and reports old-minus-new per car", () => {
    predictor.setBaseline(baseline(), new Map([["them", NEUTRAL_INPUT]]));
    for (let tick = 1001; tick <= 1004; tick++) predictor.predictTick(tick, FORWARD);
    const oldX = xOf(predictor.worldAt(1004), "me");

    const corrected = baseline(1000, 290);
    predictor.setBaseline(corrected, new Map([["them", NEUTRAL_INPUT]]));
    const deltas = predictor.resim(1004, () => FORWARD);
    const newX = xOf(predictor.worldAt(1004), "me");

    expect(newX).toBeCloseTo(oldX - 10, 6);
    expect(deltas.get("me")!.dx).toBeCloseTo(10, 6);
    expect(deltas.get("me")!.dy).toBeCloseTo(0, 6);
    expect(deltas.has("them")).toBe(false);
  });

  it("reports nothing when the resim reproduces what was already predicted", () => {
    predictor.setBaseline(baseline(), new Map([["them", NEUTRAL_INPUT]]));
    for (let tick = 1001; tick <= 1003; tick++) predictor.predictTick(tick, FORWARD);
    const same = predictor.worldAt(1000)!;
    predictor.setBaseline(same, new Map([["them", NEUTRAL_INPUT]]));
    expect(predictor.resim(1003, () => FORWARD).size).toBe(0);
  });

  it("never re-simulates more than maxPredictionTicks ticks", () => {
    predictor.setBaseline(baseline(), new Map([["them", NEUTRAL_INPUT]]));
    const far = 1000 + NET_CONFIG.maxPredictionTicks + 20;
    let calls = 0;
    predictor.resim(far, () => {
      calls += 1;
      return FORWARD;
    });
    expect(calls).toBe(NET_CONFIG.maxPredictionTicks);
  });

  it("keeps the contact events of the newest predicted tick", () => {
    const touching: WorldState = {
      tick: 1000, mode: "ffa",
      cars: [
        car(0, "me", 300, { speed: 400, maneuver: 1, maneuverTicksLeft: 10, maneuverSpeed: 1600, maneuverWeaponId: "thunderclap" }),
        car(1, "them", 330, { angle: Math.PI }),
      ],
      contact: emptyContactMemory(),
    };
    predictor.setBaseline(touching, new Map([["them", NEUTRAL_INPUT]]));
    predictor.predictTick(1001, NEUTRAL_INPUT);
    expect(predictor.lastContacts.map((e) => e.kind)).toEqual(["dashHit"]);
  });
});
```

```ts
// packages/client/src/match/render-offset.test.ts
import { describe, expect, it } from "vitest";
import { NET_CONFIG } from "@motor-combat-moba/shared";
import { NetStats } from "./netgraph.js";
import { RenderOffsets, wrapAngle } from "./render-offset.js";

function offsets(): { offsets: RenderOffsets; stats: NetStats } {
  const stats = new NetStats();
  return { offsets: new RenderOffsets(NET_CONFIG, stats), offsets2: undefined, stats } as never;
}

describe("RenderOffsets", () => {
  it("returns the whole correction on the frame it lands", () => {
    const stats = new NetStats();
    const o = new RenderOffsets(NET_CONFIG, stats);
    o.add("me", 6, -8, 0.25);
    expect(o.offsetOf("me")).toEqual({ dx: 6, dy: -8, dAngle: 0.25 });
    expect(stats.corrections).toBe(1);
    expect(stats.snaps).toBe(0);
  });

  it("decays to nothing within correctionMs and is forgotten after it", () => {
    const o = new RenderOffsets(NET_CONFIG, new NetStats());
    o.add("me", 10, 0, 0);
    o.decay(NET_CONFIG.correctionMs / 2);
    const half = o.offsetOf("me").dx;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(10);
    o.decay(NET_CONFIG.correctionMs / 2);
    expect(o.offsetOf("me")).toEqual({ dx: 0, dy: 0, dAngle: 0 });
  });

  it("adds a second correction to whatever is left of the first", () => {
    const o = new RenderOffsets(NET_CONFIG, new NetStats());
    o.add("me", 10, 0, 0);
    o.decay(NET_CONFIG.correctionMs / 2);
    const left = o.offsetOf("me").dx;
    o.add("me", 4, 0, 0);
    expect(o.offsetOf("me").dx).toBeCloseTo(left + 4, 6);
  });

  it("counts a snap and applies no offset past snapUnits", () => {
    const stats = new NetStats();
    const o = new RenderOffsets(NET_CONFIG, stats);
    o.add("me", NET_CONFIG.snapUnits + 1, 0, 0);
    expect(o.offsetOf("me")).toEqual({ dx: 0, dy: 0, dAngle: 0 });
    expect(stats.snaps).toBe(1);
  });

  it("counts a snap past snapRadians even when the car barely moved", () => {
    const stats = new NetStats();
    const o = new RenderOffsets(NET_CONFIG, stats);
    o.add("me", 1, 0, NET_CONFIG.snapRadians + 0.1);
    expect(o.offsetOf("me").dAngle).toBe(0);
    expect(stats.snaps).toBe(1);
  });

  it("takes the short way round the angle seam", () => {
    const o = new RenderOffsets(NET_CONFIG, new NetStats());
    o.add("me", 0, 0, Math.PI * 2 - 0.2);
    expect(o.offsetOf("me").dAngle).toBeCloseTo(-0.2, 6);
    expect(wrapAngle(Math.PI * 4 + 0.3)).toBeCloseTo(0.3, 6);
  });

  it("forgets one car and all of them on demand", () => {
    const o = new RenderOffsets(NET_CONFIG, new NetStats());
    o.add("me", 5, 0, 0);
    o.add("them", 5, 0, 0);
    o.forget("them");
    expect(o.offsetOf("them").dx).toBe(0);
    o.clear();
    expect(o.offsetOf("me").dx).toBe(0);
  });
});
```

Delete the stray `offsets()` helper at the top of that file — every test builds its own pair; it is listed here only to show the two constructor arguments and must not be pasted.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/client && npx vitest run src/match/local-inputs.test.ts src/match/prediction.test.ts src/match/render-offset.test.ts`
Expected: FAIL — three unresolved modules.

- [ ] **Step 3: Write `local-inputs.ts`**

```ts
// packages/client/src/match/local-inputs.ts
import { NET_CONFIG, NEUTRAL_INPUT, type InputFrame } from "@motor-combat-moba/shared";

/**
 * The local car's own inputs, by tick, for the resim to replay.
 *
 * The client's mirror of the server's `InputRing`, and deliberately the same shape of answer: a tick
 * the ring no longer holds reads as `NEUTRAL_INPUT`, which is exactly what the server would have
 * driven that tick on if the input never arrived. `NET_CONFIG.ringSize` (128 ticks, 2.1 s at 60 Hz)
 * is four times the longest resim `maxPredictionTicks` permits, so a tick the resim needs is never
 * one the ring has recycled.
 *
 * Fixed size, written in place: memory does not grow with match length (§6.13).
 */
export class LocalInputs {
  private readonly frames: (InputFrame | undefined)[];
  private readonly ticks: number[];

  constructor(private readonly size: number = NET_CONFIG.ringSize) {
    this.frames = new Array<InputFrame | undefined>(size).fill(undefined);
    this.ticks = new Array<number>(size).fill(-1);
  }

  set(tick: number, input: InputFrame): void {
    const slot = this.slotOf(tick);
    this.frames[slot] = input;
    this.ticks[slot] = tick;
  }

  at(tick: number): InputFrame {
    const slot = this.slotOf(tick);
    return this.ticks[slot] === tick ? this.frames[slot]! : NEUTRAL_INPUT;
  }

  private slotOf(tick: number): number {
    const slot = tick % this.size;
    return slot < 0 ? slot + this.size : slot;
  }
}
```

- [ ] **Step 4: Write `render-offset.ts`**

```ts
// packages/client/src/match/render-offset.ts
import type { NET_CONFIG } from "@motor-combat-moba/shared";
import type { NetStats } from "./netgraph.js";

/** One car's visual correction: what to ADD to its sim pose when drawing it. */
export interface CarDelta {
  dx: number;
  dy: number;
  dAngle: number;
}

const ZERO: CarDelta = Object.freeze({ dx: 0, dy: 0, dAngle: 0 });

/**
 * How sharply the correction is pulled out of the picture. The curve is `(1 + a)·e^-a` with
 * `a = DECAY_SHAPE · age / correctionMs` — the critically damped step response, which starts at 1
 * with zero slope and lands near zero without overshooting, so a correction neither jerks on the
 * frame it arrives nor drifts visibly at the end. At `DECAY_SHAPE` 6 the residue when the offset is
 * dropped is 1.7 % of it: under half a unit on a correction at the 24 u mark, which is a pixel.
 */
const DECAY_SHAPE = 6;

/** Shortest signed rotation from one angle to another, in (-PI, PI]. */
export function wrapAngle(delta: number): number {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

interface Entry extends CarDelta {
  ageMs: number;
}

/**
 * Corrections as render offsets (netcode spec N19).
 *
 * Sim state is never eased. When a resim moves a car, the difference between where it was drawn and
 * where it now is becomes an offset that the renderer ADDS to the sim pose and that decays to zero
 * over `correctionMs`. The sim keeps the exact value; only the picture lags, and only for 120 ms.
 * That is the whole of F8's fix.
 *
 * A correction past `snapUnits` or `snapRadians` is applied with **no** offset at all — a slow slide
 * over a whole car length reads worse than a cut — and is counted as a snap. §8's phase 3 acceptance
 * is that the snap counter stays at zero at the design point, so the counter is the alarm, not the
 * mechanism.
 */
export class RenderOffsets {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly cfg: Pick<typeof NET_CONFIG, "correctionMs" | "snapUnits" | "snapRadians">,
    private readonly stats: NetStats,
  ) {}

  /**
   * Absorb one correction. `dx/dy/dAngle` are **old pose minus new pose**: adding them back keeps
   * the car where it was already drawn, and letting them decay walks it to where it really is.
   */
  add(sessionId: string, dx: number, dy: number, dAngle: number): void {
    const angle = wrapAngle(dAngle);
    const distance = Math.hypot(dx, dy);
    // One counting site for corrections and snaps, so the netgraph and the harness cannot disagree.
    this.stats.recordCorrection(distance);
    if (distance > this.cfg.snapUnits || Math.abs(angle) > this.cfg.snapRadians) {
      this.entries.delete(sessionId);
      return;
    }
    // A second correction lands on whatever is LEFT of the first, and restarts the clock.
    const standing = this.offsetOf(sessionId);
    this.entries.set(sessionId, {
      dx: standing.dx + dx,
      dy: standing.dy + dy,
      dAngle: standing.dAngle + angle,
      ageMs: 0,
    });
  }

  decay(deltaMs: number): void {
    if (!(deltaMs > 0)) return;
    for (const [sessionId, entry] of this.entries) {
      entry.ageMs += deltaMs;
      if (entry.ageMs >= this.cfg.correctionMs) this.entries.delete(sessionId);
    }
  }

  offsetOf(sessionId: string): CarDelta {
    const entry = this.entries.get(sessionId);
    if (!entry) return ZERO;
    const a = (DECAY_SHAPE * entry.ageMs) / this.cfg.correctionMs;
    const k = (1 + a) * Math.exp(-a);
    return { dx: entry.dx * k, dy: entry.dy * k, dAngle: entry.dAngle * k };
  }

  /** A car that left the room, so a recycled session id cannot inherit a stranger's slide. */
  forget(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  /** A new match or a reconnect: nothing carries across. */
  clear(): void {
    this.entries.clear();
  }
}
```

`match/netgraph.ts`: `recordCorrection`'s snap threshold was `NET_CONFIG.reconcileSnapPos`, which Task 1 deleted. Substitute `NET_CONFIG.snapUnits`; nothing else in that file changes.

- [ ] **Step 5: Write `prediction.ts`**

```ts
// packages/client/src/match/prediction.ts
import {
  NEUTRAL_INPUT,
  stepWorld,
  type ArenaDef,
  type CarState,
  type ContactEvent,
  type InputFrame,
  type NET_CONFIG,
  type WorldState,
} from "@motor-combat-moba/shared";
import { wrapAngle, type CarDelta } from "./render-offset.js";

type PredictorConfig = Pick<
  typeof NET_CONFIG,
  "maxPredictionTicks" | "maxExtrapolationTicks" | "remoteSteerHoldTicks"
>;

/**
 * The client's half of approach C (spec §4): predict the **whole** world, not just the local car.
 *
 * Each local tick the predictor builds one input map — the driver's real input for the local car,
 * each remote's echoed `lastInput` from the newest snapshot (N20) — and calls the same `stepWorld`
 * the server calls. The local car and every remote it can touch therefore exist at the same tick on
 * the same screen, which is what makes contact (N21) resolve against a hull that is *there* rather
 * than against one that is four ticks stale. That is F1.
 *
 * When a snapshot lands, `setBaseline` replaces the world at that tick and `resim` re-runs every
 * tick since from the stored inputs. Sim state is exact afterwards; the difference between the pose
 * that was on screen and the pose that is now correct is handed back as a per-car delta for the
 * render offsets (N19). Nothing here eases anything.
 *
 * Two knobs bound what a remote is allowed to be guessed into, both from `NET_CONFIG`:
 * `remoteSteerHoldTicks` is how long a held steer is believed before the predictor assumes it was
 * released, and `maxExtrapolationTicks` is where the guess stops entirely and the car simply holds —
 * still solid, still a wall, just not invented any further. §6.6's error table is what those two
 * numbers are tuned against, and the harness reports the value that minimises mean error.
 */
export class WorldPredictor {
  private local = "";
  private base: WorldState | undefined;
  private echo: ReadonlyMap<string, InputFrame> = new Map();
  private contacts: readonly ContactEvent[] = [];
  private readonly ring: (WorldState | undefined)[];
  private readonly size: number;

  constructor(
    private readonly arena: ArenaDef,
    private readonly cfg: PredictorConfig,
  ) {
    // Four times the longest replay the cap permits, so a ring slot is never recycled under a resim.
    this.size = cfg.maxPredictionTicks * 4;
    this.ring = new Array<WorldState | undefined>(this.size).fill(undefined);
  }

  /** Which car takes the driver's own input. Set once, when the driven seat is known. */
  setLocal(sessionId: string): void {
    this.local = sessionId;
  }

  get baselineTick(): number {
    return this.base?.tick ?? -1;
  }

  /** The contact events of the newest tick `predictTick` produced — the local feedback source (F7). */
  get lastContacts(): readonly ContactEvent[] {
    return this.contacts;
  }

  setBaseline(world: WorldState, inputsEcho: ReadonlyMap<string, InputFrame>): void {
    this.base = world;
    this.echo = inputsEcho;
    this.ring.fill(undefined);
    this.put(world);
  }

  worldAt(tick: number): WorldState | undefined {
    const world = this.ring[this.slotOf(tick)];
    return world?.tick === tick ? world : undefined;
  }

  predictTick(localTick: number, localInput: InputFrame): WorldState {
    const previous = this.worldAt(localTick - 1) ?? this.base;
    if (!previous) throw new Error("WorldPredictor: predictTick before setBaseline");
    const { world, contactEvents } = this.stepOne(previous, localInput);
    this.contacts = contactEvents;
    this.put(world);
    return world;
  }

  /**
   * Re-simulate `baseline.tick + 1 … localTick` from the stored local inputs and the new echoes,
   * and report what moved.
   *
   * The loop is bounded by `maxPredictionTicks` in the code as well as by the caller: at the design
   * point the gap is `lead + RTT/2` ≈ 8–9 ticks and this is 9 `stepWorld` calls of six cars; the
   * worst case is 30, once, on the snapshot that ends a 500 ms stall, and `MatchClient` re-anchors
   * its clock before that so even that case cannot compound.
   */
  resim(localTick: number, localInputs: (tick: number) => InputFrame): ReadonlyMap<string, CarDelta> {
    const base = this.base;
    if (!base) return new Map();
    const before = this.worldAt(localTick);

    let world = base;
    for (
      let tick = base.tick + 1;
      tick <= localTick && tick - base.tick <= this.cfg.maxPredictionTicks;
      tick++
    ) {
      const stepped = this.stepOne(world, localInputs(tick));
      world = stepped.world;
      this.contacts = stepped.contactEvents;
      this.put(world);
    }

    if (!before || before.tick !== world.tick) return new Map();
    return deltasBetween(before, world);
  }

  /**
   * One tick of the whole world. The local car takes the driver's input; a remote takes its echoed
   * `lastInput`, its steer dropped past `remoteSteerHoldTicks` and the whole car frozen past
   * `maxExtrapolationTicks`.
   *
   * A frozen remote is restored to its pre-step state rather than removed: it stays solid, so the
   * local car still resolves against it, but nothing further is invented about where it went. It
   * also takes no knock while frozen — the next snapshot is what corrects that, through a resim and
   * a render offset like everything else.
   */
  private stepOne(
    previous: WorldState,
    localInput: InputFrame,
  ): { world: WorldState; contactEvents: readonly ContactEvent[] } {
    const age = previous.tick + 1 - (this.base?.tick ?? previous.tick);
    const inputs = new Map<string, InputFrame>();
    const frozen = new Set<string>();

    for (const car of previous.cars) {
      if (car.sessionId === this.local) {
        inputs.set(car.sessionId, localInput);
        continue;
      }
      if (age > this.cfg.maxExtrapolationTicks) {
        frozen.add(car.sessionId);
        inputs.set(car.sessionId, NEUTRAL_INPUT);
        continue;
      }
      const last = this.echo.get(car.sessionId) ?? NEUTRAL_INPUT;
      inputs.set(car.sessionId, age > this.cfg.remoteSteerHoldTicks ? { ...last, steer: 0 } : last);
    }

    const { world, contactEvents } = stepWorld(previous, inputs, this.arena);
    if (frozen.size === 0) return { world, contactEvents };

    const held = new Map<string, CarState>();
    for (const car of previous.cars) if (frozen.has(car.sessionId)) held.set(car.sessionId, car);
    return {
      world: { ...world, cars: world.cars.map((car) => held.get(car.sessionId) ?? car) },
      contactEvents,
    };
  }

  private put(world: WorldState): void {
    this.ring[this.slotOf(world.tick)] = world;
  }

  private slotOf(tick: number): number {
    const slot = tick % this.size;
    return slot < 0 ? slot + this.size : slot;
  }
}

/** Old pose minus new pose, per car, for every car that actually moved. */
function deltasBetween(before: WorldState, after: WorldState): Map<string, CarDelta> {
  const out = new Map<string, CarDelta>();
  const byId = new Map(after.cars.map((car) => [car.sessionId, car]));
  for (const old of before.cars) {
    const now = byId.get(old.sessionId);
    if (!now) continue;
    const dx = old.x - now.x;
    const dy = old.y - now.y;
    const dAngle = wrapAngle(old.angle - now.angle);
    if (dx === 0 && dy === 0 && dAngle === 0) continue;
    out.set(old.sessionId, { dx, dy, dAngle });
  }
  return out;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/client && npx vitest run src/match/`
Expected: PASS. No file under `src/match/` imports Phaser — check with `grep -rn "phaser" packages/client/src/match/` (case-insensitive), which must print nothing.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/match/local-inputs.ts packages/client/src/match/local-inputs.test.ts packages/client/src/match/prediction.ts packages/client/src/match/prediction.test.ts packages/client/src/match/render-offset.ts packages/client/src/match/render-offset.test.ts packages/client/src/match/netgraph.ts
git commit -m "feat(client): whole-world prediction, remote extrapolation and render offsets (N16, N17, N19, N20)"
```

No probe number moves in this commit — nothing calls the new classes yet.

---
