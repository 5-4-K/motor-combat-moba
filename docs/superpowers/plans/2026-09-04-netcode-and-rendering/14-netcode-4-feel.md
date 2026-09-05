# Netcode Phase 4 — Feel: Predicted Fire, Ghost Shots, Events and Tick-Time HUD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last gap between pressing a key and seeing something happen. The local car's fire state, its maneuvers and its shots become predictions that flip the HUD on the tick of the press; every piece of feedback in the game — sparks, flashes, shake, kill banners, hit markers — stops being guessed by the client and starts arriving as a reliable event the server put in the snapshot; and every readout on screen is computed from the local tick rather than from the last snapshot's.

**Architecture:** Three seams, none of which touches `runCombat`. (1) **Events.** `runCombat` already writes an observation bag (`CombatEvents`, `sim/combat-events.ts`) that only the balance harness reads; the room now passes one per tick and `packages/server/src/net/event-source.ts` maps it — plus the tick's `ContactEvent`s and a ram derivation — onto the `MatchEvent` list `net/codec.ts` has been able to encode since phase 2 and has been sending empty ever since. (2) **Prediction.** `packages/client/src/match/fire-prediction.ts` runs the shared `tickRecharge` → `beginFire` → `releaseShots` chain on a `FireState` rebuilt from the local car's own snapshot fields, writes maneuver fields into the predicted world through `WorldPredictor.applyLocalManeuver`, and spawns **ghost instances** with the ids the server will assign. (3) **Readouts.** `RenderFrame` gains the predicted slot state, the ghosts, the events, an eased hp value and a late-maneuver reveal; nothing under `packages/client/src/match/` imports Phaser.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), npm workspaces, Colyseus (lobby and flow only), vitest in the **node** environment for shared/server/client, `node --test` for `scripts/*.test.mjs`, `tsx` for the headless harnesses.

**Spec:** [`2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) — §6.6 (N31), §6.7 (N21, N22), §6.8 (N23a), §6.9 (N25), §6.12, §7, §8 phase 4, §9. Also [`2026-09-04-client-rendering-architecture-design.md`](../../specs/2026-09-04-client-rendering-architecture-design.md) — R18a, whose *sim-side half* (detecting the late reveal and telling the renderer) this plan owns; the drawing half belongs to the rendering stream.
**Ledger:** [`interfaces.md`](interfaces.md) — every shared name. **Previous phase:** [`13-netcode-3-world.md`](13-netcode-3-world.md) — **read its `## Handoff` in full before Task 1**; this plan sits directly on it. Phase 2 is [`12-netcode-2-wire.md`](12-netcode-2-wire.md), phase 1 [`11-netcode-1-time.md`](11-netcode-1-time.md), and the preparation plan [`01-prep-arena-scene-split-and-render-frame.md`](01-prep-arena-scene-split-and-render-frame.md). **Runbook:** [`00-execution-guide.md`](00-execution-guide.md) — §3 (how to run a plan), §5 (the N4 gate), §8 (what not to do).

**What phase 3 deleted, and must not be referenced here:** `ArenaNet`, `PredictionBuffer`, `InterpolationBuffer`, `buildStepContext`, `localModifiers`, `NET_CONFIG.interpolationDelayMs`, `NET_CONFIG.reconcileSnapPos` / `reconcileSnapAngle` / `reconcileEaseRate`, `server/src/sim/tick.ts`, `statusTick`, `contactTick`. The client is `MatchClient` + `WorldPredictor` + `RenderOffsets` + `LocalInputs`; the server's world loop is `worldTick` around shared `stepWorld`.

## Global Constraints

- **Rebuild shared before testing**: `npm run build -w @motor-combat-moba/shared`. Server and client consume built `dist`; a stale `dist` looks like "I changed constants and nothing happened".
- **Verify with root `npm test`**, never a per-workspace run alone.
- **`.js` import specifiers** on every local import; shared is imported as `@motor-combat-moba/shared`.
- **Nothing under `packages/client/src/match/` imports Phaser, and no test imports Phaser.** Every test in this plan runs in vitest's node environment.
- **Do not touch `packages/server/playtest/` except to fix a compile break**, and say loudly in the task's commit step which probe numbers your change moves. Task 6 is the one task that edits a probe, and it edits exactly one — `playtest/netcode.ts`, the harness spec §7 created for this measurement.
- **Do not edit `docs/ideas/` or `docs/invariants/`.**
- **Commit after every task** on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch cut off it). `npm install` in a fresh worktree before the first build.
- **"main" means `development/main`.**
- **No new probe files and no new probe scenarios.**
- **`runCombat` is not edited.** N14 is absolute: combat stays server-only and untouched, and every event this plan ships comes out of the observation bag `runCombat` already fills or out of state the tick already produced. If a step seems to need a change inside `sim/combat.ts`, it is the wrong step.
- **`resolveContacts` is not edited.** Phase 3 left the `ContactEvent` `"ram"` kind declared and unemitted because filling it needs an additive change to that function's return value, which sits behind the root `CLAUDE.md` "stop and ask before changing … collision-damage rules" fence. Task 1 derives the ram **outside** the sim, from the `contact.touching` transition plus the exported, pure `resolveRam`, and states exactly what that costs. Do not widen `resolveContacts`.
- **Balance tables are untouched by this phase.** No weapon row, chassis row, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `STATUS_TABLE`, `AIM_CONFIG.lockRange`, `ARENA_WIDTH` or `TICK_RATE_HZ` value changes, so `npm run build:manual` and `docs/turn-tuning.md` are **not** owed an update. Task 5 *reads* `WEAPON_TABLE` against N31 and **names a violating row for the user rather than editing it** — the edit is N6's, where it carries the manual rebuild and the balance-fingerprint consequences.
- **`PROTOCOL_VERSION` does not move.** Phase 2 already encodes and decodes every `MatchEvent` kind; this phase only fills the section. Nothing about the byte layout changes.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/sim/ram-events.ts` (create) | `ramContactsFrom`, `RamContact` — the ram derived from the contact transition, outside the sim, on both machines |
| `packages/shared/src/config/net-config.ts` (modify) | `ghostGraceTicks`, `eventsPerSnapshotMax`, `telegraphWindowMs` |
| `packages/shared/src/config/telegraph.ts` (create) | `telegraphAudit`, `TelegraphViolation` — N31 read against the live `WEAPON_TABLE` |
| `packages/shared/src/index.ts` (modify) | export `sim/ram-events.ts`, `config/telegraph.ts`, and `aimAngleFor` |
| `packages/server/src/net/event-source.ts` (create) | `matchEventsFor` — `CombatEvents` + `ContactEvent[]` + `RamContact[]` → `MatchEvent[]` |
| `packages/server/src/sim/world-bridge.ts` (modify) | `WorldTickResult.rams`: the one place with `before`, `after` and `approachSpeeds` in hand |
| `packages/server/src/rooms/tick-pipeline.ts` (modify) | the per-tick `CombatEvents` bag, `PipelineCtx.matchEvents`, the `matchEventsFor` call, `respawnSweep`'s event |
| `packages/server/src/net/snapshot-source.ts` (modify) | `SnapshotSourceCtx.events` fills `Snapshot.events` |
| `packages/server/src/rooms/{ArenaRoom,PracticeRoom,PlaygroundRoom}.ts` (modify) | the two per-tick bags and `snapshotFor(sessionId, events)` |
| `packages/client/src/match/fire-prediction.ts` (create) | `FirePrediction`, `GhostInstance`, `GhostSpawn` (N22) |
| `packages/client/src/match/prediction.ts` (modify) | `WorldPredictor.applyLocalManeuver`, `lastRams`, and the maneuver ring the resim replays |
| `packages/client/src/match/render-offset.ts` (modify) | the optional `countSnaps` flag, so an instance handover is not counted as a car snap |
| `packages/client/src/match/event-feed.ts` (create) | `EventFeed` — predicted and authoritative events merged by N23a's idempotency key |
| `packages/client/src/match/hp-ease.ts` (create) | `HpEase` — the one value eased visually while the number snaps (N25) |
| `packages/client/src/match/match-client.ts` (modify) | wires the four above; the late-maneuver reveal; the ghost counters |
| `packages/client/src/match/render-frame.ts` (modify) | `RenderCar.hpDisplay`, `hpFlashUntilTick`, `revealedManeuver`; `RenderInstance.ghost` |
| `packages/client/src/match/frame-builder.ts` (modify) | the five optional `FrameInputs` hooks that carry the above |
| `packages/client/src/match/netgraph.ts` (modify) | `presses`, `ghostShots`, `ghostMismatches`, `orphanShots`, and the view's mismatch rate |
| `packages/client/src/config/hud-feel.ts` (create) | `HUD_FEEL` — hp ease and flash durations, the only new render constants |
| `packages/client/src/scenes/arena/car-renderer.ts` (modify) | the hp bar reads `hpDisplay`; the flash |
| `packages/server/playtest/netcode.ts` (modify) | the two phase-4 columns: ghost mismatch rate and press-to-flash latency |
| `docs/networking.md`, `docs/combat-model.md`, `docs/config-reference.md`, `docs/project-structure.md`, `docs/glossary.md`, `packages/client/CLAUDE.md`, root `CLAUDE.md` (modify) | what is predicted now, and what is not |

---

### Task 1: The events channel (N23a)

**Files:**
- Create: `packages/shared/src/sim/ram-events.ts`, `packages/shared/src/sim/ram-events.test.ts`, `packages/server/src/net/event-source.ts`, `packages/server/src/net/event-source.test.ts`
- Modify: `packages/shared/src/config/net-config.ts`, `packages/shared/src/index.ts`, `packages/server/src/sim/world-bridge.ts`, `packages/server/src/rooms/tick-pipeline.ts`, `packages/server/src/net/snapshot-source.ts`, `packages/server/src/rooms/ArenaRoom.ts`, `packages/server/src/rooms/PracticeRoom.ts`, `packages/server/src/rooms/PlaygroundRoom.ts`
- Test: the two above, plus one appended describe in `packages/server/src/net/snapshot-source.test.ts`

**Interfaces:**
- Consumes: phase 3's `WorldState`, `CarState`, `ContactMemoryState`, `ContactEvent`, `WorldStepResult`, `worldTick`, `WorldTickResult`; phase 2's `Snapshot`, `MatchEvent`, `buildSnapshot`, `SnapshotSourceCtx`, `SnapshotBroadcaster`; the existing `CombatEvents`, `resolveRam`, `pairKey`, `modifiersFromRows`, `RAM_CONFIG`.
- Produces:

```ts
// shared, sim/ram-events.ts
export interface RamContact {
  attacker: string; victim: string; x: number; y: number;
  severity: number; side: ImpactSide; tick: number;
}
export function ramContactsFrom(
  before: WorldState,
  after: WorldState,
  approachSpeeds: ReadonlyMap<string, number>,
  claimedPairs: ReadonlySet<string>,
): RamContact[];

// server, net/event-source.ts
export interface EventPose { x: number; y: number }
export interface MatchEventArgs {
  tick: number;
  combat: CombatEvents;
  contactEvents: readonly ContactEvent[];
  rams: readonly RamContact[];
  respawned: readonly string[];
  presses: ReadonlyMap<string, number>;
  poseOf: (sessionId: string) => EventPose | undefined;
  max: number;
}
export function matchEventsFor(args: MatchEventArgs): { events: MatchEvent[]; dropped: number };
```

#### Why the ram is derived here rather than emitted by the sim

`resolveContacts` returns `{ knocks, contacts, events }`. A `RamKnock` is `{ sessionId, angVel, shoveX, shoveY, authority }` — the *victim's* new motion state and nothing else. There is no attacker in it, no impact point, and no severity, so `ContactEvent`'s `"ram"` kind, which the ledger declares, cannot be emitted from inside `stepWorld` without widening that return value. Phase 3 did not widen it and neither does this plan: the change is behind the root `CLAUDE.md` collision-damage fence and needs the user's word.

What is available without touching a line of the sim:

- **the transition.** `WorldState.contact.touching` is on the wire (phase 3, `Snapshot.contactPairs`) and in every predicted world, so both machines can name the pairs that *entered* contact on a tick;
- **the same inputs the sim used.** `WorldStepResult.approachSpeeds` is each car's pre-collision speed, and the post-drive poses are the cars in the returned world — exactly the two things `resolveContacts` fed `resolveRam`;
- **`resolveRam` itself**, which is exported, pure, and takes eight plain numbers per car.

So `ramContactsFrom` re-runs the *published* function on the *published* inputs for the fresh pairs only, and gets back the attacker, the victim, the side and the graded severity, exactly the values the sim computed. It is a second evaluation, not a second derivation: there is no forked copy of the rule.

**Two things it cannot recover, stated plainly.** The impact point — `resolveRam` computes a clamped contact point inside its private `spinOf` and does not return it — so `x, y` is the **midpoint of the two hull centres**, which is within half a car of the manifold and is where a spark reads correctly at arena zoom. And a pair that `resolveContacts` classified as a dash hit or a slam is excluded by `claimedPairs` rather than re-classified, because those branches are not exported. Both limits are recorded beside `ContactEvent` in [`interfaces.md`](interfaces.md); if the user authorises the richer return value, this module collapses to a read of it.

- [ ] **Step 1: Write the failing shared test**

```ts
// packages/shared/src/sim/ram-events.test.ts
import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import { getArena } from "../arena/registry.js";
import { emptyContactMemory, stepWorld, type CarState, type WorldState } from "./world.js";
import { ramContactsFrom } from "./ram-events.js";
import { NEUTRAL_INPUT, type InputFrame } from "../net/input.js";

const ARENA = getArena("arena-01");

function car(index: number, sessionId: string, x: number, angle: number, speed: number): CarState {
  return {
    index, sessionId, carId: "mirage", team: 0, maneuverWeaponId: "",
    onField: true, phased: false, statuses: [],
    x, y: 360, angle, speed, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0,
    authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
  };
}

/** Two mirages nose to nose, one closing, one stationary. */
function closing(gap: number, speed: number): WorldState {
  return {
    tick: 100,
    mode: "ffa",
    cars: [
      car(0, "aaa", 600, 0, speed),
      car(1, "bbb", 600 + DRIVE_CONFIG.carWidth + gap, Math.PI, 0),
    ],
    contact: emptyContactMemory(),
  };
}

const inputs = (): ReadonlyMap<string, InputFrame> =>
  new Map([["aaa", { ...NEUTRAL_INPUT, throttle: 1 }], ["bbb", NEUTRAL_INPUT]]);

describe("ramContactsFrom", () => {
  it("finds nothing while no pair is touching", () => {
    const before = closing(200, 300);
    const after = stepWorld(before, inputs(), ARENA);
    expect(after.world.contact.touching.size).toBe(0);
    expect(ramContactsFrom(before, after.world, after.approachSpeeds, new Set())).toEqual([]);
  });

  it("names the attacker, the victim, the side and the severity on the tick contact begins", () => {
    // One tick of travel at 300 u/s is 5 u, so a 2 u gap closes inside this tick.
    const before = closing(2, 300);
    const stepped = stepWorld(before, inputs(), ARENA);
    const rams = ramContactsFrom(before, stepped.world, stepped.approachSpeeds, new Set());
    expect(rams).toHaveLength(1);
    const ram = rams[0]!;
    expect(ram.attacker).toBe("aaa");
    expect(ram.victim).toBe("bbb");
    expect(ram.side).toBe("front");
    expect(ram.tick).toBe(stepped.world.tick);
    expect(ram.severity).toBeGreaterThan(0);
    expect(ram.severity).toBeLessThanOrEqual(1);
    // The severity IS the sim's own: it is exactly what the victim's authority was written from.
    const victim = stepped.world.cars.find((c) => c.sessionId === "bbb")!;
    expect(victim.authority).toBeCloseTo(1 + (RAM_CONFIG.authorityFloor - 1) * ram.severity, 10);
    // The impact point is the midpoint of the two hull centres, not the manifold point.
    const attacker = stepped.world.cars.find((c) => c.sessionId === "aaa")!;
    expect(ram.x).toBeCloseTo((attacker.x + victim.x) / 2, 10);
    expect(ram.y).toBeCloseTo((attacker.y + victim.y) / 2, 10);
  });

  it("is edge triggered: a pair already touching produces nothing", () => {
    const before = closing(2, 300);
    const first = stepWorld(before, inputs(), ARENA);
    expect(ramContactsFrom(before, first.world, first.approachSpeeds, new Set())).toHaveLength(1);
    const second = stepWorld(first.world, inputs(), ARENA);
    expect(ramContactsFrom(first.world, second.world, second.approachSpeeds, new Set())).toEqual([]);
  });

  it("says nothing about a touch below the minimum approach speed", () => {
    const before = closing(1, RAM_CONFIG.minApproachSpeed / 4);
    const stepped = stepWorld(before, inputs(), ARENA);
    expect(ramContactsFrom(before, stepped.world, stepped.approachSpeeds, new Set())).toEqual([]);
  });

  it("drops a pair a slam or a dash hit already claimed", () => {
    const before = closing(2, 300);
    const stepped = stepWorld(before, inputs(), ARENA);
    expect(
      ramContactsFrom(before, stepped.world, stepped.approachSpeeds, new Set(["aaa|bbb"])),
    ).toEqual([]);
  });
});
```

Run: `cd packages/shared && npx vitest run src/sim/ram-events.test.ts`
Expected: FAIL — `Cannot find module './ram-events.js'`.

- [ ] **Step 2: Write `sim/ram-events.ts`**

```ts
// packages/shared/src/sim/ram-events.ts
import { pairKey, resolveRam, type ImpactSide, type RamCar } from "./ram.js";
import { modifiersFromRows } from "./status/statuses.js";
import type { CarState, WorldState } from "./world.js";

/**
 * One ram, recovered from the contact transition rather than emitted by the sim.
 *
 * **Why this module exists.** `resolveContacts` returns only the knock — the victim's new motion
 * state — so `ContactEvent`'s `"ram"` kind cannot be filled from inside `stepWorld` without
 * widening that function's return value, which is a collision-rules change the design does not
 * authorise (netcode spec §11; root `CLAUDE.md`'s stop-and-ask fence). Everything needed is already
 * published, so this re-runs the exported, pure `resolveRam` on the exported inputs for the pairs
 * that just entered contact. It is a second EVALUATION of the sim's own rule, never a second copy
 * of it: change `resolveRam` and this moves with it.
 *
 * Server and client both call it, on the same inputs, and get the same answer — which is what lets
 * a victim's spark appear on their own screen on the tick of the hit while the authoritative event
 * for the same `(tick, attacker, victim)` arrives a round trip later and is recognised as the same
 * thing (N23a's idempotency rule).
 *
 * Two limits, deliberate and recorded in the plan folder's ledger beside `ContactEvent`:
 *
 * 1. `x, y` is the midpoint of the two hull centres. The true manifold point is computed inside
 *    `resolveRam`'s private `spinOf` and is not returned.
 * 2. A pair the contact pass classified as a dash hit or a hard slam is excluded through
 *    `claimedPairs` rather than re-classified here, because those branches are not exported. Their
 *    feedback comes from `ContactEvent` directly, which phase 3 does emit.
 */
export interface RamContact {
  attacker: string;
  victim: string;
  /** The midpoint of the two hull centres — see limit 1 above. */
  x: number;
  y: number;
  /** `resolveRam`'s graded severity: greater than 0, at most 1. */
  severity: number;
  side: ImpactSide;
  tick: number;
}

/**
 * The ram inputs for one car: the post-drive pose the contact pass measured, and the PRE-collision
 * speed it measured with. Passing the post-drive `speed` here is the exact bug `RamCar.speed`'s own
 * comment describes, which is why `approachSpeeds` is a required argument.
 */
function ramCarOf(car: CarState, approach: number, tick: number): RamCar {
  return {
    sessionId: car.sessionId,
    team: car.team === 1 ? 1 : 0,
    x: car.x,
    y: car.y,
    angle: car.angle,
    speed: approach,
    carId: car.carId,
    massMult: modifiersFromRows(car.statuses, tick).ramMass,
  };
}

export function ramContactsFrom(
  before: WorldState,
  after: WorldState,
  approachSpeeds: ReadonlyMap<string, number>,
  claimedPairs: ReadonlySet<string>,
): RamContact[] {
  if (after.contact.touching.size === 0) return [];

  const byId = new Map<string, CarState>();
  for (const car of after.cars) byId.set(car.sessionId, car);

  /**
   * Best knock per victim, mirroring `resolveContacts`' own rule: a car sandwiched by two attackers
   * in one tick takes ONE knock, so it must produce ONE event. Ties break on the attacker's session
   * id, which is the order `resolveContacts` iterates in, so the two agree.
   */
  const best = new Map<string, RamContact>();

  for (const key of after.contact.touching) {
    if (before.contact.touching.has(key)) continue;
    if (claimedPairs.has(key)) continue;
    const split = key.indexOf("|");
    if (split < 0) continue;
    const a = byId.get(key.slice(0, split));
    const b = byId.get(key.slice(split + 1));
    if (!a || !b) continue;

    const hit = resolveRam(
      ramCarOf(a, approachSpeeds.get(a.sessionId) ?? a.speed, after.tick),
      ramCarOf(b, approachSpeeds.get(b.sessionId) ?? b.speed, after.tick),
      after.mode,
    );
    if (hit === null) continue;

    const attacker = byId.get(hit.attackerId);
    const victim = byId.get(hit.victimId);
    if (!attacker || !victim) continue;

    const candidate: RamContact = {
      attacker: hit.attackerId,
      victim: hit.victimId,
      x: (attacker.x + victim.x) / 2,
      y: (attacker.y + victim.y) / 2,
      severity: hit.severity,
      side: hit.side,
      tick: after.tick,
    };
    const held = best.get(hit.victimId);
    if (
      held === undefined ||
      candidate.severity > held.severity ||
      (candidate.severity === held.severity && candidate.attacker < held.attacker)
    ) {
      best.set(hit.victimId, candidate);
    }
  }

  return [...best.values()].sort((p, q) =>
    pairKey(p.attacker, p.victim) < pairKey(q.attacker, q.victim) ? -1 : 1,
  );
}
```

Append to `packages/shared/src/index.ts`, beside the existing `sim/ram.js` line:

```ts
export { ramContactsFrom } from "./sim/ram-events.js";
export type { RamContact } from "./sim/ram-events.js";
```

Run: `cd packages/shared && npx vitest run src/sim/ram-events.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: The three `NET_CONFIG` keys**

`packages/shared/src/config/net-config.ts`, appended to the object phase 3 left:

```ts
  /**
   * Grace on a ghost shot's expiry, in ticks: a ghost lives until `lead + rttTicks +
   * ghostGraceTicks` (N22). The two terms before it are the round trip a confirmation actually
   * takes; this is the slop for a snapshot that arrived one tick into the jitter buffer.
   */
  ghostGraceTicks: 2,
  /**
   * Ceiling on `Snapshot.events` for one snapshot. Five of the six kinds are bounded by the roster
   * (at most one kill, respawn, refused, slam or ram per car per tick, so at most 6 each at the
   * 6-player cap); only `hit` is unbounded, because a piercing shot can damage several cars and a
   * volley carries several instances. Overflow therefore drops `hit` events and nothing else — the
   * hp in the same snapshot still tells the truth, so what is lost is a spark, not information.
   * Worst case on the wire is 16 x 11 B = 176 B (phase 2's layout), which keeps a
   * contact-plus-volley delta under 500 B against spec §7's 1.2 KB volley line.
   */
  eventsPerSnapshotMax: 16,
  /**
   * The wind-up a mobility power must carry for a remote client to predict it from its first tick
   * (N31 rule 1), in milliseconds. It is the design-point extrapolation window rounded up: §6.6
   * measures 136 ms average and 145 ms worst at 90 ms RTT with 60 Hz snapshots.
   *
   * Read by `config/telegraph.ts`, which AUDITS `WEAPON_TABLE` against it, and by nothing in the
   * sim. Raising it does not change what any weapon does; it changes which rows the audit names.
   */
  telegraphWindowMs: 150,
```

**`protocolHash()` does not cover `NET_CONFIG`** (phase 2 hashes `PROTOCOL_VERSION`, `TICK_RATE_HZ` and the balance tables), so these three keys do not move the hash and no client is refused for them.

- [ ] **Step 4: Write the failing server test for `matchEventsFor`**

```ts
// packages/server/src/net/event-source.test.ts
import { describe, expect, it } from "vitest";
import {
  newCombatEvents,
  type CombatEvents, type ContactEvent, type MatchEvent, type RamContact,
} from "@motor-combat-moba/shared";
import { matchEventsFor, type MatchEventArgs } from "./event-source.js";

const POSES: Record<string, { x: number; y: number }> = {
  aaa: { x: 100, y: 200 },
  bbb: { x: 300, y: 400 },
};
const poseOf = (sessionId: string) => POSES[sessionId];

function args(over: Partial<MatchEventArgs> = {}): MatchEventArgs {
  return {
    tick: 500,
    combat: newCombatEvents(),
    contactEvents: [] as readonly ContactEvent[],
    rams: [] as readonly RamContact[],
    respawned: [] as readonly string[],
    presses: new Map<string, number>(),
    poseOf,
    max: 16,
    ...over,
  };
}

function damaged(over: Partial<CombatEvents["damaged"][number]> = {}): CombatEvents["damaged"][number] {
  return {
    tick: 500,
    victimSessionId: "bbb",
    victimCarId: "bastion",
    attackerSessionId: "aaa",
    attackerCarId: "mirage",
    source: { kind: "weapon", weaponId: "magmablast", pressId: "aaa#500#0", isExplosion: false },
    amount: 42,
    killingBlow: false,
    ...over,
  };
}

const KILL: CombatEvents["killed"][number] = {
  tick: 500, victimSessionId: "bbb", victimCarId: "bastion",
  killerSessionId: "aaa", killerCarId: "mirage",
  source: { kind: "weapon", weaponId: "magmablast", pressId: "p", isExplosion: false },
};

describe("matchEventsFor", () => {
  it("turns a weapon hit into a hit event at the victim's pose", () => {
    const combat = newCombatEvents();
    combat.damaged.push(damaged());
    const { events } = matchEventsFor(args({ combat }));
    expect(events).toEqual([
      { kind: "hit", tick: 500, attacker: "aaa", victim: "bbb", weaponId: "magmablast", x: 300, y: 400, damage: 42 },
    ]);
  });

  it("says nothing about a status pulse: the strip is a burn's feedback, not a spark", () => {
    const combat = newCombatEvents();
    combat.damaged.push(damaged({ source: { kind: "pulse", statusId: "burning", sourceSessionId: "aaa" } }));
    expect(matchEventsFor(args({ combat })).events).toEqual([]);
  });

  it("ignores an entry from another tick", () => {
    const combat = newCombatEvents();
    combat.damaged.push(damaged({ tick: 499 }));
    expect(matchEventsFor(args({ combat })).events).toEqual([]);
  });

  it("emits a kill, a respawn, a slam and a ram, in that order", () => {
    const combat = newCombatEvents();
    combat.killed.push(KILL);
    const { events } = matchEventsFor(
      args({
        combat,
        respawned: ["bbb"],
        contactEvents: [{ kind: "slam", attacker: "aaa", victim: "bbb", x: 10, y: 20, severity: 1, tick: 500 }],
        rams: [{ attacker: "bbb", victim: "aaa", x: 30, y: 40, severity: 0.5, side: "flank", tick: 500 }],
      }),
    );
    expect(events).toEqual<MatchEvent[]>([
      { kind: "kill", tick: 500, killer: "aaa", victim: "bbb" },
      { kind: "respawn", tick: 500, car: "bbb" },
      { kind: "slam", tick: 500, car: "bbb", x: 10, y: 20 },
      { kind: "ram", tick: 500, attacker: "bbb", victim: "aaa", x: 30, y: 40, severity: 0.5 },
    ]);
  });

  it("reports a press that produced no shot as refused, naming the lowest pressed slot", () => {
    const { events } = matchEventsFor(args({ presses: new Map([["aaa", 0b110]]) }));
    expect(events).toEqual([{ kind: "refused", tick: 500, car: "aaa", slot: 1 }]);
  });

  it("does not report a refusal when the press did fire, whichever slot won the mask", () => {
    const combat = newCombatEvents();
    combat.fired.push({
      tick: 500, shooterSessionId: "aaa", carId: "mirage", weaponId: "afterburner",
      slot: 2, pressId: "aaa#500#2",
    });
    expect(matchEventsFor(args({ combat, presses: new Map([["aaa", 0b110]]) })).events).toEqual([]);
  });

  it("drops hit events past the cap and nothing else", () => {
    const combat = newCombatEvents();
    for (let i = 0; i < 10; i++) combat.damaged.push(damaged());
    combat.killed.push(KILL);
    const { events, dropped } = matchEventsFor(args({ combat, max: 4 }));
    expect(events).toHaveLength(4);
    expect(dropped).toBe(7);
    expect(events[0]!.kind).toBe("kill");
    expect(events.filter((e) => e.kind === "hit")).toHaveLength(3);
  });

  it("skips a hit whose victim has no pose (a car that left mid-tick)", () => {
    const combat = newCombatEvents();
    combat.damaged.push(damaged({ victimSessionId: "ccc" }));
    expect(matchEventsFor(args({ combat })).events).toEqual([]);
  });
});
```

Run: `cd packages/server && npx vitest run src/net/event-source.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 5: Write `net/event-source.ts`**

```ts
// packages/server/src/net/event-source.ts
import type {
  CombatEvents,
  ContactEvent,
  MatchEvent,
  RamContact,
} from "@motor-combat-moba/shared";

/**
 * `runCombat`'s observation bag, the tick's contact events and the derived rams, mapped onto the
 * `MatchEvent` list that rides in the snapshot (netcode spec N23a).
 *
 * **Nothing here reaches into combat.** `CombatEvents` is the seam `sim/combat-events.ts` already
 * defines for the balance harness (B3): opt-in, observation only, and nothing in the sim may read
 * an event back. Passing a bag per tick instead of per match is the whole of this file's cost.
 *
 * Events are emitted in priority order, highest first, so a truncation at `max` drops the least
 * important. Only `hit` is unbounded by the roster, so only `hit` is ever actually dropped — and a
 * dropped hit costs a spark, never information, because the victim's hp in the same snapshot is
 * already the truth.
 *
 * Idempotent per `(tick, kind, cars)` by construction: every field comes from the tick being
 * reported, so a resend after reconnect is the identical list.
 */
export interface EventPose {
  x: number;
  y: number;
}

export interface MatchEventArgs {
  tick: number;
  /** This tick's bag. The room clears it before `runCombat`; entries from other ticks are ignored anyway. */
  combat: CombatEvents;
  contactEvents: readonly ContactEvent[];
  rams: readonly RamContact[];
  /** Session ids the respawn sweep put back on the field this tick. */
  respawned: readonly string[];
  /** The fire-mask PRESSES the world step actually simulated, by session id. */
  presses: ReadonlyMap<string, number>;
  poseOf: (sessionId: string) => EventPose | undefined;
  /** `NET_CONFIG.eventsPerSnapshotMax` at the one production call site. */
  max: number;
}

/** Bit 0 is slot 0. `-1` for an empty mask, which the caller has already excluded. */
function lowestSetBit(mask: number): number {
  for (let bit = 0; bit < 32; bit++) if ((mask & (1 << bit)) !== 0) return bit;
  return -1;
}

export function matchEventsFor(args: MatchEventArgs): { events: MatchEvent[]; dropped: number } {
  const { tick, combat, poseOf } = args;
  const events: MatchEvent[] = [];

  // 1. Kills. The banner and the zoom punch; never dropped.
  for (const kill of combat.killed) {
    if (kill.tick !== tick) continue;
    events.push({ kind: "kill", tick, killer: kill.killerSessionId, victim: kill.victimSessionId });
  }

  // 2. Respawns. The phase-in effect has no other trigger: `phased` is a status row, and a row
  //    arriving is not an edge a renderer can see without remembering the previous snapshot.
  for (const sessionId of args.respawned) {
    events.push({ kind: "respawn", tick, car: sessionId });
  }

  // 3. Refusals (§6.12's last row). A non-empty press mask that produced no committed press is the
  //    exact definition: `beginFire` takes the LOWEST usable set bit, so a mask with two bits set
  //    firing one of them is the mask rule working, not a refusal. Only "nothing fired at all"
  //    counts, and the slot named is the one the player would have expected to go off.
  const firedThisTick = new Set<string>();
  for (const fired of combat.fired) if (fired.tick === tick) firedThisTick.add(fired.shooterSessionId);
  for (const [sessionId, mask] of args.presses) {
    if (mask <= 0) continue;
    if (firedThisTick.has(sessionId)) continue;
    const slot = lowestSetBit(mask);
    if (slot < 0) continue;
    events.push({ kind: "refused", tick, car: sessionId, slot });
  }

  // 4. Hard slams. The victim is who shakes, so the victim is the car the event names.
  for (const contact of args.contactEvents) {
    if (contact.kind !== "slam") continue;
    events.push({ kind: "slam", tick, car: contact.victim, x: contact.x, y: contact.y });
  }

  // 5. Rams. A dash hit is deliberately NOT a ram event: it deals damage, so it already produces a
  //    `hit` below, and drawing both would double the spark on one contact.
  for (const ram of args.rams) {
    events.push({
      kind: "ram", tick, attacker: ram.attacker, victim: ram.victim,
      x: ram.x, y: ram.y, severity: ram.severity,
    });
  }

  // 6. Hits, last because they are the only unbounded kind. A pulse (burn, repair) is excluded: its
  //    feedback is the status strip, which is already on the wire, and a bleeding car flashing four
  //    times a second reads as being shot at by something that is not there.
  for (const hit of combat.damaged) {
    if (hit.tick !== tick) continue;
    if (hit.source.kind === "pulse") continue;
    const pose = poseOf(hit.victimSessionId);
    if (!pose) continue;
    events.push({
      kind: "hit", tick,
      attacker: hit.attackerSessionId,
      victim: hit.victimSessionId,
      weaponId: hit.source.weaponId,
      x: pose.x, y: pose.y,
      damage: hit.amount,
    });
  }

  if (events.length <= args.max) return { events, dropped: 0 };
  const dropped = events.length - args.max;
  events.length = args.max;
  return { events, dropped };
}
```

Run: `cd packages/server && npx vitest run src/net/event-source.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: `worldTick` returns the rams**

`packages/server/src/sim/world-bridge.ts` is the one place that holds the world before the step, the world after it, and `approachSpeeds`, so it is where `ramContactsFrom` is called. Additive to phase 3's result type:

| In `world-bridge.ts` | Change |
|---|---|
| the import block | add `pairKey`, `ramContactsFrom` and `type RamContact` to the `@motor-combat-moba/shared` import |
| `interface WorldTickResult` | add ``/** Rams recovered from the contact transition (N23a). Empty outside `MATCH`. */ rams: RamContact[];`` |
| the `stepWorld` call site | keep the world it stepped FROM in a local — phase 3 already builds that value one statement above the call, so this is a `const before = …` rather than a rebuild |
| immediately after the `stepWorld` call | the block below |
| the returned object | `rams` |

```ts
  // The pairs the contact pass already classified as something other than a ram. `resolveContacts`
  // does not export those branches, so they are excluded rather than re-derived (see
  // `sim/ram-events.ts`'s own comment).
  const claimedPairs = new Set<string>();
  for (const contact of stepped.contactEvents) claimedPairs.add(pairKey(contact.attacker, contact.victim));
  const rams = ramContactsFrom(before, stepped.world, stepped.approachSpeeds, claimedPairs);
```

Every early-return path in `worldTick` — the non-`MATCH` phases, the empty roster — returns `rams: []` beside the empty arrays it already returns.

- [ ] **Step 7: The two per-tick bags in the pipeline**

`packages/server/src/rooms/tick-pipeline.ts`:

| Change | Detail |
|---|---|
| `PipelineCtx` | `matchEvents?: MatchEvent[]` and `droppedEvents?: number`, beside the existing `events?: CombatEvents` |
| `runPipeline`'s return | unchanged — the events go into the caller-owned sink, exactly as `CombatEvents` does, so a tick with none allocates nothing |
| after `applyCombatResult` | the block below, so every pose an event points at is the tick's final one |
| `respawnSweep` | pushes one `{ kind: "respawn", tick: ctx.state.tick, car: sessionId }` into `ctx.matchEvents` per car it revives |

The new field carries the doc-comment style of `events` directly above it:

```ts
  /**
   * Where this tick's `MatchEvent`s go, or absent for none. Caller-owned for the same reason
   * `events` above is: the room reuses one array and empties it after the snapshot goes out, so a
   * 10-minute match allocates one array rather than 36,000.
   *
   * Filled from `ctx.events` (which every room now supplies), the world step's contact events and
   * its derived rams. Observation only — nothing in the pipeline reads it back.
   */
  matchEvents?: MatchEvent[];
  /** How many events the `eventsPerSnapshotMax` cap discarded. Read by the harness, not by a room. */
  droppedEvents?: number;
```

and the call:

```ts
  if (ctx.matchEvents && ctx.events) {
    const { events, dropped } = matchEventsFor({
      tick: state.tick,
      combat: ctx.events,
      contactEvents: world.contactEvents,
      rams: world.rams,
      // `respawnSweep` runs BEFORE `runPipeline` in every room and pushes its own, so this is
      // always empty here; the parameter stays required so a future caller has to answer it.
      respawned: EMPTY_RESPAWNS,
      presses: masks,
      poseOf: (sessionId) => {
        const player = state.players.get(sessionId);
        return player ? { x: player.x, y: player.y } : undefined;
      },
      max: NET_CONFIG.eventsPerSnapshotMax,
    });
    for (const event of events) ctx.matchEvents.push(event);
    if (dropped > 0) ctx.droppedEvents = (ctx.droppedEvents ?? 0) + dropped;
  }
```

with `const EMPTY_RESPAWNS: readonly string[] = [];` at module scope.

- [ ] **Step 8: `buildSnapshot` carries the list**

`packages/server/src/net/snapshot-source.ts`:

| Change | Detail |
|---|---|
| `SnapshotSourceCtx` | `events?: readonly MatchEvent[]` |
| `buildSnapshot`'s returned object | `events: [...(ctx.events ?? [])]` — a copy, because the room empties its array after the broadcast while the encoder runs once per client |

Appended to `packages/server/src/net/snapshot-source.test.ts`:

```ts
describe("buildSnapshot events", () => {
  it("carries the tick's events, copies them, and defaults to none", () => {
    const s = state();
    const base = {
      state: s, roster: ROSTER, memory: newCombatMemory(), seq: new ShotSeqTable(),
      reads: new Map(), contact: emptyContactMemory(), maneuverWeapons: new Map(),
    };
    expect(buildSnapshot({ ...base }).events).toEqual([]);
    const events: MatchEvent[] = [{ kind: "kill", tick: 500, killer: "me", victim: "them" }];
    const snap = buildSnapshot({ ...base, events });
    expect(snap.events).toEqual(events);
    expect(snap.events).not.toBe(events);
  });
});
```

- [ ] **Step 9: Wire the three rooms**

The same five edits in `ArenaRoom.ts`, `PracticeRoom.ts` and `PlaygroundRoom.ts` — all three already share the `ctx()` / `snapshotFor` shape phases 2 and 3 gave them, so this is one change repeated:

| Add | Where |
|---|---|
| `private readonly tickEvents = newCombatEvents();` and `private readonly pendingEvents: MatchEvent[] = [];` | beside the existing `combat` / `ram` memory fields |
| `events: this.tickEvents, matchEvents: this.pendingEvents,` | in `ctx()`'s returned object |
| `this.tickEvents.fired.length = 0; this.tickEvents.damaged.length = 0; this.tickEvents.killed.length = 0;` | at the top of `tick()`, before `respawnSweep` |
| `this.pendingEvents.length = 0;` | immediately after `this.broadcaster.afterTick(...)` |
| `snapshotFor(sessionId: string, events: readonly MatchEvent[] = [])` forwarding `events` to `buildSnapshot` | `afterTick`'s callback passes `this.pendingEvents`; the `sendFull` path passes nothing |

**`sendFull` deliberately carries no events.** A joining or reconnecting client has no history for a spark to belong to; it needs the world, and the first ordinary snapshot after it brings the first events it can act on. That also keeps the room's single pending list correct: only `afterTick` drains it.

`PlaygroundRoom` gets the identical treatment even though nothing draws its events yet — it runs `runPipeline` verbatim (root `CLAUDE.md`), and a room handed a `matchEvents` sink it never empties would grow one array for the life of the session.

With `snapshotEvery = 2` (the constrained-upload fallback) the list holds two ticks of events before it is drained, which is why it is a room-level accumulator rather than a per-tick value: no event is lost to a skipped snapshot.

- [ ] **Step 10: Run the suites**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck
```

Expected: PASS. `Snapshot.events` now arrives non-empty in a live match; nothing draws it yet — Task 3 puts it on the frame.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/sim/ram-events.ts packages/shared/src/sim/ram-events.test.ts packages/shared/src/config/net-config.ts packages/shared/src/index.ts packages/server/src/net packages/server/src/sim/world-bridge.ts packages/server/src/rooms
git commit -m "feat(net): reliable game events in the snapshot; the ram recovered from the contact transition (N23a)"
```

**Probe note for the summary — say it loudly.** This task hands every live room a per-tick `CombatEvents` bag. `runCombat` is unchanged and the bag is observation-only (B1), so no probe's *measurement* should move — but `packages/server/playtest/weapons.ts` and `weapons2.ts` drive the same pipeline and now allocate through it, and `packages/server/balance/match.ts` supplies its own match-long bag through the same `PipelineCtx.events` field. **Verify by running both rather than assuming**: `cd packages/server && npx tsx playtest/weapons.ts` and `npm run balance -- --shape=duel --matches=20 --seed=7` must report what they reported before this commit. If either moves, a bag is being shared where it should not be.

---
### Task 2: `FirePrediction` — predicted fire state, maneuvers and ghost shots (N22)

**Files:**
- Create: `packages/client/src/match/fire-prediction.ts`, `packages/client/src/match/fire-prediction.test.ts`
- Modify: `packages/shared/src/sim/combat.ts` (export `maneuverSlotMask`), `packages/shared/src/index.ts` (export it and `aimAngleFor`), `packages/client/src/match/prediction.ts` (`applyLocalManeuver`, `lastRams`), `packages/client/src/match/render-offset.ts` (`countSnaps`), `packages/client/src/match/prediction.test.ts` (two appended describes)

**Interfaces:**
- Consumes: `tickRecharge`, `beginFire`, `releaseShots`, `newFireState`, `cancelPending`, `spawnInstances`, `stepInstance`, `instanceExpired`, `startManeuver`, `aimAngleFor`, `maneuverSlotMask`, `modifiersFromRows`, `weaponDefOf`, `weaponTicksOf`, `instanceId`, `newLockState`, `WeaponKind`, `ManeuverKind`, `NO_MANEUVER`, `TICK_RATE_HZ`; phase 3's `WorldPredictor`, `CarState`, `WorldState`; phase 2's `SnapshotCar`, `SnapshotInstance`.
- Produces:

```ts
// packages/client/src/match/fire-prediction.ts
export interface GhostInstance extends RenderInstance { ghost: true }
export interface GhostSpawn { id: string; weaponId: string; slot: number }
export interface PredictedManeuver {
  weaponId: string;
  maneuver: number; maneuverTicksLeft: number; maneuverAngle: number; maneuverSpeed: number;
}
export interface FireContext {
  arena: ArenaDef;
  ownerIndex: number;
  worldAt: (tick: number) => WorldState | undefined;
  sessionIdOf: (index: number) => string;
  startManeuver: (tick: number, maneuver: PredictedManeuver) => void;
  handover: (id: string, dx: number, dy: number, dAngle: number) => void;
}
export interface FireStats {
  presses: number; ghosts: number; confirmed: number; mismatched: number; orphans: number;
}
export class FirePrediction {
  constructor(cfg: Pick<typeof NET_CONFIG, "ghostGraceTicks">);
  attach(ctx: FireContext): void;                       // N4 addition, see below
  rebase(car: SnapshotCar, tick: number): void;
  press(localTick: number, fireSlots: number, prevFireSlots: number): GhostSpawn[];
  advance(localTick: number): void;                     // N4 addition, see below
  confirm(instances: readonly SnapshotInstance[], tick: number): void;
  expired(localTick: number, leadPlusRtt: number): string[];
  clear(): void;                                        // N4 addition, see below
  readonly ghosts: readonly GhostInstance[];
  readonly stats: FireStats;
}

// packages/client/src/match/prediction.ts, added to WorldPredictor
applyLocalManeuver(tick: number, maneuver: PredictedManeuver): void;
readonly lastRams: readonly RamContact[];
```

**Three additions beyond the ledger, and why each is not a reshape.** The ledger fixes `FirePrediction`'s constructor at `(cfg)`, which cannot reach an arena or a predicted world, so `attach(ctx)` supplies both once — every member the ledger lists keeps its exact declared signature. `advance` exists because a ghost has to be *stepped*: the ledger's five members cover spawning, matching and expiry but not the tick in between. `clear` is what `MatchClient.seed` calls when a match restarts. All three are recorded in `## Handoff`.

#### What is replicated, and what is not

`runCombat` is server-only and unchanged (N14). What the client runs is the **fire half** of it, on its own car only, in `runCombat`'s own documented order:

| `runCombat`'s phase | Replicated here? |
|---|---|
| modifiers derived once, up front | yes — `modifiersFromRows(car.statuses, tick)`, the same derivation, never a fork (`packages/client/CLAUDE.md`) |
| status pulses, status requests | **no** — hp is the server's |
| `tickRecharge` | yes, with `mods.weaponCooldown`, every tick |
| step existing instances | yes, for **ghosts only**; every authoritative instance comes off the wire and is stepped by phase 2's `SnapshotView` |
| `updateLock` | **no** — the lock is read off the snapshot (`SnapshotCar.lockTargetIndex`) and held between snapshots, which is exactly what N22 specifies |
| `beginFire` | yes, behind the same two gates: `mods.disarmed` and `maneuverSlotMask` |
| `releaseShots` | yes, with `mods.weaponCooldown` |
| `startManeuver` for a maneuver order | yes — the four maneuver fields are written into the predicted local car |
| `spawnInstances` for every other order | yes, as ghosts |
| hit resolution, damage, statuses on others | **no** — never predicted (N14, N22) |

The prediction is always **overridden** by the snapshot: `rebase` rebuilds the whole `FireState` from the snapshot's own fields on every applied snapshot, so a divergence lives at most one snapshot. That is the same rule as the world predictor's — the snapshot is the truth and the prediction is a guess that is thrown away, never merged.

#### Rebuilding a `FireState` from a `SnapshotCar`

Everything `beginFire`/`releaseShots` read is on the wire except `pending`, which is server-only. `pendingUntilTick` is the one field of it that crosses (phase 2's `group 8 fire`), and `lastFiredSlot` names the slot it belongs to:

| `FireState` field | From |
|---|---|
| `slots[i].weaponId`, `.stocks`, `.rechargeEndsTick`, `.refireLockUntilTick` | `SnapshotCar.slots[i]` verbatim |
| `switchLockUntilTick` | `SnapshotCar.switchLockUntilTick` |
| `lastFiredSlot` | `SnapshotCar.lastFiredSlot` |
| `level` | the lobby schema's `PlayerState.level`, which N24 keeps there; `1` when the seat is unknown |
| `pending` | `null` when `pendingUntilTick === 0`; otherwise `{ weaponId: slots[lastFiredSlot].weaponId, slot: lastFiredSlot, shotsLeft: 1, nextShotTick: pendingUntilTick, pressId: "" }` |

**`shotsLeft: 1` is exact for the shipped table and wrong only for machinery nobody uses.** Every row in `WEAPON_TABLE` authors `volley: { volleys: 1 }` — the multi-wave `VolleyDef` path is live, generically-tested and dormant (root `CLAUDE.md`). A future multi-volley row would make a rebased mid-burst press predict one shot instead of the remainder, which shows up as ghost mismatches on that weapon and nowhere else. The test below pins the single-volley assumption against the live table so the day a row breaks it, this line fails rather than the feel does.

`pressId` is `""` because it is sim-only and never networked; nothing the client does reads it.

- [ ] **Step 1: Export the two shared functions the client must not fork**

`packages/shared/src/sim/combat.ts`: add the `export` keyword to `maneuverSlotMask` (line 741 today) and leave its body untouched. `runCombat` itself is not edited.

`packages/shared/src/index.ts`: extend the existing `sim/combat.js` value export to

```ts
export { aimAngleFor, dashAngleFor, maneuverSlotMask, runCombat, startManeuver } from "./sim/combat.js";
```

Both already exist and are already used by `runCombat`; this is visibility only. The client needs them because `packages/client/CLAUDE.md` forbids forking a shared derivation — "the parts that decide who is solid and how a hull is sized are the *same* shared functions both call … change them there, never fork a client copy" — and an aim angle and a maneuver block mask are exactly that kind of part.

- [ ] **Step 2: Write the failing client test**

```ts
// packages/client/src/match/fire-prediction.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  CAR_TABLE, MS_PER_TICK, ManeuverKind, NET_CONFIG, WEAPON_TABLE, getArena, instanceId,
  quantizeBody, weaponDefOf, weaponTicksOf,
  type CarState, type SnapshotCar, type SnapshotInstance, type WorldState,
} from "@motor-combat-moba/shared";
import { FirePrediction, type FireContext, type PredictedManeuver } from "./fire-prediction.js";

const ARENA = getArena("arena-01");
const MIRAGE_SLOTS = CAR_TABLE.mirage.weapons;   // ["magmablast", "thunderclap", "afterburner"]

function car(sessionId: string, x: number, y = 360): CarState {
  return {
    index: sessionId === "me" ? 0 : 1,
    sessionId, carId: "mirage", team: 0, maneuverWeaponId: "",
    onField: true, phased: false, statuses: [],
    x, y, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0,
    authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
  };
}

function world(tick: number, meX = 300): WorldState {
  return {
    tick, mode: "ffa",
    cars: [car("me", meX), car("them", 800)],
    contact: { touching: new Set(), slammed: new Map() },
  };
}

function snapCar(over: Partial<SnapshotCar> = {}): SnapshotCar {
  return {
    index: 0,
    body: quantizeBody({ ...car("me", 300) }),
    hp: 700, alive: true, onField: true, phased: false, diedAtTick: 0,
    lastInput: { steer: 0, throttle: 0, fireSlots: 0 },
    lockTargetIndex: -1, shotSeq: 100, pendingUntilTick: 0, switchLockUntilTick: 0,
    lastFiredSlot: -1, maneuverWeaponId: "",
    slots: MIRAGE_SLOTS.map((weaponId) => ({
      weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    })),
    statuses: [],
    ...over,
  };
}

describe("FirePrediction", () => {
  let fire: FirePrediction;
  let maneuvers: { tick: number; maneuver: PredictedManeuver }[];
  let handovers: string[];
  let ctx: FireContext;

  beforeEach(() => {
    maneuvers = [];
    handovers = [];
    ctx = {
      arena: ARENA,
      ownerIndex: 0,
      worldAt: (tick) => world(tick),
      sessionIdOf: (index) => (index === 0 ? "me" : index === 1 ? "them" : ""),
      startManeuver: (tick, maneuver) => maneuvers.push({ tick, maneuver }),
      handover: (id) => handovers.push(id),
    };
    fire = new FirePrediction(NET_CONFIG);
    fire.attach(ctx);
    fire.rebase(snapCar(), 1000);
  });

  it("spawns a ghost per instance a press would produce, with the id the server will assign", () => {
    // Slot 0 is magmablast: one muzzle, one pellet, startUpMs 0 -> one instance on the press tick.
    const spawns = fire.press(1001, 0b001, 0b000);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.weaponId).toBe("magmablast");
    expect(spawns[0]!.slot).toBe(0);
    expect(spawns[0]!.id).toBe(instanceId(0, 100));
    expect(fire.ghosts.map((g) => g.id)).toEqual([instanceId(0, 100)]);
    expect(fire.ghosts[0]!.ghost).toBe(true);
    expect(fire.stats.presses).toBe(1);
    expect(fire.stats.ghosts).toBe(1);
  });

  it("spawns one ghost per muzzle and per pellet, numbered in spawn order", () => {
    // Slot 2 is afterburner: muzzles [0, 180], one pellet each -> two instances.
    const def = weaponDefOf("afterburner");
    const muzzles = def.muzzles?.length ?? 1;
    expect(muzzles).toBe(2);
    const spawns = fire.press(1001, 0b100, 0b000);
    expect(spawns).toHaveLength(muzzles);
    expect(fire.ghosts.map((g) => g.id)).toEqual([instanceId(0, 100), instanceId(0, 101)]);
  });

  it("holds the press edge: a held trigger fires once", () => {
    expect(fire.press(1001, 0b001, 0b000)).toHaveLength(1);
    expect(fire.press(1002, 0b001, 0b001)).toHaveLength(0);
    expect(fire.press(1003, 0b001, 0b001)).toHaveLength(0);
  });

  it("flips the slot state on the press tick — the whole point of predicting it", () => {
    fire.press(1001, 0b001, 0b000);
    const slot = fire.slotsAt(1001)[0]!;
    expect(slot.stocks).toBe(0);
    expect(slot.rechargeEndsTick).toBe(1001 + weaponTicksOf("magmablast").cooldown);
    expect(fire.lastFiredSlotAt(1001)).toBe(0);
  });

  it("starts a maneuver instead of spawning an instance, and spawns no ghost for it", () => {
    // Slot 1 is thunderclap, kind "maneuver".
    expect(weaponDefOf("thunderclap").kind).toBe("maneuver");
    expect(fire.press(1001, 0b010, 0b000)).toHaveLength(0);
    expect(maneuvers).toHaveLength(1);
    expect(maneuvers[0]!.tick).toBe(1001);
    expect(maneuvers[0]!.maneuver.weaponId).toBe("thunderclap");
    expect(maneuvers[0]!.maneuver.maneuver).toBe(ManeuverKind.DASH);
    expect(maneuvers[0]!.maneuver.maneuverSpeed).toBe(WEAPON_TABLE.thunderclap.speed);
    expect(maneuvers[0]!.maneuver.maneuverTicksLeft).toBeGreaterThan(0);
    expect(fire.ghosts).toHaveLength(0);
    expect(fire.stats.presses).toBe(1);
  });

  it("refuses its own press when the slot has no stock, exactly as the server would", () => {
    fire.press(1001, 0b001, 0b000);
    expect(fire.press(1010, 0b001, 0b000)).toHaveLength(0);
    expect(fire.stats.presses).toBe(1);
  });

  it("refuses a press while disarmed", () => {
    ctx.worldAt = (tick) => {
      const w = world(tick);
      return {
        ...w,
        cars: w.cars.map((c) =>
          c.sessionId === "me"
            ? { ...c, statuses: [{ statusId: "jammed", startTick: 990, endsTick: 1100, sourceSessionId: "them" }] }
            : c,
        ),
      };
    };
    fire.attach(ctx);
    expect(fire.press(1001, 0b001, 0b000)).toHaveLength(0);
  });

  it("hands a ghost over to its authoritative twin and stops drawing it", () => {
    fire.press(1001, 0b001, 0b000);
    const id = fire.ghosts[0]!.id;
    const real: SnapshotInstance = {
      ownerIndex: 0, shotSeq: 100, weaponId: "magmablast", kind: 0,
      x: fire.ghosts[0]!.x + 6, y: fire.ghosts[0]!.y, angle: 0,
      extent: 0, alive: true, isExplosion: false, homingTargetIndex: -1,
    };
    fire.confirm([real], 1004);
    expect(fire.ghosts).toHaveLength(0);
    expect(handovers).toEqual([id]);
    expect(fire.stats.confirmed).toBe(1);
    expect(fire.stats.mismatched).toBe(0);
  });

  it("expires an unconfirmed ghost after lead + rtt + ghostGraceTicks and counts it", () => {
    fire.press(1001, 0b001, 0b000);
    const leadPlusRtt = 8;
    expect(fire.expired(1001 + leadPlusRtt + NET_CONFIG.ghostGraceTicks - 1, leadPlusRtt)).toEqual([]);
    const gone = fire.expired(1001 + leadPlusRtt + NET_CONFIG.ghostGraceTicks, leadPlusRtt);
    expect(gone).toEqual([instanceId(0, 100)]);
    expect(fire.ghosts).toHaveLength(0);
    expect(fire.stats.mismatched).toBe(1);
  });

  it("renumbers a surviving ghost off the new snapshot's shotSeq", () => {
    fire.press(1001, 0b001, 0b000);
    expect(fire.ghosts[0]!.id).toBe(instanceId(0, 100));
    // The server refused an earlier press, so its own counter did not move as far as we assumed.
    fire.rebase(snapCar({ shotSeq: 97 }), 1002);
    expect(fire.ghosts[0]!.id).toBe(instanceId(0, 97));
  });

  it("counts an authoritative local instance no ghost claimed as an orphan", () => {
    fire.confirm(
      [{
        ownerIndex: 0, shotSeq: 100, weaponId: "magmablast", kind: 0,
        x: 300, y: 360, angle: 0, extent: 0, alive: true, isExplosion: false, homingTargetIndex: -1,
      }],
      1002,
    );
    expect(fire.stats.orphans).toBe(1);
  });

  it("steps a ghost forward and drops it at the end of its own flight", () => {
    fire.press(1001, 0b001, 0b000);
    const startX = fire.ghosts[0]!.x;
    fire.advance(1002);
    expect(fire.ghosts[0]!.x).toBeGreaterThan(startX);
    const flight = weaponTicksOf("magmablast").flight;
    for (let tick = 1003; tick <= 1001 + flight + 2; tick++) fire.advance(tick);
    expect(fire.ghosts).toHaveLength(0);
  });

  it("assumes one volley per press, which the shipped table satisfies", () => {
    for (const row of Object.values(WEAPON_TABLE)) {
      expect(row.volley.volleys, `${row.id} authors more than one volley`).toBe(1);
    }
  });
});
```

Run: `cd packages/client && npx vitest run src/match/fire-prediction.test.ts`
Expected: FAIL — module missing.

`slotsAt(tick)` and `lastFiredSlotAt(tick)` are the two read-outs `MatchClient` uses to override the frame's slot row; they are listed in `## Handoff`.

- [ ] **Step 3: Write `match/fire-prediction.ts`**

```ts
// packages/client/src/match/fire-prediction.ts
import {
  MS_PER_TICK,
  ManeuverKind,
  NET_CONFIG,
  TICK_RATE_HZ,
  WeaponKind,
  aimAngleFor,
  beginFire,
  instanceExpired,
  instanceId,
  isWeaponId,
  maneuverSlotMask,
  modifiersFromRows,
  newLockState,
  releaseShots,
  spawnInstances,
  startManeuver,
  stepInstance,
  tickRecharge,
  weaponDefOf,
  type ArenaDef,
  type CarState,
  type CombatPlayer,
  type FireState,
  type SlotState,
  type SnapshotCar,
  type SnapshotInstance,
  type WeaponInstance,
  type WorldState,
} from "@motor-combat-moba/shared";
import type { RenderInstance } from "./render-frame.js";

/**
 * The local car's fire state, its maneuvers and its shots, predicted (netcode spec N22).
 *
 * **What this is not.** It is not a second combat step. Damage, hp, death, kills, statuses landing
 * on other people and every other car's shots are the server's and are never guessed at (N14) — a
 * mispredicted bullet is a phantom kill and there is no reconciliation story for "you were dead for
 * 80 ms". What is predicted is the part a player feels in their hands: the stock leaving the slot,
 * the ring starting to sweep, the car-wide lockout, the dash beginning, and a projectile at the
 * muzzle on the tick the key went down instead of a round trip later.
 *
 * **Every rule comes from shared.** `tickRecharge`, `beginFire`, `releaseShots`, `startManeuver`,
 * `aimAngleFor`, `maneuverSlotMask`, `spawnInstances` and `stepInstance` are the same functions
 * `runCombat` calls, in the order `weapons/fire.ts`'s module comment pins. Nothing is re-derived
 * here; `packages/client/CLAUDE.md` forbids forking a shared derivation and this is the file that
 * would be most tempted to.
 *
 * **The snapshot always wins.** `rebase` rebuilds the whole `FireState` from the car's own snapshot
 * fields on every applied snapshot, so a divergence lives one snapshot and no longer. Ghosts are
 * matched to their authoritative twins by `instanceId(ownerIndex, shotSeq)` and, failing that,
 * expire on a clock.
 */
export interface GhostInstance extends RenderInstance {
  ghost: true;
}

/** What one press produced, for the caller's counters and for a muzzle effect. */
export interface GhostSpawn {
  id: string;
  weaponId: string;
  slot: number;
}

/** The four maneuver fields plus the weapon that started them, for the predicted local car. */
export interface PredictedManeuver {
  weaponId: string;
  maneuver: number;
  maneuverTicksLeft: number;
  maneuverAngle: number;
  maneuverSpeed: number;
}

/**
 * Everything this class needs that its ledger-fixed constructor cannot take. Attached once by
 * `MatchClient`, re-attached when the driven seat changes (the playground can hand the driver a
 * different car mid-session).
 */
export interface FireContext {
  arena: ArenaDef;
  /** The driven car's index on the wire — half of every ghost id. */
  ownerIndex: number;
  /** `WorldPredictor.worldAt`: the predicted world, which is where the ghost's muzzle is. */
  worldAt: (tick: number) => WorldState | undefined;
  /** `Roster.sessionIdOf`, for the snapshot's lock target index. */
  sessionIdOf: (index: number) => string;
  /** `WorldPredictor.applyLocalManeuver` — a dash starts in the predicted world, not here. */
  startManeuver: (tick: number, maneuver: PredictedManeuver) => void;
  /** A confirmed ghost's position error, for a render offset on the real instance. */
  handover: (id: string, dx: number, dy: number, dAngle: number) => void;
}

export interface FireStats {
  /** Presses this client committed — the denominator of spec §7's ghost-mismatch line. */
  presses: number;
  ghosts: number;
  confirmed: number;
  /** Presses whose ghosts all expired unconfirmed. */
  mismatched: number;
  /** Authoritative local instances no ghost claimed. */
  orphans: number;
}

interface Ghost {
  instance: WeaponInstance;
  /** `instanceId(ownerIndex, shotSeq)` — recomputed on every rebase. */
  id: string;
  /** Which committed press this belongs to, so one press counts once however many ghosts it made. */
  pressOrdinal: number;
  spawnTick: number;
}

const NO_CONTEXT: FireContext = {
  arena: { id: "", width: 0, height: 0, obstacles: [], spawns: [] } as unknown as ArenaDef,
  ownerIndex: -1,
  worldAt: () => undefined,
  sessionIdOf: () => "",
  startManeuver: () => {},
  handover: () => {},
};

const SEQ_WRAP = 65536;

/**
 * A `CombatPlayer` carrying only the fields `aimAngleFor`, `dashAngleFor` and `startManeuver`
 * actually read. Built rather than cast so a future read of a field this does not set is a compile
 * error here rather than an `undefined` in the sim's own code.
 */
function combatViewOf(car: CarState, fireState: FireState, lockTargetSessionId: string): CombatPlayer {
  return {
    sessionId: car.sessionId,
    x: car.x,
    y: car.y,
    angle: car.angle,
    team: car.team === 1 ? 1 : 0,
    carId: car.carId,
    // `isFighting` is `inRoster && alive`, and the caller has already checked both off the
    // snapshot; these two make a target eligible in `byId`.
    hp: 1,
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState,
    lock: { ...newLockState(), targetSessionId: lockTargetSessionId },
    statuses: [],
    maneuver: car.maneuver,
    maneuverTicksLeft: car.maneuverTicksLeft,
    maneuverAngle: car.maneuverAngle,
    maneuverSpeed: car.maneuverSpeed,
    maneuverWeaponId: isWeaponId(car.maneuverWeaponId) ? car.maneuverWeaponId : "",
    maneuverPressId: "",
    lastDamagerSessionId: "",
  };
}

export class FirePrediction {
  private ctx = NO_CONTEXT;
  private localSid = "";
  private lockTargetSessionId = "";
  private fire: FireState = { slots: [], switchLockUntilTick: 0, lastFiredSlot: -1, pending: null, level: 1 };
  private level = 1;
  private baseSeq = 0;
  private nextPressOrdinal = 0;
  private readonly live: Ghost[] = [];
  /** Ids the snapshot has already shown us, so an instance is only ever an orphan once. */
  private readonly seenAuthoritative = new Set<string>();
  private readonly counters: FireStats = { presses: 0, ghosts: 0, confirmed: 0, mismatched: 0, orphans: 0 };

  constructor(private readonly cfg: Pick<typeof NET_CONFIG, "ghostGraceTicks">) {}

  attach(ctx: FireContext): void {
    this.ctx = ctx;
  }

  /** The lobby half of the seat: `PlayerState.level`, which N24 keeps on the schema. */
  setLevel(level: number): void {
    this.level = level;
  }

  clear(): void {
    this.live.length = 0;
    this.seenAuthoritative.clear();
    this.fire = { slots: [], switchLockUntilTick: 0, lastFiredSlot: -1, pending: null, level: this.level };
    this.baseSeq = 0;
    this.nextPressOrdinal = 0;
  }

  /**
   * Adopt the server's answer. Called for every applied snapshot, before `confirm`.
   *
   * The renumbering is what makes a refused press harmless: the client counts its own spawns
   * forward from `car.shotSeq`, so a press the server dropped would otherwise leave every later
   * ghost claiming an id one too high, and every one of them would mismatch. Re-keying the live
   * ghosts off the newest count, in spawn order, resets that on the next snapshot.
   */
  rebase(car: SnapshotCar, tick: number): void {
    this.localSid = this.ctx.sessionIdOf(car.index);
    this.lockTargetSessionId =
      car.lockTargetIndex < 0 ? "" : this.ctx.sessionIdOf(car.lockTargetIndex);

    const slots: SlotState[] = car.slots.map((slot) => ({
      weaponId: slot.weaponId as SlotState["weaponId"],
      stocks: slot.stocks,
      rechargeEndsTick: slot.rechargeEndsTick,
      refireLockUntilTick: slot.refireLockUntilTick,
    }));
    const pendingSlot = car.lastFiredSlot;
    const pendingWeapon = pendingSlot >= 0 ? slots[pendingSlot]?.weaponId : undefined;
    this.fire = {
      slots,
      switchLockUntilTick: car.switchLockUntilTick,
      lastFiredSlot: car.lastFiredSlot,
      // `shotsLeft: 1` is exact for every row in the shipped table (all author `volleys: 1`); the
      // dormant multi-volley path would under-predict the remainder of a burst rebased mid-flight.
      // `fire-prediction.test.ts` pins the assumption against `WEAPON_TABLE`.
      pending:
        car.pendingUntilTick > 0 && pendingWeapon !== undefined
          ? {
              weaponId: pendingWeapon,
              slot: pendingSlot,
              shotsLeft: 1,
              nextShotTick: car.pendingUntilTick,
              pressId: "",
            }
          : null,
      level: this.level,
    };

    this.baseSeq = car.shotSeq;
    this.renumber();
    void tick;
  }

  /**
   * One tick of the local fire path. Called every local tick, whether or not anything was pressed:
   * `tickRecharge` has to run each tick and a wind-up releases on a tick with no press at all.
   *
   * `fireSlots & ~prevFireSlots` is the press edge, the same rule the server's input ring applies
   * (N7), so a held trigger fires once and silence never fires.
   */
  press(localTick: number, fireSlots: number, prevFireSlots: number): GhostSpawn[] {
    const world = this.ctx.worldAt(localTick);
    const car = world?.cars.find((c) => c.sessionId === this.localSid);
    if (!world || !car || !car.onField) return [];

    const mods = modifiersFromRows(car.statuses, localTick);
    this.fire = tickRecharge(this.fire, localTick, mods.weaponCooldown);

    const edge = fireSlots & ~prevFireSlots;
    const blocked = car.maneuver !== ManeuverKind.NONE ? maneuverSlotMask(this.fire) : 0;
    const before = this.fire.pending;
    if (!mods.disarmed && edge > 0) {
      this.fire = beginFire(this.localSid, this.fire, edge & ~blocked, localTick);
    }
    if (this.fire.pending !== null && before === null) {
      this.counters.presses += 1;
      this.nextPressOrdinal += 1;
    }

    const released = releaseShots(this.fire, localTick, mods.weaponCooldown);
    this.fire = released.state;
    if (released.orders.length === 0) return [];

    const byId = new Map<string, CombatPlayer>();
    for (const other of world.cars) {
      if (!other.onField || other.phased) continue;
      byId.set(other.sessionId, combatViewOf(other, this.fire, ""));
    }
    const owner = combatViewOf(car, this.fire, this.lockTargetSessionId);
    const spawns: GhostSpawn[] = [];

    for (const order of released.orders) {
      const def = weaponDefOf(order.weaponId);
      if (def.kind === "maneuver") {
        // A maneuver moves the car instead of spawning anything. `startManeuver` writes the four
        // fields onto its argument; the predicted world is where they have to land, so they are
        // handed straight back out.
        startManeuver(owner, def, byId, order.pressId);
        this.ctx.startManeuver(localTick, {
          weaponId: def.id,
          maneuver: owner.maneuver,
          maneuverTicksLeft: owner.maneuverTicksLeft,
          maneuverAngle: owner.maneuverAngle,
          maneuverSpeed: owner.maneuverSpeed,
        });
        continue;
      }

      // The lock is the snapshot's, held between snapshots and evaluated against the EXTRAPOLATED
      // target pose — which is what N22 asks for and what makes the ghost point where the shot
      // will actually go. `isPhased` reads the predicted world's own flag.
      const aim = aimAngleFor(owner, order.weaponId, byId, (sessionId) => {
        const target = world.cars.find((c) => c.sessionId === sessionId);
        return target?.phased ?? true;
      });
      const homingTargetId =
        def.kind === "projectile" && def.homing?.acquire === "lock" && aim !== null
          ? this.lockTargetSessionId
          : "";
      const spawned = spawnInstances(
        order,
        { sessionId: car.sessionId, team: car.team === 1 ? 1 : 0, carId: car.carId, x: car.x, y: car.y, angle: car.angle },
        localTick,
        0,
        aim,
        mods.damageDealt,
        homingTargetId,
      );
      for (const instance of spawned.instances) {
        const ghost: Ghost = {
          instance,
          id: "",
          pressOrdinal: this.nextPressOrdinal,
          spawnTick: localTick,
        };
        this.live.push(ghost);
        this.counters.ghosts += 1;
        spawns.push({ id: "", weaponId: order.weaponId, slot: order.slot });
      }
    }

    // Numbering is done once, after the whole press, so the ids follow spawn order exactly as the
    // server's `ShotSeqTable` assigns them (muzzle-major, pellet-minor).
    this.renumber();
    for (let i = 0; i < spawns.length; i++) {
      spawns[i]!.id = this.live[this.live.length - spawns.length + i]!.id;
    }
    return spawns;
  }

  /** One tick of ghost flight, through the same `stepInstance` the server runs. */
  advance(localTick: number): void {
    if (this.live.length === 0) return;
    const world = this.ctx.worldAt(localTick);
    const owner = world?.cars.find((c) => c.sessionId === this.localSid);
    const bounds = { width: this.ctx.arena.width, height: this.ctx.arena.height };

    for (let i = this.live.length - 1; i >= 0; i--) {
      const ghost = this.live[i]!;
      const homingId = ghost.instance.homingTargetId;
      const target = homingId === "" ? null : world?.cars.find((c) => c.sessionId === homingId);
      ghost.instance = stepInstance(ghost.instance, {
        dt: 1 / TICK_RATE_HZ,
        tick: localTick,
        obstacles: this.ctx.arena.obstacles,
        bounds,
        ownerPose: owner ? { x: owner.x, y: owner.y, angle: owner.angle } : null,
        homingTarget: target ? { x: target.x, y: target.y } : null,
      });
      // A ghost that reached its own range or linger is not a mismatch: it lived its whole life
      // without the server contradicting it, which is a correct prediction of a shot that missed.
      if (!ghost.instance.alive || instanceExpired(ghost.instance, localTick)) this.live.splice(i, 1);
    }
  }

  /**
   * Match the authoritative instances against the live ghosts. A ghost with a twin hands over — the
   * real instance draws from now on, with a render offset covering the difference — and a local
   * instance with no ghost is an orphan, which is the other half of the mismatch metric.
   */
  confirm(instances: readonly SnapshotInstance[], tick: number): void {
    void tick;
    for (const instance of instances) {
      if (instance.ownerIndex !== this.ctx.ownerIndex) continue;
      const id = instanceId(instance.ownerIndex, instance.shotSeq);
      if (this.seenAuthoritative.has(id)) continue;
      this.seenAuthoritative.add(id);
      const index = this.live.findIndex((ghost) => ghost.id === id);
      if (index < 0) {
        this.counters.orphans += 1;
        continue;
      }
      const ghost = this.live[index]!;
      this.ctx.handover(
        id,
        ghost.instance.x - instance.x,
        ghost.instance.y - instance.y,
        ghost.instance.angle - instance.angle,
      );
      this.live.splice(index, 1);
      this.counters.confirmed += 1;
    }
    // The set is only a "seen once" guard; a match is over long before 4096 shots are in flight,
    // and an id that wraps at 65536 has been dead for minutes.
    if (this.seenAuthoritative.size > 4096) this.seenAuthoritative.clear();
  }

  /**
   * Drop ghosts the server never confirmed. `leadPlusRtt` is the round trip a confirmation actually
   * takes; `ghostGraceTicks` is the slop (§6.12's last row: "a shot that vanishes at the muzzle").
   */
  expired(localTick: number, leadPlusRtt: number): string[] {
    const limit = leadPlusRtt + this.cfg.ghostGraceTicks;
    const gone: string[] = [];
    const pressesLost = new Set<number>();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const ghost = this.live[i]!;
      if (localTick - ghost.spawnTick < limit) continue;
      gone.push(ghost.id);
      pressesLost.add(ghost.pressOrdinal);
      this.live.splice(i, 1);
    }
    this.counters.mismatched += pressesLost.size;
    return gone;
  }

  get ghosts(): readonly GhostInstance[] {
    return this.live.map((ghost) => ({
      id: ghost.id,
      ownerSessionId: ghost.instance.ownerSessionId,
      weaponId: ghost.instance.weaponId,
      kind: ghost.instance.kind === "beam" ? WeaponKind.BEAM : WeaponKind.PROJECTILE,
      x: ghost.instance.x,
      y: ghost.instance.y,
      angle: ghost.instance.angle,
      extent: ghost.instance.extent,
      spawnTick: ghost.instance.spawnTick,
      alive: ghost.instance.alive,
      isExplosion: false,
      ghost: true,
    }));
  }

  get stats(): FireStats {
    return this.counters;
  }

  /** The predicted slot rows for the frame's HUD override (N25). */
  slotsAt(tick: number): readonly SlotState[] {
    void tick;
    return this.fire.slots;
  }

  lastFiredSlotAt(tick: number): number {
    void tick;
    return this.fire.lastFiredSlot;
  }

  pendingUntilTick(): number {
    return this.fire.pending?.nextShotTick ?? 0;
  }

  switchLockUntilTick(): number {
    return this.fire.switchLockUntilTick;
  }

  private renumber(): void {
    for (let i = 0; i < this.live.length; i++) {
      this.live[i]!.id = instanceId(this.ctx.ownerIndex, (this.baseSeq + i) % SEQ_WRAP);
    }
  }
}
```

`MS_PER_TICK` and `NET_CONFIG` are imported for the doc comments' arithmetic and the config type; drop either from the import list if the compiler reports it unused.

Run: `cd packages/client && npx vitest run src/match/fire-prediction.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 4: `WorldPredictor.applyLocalManeuver` and `lastRams`**

`packages/client/src/match/prediction.ts`, additive to phase 3's class:

```ts
  /** The maneuvers this client started, by tick, replayed by `resim` exactly as they first landed. */
  private readonly maneuvers = new Map<number, PredictedManeuver>();
  private rams: RamContact[] = [];

  /**
   * Write a predicted maneuver onto the local car in the world already stepped for `tick`.
   *
   * The timing mirrors the server exactly. `runCombat` runs AFTER the tick's driving, so a maneuver
   * pressed on tick T is written at the end of T and first moves the car on T+1 — which is why this
   * is called after `predictTick(T)` and not before it. Recording it by tick is what makes it
   * survive a resim: the replay re-applies it on the same tick, so a correction arriving three
   * ticks into a dash does not cancel the dash.
   *
   * A maneuver the server says never happened needs no un-doing: the resim starts from the
   * snapshot's baseline, and a press at a tick at or before that baseline is never replayed.
   */
  applyLocalManeuver(tick: number, maneuver: PredictedManeuver): void {
    this.maneuvers.set(tick, maneuver);
    this.pruneManeuvers();
    const world = this.worldAt(tick);
    if (world) this.writeManeuver(world, maneuver);
  }

  get lastRams(): readonly RamContact[] {
    return this.rams;
  }
```

with three private helpers and one call inside the existing per-tick step:

```ts
  /** Applied to the local car only; a remote's maneuver is on the wire and needs no guess. */
  private writeManeuver(world: WorldState, maneuver: PredictedManeuver): void {
    const car = world.cars.find((c) => c.sessionId === this.localSessionId);
    if (!car) return;
    car.maneuver = maneuver.maneuver;
    car.maneuverTicksLeft = maneuver.maneuverTicksLeft;
    car.maneuverAngle = maneuver.maneuverAngle;
    car.maneuverSpeed = maneuver.maneuverSpeed;
    car.maneuverWeaponId = maneuver.weaponId;
  }

  /** The ring is bounded by the resim window, exactly like `LocalInputs` (§6.13: memory is flat). */
  private pruneManeuvers(): void {
    const floor = this.baselineTick - this.cfg.maxPredictionTicks;
    for (const tick of this.maneuvers.keys()) if (tick < floor) this.maneuvers.delete(tick);
  }
```

and, at the end of phase 3's `stepOne(tick, …)` — after the `stepWorld` call and after the contact events are recorded:

```ts
    const maneuver = this.maneuvers.get(tick);
    if (maneuver) this.writeManeuver(next, maneuver);
    // The predicted ram, from the same derivation the server runs (N23a). `lastContacts` already
    // holds the slams and dash hits `stepWorld` emits; this is the kind it cannot.
    const claimed = new Set<string>();
    for (const contact of stepped.contactEvents) claimed.add(pairKey(contact.attacker, contact.victim));
    this.rams = ramContactsFrom(world, next, stepped.approachSpeeds, claimed);
```

`setBaseline` and `adopt` both call `pruneManeuvers()`; `resim` needs no change at all, because it replays through `stepOne`.

Appended to `packages/client/src/match/prediction.test.ts`:

```ts
describe("WorldPredictor maneuvers", () => {
  it("keeps a predicted dash through a resim from a later baseline", () => {
    const predictor = new WorldPredictor(ARENA, NET_CONFIG);
    predictor.setLocal("me");
    predictor.setBaseline(worldAt(1000), echo());
    predictor.predictTick(1001, FORWARD);
    predictor.applyLocalManeuver(1001, {
      weaponId: "thunderclap", maneuver: ManeuverKind.DASH,
      maneuverTicksLeft: 8, maneuverAngle: 0, maneuverSpeed: 1600,
    });
    predictor.predictTick(1002, FORWARD);
    const dashed = predictor.worldAt(1002)!.cars.find((c) => c.sessionId === "me")!;
    expect(dashed.maneuver).toBe(ManeuverKind.DASH);

    // A snapshot for tick 1000 that disagrees about something else forces a full replay.
    predictor.setBaseline(nudged(worldAt(1000)), echo());
    predictor.resim(1002, () => FORWARD);
    const replayed = predictor.worldAt(1002)!.cars.find((c) => c.sessionId === "me")!;
    expect(replayed.maneuver).toBe(ManeuverKind.DASH);
  });

  it("reports the ram it predicted for the newest tick", () => {
    const predictor = new WorldPredictor(ARENA, NET_CONFIG);
    predictor.setLocal("me");
    predictor.setBaseline(aboutToCollide(), echo());
    predictor.predictTick(1001, FORWARD);
    expect(predictor.lastRams).toHaveLength(1);
    expect(predictor.lastRams[0]!.attacker).toBe("me");
  });
});
```

`worldAt`, `echo`, `nudged` and `aboutToCollide` are the fixtures phase 3's test file already defines; `aboutToCollide` is one added beside them, a two-car baseline a tick short of contact, built the same way `ram-events.test.ts`'s `closing(2, 300)` is.

- [ ] **Step 5: `RenderOffsets` stops counting instance handovers as car snaps**

`packages/client/src/match/render-offset.ts`. Phase 3's class counts a correction past `NET_CONFIG.snapUnits` into `NetStats.snaps`, which is the phase-3 acceptance metric ("zero snaps"). A ghost handing over to its authoritative twin uses the same machinery on an instance id, and an instance is not a car — counting it would pollute the number the previous phase is graded on.

| Change | Detail |
|---|---|
| the constructor | a third, optional argument: `opts?: { countSnaps?: boolean }`, defaulting to `true`, so every existing call site compiles and behaves identically |
| `add` | the `stats.recordCorrection(...)` call is guarded by the flag |

and in `render-offset.test.ts`:

```ts
  it("does not count a snap when told not to", () => {
    const stats = new NetStats();
    const offsets = new RenderOffsets(NET_CONFIG, stats, { countSnaps: false });
    offsets.add("0-7", NET_CONFIG.snapUnits + 10, 0, 0);
    expect(stats.snaps).toBe(0);
    expect(stats.corrections).toBe(0);
    expect(offsets.offsetOf("0-7").dx).toBe(0);   // still applied as a cut, not a slide
  });
```

- [ ] **Step 6: Run the suites**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck
```

Expected: PASS. Nothing is wired to `MatchClient` yet — Task 3 does that.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sim/combat.ts packages/shared/src/index.ts packages/client/src/match/fire-prediction.ts packages/client/src/match/fire-prediction.test.ts packages/client/src/match/prediction.ts packages/client/src/match/prediction.test.ts packages/client/src/match/render-offset.ts packages/client/src/match/render-offset.test.ts
git commit -m "feat(client): FirePrediction — predicted fire state, maneuvers and ghost shots (N22)"
```

**Probe note.** `sim/combat.ts` gains one `export` keyword and no other change; `runCombat`'s behaviour is bit-identical, so `playtest/weapons.ts`, `weapons2.ts` and the balance harness are expected unchanged. Verify rather than assume, with the commands in Task 1's note.

---
### Task 3: `MatchClient` wires prediction and events into the frame (N22, N23a)

**Files:**
- Create: `packages/client/src/match/event-feed.ts`, `packages/client/src/match/event-feed.test.ts`
- Modify: `packages/client/src/match/match-client.ts`, `packages/client/src/match/match-client.test.ts`, `packages/client/src/match/render-frame.ts`, `packages/client/src/match/frame-builder.ts`, `packages/client/src/match/frame-builder.test.ts`, `packages/client/src/match/netgraph.ts`, `packages/client/src/match/netgraph.test.ts`, `packages/client/src/scenes/arena/netgraph-overlay.ts`

**Interfaces:**
- Consumes: Task 2's `FirePrediction`; phase 3's `MatchClient`, `WorldPredictor`, `RenderOffsets`, `LocalInputs`; phase 2's `Snapshot`, `MatchEvent`, `Roster`, `SnapshotView`, `buildRenderFrame`.
- Produces:

```ts
// packages/client/src/match/event-feed.ts
export function eventKey(event: MatchEvent): string;
export class EventFeed {
  constructor(opts?: { keepTicks?: number });
  pushPredicted(events: readonly MatchEvent[]): void;
  pushAuthoritative(events: readonly MatchEvent[]): void;
  /** Everything not yet handed to a frame. Empties the queue. */
  drain(): MatchEvent[];
  clear(): void;
}

// packages/client/src/match/render-frame.ts, additive
export interface ManeuverReveal {
  weaponId: string; fromX: number; fromY: number; fromAngle: number; tick: number;
}
// RenderCar gains: hpDisplay, hpFlashUntilTick, revealedManeuver
// RenderInstance gains: ghost?: boolean

// packages/client/src/match/frame-builder.ts, additive to FrameInputs
export interface PredictedFire {
  weapons: readonly RenderSlot[];
  lastFiredSlot: number;
  pendingUntilTick: number;
  switchLockUntilTick: number;
}
```

#### N23a's idempotency rule, applied

An event is identified by `(tick, kind, cars)`. That is what makes a resend after reconnect harmless — and it is also what lets the client show a ram spark on the tick of the hit and then *recognise* the server's authoritative version of the same ram when it arrives a round trip later, instead of sparking twice.

`EventFeed` is the whole of that rule:

- a **predicted** event goes onto the queue and its key is remembered;
- an **authoritative** event whose key is already remembered is dropped;
- a predicted event whose authoritative twin never arrives costs nothing — it was already drawn.

Only two kinds are ever predicted, because only two come out of `stepWorld`, which the client runs: `ram` (through `WorldPredictor.lastRams`) and `slam` (through `MatchClient.predictedContacts`). `hit`, `kill`, `respawn` and `refused` are combat's and arrive only from the server, which is exactly N14: nothing about damage is guessed at.

The remembered keys are pruned by tick, `keepTicks` (64, about a second at 60 Hz) behind the newest, which comfortably outlives the `lead + RTT` a confirmation takes at the design point and keeps the set flat for a whole match (§6.13).

- [ ] **Step 1: Write the failing `EventFeed` test**

```ts
// packages/client/src/match/event-feed.test.ts
import { describe, expect, it } from "vitest";
import type { MatchEvent } from "@motor-combat-moba/shared";
import { EventFeed, eventKey } from "./event-feed.js";

const ram = (tick: number, attacker = "aaa", victim = "bbb"): MatchEvent =>
  ({ kind: "ram", tick, attacker, victim, x: 1, y: 2, severity: 0.4 });
const hit = (tick: number): MatchEvent =>
  ({ kind: "hit", tick, attacker: "aaa", victim: "bbb", weaponId: "predator", x: 0, y: 0, damage: 10 });

describe("eventKey", () => {
  it("ignores the payload and keys on tick, kind and cars", () => {
    expect(eventKey(ram(10))).toBe(eventKey({ ...ram(10), x: 999, y: 999, severity: 0.9 }));
    expect(eventKey(ram(10))).not.toBe(eventKey(ram(11)));
    expect(eventKey(ram(10))).not.toBe(eventKey(ram(10, "bbb", "aaa")));
    expect(eventKey(ram(10))).not.toBe(eventKey(hit(10)));
  });
});

describe("EventFeed", () => {
  it("hands each event out exactly once", () => {
    const feed = new EventFeed();
    feed.pushAuthoritative([hit(10), hit(11)]);
    expect(feed.drain()).toHaveLength(2);
    expect(feed.drain()).toHaveLength(0);
  });

  it("drops an authoritative event the client already predicted", () => {
    const feed = new EventFeed();
    feed.pushPredicted([ram(10)]);
    expect(feed.drain()).toEqual([ram(10)]);
    feed.pushAuthoritative([{ ...ram(10), x: 50, y: 60, severity: 0.8 }]);
    expect(feed.drain()).toEqual([]);
  });

  it("keeps an authoritative event for a ram the client did not predict", () => {
    const feed = new EventFeed();
    feed.pushPredicted([ram(10)]);
    feed.drain();
    feed.pushAuthoritative([ram(12)]);
    expect(feed.drain()).toEqual([ram(12)]);
  });

  it("forgets keys older than keepTicks, so the set stays flat over a match", () => {
    const feed = new EventFeed({ keepTicks: 4 });
    feed.pushPredicted([ram(10)]);
    feed.drain();
    feed.pushAuthoritative([ram(20)]);
    feed.drain();
    // 10 is now far behind the newest tick and has been forgotten: an identical key is new again.
    feed.pushAuthoritative([ram(10)]);
    expect(feed.drain()).toEqual([ram(10)]);
  });

  it("clears on a reseed", () => {
    const feed = new EventFeed();
    feed.pushAuthoritative([hit(10)]);
    feed.clear();
    expect(feed.drain()).toEqual([]);
  });
});
```

- [ ] **Step 2: Write `match/event-feed.ts`**

```ts
// packages/client/src/match/event-feed.ts
import type { MatchEvent } from "@motor-combat-moba/shared";

/**
 * The one place a predicted event and its authoritative twin are recognised as the same thing
 * (netcode spec N23a: "events are idempotent per `(tick, kind, cars)`").
 *
 * The payload is deliberately NOT part of the key. A predicted ram computes its severity from
 * approach speeds the client also predicted, so the two copies differ in the third decimal and
 * agree about everything that identifies the event. Keying on the payload would spark twice on
 * every contact, which is the exact failure this rule exists to prevent.
 */
export function eventKey(event: MatchEvent): string {
  switch (event.kind) {
    case "hit":
      return `hit:${event.tick}:${event.attacker}:${event.victim}:${event.weaponId}`;
    case "kill":
      return `kill:${event.tick}:${event.killer}:${event.victim}`;
    case "ram":
      return `ram:${event.tick}:${event.attacker}:${event.victim}`;
    case "slam":
      return `slam:${event.tick}:${event.car}`;
    case "respawn":
      return `respawn:${event.tick}:${event.car}`;
    case "refused":
      return `refused:${event.tick}:${event.car}:${event.slot}`;
  }
}

/** About a second at 60 Hz — comfortably past the `lead + RTT` a confirmation takes. */
const DEFAULT_KEEP_TICKS = 64;

/**
 * Events on their way to a `RenderFrame`, merged from two sources.
 *
 * The client predicts contact (N21) and therefore predicts the two contact events; combat is the
 * server's (N14) and everything else arrives only from it. Both go through here, are deduplicated
 * by `eventKey`, and are handed to exactly one frame.
 *
 * Memory is flat over a match: the queue empties every frame and the key set is pruned by tick.
 */
export class EventFeed {
  private readonly queue: MatchEvent[] = [];
  private readonly seen = new Map<string, number>();
  private newestTick = 0;
  private readonly keepTicks: number;

  constructor(opts?: { keepTicks?: number }) {
    this.keepTicks = opts?.keepTicks ?? DEFAULT_KEEP_TICKS;
  }

  pushPredicted(events: readonly MatchEvent[]): void {
    this.push(events);
  }

  pushAuthoritative(events: readonly MatchEvent[]): void {
    this.push(events);
  }

  drain(): MatchEvent[] {
    if (this.queue.length === 0) return [];
    const out = this.queue.slice();
    this.queue.length = 0;
    return out;
  }

  clear(): void {
    this.queue.length = 0;
    this.seen.clear();
    this.newestTick = 0;
  }

  private push(events: readonly MatchEvent[]): void {
    for (const event of events) {
      const key = eventKey(event);
      if (this.seen.has(key)) continue;
      this.seen.set(key, event.tick);
      this.queue.push(event);
      if (event.tick > this.newestTick) this.newestTick = event.tick;
    }
    this.prune();
  }

  private prune(): void {
    const floor = this.newestTick - this.keepTicks;
    if (floor <= 0) return;
    for (const [key, tick] of this.seen) if (tick < floor) this.seen.delete(key);
  }
}
```

Run: `cd packages/client && npx vitest run src/match/event-feed.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 3: The frame's new fields**

`packages/client/src/match/render-frame.ts`:

```ts
/**
 * A maneuver a snapshot revealed later than the extrapolation window (netcode spec N31 rule 4,
 * rendering spec R18a). The car is placed at its corrected position at once — a correction this
 * large is a cut, not a slide — and the renderer plays the maneuver's own trail from `from*` to the
 * car's current pose over a few frames, so the player reads "that car dashed" a little late rather
 * than "that car teleported".
 *
 * Present on exactly one frame, the one built after the revealing snapshot was applied.
 */
export interface ManeuverReveal {
  weaponId: string;
  fromX: number;
  fromY: number;
  fromAngle: number;
  tick: number;
}
```

added to `RenderCar`:

```ts
  /**
   * The hp number the player reads. Authoritative and un-eased: a bar that lies about how much
   * health you have is worse than a bar that moves (N25).
   */
  hp: number;
  /** The same value eased over `HUD_FEEL.hpEaseMs`, for the BAR only. Never for a number. */
  hpDisplay: number;
  /** Tick the damage flash ends; `0` for none. Set by a `hit` event naming this car. */
  hpFlashUntilTick: number;
  /** Set for one frame when this car's maneuver was revealed late (R18a). */
  revealedManeuver: ManeuverReveal | null;
```

added to `RenderInstance`:

```ts
  /** A predicted local shot with no authoritative twin yet (N22). Absent means authoritative. */
  ghost?: boolean;
```

and `emptyRenderFrame`'s car list stays empty, so only the three `RenderCar` fields need a default anywhere they are constructed by hand in tests.

`packages/client/src/match/frame-builder.ts` — five optional hooks on `FrameInputs`, every one absent-safe so the preparation plan's and phase 2's tests keep passing unchanged:

```ts
/** The predicted local fire state that overrides the snapshot's rows for the driven car (N22). */
export interface PredictedFire {
  weapons: readonly RenderSlot[];
  lastFiredSlot: number;
  pendingUntilTick: number;
  switchLockUntilTick: number;
}

export interface FrameInputs {
  // …the preparation plan's five fields, unchanged…
  /** N4: the predicted fire state for the driven car, or `undefined` for every other car. */
  fireOf?: (sessionId: string) => PredictedFire | undefined;
  /** N4: the eased hp and the flash clock. Absent means "no easing", which is what a test wants. */
  hpOf?: (sessionId: string, hp: number) => { display: number; flashUntilTick: number };
  /** N4: a maneuver revealed late (R18a). Consumed by the call: it is present for one frame. */
  revealOf?: (sessionId: string) => ManeuverReveal | undefined;
  /** N4: predicted local shots, appended after the authoritative instances. */
  ghosts?: readonly RenderInstance[];
  /** N4: the events since the previous frame (N23a). */
  events?: readonly MatchEvent[];
}
```

and inside `buildRenderFrame`, in the per-car block:

```ts
    const fire = inputs.fireOf?.(sessionId);
    const eased = inputs.hpOf?.(sessionId, player.hp);
    cars.push({
      // …every existing field…
      hp: player.hp,
      hpDisplay: eased?.display ?? player.hp,
      hpFlashUntilTick: eased?.flashUntilTick ?? 0,
      revealedManeuver: inputs.revealOf?.(sessionId) ?? null,
      weapons: fire?.weapons ?? weapons,
      lastFiredSlot: fire?.lastFiredSlot ?? player.lastFiredSlot,
      pendingUntilTick: fire?.pendingUntilTick ?? player.pendingUntilTick,
      switchLockUntilTick: fire?.switchLockUntilTick ?? player.switchLockUntilTick,
    });
```

and after the instance loop:

```ts
  for (const ghost of inputs.ghosts ?? []) instances.push(ghost);
```

with `events: [...(inputs.events ?? [])]` on the returned frame.

Two tests appended to `frame-builder.test.ts`:

```ts
  it("prefers the predicted fire state for the car that has one", () => {
    const frame = buildRenderFrame(source, {
      ...baseInputs,
      fireOf: (sessionId) =>
        sessionId === "me"
          ? { weapons: [{ weaponId: "predator", stocks: 0, rechargeEndsTick: 1100, refireLockUntilTick: 0 }],
              lastFiredSlot: 0, pendingUntilTick: 1001, switchLockUntilTick: 1013 }
          : undefined,
    });
    const me = carOf(frame, "me")!;
    expect(me.weapons[0]!.stocks).toBe(0);
    expect(me.pendingUntilTick).toBe(1001);
    expect(carOf(frame, "them")!.pendingUntilTick).toBe(0);
  });

  it("appends ghosts after the authoritative instances and carries the events", () => {
    const ghost = { id: "0-7", ownerSessionId: "me", weaponId: "predator", kind: 0, x: 1, y: 2,
      angle: 0, extent: 0, spawnTick: 1000, alive: true, isExplosion: false, ghost: true as const };
    const events: MatchEvent[] = [{ kind: "kill", tick: 1000, killer: "me", victim: "them" }];
    const frame = buildRenderFrame(source, { ...baseInputs, ghosts: [ghost], events });
    expect(frame.instances.at(-1)).toEqual(ghost);
    expect(frame.events).toEqual(events);
    expect(frame.events).not.toBe(events);
  });
```

- [ ] **Step 4: The netgraph's four counters**

`packages/client/src/match/netgraph.ts`, added to `NetStats` beside phase 0's `shots` / `manualShots`:

```ts
  /** Presses this client committed (N22's denominator). */
  presses = 0;
  ghostShots = 0;
  /** Presses whose ghosts all expired unconfirmed — spec §7's "< 0.5 % of presses". */
  ghostMismatches = 0;
  /** Authoritative local instances no ghost claimed. The other half of the same question. */
  orphanShots = 0;
```

and to `view()`:

```ts
      presses: this.presses,
      ghostMismatchRate: this.presses === 0 ? 0 : this.ghostMismatches / this.presses,
      orphanShots: this.orphanShots,
```

`NetStatsView` gains the three fields, and `scenes/arena/netgraph-overlay.ts` gains one line beside the correction line:

```
ghost  ${(view.ghostMismatchRate * 100).toFixed(2)}% of ${view.presses}  orphan ${view.orphanShots}
```

One test appended to `netgraph.test.ts`:

```ts
  it("reports a ghost mismatch rate against presses, and zero with no presses", () => {
    const s = new NetStats();
    expect(s.view().ghostMismatchRate).toBe(0);
    s.presses = 200;
    s.ghostMismatches = 1;
    expect(s.view().ghostMismatchRate).toBeCloseTo(0.005, 10);
  });
```

- [ ] **Step 5: Wire `MatchClient`**

`packages/client/src/match/match-client.ts`. New fields beside phase 3's:

```ts
  private readonly fire = new FirePrediction(NET_CONFIG);
  private readonly feed = new EventFeed();
  private readonly hp = new HpEase(HUD_FEEL);
  /**
   * Offsets for INSTANCES, not cars, and deliberately a second object: phase 3's `RenderOffsets`
   * counts a correction past `snapUnits` into `NetStats.snaps`, which is the number phase 3 is
   * graded on ("zero snaps"). A ghost handing over to its twin is not a car snapping and must never
   * appear in that column.
   */
  private readonly shotOffsets = new RenderOffsets(NET_CONFIG, this.stats, { countSnaps: false });
  private readonly reveals = new Map<string, ManeuverReveal>();
  private readonly drawnPoses = new Map<string, SimBody>();
```

`HpEase` and `HUD_FEEL` land in Task 4; until then this field can be omitted and the `hpOf` hook left unset — but the two tasks are one commit apart and it is simpler to run them in order.

**`seed`** gains, after phase 3's body:

```ts
    this.fire.clear();
    this.attachFire();
    this.feed.clear();
    this.hp.clear();
    this.shotOffsets.clear();
    this.reveals.clear();
    this.drawnPoses.clear();
```

with the attachment helper, also called from `followDrivenSeat` (the playground can hand the driver a different car mid-session, PG9):

```ts
  private attachFire(): void {
    const driven = this.drivenSid();
    this.fire.attach({
      arena: this.arena,
      ownerIndex: this.roster.indexOf(driven),
      worldAt: (tick) => this.predictor.worldAt(tick),
      sessionIdOf: (index) => this.roster.sessionIdOf(index),
      startManeuver: (tick, maneuver) => this.predictor.applyLocalManeuver(tick, maneuver),
      handover: (id, dx, dy, dAngle) => this.shotOffsets.add(id, dx, dy, dAngle),
    });
    this.fire.setLevel(this.lobby?.players.get(driven)?.level ?? 1);
  }
```

**`pumpInput`**, inside the per-tick loop phase 3 wrote, immediately after `this.predictor.predictTick(tick, input)` and only on the branch that actually predicted (a frozen world predicts nothing, so it fires nothing):

```ts
        // `runCombat`'s own order: existing instances step BEFORE new ones are born, so a fresh
        // shot draws at the muzzle rather than a tick's travel beyond it.
        this.fire.advance(tick);
        const previous = this.inputs.at(tick - 1).fireSlots;
        const spawns = this.fire.press(tick, input.fireSlots, previous);
        if (spawns.length > 0 || this.fire.stats.presses !== this.pressCount) {
          this.pressCount = this.fire.stats.presses;
          this.stats.presses = this.pressCount;
        }
        this.feed.pushPredicted(this.predictedEventsAt(tick));
        for (const id of this.fire.expired(tick, this.leadCtl.lead + this.rttTicks())) {
          this.shotOffsets.forget(id);
        }
        this.stats.ghostShots = this.fire.stats.ghosts;
        this.stats.ghostMismatches = this.fire.stats.mismatched;
        this.stats.orphanShots = this.fire.stats.orphans;
```

with two small helpers:

```ts
  private rttTicks(): number {
    return Math.ceil(this.clock.rttMs / MS_PER_TICK);
  }

  /**
   * The two event kinds the client can honestly predict, because `stepWorld` produces them and the
   * client runs `stepWorld` (N21). Everything else is combat's and arrives from the server (N14).
   */
  private predictedEventsAt(tick: number): MatchEvent[] {
    const events: MatchEvent[] = [];
    for (const contact of this.predictor.lastContacts) {
      if (contact.kind !== "slam") continue;
      events.push({ kind: "slam", tick, car: contact.victim, x: contact.x, y: contact.y });
    }
    for (const ram of this.predictor.lastRams) {
      events.push({
        kind: "ram", tick, attacker: ram.attacker, victim: ram.victim,
        x: ram.x, y: ram.y, severity: ram.severity,
      });
    }
    return events;
  }
```

**`applySnapshot`** gains, after `this.baseline = snap` and before the prediction comparison:

```ts
    this.feed.pushAuthoritative(snap.events);
    for (const event of snap.events) {
      if (event.kind === "hit") this.hp.flash(event.victim, event.tick);
    }
    const localCar = this.baselineCarOf(this.drivenSid());
    if (localCar) {
      this.fire.rebase(localCar, snap.tick);
      this.fire.confirm(snap.instances, snap.tick);
    }
    for (const car of snap.cars) this.hp.observe(this.roster.sessionIdOf(car.index), car.hp);
```

and, in the correction loop phase 3 wrote, the late-reveal branch:

```ts
    const revealed = this.revealedManeuvers(predicted, world);
    this.predictor.setBaseline(world, echo);
    const deltas = this.predictor.resim(this.loop.localTick, (tick) => this.inputs.at(tick));
    for (const [sessionId, delta] of deltas) {
      // R18a: a correction that exists because a dash began inside the extrapolation window is
      // larger than any offset should hide — `thunderclap` covers 400 u in eight ticks. The car is
      // placed at its corrected position at once and the renderer plays the dash's own trail from
      // where it was last drawn, which reads as "that car dashed" instead of "that car teleported".
      if (revealed.has(sessionId)) continue;
      this.offsets.add(sessionId, delta.dx, delta.dy, delta.dAngle);
    }
```

with:

```ts
  /**
   * Cars whose maneuver the snapshot revealed and the prediction did not have (N31 rule 4).
   *
   * Only remotes: the local car's maneuvers are predicted by `FirePrediction` on the tick of the
   * press, so it can never be surprised by its own dash. A remote can, whenever the press happened
   * inside the extrapolation window, which N31 exists to make rare and this exists to make
   * survivable when the rule is not met.
   */
  private revealedManeuvers(
    predicted: WorldState | undefined,
    snapshot: WorldState,
  ): ReadonlySet<string> {
    const out = new Set<string>();
    const driven = this.drivenSid();
    for (const car of snapshot.cars) {
      if (car.sessionId === driven) continue;
      if (car.maneuver === ManeuverKind.NONE) continue;
      const mine = predicted?.cars.find((c) => c.sessionId === car.sessionId);
      if (mine && mine.maneuver !== ManeuverKind.NONE) continue;
      const drawn = this.drawnPoses.get(car.sessionId);
      this.reveals.set(car.sessionId, {
        weaponId: car.maneuverWeaponId,
        fromX: drawn?.x ?? car.x,
        fromY: drawn?.y ?? car.y,
        fromAngle: drawn?.angle ?? car.angle,
        tick: snapshot.tick,
      });
      this.offsets.forget(car.sessionId);
      out.add(car.sessionId);
    }
    return out;
  }
```

**`renderPoseOf`** records what it returned, which is what a reveal's trail starts from:

```ts
    const pose = { ...blended, x: blended.x + offset.dx, y: blended.y + offset.dy, angle: blended.angle + offset.dAngle };
    this.drawnPoses.set(sessionId, pose);
    return pose;
```

**`frame`** passes the five hooks and decays the instance offsets beside the car ones:

```ts
    this.offsets.decay(elapsed);
    this.shotOffsets.decay(elapsed);
    this.hp.decay(elapsed);
```

```ts
      {
        localSessionId: this.drivenSid(),
        poseOf: (sessionId, _player, serverPose) => this.renderPoseOf(sessionId, serverPose),
        nowMs,
        sinceSnapshotMs: this.sinceLastSnapshotMs(nowMs),
        tickFraction: this.loop.fraction,
        fireOf: (sessionId) =>
          sessionId === this.drivenSid()
            ? {
                weapons: this.fire.slotsAt(this.loop.localTick),
                lastFiredSlot: this.fire.lastFiredSlotAt(this.loop.localTick),
                pendingUntilTick: this.fire.pendingUntilTick(),
                switchLockUntilTick: this.fire.switchLockUntilTick(),
              }
            : undefined,
        hpOf: (sessionId, hp) => this.hp.readOf(sessionId, hp),
        revealOf: (sessionId) => {
          const reveal = this.reveals.get(sessionId);
          if (reveal) this.reveals.delete(sessionId);
          return reveal;
        },
        ghosts: this.ghostInstances(),
        events: this.feed.drain(),
      },
```

`ghostInstances()` applies each ghost's handover offset — the same "offset added on the way out, never back into a step" rule the car poses follow:

```ts
  private ghostInstances(): readonly RenderInstance[] {
    const ghosts = this.fire.ghosts;
    if (ghosts.length === 0) return ghosts;
    return ghosts.map((ghost) => {
      const offset = this.shotOffsets.offsetOf(ghost.id);
      return { ...ghost, x: ghost.x + offset.dx, y: ghost.y + offset.dy, angle: ghost.angle + offset.dAngle };
    });
  }
```

`forgetRemote(sessionId)` gains `this.hp.forget(sessionId); this.reveals.delete(sessionId); this.drawnPoses.delete(sessionId);`.

- [ ] **Step 6: Extend `match-client.test.ts`**

Appended to phase 3's suite, using its `pump` / `deliver` helpers:

```ts
  it("flips the local slot state on the tick of the press, before any snapshot", () => {
    const before = client.frame(now).cars.find((c) => c.isLocal)!;
    expect(before.weapons[0]!.stocks).toBe(1);
    pump(MS_PER_TICK, { steer: 0, throttle: 0, fireSlots: 0b001 });
    const after = client.frame(now).cars.find((c) => c.isLocal)!;
    expect(after.weapons[0]!.stocks).toBe(0);
    expect(after.lastFiredSlot).toBe(0);
  });

  it("draws a ghost for the predicted shot and marks it as one", () => {
    pump(MS_PER_TICK, { steer: 0, throttle: 0, fireSlots: 0b001 });
    const frame = client.frame(now);
    expect(frame.instances).toHaveLength(1);
    expect(frame.instances[0]!.ghost).toBe(true);
    expect(frame.instances[0]!.ownerSessionId).toBe("me");
  });

  it("stops drawing the ghost once its authoritative twin arrives", () => {
    pump(MS_PER_TICK, { steer: 0, throttle: 0, fireSlots: 0b001 });
    const id = client.frame(now).instances[0]!.id;
    const snap = snapshot(1001);
    snap.instances = [{
      ownerIndex: 0, shotSeq: 0, weaponId: "magmablast", kind: 0,
      x: 340, y: 360, angle: 0, extent: 0, alive: true, isExplosion: false, homingTargetIndex: -1,
    }];
    deliver(snap, undefined);
    const frame = client.frame(now);
    expect(frame.instances.filter((i) => i.ghost)).toHaveLength(0);
    expect(frame.instances.map((i) => i.id)).toContain(id);
  });

  it("hands the snapshot's events to exactly one frame", () => {
    const snap = snapshot(1001);
    snap.events = [{ kind: "kill", tick: 1001, killer: "me", victim: "them" }];
    deliver(snap, undefined);
    expect(client.frame(now).events).toHaveLength(1);
    expect(client.frame(now).events).toHaveLength(0);
  });

  it("does not repeat a ram it already predicted when the server's copy arrives", () => {
    // Predicted first (the two cars are in contact in the predicted world), then confirmed.
    pump(MS_PER_TICK * 2, FORWARD);
    const predicted = client.frame(now).events.filter((e) => e.kind === "ram").length;
    const snap = snapshot(1002);
    snap.events = [{ kind: "ram", tick: 1001, attacker: "me", victim: "them", x: 0, y: 0, severity: 0.7 }];
    deliver(snap, undefined);
    const authoritative = client.frame(now).events.filter((e) => e.kind === "ram").length;
    expect(predicted + authoritative).toBeLessThanOrEqual(1);
  });
```

The last test's fixture places the two cars a tick short of contact — change `snapshot(1000)`'s `themX` in `beforeEach` for that one case, or use a local `snapshot(1000, 300, 300 + DRIVE_CONFIG.carWidth + 2)`; phase 3's `snapshot` helper already takes both x values.

- [ ] **Step 7: Run the client suite**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/client && npx vitest run && npm run typecheck`
Expected: PASS; `grep -rin "phaser" src/match/` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/match packages/client/src/scenes/arena/netgraph-overlay.ts
git commit -m "feat(client): ghosts, predicted fire state and the events channel on the RenderFrame (N22, N23a)"
```

---

### Task 4: Tick-time HUD, hp easing and the late-maneuver reveal (N25, N31 rule 4, R18a)

**Files:**
- Create: `packages/client/src/config/hud-feel.ts`, `packages/client/src/match/hp-ease.ts`, `packages/client/src/match/hp-ease.test.ts`, `packages/client/src/match/tick-time.test.ts`
- Modify: `packages/client/src/scenes/arena/car-renderer.ts`

**Interfaces:**
- Consumes: `RenderFrame`, `RenderCar`, `msToTicks`, `MS_PER_TICK`.
- Produces:

```ts
// packages/client/src/config/hud-feel.ts
export const HUD_FEEL: {
  readonly hpEaseMs: number;
  readonly hpFlashMs: number;
};

// packages/client/src/match/hp-ease.ts
export class HpEase {
  constructor(cfg: Pick<typeof HUD_FEEL, "hpEaseMs" | "hpFlashMs">);
  observe(sessionId: string, hp: number): void;
  flash(sessionId: string, tick: number): void;
  decay(deltaMs: number): void;
  readOf(sessionId: string, hp: number): { display: number; flashUntilTick: number };
  forget(sessionId: string): void;
  clear(): void;
}
```

#### What "in tick time" means, and what was already true

Phase 3 made `RenderFrame.tick` the **local** tick rather than the newest snapshot's, and the preparation plan had already replaced every `room.state.tick` in the HUD with `frame.tick`. So most of N25 landed as a consequence of two earlier phases, and this task is the remainder plus the proof:

| N25's list | Where it comes from |
|---|---|
| cooldown ring, wind-up, the car-wide lockout | `RenderCar.weapons[].rechargeEndsTick`, `pendingUntilTick`, `switchLockUntilTick` against `frame.tick` — **predicted** for the driven car as of Task 3 |
| respawn countdown, match clock, death fade | `matchEndsTick`, `diedAtTick` against `frame.tick`; already tick-time since the preparation plan |
| status drain bars | `StatusRow.startTick`/`endsTick` against `frame.tick`; already tick-time |
| phased ghosting | `RenderCar.phased`, derived at `frame.tick` |
| hp | **this task**: the number snaps, the bar eases, and a `hit` event flashes it |

The one thing that can silently undo it is a renderer reaching past the frame for `latestSnapshot.tick`. Step 4 is a test that fails if one ever does.

- [ ] **Step 1: `HUD_FEEL`, and why it is a client constant**

```ts
// packages/client/src/config/hud-feel.ts
/**
 * How the HUD moves. Render-only: nothing here is read by `stepWorld`, so invariant 8 does not
 * claim it and it is not networked — two clients easing an hp bar at different rates disagree about
 * nothing that matters.
 *
 * It lives here rather than in shared `config/` for exactly that reason, beside `display.ts` and
 * `view-options.ts`, and it is a named constant rather than a literal because the repo's second
 * hard invariant admits no magic numbers in logic.
 */
export const HUD_FEEL = {
  /**
   * How long an hp BAR takes to reach a new value (netcode spec N25). The number beside it snaps:
   * a readout that lies about how much health you have is worse than one that jumps, and 700 hp
   * counting down over a tenth of a second is unreadable anyway.
   *
   * Long enough to read as a drain, short enough that a second hit inside it still reads as two.
   */
  hpEaseMs: 100,
  /**
   * How long the damage flash lasts, from the tick of the `hit` event that caused it. Converted to
   * ticks once, at the read, so the flash is measured in the same clock as everything else on the
   * HUD.
   */
  hpFlashMs: 120,
} as const;
```

- [ ] **Step 2: Write the failing `HpEase` test**

```ts
// packages/client/src/match/hp-ease.test.ts
import { describe, expect, it } from "vitest";
import { msToTicks } from "@motor-combat-moba/shared";
import { HUD_FEEL } from "../config/hud-feel.js";
import { HpEase } from "./hp-ease.js";

describe("HpEase", () => {
  it("starts at the first value it is shown, with no slide from zero", () => {
    const ease = new HpEase(HUD_FEEL);
    ease.observe("me", 700);
    expect(ease.readOf("me", 700).display).toBe(700);
  });

  it("eases the bar toward a lower value and lands on it", () => {
    const ease = new HpEase(HUD_FEEL);
    ease.observe("me", 700);
    ease.observe("me", 500);
    expect(ease.readOf("me", 500).display).toBe(700);
    ease.decay(HUD_FEEL.hpEaseMs / 2);
    const mid = ease.readOf("me", 500).display;
    expect(mid).toBeLessThan(700);
    expect(mid).toBeGreaterThan(500);
    ease.decay(HUD_FEEL.hpEaseMs * 4);
    expect(ease.readOf("me", 500).display).toBeCloseTo(500, 6);
  });

  it("snaps rather than eases when a car respawns to full", () => {
    const ease = new HpEase(HUD_FEEL);
    ease.observe("me", 700);
    ease.observe("me", 0);
    ease.decay(HUD_FEEL.hpEaseMs * 4);
    ease.observe("me", 700);
    // Healing is not a drain: a bar sliding UP over a respawn reads as a bug, not as feedback.
    expect(ease.readOf("me", 700).display).toBe(700);
  });

  it("flashes for hpFlashMs from the tick of the hit", () => {
    const ease = new HpEase(HUD_FEEL);
    ease.flash("me", 1000);
    expect(ease.readOf("me", 700).flashUntilTick).toBe(1000 + msToTicks(HUD_FEEL.hpFlashMs));
  });

  it("takes the later of two flashes, so a burst keeps flashing", () => {
    const ease = new HpEase(HUD_FEEL);
    ease.flash("me", 1000);
    ease.flash("me", 1004);
    expect(ease.readOf("me", 700).flashUntilTick).toBe(1004 + msToTicks(HUD_FEEL.hpFlashMs));
  });

  it("forgets a car that left, so a recycled session id inherits nothing", () => {
    const ease = new HpEase(HUD_FEEL);
    ease.observe("me", 700);
    ease.observe("me", 100);
    ease.forget("me");
    expect(ease.readOf("me", 700).display).toBe(700);
  });
});
```

- [ ] **Step 3: Write `match/hp-ease.ts`**

```ts
// packages/client/src/match/hp-ease.ts
import { msToTicks } from "@motor-combat-moba/shared";
import type { HUD_FEEL } from "../config/hud-feel.js";

interface Entry {
  display: number;
  target: number;
  flashUntilTick: number;
}

/**
 * The one value on the HUD that is eased rather than snapped (netcode spec N25).
 *
 * Hp is the exception because it is the only readout whose *change* is the information: a bar that
 * jumps from full to half says "something happened" and nothing else, while a bar that drains says
 * how hard. Every other number on screen — a cooldown, a countdown, a clock — is a deadline
 * measured against the local tick, and easing a deadline would make it wrong.
 *
 * **The number is never eased, only the bar.** `RenderCar.hp` stays authoritative and
 * `RenderCar.hpDisplay` is what the bar draws.
 *
 * **Healing snaps.** The ease exists to make damage legible; a bar sliding up over a respawn or a
 * repair pulse reads as a rendering bug, and there is no equivalent "how hard" to convey.
 *
 * Time-based, never per-frame (rendering spec R9): the decay is a function of elapsed milliseconds,
 * so the bar drains at the same rate on a 30 fps laptop and a 144 Hz monitor.
 */
export class HpEase {
  private readonly entries = new Map<string, Entry>();
  /**
   * The exponential time constant. `1 - e^-3` is 95 %, so the gap is visually closed after
   * `hpEaseMs` and mathematically closed shortly after — which is what "eases over 100 ms" means
   * for a curve with no end point.
   */
  private readonly tau: number;
  private readonly flashTicks: number;

  constructor(cfg: Pick<typeof HUD_FEEL, "hpEaseMs" | "hpFlashMs">) {
    this.tau = Math.max(1, cfg.hpEaseMs / 3);
    this.flashTicks = msToTicks(cfg.hpFlashMs);
  }

  observe(sessionId: string, hp: number): void {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      this.entries.set(sessionId, { display: hp, target: hp, flashUntilTick: 0 });
      return;
    }
    // Healing snaps; only a drop is eased.
    if (hp >= entry.display) entry.display = hp;
    entry.target = hp;
  }

  flash(sessionId: string, tick: number): void {
    const entry = this.entries.get(sessionId);
    const until = tick + this.flashTicks;
    if (!entry) {
      this.entries.set(sessionId, { display: 0, target: 0, flashUntilTick: until });
      return;
    }
    if (until > entry.flashUntilTick) entry.flashUntilTick = until;
  }

  decay(deltaMs: number): void {
    if (deltaMs <= 0) return;
    const factor = 1 - Math.exp(-deltaMs / this.tau);
    for (const entry of this.entries.values()) {
      const gap = entry.target - entry.display;
      if (gap === 0) continue;
      entry.display += gap * factor;
      // Land exactly rather than approaching forever, so a bar at rest is a bar at rest.
      if (Math.abs(entry.target - entry.display) < 0.01) entry.display = entry.target;
    }
  }

  /**
   * `hp` is the authoritative value, used for a car this has never seen — a joiner's first frame,
   * or a car that respawned while the client was stalled.
   */
  readOf(sessionId: string, hp: number): { display: number; flashUntilTick: number } {
    const entry = this.entries.get(sessionId);
    if (!entry) return { display: hp, flashUntilTick: 0 };
    return { display: entry.display, flashUntilTick: entry.flashUntilTick };
  }

  forget(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  clear(): void {
    this.entries.clear();
  }
}
```

Run: `cd packages/client && npx vitest run src/match/hp-ease.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 4: The test that keeps the HUD in tick time**

```ts
// packages/client/src/match/tick-time.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * N25: every readout is computed from the LOCAL tick — `RenderFrame.tick`, which phase 3 made the
 * local one — plus the frame's tick fraction. The single way to undo that silently is for a
 * renderer to reach past the frame for the newest snapshot's tick, so this is a source scan rather
 * than a behavioural test: there is no output to assert on, only a habit to prevent.
 *
 * It deliberately does NOT scan `packages/client/src/match/`, which is where the two clocks are
 * legitimately both in scope.
 */
const RENDER_DIRS = ["src/scenes", "src/dev"];
const FORBIDDEN = [
  /latestSnapshot\s*[.?]\s*tick/,
  /baseline\s*[.?]\s*tick/,
  /room\.state\.tick/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

describe("HUD readouts are in tick time (N25)", () => {
  it("no renderer reads a tick from anywhere but the RenderFrame", () => {
    const offenders: string[] = [];
    for (const dir of RENDER_DIRS) {
      for (const file of walk(dir)) {
        const source = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN) {
          if (pattern.test(source)) offenders.push(`${file}: ${pattern}`);
        }
      }
    }
    expect(offenders, "read frame.tick — the LOCAL tick — not the snapshot's (N25)").toEqual([]);
  });
});
```

If a legitimate exception ever appears, it is added to this file with its reason beside it, never removed from the scan.

- [ ] **Step 5: The hp bar reads the eased value**

`packages/client/src/scenes/arena/car-renderer.ts` — the hp bar the preparation plan moved into this class:

| Before | After |
|---|---|
| the fill fraction computed from `car.hp` | `car.hpDisplay` |
| the "is this car hurt" colour threshold, also from `car.hp` | `car.hpDisplay`, so colour and length agree while the bar drains |
| nothing | a flash: while `frame.tick < car.hpFlashUntilTick`, the bar's fill is drawn at full brightness (the renderer's existing damaged/healthy colours, un-dimmed) |

`car.hp` keeps its meaning everywhere a **number** is shown, which today is nowhere in the arena and is the roster panel's business if it ever is.

**This is the only Phaser-side file this plan edits, and it is deliberately one line of logic plus a colour branch.** The rendering stream converts the hp bar from a `Graphics` to a baked sprite in its own phase 2; that change replaces *how* the bar is drawn and reads the same two `RenderCar` fields, so the two edits do not collide. If the rendering stream's phase 2 has already merged when this task runs, make the same substitution in whatever draws the bar then — the fields are the contract, not the file.

- [ ] **Step 6: Run everything**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/config/hud-feel.ts packages/client/src/match/hp-ease.ts packages/client/src/match/hp-ease.test.ts packages/client/src/match/tick-time.test.ts packages/client/src/match/match-client.ts packages/client/src/scenes/arena/car-renderer.ts
git commit -m "feat(client): tick-time HUD readouts, hp easing and flashes, and the late-maneuver reveal (N25, R18a)"
```

---
### Task 5: N31 read against the shipped table — telegraph or commit

**Files:**
- Create: `packages/shared/src/config/telegraph.ts`, `packages/shared/src/config/telegraph.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `WEAPON_TABLE`, `DRIVE_CONFIG`, `NET_CONFIG.telegraphWindowMs`, `MS_PER_TICK`.
- Produces:

```ts
export interface TelegraphViolation {
  weaponId: WeaponId;
  /** 1 = no wind-up; 3 = the instant acceleration is over budget. A row can fail both. */
  rules: readonly (1 | 3)[];
  startUpMs: number;
  /** `speed / (MS_PER_TICK / 1000)` — the acceleration a standing press commands, u/s^2. */
  instantAccelUnitsPerS2: number;
  /** `2 * carLength / W^2` at `NET_CONFIG.telegraphWindowMs`, u/s^2. */
  budgetUnitsPerS2: number;
  /** How far off a victim's screen the car is, at the window: `min(speed * W, dashDistance)`. */
  positionErrorUnits: number;
}
export function telegraphAudit(): TelegraphViolation[];
```

#### The rule, and what the table says today

Spec §6.6's N31 is a **design** rule, not a netcode one: a dash is an instant, large, unknown acceleration, and no amount of prediction can absorb information that does not exist on the victim's machine yet. The rule has four parts; three are constraints on `WEAPON_TABLE` and one is a rendering behaviour.

1. **Telegraph for at least the window** — `startUpMs >= NET_CONFIG.telegraphWindowMs`, during which `pendingUntilTick`, `lastFiredSlot` and the maneuver's locked fields are already in the snapshot, so a remote client predicts the dash exactly from its first tick.
2. **Commit once started** — no mid-dash steering, no cancel. Already true: `startManeuver` freezes `maneuverAngle` and `maneuverSpeed` at the press and `stepDrive` integrates them, and `maneuverSlotMask` masks a second press out.
3. **Budget the instant ones** — a power that cannot be telegraphed keeps `0.5 * dA * W^2` under a car length.
4. **Render a late reveal as the effect** — Task 3's `RenderCar.revealedManeuver`.

Parts 2 and 4 are code and are done. Parts 1 and 3 are numbers in a balance table, and **this plan does not edit balance tables**. What it ships is the audit that reads the live table and names the rows that fail, so the decision is the user's and a future row cannot slip past unnoticed.

**Computed against the table as it stands, at `telegraphWindowMs` 150 and `DRIVE_CONFIG.carWidth` 48:**

| Row | Kind | `startUpMs` | Instant acceleration | Budget | Error at the window | Verdict |
|---|---|---|---|---|---|---|
| `thunderclap` | maneuver / dash, `speed` 1600, `aimRangeUnits` 400 | **0** | `1600 / (1/60)` = **96,000 u/s²** | `2 x 48 / 0.15²` = **4,267 u/s²** | `min(1600 x 0.15, 400)` = **240 u**, five car lengths | **fails rules 1 and 3** |
| `wildcharge` | maneuver / charge, `speed` 0, `range` 0 | 0 | 0 | 4,267 u/s² | 0 u | passes — a charge dashes nowhere; it changes how the car drives under ordinary input, which the predictor already has |

`lance`'s 700 ms wind-up is cited by the spec as the example of a power that already telegraphs, but it is a `beam`, not a mobility power, so it is not in the audit's scope: a shot's wind-up is a hit-timing question, not a prediction one.

**`thunderclap` is the one violating row, and this plan does not change it.** Raising `startUpMs` from 0 to 150 is a `WEAPON_TABLE` edit, which carries the `npm run build:manual` rebuild, the `balanceStamp` move, a `protocolHash` change that refuses every older client, and a real change to how the weapon feels — it is scheduled as its own gated task in [`16-netcode-6-optional.md`](16-netcode-6-optional.md) and the spec records it as "a weapon-row balance edit, recorded here as a follow-up rather than made". **Hand the user this table in the phase summary.**

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/config/telegraph.test.ts
import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "./drive-config.js";
import { NET_CONFIG } from "./net-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import { MS_PER_TICK } from "../constants.js";
import { telegraphAudit } from "./telegraph.js";

describe("telegraphAudit (N31)", () => {
  it("names exactly the rows that fail the rule today", () => {
    const violations = telegraphAudit();
    expect(
      violations.map((v) => v.weaponId),
      "a mobility power that fails N31 must be raised with the user as a balance change, never " +
        "silently exempted here — see 14-netcode-4-feel.md Task 5",
    ).toEqual(["thunderclap"]);
  });

  it("reports thunderclap's numbers from the live table, not from constants", () => {
    const [violation] = telegraphAudit();
    expect(violation!.rules).toEqual([1, 3]);
    expect(violation!.startUpMs).toBe(WEAPON_TABLE.thunderclap.startUpMs);
    expect(violation!.instantAccelUnitsPerS2).toBeCloseTo(
      WEAPON_TABLE.thunderclap.speed / (MS_PER_TICK / 1000),
      6,
    );
    const w = NET_CONFIG.telegraphWindowMs / 1000;
    expect(violation!.budgetUnitsPerS2).toBeCloseTo((2 * DRIVE_CONFIG.carWidth) / (w * w), 6);
    expect(violation!.positionErrorUnits).toBeCloseTo(
      Math.min(WEAPON_TABLE.thunderclap.speed * w, WEAPON_TABLE.thunderclap.aimRangeUnits!),
      6,
    );
    // Spec §6.6 states the artefact as "about 200 u — four car lengths"; the live table's numbers
    // must stay in that neighbourhood, or the spec's prose has gone stale with the tuning.
    expect(violation!.positionErrorUnits).toBeGreaterThan(3 * DRIVE_CONFIG.carWidth);
  });

  it("exempts a charge, which commands no translation the predictor does not have", () => {
    expect(WEAPON_TABLE.wildcharge.speed).toBe(0);
    expect(telegraphAudit().some((v) => v.weaponId === "wildcharge")).toBe(false);
  });

  it("audits maneuver rows only", () => {
    const maneuvers = Object.values(WEAPON_TABLE).filter((row) => row.kind === "maneuver");
    for (const violation of telegraphAudit()) {
      expect(maneuvers.some((row) => row.id === violation.weaponId)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Write `config/telegraph.ts`**

```ts
// packages/shared/src/config/telegraph.ts
import { MS_PER_TICK } from "../constants.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { NET_CONFIG } from "./net-config.js";
import { WEAPON_TABLE } from "./weapon-config.js";
import type { WeaponId } from "./weapon-types.js";

/**
 * N31, read against the live table: does every mobility power either telegraph for the design-point
 * extrapolation window, or command an acceleration small enough that a remote client's error stays
 * under a car length?
 *
 * **This audits; it never enforces.** A row that fails is a balance decision the user owns — the
 * fix is `startUpMs`, which changes how the weapon feels, moves `balanceStamp`, and owes the
 * players' guide a rebuild. The test beside this file fails when the SET of violating rows changes,
 * so a new weapon cannot arrive with an unpredictable dash and nobody notice; it does not fail on
 * the violation that is already known and recorded.
 *
 * Nothing in the sim calls this. It exists so the rule is a number in the repository rather than a
 * paragraph in a spec.
 */
export interface TelegraphViolation {
  weaponId: WeaponId;
  /** 1 = no wind-up (rule 1); 3 = the instant acceleration is over budget (rule 3). */
  rules: readonly (1 | 3)[];
  startUpMs: number;
  /**
   * The acceleration a standing press commands. A dash reaches its full speed inside ONE tick, so
   * this is `speed / (MS_PER_TICK / 1000)` — the honest figure, not an average over the dash.
   */
  instantAccelUnitsPerS2: number;
  /** Rule 3's ceiling: `0.5 * dA * W^2 <= carLength` rearranged. */
  budgetUnitsPerS2: number;
  /**
   * How far a victim's screen is wrong at the window, which is what a player actually sees. A dash
   * runs at constant speed rather than constant acceleration, so it is `speed * W`, capped by the
   * dash's own distance — it cannot be more wrong than the whole dash.
   */
  positionErrorUnits: number;
}

export function telegraphAudit(): TelegraphViolation[] {
  const windowSeconds = NET_CONFIG.telegraphWindowMs / 1000;
  const budget = (2 * DRIVE_CONFIG.carWidth) / (windowSeconds * windowSeconds);
  const out: TelegraphViolation[] = [];

  for (const row of Object.values(WEAPON_TABLE)) {
    if (row.kind !== "maneuver") continue;
    // A power that translates the car is the one a predictor cannot absorb. A charge changes how
    // the car drives under the input the predictor already has, which is why spec §6.6 exempts
    // `wildcharge` by name.
    if (row.speed <= 0) continue;

    const instantAccel = row.speed / (MS_PER_TICK / 1000);
    const distance = row.aimRangeUnits ?? row.range;
    const positionError = Math.min(row.speed * windowSeconds, distance);

    const rules: (1 | 3)[] = [];
    if (row.startUpMs < NET_CONFIG.telegraphWindowMs) rules.push(1);
    if (instantAccel > budget) rules.push(3);
    if (rules.length === 0) continue;

    out.push({
      weaponId: row.id,
      rules,
      startUpMs: row.startUpMs,
      instantAccelUnitsPerS2: instantAccel,
      budgetUnitsPerS2: budget,
      positionErrorUnits: positionError,
    });
  }

  out.sort((a, b) => (a.weaponId < b.weaponId ? -1 : a.weaponId > b.weaponId ? 1 : 0));
  return out;
}
```

`packages/shared/src/index.ts`:

```ts
export { telegraphAudit } from "./config/telegraph.js";
export type { TelegraphViolation } from "./config/telegraph.js";
```

Run: `cd packages/shared && npx vitest run src/config/telegraph.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/config/telegraph.ts packages/shared/src/config/telegraph.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): audit WEAPON_TABLE against N31's telegraph-or-commit rule (reports, never enforces)"
```

**Say it loudly in the phase summary, with the table above:** `thunderclap` fails N31 rules 1 and 3 as shipped — `startUpMs` 0 against a 150 ms window, 96,000 u/s² against a 4,267 u/s² budget, 240 u of error on a victim's screen against a 48 u car. **No balance table was edited.** The fix is `startUpMs: 150`, which is N6's gated task and carries `npm run build:manual`, a `balanceStamp` move and a `protocolHash` change. Until the user makes that call, the late-reveal path from Task 3 is what covers it.

---

### Task 6: Measurement, and the pages

**Files:**
- Modify: `packages/server/playtest/netcode.ts`, `packages/server/playtest/README.md`, `docs/networking.md`, `docs/combat-model.md`, `docs/config-reference.md`, `docs/project-structure.md`, `docs/glossary.md`, `packages/client/CLAUDE.md`, root `CLAUDE.md`
- Test: none — probes report, they do not assert

**Interfaces:**
- Consumes: `MatchClient`, `NetStats`, `FirePrediction`'s counters through it, `LoopbackTransport`, `PlaytestWorld`, `buildSnapshot`.
- Produces: two new columns and one new row in `playtest/reports/<date-NN>/netcode.md`.

**This is the one probe file this phase touches**, and it is the harness spec §7 created for exactly this measurement — its scenario list does not change, and no new probe file or scenario is created.

- [ ] **Step 1: Fire in the harness**

`playtest/netcode.ts`'s `trial()` drives the client with a constant `FORWARD` sample. Phase 4 needs presses, so the sample becomes a small scripted schedule — a change to the *input*, not to the scenario set:

```ts
  /**
   * Slot 1 pressed for one tick every `firePeriod` ticks. A period rather than a hold, because the
   * press EDGE is what spawns a ghost (N7) and a held trigger fires once — measuring the mismatch
   * rate on one press would be measuring nothing.
   *
   * 24 ticks is 400 ms, comfortably longer than the longest cooldown a single-slot schedule can hit
   * and short enough that a 900-tick trial makes ~37 presses.
   */
  const firePeriod = 24;
  const sampleAt = (tick: number): RawInput => ({
    steer: FORWARD.steer,
    throttle: FORWARD.throttle,
    fireSlots: tick % firePeriod === 0 ? 0b001 : 0,
  });
```

and `net.pumpInput(MS_PER_TICK, () => sampleAt(tick), nowMs)` in place of `() => FORWARD`.

`TrialResult` gains four fields:

```ts
interface TrialResult {
  // …existing fields…
  /** `NetStats.presses` at the end of the trial. */
  presses: number;
  /** `NetStats.ghostMismatches` — presses whose ghosts all expired unconfirmed. */
  ghostMismatches: number;
  /** `NetStats.orphanShots` — authoritative local shots no ghost claimed. */
  orphanShots: number;
  /**
   * Ticks between a press being sampled and the frame showing the slot state change. Zero is the
   * acceptance line ("press-to-flash within one frame"); anything above zero means the frame is
   * being built before the press is applied.
   */
  pressToFlashTicks: number[];
}
```

`pressToFlashTicks` is measured inside the trial loop by remembering the tick a press was sampled and the stock count of slot 0 before it, then walking forward until `net.frame(nowMs).cars.find((c) => c.isLocal)!.weapons[0]!.stocks` differs:

```ts
      if (tick % firePeriod === 0) {
        const before = net.frame(nowMs).cars.find((c) => c.isLocal)?.weapons[0]?.stocks;
        pendingPress = { tick, before };
      }
      if (pendingPress) {
        const now = net.frame(nowMs).cars.find((c) => c.isLocal)?.weapons[0]?.stocks;
        if (now !== pendingPress.before) {
          result.pressToFlashTicks.push(tick - pendingPress.tick);
          pendingPress = undefined;
        }
      }
```

The sample is taken *before* `pumpInput` on the press tick and re-read *after* it, so a value of `0` means the HUD moved inside the same tick the key went down, which is the number spec §8 asks for.

- [ ] **Step 2: The N6 row**

One row added to the report, beside the five phase-0-to-3 rows the harness already prints:

```ts
/* N6. Phase 4: predicted fire, ghost shots and press-to-flash (spec §6.7, §8 phase 4) */
{
  const rows: string[] = [];
  let worstRate = 0;
  let worstFlash = 0;
  for (const { latencyMs, jitterMs } of [
    { latencyMs: 0, jitterMs: 0 },
    { latencyMs: 30, jitterMs: 0 },
    { latencyMs: 45, jitterMs: 10 },   // the design point: 90 ms RTT +/- 20 ms
    { latencyMs: 75, jitterMs: 20 },   // spec §7's "same run at 150 ms RTT"
  ]) {
    const r = trial({ latencyMs, jitterMs, lossRate: 0.01, ticks: 1800, seed: 23 });
    const rate = r.presses === 0 ? 0 : r.ghostMismatches / r.presses;
    const flash = Math.max(0, ...r.pressToFlashTicks);
    worstRate = Math.max(worstRate, rate);
    worstFlash = Math.max(worstFlash, flash);
    rows.push(
      `${String(latencyMs * 2).padStart(4)} ms RTT +/- ${String(jitterMs * 2).padStart(2)}: ` +
        `presses ${String(r.presses).padStart(4)}  ` +
        `ghost mismatch ${(rate * 100).toFixed(2)}%  ` +
        `orphans ${String(r.orphanShots).padStart(3)}  ` +
        `press->flash max ${flash} tick(s)`,
    );
  }
  reporter.report(
    "N6. Predicted fire and ghost shots: does a press land on screen, and does the ghost match?",
    worstRate >= 0.005 || worstFlash > 0 ? VERDICT.FINDING : VERDICT.OK,
    `Phase 4's acceptance line (spec §8, execution guide §5): ghost-shot mismatch < 0.5 % of presses,\n` +
      `press-to-flash within one frame (0 ticks), HUD readouts in tick time. A ghost that flew its\n` +
      `whole life without an authoritative twin is a mismatch; one the server confirmed, or that\n` +
      `reached its own range first, is not. "orphans" counts the other direction — a real shot the\n` +
      `client never predicted — and is reported rather than gated, because it is the same defect\n` +
      `seen from the far side and a non-zero value with a zero mismatch rate means the ids are\n` +
      `drifting rather than the presses.\n` +
      `${rows.join("\n")}`,
  );
}
```

- [ ] **Step 3: The events column on the existing N2 row**

The head-on sweep is where events actually fire, so it is where the cap is visible. Two numbers are appended to its note rather than a new row: `events/tick max` and `dropped`, read off the room's `ctx.droppedEvents` and a per-tick maximum the trial records. One sentence in the note:

```
`NET_CONFIG.eventsPerSnapshotMax` is 16; a non-zero "dropped" here means a real match is losing hit
sparks and the cap should be raised, which costs 11 B per event on the wire (phase 2's layout).
```

- [ ] **Step 4: The README's paragraph**

`packages/server/playtest/README.md`, the `netcode.ts` paragraph's list of what the probe reports gains: "ghost-shot mismatch rate and press-to-flash latency at four latencies (N6), and the per-tick event count against `eventsPerSnapshotMax`". No scenario is added and no other file's description changes.

- [ ] **Step 5: The pages**

`docs/networking.md` — the client section gains, after phase 3's prediction and reconciliation text:

```
**Firing is predicted; damage is not.** The local car runs `tickRecharge`, `beginFire` and
`releaseShots` on a `FireState` rebuilt from its own snapshot fields, so a press flips the HUD —
stocks, ring, the car-wide lockout — on the tick the key went down rather than a round trip later,
and a maneuver's four fields are written into the predicted world exactly as `startManeuver` writes
them. A press also spawns a **ghost instance** with the id the server will assign,
`instanceId(carIndex, shotSeq)`, aimed with the snapshot's lock against the extrapolated target and
stepped through the shared `stepInstance`. When the authoritative instance with that id arrives the
ghost hands over to it with a render offset; if none arrives within `lead + RTT +
NET_CONFIG.ghostGraceTicks` ticks the ghost is removed and the HUD resims from the snapshot — a
refused press, which the server explains with a `refused` event.

Damage, hp, death, kills, statuses landing on other people and every other car's shots are never
predicted (N14). A mispredicted bullet is a phantom kill and there is no reconciliation story for
"you were dead for 80 ms".

**Feedback is an event, not a guess.** Every spark, flash, shake, hit marker and kill banner comes
from `Snapshot.events` — `hit`, `kill`, `ram`, `slam`, `respawn`, `refused` — so it lands at the
server's contact point on the server's tick. The client predicts exactly two of those kinds, `ram`
and `slam`, because they come out of `stepWorld` and the client runs `stepWorld`; the predicted copy
and the server's are recognised as the same event by `(tick, kind, cars)` and drawn once. The ram
event is derived from the contact transition by `sim/ram-events.ts` rather than emitted by the sim —
see that file for what it costs.

**Every readout is in tick time.** Cooldowns, wind-ups, countdowns, the match clock, status drain
bars and the death fade are all computed from `RenderFrame.tick`, which is the LOCAL tick, plus the
frame's tick fraction. Hp is the single exception and it is a half-exception: the number is the
snapshot's, un-eased, and only the BAR eases toward it over `HUD_FEEL.hpEaseMs`, flashing on a
`hit` event.
```

`docs/combat-model.md` — the elimination/weapons section gains one short subsection, "What the client predicts", with the first two paragraphs above condensed, and a line under ramming: "A ram's feedback — the spark and the shake — is a `ram` event derived from the contact transition (`sim/ram-events.ts`), which carries the attacker, the victim, the graded severity and the midpoint of the two hulls. It is not the contact manifold point: `resolveContacts` does not return one."

`docs/config-reference.md`, the `NET_CONFIG` table — three rows with the comments from Task 1 Step 3 as their notes, and one sentence under the table: "`eventsPerSnapshotMax` is the only key here that can silently drop information a player would notice; `playtest/netcode.ts`'s N2 row prints how close a real match gets to it."

`docs/project-structure.md` — `sim/ram-events.ts` and `config/telegraph.ts` under shared; `net/event-source.ts` under server `net/`; `match/fire-prediction.ts`, `match/event-feed.ts`, `match/hp-ease.ts` under client `match/`; `config/hud-feel.ts` under client `config/`.

`docs/glossary.md` — **Ghost shot**: "a projectile the client predicted for its own press, drawn with the id the server will assign (`instanceId(ownerIndex, shotSeq)`) and replaced by the authoritative instance when it arrives. An unconfirmed ghost expires after `lead + RTT + NET_CONFIG.ghostGraceTicks` ticks and is counted." **Event**: "one of the six reliable `MatchEvent` kinds in the snapshot. The single source of every piece of combat feedback; idempotent per `(tick, kind, cars)`." **Telegraph**: "the wind-up a mobility power carries so a remote client can predict it from its first tick (N31). `config/telegraph.ts` audits `WEAPON_TABLE` against it."

`packages/client/CLAUDE.md` — **the paragraph beginning "Combat is drawn, never predicted" is now wrong and must be rewritten**, because that is exactly what this phase changes:

```
Combat is *mostly* drawn, not predicted. The local car's FIRE STATE is predicted — recharge, the
press, the wind-up, the maneuver, and a ghost instance for each shot it would spawn — by
`match/fire-prediction.ts`, running the same shared `tickRecharge`/`beginFire`/`releaseShots`/
`spawnInstances` the server runs, and every one of those predictions is thrown away and rebuilt from
the car's own snapshot fields on the next snapshot. Damage, hp, death, kills, statuses on other
people and every other car's shots are still never predicted. Live instances come off the wire
through `SnapshotView`; ghosts are appended to the same `RenderFrame.instances` list carrying
`ghost: true`, and `hp` from `SnapshotCar.hp`.

Feedback is never detected locally. `scenes/impact-feedback.ts`'s local contact detection is the
last of that and the rendering stream's phase 4 deletes it; everything else reads
`RenderFrame.events`.
```

and the sentence naming `net/step-context.ts` as where pure logic lives is already gone (phase 3 deleted the file); make sure the list reads `match/fire-prediction.ts`, `match/hp-ease.ts`, `scenes/car-visual.ts`, `scenes/arena-input.ts`.

Root `CLAUDE.md` — no invariant moves in this phase. One sentence is added to the statuses paragraph: "`corroded`'s only source is still an explosion; what changed in the 2026-09-04 netcode work is that a status arriving is now *reported* as part of a `hit` event's consequences rather than inferred by the client." Leave every other paragraph alone.

- [ ] **Step 6: Run everything, for real**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena
node --test scripts/turn-tuning-doc.test.mjs scripts/manual-page.test.mjs
cd packages/server && npx tsx playtest/netcode.ts && npx tsx playtest/weapons.ts && cd ../..
npm run balance -- --shape=duel --matches=20 --seed=7
```

Expected: all green. `netcode.md`'s **N6** row reads `OK` with a ghost mismatch rate under 0.5 % and a press-to-flash maximum of 0 ticks at every latency. `turn-tuning-doc.test.mjs` and `manual-page.test.mjs` pass **untouched** — no drive constant, weapon row, chassis row or status row moved, so neither page is owed a rebuild and `npm run build:manual` is **not** run. `weapons.ts` and the balance run report what they reported before Task 1.

- [ ] **Step 7: Commit**

```bash
git add packages/server/playtest/netcode.ts packages/server/playtest/README.md docs/networking.md docs/combat-model.md docs/config-reference.md docs/project-structure.md docs/glossary.md packages/client/CLAUDE.md CLAUDE.md
git commit -m "test(playtest): phase 4 acceptance columns; docs: what the client predicts and what it never will"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Probe note — say it loudly.**

- **`playtest/netcode.ts`** — the harness's client now presses a slot every 24 ticks instead of holding `FORWARD`, so its **N1 and N2 rows measure a car that is also firing**. That is a deliberate change to the scenario's input and it is expected to move the numbers a little: firing costs no motion, but `releaseShots` writes `switchLockUntilTick` and a ghost is stepped every tick, which is client CPU. Quote the before/after report folders in the summary. A new **N6** row carries the phase-4 gate.
- **`playtest/weapons.ts`, `weapons2.ts`** — untouched files whose pipeline now carries a per-tick `CombatEvents` bag (Task 1). Expected unchanged; **verified by the run above, not assumed**.
- **`playtest/prediction.ts`** — untouched. Phase 3 re-pinned it; nothing in phase 4 changes what it measures.
- **`playtest/lan.ts`** — still speaks the pre-phase-1 message shapes; stale since phase 1 and not touched here. Flag it for the user again.
- **`packages/server/balance/`** — the harness supplies its own match-long `CombatEvents` through the same `PipelineCtx.events` field the rooms now use per tick. Its numbers must not move; run it and say so.

---
## Acceptance

Spec §8, phase 4 row: **Ships** — "predicted fire state, maneuvers and ghost shots; events; tick-time HUD; hp easing and flashes". **Fixes** — "F6". **Acceptance** — "ghost mismatch < 0.5 %; press-to-flash one frame". Execution guide §5 states the gate in full: *"ghost-shot mismatch < 0.5 % of presses; press-to-flash within one frame; HUD readouts in tick time"*.

| Requirement | Demonstrated by |
|---|---|
| Ghost-shot mismatch < 0.5 % of presses | `cd packages/server && npx tsx playtest/netcode.ts` — the **N6** row's `ghost mismatch` column at all four latency cells, including the design point (`45 ms / ±10 ms`) and spec §7's 150 ms RTT run. N6 reads `OK`. The `orphans` column beside it must also be 0 or near it: a zero mismatch rate with non-zero orphans means the ids are drifting rather than the presses failing |
| Press-to-flash within one frame | the same row's `press->flash max` column, which must read **0 ticks** at every cell; and `?debug=net` in a live practice match, where the slot's stock drops on the frame the key goes down |
| HUD readouts in tick time | `cd packages/client && npx vitest run src/match/tick-time.test.ts` — no renderer reads a tick from anywhere but the `RenderFrame`; and `grep -rn "frame.tick" packages/client/src/scenes/arena/hud-renderer.ts` shows every readout measured against it |
| Predicted fire state and maneuvers | `cd packages/client && npx vitest run src/match/fire-prediction.test.ts src/match/match-client.test.ts` — 13 + the phase-3 suite's tests, including "flips the slot state on the tick of the press, before any snapshot" and "starts a maneuver instead of spawning an instance" |
| Ghost shots, and their handover and expiry | the same two suites: "spawns a ghost per instance a press would produce, with the id the server will assign", "hands a ghost over to its authoritative twin and stops drawing it", "expires an unconfirmed ghost after lead + rtt + ghostGraceTicks and counts it", "renumbers a surviving ghost off the new snapshot's shotSeq" |
| Events (N23a) | `cd packages/server && npx vitest run src/net/event-source.test.ts` (8 tests); `cd packages/shared && npx vitest run src/sim/ram-events.test.ts` (5); `cd packages/client && npx vitest run src/match/event-feed.test.ts` (6). In a live match, `Snapshot.events` is non-empty on any tick something happened |
| The predicted and authoritative copies of one event are drawn once | `event-feed.test.ts`'s "drops an authoritative event the client already predicted", and `match-client.test.ts`'s "does not repeat a ram it already predicted" |
| hp easing and flashes | `cd packages/client && npx vitest run src/match/hp-ease.test.ts` (6 tests); the bar drains over `HUD_FEEL.hpEaseMs` while `RenderCar.hp` snaps |
| `runCombat` untouched (N14) | `git diff --stat development/main -- packages/shared/src/sim/combat.ts` shows **one line**: the `export` keyword on `maneuverSlotMask`. `git diff development/main -- packages/shared/src/sim/contact.ts packages/shared/src/sim/ram.ts packages/shared/src/sim/damage.ts packages/shared/src/sim/weapons/` prints **no changes** |
| `resolveContacts` untouched | the same `git diff` on `sim/contact.ts`; and `sim/ram-events.ts` reaches the ram through the exported `resolveRam` only |
| N31 read, not enforced | `cd packages/shared && npx vitest run src/config/telegraph.test.ts` — the audit names `thunderclap` and only `thunderclap`; `git diff development/main -- packages/shared/src/config/weapon-config.ts packages/shared/src/config/car-config.ts` prints **no changes** |
| No balance table moved, so no page is owed a rebuild | `node --test scripts/turn-tuning-doc.test.mjs scripts/manual-page.test.mjs` passes with neither page edited and `npm run build:manual` never run |
| Nothing under `match/` imports Phaser, and no test does | `grep -rin "phaser" packages/client/src/match/` prints nothing |
| Snapshot size still inside spec §7 | `cd packages/shared && npx vitest run src/net/codec.test.ts` — phase 2's three pinned figures are unchanged; the events section adds at most `NET_CONFIG.eventsPerSnapshotMax × 11 B` = 176 B, so a contact-plus-volley delta stays under 500 B against the 1.2 KB volley line |
| F6 — a press shows something at once | the N6 row's `press->flash` column, plus `match-client.test.ts`'s slot-state test; the ring, `pendingUntilTick` and the car-wide lockout all move on the press tick rather than 100–140 ms later |
| Everything else still green | `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena` |
| The probes, read rather than assumed | `npx tsx playtest/netcode.ts`, `npx tsx playtest/weapons.ts` and `npm run balance -- --shape=duel --matches=20 --seed=7`, with the before/after report folders quoted in the merge commit |

Record the measured N6 numbers here, with the date, when the phase is run.

## Handoff

Exports and behaviour this plan produces **beyond** the ledger, for N5 and later to consume:

- **Shared, `sim/ram-events.ts`.** `ramContactsFrom(before, after, approachSpeeds, claimedPairs): RamContact[]` and `RamContact`. Pure, called by both machines, and the answer to the ledger's `ContactEvent` caveat: the `"ram"` kind is still not emitted by `stepWorld`, and this is what fills `MatchEvent.ram` instead. Its two limits are the hull-centre midpoint in place of the contact manifold point, and the exclusion (rather than re-classification) of a pair a dash hit or slam claimed.
- **Shared, `sim/combat.ts`.** `maneuverSlotMask(fireState: FireState): number` is now exported; the function body and `runCombat` are untouched. `aimAngleFor` is now exported from the package barrel — it always was from the module.
- **Shared, `config/telegraph.ts`.** `telegraphAudit(): TelegraphViolation[]` and `TelegraphViolation`. Reports; never enforces. Today it names `thunderclap` and nothing else.
- **Shared, `config/net-config.ts`.** `NET_CONFIG` gains `ghostGraceTicks` (2, the ledger's), `eventsPerSnapshotMax` (16) and `telegraphWindowMs` (150). `protocolHash()` does not cover `NET_CONFIG`, so none of them moves the hash.
- **Server.** `net/event-source.ts`: `matchEventsFor(args): { events, dropped }`, `MatchEventArgs`, `EventPose`. `sim/world-bridge.ts`: `WorldTickResult.rams: RamContact[]`, filled on the `MATCH` path and `[]` everywhere else. `rooms/tick-pipeline.ts`: `PipelineCtx.matchEvents?: MatchEvent[]` and `PipelineCtx.droppedEvents?: number`, both caller-owned sinks like the existing `events`; `respawnSweep` pushes its own `respawn` events. `net/snapshot-source.ts`: `SnapshotSourceCtx.events?: readonly MatchEvent[]`, copied into the snapshot. On each room: `tickEvents`, `pendingEvents`, and `snapshotFor(sessionId, events = [])`.
- **Client, `match/fire-prediction.ts`.** `FirePrediction` with the ledger's five members plus `attach(ctx: FireContext)`, `advance(localTick)`, `clear()`, `setLevel(level)`, `slotsAt(tick)`, `lastFiredSlotAt(tick)`, `pendingUntilTick()`, `switchLockUntilTick()` and `stats: FireStats`. `GhostInstance`, `GhostSpawn`, `PredictedManeuver`, `FireContext`, `FireStats`. **`attach` exists because the ledger fixes the constructor at `(cfg)`**, which cannot reach an arena or a predicted world; every ledger-listed member keeps its declared signature exactly.
- **Client, `match/prediction.ts`.** `WorldPredictor.applyLocalManeuver(tick, maneuver)` and `WorldPredictor.lastRams`. The maneuver ring is internal, bounded by `maxPredictionTicks`, and replayed by `resim` through `stepOne` — so a correction arriving mid-dash does not cancel the dash.
- **Client, `match/render-offset.ts`.** `RenderOffsets`' constructor takes an optional third argument, `{ countSnaps?: boolean }`, default `true`. `MatchClient` builds a second instance with it `false` for instance handovers, so a ghost handing over never appears in the `snaps` counter phase 3 is graded on.
- **Client, `match/event-feed.ts`.** `EventFeed` and `eventKey(event): string` — N23a's `(tick, kind, cars)` identity, payload-independent on purpose.
- **Client, `match/hp-ease.ts`** and **`config/hud-feel.ts`.** `HpEase` and `HUD_FEEL` (`hpEaseMs` 100, `hpFlashMs` 120). Render-only; nothing in `stepWorld` reads them.
- **Client, `match/render-frame.ts`.** `RenderCar` gains `hpDisplay`, `hpFlashUntilTick` and `revealedManeuver`; `RenderInstance` gains an optional `ghost`; `ManeuverReveal` is new. `RenderFrame.events` is **no longer always empty** — every renderer must still behave correctly on an empty list, but it is now the source of all feedback.
- **Client, `match/frame-builder.ts`.** `FrameInputs` gains five optional hooks — `fireOf`, `hpOf`, `revealOf`, `ghosts`, `events` — and `PredictedFire`. Every one is absent-safe, so the preparation plan's and phase 2's tests pass unchanged.
- **Client, `match/netgraph.ts`.** `NetStats` gains `presses`, `ghostShots`, `ghostMismatches`, `orphanShots`; `NetStatsView` gains `presses`, `ghostMismatchRate`, `orphanShots`; the overlay draws one more line.
- **For N5 specifically.** `MatchClient.seed` already clears `FirePrediction`, `EventFeed`, `HpEase`, the instance offsets, the reveal map and the drawn-pose map — which is exactly what a reconnect needs, because N26's reconnect path is "receive the roster, restart clock sync and lead from scratch, take one full snapshot as a new baseline", i.e. a reseed. **`sendFull` deliberately carries no events**, so a resuming client does not replay a second of sparks it missed; the first ordinary snapshot after it brings the first events it can act on. `FirePrediction.rebase` is safe against a snapshot arriving after an arbitrary gap: it rebuilds the whole `FireState` and renumbers whatever ghosts survived, and `expired` clears the rest on the clock.
- **For the rendering stream.** `RenderCar.revealedManeuver` is the sim-side half of R18a; the drawing half — playing the maneuver's own trail from `from*` to the car's current pose over a few frames — belongs to the V-stream, and `RenderInstance.ghost` is the flag a ghost should be drawn slightly differently by (or identically, which is also a valid choice). `RenderFrame.events` is what V4's `EffectRouter` consumes; the one-line switch V4's plan describes is *already done* once this phase merges, because the field is filled by the same builder either way.
- **Known, bounded, and deliberately left.** A ghost is aimed with the lock the *snapshot* held, so a lock acquired between snapshots aims the ghost straight while the server's shot curves — a mismatch of direction, not of identity, corrected at handover by a render offset. A rebased mid-burst press assumes one volley left, which is exact for every row in the shipped table and would under-predict a multi-volley row (pinned by a test). A predicted `ram` computes its severity from approach speeds the client also predicted, so the spark's magnitude is approximate until the server's copy would have arrived — by which time the spark is over, and the identity, not the magnitude, is what `eventKey` matches on.
- **Not done here, on purpose.** `scenes/impact-feedback.ts` still exists and is still called: deleting it is the **rendering** stream's phase 4, and doing it here would leave the render side with no feedback at all between the two merges. Muzzle flashes, sparks, decals, camera shake and the kill banner's effect are all V4's; this phase delivers the events they read. `playtest/lan.ts` still speaks the pre-phase-1 message shapes. `thunderclap`'s `startUpMs` is unchanged and the row is named for the user.

## Self-review

**Spec coverage.** N22: Task 2 in full — the shared fire chain run on a rebuilt `FireState`, the maneuver written into the predicted world, ghosts with predictable ids, handover with a render offset, expiry at `lead + RTT + ghostGraceTicks`; Task 3 wires it and Task 6 measures it. The "refused" press §6.12's last row describes is both produced (Task 1's `matchEventsFor`) and consumed (the ghost's own expiry). N21: Task 3's `predictedEventsAt` — the two kinds `stepWorld` produces are predicted, and damage and the wall-slam stun are explicitly not. N23a: Task 1 produces every one of the six kinds with the ledger's exact payloads, and Task 3's `EventFeed` implements the idempotency clause the spec attaches to them. N25: Task 4, plus the two halves that landed earlier (the preparation plan's `frame.tick` substitution and phase 3 making that tick the local one), plus `tick-time.test.ts` which is what keeps it true. N31: Task 5 audits rules 1 and 3 against the live table and names `thunderclap` without editing it; rule 2 is already structurally true and is stated as such; rule 4 is Task 3's `revealedManeuver`, which is also the rendering spec's R18a seen from the sim side. §6.12: the ghost-never-confirmed row is implemented and tested; every other row is phase 3's or phase 5's. §7: Task 6's N6 row reports the two metrics §7's acceptance table names for this phase, at the design point and at spec §7's 150 ms comparison run. §8 phase 4 and execution guide §5: the Acceptance table. §9: N21, N22, N23a, N25 and N31 each have a task.

**Placeholder scan.** Every new module — `sim/ram-events.ts`, `config/telegraph.ts`, `net/event-source.ts`, `match/fire-prediction.ts`, `match/event-feed.ts`, `match/hp-ease.ts`, `config/hud-feel.ts` — is printed in full, with no elision. Every edit to an existing file is either a named substitution table or a printed block with the statement it follows named. Every test file is real code with values computed from the live tables: `WEAPON_TABLE.thunderclap.speed`, `CAR_TABLE.mirage.weapons`, `weaponTicksOf("magmablast").cooldown`, `NET_CONFIG.ghostGraceTicks`, `DRIVE_CONFIG.carWidth`, `msToTicks(HUD_FEEL.hpFlashMs)`. The four figures quoted in prose — 96,000 u/s², 4,267 u/s², 240 u and 176 B — are each derived in the text from the table field they come from, and the telegraph test recomputes all four rather than pinning them as digits.

**Type consistency.** `RamContact` (Task 1) is what `ramContactsFrom` returns, what `WorldTickResult.rams` carries, what `matchEventsFor` reads, and what `WorldPredictor.lastRams` exposes — one shape, four consumers. `MatchEvent` (phase 2's, unchanged) is what `matchEventsFor` builds, what `SnapshotSourceCtx.events` carries, what `decodeSnapshot` returns, what `EventFeed` keys and queues, and what `RenderFrame.events` hands the renderers. `PredictedManeuver` (Task 2) is what `FireContext.startManeuver` takes and what `WorldPredictor.applyLocalManeuver` writes, field for field. `GhostInstance` extends `RenderInstance`, so `FirePrediction.ghosts` drops straight into `FrameInputs.ghosts` and into `RenderFrame.instances` with no adapter. `PredictedFire` (Task 3) is what `FrameInputs.fireOf` returns and is assembled from `FirePrediction.slotsAt` / `lastFiredSlotAt` / `pendingUntilTick` / `switchLockUntilTick`, one field each. `FireState` and `SlotState` are shared's own, rebuilt from `SnapshotCar.slots` whose `SnapshotSlot` shape the ledger fixes. `ManeuverReveal` is produced by `MatchClient.revealedManeuvers`, stored in one map, and consumed exactly once by `FrameInputs.revealOf`.

**Ledger concerns, recorded rather than worked around.** Four, all reported in the plan-writer's final message rather than changed unilaterally in the ledger: `WorldState.mode` is typed `GameMode` in the ledger but is the `"ffa" | "team"` sides string in phase 3's own `worldFrom` and in `resolveContacts`' signature; `CarState.team` is typed `number` but must be `0 | 1` for `RamCar`; `FirePrediction`'s ledger constructor cannot reach an arena or a world, which `attach` solves additively; and `RenderOffsets` had no way to avoid counting an instance handover as a car snap, which the optional third constructor argument solves additively. The `ContactEvent` caveat is still accurate and now has an answer to point at.
