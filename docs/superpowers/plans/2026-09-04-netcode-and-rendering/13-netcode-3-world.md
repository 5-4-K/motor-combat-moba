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

- [ ] **Step 7: The two things `stepWorld` reads that the wire does not carry yet**

`stepWorld` reads `CarState.maneuverWeaponId` and it reads `WorldState.contact`. Invariant 8, as this
phase restates it, makes both snapshot fields, and N13 says so in as many words: *"`ContactMemory` …
rides in the snapshot as a bitset of touching pairs (15 bits for 6 cars) plus per-car slam ticks."*
Without the pair set a client's edge trigger restarts on every snapshot and a pair grinding together
would take a fresh knock every tick; without the weapon id a client cannot tell a dash from a charge.

These are the **only** fields this phase adds to the wire. `carId`, `team` and the match `mode` stay
on the lobby half of the schema: all three are fixed for a car's whole match, and the roster message
and the protocol hash are what pin them.

In `packages/shared/src/net/codec.ts`:

| Where | Before | After |
|---|---|---|
| `PROTOCOL_VERSION` | `1` | `2` — the layout changed; `protocolHash()` already folds it in, so a mismatched build is refused at join by the message phase 2's Task 3 wrote |
| header | `u8 flags · u32 tick · u32 ackTick · i8 slackTicks` (10 B) | append `u16 contactPairs` → **12 B**. Bit `k` of the word is set when the k-th index pair is touching, `k` walking `(0,1), (0,2) … (0,5), (1,2) …` — 15 pairs for `MAX_PLAYERS` of 6, which is exactly a `u16` |
| `SnapshotCar` | (no maneuver-weapon field) | add `maneuverWeaponId: WeaponId \| "";` under `lastFiredSlot`, commented "the weapon behind the running maneuver, `\"\"` when none — on the wire because `stepWorld` reads it (N15)" |
| car group 3 `maneuver` | `u8 kind · u16 ticksLeft · u16 angle · u16 speed` (7 B) | append `· u8 weaponIndexOf(maneuverWeaponId) + 1` (0 = none) → **8 B**; the group's delta predicate compares five fields, not four |
| `Snapshot` | `{ tick, full, lateInput, ackTick, slackTicks, cars, instances, events }` | add `contactPairs: number` and `slams: SnapshotSlam[]` |
| after the instances section | (events section next) | a **slam section**: `u8 count`, then per entry `u8 victimIndex · u8 byIndex + 1 · i16 stunWindowUntilTick · i16 immuneUntilTick` (6 B each, ticks relative to the header tick like every other clock). One byte when nothing is slammed, which is almost always |

```ts
/** One live slam record, straight off `WorldState.contact.slammed`. */
export interface SnapshotSlam {
  victimIndex: number;
  byIndex: number;          // -1 when the roster no longer knows the attacker
  stunWindowUntilTick: number;
  immuneUntilTick: number;
}
export function pairBitOf(a: number, b: number): number;   // index pair -> bit position, a < b
export function contactPairsOf(touching: ReadonlySet<string>, roster: Roster): number;
export function touchingFrom(bits: number, roster: Roster): Set<string>;
```

`weaponIndexOf`/`weaponIdAt` are the pair the codec already uses for a slot's `weaponId` and an
instance's `weapon` byte; the `+ 1` sentinel is the convention already used for `lockTargetIndex` and
`sourceIndex`. `contactPairsOf`/`touchingFrom` are the only two functions that know a pair is a bit,
and they round-trip through `pairKey` so the set the client rebuilds is spelled exactly the way
`resolveContacts` spells it (`"a|b"`, session ids, `a < b`).

The byte figures the phase-2 codec test pins move by the header's two bytes, the slam section's
count byte, and one byte per car per **full** snapshot. Update `codec.test.ts`:

| Case | Before | After | Arithmetic |
|---|---|---|---|
| Full, 6 cars (3 slots, 1 status), 20 instances | 677 | **686** | `12 + 1 + 6 × 65 + 1 + 20 × 14 + 1 + 1` |
| Full, 6 cars (3 slots, no statuses), 20 instances | 641 | **650** | `12 + 1 + 6 × 59 + 1 + 20 × 14 + 1 + 1` |
| Full, a live 6-car match (1 status, 8 instances) | 509 | **518** | `12 + 1 + 390 + 1 + 112 + 1 + 1` |
| Delta, steady state (6 cars driving, 4 instances) | 125 | **128** | `12 + 1 + 6 × 12 + 1 + 4 × 10 + 1 + 1` |
| Delta, contact + volley, one live slam | 330 | **339** | `12 + 1 + 6 × 31 + 1 + 12 × 10 + 1 + 6 + 1 + 11` |
| Delta, an idle lobby | 31 | **34** | `12 + 1 + 6 × 3 + 1 + 1 + 1` |

686 B clears §8's full-snapshot line of 700 B and 128 B clears its steady-state delta line of 350 B,
both by construction; the two bolded figures are pinned exactly by the tests below so a later layout
change cannot drift past them unnoticed. Update the layout table in the codec's own header comment
(the header row, group 3, the new slam section, and "full car, 3 slots, 0 statuses: 58 B" → 59 B),
then add three assertions to `codec.test.ts`:

```ts
it("round-trips the weapon behind a running maneuver, and `\"\"` when there is none", () => {
  const dashing = { ...car(0, 300), maneuverWeaponId: "thunderclap" as const };
  const idle = { ...car(1, 900), maneuverWeaponId: "" as const };
  const out = decodeSnapshot(encodeSnapshot({ ...full(), cars: [dashing, idle] }, undefined, ROSTER), undefined, ROSTER);
  expect(out.cars[0]!.maneuverWeaponId).toBe("thunderclap");
  expect(out.cars[1]!.maneuverWeaponId).toBe("");
});

it("round-trips the touching pair set as a bitset, spelled the way resolveContacts spells it", () => {
  const snap = { ...full(), contactPairs: contactPairsOf(new Set(["aaa|bbb"]), ROSTER) };
  const out = decodeSnapshot(encodeSnapshot(snap, undefined, ROSTER), undefined, ROSTER);
  expect(out.contactPairs).toBe(snap.contactPairs);
  expect([...touchingFrom(out.contactPairs, ROSTER)]).toEqual(["aaa|bbb"]);
  expect(pairBitOf(0, 1)).toBe(0);
});

it("round-trips a live slam record and costs one byte when there is none", () => {
  const slams = [{ victimIndex: 1, byIndex: 0, stunWindowUntilTick: 1030, immuneUntilTick: 1060 }];
  const out = decodeSnapshot(encodeSnapshot({ ...full(), slams }, undefined, ROSTER), undefined, ROSTER);
  expect(out.slams).toEqual(slams);
  expect(encodeSnapshot({ ...full(), slams: [] }, undefined, ROSTER).length).toBe(650);
});
```

The last expectation reuses the "no statuses" fixture; if `full()` carries a status per car, use 686.

- [ ] **Step 8: Edit the ledger in this commit**

`docs/superpowers/plans/2026-09-04-netcode-and-rendering/interfaces.md`, three additions (execution guide §4: a plan that needs a ledger change edits the ledger in the same commit):

1. In the `net/codec.ts` block: add `maneuverWeaponId: WeaponId | "";` to `SnapshotCar` under `lastFiredSlot`; add `contactPairs: number;` and `slams: SnapshotSlam[];` to `Snapshot`; add the `SnapshotSlam` interface and the three helpers `pairBitOf`, `contactPairsOf`, `touchingFrom`; and change `PROTOCOL_VERSION = 1` to `2` with the note "bumped by N3 for the maneuver-weapon byte and the contact memory (N13)".
2. In the `sim/world.ts` block, add `team: 0 | 1;` and `maneuverWeaponId: WeaponId | "";` to `CarState`; add `bySessionId: string;` to `SlamClocks`; add `mode: "ffa" | "team";` to `WorldState`; and append below the block: "`emptyContactMemory(): ContactMemoryState` is the constructor; `carId`, `team` and `mode` are read from the lobby half of the schema on both sides — they are fixed for a match, which is what invariant 8's restatement allows."
3. In the client block, under `match/prediction.ts`, add `setLocal(sessionId: string): void`, `adopt(world, inputsEcho): void`, `readonly baselineTick: number` and `readonly lastContacts: readonly ContactEvent[]` to `WorldPredictor`; under `match/arena-net.ts` → `match/match-client.ts`, add `attachLobby(state: ArenaState): void`, `drivenSid(): string`, `canDrive(): boolean`, `forgetRemote(sessionId: string): void`, `sinceLastSnapshotMs(nowMs: number): number` and `readonly stalled: boolean`.

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
import { writeStatuses } from "./status-bridge.js";
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
    // Written through the bridge's own helper so the fixture cannot drift from the schema's row shape.
    writeStatuses(c, [{ statusId: "spiked", startTick: 10, endsTick: 100, sourceSessionId: "" }]);
    s.players.set("c", c);
    rings.set("c", new InputRing());
    worldTick(args(s, rings));
    expect(c.statuses).toHaveLength(0);
  });
});
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
    for (const sessionId of ids) sweepStatuses(state.players.get(sessionId), tick);
    return { masks, reads, contactEvents: [], approachSpeeds: new Map() };
  }

  const cars: CarState[] = [];
  for (const sessionId of ids) {
    const player = state.players.get(sessionId);
    if (!player) continue;
    if (!roster.has(sessionId)) {
      // Not a participant: still swept, never stepped, never a contact.
      sweepStatuses(player, tick);
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
function sweepStatuses(player: PlayerState | undefined, tick: number): void {
  if (!player || player.statuses.length === 0) return;
  const before = readStatuses(player);
  const after = expireStatuses(before, tick);
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

`net/snapshot-source.ts` fills the three new wire fields:

| Where | Add |
|---|---|
| `SnapshotSourceCtx` | `maneuverWeapons: ReadonlyMap<string, WeaponId \| "">;` and `contact: ContactMemoryState;` |
| the per-car object in `buildSnapshot` | `maneuverWeaponId: ctx.maneuverWeapons.get(sessionId) ?? "",` beside `lastFiredSlot` |
| the returned `Snapshot` | `contactPairs: contactPairsOf(ctx.contact.touching, roster),` and the slam section below |

```ts
  const slams: SnapshotSlam[] = [];
  for (const [victimId, clocks] of ctx.contact.slammed) {
    const victimIndex = roster.indexOf(victimId);
    if (victimIndex < 0) continue;
    slams.push({
      victimIndex,
      byIndex: roster.indexOf(clocks.bySessionId),
      stunWindowUntilTick: clocks.stunWindowUntilTick,
      immuneUntilTick: clocks.immuneUntilTick,
    });
  }
  slams.sort((a, b) => a.victimIndex - b.victimIndex);
```

Sorted by victim index so the delta comparison is stable and two snapshots describing the same state
are byte-identical. Every call site is a room's `snapshotFor(sessionId)`, which already holds
`this.combat.maneuverWeapons` and `this.ram.state` — pass both. Add two assertions to
`snapshot-source.test.ts`'s "lists cars by index…" test:

```ts
expect(snap.cars[0]!.maneuverWeaponId).toBe("thunderclap");
expect(touchingFrom(snap.contactPairs, roster)).toEqual(new Set(["a|b"]));
```

for a fixture whose `maneuverWeapons` names the weapon and whose `ram.state.touching` holds the pair.

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
  /** A baseline whose prediction was already exact: keeps the predicted ring instead of clearing it. */
  adopt(world: WorldState, inputsEcho: ReadonlyMap<string, InputFrame>): void;
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

  it("keeps the predicted ring when a baseline is adopted rather than replayed", () => {
    predictor.setBaseline(baseline(), new Map([["them", NEUTRAL_INPUT]]));
    for (let tick = 1001; tick <= 1003; tick++) predictor.predictTick(tick, FORWARD);
    const predicted = xOf(predictor.worldAt(1003), "me");
    predictor.adopt(predictor.worldAt(1000)!, new Map([["them", NEUTRAL_INPUT]]));
    expect(xOf(predictor.worldAt(1003), "me")).toBe(predicted);
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

  /**
   * Accept a baseline the prediction already matched, **keeping** everything predicted above it.
   *
   * This is N17's shortcut: when every quantised field of every car in the snapshot equals what was
   * predicted for that tick, replaying `S + 1 … localTick` provably reproduces the worlds already in
   * the ring, so the cheapest correct thing is to keep them. The caller is what decides "already
   * matched" — see `MatchClient.applySnapshot` — and it compares every car, not only the local one,
   * so a remote whose input changed always takes the full `setBaseline` + `resim` path.
   */
  adopt(world: WorldState, inputsEcho: ReadonlyMap<string, InputFrame>): void {
    this.base = world;
    this.echo = inputsEcho;
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

### Task 4: `MatchClient` — the headless match state machine (N16, N17, N18, N23)

**Files:**
- Create: `packages/client/src/match/match-client.ts`, `packages/client/src/match/match-client.test.ts`
- Delete: `packages/client/src/match/arena-net.ts`, `packages/client/src/match/arena-net.test.ts`, `packages/client/src/net/prediction.ts`, `packages/client/src/net/prediction.test.ts`, `packages/client/src/net/step-context.ts`, `packages/client/src/net/step-context.test.ts`
- Modify: `packages/client/src/net/interpolation.ts` (delete `InterpolationBuffer`, keep `blendPose`), `packages/client/src/net/interpolation.test.ts` (drop the buffer describes), `packages/client/src/match/render-frame.ts` (`lastProcessedInputSeq` → `ackTick`), `packages/client/src/match/frame-builder.ts` (the same one field)

**Interfaces:**
- Consumes: Task 3's `WorldPredictor`, `RenderOffsets`, `LocalInputs`; N2's `decodeSnapshot`/`encodeInput`/`Roster`/`RosterMessage`/`Snapshot`/`MatchTransport`/`SnapshotView`/`buildRenderFrame`; N1's `TickLoop`/`LeadController`; N0's `ClockSync`/`NetStats`; `blendPose`; `controlledCarOf`/`isSimPaused`.
- Produces:

```ts
export interface RawInput { steer: -1 | 0 | 1; throttle: -1 | 0 | 1; fireSlots: number }
export interface PumpResult { ticks: number; activeInput: boolean }
export class MatchClient {
  constructor(arena: ArenaDef, sessionId: string, transport: MatchTransport, clock: ClockSync, stats: NetStats);
  attachLobby(state: ArenaState): void;
  seed(roster: RosterMessage, first: Snapshot): void;
  pumpInput(deltaMs: number, sample: () => RawInput, nowMs?: number): PumpResult;
  onSnapshot(bytes: Uint8Array, nowMs: number): void;
  frame(nowMs: number): RenderFrame;
  drivenSid(): string;
  canDrive(): boolean;
  forgetRemote(sessionId: string): void;
  sinceLastSnapshotMs(nowMs: number): number;
  readonly localTick: number;
  readonly lead: number;
  readonly predictedPose: SimBody | undefined;
  readonly predictedContacts: readonly ContactEvent[];
  readonly latestSnapshot: Snapshot | undefined;
  readonly serverProtocolHash: string;
  /** True while the world is frozen past `maxPredictionTicks` — the connection overlay's gate. */
  readonly stalled: boolean;
}
```

#### Which of `ArenaNet`'s members survive, and how

| `ArenaNet` (P, N0, N1, N2) | `MatchClient` |
|---|---|
| `seed(roster, first)`, `onSnapshot(bytes, nowMs)` | same names, same arguments (N2's handoff kept them for exactly this) |
| `pumpInput(state, deltaMs, sample, send, nowMs?)` | `pumpInput(deltaMs, sample, nowMs?)` — the lobby state is attached once, and the send goes through the transport |
| `frame(state, nowMs, sampleNowMs)` | `frame(nowMs)` — one clock, because there is no longer an interpolation sample time distinct from the render time |
| `drivenSid(state)`, `canDrive(state)` | `drivenSid()`, `canDrive()` |
| `syncDrivenCar(state)` | gone: the driven seat is re-checked every pump, and a change re-points the predictor and clears the offsets |
| `poseFor(...)`, `forgetRemote(sid)` | `poseFor` is private (`renderPoseOf`); `forgetRemote` survives and now drops a render offset rather than an interpolation history |
| `attachStats`, `attachClock` | constructor arguments |
| `predictedPose`, `localTick`, `lead`, `latestSnapshot`, `serverProtocolHash` | unchanged |
| `sinceLastPatchMs(nowMs)` | `sinceLastSnapshotMs(nowMs)` |
| `PredictionBuffer` (`net/prediction.ts`) | **deleted.** Absorbed by `WorldPredictor`: predicting one body from a pending list is exactly what whole-world prediction generalises, and nothing else called it |
| `InterpolationBuffer` (`net/interpolation.ts`) | **deleted** with `NET_CONFIG.interpolationDelayMs`. Remotes are no longer drawn in the past at all (N20); `blendPose` stays, because drawing between sim ticks is still needed |
| `buildStepContext`, `localModifiers` (`net/step-context.ts`) | **deleted.** `stepWorld` builds every car's `StepContext` and derives every car's modifiers itself, which is the point of N13 |

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/match/match-client.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  ArenaState, MS_PER_TICK, NET_CONFIG, PlayerState, PlayerStatus, Roster, RoomPhase,
  encodeSnapshot, getArena, quantizeBody,
  type RosterMessage, type Snapshot, type SnapshotCar,
} from "@motor-combat-moba/shared";
import { ClockSync } from "./clock.js";
import { MatchClient, type RawInput } from "./match-client.js";
import { NetStats } from "./netgraph.js";
import { LoopbackTransport } from "./transport.js";

const ARENA = getArena("arena-01");
const ROSTER_MSG: RosterMessage = {
  protocolHash: "test",
  snapshotEvery: 1,
  cars: [{ index: 0, sessionId: "me" }, { index: 1, sessionId: "them" }],
};
const ROSTER = new Roster(ROSTER_MSG.cars);
const FORWARD: RawInput = { steer: 0, throttle: 1, fireSlots: 0 };
const IDLE: RawInput = { steer: 0, throttle: 0, fireSlots: 0 };

function lobby(): ArenaState {
  const s = new ArenaState();
  s.phase = RoomPhase.MATCH;
  s.arenaId = "arena-01";
  s.tick = 1000;
  for (const [i, id] of ["me", "them"].entries()) {
    const p = new PlayerState();
    p.sessionId = id;
    p.carIndex = i;
    p.name = id.toUpperCase();
    p.carId = "mirage";
    p.status = PlayerStatus.IN_MATCH;
    s.players.set(id, p);
  }
  return s;
}

function snapCar(index: number, x: number): SnapshotCar {
  return {
    index,
    body: quantizeBody({
      x, y: 360, angle: index === 0 ? 0 : Math.PI, speed: 0, reverseHold: 0, angVel: 0,
      shoveX: 0, shoveY: 0, authority: 1, maneuver: 0, maneuverTicksLeft: 0,
      maneuverAngle: 0, maneuverSpeed: 0,
    }),
    hp: 700, alive: true, onField: true, phased: false, diedAtTick: 0,
    lastInput: { steer: 0, throttle: 0, fireSlots: 0 },
    lockTargetIndex: -1, shotSeq: 0, pendingUntilTick: 0, switchLockUntilTick: 0,
    lastFiredSlot: -1, maneuverWeaponId: "", slots: [], statuses: [],
  };
}

function snapshot(tick: number, meX = 300, themX = 900): Snapshot {
  return {
    tick, full: true, lateInput: false, ackTick: tick - 1, slackTicks: 2,
    contactPairs: 0, slams: [],
    cars: [snapCar(0, meX), snapCar(1, themX)],
    instances: [], events: [],
  };
}

describe("MatchClient", () => {
  let state: ArenaState;
  let transport: LoopbackTransport;
  let clock: ClockSync;
  let stats: NetStats;
  let client: MatchClient;
  let now: number;
  let sent: Uint8Array[];

  const pump = (ms: number, sample: RawInput = FORWARD): { ticks: number; activeInput: boolean } => {
    now += ms;
    return client.pumpInput(ms, () => sample, now);
  };
  const deliver = (snap: Snapshot, previous?: Snapshot): void => {
    client.onSnapshot(encodeSnapshot(snap, previous, ROSTER), now);
  };

  beforeEach(() => {
    now = 0;
    state = lobby();
    sent = [];
    transport = new LoopbackTransport();
    // The transport's server half: what the client puts on the wire.
    transport.onClientInput((bytes) => sent.push(bytes));
    clock = new ClockSync();
    clock.onPong({ clientMs: 0, serverTick: 1000, msIntoTick: 0 }, 0);
    stats = new NetStats();
    client = new MatchClient(ARENA, "me", transport, clock, stats);
    client.attachLobby(state);
    client.seed(ROSTER_MSG, snapshot(1000));
  });

  it("drives the connection's own seat", () => {
    expect(client.drivenSid()).toBe("me");
    expect(client.canDrive()).toBe(true);
  });

  it("sends one tick-stamped input per local tick, through the transport", () => {
    const result = pump(MS_PER_TICK * 2);
    expect(result.ticks).toBe(2);
    expect(result.activeInput).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it("reports a neutral sample as inactive and still sends it", () => {
    const result = pump(MS_PER_TICK, IDLE);
    expect(result.activeInput).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("predicts the local car forward from the newest snapshot", () => {
    const before = client.predictedPose!.x;
    pump(MS_PER_TICK * 3);
    expect(client.predictedPose!.x).toBeGreaterThan(before);
    expect(client.localTick).toBeGreaterThan(1000);
  });

  it("predicts remotes too — a remote under throttle moves between snapshots", () => {
    const moving = snapshot(1000);
    moving.cars[1] = { ...moving.cars[1]!, lastInput: { steer: 0, throttle: 1, fireSlots: 0 } };
    client.seed(ROSTER_MSG, moving);
    const before = client.frame(now).cars.find((c) => c.sessionId === "them")!.pose.x;
    pump(MS_PER_TICK * 4);
    expect(client.frame(now).cars.find((c) => c.sessionId === "them")!.pose.x).toBeLessThan(before);
  });

  it("takes no correction at all when the snapshot matches the prediction", () => {
    pump(MS_PER_TICK);                       // localTick is now 1001
    const predicted = client.predictedPose!;
    const confirmed = snapshot(1001);
    confirmed.cars[0] = { ...confirmed.cars[0]!, body: quantizeBody(predicted) };
    deliver(confirmed, snapshot(1000));
    expect(stats.corrections).toBe(0);
    expect(client.predictedPose!.x).toBeCloseTo(predicted.x, 6);
  });

  it("resimulates and hands the difference to the render offsets when it does not", () => {
    pump(MS_PER_TICK * 3);
    const drawnBefore = client.frame(now).cars[0]!.pose.x;
    deliver(snapshot(1001, 260), snapshot(1000));
    expect(stats.corrections).toBe(1);
    expect(stats.snaps).toBe(0);
    // Sim state took the whole correction; the picture did not move this frame.
    expect(client.predictedPose!.x).toBeLessThan(drawnBefore);
    expect(client.frame(now).cars[0]!.pose.x).toBeCloseTo(drawnBefore, 3);
  });

  it("counts a snap and draws the truth when the correction is past a car length", () => {
    pump(MS_PER_TICK * 3);
    deliver(snapshot(1001, 300 - NET_CONFIG.snapUnits - 20), snapshot(1000));
    expect(stats.snaps).toBe(1);
    expect(client.frame(now).cars[0]!.pose.x).toBeCloseTo(client.predictedPose!.x, 3);
  });

  it("holds a snapshot in the jitter buffer while the link is jittery, and applies it when it is due", () => {
    for (let i = 0; i < NET_CONFIG.clockSamples; i++) {
      clock.onPong({ clientMs: i * 100, serverTick: 1000 + i * 6, msIntoTick: 0 }, i * 100 + 60 + (i % 2) * 40);
    }
    expect(clock.jitterMs).toBeGreaterThan(0);
    pump(MS_PER_TICK * 4);
    const applied = client.latestSnapshot!.tick;
    deliver(snapshot(client.localTick), snapshot(1000));
    expect(client.latestSnapshot!.tick).toBe(applied); // too new: still in the buffer
    pump(MS_PER_TICK * NET_CONFIG.bufferTicksMax);
    expect(client.latestSnapshot!.tick).toBeGreaterThan(applied);
  });

  it("freezes the world past maxPredictionTicks and thaws on the next snapshot", () => {
    pump(MS_PER_TICK * (NET_CONFIG.maxPredictionTicks + 4));
    expect(client.stalled).toBe(true);
    const frozen = client.predictedPose!.x;
    pump(MS_PER_TICK * 2);
    expect(client.predictedPose!.x).toBe(frozen);
    deliver(snapshot(client.localTick - 2, 700), snapshot(1000));
    expect(client.stalled).toBe(false);
  });

  it("builds a frame with the driven car flagged, the roster joined and the snapshot age filled in", () => {
    now = 2000;
    deliver(snapshot(1001), snapshot(1000));
    const frame = client.frame(2030);
    expect(frame.localSessionId).toBe("me");
    expect(frame.cars.map((c) => c.sessionId)).toEqual(["me", "them"]);
    expect(frame.cars[0]!.isLocal).toBe(true);
    expect(frame.cars[0]!.name).toBe("ME");
    expect(frame.sinceSnapshotMs).toBe(30);
    expect(frame.tick).toBe(client.localTick);
  });

  it("keeps the contact events its own prediction produced", () => {
    const close = snapshot(1000, 300, 340);
    client.seed(ROSTER_MSG, close);
    pump(MS_PER_TICK);
    expect(Array.isArray(client.predictedContacts)).toBe(true);
  });

  it("stops driving and stops predicting once the driven car is a wreck", () => {
    const dead = snapshot(1001);
    dead.cars[0] = { ...dead.cars[0]!, alive: false, onField: false };
    deliver(dead, snapshot(1000));
    expect(client.canDrive()).toBe(false);
    expect(pump(MS_PER_TICK).ticks).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/match/match-client.test.ts`
Expected: FAIL — cannot resolve `./match-client.js`.

- [ ] **Step 3: Write `MatchClient`**

```ts
// packages/client/src/match/match-client.ts
import {
  MS_PER_TICK,
  NET_CONFIG,
  RoomPhase,
  Roster,
  carIdOf,
  decodeSnapshot,
  encodeInput,
  quantizeBody,
  sidesOf,
  touchingFrom,
  type ArenaDef,
  type ArenaState,
  type CarState,
  type ContactEvent,
  type ContactMemoryState,
  type InputFrame,
  type RosterMessage,
  type SimBody,
  type SlamClocks,
  type Snapshot,
  type SnapshotCar,
  type StatusRow,
  type WorldState,
} from "@motor-combat-moba/shared";
import { blendPose } from "../net/interpolation.js";
import { controlledCarOf, isSimPaused } from "../scenes/controlled-car.js";
import type { ClockSync } from "./clock.js";
import { buildRenderFrame, type FrameInstance } from "./frame-builder.js";
import { LeadController } from "./lead.js";
import { LocalInputs } from "./local-inputs.js";
import type { NetStats } from "./netgraph.js";
import { WorldPredictor } from "./prediction.js";
import { RenderOffsets } from "./render-offset.js";
import { emptyRenderFrame, type RenderFrame } from "./render-frame.js";
import { SnapshotView } from "./snapshot-view.js";
import { TickLoop } from "./tick-loop.js";
import type { MatchTransport } from "./transport.js";

/** Raw key state for one input tick, sampled by the scene from Phaser keys. */
export interface RawInput {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fireSlots: number;
}

export interface PumpResult {
  /** Inputs sent this pump. */
  ticks: number;
  /** Whether any carried a real steer, throttle or fire — what clears the idle warning. */
  activeInput: boolean;
}

const NOTHING: PumpResult = { ticks: 0, activeInput: false };

/**
 * The client's whole match, with no Phaser in it (netcode spec N23).
 *
 * It owns the newest snapshot, the predicted world ring, the local input history, the render
 * offsets, the clock and the lead; it hands out one `RenderFrame` per frame and nothing else. Every
 * one of its parts is unit-testable in the node environment, and the netcode harness drives this
 * exact class against the real server pipeline over a link model.
 *
 * The shape of a frame's life:
 *
 * 1. `pumpInput` advances the local clock, samples the keys once per local tick, sends the input and
 *    predicts that tick of the **whole** world (N16) — the driver's car on the real input, every
 *    remote on its echoed `lastInput` (N20).
 * 2. `onSnapshot` decodes and buffers; `drain` applies a snapshot once it is `bufferTicks` old on the
 *    estimated server clock (N18), which is zero on an ordinary 60 Hz link.
 * 3. Applying a snapshot either **adopts** it — when every quantised field of every car equals what
 *    was predicted, the common case in free driving, and then nothing at all happens — or replaces
 *    the world at that tick and re-simulates every tick since from the stored inputs (N17). The
 *    difference between the pose that was on screen and the corrected one becomes a render offset
 *    (N19). Sim state is never eased.
 * 4. `frame` decays the offsets, blends between the last two predicted ticks, and adds the offset.
 *
 * The lobby half of the room — names, colours, chassis, teams, kills, the flow deadlines — is
 * attached once and read straight off the schema. `stepWorld` reads exactly three things from it:
 * each car's `carId`, each car's `team`, and the match `mode`, all three fixed for the life of a
 * match and all three inside the protocol hash. Everything that changes per tick is in the snapshot.
 */
export class MatchClient {
  private lobby: ArenaState | undefined;
  private roster = new Roster([]);
  private snapshotEvery = NET_CONFIG.snapshotEvery;
  private protocolHash = "";
  private baseline: Snapshot | undefined;
  /** The delta chain follows ARRIVAL order, which is not the order snapshots are applied in. */
  private decoded: Snapshot | undefined;
  private readonly pending: Snapshot[] = [];
  private readonly view = new SnapshotView();
  private readonly inputs = new LocalInputs();
  private readonly predictor: WorldPredictor;
  private readonly offsets: RenderOffsets;
  private readonly loop = new TickLoop(NET_CONFIG);
  private readonly leadCtl = new LeadController(NET_CONFIG);
  private leadSeeded = false;
  private frozen = false;
  private lastSnapshotAtMs = 0;
  private lastFrameMs = 0;
  private viewTick = -1;
  private driven = "";

  constructor(
    private readonly arena: ArenaDef,
    private readonly sessionId: string,
    private readonly transport: MatchTransport,
    private readonly clock: ClockSync,
    private readonly stats: NetStats,
  ) {
    this.predictor = new WorldPredictor(arena, NET_CONFIG);
    this.offsets = new RenderOffsets(NET_CONFIG, stats);
  }

  /** The lobby half of the room. Attached once, before the first snapshot. */
  attachLobby(state: ArenaState): void {
    this.lobby = state;
  }

  seed(roster: RosterMessage, first: Snapshot): void {
    this.roster = new Roster(roster.cars);
    this.snapshotEvery = roster.snapshotEvery;
    this.protocolHash = roster.protocolHash;
    this.view.reset();
    this.offsets.clear();
    this.pending.length = 0;
    this.decoded = first;
    this.baseline = first;
    this.viewTick = -1;
    this.frozen = false;
    this.leadSeeded = false;
    this.driven = this.drivenSid();
    this.predictor.setLocal(this.driven);
    this.predictor.setBaseline(this.worldFrom(first), this.echoFrom(first));
    this.loop.reanchor(first.tick);
  }

  onSnapshot(bytes: Uint8Array, nowMs: number): void {
    const snap = decodeSnapshot(bytes, this.decoded, this.roster);
    this.decoded = snap;
    this.stats.bytesIn += bytes.length;
    if (snap.lateInput) this.stats.lateInputs += 1;
    this.lastSnapshotAtMs = nowMs;
    this.pending.push(snap);
    this.drain(nowMs);
  }

  pumpInput(deltaMs: number, sample: () => RawInput, nowMs: number = performance.now()): PumpResult {
    this.drain(nowMs);
    if (!this.lobby || !this.baseline) return NOTHING;
    this.followDrivenSeat();
    if (!this.canDrive() || isSimPaused(this.lobby)) {
      // A pause must not bank time; the loop restarts from wherever the clock is when it resumes.
      this.loop.reanchor(this.loop.localTick);
      return NOTHING;
    }
    if (!this.clock.ready) return NOTHING;

    const serverTick = this.clock.serverTickAt(nowMs);
    if (!this.leadSeeded) {
      this.leadSeeded = true;
      this.leadCtl.initial(this.clock.rttMs, this.clock.jitterMs);
      this.loop.reanchor(serverTick + this.leadCtl.lead);
    }
    const ticks = this.loop.advance(deltaMs, serverTick + this.leadCtl.lead);
    let activeInput = false;

    for (let tick = this.loop.localTick - ticks + 1; tick <= this.loop.localTick; tick++) {
      const raw = sample();
      const input: InputFrame = { steer: raw.steer, throttle: raw.throttle, fireSlots: raw.fireSlots };
      if (input.steer !== 0 || input.throttle !== 0 || input.fireSlots !== 0) activeInput = true;
      this.inputs.set(tick, input);
      const bytes = encodeInput(tick, [input]);
      this.transport.sendInput(bytes);
      this.stats.bytesOut += bytes.length;
      // Predict-through, then freeze (N18). The inputs keep flowing while frozen: they are what the
      // server drives on when it hears us again, and the resim on the next snapshot replays them.
      if (tick - this.predictor.baselineTick <= NET_CONFIG.maxPredictionTicks) {
        this.predictor.predictTick(tick, input);
        this.frozen = false;
      } else {
        this.frozen = true;
      }
    }

    return { ticks, activeInput };
  }

  frame(nowMs: number): RenderFrame {
    const lobby = this.lobby;
    if (!lobby || !this.baseline) return emptyRenderFrame(nowMs);
    this.drain(nowMs);
    this.offsets.decay(Math.max(0, nowMs - this.lastFrameMs));
    this.lastFrameMs = nowMs;

    if (this.viewTick !== this.baseline.tick) {
      this.view.apply(this.baseline, this.roster, lobby);
      this.viewTick = this.baseline.tick;
    }

    const instances = this.view.instances;
    return buildRenderFrame(
      {
        // The LOCAL tick, not the snapshot's: everything the frame is measured against — a status
        // bar, a countdown, a recharge ring — is a tick clock, and the world on screen is at the
        // local tick. N4 finishes the tick-time HUD; this is the half of it the frame owes.
        tick: this.loop.localTick,
        phase: lobby.phase,
        mode: lobby.mode,
        arenaId: lobby.arenaId,
        countdownEndsTick: lobby.countdownEndsTick,
        matchStartedAtTick: lobby.matchStartedAtTick,
        matchEndsTick: lobby.matchEndsTick,
        winnerTeam: lobby.winnerTeam,
        winnerSessionId: lobby.winnerSessionId,
        players: this.view.players,
        weapons: {
          forEach: (cb: (instance: FrameInstance, id: string) => void) => {
            for (const instance of instances) cb(instance, instance.id);
          },
        },
      },
      {
        localSessionId: this.drivenSid(),
        poseOf: (sessionId, _player, serverPose) => this.renderPoseOf(sessionId, serverPose),
        nowMs,
        sinceSnapshotMs: this.sinceLastSnapshotMs(nowMs),
        tickFraction: this.loop.fraction,
      },
    );
  }

  drivenSid(): string {
    return this.lobby ? controlledCarOf(this.lobby, this.sessionId) : this.sessionId;
  }

  /**
   * The MOVER gate, read off the newest snapshot rather than off the view: `SnapshotCar.onField` is
   * `isOnField(player)` as the server evaluated it, which is exactly the predicate `stepWorld` steps
   * on. Reading it here rather than re-deriving it from the schema is what keeps the client from
   * driving a car the server has stopped stepping.
   */
  canDrive(): boolean {
    const lobby = this.lobby;
    if (!lobby || lobby.phase !== RoomPhase.MATCH) return false;
    const car = this.baselineCarOf(this.drivenSid());
    return car !== undefined && car.onField && car.alive;
  }

  /** A car that left the room, so a recycled session id cannot inherit a stranger's slide. */
  forgetRemote(sessionId: string): void {
    this.offsets.forget(sessionId);
  }

  sinceLastSnapshotMs(nowMs: number): number {
    return Math.max(0, nowMs - this.lastSnapshotAtMs);
  }

  get localTick(): number {
    return this.loop.localTick;
  }

  get lead(): number {
    return this.leadCtl.lead;
  }

  get predictedPose(): SimBody | undefined {
    const world = this.predictor.worldAt(this.loop.localTick) ?? this.predictor.worldAt(this.predictor.baselineTick);
    return world?.cars.find((car) => car.sessionId === this.drivenSid());
  }

  get predictedContacts(): readonly ContactEvent[] {
    return this.predictor.lastContacts;
  }

  get latestSnapshot(): Snapshot | undefined {
    return this.baseline;
  }

  get serverProtocolHash(): string {
    return this.protocolHash;
  }

  get stalled(): boolean {
    return this.frozen;
  }

  /* ---------------------------------------------------------------- snapshots */

  /**
   * Apply every buffered snapshot that is due.
   *
   * `bufferTicks = ceil(2·jitter / MS_PER_TICK) − snapshotEvery`, clamped to `[0, bufferTicksMax]`
   * (N18). On an ordinary link at 60 Hz snapshots that is **zero** — the next snapshot covers a late
   * one, so buying headroom would only add latency. It rises when the link's own jitter says a
   * snapshot is likely to arrive after the tick it would have been applied on, which is exactly the
   * case the buffer exists for. The second loop is the safety valve: a buffer that shrank must not
   * strand a snapshot behind it.
   */
  private drain(nowMs: number): void {
    if (this.pending.length === 0) return;
    const buffer = this.bufferTicks();
    const serverTick = this.clock.ready ? this.clock.serverTickAt(nowMs) : Number.POSITIVE_INFINITY;
    while (this.pending.length > 0 && serverTick - this.pending[0]!.tick >= buffer) {
      this.applySnapshot(this.pending.shift()!, nowMs);
    }
    while (this.pending.length > NET_CONFIG.bufferTicksMax) {
      this.applySnapshot(this.pending.shift()!, nowMs);
    }
  }

  private bufferTicks(): number {
    const raw = Math.ceil((2 * this.clock.jitterMs) / MS_PER_TICK) - this.snapshotEvery;
    return Math.max(0, Math.min(NET_CONFIG.bufferTicksMax, raw));
  }

  private applySnapshot(snap: Snapshot, nowMs: number): void {
    this.baseline = snap;
    this.frozen = false;
    this.leadCtl.observe(snap.slackTicks, nowMs);
    this.stats.slack.push(snap.slackTicks);
    if (this.stats.slack.length > NET_CONFIG.slackWindowTicks) this.stats.slack.shift();
    if (snap.slackTicks < 0) this.stats.repeatedInputs += 1;
    this.stats.lead = this.leadCtl.lead;

    // A stall longer than the predict-through cap: re-anchor the local clock onto the snapshot that
    // ended it, so the replay below is `lead` ticks rather than the whole silence (N18, N5).
    if (this.loop.localTick - snap.tick > NET_CONFIG.maxPredictionTicks) {
      this.loop.reanchor(snap.tick + this.leadCtl.lead);
    }

    const world = this.worldFrom(snap);
    const echo = this.echoFrom(snap);
    const predicted = this.predictor.worldAt(snap.tick);

    // N17's shortcut, read strictly: the replay is skipped only when EVERY car in the snapshot
    // already equals what was predicted for that tick, quantum for quantum. That is the common case
    // in free driving — nobody changed input, so nobody moved anywhere unexpected — and it is also
    // what "snapshots for remotes are always folded in" means in practice: a remote whose input
    // changed fails this comparison and takes the full resim, along with everyone else.
    if (predicted && matchesPrediction(predicted, world)) {
      this.predictor.adopt(world, echo);
      return;
    }

    this.predictor.setBaseline(world, echo);
    const deltas = this.predictor.resim(this.loop.localTick, (tick) => this.inputs.at(tick));
    for (const [sessionId, delta] of deltas) {
      this.offsets.add(sessionId, delta.dx, delta.dy, delta.dAngle);
    }
  }

  /* ---------------------------------------------------------------- adapters */

  private worldFrom(snap: Snapshot): WorldState {
    const lobby = this.lobby;
    const cars: CarState[] = snap.cars.map((car) => {
      const sessionId = this.roster.sessionIdOf(car.index);
      const seat = lobby?.players.get(sessionId);
      const statuses: StatusRow[] = car.statuses.map((row) => ({
        statusId: row.statusId,
        startTick: row.startTick,
        endsTick: row.endsTick,
        sourceSessionId: row.sourceIndex < 0 ? "" : this.roster.sessionIdOf(row.sourceIndex),
      }));
      return {
        ...car.body,
        index: car.index,
        sessionId,
        // The two lobby facts fixed for a car's whole match. Everything else here is off the wire.
        carId: carIdOf(seat ?? { carId: "" }),
        team: seat?.team === 1 ? 1 : 0,
        onField: car.onField,
        phased: car.phased,
        maneuverWeaponId: car.maneuverWeaponId,
        statuses,
      };
    });
    cars.sort((a, b) => a.index - b.index);
    return {
      tick: snap.tick,
      mode: sidesOf(lobby?.mode ?? 0),
      cars,
      contact: this.contactFrom(snap),
    };
  }

  /**
   * The contact memory off the wire (N13). Without it the client's edge trigger would restart at
   * every snapshot and two cars grinding together would take a fresh knock every tick.
   */
  private contactFrom(snap: Snapshot): ContactMemoryState {
    const slammed = new Map<string, SlamClocks>();
    for (const slam of snap.slams) {
      const victimId = this.roster.sessionIdOf(slam.victimIndex);
      if (!victimId) continue;
      slammed.set(victimId, {
        bySessionId: slam.byIndex < 0 ? "" : this.roster.sessionIdOf(slam.byIndex),
        stunWindowUntilTick: slam.stunWindowUntilTick,
        immuneUntilTick: slam.immuneUntilTick,
      });
    }
    return { touching: touchingFrom(snap.contactPairs, this.roster), slammed };
  }

  /** Each car's last input as the server used it — what a remote is extrapolated on (N20). */
  private echoFrom(snap: Snapshot): ReadonlyMap<string, InputFrame> {
    const echo = new Map<string, InputFrame>();
    for (const car of snap.cars) echo.set(this.roster.sessionIdOf(car.index), car.lastInput);
    return echo;
  }

  private baselineCarOf(sessionId: string): SnapshotCar | undefined {
    const index = this.roster.indexOf(sessionId);
    return this.baseline?.cars.find((car) => car.index === index);
  }

  /** The playground can hand the driver a different car mid-session (PG9). */
  private followDrivenSeat(): void {
    const driven = this.drivenSid();
    if (driven === this.driven) return;
    this.driven = driven;
    this.predictor.setLocal(driven);
    this.offsets.clear();
  }

  /**
   * `blend(previousTick, currentTick, fraction) + offset` — the one render rule (N19).
   *
   * The blend is what stops the car holding and jumping between sim ticks; the offset is the
   * correction, decaying, and it is added **here**, on the way out, so nothing that feeds another
   * step ever sees it. A car with no predicted world (a joiner mid-decode, a wreck) draws its
   * server pose untouched.
   */
  private renderPoseOf(sessionId: string, serverPose: SimBody): SimBody {
    const current = this.predictor.worldAt(this.loop.localTick);
    const to = current?.cars.find((car) => car.sessionId === sessionId);
    if (!to) return serverPose;
    const previous = this.predictor.worldAt(this.loop.localTick - 1);
    const from = previous?.cars.find((car) => car.sessionId === sessionId) ?? to;
    const blended = blendPose(from, to, this.loop.fraction);
    const offset = this.offsets.offsetOf(sessionId);
    return {
      ...blended,
      x: blended.x + offset.dx,
      y: blended.y + offset.dy,
      angle: blended.angle + offset.dAngle,
    };
  }
}

/**
 * Did the prediction for this tick already equal the snapshot, field for field on the wire's grid?
 *
 * The snapshot's bodies are already quantised (the server adopts its own quantised state every
 * tick, N9), so the comparison is exact rather than epsilon-based once the prediction is put on the
 * same grid. Statuses, `onField` and the maneuver weapon are compared too: they are what a resim
 * would otherwise be the only way to learn, and a status that combat applied must reach prediction
 * on the tick it lands, not the next time somebody happens to move unexpectedly.
 */
function matchesPrediction(predicted: WorldState, snapshot: WorldState): boolean {
  if (predicted.cars.length !== snapshot.cars.length) return false;
  for (const [i, car] of snapshot.cars.entries()) {
    const mine = predicted.cars[i];
    if (!mine || mine.sessionId !== car.sessionId) return false;
    if (mine.onField !== car.onField || mine.maneuverWeaponId !== car.maneuverWeaponId) return false;
    if (mine.statuses.length !== car.statuses.length) return false;
    for (const [j, row] of car.statuses.entries()) {
      const own = mine.statuses[j];
      if (!own || own.statusId !== row.statusId || own.endsTick !== row.endsTick) return false;
    }
    const q = quantizeBody(mine);
    if (
      q.x !== car.x || q.y !== car.y || q.angle !== car.angle ||
      q.speed !== car.speed || q.reverseHold !== car.reverseHold ||
      q.angVel !== car.angVel || q.shoveX !== car.shoveX || q.shoveY !== car.shoveY ||
      q.authority !== car.authority || q.maneuver !== car.maneuver ||
      q.maneuverTicksLeft !== car.maneuverTicksLeft || q.maneuverAngle !== car.maneuverAngle ||
      q.maneuverSpeed !== car.maneuverSpeed
    ) {
      return false;
    }
  }
  return true;
}
```

- [ ] **Step 4: Delete the old prediction path**

| File | Action |
|---|---|
| `packages/client/src/match/arena-net.ts`, `arena-net.test.ts` | delete. Every scenario the test held is reproduced in `match-client.test.ts` above: driven seat, one input per tick, remainder carried across pumps, neutral is inactive, nothing sent outside the match, nothing sent for a wreck, reconcile against a snapshot, prediction stops on death, remotes move, wreck draws at its server pose, the frame's shape |
| `packages/client/src/net/prediction.ts`, `prediction.test.ts` | delete. `PredictionBuffer` has no callers left: `MatchClient` uses `WorldPredictor`, and `playtest/prediction.ts` is repointed in Task 6 |
| `packages/client/src/net/step-context.ts`, `step-context.test.ts` | delete. `buildStepContext` and `localModifiers` were the client's private half of the step; `stepWorld` is now the whole of it |
| `packages/client/src/net/interpolation.ts` | delete `InterpolationBuffer` and the `Snapshot` interface it used; keep `blendPose`, `lerp` and `lerpAngle`. Update `blendPose`'s comment: "prediction advances on the 30 Hz sim clock" → "prediction advances one tick at a time on the 60 Hz sim clock while frames come at the display rate" |
| `packages/client/src/net/interpolation.test.ts` | drop every `InterpolationBuffer` describe; keep the `blendPose` ones |
| `packages/client/src/match/render-frame.ts` | `RenderCar.lastProcessedInputSeq: number` → `ackTick: number`, commented "the last input tick the server drove this car on — `Snapshot.ackTick`, and only meaningful for the local car" |
| `packages/client/src/match/frame-builder.ts` | the one line `lastProcessedInputSeq: player.lastProcessedInputSeq` → `ackTick: player.ackTick`; `FramePlayer.ackTick` already exists from phase 2 |

Then `grep -rn "lastProcessedInputSeq\|InterpolationBuffer\|PredictionBuffer\|buildStepContext\|localModifiers\|interpolationDelayMs\|reconcileSnapPos\|reconcileEaseRate\|reconcileSnapAngle" packages/ scripts/` — every remaining hit must be in `packages/server/playtest/prediction.ts`, which Task 6 owns. Fix any other hit before moving on.

- [ ] **Step 5: Run the client suite**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/client && npx vitest run && npm run typecheck`
Expected: PASS, and `grep -rin "phaser" src/match/` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/match packages/client/src/net
git commit -m "feat(client): MatchClient — whole-world prediction, resim reconcile, jitter buffer, render offsets (N16-N19, N23)"
```

**The one deliberately red window in this plan, stated plainly.** Tasks 4, 5 and 6 are one refactor
landed in three commits, and between them the tree does not fully build:

| After | `npm test` | root `npm run typecheck` | root `npm run build` | Why |
|---|---|---|---|---|
| Task 4 | green | **red** | **red** | `ArenaScene` still imports the deleted `ArenaNet`; the two harnesses still import the deleted `PredictionBuffer`. `npm run typecheck` covers `playtest/tsconfig.json`, so it sees both |
| Task 5 | green | **red** | green | `ArenaScene` is rewired; the harnesses are not |
| Task 6 | green | green | green | the harnesses are repointed — the compile break root `CLAUDE.md` says to fix on the spot, fixed in the task that owns those files |

`npm test` stays green throughout, because vitest compiles only what the suites import and no suite
imports `playtest/`. Do not "fix" the red by re-adding a deleted module; run the three tasks in order
and let Task 6 close it. If the branch has to be handed over mid-refactor, hand it over after Task 6.

---

### Task 5: `ArenaScene` composes `MatchClient` (N23, §6.12)

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts` (the field, `create`, `bindRoom`, `update`, `syncBanners`, `resetMatchState`, the netgraph's `D` expression), `packages/client/src/scenes/arena/match-banners.ts` (one banner)
- Test: none new — the scene is Phaser-bound and is covered by `npm run smoke:arena` (preparation plan, Task 10) plus the manual check below

**Interfaces:**
- Consumes: Task 4's `MatchClient`, `RawInput`, `PumpResult`.
- Produces: an `ArenaScene` whose private field is still named `net` (`MatchClient | undefined`) so `scripts/smoke-arena.mjs` keeps working unchanged, and a `MatchBanners.setConnectionWarning(visible)`.

- [ ] **Step 1: The field and the constructor call**

| Before (P, N0, N1, N2) | After |
|---|---|
| `import { ArenaNet, type RawInput } from "../match/arena-net.js";` | `import { MatchClient, type RawInput } from "../match/match-client.js";` |
| `private net: ArenaNet \| undefined;` | `private net: MatchClient \| undefined;` — the name stays so the smoke script's `scene.net` probe is untouched |
| `this.net = new ArenaNet(this.arena, this.room.sessionId);` then `this.net.attachStats(this.stats); this.net.attachClock(this.clock);` | `this.net = new MatchClient(this.arena, this.room.sessionId, this.transport, this.clock, this.stats);` followed by `this.net.attachLobby(this.room.state);` |

`this.transport`, `this.clock` and `this.stats` already exist from phases 0 and 2 and are constructed
before this line; move the `new ColyseusTransport(this.room)` assignment above it if it is not
already there.

- [ ] **Step 2: The two transport handlers**

Phase 2 left these in `create`. Only the call inside each changes:

```ts
this.offRoster = this.transport.onRoster((roster) => {
  this.serverProtocolHash = roster.protocolHash;
  if (roster.protocolHash !== protocolHash()) {
    this.showMismatch();
    return;
  }
  this.pendingRoster = roster;
});
this.offSnapshot = this.transport.onSnapshot((bytes) => {
  const nowMs = performance.now();
  if (this.pendingRoster) {
    // The first snapshot after a roster is always a full one (the server calls `sendFull` at join).
    this.net?.seed(
      this.pendingRoster,
      decodeSnapshot(bytes, undefined, new Roster(this.pendingRoster.cars)),
    );
    this.pendingRoster = undefined;
    return;
  }
  this.net?.onSnapshot(bytes, nowMs);
});
```

`bindRoom`'s `onState` loses its `net` call entirely — after N24 the schema patch carries lobby and
flow only, and `MatchClient` reads the lobby state it was attached to:

```ts
const onState = (): void => {
  this.syncBanners(this.lastFrame);
  this.syncPauseOverlay(room);
};
```

- [ ] **Step 3: `update`**

```ts
update(_time: number, delta: number): void {
  const room = this.room;
  const net = this.net;
  if (!room || !this.arena || !net) return;

  const nowMs = performance.now();
  this.pumpPauseKey(room);
  const pumped = net.pumpInput(delta, () => this.sampleInput(), nowMs);
  if (pumped.activeInput) this.banners?.hideIdleWarning();

  const frame = net.frame(nowMs);
  this.lastFrame = frame;
  this.syncBanners(frame);
  // §6.12: past `maxPredictionTicks` the world is frozen rather than guessed at, and the player is
  // told so. It clears itself on the snapshot that ends the stall.
  this.banners?.setConnectionWarning(net.stalled);

  this.spectate?.update(frame, delta);
  const cameraTarget = this.spectate?.cameraTarget(frame) ?? frame.localSessionId;
  const departed = this.carRenderer?.render(frame, cameraTarget) ?? [];
  for (const sid of departed) net.forgetRemote(sid);
  const target = carOf(frame, cameraTarget);
  if (target) this.spectate?.follow(target.pose, delta);
  this.shotRenderer?.render(frame);
  this.hudRenderer?.render(frame, this.spectate?.hudTarget(frame) ?? frame.localSessionId);
}

private syncBanners(frame: RenderFrame): void {
  if (!this.banners || !this.spectate) return;
  this.banners.sync(frame, this.spectate.view(frame));
}
```

Two changes beyond the substitution: `syncBanners` takes the frame instead of rebuilding one (the
preparation plan built a second frame per call, which is now a wasted whole-world walk), and the
banner sync moved after the pump so the banners read the frame the renderers are about to draw.
`sampleInput()` is unchanged. `create`'s final `this.syncBanners(this.room)` becomes
`this.syncBanners(this.lastFrame)`, `this.lastFrame` having been initialised to `emptyRenderFrame()`.

- [ ] **Step 4: Teardown and the netgraph**

`resetMatchState`: `this.net = undefined;` is already there and is now the whole of the netcode
teardown — `resetMatchState`'s job of tearing down prediction, interpolation and per-car buffers went
with `ArenaNet` in the preparation plan and does not come back. Add nothing.

The netgraph overlay's `D` expression (N29, written in phase 1) reads `net.lead`; the member survives
on `MatchClient` with the same name and needs no edit. Confirm with
`grep -n "net.lead" packages/client/src/scenes/ArenaScene.ts`.

- [ ] **Step 5: The connection banner**

In `scenes/arena/match-banners.ts`, beside the existing idle-warning text and created, registered and
destroyed exactly the way it is:

```ts
/** §6.12: the world is frozen past `maxPredictionTicks`, and saying so is better than a still frame. */
setConnectionWarning(visible: boolean): void {
  this.connectionText?.setVisible(visible);
}
```

with `private connectionText: Phaser.GameObjects.Text | undefined;` built in the constructor from the
same style the idle warning uses, registered through `layers.hud(...)`, carrying the string
`"Connection interrupted — reconnecting"`, positioned under the idle warning, starting hidden, and
destroyed in `destroy()`.

- [ ] **Step 6: Build, typecheck, smoke**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test
cd packages/client && npm run typecheck && cd ../..
npm run build && npm run smoke:arena
```

Expected: all green (root `npm run typecheck` is still red on the two harnesses — see Task 4's table;
that is Task 6). The smoke check drives a car with the whole match hot path on the new client.

- [ ] **Step 7: Play it**

`npm run dev`, then `http://localhost:5173/?debug=net`, Practice → Start. Confirm, in this order:

1. the car answers the key on the frame it is pressed, and the bot **glides** rather than stepping;
2. ram the bot head-on: both cars spin on **your** screen on the tick it happens, not a round trip later;
3. `corrections` climbs on contact and `snaps` stays at 0;
4. `bytes in` climbs at roughly 60 snapshots a second and `repeated` stays at 0;
5. shots, the HUD ring, statuses, the roster panel, the kill banner and `?debug=1` hitboxes all still draw;
6. alt-tab for three seconds: the car brakes to a stop for the bot and resumes with one correction and no snap;
7. `SIM_LATENCY_MS=45 SIM_JITTER_MS=10 npm run dev:server` in a second terminal: everything above still holds, `lead` settles at 4–5, and ramming still reads as contact rather than as a shove from nowhere.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/scenes/ArenaScene.ts packages/client/src/scenes/arena/match-banners.ts
git commit -m "refactor(client): ArenaScene composes MatchClient and shows the stalled-connection banner (N23)"
```

---

### Task 6: Measurement, and the approach-B checkpoint (§7, §8, execution guide §6)

**Files:**
- Modify: `packages/server/playtest/netcode.ts` (the client half, three columns, the N2 verdict, the checkpoint note), `packages/server/playtest/prediction.ts` (repointed at `MatchClient`; P1's verdict and P2's premise re-pinned), `packages/server/playtest/README.md` (the two paragraphs that describe them)
- Test: none — probes report, they do not assert

**Interfaces:**
- Consumes: `MatchClient`, `LoopbackTransport`, `ClockSync`, `NetStats`, `PlaytestWorld`, `buildSnapshot`, `encodeSnapshot`, `Roster`.
- Produces: `playtest/reports/<date-NN>/netcode.md` rows carrying the three numbers the N3 gate names.

**These are the two probes this phase invalidates, and the only two it touches.** `netcode.ts` is the
harness spec §7 created for exactly this measurement, and its client half no longer exists in the
shape it was written against. `prediction.ts` measures "the client predicts only itself", which is
the thing this phase deletes: root `CLAUDE.md` says a probe whose finding a change makes obsolete has
its **expectation** updated so the fix reads as `OK`, and is never deleted. That is what happens here.

- [ ] **Step 1: Repoint the harness's client half**

In `playtest/netcode.ts`, the `trial()` function's client is rebuilt around `MatchClient` and a
`LoopbackTransport`. The link model, the scenario set, the sub-tick phase sweep, the reporter calls
and the weapon-exposure row are **unchanged**. Substitutions:

| Before (N0, N1, N2) | After |
|---|---|
| `import { ArenaNet, type RawInput } from "../../client/src/match/arena-net.js";` | `import { MatchClient, type RawInput } from "../../client/src/match/match-client.js";` and `import { LoopbackTransport } from "../../client/src/match/transport.js";` |
| `const net = new ArenaNet(ARENA, "me"); net.attachStats(stats); net.attachClock(clock); net.seed(view);` | the block below |
| `net.pumpInput(view, MS_PER_TICK, () => FORWARD, (msg) => { up.send(msg, nowMs); … })` | `net.pumpInput(MS_PER_TICK, () => FORWARD, nowMs)` — the transport is what queues onto `up` |
| the server's `down.send({ tick, players, bytes })` patch object | `down.send(encodeSnapshot(buildSnapshot({ … }), previous, roster), nowMs)` — bytes, the same as a real room |
| `net.onPatch(view, nowMs)` and the hand-written `writeBody` back-fill | `net.onSnapshot(bytes, nowMs)` |
| `net.frame(view, f, f)` | `net.frame(f)` |
| `predictedAfterSeq` keyed by `msg.tick` | unchanged in purpose; the divergence lookup now reads `snap.ackTick` off the decoded snapshot |
| `PATCH_EVERY` | already `NET_CONFIG.snapshotEvery` from phase 1 |

```ts
  const transport = new LoopbackTransport();
  const stats = new NetStats();
  const clock = new ClockSync();
  const net = new MatchClient(ARENA, "me", transport, clock, stats);
  net.attachLobby(view);
  const seats = [{ index: 0, sessionId: "me" }, { index: 1, sessionId: "them" }];
  const roster = new Roster(seats);
  net.seed(
    { protocolHash: "harness", snapshotEvery: NET_CONFIG.snapshotEvery, cars: seats },
    firstSnapshotOf(world, roster),
  );
  // The client's outbound bytes go onto the same modelled link the old `send` callback used.
  transport.onClientInput((bytes) => up.send(bytes, nowMsRef.value));
  transport.onClientPing((ping) => up.send(ping, nowMsRef.value));
```

`transport.onClientInput` / `onClientPing` are `LoopbackTransport`'s server half, which phase 2's
handoff lists by name. `nowMsRef` is a one-field object the loop updates each tick, because the
transport callbacks fire inside `pumpInput` and need the current modelled time; declare it above the
loop as `const nowMsRef = { value: 0 };` and set `nowMsRef.value = nowMs;` at the top of each tick.
`firstSnapshotOf` is three lines beside `trial`: build a `Roster`, call the server's `buildSnapshot`
against `world.state` with an empty contact memory, and return it.

- [ ] **Step 2: The three columns the N3 gate needs**

`TrialResult` gains three fields and the reporting gains three numbers. The `remoteErrors` array
already exists and already measures the right thing — the drawn remote pose against the server's
truth — so the remote row is a percentile of what is already collected:

```ts
interface TrialResult {
  // …existing fields…
  /** Correction magnitudes recorded while the two cars were within CONTACT_GAP_U. */
  contactCorrections: number[];
  /** Corrections applied WITHOUT an offset — `NetStats.snaps`, sampled per snapshot. */
  snaps: number;
  /** |drawn remote pose − server pose| every frame. Already collected; now reported at p95. */
  remoteErrors: number[];
}
```

The N2 report (the head-on sweep) becomes the phase-3 acceptance row. Its note and verdict:

```ts
  reporter.report(
    "N2. Head-on collision: correction in contact, swept over the sub-tick phase",
    worstP95 >= 12 || worstMax > NET_CONFIG.snapUnits || worstSnaps > 0 ? VERDICT.FINDING : VERDICT.OK,
    `Two mirages closing at ${closingPerTick.toFixed(1)} u/tick; startGap swept across one tick of closing travel in ${phases} steps.\n` +
      `Phase 3's acceptance line (spec §8, execution guide §5): in-contact correction p95 < 12 u, no snap over ${NET_CONFIG.snapUnits} u,\n` +
      `zero snaps, at 90 ms RTT ± 20 ms. A correction past a car length is a cut rather than a slide, and is counted as a snap.\n` +
      `${rows.join("\n")}`,
  );
```

with each row printing `p95 over phases`, `max`, `min-of-max`, `snaps` and `remote err p95`, and the
sweep run at `latencyMs` 45 with `jitterMs` 10 added to the existing latency list so the design point
(90 ms RTT ± 20 ms) is one of the cells by name:

```ts
  for (const { latencyMs, jitterMs } of [
    { latencyMs: 0, jitterMs: 0 },
    { latencyMs: 30, jitterMs: 0 },
    { latencyMs: 45, jitterMs: 0 },
    { latencyMs: 45, jitterMs: 10 },   // <- the design point: 90 ms RTT +/- 20 ms
    { latencyMs: 60, jitterMs: 0 },
  ]) {
```

The N1 row (free driving) keeps its columns and gains `remote err p95` in the acceptance sense — it
already prints it; add `snaps` beside `correction p95`, and add to its note: `"phase 3 acceptance:
remote extrapolation error p95 < 20 u; free-driving correction stays 0"`. Its verdict becomes
`worstP95 > 1 || worstRepeatRate >= 0.01 || worstRemoteP95 >= 20 ? FINDING : OK`.

The N3 row (jitter and loss) keeps its frozen-frame column — which should now read **0.00 %** at every
cell, because remotes are predicted rather than held — and its note gains one sentence: `"Frozen
frames were the interpolation hold-last branch (F4). Phase 3 deleted the interpolation buffer, so
this column is now a regression alarm rather than a measurement: anything above zero means a remote
stopped being predicted when it should not have."` Its verdict becomes `frozenAt25 > 0 ? FINDING : OK`.

- [ ] **Step 3: Record the checkpoint**

Add one row to the report, which is what execution guide §6 is read against. It computes nothing new;
it restates the design point's three numbers side by side with the acceptance line and names the two
levers, so the decision is made from one block of text rather than by cross-reading three rows:

```ts
/* N5. The approach-B checkpoint (spec §6.6, execution guide §6) */
{
  const r = trial({ latencyMs: 45, jitterMs: 10, lossRate: 0.01, ticks: 900, seed: 11, headOn: { startGap: 0 } });
  const contactP95 = pct(r.contactCorrections, 0.95);
  const remoteP95 = pct(r.remoteErrors, 0.95);
  const pass = contactP95 < 12 && r.snaps === 0 && remoteP95 < 20;
  reporter.report(
    "N5. Approach-B checkpoint: is predicting the present good enough at the design point?",
    pass ? VERDICT.OK : VERDICT.FINDING,
    `Design point: 90 ms RTT +/- 20 ms, 1 % loss, head-on contact, ${(900 * MS_PER_TICK / 1000).toFixed(0)} s.\n` +
      `  contact correction p95 ${f2(contactP95)} u  (line: < 12 u)\n` +
      `  snaps                 ${String(r.snaps).padStart(7)}     (line: 0)\n` +
      `  remote error p95      ${f2(remoteP95)} u  (line: < 20 u)\n` +
      `  lead ${r.lead}, remoteSteerHoldTicks ${NET_CONFIG.remoteSteerHoldTicks}, maxExtrapolationTicks ${NET_CONFIG.maxExtrapolationTicks}\n` +
      `The two levers before the checkpoint fails (spec §6.6): lower the lead for the link, and tune\n` +
      `remoteSteerHoldTicks against recorded input logs. If both are exhausted and this row still\n` +
      `reads FINDING, the fallback is approach B — remotes drawn in the interpolated past with rewind\n` +
      `hit testing — and the procedure is execution guide §6: record these numbers under N3's\n` +
      `Acceptance, stop the netcode stream, and write a new N3 plan against the same ledger for the\n` +
      `user to approve. Phases 0-2 are identical under both approaches.`,
  );
}
```

`TrialResult` gains `lead: number`, filled from `net.lead` at the end of the trial (phase 1 already
prints it on the N1 row).

- [ ] **Step 4: Re-pin `prediction.ts`**

The probe's premise is gone, so its premise is what is rewritten — not its scenarios. `trial()` is
repointed at `MatchClient` exactly as Step 1 repoints the harness (same imports, same transport, same
snapshot bytes), and:

| Row | Before | After |
|---|---|---|
| the file header | "the client predicts only ITSELF and enters remotes at their last-known *server* pose … a stale remote pose is not a small error, it is a push-out computed against the wrong box" | "the client predicts the WHOLE world (netcode spec N16) and resolves against remotes at its own tick. What is left is the remote's **input-change** error over the extrapolation window (§6.6), which is zero while a remote holds its course. This probe is what shows that the correction on contact collapsed when phase 3 landed." |
| `P1`'s verdict | `worstCollision > DRIVE_CONFIG.carWidth \|\| worstFree > 1 ? "FINDING" : "OK"` | `worstCollision >= 12 \|\| worstFree > 1 ? "FINDING" : "OK"` — the phase-3 acceptance line, tighter than the car-length line it replaces, so the fix is what reads `OK` |
| `P1`'s note | "sim 30 Hz, patches 20 Hz" | "sim 60 Hz, snapshots every tick. Phase 3's line is p95 < 12 u in contact and 0 u free-driving." |
| `P2` title | "P2. Why: how stale is the remote car the client resolves against?" | "P2. What is left: how far a remote is extrapolated, and what that costs" |
| `P2` body | the staleness table (`latencyTicks + patchEvery` ticks of travel) | the window table below |
| `P2` verdict | `"KNOWN-BY-DESIGN"` | unchanged — it is a property of the design, quantified, not a defect |

```ts
  const rows: string[] = [];
  const mirageTopSpeed = forwardMaxSpeedOf("mirage");
  for (const latencyMs of [0, 15, 30, 45, 60]) {
    // The window a remote is extrapolated over (spec §6.6): one-way latency + the snapshot's age +
    // the jitter buffer (0 at 60 Hz snapshots) + the lead.
    const windowTicks =
      Math.round((latencyMs / 1000) * TICK_RATE_HZ) + NET_CONFIG.snapshotEvery + leadFor(latencyMs);
    const windowMs = windowTicks * MS_PER_TICK;
    rows.push(
      `${String(latencyMs).padStart(4)} ms one-way: window ${windowTicks} ticks (${windowMs.toFixed(0)} ms); ` +
        `a remote holding its input is exact; one that reverses full steer inside it is off by up to ` +
        `${(0.5 * STEER_ACCEL_U_PER_S2 * (windowMs / 1000) ** 2).toFixed(0)} u ` +
        `(a car is ${DRIVE_CONFIG.carWidth} u long, top speed ${mirageTopSpeed.toFixed(0)} u/s)`,
    );
  }
```

`STEER_ACCEL_U_PER_S2` is `forwardMaxSpeedOf("mirage") * turnRateOf("mirage")` — the `v·ω` term §6.6
names as the largest acceleration a player can command — computed at the top of the probe from the
live tables, never typed as a number. `leadFor(latencyMs)` is
`Math.max(NET_CONFIG.leadMin, Math.ceil((2 * latencyMs) / MS_PER_TICK / 2) + NET_CONFIG.slackTargetMax)`,
the same expression `LeadController.initial` uses; import it rather than restate it if phase 1
exported it, and otherwise inline it with that comment. The printed figures must reproduce §6.6's
error table at the matching windows (26 u at 120 ms, 33 u at 136 ms, 37 u at 145 ms) — if they do not,
the roster's turn rate has moved since the spec was written, and that is the finding, not a bug.

- [ ] **Step 5: Update the README's two paragraphs**

`playtest/README.md`: the `netcode.ts` paragraph gains "in-contact correction p95, snaps and remote
extrapolation error p95 at the design point, and the approach-B checkpoint row (N5)" where it lists
what the probe reports; the `prediction.ts` paragraph's sentence about the client predicting only
itself becomes "the client predicts the whole world and resolves against remotes at its own tick; P2
quantifies the extrapolation window that is left". Neither file's scenario list changes.

- [ ] **Step 6: Run everything, for real**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena
cd packages/server && npx tsx playtest/netcode.ts && npx tsx playtest/prediction.ts && cd ../..
npm run playtest
npm run balance -- --shape=duel --matches=20 --seed=7
```

Expected: root typecheck is green again (Task 4's red window closes here). `netcode.md`'s N2 row and
N5 row both read `OK`, with contact correction p95 under 12 u, zero snaps and remote error p95 under
20 u at the design point; N3's frozen-frame column reads 0.00 % everywhere; `prediction.md`'s P1 reads
`OK`. Keep both report folders — they are this phase's acceptance evidence.

Execution guide §7 requires the `playtest` and `balance` runs at the end of this phase and requires
handing both reports to the user before the next phase starts. Do that.

- [ ] **Step 7: Commit**

```bash
git add packages/server/playtest/netcode.ts packages/server/playtest/prediction.ts packages/server/playtest/README.md
git commit -m "test(playtest): re-point the netcode and prediction harnesses at MatchClient; phase 3 acceptance rows and the approach-B checkpoint"
```

**Say it loudly, in the summary and in the merge commit — this is the phase's biggest probe note.**

- **`playtest/netcode.ts`** — repointed at `MatchClient` (a compile break: its client half was deleted in Task 4). N1 gains a `snaps` column and a remote-error acceptance clause; N2's verdict moves from "max under a car length" to phase 3's "p95 < 12 u, zero snaps" and gains the 45 ms ± 10 ms design-point cell; N3's frozen-frame column is now a regression alarm and its verdict flips to "anything above zero is a finding"; a new N5 row states the approach-B checkpoint. Its N2 number is expected to fall by roughly an order of magnitude — that is the phase working, and it is what the gate reads.
- **`playtest/prediction.ts`** — repointed for the same compile break, and re-pinned: P1's threshold tightens to 12 u because the thing it measured is fixed, and P2 is rewritten from "how stale is the remote" (a property that no longer exists) to "how wide is the extrapolation window" (the property that replaced it). Its numbers move for a real reason and the probe is not deleted.
- **`collision.ts`, `ram.ts`, `geometry.ts`** — untouched files, but Task 2 changed the order cars are driven in and moved the whole loop into shared. Expected unchanged; **verified by the run above, not assumed**. Quote the before/after report folders in the summary.
- **`weapons.ts`, `weapons2.ts`** — `runCombat` is untouched (N14) and these read it through `PlaytestWorld`, whose `tick()` was rewritten around the same call. Expected unchanged.
- **`lan.ts`** — still not repointed at the binary wire; it has been stale since phase 1 and this plan does not touch it. Flag it again for the user rather than fixing it.

---

### Task 7: Invariants 4 and 8, and the pages spec §12 lists

**Files:**
- Modify: root `CLAUDE.md:38-41, 69-72, 99, 103`, `packages/shared/CLAUDE.md:3, 7, 82`, `packages/server/CLAUDE.md:3, 7`, `packages/client/CLAUDE.md:7, 11`, `docs/networking.md` (rewritten), `docs/architecture.md` (the tick and client paragraphs), `docs/config-reference.md` (the `NET_CONFIG` table), `docs/project-structure.md`, `docs/glossary.md`
- Test: `npm test` (the manual-page and turn-tuning suites must stay green — neither page's inputs moved)

- [ ] **Step 1: The two invariants**

Root `CLAUDE.md`, the hard-invariants list:

| # | Before | After |
|---|---|---|
| 4 | `` `stepSim` is the lockstep; server and client import the same function. `` | `` `stepWorld` is the lockstep; server and client import the same function, and `stepSim` is unchanged inside it. `` |
| 8 | `If the shared step reads it, it is a **snapshot** field — the Colyseus schema carries lobby and flow only (netcode spec N15/N24).` (N2's wording) | `` If `stepWorld` reads it, it is a **snapshot** field. The Colyseus schema carries lobby and match flow only (netcode spec N15/N24). The only things `stepWorld` reads from outside the snapshot are the arena definition, the match `mode`, and the two lobby facts fixed for a car's whole match — its `carId` and its `team` — every one of them inside the protocol hash. `` |

Then the two paragraphs in the same file that name the code this phase moved:

| Line | Before | After |
|---|---|---|
| 38–41 | "It now covers only the **mover** gate — may this car be simulated at all — in `sim/tick.ts`." | "It now covers only the **mover** gate — may this car be simulated at all — read by `stepWorld` in `packages/shared/src/sim/world.ts`. Whether it is **solid** … is `isSolid` (`isOnField && !phased`), which `solidHulls` states over the two booleans `CarState` carries and which the ram pair list reads." |
| 69–72 | "`stepSim` resolves it at the single production call site." | "`stepSim` resolves it at the single production call site, inside `stepWorld`." |

Add one paragraph after the `isOnField` one, because a reader arriving cold now needs to know where a
tick lives:

```markdown
**One tick of the world is one shared function.** `stepWorld(world, inputs, arena)`
(`packages/shared/src/sim/world.ts`) sweeps statuses, drives every on-field car through the unchanged
`stepSim` in car-index order, and resolves contact through the unchanged `resolveContacts` — and it
is pure, so the client runs it too. The **contact memory** (which pairs were touching last tick, and
the slam clocks) lives in `WorldState` rather than in the room, which is what lets a client resim
start from the same edge triggers the server had. The server's `runPipeline` calls it once per tick
through `sim/world-bridge.ts` and then runs `runCombat`, which is untouched and stays server-only;
the client's `MatchClient` calls it once per predicted tick and again for every tick of every resim.
Two things stayed on the server on purpose: `runCombat`, and the wall-stun sweep in `sim/ram-bridge.ts`
— it applies a status to a third car, and statuses on other people are never predicted.
```

- [ ] **Step 2: The package rules**

| File | Before | After |
|---|---|---|
| `packages/shared/CLAUDE.md:3` | "…input types, and `stepSim`." | "…input types, the binary codec, and the world step: `stepWorld` is the lockstep and `stepSim` is unchanged inside it." |
| `packages/shared/CLAUDE.md:7` (the P0 list) | "…identity `stepSim`." | "…identity `stepSim`, and `sim/world.ts`'s `stepWorld` / `WorldState` / `ContactMemoryState`." |
| `packages/shared/CLAUDE.md:82` | "at the single production call site" | "at the single production call site, inside `stepWorld`" |
| `packages/server/CLAUDE.md:3` | "…a 60 Hz `TickScheduler` whose `serverTick` reads each client's `InputRing` into shared `stepSim`…" (N1's wording) | "…a 60 Hz `TickScheduler` whose `worldTick` reads each client's `InputRing` into shared `stepWorld` and broadcasts one binary snapshot per client per tick…" |
| `packages/server/CLAUDE.md:7` | "…is statuses-then-drive-then-contact-then-combat: `statusTick` …, `serverTick` …, `contactTick`, then `combatTick`." | "…is world-then-sweep-then-combat: `worldTick` (`sim/world-bridge.ts`, the schema half of shared `stepWorld` — statuses, driving and contact in one pure call, returning the fire masks, the ring reads and the contact events), `wallStunSweep` (`sim/ram-bridge.ts`, the one piece of contact that stays server-side because it lands a status on a third car), then `combatTick`." Keep the rest of the paragraph — the `combat-bridge` and `CombatMemory` sentences are unchanged |
| `packages/client/CLAUDE.md:7` | the `PredictionBuffer` / `InterpolationBuffer` sentence (N1's wording) | "`MatchClient` (`src/match/`, and nothing in there imports Phaser) emits one tick-stamped input per local tick `lead` ticks ahead of the server, predicts the **whole** world — its own car on the real input, every remote on its echoed `lastInput` — through shared `stepWorld`, reconciles each binary snapshot by re-simulating rather than easing, and hides the correction in a render offset that decays over `NET_CONFIG.correctionMs`. See [`docs/networking.md`](../../docs/networking.md)." |
| `packages/client/CLAUDE.md:11` | "`buildStepContext` must keep agreeing with `serverTick`…" | "There is no client copy of the step to keep in agreement any more: `stepWorld` **is** both halves. What the client still owns is the two lobby facts it feeds in (`carId`, `team`) and the render offsets, neither of which the sim reads." |
| `packages/client/CLAUDE.md:9` | the list of pure logic beside the scene | replace `net/step-context.ts` with `match/` in the parenthetical |

- [ ] **Step 3: Rewrite `docs/networking.md`**

Spec §12: "`docs/networking.md` — rewritten by phase 3." Phase 1 and phase 2 amended it in place;
this replaces the whole file. Everything below the title:

```markdown
# Networking

Clients send inputs and nothing else (invariant 3). One input per tick, exactly: never zero — the
server repeats the last one, then goes neutral after `NET_CONFIG.repeatMaxTicks` — and never five,
because an input names the tick it is for and a second one for the same tick is a duplicate.

The match hot path does not use the Colyseus schema. Inputs go up as 5-byte binary frames and
snapshots come down as one hand-packed, delta-compressed binary frame per tick (`net/codec.ts`),
across the `MatchTransport` seam. The schema carries the lobby and the match flow only, and is what
ties the two channels together through the roster message (`net/roster.ts`), which also carries the
protocol hash a mismatched build is refused on.

## The one shared function

`stepWorld(world, inputs, arena)` in `@motor-combat-moba/shared`'s `sim/world.ts` is the lockstep
(invariant 4). One call is one tick of the world:

1. sweep every car's expired statuses at the tick being simulated, and re-derive `phased` from what
   is left;
2. record every car's approach speed — the speed it carried *into* the tick, before contact could
   reflect it;
3. drive every on-field car through the unchanged `stepSim`, in **car-index order**, each against the
   current poses of the others (`solidHulls`); resolution is sequential, so the order is part of the
   answer and both halves reproduce it from the wire's own indices;
4. resolve contact through the unchanged `resolveContacts`: the edge-triggered pair set, the
   best-knock-per-victim rule, dash hits, hard slams, wall-blocked dashes;
5. return the new world, the contact events, and the approach speeds.

It is pure. The **contact memory** — the touching pair set and the per-victim slam clocks — is part of
`WorldState`, not of the room, which is what lets a client's re-simulation start from the same edge
triggers the server had, and it rides in the snapshot as a 16-bit pair bitset plus a slam section.

Two things are deliberately **not** in it. `runCombat` is server-only and unchanged: damage, hp,
death, kills, stocks and statuses landing on other people are never predicted. And the wall-stun
sweep (`server/src/sim/ram-bridge.ts`) stays on the server for the same reason — it lands a status on
a third car, and the client learns about it a round trip later, by which time the slam's shove has
already covered for it.

## Server

Per tick, through `sim/world-bridge.ts`:

- **every** player's `InputRing` is read, in every phase, and `ackTick`/`slackTicks` are stamped —
  fresh, repeated or neutral;
- the match roster is handed to `stepWorld` during `MATCH`; players outside it are swept and left
  alone;
- the fire mask carries **presses**, `clean(now) & ~clean(previous)`, where `previous` is what the
  ring served last tick, so a held trigger fires once and silence never fires at all;
- the server then adopts its own quantised state, so what it holds is bit-identical to what it sent;
- `wallStunSweep` runs, then `runCombat`, then one snapshot per client is encoded and sent inside the
  same tick.

## Client

`MatchClient` (`packages/client/src/match/`) is the whole of it, and imports nothing from Phaser.

**Time.** `ClockSync` estimates the server's tick from ping/pong; `LeadController` decides how many
ticks ahead of that estimate to stamp inputs, from the slack the server reports; `TickLoop` runs the
local tick clock, dilating by at most `NET_CONFIG.dilationMax` toward the target and jumping when it
is more than `reanchorTicks` away.

**Prediction.** Each local tick the client builds one input map — its own real input for the driven
car, each remote's `lastInput` off the newest snapshot — and calls the same `stepWorld`. So the local
car and every remote it can touch exist at the **same tick on the same screen**, which is why a ram
resolves against a hull that is there rather than one that is several ticks stale. A remote's held
steer is believed for `remoteSteerHoldTicks`, then dropped; past `maxExtrapolationTicks` the car holds
where it is — still solid, just not guessed at any further.

**Reconciliation is a re-simulation, never an ease.** When a snapshot is applied, the client compares
it with what it predicted for that tick, on the wire's own quantisation grid. If every car matches —
the common case in free driving, because nobody changed input — the snapshot is adopted as the new
baseline and *nothing else happens*. Otherwise the world at that tick is replaced and every tick since
is re-simulated from the stored local inputs and the new remote inputs. Sim state is always exact
afterwards. The bound on that replay is `NET_CONFIG.maxPredictionTicks`; at the design point it is
eight or nine ticks.

**Corrections are a render offset.** The difference between the pose that was on screen and the
corrected one becomes a per-car `(dx, dy, dθ)` that the renderer *adds* to the sim pose and that
decays to zero over `NET_CONFIG.correctionMs` on a critically damped curve. A correction past
`snapUnits` (a car length) or `snapRadians` is applied with no offset at all — a slow slide over a
whole car length reads worse than a cut — and is counted in the netgraph as a **snap**. The
acceptance line for the design point is that the snap counter stays at zero.

**Jitter buffer.** A snapshot is applied once it is `ceil(2·jitter / MS_PER_TICK) − snapshotEvery`
ticks old on the estimated server clock, clamped to `[0, NET_CONFIG.bufferTicksMax]`. On an ordinary
link at 60 Hz snapshots that is zero, because the next snapshot covers a late one. Past
`maxPredictionTicks` (500 ms) with no snapshot the world freezes and the connection banner appears;
the snapshot that ends the stall re-anchors the clock and costs one correction.

**Drawing.** `blend(previousTick, currentTick, tickFraction) + offset`, and that is the only render
rule. The blend is why the car does not hold and jump between sim ticks at display rates above 60 Hz;
the offset is the correction, decaying. Neither ever flows back into a step.

**Angles** are compared wrapped (`atan2(sin d, cos d)`) everywhere, because `stepDrive` does not
normalise `angle`. The wire wraps it to `[0, 2π)` and the server adopts that value every tick, so
the number never grows on either side.

`CAMERA_CONFIG` is a render knob only — nothing in `stepWorld` reads it.

## Combat under latency

Combat is not predicted in this phase: the client draws the instances, hp and statuses the snapshot
gives it. Contact **is** predicted, because `stepWorld` includes it — a ram, a dash hit or a hard slam
starts on the victim's screen on the tick it happens rather than a round trip later — but the damage
and the wall-slam stun that follow are the server's and arrive late, which the shove covers for.

Hit detection is current-tick: the server tests hits at the tick it is on, with no rewind. Under
whole-world prediction the error a shooter carries is not their round trip, it is the target's
*input change* over the extrapolation window — zero for a target holding course — and every projectile
on the roster flies 13–27 ticks at engagement range. See [`combat-model.md`](combat-model.md).
```

- [ ] **Step 4: The other pages**

`docs/architecture.md`: the `serverTick` line (rewritten in phase 1) becomes
"`worldTick(state, rings, roster, memory, phase, mode, arena, maneuverWeapons)` — reads each session's
`InputRing` for this tick, hands the match roster to shared `stepWorld` (statuses, driving, contact in
one pure call), writes the poses back, and returns the fire masks, the ring reads and the contact
events."; the client paragraph's "predicted through shared `stepSim`" becomes "predicted through
shared `stepWorld` for every car, reconciled by re-simulation, corrected by a decaying render offset".

`docs/config-reference.md`, the `NET_CONFIG` table: delete the `interpolationDelayMs`,
`reconcileSnapPos`, `reconcileSnapAngle` and `reconcileEaseRate` rows; add the seven keys from Task 1
Step 1 with their comments as the notes column, and a sentence under the table: "`snapUnits` is one
car length by construction (`DRIVE_CONFIG.carWidth`), and it is the netgraph's snap threshold as well
as the phase-3 acceptance line; a correction past it is drawn as a cut, not a slide."

`docs/project-structure.md`: add `sim/world.ts` under shared `sim/`; `net/world-bridge.ts` under
server `sim/`; `match/match-client.ts`, `match/prediction.ts`, `match/render-offset.ts`,
`match/local-inputs.ts` under client `match/`; remove `sim/tick.ts` from server `sim/` and
`net/prediction.ts` / `net/step-context.ts` from client `net/`.

`docs/glossary.md`: add **World step** — "one call of shared `stepWorld`: statuses, driving and
contact for every car, at one tick. The lockstep (invariant 4)."; **Render offset** — "a per-car
`(dx, dy, dθ)` the renderer adds to a sim pose so a correction is hidden rather than eased into the
sim; decays to zero over `NET_CONFIG.correctionMs`."; **Snap** — "a correction past
`NET_CONFIG.snapUnits` or `snapRadians`, applied with no offset and counted."; and amend **Lockstep**
if it names `stepSim`.

- [ ] **Step 5: The acceptance run**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena
node --test scripts/turn-tuning-doc.test.mjs
cd packages/server && npx tsx playtest/netcode.ts && cd ../..
```

Expected: all green. `scripts/turn-tuning-doc.test.mjs` and `scripts/manual-page.test.mjs` pass
untouched — no drive constant, weapon row, chassis row or status row moved in this phase, so neither
page is owed a rebuild and `npm run build:manual` is **not** run.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md packages/shared/CLAUDE.md packages/server/CLAUDE.md packages/client/CLAUDE.md docs/networking.md docs/architecture.md docs/config-reference.md docs/project-structure.md docs/glossary.md
git commit -m "docs: stepWorld is the lockstep (invariant 4) and a snapshot field is what it reads (invariant 8)"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

---

## Acceptance

Spec §8, phase 3 row: **Ships** — "`stepWorld` in shared with `ContactMemory` in state; `MatchClient`
with whole-world prediction, resim reconcile, jitter buffer, render offsets; `ArenaScene` split into
renderers". **Fixes** — "F1, F7, F8, F11". **Acceptance** — "contact correction p95 < 12 u, zero
snaps". Execution guide §5 states the gate in full: *"contact correction p95 < 12 u and no snap over
48 u at 90 ms ± 20 ms in the harness; remote extrapolation error p95 < 20 u; checkpoint (section 6)
evaluated"*.

| Requirement | Demonstrated by |
|---|---|
| Contact correction p95 < 12 u at 90 ms ± 20 ms | `cd packages/server && npx tsx playtest/netcode.ts` — the **N2** row's `p95 over phases` column at the `45 ms / ±10 ms` cell, and the **N5** checkpoint row's first line. N2 reads `OK` |
| No snap over 48 u, and zero snaps | the same two rows' `snaps` columns; and `?debug=net` in a live practice match showing `snaps 0` after ramming the bot (Task 5 Step 7) |
| Remote extrapolation error p95 < 20 u | the N1 and N2 rows' `remote err p95` column, and N5's third line |
| The approach-B checkpoint evaluated | the **N5** row, which prints the three numbers against their lines and names the two levers and the §6 procedure. If it reads `FINDING`, follow execution guide §6 — record the numbers here, stop the netcode stream, and bring a new N3 plan for approach B to the user |
| `stepWorld` in shared, `ContactMemory` in state | `cd packages/shared && npx vitest run src/sim/world.test.ts src/sim/context.test.ts` (20 tests); `grep -n "contact" packages/shared/src/sim/world.ts` shows the memory on `WorldState` |
| `stepSim` unchanged inside it | `git diff --stat development/main -- packages/shared/src/sim/step.ts packages/shared/src/sim/drive.ts packages/shared/src/sim/collide.ts packages/shared/src/sim/contact.ts packages/shared/src/sim/ram.ts` prints **no changes**; `cd packages/shared && npx vitest run src/sim/golden.test.ts` |
| `MatchClient` with whole-world prediction, resim reconcile, jitter buffer, render offsets | `cd packages/client && npx vitest run src/match/` — `match-client.test.ts`, `prediction.test.ts`, `render-offset.test.ts`, `local-inputs.test.ts` |
| Nothing under `match/` imports Phaser, and no test does | `grep -rin "phaser" packages/client/src/match/` prints nothing; `npx vitest run` in `packages/client` runs in the node environment |
| `ArenaScene` split into renderers | landed in the preparation plan and consumed here: `wc -l packages/client/src/scenes/ArenaScene.ts` stays under 700, and `npm run smoke:arena` drives a car with the new client |
| F8 — sim state is never eased | `grep -rn "reconcileEaseRate\|reconcileSnapPos\|reconcileSnapAngle" packages/ docs/` prints nothing; the only easing in the client is `RenderOffsets`, which the renderer adds on the way out |
| F7 — one timebase per screen | `grep -rn "interpolationDelayMs\|InterpolationBuffer" packages/ docs/` prints nothing; the harness's N3 row reads 0.00 % frozen remote frames at every jitter cell |
| F1 — contact resolves against a hull at the local tick | `playtest/prediction.ts`'s **P1** row reads `OK` against the 12 u line it did not previously meet, and **P2** now reports the extrapolation window instead of the staleness that caused F1 |
| F11 — the client is testable without a browser | the four `match/` suites above, and the harness driving the real `MatchClient` |
| Everything else still green | `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena` |
| The probes, read rather than assumed | `npm run playtest` and `npm run balance -- --shape=duel --matches=20 --seed=7` (execution guide §7), both reports handed to the user before the next phase starts |

Record the measured N5 numbers here, with the date, when the phase is run — the checkpoint's outcome
is part of this file, not only of a report folder.

## Handoff

Exports and behaviour this plan produces **beyond** the ledger, for N4 and later to consume:

- **Shared, `sim/world.ts`.** `emptyContactMemory(): ContactMemoryState`; `SlamClocks.bySessionId`;
  `CarState.team` and `CarState.maneuverWeaponId`; `WorldState.mode`. `stepWorld` derives `dt` from
  `MS_PER_TICK` rather than taking it, and re-derives `phased` from the swept rows rather than
  trusting the caller. It emits **no** `ContactEvent` of kind `"ram"` — the union member is reserved,
  and filling it needs an additive change to `resolveContacts`' return value that this plan did not
  make because §11 authorises moving it unchanged. **N4's ram spark and screen shake should come from
  the `contact.touching` transition**, which both machines have, or from a `MatchEvent.ram` the server
  produces in `runCombat`'s own output — not from `stepWorld`.
- **Shared, `sim/context.ts`.** `solidHulls(cars: readonly SolidCar[], selfSessionId): Obb[]` and the
  `SolidCar` shape; `otherCarHulls` survives, delegates to it, and is behaviour-identical.
- **Shared, `net/codec.ts`.** `PROTOCOL_VERSION` is `2`. `SnapshotCar.maneuverWeaponId`,
  `Snapshot.contactPairs`, `Snapshot.slams`, `SnapshotSlam`, and the three pair helpers `pairBitOf`,
  `contactPairsOf`, `touchingFrom`. Full snapshot 686 B, steady-state delta 128 B.
- **Server.** `sim/world-bridge.ts`: `worldTick(args: WorldTickArgs): WorldTickResult` with
  `WorldTickArgs` and `WorldTickResult`. `sim/ram-bridge.ts`: `ContactMemory` is now
  `{ state: ContactMemoryState }` and `newContactMemory()` builds it — both names and all three room
  call sites unchanged; `wallStunSweep(state, memory, arena, tick): StatusRequest[]` is new.
  `SnapshotSourceCtx` gains `maneuverWeapons` and `contact`. **Deleted:** `sim/tick.ts` (`serverTick`,
  `TickResult`), `statusTick`, `contactTick`, `ContactTickResult`.
- **Client.** `match/match-client.ts`: `MatchClient` with `attachLobby`, `drivenSid`, `canDrive`,
  `forgetRemote`, `sinceLastSnapshotMs`, `lead`, `predictedContacts`, `latestSnapshot`,
  `serverProtocolHash`, `stalled`; `RawInput` and `PumpResult` keep the preparation plan's shapes and
  now live here. `match/prediction.ts`: `WorldPredictor` with `setLocal`, `adopt`, `baselineTick`,
  `lastContacts`, and `CarDelta`. `match/render-offset.ts`: `RenderOffsets` with `forget`/`clear`, and
  `wrapAngle`. `match/local-inputs.ts`: `LocalInputs`. `RenderCar.lastProcessedInputSeq` is now
  `RenderCar.ackTick`. **Deleted:** `match/arena-net.ts`, `net/prediction.ts` (`PredictionBuffer`),
  `net/step-context.ts` (`buildStepContext`, `localModifiers`), `InterpolationBuffer`;
  `blendPose` stays.
- **Config.** `NET_CONFIG` gains `bufferTicksMax`, `maxPredictionTicks`, `maxExtrapolationTicks`,
  `remoteSteerHoldTicks`, `correctionMs`, `snapUnits`, `snapRadians`, and loses
  `interpolationDelayMs`, `reconcileSnapPos`, `reconcileSnapAngle`, `reconcileEaseRate`.
- **For N4 specifically.** `MatchClient.predictedContacts` is the predicted dash/slam list for the
  newest tick and is what the local feedback layer should read before `Snapshot.events` exists.
  `WorldPredictor.worldAt(tick)` gives the ghost-shot code the extrapolated target pose at the tick a
  press happened, which is what `FirePrediction` needs to aim a ghost. `MatchClient.frame`'s
  `RenderFrame.tick` is already the **local** tick, which is half of N25; the remaining half is the
  renderers reading it instead of the snapshot's.
- **Known, bounded, and deliberately left.** A client does not run the wall-stun sweep, so a slam
  clock can survive a few predicted ticks longer on the client than on the server; the next snapshot
  carries the server's answer and the only observable effect is re-slam immunity being honoured
  slightly longer in prediction. A remote frozen past `maxExtrapolationTicks` takes no knock while
  frozen. Both are corrected by the next snapshot through the ordinary resim-and-offset path.
- **Not done here, on purpose.** `playtest/lan.ts` still speaks the pre-phase-1 message shapes and is
  an existing probe this plan does not edit; flag it for the user. `Snapshot.events` is still always
  empty — phase 4 fills it. Nothing about firing, ghosts, hp easing or the tick-time HUD is in this
  phase.

## Self-review

**Spec coverage.** N13: Task 1 (`stepWorld`, `stepSim` unchanged inside it, `ContactMemory` in
`WorldState` and on the wire) and Task 2 (the server's single call site). N14: Task 2 (`runCombat`
untouched, consuming `contactEvents` where it consumed `contactHits`/`statusRequests`; the D20
`PoseSnapshot` seam in `hits.ts` is not touched at all) and the wall-stun sweep staying server-side.
N15: Task 7 Step 1 (invariant 8 rewritten, with the three fixed-for-the-match exceptions named) and
Task 1 Step 7 (the two fields the invariant forced onto the wire). N16: Task 3 `WorldPredictor` and
Task 4 `MatchClient.pumpInput`. N17: Task 4 `applySnapshot` — adopt on an exact match, otherwise
`setBaseline` + `resim`, never an ease; Task 3's `resim` and its cost bound. N18: Task 4 `drain`,
`bufferTicks`, the `maxPredictionTicks` freeze and the re-anchor on resume; Task 1 Step 1 deletes
`interpolationDelayMs`, which spec §8's phase 0 row says is "deleted again by phase 3". N19: Task 3
`RenderOffsets` and Task 4 `renderPoseOf`. N20: Task 3 `stepOne` (echoed `lastInput`,
`remoteSteerHoldTicks`, the `maxExtrapolationTicks` hold) with §6.6's error table quoted in Task 6's
re-pinned P2 and its design point (136 ms average / 33 u) named. N21: Task 1 (contact inside
`stepWorld`, so the client predicts rams, dash hits and slams) with damage and the wall-slam stun
explicitly left to the server. N23: Task 4 (`MatchClient`, no Phaser under `match/`) and Task 5 (the
scene as composer). §6.12: the freeze-and-banner path (Tasks 4 and 5) and the decode-error path, which
still throws out of `decodeSnapshot` and drops the connection as phase 2 left it. §6.13: the resim
bound stated in `WorldPredictor.resim`'s comment and pinned by a test; fixed-size rings in
`LocalInputs` and `WorldPredictor`, so memory does not grow with match length. §7: Task 6 (the three
columns, the checkpoint row, the divergence histogram kept). §8 phase 3 and execution guide §5: the
Acceptance table. §11: Task 1's "what moves, and what is authorised to move" table, and the one
un-authorised change named and not made.

**Placeholder scan.** Every new module is printed in full. Every edit to an existing file is either a
line-cited substitution table or a printed replacement block. Every test file is real code with real
expected values, and the byte figures (686, 650, 518, 128, 339, 34) are computed from the layout table
in Task 1 Step 7, which is stated as their authority. The two places a test fixture would have been
noise — the stray `offsets()` helper and the stray `statuses.push` line — are called out and replaced
inline rather than left to be pasted.

**Type consistency.** `WorldState`/`CarState`/`ContactMemoryState`/`ContactEvent`/`WorldStepResult`
(Task 1) are what `worldTick` builds and reads (Task 2), what `WorldPredictor` steps (Task 3), and
what `MatchClient.worldFrom` produces (Task 4). `ContactMemory` (the holder) is the type of
`PipelineCtx.ram` and the second argument of both `worldTick` and `wallStunSweep`. `CarDelta` is what
`WorldPredictor.resim` returns and what `RenderOffsets.add` consumes, field for field.
`RingRead` (N1) is the value type of `WorldTickResult.reads` and the source of both the press edge and
`slackTicks`. `Snapshot`/`SnapshotCar`/`SnapshotSlam` (N2 plus Task 1 Step 7) are what `buildSnapshot`
produces, what `SnapshotBroadcaster` encodes, and what `MatchClient.worldFrom`/`contactFrom`/`echoFrom`
read. `FramePlayer`/`FrameInstance` (N2) are what `SnapshotView` fills and what `buildRenderFrame`
consumes; `MatchClient.frame` passes `poseOf` in the `FrameInputs` shape the preparation plan defined.
`MatchClient`'s members are exactly the ones `ArenaScene` calls in Task 5 and the harness calls in
Task 6.
