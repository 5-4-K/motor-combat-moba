# Netcode Phase 2: Wire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the match hot path off `@colyseus/schema` and put it on one hand-packed, delta-compressed binary snapshot per tick plus a 6-byte binary input, with car indices instead of session ids, a protocol hash that refuses a mismatched build at join, and a `MatchTransport` seam so the WebSocket is one file rather than the architecture.

**Architecture:** `shared/net/codec.ts` owns the whole wire format: `QUANT`, one `encodeSnapshot`/`decodeSnapshot` pair whose delta is a per-group changed-field mask against the previous snapshot sent to that client, the 5-bit input packing, and the pong. The server rounds its own state to the quantised grid after every tick (N9), which is what makes an unchanged field bit-identical and therefore free in a delta — and what makes a client's resim reproduce the server exactly rather than sitting permanently a fraction of a quantum off. `SnapshotBroadcaster` holds one baseline per client and encodes per client inside the tick, replacing the `broadcastPatch()` call N1 left in each room's `wake()`. The Colyseus schema keeps lobby and flow only (N24): the sim fields stay on `PlayerState` as **plain properties** — the server pipeline is untouched — they simply stop being `@type`-decorated, and `ArenaState.weapons` is deleted outright because the live instances already live in server-only `CombatMemory`. On the client `ArenaNet` gains `seed(roster, first)` and `onSnapshot(bytes, nowMs)`, and `frame-builder.ts` is fed a merged view of the lobby schema and the newest decoded snapshot instead of the schema alone.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `DataView`/`Uint8Array` hand-packing, Vitest (node environment) in every package, `node --test` for `scripts/*.test.mjs`, Colyseus 0.15.57 server (`client.sendBytes`, protocol code `ROOM_DATA_BYTES`) and colyseus.js 0.15.28 client (`room.sendBytes`, binary payloads delivered to `room.onMessage`), `tsx` for the harnesses.

**Spec:** [`../../specs/2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) — §6.3 in full (N9, N10, N10a, N11, N12), §6.9 N24, §6.12, §6.13, §7, §8 phase 2 row, §9; re-read §6.1 N1 and §6.2 for the seams phase 1 left. Ledger: [`interfaces.md`](interfaces.md). Prior plans, all landed and consumed by name, never re-specified: [`01-prep-arena-scene-split-and-render-frame.md`](01-prep-arena-scene-split-and-render-frame.md) (`RenderFrame`, `frame-builder.ts`, `match/arena-net.ts`, the `scenes/arena/` renderers, the composer `ArenaScene`), [`10-netcode-0-instrumentation.md`](10-netcode-0-instrumentation.md) (`InputFrame`, `NEUTRAL_INPUT`, `ClockSync`, `NetStats`, `PoseHistory`, `bindPing`, `InputLog`, `worldHash`/`contactSet`/`HASH_QUANT`, `playtest/netcode.ts`, `scripts/differ-replay.mjs`, the netgraph overlay), [`11-netcode-1-time.md`](11-netcode-1-time.md) (60 Hz `TICK_RATE_HZ`, `TickScheduler`, `InputRing`/`RingRead`/`AcceptResult`, `InputMessage { tick }`, `LeadController`, `TickLoop`, `PlayerState.ackTick`/`slackTicks`, `setPatchRate(0)` + `broadcastPatch` inside the tick, the N1 `NET_CONFIG` keys).

## Global Constraints

- Rebuild shared before testing (`npm run build -w @motor-combat-moba/shared`); tests import `src` but consume shared's built `dist`.
- Verify with root `npm test`, never a per-workspace run alone; then root `npm run typecheck` and root `npm run build`.
- `.js` import specifiers on every local import; shared is imported as `@motor-combat-moba/shared` from server and client `src`, and by deep `dist` path only from `scripts/*.mjs`.
- Nothing under `packages/client/src/match/` imports Phaser and no test imports Phaser.
- Do not touch `packages/server/playtest/` except to fix a compile break, and say loudly in the task's commit step which probe numbers your change moves. This plan fixes two compile breaks there (`playtest/netcode.ts`, `playtest/weapons.ts`) and changes exactly one printed number, named in Task 6.
- Do not edit `docs/ideas/` or `docs/invariants/`.
- Commit after every task on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch off it).
- No magic numbers in logic: every wire width, mask bit and quantisation scale is a named constant in `net/codec.ts` with a comment; nothing outside that file may hard-code a byte offset.
- **No balance table, drive constant, weapon row, status row, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `AIM_CONFIG.lockRange` or `ARENA_WIDTH` is edited by this plan.** `npm run build:manual` and `docs/turn-tuning.md` are therefore not owed an update by any task here; if you find yourself changing one of those tables, you have left this plan's scope.
- The wire format is a **protocol break**. `PROTOCOL_VERSION` is 1 and the hash covers it; the "never renumber" rule (invariant 7) still holds for every enum and every schema field that survives N24.

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/net/events.ts` (create) | `MatchEvent` — moved from client `match/render-frame.ts`, unchanged |
| `packages/shared/src/net/roster.ts` (create) | `MSG_ROSTER`, `RosterEntry`, `RosterMessage`, `isRosterMessage`, `Roster` |
| `packages/shared/src/net/codec.ts` (create) | `PROTOCOL_VERSION`, `QUANT`, the byte layout, `quantizeBody`, `encode`/`decodeSnapshot`, `encode`/`decodeInput`, `encode`/`decodePong`, `instanceId`, `MSG_SNAPSHOT` |
| `packages/shared/src/net/protocol-hash.ts` (create) | `protocolHash()`, `protocolHashInput()` |
| `packages/shared/src/sim/world-hash.ts` (modify) | `HASH_QUANT` becomes a re-export of `QUANT`; speed quantised by `speedPerUnit` |
| `packages/shared/src/schema/PlayerState.ts` (modify) | every sim field loses its `@type` and stays a plain property; `carIndex` added |
| `packages/shared/src/schema/ArenaState.ts` (modify) | `weapons` deleted |
| `packages/shared/src/index.ts` (modify) | export the four new modules |
| `packages/server/src/net/snapshot-source.ts` (create) | `ShotSeqTable`, `buildSnapshot`, `adoptQuantisedState` |
| `packages/server/src/net/snapshot-broadcaster.ts` (create) | `SnapshotBroadcaster`: per-client baseline, `afterTick`, `sendFull` |
| `packages/server/src/net/input-message.ts` (modify) | `decodeInputMessages(bytes)` replaces `isInputMessage` |
| `packages/server/src/rooms/ping-handler.ts` (modify) | pong goes out as bytes |
| `packages/server/src/rooms/{ArenaRoom,PracticeRoom,PlaygroundRoom}.ts` (modify) | car indices, roster message, protocol check, broadcaster in place of `broadcastPatch` |
| `packages/server/src/sim/combat-bridge.ts` (modify) | the `state.weapons` projection deleted; `clearInstances(memory)` |
| `packages/server/src/rooms/tick-pipeline.ts` (modify) | the `clearInstances` call site |
| `packages/client/src/match/transport.ts` (create) | `MatchTransport`, `ColyseusTransport`, `LoopbackTransport` |
| `packages/client/src/match/snapshot-view.ts` (create) | `SnapshotView`: lobby schema + newest snapshot → a `FrameSource` and a `ContextState` |
| `packages/client/src/match/frame-builder.ts` (modify) | reads `FramePlayer`/`FrameInstance` rather than schema classes |
| `packages/client/src/match/render-frame.ts` (modify) | re-exports `MatchEvent` from shared |
| `packages/client/src/match/arena-net.ts` (modify) | `seed(roster, first)`, `onSnapshot(bytes, nowMs)`, frames off the view |
| `packages/client/src/net/connection.ts` (modify) | `protocolHash` rides in the join options |
| `packages/client/src/scenes/arena-mismatch.ts` (modify) | `protocolMismatchMessage` replaces `arenaMismatchMessage` |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | transport wiring, roster, the refusal screen |
| `packages/client/src/dev/playground/overlay.ts` (modify) | the settings re-seed stops reading slot rows off the schema |
| `scripts/tick-rate-override.test.mjs` (create) | the env override stays deleted |
| `docs/schema-reference.md`, `docs/networking.md`, `docs/config-reference.md`, `docs/project-structure.md`, `docs/glossary.md`, root and package `CLAUDE.md` (modify) | the split, the wire, the hash |

---

### Task 1: `QUANT`, the snapshot codec, and the byte layout

**Files:**
- Create: `packages/shared/src/net/events.ts`, `packages/shared/src/net/roster.ts`, `packages/shared/src/net/codec.ts`
- Modify: `packages/shared/src/sim/world-hash.ts:31-33, 55-70`, `packages/shared/src/index.ts` (append)
- Test: `packages/shared/src/net/codec.test.ts`, `packages/shared/src/net/roster.test.ts`, `packages/shared/src/sim/world-hash.test.ts` (append one describe)

**Interfaces:**
- Consumes: `SimBody` (`sim/step.ts`), `InputFrame` (`net/input.ts`), `PongMessage` (`net/ping.ts`), `WEAPON_TABLE`, `STATUS_TABLE`.
- Produces: everything the ledger lists for `net/codec.ts`, `net/roster.ts` and `net/events.ts`, plus `MSG_SNAPSHOT`, `ANG_VEL_SCALE`, `AUTHORITY_STEPS`, `isRosterMessage`, `Snapshot.lateInput`, `SnapshotCar.level`, `SnapshotCar.diedAtTick`. Tasks 2–6 consume all of it.

#### The byte layout

Every multi-byte field is **big-endian** (`DataView`'s default). Ticks written relative to the header
tick are `i16`; `-32768` is the sentinel for "none" on the four fields where `0` means none
(`diedAtTick`, `pendingUntilTick`, `switchLockUntilTick`, and a slot's two clocks), so a real
relative tick clamps to `[-32767, 32767]`.

```
Header (10 B, always present)
  u8   flags        bit0 full · bit1 lateInput (the server dropped ≥1 late input from this
                    client since the previous snapshot — this is where NetStats.lateInputs comes from)
  u32  tick
  u32  ackTick      last input tick used for THIS client
  i8   slackTicks   ticks early that input arrived; negative = repeat or neutral

Cars
  u8   count
  per car:
    u8   index
    u16  mask       DELTA ONLY — omitted when flags.full, where every group is present
    group 0  pose      u16 x · u16 y · u16 angle                                    6 B
    group 1  motion    i16 speed · u8 reverseHold                                   3 B
    group 2  knock     i16 angVel · i16 shoveX · i16 shoveY · u8 authority          7 B
    group 3  maneuver  u8 kind · u16 ticksLeft · u16 angle · u16 speed              7 B
    group 4  vitals    u16 hp · u8 flags (bit0 alive, bit1 onField, bit2 phased)
                       · i16 diedAt · u8 level                                      6 B
    group 5  lastInput u8 (steer 2 bits · throttle 2 bits · fire 3 bits)            1 B
    group 6  lock      u8 lockTargetIndex + 1 (0 = none)                            1 B
    group 7  shot      u16 shotSeq                                                  2 B
    group 8  fire      i16 pendingUntil · i16 switchLock · i8 lastFiredSlot         5 B
    group 9  slots     u8 count, per slot: u8 weapon · u8 stocks
                       · i16 rechargeEnds · i16 refireLock              1 + 6n (19 B at n=3)
    group 10 statuses  u8 count, per status: u8 id · i16 startTick
                       · i16 endsTick · u8 sourceIndex + 1              1 + 6n (1 B at n=0)
                                                             full car, 3 slots, 0 statuses: 59 B

Instances
  u8   count
  per instance:
    u8   ownerIndex
    u16  shotSeq                  (owner, shotSeq) is the instance's identity and its delta key
    u8   mask       DELTA ONLY
    group 0  identity  u8 weapon · u8 homingTargetIndex + 1                         2 B
    group 1  pose      u16 x · u16 y · u16 angle                                    6 B
    group 2  extent    u16 extent                                                   2 B
    group 3  flags     u8 (bit0 alive, bit1 isExplosion, bit2 kind: 0 projectile, 1 beam)  1 B
                                                                       full instance: 14 B

Events
  u8   count
  per event: u8 kind · i8 tick − header tick (clamped) · payload
    hit      u8 attacker · u8 victim · u8 weapon · u16 x · u16 y · u16 damage       11 B
    kill     u8 killer · u8 victim                                                   4 B
    ram      u8 attacker · u8 victim · u16 x · u16 y · u8 severity (×255)           10 B
    slam     u8 car · u16 x · u16 y                                                  7 B
    respawn  u8 car                                                                  3 B
    refused  u8 car · u8 slot                                                        4 B
```

A car index of `255` in an event payload means "a session id the roster does not know", and decodes
back to `""`.

#### The budget, computed

`ARENA_01` is 1280 × 720 and `arena-02` is registered beside it, so `x` and `y` at 1/16 u fit a
`u16` with room to 4095 units. `wildcharge` opens a **10 000 ms** window, which at 60 Hz is **600
ticks** — that is why `maneuverTicksLeft` is a `u16` here and not the `u8` the spec's sketch drew.
Bastion's hp is `90 × COMBAT_CONFIG.hpPerRating` = 900, so hp is a `u16`. `thunderclap` dashes at
1600 u/s, so `maneuverSpeed` at 1/16 u/s needs 25 600 — a `u16`, and `speed`/`shoveX`/`shoveY` at the
same scale need `i16` (±2047.9 u/s covers the 520 u/s wall-slam knock with room to spare). `angVel`
reaches `RAM_CONFIG.spinMaxRate` radians per second, which is not a distance, so it gets its own
scale: `ANG_VEL_SCALE` 1024 gives ±32 rad/s at 0.001 rad/s. `authority` is bounded by `[0, 1]`, so
one byte at 1/255 is 0.004 of steering effectiveness.

| Case | Arithmetic | Bytes |
|---|---|---|
| **Full**, 6 cars (3 slots, 1 status each), 20 instances | `10 + 1 + 6 × 65 + 1 + 20 × 14 + 1` | **683** |
| Full, 6 cars (3 slots, no statuses), 20 instances | `10 + 1 + 6 × 59 + 1 + 20 × 14 + 1` | 647 |
| Full, a live 6-car match (1 status each, 8 instances) | `10 + 1 + 390 + 1 + 112 + 1` | 515 |
| **Delta, steady state** — 6 cars moving, 4 instances in flight | `10 + 1 + 6 × 12 + 1 + 4 × 10 + 1` | **125** |
| Delta, contact + volley — 6 cars with knock, vitals, fire and shot changing, 12 instances, one hit event | `10 + 1 + 6 × 32 + 1 + 12 × 10 + 1 + 11` | 336 |
| Delta, an idle lobby — nothing changed on any car | `10 + 1 + 6 × 3 + 1 + 1` | 31 |

A delta car that is merely driving carries `1 index + 2 mask + 6 pose + 3 motion` = 12 B; a delta car
in contact adds `7 knock + 6 vitals + 2 shot + 5 fire` = 32 B. A delta instance carries
`1 + 2 + 1 mask + 6 pose` = 10 B, because a projectile's extent is 0 for its whole life and its
identity and flags never change. Both acceptance lines — full ≤ 700 B, delta steady state ≤ 350 B —
hold by construction, and Step 4's tests pin the three bolded numbers exactly so a layout change
cannot drift past them unnoticed.

**Why the delta may compare raw floats.** The mask is computed with `!==` on the un-quantised
numbers. That is only sound because the server adopts its own quantised state every tick (Task 4,
N9): a field that did not change is bit-identical, not merely close. Without the adopt rule this
comparison would send every field every tick and the delta would save nothing.

- [ ] **Step 1: Write the failing codec test**

```ts
// packages/shared/src/net/codec.test.ts
import { describe, expect, it } from "vitest";
import { NEUTRAL_INPUT, type InputFrame } from "./input.js";
import type { MatchEvent } from "./events.js";
import { Roster } from "./roster.js";
import {
  QUANT, decodeInput, decodePong, decodeSnapshot, encodeInput, encodePong, encodeSnapshot,
  instanceId, quantizeBody, type Snapshot, type SnapshotCar, type SnapshotInstance,
} from "./codec.js";
import type { SimBody } from "../sim/step.js";

const ROSTER = new Roster([{ index: 0, sessionId: "aaa" }, { index: 1, sessionId: "bbb" }]);

const body = (x: number, y = 360): SimBody => ({
  x, y, angle: 1.25, speed: 233.5, reverseHold: 0, angVel: 0.5, shoveX: -12.25, shoveY: 3,
  authority: 0.6, maneuver: 1, maneuverTicksLeft: 600, maneuverAngle: 2.5, maneuverSpeed: 1600,
});

const car = (index: number, x: number, statuses = 1): SnapshotCar => ({
  index, body: quantizeBody(body(x)), hp: 900, alive: true, onField: true, phased: false,
  lastInput: { steer: -1, throttle: 1, fireSlots: 5 }, lockTargetIndex: index === 0 ? 1 : -1,
  shotSeq: 40000, pendingUntilTick: 1010, switchLockUntilTick: 0, lastFiredSlot: 2,
  level: 3, diedAtTick: 0,
  slots: [
    { weaponId: "predator", stocks: 2, rechargeEndsTick: 1100, refireLockUntilTick: 0 },
    { weaponId: "pepperbox", stocks: 0, rechargeEndsTick: 0, refireLockUntilTick: 1002 },
    { weaponId: "lance", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 },
  ],
  statuses: Array.from({ length: statuses }, () => ({
    statusId: "spiked", startTick: 990, endsTick: 1050, sourceIndex: 1,
  })),
});

const instance = (owner: number, shotSeq: number): SnapshotInstance => ({
  ownerIndex: owner, shotSeq, weaponId: "predator", kind: 0,
  x: 700.25, y: 240.5, angle: 3, extent: 0, alive: true, isExplosion: false, homingTargetIndex: 1,
});

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  tick: 1000, full: true, lateInput: false, ackTick: 998, slackTicks: 2,
  cars: [car(0, 300), car(1, 900)], instances: [instance(0, 7)], events: [], ...over,
});

describe("encodeSnapshot / decodeSnapshot", () => {
  it("round-trips a full snapshot field for field", () => {
    const snap = snapshot();
    const decoded = decodeSnapshot(encodeSnapshot(snap, undefined, ROSTER), undefined, ROSTER);
    expect(decoded.full).toBe(true);
    expect(decoded.tick).toBe(1000);
    expect(decoded.ackTick).toBe(998);
    expect(decoded.slackTicks).toBe(2);
    expect(decoded.cars).toEqual(snap.cars);
    expect(decoded.instances).toEqual(snap.instances);
  });

  it("carries a negative slack and the late-input flag", () => {
    const decoded = decodeSnapshot(
      encodeSnapshot(snapshot({ slackTicks: -4, lateInput: true }), undefined, ROSTER), undefined, ROSTER);
    expect(decoded.slackTicks).toBe(-4);
    expect(decoded.lateInput).toBe(true);
  });

  it("sends only what changed, and the decoder fills the rest from the baseline", () => {
    const first = snapshot();
    const moved = { ...car(0, 300), body: quantizeBody(body(340)) };
    const second: Snapshot = { ...first, tick: 1001, full: false, cars: [moved, first.cars[1]!] };
    const decoded = decodeSnapshot(encodeSnapshot(second, first, ROSTER), first, ROSTER);
    expect(decoded.full).toBe(false);
    expect(decoded.cars[0]!.body.x).toBeCloseTo(340, 5);
    expect(decoded.cars[0]!.slots).toEqual(first.cars[0]!.slots);
    expect(decoded.cars[1]).toEqual(first.cars[1]);
  });

  it("drops a car and an instance that are absent from the newer snapshot", () => {
    const first = snapshot();
    const second: Snapshot = { ...first, tick: 1001, full: false, cars: [first.cars[0]!], instances: [] };
    const decoded = decodeSnapshot(encodeSnapshot(second, first, ROSTER), first, ROSTER);
    expect(decoded.cars.map((c) => c.index)).toEqual([0]);
    expect(decoded.instances).toEqual([]);
  });

  it("sends a car that is new in a delta in full", () => {
    const first: Snapshot = { ...snapshot(), cars: [car(0, 300)] };
    const second: Snapshot = { ...first, tick: 1001, full: false, cars: [car(0, 300), car(1, 900)] };
    const decoded = decodeSnapshot(encodeSnapshot(second, first, ROSTER), first, ROSTER);
    expect(decoded.cars[1]).toEqual(second.cars[1]);
  });

  it("refuses a delta with no baseline rather than decoding garbage", () => {
    const first = snapshot();
    const bytes = encodeSnapshot({ ...first, tick: 1001, full: false }, first, ROSTER);
    expect(() => decodeSnapshot(bytes, undefined, ROSTER)).toThrow(/baseline/);
  });

  it("round-trips every event kind through car indices", () => {
    const events: MatchEvent[] = [
      { kind: "hit", tick: 999, attacker: "aaa", victim: "bbb", weaponId: "predator", x: 100.5, y: 200.25, damage: 62 },
      { kind: "kill", tick: 1000, killer: "aaa", victim: "bbb" },
      { kind: "ram", tick: 1000, attacker: "bbb", victim: "aaa", x: 12.5, y: 13, severity: 0.6 },
      { kind: "slam", tick: 1000, car: "aaa", x: 5, y: 6 },
      { kind: "respawn", tick: 1000, car: "bbb" },
      { kind: "refused", tick: 1000, car: "aaa", slot: 2 },
    ];
    const decoded = decodeSnapshot(encodeSnapshot(snapshot({ events }), undefined, ROSTER), undefined, ROSTER);
    expect(decoded.events).toHaveLength(6);
    expect(decoded.events[0]).toMatchObject({ kind: "hit", tick: 999, attacker: "aaa", victim: "bbb", damage: 62 });
    expect((decoded.events[2] as { severity: number }).severity).toBeCloseTo(0.6, 2);
    expect(decoded.events[5]).toEqual({ kind: "refused", tick: 1000, car: "aaa", slot: 2 });
  });
});

describe("quantisation", () => {
  it("is idempotent, so what the server adopts survives the round trip unchanged", () => {
    const once = quantizeBody(body(300.031, 359.99));
    expect(quantizeBody(once)).toEqual(once);
    const decoded = decodeSnapshot(
      encodeSnapshot(snapshot({ cars: [{ ...car(0, 0), body: once }] }), undefined, ROSTER), undefined, ROSTER);
    expect(decoded.cars[0]!.body).toEqual(once);
  });

  it("holds position to half a quantum, angle to pi/32768, and wraps angle into [0, 2pi)", () => {
    const raw = body(300.031, 359.99);
    const q = quantizeBody(raw);
    expect(Math.abs(q.x - raw.x)).toBeLessThanOrEqual(1 / (2 * QUANT.posPerUnit));
    expect(Math.abs(q.y - raw.y)).toBeLessThanOrEqual(1 / (2 * QUANT.posPerUnit));
    expect(Math.abs(q.angle - raw.angle)).toBeLessThanOrEqual(Math.PI / QUANT.angleSteps);
    expect(quantizeBody({ ...raw, angle: -0.5 }).angle).toBeCloseTo(Math.PI * 2 - 0.5, 3);
    expect(quantizeBody({ ...raw, angle: Math.PI * 20.5 }).angle).toBeLessThan(Math.PI * 2);
  });
});

describe("byte budget (spec section 8, phase 2 acceptance)", () => {
  const sixCars = Array.from({ length: 6 }, (_, i) => car(i, 200 + i * 100));
  const twentyShots = Array.from({ length: 20 }, (_, i) => instance(i % 6, i));

  it("encodes a full 6-car, 20-instance snapshot in 683 bytes (limit 700)", () => {
    const bytes = encodeSnapshot(snapshot({ cars: sixCars, instances: twentyShots }), undefined, ROSTER);
    expect(bytes.length).toBe(683);
    expect(bytes.length).toBeLessThanOrEqual(700);
  });

  it("encodes a steady-state delta in 125 bytes (limit 350)", () => {
    const first = snapshot({ cars: sixCars, instances: twentyShots.slice(0, 4) });
    const cars = sixCars.map((c) => ({ ...c, body: quantizeBody({ ...c.body, x: c.body.x + 7.5, speed: 240 }) }));
    const instances = first.instances.map((i) => ({ ...i, x: i.x + 30, y: i.y + 2, angle: i.angle + 0.01 }));
    expect(encodeSnapshot({ ...first, tick: 1001, full: false, cars, instances }, first, ROSTER).length).toBe(125);
  });

  it("encodes a contact-and-volley delta in 336 bytes (limit 350)", () => {
    const first = snapshot({ cars: sixCars, instances: twentyShots.slice(0, 12) });
    const cars = sixCars.map((c) => ({
      ...c,
      body: quantizeBody({ ...c.body, x: c.body.x + 7.5, speed: 240, angVel: 2, shoveX: 100, shoveY: 20, authority: 0.35 }),
      hp: 800, shotSeq: c.shotSeq + 1, pendingUntilTick: 1006, lastFiredSlot: 1,
    }));
    const instances = first.instances.map((i) => ({ ...i, x: i.x + 30, y: i.y + 2, angle: i.angle + 0.01 }));
    const events: MatchEvent[] = [
      { kind: "hit", tick: 1001, attacker: "aaa", victim: "bbb", weaponId: "predator", x: 1, y: 2, damage: 62 },
    ];
    expect(encodeSnapshot({ ...first, tick: 1001, full: false, cars, instances, events }, first, ROSTER).length).toBe(336);
  });

  it("encodes an idle 6-car snapshot in 31 bytes", () => {
    const first = snapshot({ cars: sixCars, instances: [] });
    expect(encodeSnapshot({ ...first, tick: 1001, full: false }, first, ROSTER).length).toBe(31);
  });
});

describe("input and pong codecs", () => {
  it("round-trips one input in six bytes", () => {
    const frame: InputFrame = { steer: -1, throttle: 1, fireSlots: 5 };
    const bytes = encodeInput(4321, [frame]);
    expect(bytes.length).toBe(6);
    expect(decodeInput(bytes)).toEqual({ tick: 4321, inputs: [frame] });
  });

  it("round-trips a redundant run, oldest first, for ticks tick-count+1 through tick", () => {
    const run: InputFrame[] = [NEUTRAL_INPUT, { steer: 1, throttle: -1, fireSlots: 0 }, { steer: 0, throttle: 1, fireSlots: 7 }];
    expect(decodeInput(encodeInput(100, run))).toEqual({ tick: 100, inputs: run });
  });

  it("keeps only the three slot bits, so a flooded mask cannot smuggle anything", () => {
    expect(decodeInput(encodeInput(1, [{ steer: 0, throttle: 0, fireSlots: 0xff }])).inputs[0]!.fireSlots).toBe(7);
  });

  it("round-trips a pong in sixteen bytes", () => {
    const bytes = encodePong({ clientMs: 1234.5678, serverTick: 90000, msIntoTick: 12.5 });
    expect(bytes.length).toBe(16);
    const back = decodePong(bytes);
    expect(back.clientMs).toBe(1234.5678);
    expect(back.serverTick).toBe(90000);
    expect(back.msIntoTick).toBeCloseTo(12.5, 3);
  });

  it("names an instance by owner and shot sequence, so a client can predict the id", () => {
    expect(instanceId(3, 12)).toBe("3-12");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/shared && npx vitest run src/net/codec.test.ts`
Expected: FAIL — cannot resolve `./codec.js`.

- [ ] **Step 3: Write the three modules**

`packages/shared/src/net/events.ts` is the `MatchEvent` union **moved verbatim** from the client's
`match/render-frame.ts` (the preparation plan's Task 1 printed it; do not retype it from memory —
cut it from that file), under this header:

```ts
/**
 * Reliable game events (netcode spec N23a). They live in shared because the codec carries them: the
 * client's feedback layer consumes exactly this list, so the spark lands at the server's contact
 * point on the server's tick. Car fields are **session ids** here; the codec maps them to car
 * indices on the wire and back through the roster, so nothing above the codec knows an index
 * exists. Events are idempotent per `(tick, kind, cars)`, so a resend after a reconnect is harmless.
 */
```

```ts
// packages/shared/src/net/roster.ts
/**
 * Who is car index 0..5 (netcode spec N9). A session id is an 8-character string; a car index is
 * one byte, and every per-tick reference on the wire — the car, a lock target, a homing target, an
 * event's attacker — is an index. The mapping is published on a reliable message once per
 * membership change rather than repeated 60 times a second.
 */
export const MSG_ROSTER = "roster";

/** Close reason 4004 at join (N11); 4000-4003 are the name, name-taken, kick and room-full codes. */
export const PROTOCOL_MISMATCH_ERROR = "This build does not match the server's.";

export interface RosterEntry {
  index: number;
  sessionId: string;
}

export interface RosterMessage {
  /** `protocolHash()` on the server's build; the client refuses a mismatch (N11). */
  protocolHash: string;
  /** `NET_CONFIG.snapshotEvery` in force on this server. */
  snapshotEvery: number;
  cars: RosterEntry[];
}

export function isRosterMessage(value: unknown): value is RosterMessage {
  if (typeof value !== "object" || value === null) return false;
  const msg = value as Partial<RosterMessage>;
  if (typeof msg.protocolHash !== "string") return false;
  if (typeof msg.snapshotEvery !== "number" || !Number.isFinite(msg.snapshotEvery)) return false;
  if (!Array.isArray(msg.cars)) return false;
  return msg.cars.every(
    (entry) =>
      typeof entry === "object" && entry !== null &&
      typeof (entry as RosterEntry).index === "number" &&
      typeof (entry as RosterEntry).sessionId === "string",
  );
}

export class Roster {
  private readonly byIndex: string[] = [];
  private readonly byId = new Map<string, number>();

  constructor(entries: readonly RosterEntry[]) {
    for (const entry of entries) {
      this.byIndex[entry.index] = entry.sessionId;
      this.byId.set(entry.sessionId, entry.index);
    }
  }

  /** -1 for a session id this roster does not carry. */
  indexOf(sessionId: string): number {
    return this.byId.get(sessionId) ?? -1;
  }

  /** `""` for an index this roster does not carry. */
  sessionIdOf(index: number): string {
    return this.byIndex[index] ?? "";
  }

  get size(): number {
    return this.byId.size;
  }
}
```

```ts
// packages/shared/src/net/codec.ts
/**
 * The wire (netcode spec N9-N11). One hand-packed binary snapshot per tick, delta-compressed
 * against the previous snapshot sent to that client, plus the 6-byte input and the 16-byte pong.
 *
 * The byte layout is the table in this file's implementation plan and that table is the authority:
 * nothing outside this file may know an offset, a width or a mask bit. Every multi-byte field is
 * big-endian, which is `DataView`'s default and needs no argument at any call site.
 *
 * **The server adopts its own quantised state** (N9) through `quantizeBody`, so an unchanged field
 * is bit-identical rather than merely close — which is what lets the delta mask compare with `!==`,
 * and what makes a client's resim from a snapshot reproduce the server rather than sit permanently
 * a fraction of a quantum off it.
 */
import { STATUS_TABLE } from "../config/status-config.js";
import type { StatusId } from "../config/status-types.js";
import { WEAPON_TABLE } from "../config/weapon-config.js";
import type { WeaponId } from "../config/weapon-types.js";
import type { SimBody } from "../sim/step.js";
import type { MatchEvent } from "./events.js";
import type { InputFrame } from "./input.js";
import type { PongMessage } from "./ping.js";
import type { Roster } from "./roster.js";

/** Bumped on any layout change. Part of `protocolHash`, so a bump refuses a stale client at join. */
export const PROTOCOL_VERSION = 1;

/**
 * 1/16 of a unit rather than 1/8 because quantised positions are fed back into a collision solve,
 * not merely drawn, and a contact normal amplifies position error into a different push-out.
 */
export const QUANT = { posPerUnit: 16, angleSteps: 65536, speedPerUnit: 16 } as const;

/** `angVel` is radians per second, not units, so it needs its own scale: +/-32 rad/s at 0.001. */
export const ANG_VEL_SCALE = 1024;
/** `authority` is bounded by [0, 1]; one byte is 0.004 of steering effectiveness. */
export const AUTHORITY_STEPS = 255;

/**
 * The snapshot message type. One character on purpose: `sendBytes` encodes the type string into
 * every frame, so at 60 Hz to five clients a nine-character name would cost 2.7 KB/s of pure label.
 */
export const MSG_SNAPSHOT = "s";

const TWO_PI = Math.PI * 2;

const FLAG_FULL = 1 << 0;
const FLAG_LATE_INPUT = 1 << 1;

const CAR_POSE = 1 << 0;
const CAR_MOTION = 1 << 1;
const CAR_KNOCK = 1 << 2;
const CAR_MANEUVER = 1 << 3;
const CAR_VITALS = 1 << 4;
const CAR_LAST_INPUT = 1 << 5;
const CAR_LOCK = 1 << 6;
const CAR_SHOT = 1 << 7;
const CAR_FIRE = 1 << 8;
const CAR_SLOTS = 1 << 9;
const CAR_STATUSES = 1 << 10;
const CAR_ALL = (1 << 11) - 1;

const CAR_FLAG_ALIVE = 1 << 0;
const CAR_FLAG_ON_FIELD = 1 << 1;
const CAR_FLAG_PHASED = 1 << 2;

const INS_IDENTITY = 1 << 0;
const INS_POSE = 1 << 1;
const INS_EXTENT = 1 << 2;
const INS_FLAGS = 1 << 3;
const INS_ALL = (1 << 4) - 1;

const INS_FLAG_ALIVE = 1 << 0;
const INS_FLAG_EXPLOSION = 1 << 1;
const INS_FLAG_BEAM = 1 << 2;

/** `0` means "none" on these clocks, so a relative tick cannot use 0 and the floor is reserved. */
const REL_NONE = -32768;
const REL_MIN = -32767;
const REL_MAX = 32767;

/** Table order is the wire order. `protocolHash` covers both tables, so the two sides cannot drift. */
const WEAPON_IDS = Object.keys(WEAPON_TABLE) as WeaponId[];
const STATUS_IDS = Object.keys(STATUS_TABLE) as StatusId[];
const NO_ID_INDEX = 255;
/** A car an event names but the roster does not carry (an owner who left mid-flight). */
const NO_CAR_INDEX = 255;

export interface SnapshotSlot {
  weaponId: string;
  stocks: number;
  rechargeEndsTick: number;
  refireLockUntilTick: number;
}

export interface SnapshotStatus {
  statusId: string;
  startTick: number;
  endsTick: number;
  /** Car index of whoever applied it; -1 = world. */
  sourceIndex: number;
}

export interface SnapshotCar {
  index: number;
  /** Quantised — whoever built this has already applied `quantizeBody`. */
  body: SimBody;
  hp: number;
  alive: boolean;
  onField: boolean;
  phased: boolean;
  lastInput: InputFrame;
  /** -1 = no lock. */
  lockTargetIndex: number;
  /** Shots this owner has spawned, mod 65536: what a predicted shot id counts from (N22). */
  shotSeq: number;
  pendingUntilTick: number;
  switchLockUntilTick: number;
  lastFiredSlot: number;
  /** Weapon level. Beyond the ledger's field list — the HUD reads it and nothing derives it. */
  level: number;
  /** The tick hp reached 0, or 0. Beyond the ledger's field list — the death fade reads it. */
  diedAtTick: number;
  slots: SnapshotSlot[];
  statuses: SnapshotStatus[];
}

export interface SnapshotInstance {
  ownerIndex: number;
  shotSeq: number;
  weaponId: string;
  /** `WeaponKind` value. */
  kind: number;
  x: number;
  y: number;
  angle: number;
  extent: number;
  alive: boolean;
  isExplosion: boolean;
  /** -1 = not homing, or homing at nobody. */
  homingTargetIndex: number;
}

export interface Snapshot {
  tick: number;
  /** true = every field present; false = a delta against the previous snapshot sent to this client. */
  full: boolean;
  /** The server dropped at least one late input from this client since the previous snapshot (N27). */
  lateInput: boolean;
  ackTick: number;
  slackTicks: number;
  cars: SnapshotCar[];
  instances: SnapshotInstance[];
  events: MatchEvent[];
}

/** The id a client can predict for its own next shot: owner index and per-owner sequence (N22). */
export function instanceId(ownerIndex: number, shotSeq: number): string {
  return `${ownerIndex}-${shotSeq}`;
}

/* ------------------------------------------------------------------ quantisation */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const qPos = (v: number): number => clamp(Math.round(v * QUANT.posPerUnit), 0, 65535);
const dPos = (q: number): number => q / QUANT.posPerUnit;
const qSpeed = (v: number): number => clamp(Math.round(v * QUANT.speedPerUnit), -32768, 32767);
const qSpeedU = (v: number): number => clamp(Math.round(v * QUANT.speedPerUnit), 0, 65535);
const dSpeed = (q: number): number => q / QUANT.speedPerUnit;
const qAngVel = (v: number): number => clamp(Math.round(v * ANG_VEL_SCALE), -32768, 32767);
const dAngVel = (q: number): number => q / ANG_VEL_SCALE;
const qAuth = (v: number): number => clamp(Math.round(v * AUTHORITY_STEPS), 0, 255);
const dAuth = (q: number): number => q / AUTHORITY_STEPS;

function qAngle(angle: number): number {
  const r = angle % TWO_PI;
  const wrapped = r < 0 ? r + TWO_PI : r;
  return Math.round((wrapped / TWO_PI) * QUANT.angleSteps) % QUANT.angleSteps;
}
const dAngle = (q: number): number => (q / QUANT.angleSteps) * TWO_PI;

/**
 * The server's own state, rounded onto the wire's grid (N9), with `angle` wrapped into `[0, 2pi)`
 * so it stops growing without bound over a long match. Pure: the caller writes the result back.
 */
export function quantizeBody(body: SimBody): SimBody {
  return {
    x: dPos(qPos(body.x)),
    y: dPos(qPos(body.y)),
    angle: dAngle(qAngle(body.angle)),
    speed: dSpeed(qSpeed(body.speed)),
    reverseHold: clamp(Math.round(body.reverseHold), 0, 255),
    angVel: dAngVel(qAngVel(body.angVel)),
    shoveX: dSpeed(qSpeed(body.shoveX)),
    shoveY: dSpeed(qSpeed(body.shoveY)),
    authority: dAuth(qAuth(body.authority)),
    maneuver: body.maneuver,
    maneuverTicksLeft: clamp(Math.round(body.maneuverTicksLeft), 0, 65535),
    maneuverAngle: dAngle(qAngle(body.maneuverAngle)),
    maneuverSpeed: dSpeed(qSpeedU(body.maneuverSpeed)),
  };
}

/** The two scalar quantisers the server needs to adopt a weapon instance, which has no `SimBody`. */
export const quantizePos = (v: number): number => dPos(qPos(v));
export const quantizeAngle = (a: number): number => dAngle(qAngle(a));

/** A tick where `0` means "none": the sentinel keeps that distinct from "the header tick itself". */
const relOptional = (t: number, now: number): number => (t === 0 ? REL_NONE : clamp(t - now, REL_MIN, REL_MAX));
const absOptional = (q: number, now: number): number => (q === REL_NONE ? 0 : now + q);
/** A tick that is always meaningful (a status's own clocks). */
const rel = (t: number, now: number): number => clamp(t - now, REL_MIN, REL_MAX);

const weaponIndex = (id: string): number => {
  const i = WEAPON_IDS.indexOf(id as WeaponId);
  return i < 0 ? NO_ID_INDEX : i;
};
const weaponIdAt = (i: number): string => WEAPON_IDS[i] ?? "";
const statusIndex = (id: string): number => {
  const i = STATUS_IDS.indexOf(id as StatusId);
  return i < 0 ? NO_ID_INDEX : i;
};
const statusIdAt = (i: number): string => STATUS_IDS[i] ?? "";

const packInput = (input: InputFrame): number =>
  ((input.steer + 1) & 0b11) | (((input.throttle + 1) & 0b11) << 2) | ((input.fireSlots & 0b111) << 4);

function unpackInput(byte: number): InputFrame {
  return {
    steer: ((byte & 0b11) - 1) as -1 | 0 | 1,
    throttle: (((byte >> 2) & 0b11) - 1) as -1 | 0 | 1,
    fireSlots: (byte >> 4) & 0b111,
  };
}

/* ------------------------------------------------------------------ byte plumbing */

class Writer {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  private at = 0;

  private room(n: number): void {
    if (this.at + n <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.at + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number): void { this.room(1); this.view.setUint8(this.at, v & 0xff); this.at += 1; }
  i8(v: number): void { this.room(1); this.view.setInt8(this.at, clamp(Math.round(v), -128, 127)); this.at += 1; }
  u16(v: number): void { this.room(2); this.view.setUint16(this.at, v & 0xffff); this.at += 2; }
  i16(v: number): void { this.room(2); this.view.setInt16(this.at, clamp(Math.round(v), -32768, 32767)); this.at += 2; }
  u32(v: number): void { this.room(4); this.view.setUint32(this.at, v >>> 0); this.at += 4; }
  f32(v: number): void { this.room(4); this.view.setFloat32(this.at, v); this.at += 4; }
  f64(v: number): void { this.room(8); this.view.setFloat64(this.at, v); this.at += 8; }

  bytes(): Uint8Array { return this.buf.slice(0, this.at); }
}

class Reader {
  private readonly view: DataView;
  private at = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private room(n: number): void {
    if (this.at + n > this.bytes.byteLength) throw new Error(`snapshot decode ran off the end at ${this.at}`);
  }

  u8(): number { this.room(1); const v = this.view.getUint8(this.at); this.at += 1; return v; }
  i8(): number { this.room(1); const v = this.view.getInt8(this.at); this.at += 1; return v; }
  u16(): number { this.room(2); const v = this.view.getUint16(this.at); this.at += 2; return v; }
  i16(): number { this.room(2); const v = this.view.getInt16(this.at); this.at += 2; return v; }
  u32(): number { this.room(4); const v = this.view.getUint32(this.at); this.at += 4; return v; }
  f32(): number { this.room(4); const v = this.view.getFloat32(this.at); this.at += 4; return v; }
  f64(): number { this.room(8); const v = this.view.getFloat64(this.at); this.at += 8; return v; }
}

/* ------------------------------------------------------------------ cars */

const sameSlots = (a: readonly SnapshotSlot[], b: readonly SnapshotSlot[]): boolean =>
  a.length === b.length &&
  a.every((s, i) => s.weaponId === b[i]!.weaponId && s.stocks === b[i]!.stocks &&
    s.rechargeEndsTick === b[i]!.rechargeEndsTick && s.refireLockUntilTick === b[i]!.refireLockUntilTick);

const sameStatuses = (a: readonly SnapshotStatus[], b: readonly SnapshotStatus[]): boolean =>
  a.length === b.length &&
  a.every((s, i) => s.statusId === b[i]!.statusId && s.startTick === b[i]!.startTick &&
    s.endsTick === b[i]!.endsTick && s.sourceIndex === b[i]!.sourceIndex);

function carMask(car: SnapshotCar, prev: SnapshotCar | undefined): number {
  if (!prev) return CAR_ALL;
  const a = car.body;
  const p = prev.body;
  let mask = 0;
  if (a.x !== p.x || a.y !== p.y || a.angle !== p.angle) mask |= CAR_POSE;
  if (a.speed !== p.speed || a.reverseHold !== p.reverseHold) mask |= CAR_MOTION;
  if (a.angVel !== p.angVel || a.shoveX !== p.shoveX || a.shoveY !== p.shoveY || a.authority !== p.authority) mask |= CAR_KNOCK;
  if (a.maneuver !== p.maneuver || a.maneuverTicksLeft !== p.maneuverTicksLeft ||
      a.maneuverAngle !== p.maneuverAngle || a.maneuverSpeed !== p.maneuverSpeed) mask |= CAR_MANEUVER;
  if (car.hp !== prev.hp || car.alive !== prev.alive || car.onField !== prev.onField ||
      car.phased !== prev.phased || car.diedAtTick !== prev.diedAtTick || car.level !== prev.level) mask |= CAR_VITALS;
  if (packInput(car.lastInput) !== packInput(prev.lastInput)) mask |= CAR_LAST_INPUT;
  if (car.lockTargetIndex !== prev.lockTargetIndex) mask |= CAR_LOCK;
  if (car.shotSeq !== prev.shotSeq) mask |= CAR_SHOT;
  if (car.pendingUntilTick !== prev.pendingUntilTick || car.switchLockUntilTick !== prev.switchLockUntilTick ||
      car.lastFiredSlot !== prev.lastFiredSlot) mask |= CAR_FIRE;
  if (!sameSlots(car.slots, prev.slots)) mask |= CAR_SLOTS;
  if (!sameStatuses(car.statuses, prev.statuses)) mask |= CAR_STATUSES;
  return mask;
}

function writeCar(w: Writer, car: SnapshotCar, mask: number, tick: number): void {
  const b = car.body;
  if (mask & CAR_POSE) { w.u16(qPos(b.x)); w.u16(qPos(b.y)); w.u16(qAngle(b.angle)); }
  if (mask & CAR_MOTION) { w.i16(qSpeed(b.speed)); w.u8(b.reverseHold); }
  if (mask & CAR_KNOCK) { w.i16(qAngVel(b.angVel)); w.i16(qSpeed(b.shoveX)); w.i16(qSpeed(b.shoveY)); w.u8(qAuth(b.authority)); }
  if (mask & CAR_MANEUVER) { w.u8(b.maneuver); w.u16(b.maneuverTicksLeft); w.u16(qAngle(b.maneuverAngle)); w.u16(qSpeedU(b.maneuverSpeed)); }
  if (mask & CAR_VITALS) {
    w.u16(clamp(Math.round(car.hp), 0, 65535));
    w.u8((car.alive ? CAR_FLAG_ALIVE : 0) | (car.onField ? CAR_FLAG_ON_FIELD : 0) | (car.phased ? CAR_FLAG_PHASED : 0));
    w.i16(relOptional(car.diedAtTick, tick));
    w.u8(car.level);
  }
  if (mask & CAR_LAST_INPUT) w.u8(packInput(car.lastInput));
  if (mask & CAR_LOCK) w.u8(car.lockTargetIndex + 1);
  if (mask & CAR_SHOT) w.u16(car.shotSeq);
  if (mask & CAR_FIRE) {
    w.i16(relOptional(car.pendingUntilTick, tick));
    w.i16(relOptional(car.switchLockUntilTick, tick));
    w.i8(car.lastFiredSlot);
  }
  if (mask & CAR_SLOTS) {
    w.u8(car.slots.length);
    for (const slot of car.slots) {
      w.u8(weaponIndex(slot.weaponId));
      w.u8(slot.stocks);
      w.i16(relOptional(slot.rechargeEndsTick, tick));
      w.i16(relOptional(slot.refireLockUntilTick, tick));
    }
  }
  if (mask & CAR_STATUSES) {
    w.u8(car.statuses.length);
    for (const row of car.statuses) {
      w.u8(statusIndex(row.statusId));
      w.i16(rel(row.startTick, tick));
      w.i16(rel(row.endsTick, tick));
      w.u8(row.sourceIndex + 1);
    }
  }
}

const EMPTY_CAR = (index: number): SnapshotCar => ({
  index,
  body: {
    x: 0, y: 0, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0,
    authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
  },
  hp: 0, alive: false, onField: false, phased: false,
  lastInput: { steer: 0, throttle: 0, fireSlots: 0 },
  lockTargetIndex: -1, shotSeq: 0, pendingUntilTick: 0, switchLockUntilTick: 0,
  lastFiredSlot: -1, level: 1, diedAtTick: 0, slots: [], statuses: [],
});

function readCar(r: Reader, index: number, mask: number, tick: number, prev: SnapshotCar | undefined): SnapshotCar {
  if (!prev && mask !== CAR_ALL) throw new Error(`delta for unknown car index ${index}`);
  const car: SnapshotCar = prev ? { ...prev, index, body: { ...prev.body } } : EMPTY_CAR(index);
  const b = car.body;
  if (mask & CAR_POSE) { b.x = dPos(r.u16()); b.y = dPos(r.u16()); b.angle = dAngle(r.u16()); }
  if (mask & CAR_MOTION) { b.speed = dSpeed(r.i16()); b.reverseHold = r.u8(); }
  if (mask & CAR_KNOCK) { b.angVel = dAngVel(r.i16()); b.shoveX = dSpeed(r.i16()); b.shoveY = dSpeed(r.i16()); b.authority = dAuth(r.u8()); }
  if (mask & CAR_MANEUVER) { b.maneuver = r.u8(); b.maneuverTicksLeft = r.u16(); b.maneuverAngle = dAngle(r.u16()); b.maneuverSpeed = dSpeed(r.u16()); }
  if (mask & CAR_VITALS) {
    car.hp = r.u16();
    const flags = r.u8();
    car.alive = (flags & CAR_FLAG_ALIVE) !== 0;
    car.onField = (flags & CAR_FLAG_ON_FIELD) !== 0;
    car.phased = (flags & CAR_FLAG_PHASED) !== 0;
    car.diedAtTick = absOptional(r.i16(), tick);
    car.level = r.u8();
  }
  if (mask & CAR_LAST_INPUT) car.lastInput = unpackInput(r.u8());
  if (mask & CAR_LOCK) car.lockTargetIndex = r.u8() - 1;
  if (mask & CAR_SHOT) car.shotSeq = r.u16();
  if (mask & CAR_FIRE) {
    car.pendingUntilTick = absOptional(r.i16(), tick);
    car.switchLockUntilTick = absOptional(r.i16(), tick);
    car.lastFiredSlot = r.i8();
  }
  if (mask & CAR_SLOTS) {
    const count = r.u8();
    const slots: SnapshotSlot[] = [];
    for (let i = 0; i < count; i++) {
      slots.push({
        weaponId: weaponIdAt(r.u8()),
        stocks: r.u8(),
        rechargeEndsTick: absOptional(r.i16(), tick),
        refireLockUntilTick: absOptional(r.i16(), tick),
      });
    }
    car.slots = slots;
  }
  if (mask & CAR_STATUSES) {
    const count = r.u8();
    const statuses: SnapshotStatus[] = [];
    for (let i = 0; i < count; i++) {
      statuses.push({
        statusId: statusIdAt(r.u8()),
        startTick: tick + r.i16(),
        endsTick: tick + r.i16(),
        sourceIndex: r.u8() - 1,
      });
    }
    car.statuses = statuses;
  }
  return car;
}

/* ------------------------------------------------------------------ instances */

function instanceMask(instance: SnapshotInstance, prev: SnapshotInstance | undefined): number {
  if (!prev) return INS_ALL;
  let mask = 0;
  if (instance.weaponId !== prev.weaponId || instance.homingTargetIndex !== prev.homingTargetIndex) mask |= INS_IDENTITY;
  if (instance.x !== prev.x || instance.y !== prev.y || instance.angle !== prev.angle) mask |= INS_POSE;
  if (instance.extent !== prev.extent) mask |= INS_EXTENT;
  if (instance.alive !== prev.alive || instance.isExplosion !== prev.isExplosion || instance.kind !== prev.kind) mask |= INS_FLAGS;
  return mask;
}

function writeInstance(w: Writer, instance: SnapshotInstance, mask: number): void {
  if (mask & INS_IDENTITY) { w.u8(weaponIndex(instance.weaponId)); w.u8(instance.homingTargetIndex + 1); }
  if (mask & INS_POSE) { w.u16(qPos(instance.x)); w.u16(qPos(instance.y)); w.u16(qAngle(instance.angle)); }
  if (mask & INS_EXTENT) w.u16(qPos(instance.extent));
  if (mask & INS_FLAGS) {
    w.u8((instance.alive ? INS_FLAG_ALIVE : 0) | (instance.isExplosion ? INS_FLAG_EXPLOSION : 0) |
      (instance.kind === 1 ? INS_FLAG_BEAM : 0));
  }
}

function readInstance(r: Reader, ownerIndex: number, shotSeq: number, mask: number, prev: SnapshotInstance | undefined): SnapshotInstance {
  if (!prev && mask !== INS_ALL) throw new Error(`delta for unknown instance ${instanceId(ownerIndex, shotSeq)}`);
  const instance: SnapshotInstance = prev
    ? { ...prev }
    : { ownerIndex, shotSeq, weaponId: "", kind: 0, x: 0, y: 0, angle: 0, extent: 0, alive: false, isExplosion: false, homingTargetIndex: -1 };
  if (mask & INS_IDENTITY) { instance.weaponId = weaponIdAt(r.u8()); instance.homingTargetIndex = r.u8() - 1; }
  if (mask & INS_POSE) { instance.x = dPos(r.u16()); instance.y = dPos(r.u16()); instance.angle = dAngle(r.u16()); }
  if (mask & INS_EXTENT) instance.extent = dPos(r.u16());
  if (mask & INS_FLAGS) {
    const flags = r.u8();
    instance.alive = (flags & INS_FLAG_ALIVE) !== 0;
    instance.isExplosion = (flags & INS_FLAG_EXPLOSION) !== 0;
    instance.kind = (flags & INS_FLAG_BEAM) !== 0 ? 1 : 0;
  }
  return instance;
}

/* ------------------------------------------------------------------ events */

const EVENT_KINDS = ["hit", "kill", "ram", "slam", "respawn", "refused"] as const;
const carByte = (roster: Roster, sessionId: string): number => {
  const index = roster.indexOf(sessionId);
  return index < 0 ? NO_CAR_INDEX : index;
};
const carFromByte = (roster: Roster, byte: number): string => (byte === NO_CAR_INDEX ? "" : roster.sessionIdOf(byte));

function writeEvents(w: Writer, events: readonly MatchEvent[], tick: number, roster: Roster): void {
  const list = events.slice(0, 255);
  w.u8(list.length);
  for (const event of list) {
    w.u8(EVENT_KINDS.indexOf(event.kind));
    w.i8(event.tick - tick);
    switch (event.kind) {
      case "hit":
        w.u8(carByte(roster, event.attacker)); w.u8(carByte(roster, event.victim));
        w.u8(weaponIndex(event.weaponId)); w.u16(qPos(event.x)); w.u16(qPos(event.y));
        w.u16(clamp(Math.round(event.damage), 0, 65535));
        break;
      case "kill":
        w.u8(carByte(roster, event.killer)); w.u8(carByte(roster, event.victim));
        break;
      case "ram":
        w.u8(carByte(roster, event.attacker)); w.u8(carByte(roster, event.victim));
        w.u16(qPos(event.x)); w.u16(qPos(event.y)); w.u8(clamp(Math.round(event.severity * 255), 0, 255));
        break;
      case "slam":
        w.u8(carByte(roster, event.car)); w.u16(qPos(event.x)); w.u16(qPos(event.y));
        break;
      case "respawn":
        w.u8(carByte(roster, event.car));
        break;
      case "refused":
        w.u8(carByte(roster, event.car)); w.u8(event.slot);
        break;
    }
  }
}

function readEvents(r: Reader, tick: number, roster: Roster): MatchEvent[] {
  const count = r.u8();
  const events: MatchEvent[] = [];
  for (let i = 0; i < count; i++) {
    const kind = EVENT_KINDS[r.u8()];
    const at = tick + r.i8();
    if (kind === undefined) throw new Error("unknown event kind on the wire");
    switch (kind) {
      case "hit":
        events.push({
          kind, tick: at, attacker: carFromByte(roster, r.u8()), victim: carFromByte(roster, r.u8()),
          weaponId: weaponIdAt(r.u8()), x: dPos(r.u16()), y: dPos(r.u16()), damage: r.u16(),
        });
        break;
      case "kill":
        events.push({ kind, tick: at, killer: carFromByte(roster, r.u8()), victim: carFromByte(roster, r.u8()) });
        break;
      case "ram":
        events.push({
          kind, tick: at, attacker: carFromByte(roster, r.u8()), victim: carFromByte(roster, r.u8()),
          x: dPos(r.u16()), y: dPos(r.u16()), severity: r.u8() / 255,
        });
        break;
      case "slam":
        events.push({ kind, tick: at, car: carFromByte(roster, r.u8()), x: dPos(r.u16()), y: dPos(r.u16()) });
        break;
      case "respawn":
        events.push({ kind, tick: at, car: carFromByte(roster, r.u8()) });
        break;
      case "refused":
        events.push({ kind, tick: at, car: carFromByte(roster, r.u8()), slot: r.u8() });
        break;
    }
  }
  return events;
}

/* ------------------------------------------------------------------ snapshot */

/**
 * `previous === undefined` encodes a full snapshot; anything else encodes a delta against it. The
 * caller's `snapshot.full` is not read — the baseline decides, and the flag byte is what the
 * decoder believes.
 *
 * Every live car and instance is listed on every snapshot, delta or not; only unchanged *fields*
 * are omitted. That is what makes removal free: a car or instance absent from the list is gone.
 */
export function encodeSnapshot(snapshot: Snapshot, previous: Snapshot | undefined, roster: Roster): Uint8Array {
  const full = previous === undefined;
  const w = new Writer();
  w.u8((full ? FLAG_FULL : 0) | (snapshot.lateInput ? FLAG_LATE_INPUT : 0));
  w.u32(snapshot.tick);
  w.u32(snapshot.ackTick);
  w.i8(snapshot.slackTicks);

  const prevCars = new Map<number, SnapshotCar>();
  if (previous) for (const car of previous.cars) prevCars.set(car.index, car);
  w.u8(snapshot.cars.length);
  for (const car of snapshot.cars) {
    w.u8(car.index);
    const mask = full ? CAR_ALL : carMask(car, prevCars.get(car.index));
    if (!full) w.u16(mask);
    writeCar(w, car, mask, snapshot.tick);
  }

  const prevInstances = new Map<string, SnapshotInstance>();
  if (previous) for (const i of previous.instances) prevInstances.set(instanceId(i.ownerIndex, i.shotSeq), i);
  w.u8(snapshot.instances.length);
  for (const instance of snapshot.instances) {
    w.u8(instance.ownerIndex);
    w.u16(instance.shotSeq);
    const mask = full ? INS_ALL : instanceMask(instance, prevInstances.get(instanceId(instance.ownerIndex, instance.shotSeq)));
    if (!full) w.u8(mask);
    writeInstance(w, instance, mask);
  }

  writeEvents(w, snapshot.events, snapshot.tick, roster);
  return w.bytes();
}

export function decodeSnapshot(bytes: Uint8Array, previous: Snapshot | undefined, roster: Roster): Snapshot {
  const r = new Reader(bytes);
  const flags = r.u8();
  const full = (flags & FLAG_FULL) !== 0;
  const tick = r.u32();
  const ackTick = r.u32();
  const slackTicks = r.i8();
  if (!full && previous === undefined) throw new Error("delta snapshot arrived with no baseline");

  const prevCars = new Map<number, SnapshotCar>();
  if (!full && previous) for (const car of previous.cars) prevCars.set(car.index, car);
  const carCount = r.u8();
  const cars: SnapshotCar[] = [];
  for (let i = 0; i < carCount; i++) {
    const index = r.u8();
    const mask = full ? CAR_ALL : r.u16();
    cars.push(readCar(r, index, mask, tick, prevCars.get(index)));
  }

  const prevInstances = new Map<string, SnapshotInstance>();
  if (!full && previous) for (const i of previous.instances) prevInstances.set(instanceId(i.ownerIndex, i.shotSeq), i);
  const instanceCount = r.u8();
  const instances: SnapshotInstance[] = [];
  for (let i = 0; i < instanceCount; i++) {
    const ownerIndex = r.u8();
    const shotSeq = r.u16();
    const mask = full ? INS_ALL : r.u8();
    instances.push(readInstance(r, ownerIndex, shotSeq, mask, prevInstances.get(instanceId(ownerIndex, shotSeq))));
  }

  return {
    tick, full, lateInput: (flags & FLAG_LATE_INPUT) !== 0, ackTick, slackTicks,
    cars, instances, events: readEvents(r, tick, roster),
  };
}

/* ------------------------------------------------------------------ input and pong */

/** `tick u32 · count u8 · one byte per input`, oldest first, for ticks `tick - count + 1 .. tick`. */
export function encodeInput(tick: number, inputs: readonly InputFrame[]): Uint8Array {
  const w = new Writer();
  w.u32(tick);
  w.u8(inputs.length);
  for (const input of inputs) w.u8(packInput(input));
  return w.bytes();
}

export function decodeInput(bytes: Uint8Array): { tick: number; inputs: InputFrame[] } {
  const r = new Reader(bytes);
  const tick = r.u32();
  const count = r.u8();
  const inputs: InputFrame[] = [];
  for (let i = 0; i < count; i++) inputs.push(unpackInput(r.u8()));
  return { tick, inputs };
}

/** `clientMs f64 · serverTick u32 · msIntoTick f32`. `clientMs` is echoed exactly, so it is a f64. */
export function encodePong(pong: PongMessage): Uint8Array {
  const w = new Writer();
  w.f64(pong.clientMs);
  w.u32(pong.serverTick);
  w.f32(pong.msIntoTick);
  return w.bytes();
}

export function decodePong(bytes: Uint8Array): PongMessage {
  const r = new Reader(bytes);
  return { clientMs: r.f64(), serverTick: r.u32(), msIntoTick: r.f32() };
}
```

- [ ] **Step 4: Make `HASH_QUANT` a re-export of `QUANT`**

`sim/world-hash.ts:31-33` (the local `HASH_QUANT` table and its comment) becomes:

```ts
import { QUANT } from "../net/codec.js";

/**
 * The hash quantises exactly as the wire does — this IS the codec's `QUANT` (N2). A hash coarser
 * or finer than the wire would either miss a divergence the wire carries or report one it does not,
 * which is the whole reason this is a re-export and not a second table.
 */
export const HASH_QUANT = QUANT;
```

and the speed term inside `worldHash` (line 68) changes from `Math.round(c.speed * HASH_QUANT.posPerUnit)` to `Math.round(c.speed * HASH_QUANT.speedPerUnit)`. Nothing else in the file moves. The import is type-safe and cycle-free: `codec.ts` imports `sim/step.js` for types only, which erases at build.

Append to `sim/world-hash.test.ts`:

```ts
describe("HASH_QUANT and the codec", () => {
  it("is the codec's QUANT, not a second table", () => {
    expect(HASH_QUANT).toBe(QUANT);
  });
  it("hashes a quantised body identically to the body it came from", () => {
    const raw = body(300.031, 359.99, 1.2345, 233.51);
    expect(worldHash([quantizeBody(raw)], [])).toBe(worldHash([raw], []));
  });
});
```

(with `import { QUANT, quantizeBody } from "../net/codec.js";` at the top).

- [ ] **Step 5: Export from shared and run everything**

Append to `packages/shared/src/index.ts`:

```ts
export type { MatchEvent } from "./net/events.js";
export { MSG_ROSTER, Roster, isRosterMessage } from "./net/roster.js";
export type { RosterEntry, RosterMessage } from "./net/roster.js";
export {
  ANG_VEL_SCALE, AUTHORITY_STEPS, MSG_SNAPSHOT, PROTOCOL_VERSION, QUANT,
  decodeInput, decodePong, decodeSnapshot, encodeInput, encodePong, encodeSnapshot,
  instanceId, quantizeAngle, quantizeBody, quantizePos,
} from "./net/codec.js";
export type { Snapshot, SnapshotCar, SnapshotInstance, SnapshotSlot, SnapshotStatus } from "./net/codec.js";
```

Also write `packages/shared/src/net/roster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Roster, isRosterMessage } from "./roster.js";

describe("Roster", () => {
  it("maps both ways and answers -1 / empty for a stranger", () => {
    const roster = new Roster([{ index: 2, sessionId: "abc" }, { index: 0, sessionId: "xyz" }]);
    expect(roster.indexOf("abc")).toBe(2);
    expect(roster.sessionIdOf(0)).toBe("xyz");
    expect(roster.indexOf("nope")).toBe(-1);
    expect(roster.sessionIdOf(5)).toBe("");
    expect(roster.size).toBe(2);
  });
});

describe("isRosterMessage", () => {
  it("accepts a well-formed message and refuses anything else", () => {
    expect(isRosterMessage({ protocolHash: "abc12345", snapshotEvery: 1, cars: [{ index: 0, sessionId: "a" }] })).toBe(true);
    expect(isRosterMessage({ protocolHash: "abc12345", snapshotEvery: 1 })).toBe(false);
    expect(isRosterMessage(null)).toBe(false);
    expect(isRosterMessage({ protocolHash: 1, snapshotEvery: 1, cars: [] })).toBe(false);
  });
});
```

Run: `npm run build -w @motor-combat-moba/shared && cd packages/shared && npx vitest run src/net src/sim/world-hash.test.ts`
Expected: PASS. If a byte-budget assertion is off by a byte, the layout table in this task is the authority — fix the encoder, not the number.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/net/codec.ts packages/shared/src/net/codec.test.ts packages/shared/src/net/roster.ts packages/shared/src/net/roster.test.ts packages/shared/src/net/events.ts packages/shared/src/sim/world-hash.ts packages/shared/src/sim/world-hash.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): binary snapshot, input and pong codec with delta compression (N9, N10)"
```

Nothing is wired to this yet; no probe reads it and no report number moves.

---

### Task 2: `MatchTransport`, and the binary channels end to end

**Files:**
- Create: `packages/client/src/match/transport.ts`
- Modify: `packages/server/src/net/input-message.ts` (whole file), `packages/server/src/rooms/ping-handler.ts` (the send line), `packages/server/src/rooms/ArenaRoom.ts:129-132`, `packages/server/src/rooms/PracticeRoom.ts` and `PlaygroundRoom.ts` (the same `onMessage(INPUT_MESSAGE, …)` block)
- Test: `packages/client/src/match/transport.test.ts`, `packages/server/src/net/input-message.test.ts` (rewrite)

**Interfaces:**
- Consumes: Task 1's `decodeInput`, `encodeInput`, `encodePong`, `decodePong`, `MSG_SNAPSHOT`, `MSG_ROSTER`, `isRosterMessage`; `InputRing.accept` and `InputMessage` (N1); `bindPing` (N0).
- Produces: `MatchTransport`, `ColyseusTransport`, `LoopbackTransport` (ledger); `decodeInputMessages(bytes, maxTick): InputMessage[] | null`.

- [ ] **Step 1: Write the failing transport test**

```ts
// packages/client/src/match/transport.test.ts
import { describe, expect, it } from "vitest";
import { MSG_ROSTER, MSG_SNAPSHOT, PING_MESSAGE, PONG_MESSAGE, encodePong } from "@motor-combat-moba/shared";
import { ColyseusTransport, LoopbackTransport } from "./transport.js";

/** The two calls and the one registry `ColyseusTransport` uses, and nothing else from colyseus.js. */
function fakeRoom() {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    sent: [] as { type: string; payload: unknown }[],
    sentBytes: [] as { type: string; bytes: Uint8Array }[],
    send(type: string, payload: unknown) { this.sent.push({ type, payload }); },
    sendBytes(type: string, bytes: Uint8Array) { this.sentBytes.push({ type, bytes }); },
    onMessage(type: string, cb: (payload: unknown) => void) { handlers.set(type, cb); return () => handlers.delete(type); },
    deliver(type: string, payload: unknown) { handlers.get(type)?.(payload); },
  };
}

describe("ColyseusTransport", () => {
  it("sends input as bytes and ping as an object", () => {
    const room = fakeRoom();
    const transport = new ColyseusTransport(room as never);
    transport.sendInput(new Uint8Array([1, 2, 3]));
    transport.sendPing({ clientMs: 42 });
    expect(room.sentBytes[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(room.sent[0]).toEqual({ type: PING_MESSAGE, payload: { clientMs: 42 } });
  });

  it("routes snapshots, pongs and rosters to their subscribers and unsubscribes", () => {
    const room = fakeRoom();
    const transport = new ColyseusTransport(room as never);
    const snapshots: Uint8Array[] = [];
    const off = transport.onSnapshot((bytes) => snapshots.push(bytes));
    const pongs: number[] = [];
    transport.onPong((pong) => pongs.push(pong.serverTick));
    const rosters: unknown[] = [];
    transport.onRoster((roster) => rosters.push(roster));

    room.deliver(MSG_SNAPSHOT, new Uint8Array([9]));
    room.deliver(PONG_MESSAGE, encodePong({ clientMs: 1, serverTick: 77, msIntoTick: 3 }));
    room.deliver(MSG_ROSTER, { protocolHash: "abc12345", snapshotEvery: 1, cars: [] });
    room.deliver(MSG_ROSTER, { nonsense: true });

    expect(snapshots).toEqual([new Uint8Array([9])]);
    expect(pongs).toEqual([77]);
    expect(rosters).toHaveLength(1);
    off();
    room.deliver(MSG_SNAPSHOT, new Uint8Array([10]));
    expect(snapshots).toHaveLength(1);
  });
});

describe("LoopbackTransport", () => {
  it("hands what the client sends to the peer and what the peer pushes back to the client", () => {
    const transport = new LoopbackTransport();
    const inputs: Uint8Array[] = [];
    transport.onClientInput((bytes) => inputs.push(bytes));
    transport.sendInput(new Uint8Array([4]));
    expect(inputs).toEqual([new Uint8Array([4])]);

    const seen: Uint8Array[] = [];
    transport.onSnapshot((bytes) => seen.push(bytes));
    transport.pushSnapshot(new Uint8Array([5]));
    expect(seen).toEqual([new Uint8Array([5])]);

    const pings: number[] = [];
    transport.onClientPing((ping) => pings.push(ping.clientMs));
    transport.sendPing({ clientMs: 8 });
    expect(pings).toEqual([8]);
    const pongs: number[] = [];
    transport.onPong((pong) => pongs.push(pong.serverTick));
    transport.pushPong({ clientMs: 8, serverTick: 3, msIntoTick: 0 });
    expect(pongs).toEqual([3]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/match/transport.test.ts`
Expected: FAIL — cannot resolve `./transport.js`.

- [ ] **Step 3: Write the transport**

```ts
// packages/client/src/match/transport.ts
import {
  INPUT_MESSAGE, MSG_ROSTER, MSG_SNAPSHOT, PING_MESSAGE, PONG_MESSAGE,
  decodePong, isRosterMessage,
  type PingMessage, type PongMessage, type RosterMessage,
} from "@motor-combat-moba/shared";
import type { Room } from "colyseus.js";

/**
 * The one seam the match's bytes cross (netcode spec N12). TCP head-of-line blocking at 1 % loss is
 * a one-RTT stall about once every three seconds of snapshots, which the lead and the jitter buffer
 * absorb, so WebSocket stays — but behind this interface, so a WebTransport implementation is a new
 * file rather than a rewrite of everything above it.
 *
 * Binary rides Colyseus's `ROOM_DATA_BYTES` frame: `room.sendBytes(type, bytes)` upstream and a
 * `Uint8Array` payload delivered to `room.onMessage(type, …)` downstream. Ping stays a plain object
 * — twice a second, and its shape is what makes a packet capture readable.
 */
export interface MatchTransport {
  sendInput(bytes: Uint8Array): void;
  sendPing(ping: PingMessage): void;
  /** Returns an unsubscribe function. */
  onSnapshot(cb: (bytes: Uint8Array) => void): () => void;
  onPong(cb: (pong: PongMessage) => void): () => void;
  onRoster(cb: (roster: RosterMessage) => void): () => void;
}

/** Just enough of `Room` for this file, so a test needs no colyseus.js instance. */
type BytesRoom = Pick<Room, "send" | "sendBytes" | "onMessage">;

export class ColyseusTransport implements MatchTransport {
  constructor(private readonly room: BytesRoom) {}

  sendInput(bytes: Uint8Array): void {
    this.room.sendBytes(INPUT_MESSAGE, bytes);
  }

  sendPing(ping: PingMessage): void {
    this.room.send(PING_MESSAGE, ping);
  }

  onSnapshot(cb: (bytes: Uint8Array) => void): () => void {
    return this.room.onMessage(MSG_SNAPSHOT, (payload: Uint8Array) => cb(payload));
  }

  onPong(cb: (pong: PongMessage) => void): () => void {
    return this.room.onMessage(PONG_MESSAGE, (payload: Uint8Array) => cb(decodePong(payload)));
  }

  /** A malformed roster is dropped rather than thrown: it arrives before anything is running. */
  onRoster(cb: (roster: RosterMessage) => void): () => void {
    return this.room.onMessage(MSG_ROSTER, (payload: unknown) => {
      if (isRosterMessage(payload)) cb(payload);
    });
  }
}

/**
 * The in-process pair, for unit tests and the netcode harness: the client half is the
 * `MatchTransport`, and the four `…Client…`/`push…` members are the server half a link model drives.
 */
export class LoopbackTransport implements MatchTransport {
  private snapshotCbs: ((bytes: Uint8Array) => void)[] = [];
  private pongCbs: ((pong: PongMessage) => void)[] = [];
  private rosterCbs: ((roster: RosterMessage) => void)[] = [];
  private inputCbs: ((bytes: Uint8Array) => void)[] = [];
  private pingCbs: ((ping: PingMessage) => void)[] = [];

  sendInput(bytes: Uint8Array): void { for (const cb of this.inputCbs) cb(bytes); }
  sendPing(ping: PingMessage): void { for (const cb of this.pingCbs) cb(ping); }

  onSnapshot(cb: (bytes: Uint8Array) => void): () => void {
    this.snapshotCbs.push(cb);
    return () => { this.snapshotCbs = this.snapshotCbs.filter((x) => x !== cb); };
  }
  onPong(cb: (pong: PongMessage) => void): () => void {
    this.pongCbs.push(cb);
    return () => { this.pongCbs = this.pongCbs.filter((x) => x !== cb); };
  }
  onRoster(cb: (roster: RosterMessage) => void): () => void {
    this.rosterCbs.push(cb);
    return () => { this.rosterCbs = this.rosterCbs.filter((x) => x !== cb); };
  }

  /* --- the server half --- */
  onClientInput(cb: (bytes: Uint8Array) => void): void { this.inputCbs.push(cb); }
  onClientPing(cb: (ping: PingMessage) => void): void { this.pingCbs.push(cb); }
  pushSnapshot(bytes: Uint8Array): void { for (const cb of this.snapshotCbs) cb(bytes); }
  pushPong(pong: PongMessage): void { for (const cb of this.pongCbs) cb(pong); }
  pushRoster(roster: RosterMessage): void { for (const cb of this.rosterCbs) cb(roster); }
}
```

- [ ] **Step 4: Server intake — bytes in, bytes out**

Rewrite `packages/server/src/net/input-message.ts`:

```ts
import { decodeInput, type InputMessage } from "@motor-combat-moba/shared";

/**
 * One binary input frame off the wire (N10), validated into the `InputMessage`s the ring accepts.
 *
 * `decodeInput` already masks the three slot bits and the two axes into range, so the only thing
 * left to reject is a payload that is not bytes, a tick that is not a finite non-negative integer,
 * a run longer than the ring could ever use, or a tick beyond `maxTick` — a client claiming to be
 * minutes ahead of the server. The ring itself still decides late, duplicate and future (N6).
 */
const MAX_RUN = 8;

export function decodeInputMessages(payload: unknown, maxTick: number): InputMessage[] | null {
  if (!(payload instanceof Uint8Array)) return null;
  let decoded: { tick: number; inputs: { steer: -1 | 0 | 1; throttle: -1 | 0 | 1; fireSlots: number }[] };
  try {
    decoded = decodeInput(payload);
  } catch {
    return null;
  }
  const { tick, inputs } = decoded;
  if (!Number.isInteger(tick) || tick < 0 || tick > maxTick) return null;
  if (inputs.length === 0 || inputs.length > MAX_RUN) return null;
  // Oldest first: the run covers `tick - count + 1 .. tick`.
  return inputs.map((input, i) => ({ ...input, tick: tick - (inputs.length - 1 - i) }));
}
```

Rewrite `packages/server/src/net/input-message.test.ts` around it: keep the "refuses rubbish" cases (`null`, a plain object, an empty array) and replace every hand-built `InputMessage` literal with `encodeInput(tick, frames)`. Add: "a run of three decodes to three consecutive ticks ending at `tick`"; "a tick beyond `maxTick` is refused"; "a truncated payload is refused rather than throwing".

In each of the three rooms the `onMessage(INPUT_MESSAGE, …)` block becomes (`ArenaRoom.ts:129-132` and the same shape in `PracticeRoom` and `PlaygroundRoom`):

| Before | After |
|---|---|
| `this.onMessage(INPUT_MESSAGE, (client, msg: unknown) => { if (!isInputMessage(msg)) return; enqueue({ sessionId: client.sessionId, msg }); });` | `this.onMessage(INPUT_MESSAGE, (client, payload: unknown) => { const msgs = decodeInputMessages(payload, this.state.tick + NET_CONFIG.ringSize); if (!msgs) return; for (const msg of msgs) enqueue({ sessionId: client.sessionId, msg }); });` |

`enqueue` keeps N1's body — `ring.accept(msg, this.state.tick)` behind `withSimulatedLatency`. A run
of repeats is free: `accept` answers `duplicate` for a tick already held and counts it.

In `packages/server/src/rooms/ping-handler.ts`, the one send line becomes bytes:

| Before | After |
|---|---|
| `client.send(PONG_MESSAGE, { clientMs: msg.clientMs, serverTick, msIntoTick });` | `client.sendBytes(PONG_MESSAGE, encodePong({ clientMs: msg.clientMs, serverTick, msIntoTick }));` |

with `encodePong` added to the shared import. `ping-handler.test.ts`'s assertion on the sent payload
becomes `expect(decodePong(sent[0]!.bytes as Uint8Array).serverTick).toBe(…)`, and its fake client
grows a `sendBytes` beside `send`.

- [ ] **Step 5: Run the suites**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/client && npx vitest run src/match/transport.test.ts && cd ../server && npx vitest run src/net src/rooms/ping-handler.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/match/transport.ts packages/client/src/match/transport.test.ts packages/server/src/net/input-message.ts packages/server/src/net/input-message.test.ts packages/server/src/rooms/ping-handler.ts packages/server/src/rooms/ping-handler.test.ts packages/server/src/rooms/ArenaRoom.ts packages/server/src/rooms/PracticeRoom.ts packages/server/src/rooms/PlaygroundRoom.ts
git commit -m "feat(net): MatchTransport seam, binary input intake and binary pong (N10, N12)"
```

No probe number moves: `playtest/` drives `PlaytestWorld` and never builds an `InputMessage` off the wire.

---

### Task 3: The protocol hash, and the join that refuses a mismatched build

**Files:**
- Create: `packages/shared/src/net/protocol-hash.ts`, `packages/shared/src/net/protocol-hash.test.ts`, `scripts/tick-rate-override.test.mjs`
- Modify: `packages/shared/src/index.ts` (append), `packages/server/src/rooms/ArenaRoom.ts` (`onJoin`), `PracticeRoom.ts`/`PlaygroundRoom.ts` (`onJoin`, and the playground's `MSG_PLAYGROUND_TUNING` handler at `PlaygroundRoom.ts:218-228`), `packages/client/src/net/connection.ts` (three join calls), `packages/client/src/scenes/arena-mismatch.ts` (whole file), `packages/client/src/scenes/ArenaScene.ts:774-782`
- Test: `packages/client/src/scenes/arena-mismatch.test.ts` (rewrite)

**Interfaces:**
- Consumes: `PROTOCOL_VERSION` (Task 1), the balance tables, `ARENAS`.
- Produces: `protocolHash()`, `protocolHashInput()`, `PROTOCOL_MISMATCH_ERROR`, `protocolMismatchMessage(serverHash, clientHash)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/net/protocol-hash.test.ts
import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { setTuning } from "../config/tuning.js";
import { protocolHash, protocolHashInput } from "./protocol-hash.js";

describe("protocolHash", () => {
  it("is eight hex characters and stable across calls", () => {
    const hash = protocolHash();
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(protocolHash()).toBe(hash);
  });

  it("covers the codec version, the tick rate and every table the sim reads", () => {
    const input = protocolHashInput() as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual([
      "AIM_CONFIG", "ARENAS", "CAR_TABLE", "COMBAT_CONFIG", "DEATHMATCH_CONFIG", "DRIVE_CONFIG",
      "PROTOCOL_VERSION", "RAM_CONFIG", "SLAM_CONFIG", "STATUS_TABLE", "TICK_RATE_HZ",
      "WEAPON_SLOT_CONFIG", "WEAPON_TABLE",
    ]);
  });

  it("moves when the playground retunes a table, and comes back when the tuning is cleared", () => {
    const before = protocolHash();
    setTuning({ "drive.baseTurnRate": DRIVE_CONFIG.baseTurnRate + 1 });
    expect(protocolHash()).not.toBe(before);
    setTuning(null);
    expect(protocolHash()).toBe(before);
  });
});
```

```js
// scripts/tick-rate-override.test.mjs
// The TICK_RATE_HZ env override was removed in netcode phase 1 and must stay removed (N11): the
// tick rate is baked into every ms-authored timer at module load, so a server started on a
// different one is a different game that no hash could describe after the fact.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

describe("the TICK_RATE_HZ env override", () => {
  it("is read nowhere in the repository", () => {
    let hits = "";
    try {
      hits = execFileSync("git", ["grep", "-nE", "(env\\.TICK_RATE_HZ|TICK_RATE_HZ=)", "--", ".", ":!scripts/tick-rate-override.test.mjs"], { encoding: "utf8" });
    } catch (error) {
      // git grep exits 1 when nothing matches, which is the passing case.
      if (error.status !== 1) throw error;
    }
    assert.equal(hits.trim(), "", `TICK_RATE_HZ is overridable again:\n${hits}`);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/shared && npx vitest run src/net/protocol-hash.test.ts; cd ../.. && node --test scripts/tick-rate-override.test.mjs`
Expected: the vitest run FAILS (module missing); the script test PASSES already if phase 1 removed the override, and FAILS naming the file if anything reintroduced it.

- [ ] **Step 3: Write the hash**

```ts
// packages/shared/src/net/protocol-hash.ts
/**
 * One hash of everything two builds must agree on to play the same game (netcode spec N11): the
 * codec layout, the tick rate, and every table `stepSim`, `runCombat`, the contact pass and the
 * respawn pipeline read. The server sends it in the roster message and the client, which computes
 * the same from its own build, refuses a mismatch with a readable message.
 *
 * It replaces the arena-mismatch check (a strictly narrower test of the same failure) and it is
 * what makes the playground's `setTuning` honest: the tables are mutated in place, so this is
 * recomputed on every call rather than memoised, and the playground re-sends the roster after every
 * tuning change.
 *
 * **This list is hand-maintained.** A config table added later that the sim reads is invisible to
 * this hash until it is added below — the same trap `balance/fingerprint.ts` documents at length,
 * and the same remedy. Hashed WHOLE: any field of any row counts, including the purely visual ones,
 * because a client drawing a shot in the wrong colour is a smaller problem than a build that
 * silently disagrees about which fields exist.
 *
 * FNV-1a over a key-sorted `JSON.stringify`, matching `balance/fingerprint.ts` — 32 bits is ample
 * for "is this the same build", and it needs no import from `node:crypto`, which keeps this module
 * loadable in a browser.
 */
import { AIM_CONFIG } from "../config/aim-config.js";
import { ARENAS } from "../arena/registry.js";
import { CAR_TABLE } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { DEATHMATCH_CONFIG } from "../config/deathmatch-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import { SLAM_CONFIG } from "../config/slam-config.js";
import { STATUS_TABLE } from "../config/status-config.js";
import { WEAPON_SLOT_CONFIG } from "../config/weapon-slots.js";
import { WEAPON_TABLE } from "../config/weapon-config.js";
import { TICK_RATE_HZ } from "../constants.js";
import { PROTOCOL_VERSION } from "./codec.js";

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

function fnv1aHex(input: string): string {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeysDeep(source[key]);
    return sorted;
  }
  return value;
}

/** Exported so a test can assert the coverage list directly rather than only the hash's stability. */
export function protocolHashInput(): unknown {
  return {
    PROTOCOL_VERSION, TICK_RATE_HZ, CAR_TABLE, WEAPON_TABLE, WEAPON_SLOT_CONFIG, STATUS_TABLE,
    DRIVE_CONFIG, RAM_CONFIG, COMBAT_CONFIG, AIM_CONFIG, SLAM_CONFIG, DEATHMATCH_CONFIG, ARENAS,
  };
}

export function protocolHash(): string {
  return fnv1aHex(JSON.stringify(sortKeysDeep(protocolHashInput())));
}
```

Append to `packages/shared/src/index.ts`:

```ts
export { protocolHash, protocolHashInput } from "./net/protocol-hash.js";
```

and add `export const PROTOCOL_MISMATCH_ERROR = "This build does not match the server's.";` beside the other room error constants in `packages/shared/src/net/roster.ts`, exported from the index in the same line group as `MSG_ROSTER`.

- [ ] **Step 4: Refuse the join on the server**

In all three rooms, at the top of `onJoin` — before any other validation, so a stale build is told
what is wrong rather than "name is taken":

```ts
const clientHash = (options as { protocolHash?: unknown } | undefined)?.protocolHash;
if (clientHash !== protocolHash()) {
  throw new ServerError(4004, PROTOCOL_MISMATCH_ERROR);
}
```

`4004` is the next free code beside the existing `4000` (name), `4001` (name taken), `4002`
(kicked), `4003` (room full). `PracticeRoom.onJoin` takes `options?: unknown`, so the same three
lines apply verbatim; `PlaygroundRoom.onJoin` takes `options?: { name?: unknown }` and widens to
`options?: { name?: unknown; protocolHash?: unknown }`.

At the end of every `onJoin`, and whenever membership changes in `onLeave`, broadcast the roster
(Task 4 assigns the indices, so this line lands there; the hash half is what this task adds):

```ts
this.broadcast(MSG_ROSTER, this.rosterMessage());
```

In `PlaygroundRoom.ts:218-228`, `MSG_PLAYGROUND_TUNING` gains one line after `setTuning(overrides)`:

```ts
// The tables the hash covers just moved under every connected client's feet (N11). Re-send it, so
// the client can re-hash after applying `tuningJson` and refuse rather than mispredict silently.
this.broadcast(MSG_ROSTER, this.rosterMessage());
```

- [ ] **Step 5: Refuse it on the client**

`packages/client/src/net/connection.ts`: every one of the three `joinOrCreate` calls carries the
hash. `joinArena` → `{ name, protocolHash: protocolHash() }`; `joinPlayground` →
`{ name: "Dev", protocolHash: protocolHash() }`; `joinPractice` → `{ ...setup, protocolHash: protocolHash() }`.

`packages/client/src/scenes/arena-mismatch.ts` becomes:

```ts
/**
 * What to show when this build and the server's do not agree on the protocol (netcode spec N11).
 *
 * This replaces the arena-id mismatch message: an unknown arena id was one symptom of a build
 * skew, and the protocol hash covers every other one — a renamed weapon field, a retuned drive
 * constant, a different tick rate, a codec change. The release zip cannot reach this state; it
 * ships one build of server and client. Development can, through the stale-`dist` gotcha in
 * `CLAUDE.md` and its browser-side twin (a tab held open across a server restart, or a Vite dep
 * cache still holding the previous `shared/dist`), which is the loop this message exists for.
 */
export function protocolMismatchMessage(serverHash: string, clientHash: string): string {
  return (
    `Build mismatch.\n\n` +
    `The server is running protocol ${serverHash || "(none)"}, this page is running ${clientHash}.\n\n` +
    `Rebuild shared (npm run build -w @motor-combat-moba/shared), restart the server, and hard-refresh this page.`
  );
}
```

`arena-mismatch.test.ts` is rewritten to the same two assertions it makes today, against the new
function: the message names both hashes, and it names the rebuild command.

`ArenaScene.ts:774-782` (the `isArenaId` guard the preparation plan left in `create`) becomes:

| Before | After |
|---|---|
| `const message = arenaMismatchMessage(arenaId, ARENA_IDS);` | `const message = protocolMismatchMessage(this.serverProtocolHash, protocolHash());` |

and the `ARENA_IDS` / `arenaMismatchMessage` imports are dropped. `this.serverProtocolHash` is set
from the roster message in Task 5; before the roster arrives it is `""`, which the message renders
as `(none)`. The guard itself stays: `getArena` throws, and a defensive check that renders a reason
beats a stack trace inside Phaser's boot.

- [ ] **Step 6: Run everything and commit**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck`
Expected: PASS. `protocol-hash.test.ts` (3), `arena-mismatch.test.ts` (2), `tick-rate-override.test.mjs` (1).

```bash
git add packages/shared/src/net/protocol-hash.ts packages/shared/src/net/protocol-hash.test.ts packages/shared/src/net/roster.ts packages/shared/src/index.ts scripts/tick-rate-override.test.mjs packages/server/src/rooms packages/client/src/net/connection.ts packages/client/src/scenes/arena-mismatch.ts packages/client/src/scenes/arena-mismatch.test.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(net): protocol hash at join, replacing the arena-mismatch check (N11)"
```

No probe reads the join path; no report number moves.

---

### Task 4: The schema split (N24), and the server broadcasting snapshots

**Files:**
- Modify: `packages/shared/src/schema/PlayerState.ts:8-12, 18-19, 28-31, 37-42, 50, 68-70, 76, 82, 90, 104`, `packages/shared/src/schema/ArenaState.ts:32`, `packages/server/src/sim/combat-bridge.ts:261-288, 308-312`, `packages/server/src/rooms/tick-pipeline.ts:144`, `packages/server/src/rooms/{ArenaRoom,PracticeRoom,PlaygroundRoom}.ts`, `docs/schema-reference.md:5-22, 51-107, 136-198`
- Create: `packages/server/src/net/snapshot-source.ts`, `packages/server/src/net/snapshot-broadcaster.ts`
- Test: `packages/server/src/net/snapshot-source.test.ts`, `packages/server/src/net/snapshot-broadcaster.test.ts`

**Interfaces:**
- Consumes: Task 1's codec and `Roster`; `CombatMemory` (`sim/combat-bridge.ts`), `RingRead` and `InputRing.stats` (N1), `runPipeline(...).reads` (N1).
- Produces: `ShotSeqTable`, `buildSnapshot(ctx: SnapshotSourceCtx): Snapshot`, `adoptQuantisedState(state, memory)`, `SnapshotBroadcaster` (+ `setRoster`, `forget`), `PlayerState.carIndex`.

- [ ] **Step 1: Write the failing server tests**

```ts
// packages/server/src/net/snapshot-source.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  ArenaState, PlayerState, PlayerStatus, Roster, quantizeBody, type SimBody,
} from "@motor-combat-moba/shared";
import { newCombatMemory } from "../sim/combat-bridge.js";
import { ShotSeqTable, adoptQuantisedState, buildSnapshot } from "./snapshot-source.js";

const ROSTER = new Roster([{ index: 0, sessionId: "me" }, { index: 1, sessionId: "them" }]);

function state(): ArenaState {
  const s = new ArenaState();
  s.tick = 500;
  for (const [i, id] of ["me", "them"].entries()) {
    const p = new PlayerState();
    p.sessionId = id; p.carIndex = i; p.carId = "mirage"; p.status = PlayerStatus.IN_MATCH;
    p.alive = true; p.hp = 700; p.x = 300.031; p.y = 359.99; p.angle = 1.2345; p.speed = 233.51;
    p.lockTargetSessionId = i === 0 ? "them" : "";
    s.players.set(id, p);
  }
  return s;
}

describe("adoptQuantisedState", () => {
  it("rounds every transmitted pose field onto the wire's grid, idempotently", () => {
    const s = state();
    const memory = newCombatMemory();
    adoptQuantisedState(s, memory);
    const me = s.players.get("me")!;
    const body: SimBody = { ...me } as unknown as SimBody;
    expect(body).toEqual(quantizeBody(body));
    adoptQuantisedState(s, memory);
    expect(s.players.get("me")!.x).toBe(me.x);
  });
});

describe("buildSnapshot", () => {
  let s: ArenaState;
  beforeEach(() => { s = state(); });

  it("lists cars by index with their lock as an index and the input they were driven on", () => {
    const snap = buildSnapshot({
      state: s, memory: newCombatMemory(), roster: ROSTER, shotSeq: new ShotSeqTable(),
      reads: new Map([["me", { input: { steer: 1, throttle: 1, fireSlots: 2 }, source: "fresh", slackTicks: 3 }]]),
      events: [],
    });
    expect(snap.tick).toBe(500);
    expect(snap.cars.map((c) => c.index)).toEqual([0, 1]);
    expect(snap.cars[0]!.lockTargetIndex).toBe(1);
    expect(snap.cars[1]!.lockTargetIndex).toBe(-1);
    expect(snap.cars[0]!.lastInput).toEqual({ steer: 1, throttle: 1, fireSlots: 2 });
    expect(snap.cars[1]!.lastInput).toEqual({ steer: 0, throttle: 0, fireSlots: 0 });
    expect(snap.cars[0]!.onField).toBe(true);
  });

  it("gives each owner its own shot sequence, stable for the life of the instance", () => {
    const memory = newCombatMemory();
    const shotSeq = new ShotSeqTable();
    const shot = (id: string, owner: string) => ({
      id, ownerSessionId: owner, weaponId: "predator", kind: "projectile" as const,
      x: 10, y: 20, angle: 0, extent: 0, alive: true, isExplosion: false, homingTargetId: "them",
    });
    memory.instances.set("me-1", shot("me-1", "me") as never);
    memory.instances.set("me-2", shot("me-2", "me") as never);
    memory.instances.set("them-1", shot("them-1", "them") as never);
    const ctx = { state: s, memory, roster: ROSTER, shotSeq, reads: new Map(), events: [] };
    const first = buildSnapshot(ctx);
    expect(first.instances.map((i) => [i.ownerIndex, i.shotSeq])).toEqual([[0, 0], [0, 1], [1, 0]]);
    expect(first.instances[0]!.homingTargetIndex).toBe(1);
    expect(first.cars[0]!.shotSeq).toBe(2);
    memory.instances.delete("me-1");
    const second = buildSnapshot(ctx);
    expect(second.instances.map((i) => [i.ownerIndex, i.shotSeq])).toEqual([[0, 1], [1, 0]]);
  });
});
```

```ts
// packages/server/src/net/snapshot-broadcaster.test.ts
import { describe, expect, it } from "vitest";
import { Roster, decodeSnapshot, type Snapshot } from "@motor-combat-moba/shared";
import { SnapshotBroadcaster } from "./snapshot-broadcaster.js";

const ROSTER = new Roster([{ index: 0, sessionId: "a" }, { index: 1, sessionId: "b" }]);

function snap(tick: number, x: number): Snapshot {
  return {
    tick, full: true, lateInput: false, ackTick: tick - 1, slackTicks: 1,
    cars: [{
      index: 0,
      body: { x, y: 0, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0, authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0 },
      hp: 700, alive: true, onField: true, phased: false,
      lastInput: { steer: 0, throttle: 0, fireSlots: 0 }, lockTargetIndex: -1, shotSeq: 0,
      pendingUntilTick: 0, switchLockUntilTick: 0, lastFiredSlot: -1, level: 1, diedAtTick: 0,
      slots: [], statuses: [],
    }],
    instances: [], events: [],
  };
}

function fakeRoom() {
  const sent: { sessionId: string; bytes: Uint8Array }[] = [];
  return {
    sent,
    clients: [
      { sessionId: "a", sendBytes: (_t: string, b: Uint8Array) => sent.push({ sessionId: "a", bytes: b }) },
      { sessionId: "b", sendBytes: (_t: string, b: Uint8Array) => sent.push({ sessionId: "b", bytes: b }) },
    ],
  };
}

describe("SnapshotBroadcaster", () => {
  it("sends a full snapshot first and deltas after, per client", () => {
    const room = fakeRoom();
    const b = new SnapshotBroadcaster(room as never, ROSTER, 1);
    b.afterTick(1, () => snap(1, 100));
    b.afterTick(2, () => snap(2, 110));
    expect(room.sent).toHaveLength(4);
    expect(decodeSnapshot(room.sent[0]!.bytes, undefined, ROSTER).full).toBe(true);
    const baseline = decodeSnapshot(room.sent[0]!.bytes, undefined, ROSTER);
    const delta = decodeSnapshot(room.sent[2]!.bytes, baseline, ROSTER);
    expect(delta.full).toBe(false);
    expect(delta.cars[0]!.body.x).toBe(110);
    expect(room.sent[2]!.bytes.length).toBeLessThan(room.sent[0]!.bytes.length);
  });

  it("sends nothing on the ticks snapshotEvery skips", () => {
    const room = fakeRoom();
    const b = new SnapshotBroadcaster(room as never, ROSTER, 2);
    b.afterTick(1, () => snap(1, 100));
    expect(room.sent).toHaveLength(0);
    b.afterTick(2, () => snap(2, 110));
    expect(room.sent).toHaveLength(2);
  });

  it("sendFull makes the next snapshot to that client a full one and leaves the others on deltas", () => {
    const room = fakeRoom();
    const b = new SnapshotBroadcaster(room as never, ROSTER, 1);
    b.afterTick(1, () => snap(1, 100));
    b.sendFull("b");
    room.sent.length = 0;
    b.afterTick(2, () => snap(2, 110));
    expect(decodeSnapshot(room.sent[0]!.bytes, undefined, ROSTER).full).toBe(false);
    expect(decodeSnapshot(room.sent[1]!.bytes, undefined, ROSTER).full).toBe(true);
  });

  it("forgets a client that left, so a reused session id cannot decode against a stale baseline", () => {
    const room = fakeRoom();
    const b = new SnapshotBroadcaster(room as never, ROSTER, 1);
    b.afterTick(1, () => snap(1, 100));
    b.forget("a");
    room.sent.length = 0;
    b.afterTick(2, () => snap(2, 110));
    expect(decodeSnapshot(room.sent[0]!.bytes, undefined, ROSTER).full).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/server && npx vitest run src/net/snapshot-source.test.ts src/net/snapshot-broadcaster.test.ts`
Expected: FAIL — the two modules do not exist.

- [ ] **Step 3: Write the snapshot source**

```ts
// packages/server/src/net/snapshot-source.ts
/**
 * The server's `ArenaState` and `CombatMemory`, read out as one `Snapshot` (netcode spec N9).
 *
 * Two jobs, and the order matters: `adoptQuantisedState` rounds the server's own state onto the
 * wire's grid at the end of every tick, and `buildSnapshot` then reads it out. Adopting first is
 * what makes the client's copy identical to the server's rather than a fraction of a quantum off —
 * a resim from a snapshot reproduces the server exactly, the divergence metric measures bugs
 * instead of rounding noise, and an unchanged field is bit-identical so the delta can drop it.
 */
import {
  PlayerStatus, WeaponKind, isPhasedAt, quantizeAngle, quantizeBody, quantizePos,
  type ArenaState, type InputFrame, type MatchEvent, type PlayerState, type Roster,
  type SimBody, type Snapshot, type SnapshotCar, type SnapshotInstance, type SnapshotSlot,
} from "@motor-combat-moba/shared";
import type { RingRead } from "./input-ring.js";
import type { CombatMemory } from "../sim/combat-bridge.js";

const NEUTRAL: InputFrame = { steer: 0, throttle: 0, fireSlots: 0 };

/**
 * Per-owner shot sequences, assigned on first sight and held for the life of the instance (N22).
 *
 * The sim's own instance id is `${ownerSessionId}-${roomWideCounter}` and is server-only; the wire
 * needs a **per-owner** number a client can predict for its own next shot, which is what makes a
 * ghost's id match the real one when it arrives. Instances are handed over in the order
 * `runCombat` produced them, which is deterministic, so a client counting its own presses lands on
 * the same numbers. Wraps at 65536, far beyond any instance's lifetime.
 */
export class ShotSeqTable {
  private readonly nextByOwner = new Map<string, number>();
  private readonly seqById = new Map<string, number>();

  seqOf(instanceKey: string, ownerSessionId: string): number {
    const held = this.seqById.get(instanceKey);
    if (held !== undefined) return held;
    const next = this.nextByOwner.get(ownerSessionId) ?? 0;
    this.nextByOwner.set(ownerSessionId, (next + 1) % 65536);
    this.seqById.set(instanceKey, next);
    return next;
  }

  /** How many shots this owner has spawned, mod 65536 — the car's own `shotSeq` on the wire. */
  countOf(ownerSessionId: string): number {
    return this.nextByOwner.get(ownerSessionId) ?? 0;
  }

  /** Drop ids that are no longer live, so a long match does not accumulate one entry per shot. */
  sweep(liveKeys: ReadonlySet<string>): void {
    for (const key of [...this.seqById.keys()]) if (!liveKeys.has(key)) this.seqById.delete(key);
  }

  clear(): void {
    this.nextByOwner.clear();
    this.seqById.clear();
  }
}

const bodyOf = (p: PlayerState): SimBody => ({
  x: p.x, y: p.y, angle: p.angle, speed: p.speed, reverseHold: p.reverseHold, angVel: p.angVel,
  shoveX: p.shoveX, shoveY: p.shoveY, authority: p.authority, maneuver: p.maneuver,
  maneuverTicksLeft: p.maneuverTicksLeft, maneuverAngle: p.maneuverAngle, maneuverSpeed: p.maneuverSpeed,
});

/** N9's adopt rule. Called at the end of the tick, after combat, before the snapshot is built. */
export function adoptQuantisedState(state: ArenaState, memory: CombatMemory): void {
  state.players.forEach((player) => {
    const q = quantizeBody(bodyOf(player));
    player.x = q.x; player.y = q.y; player.angle = q.angle; player.speed = q.speed;
    player.reverseHold = q.reverseHold; player.angVel = q.angVel; player.shoveX = q.shoveX;
    player.shoveY = q.shoveY; player.authority = q.authority;
    player.maneuverAngle = q.maneuverAngle; player.maneuverSpeed = q.maneuverSpeed;
  });
  for (const instance of memory.instances.values()) {
    instance.x = quantizePos(instance.x);
    instance.y = quantizePos(instance.y);
    instance.angle = quantizeAngle(instance.angle);
    instance.extent = quantizePos(instance.extent);
  }
}

export interface SnapshotSourceCtx {
  state: ArenaState;
  memory: CombatMemory;
  roster: Roster;
  shotSeq: ShotSeqTable;
  /** What each session's `InputRing` served this tick (N1's `runPipeline(...).reads`). */
  reads: ReadonlyMap<string, RingRead>;
  /** Empty until phase 4 fills it (N23a); the codec carries the section either way. */
  events: MatchEvent[];
}

export function buildSnapshot(ctx: SnapshotSourceCtx): Snapshot {
  const { state, memory, roster, shotSeq } = ctx;
  const tick = state.tick;

  const cars: SnapshotCar[] = [];
  state.players.forEach((player, sessionId) => {
    const statuses = [...player.statuses];
    const slots: SnapshotSlot[] = player.weapons.map((slot) => ({
      weaponId: slot.weaponId, stocks: slot.stocks,
      rechargeEndsTick: slot.rechargeEndsTick, refireLockUntilTick: slot.refireLockUntilTick,
    }));
    cars.push({
      index: player.carIndex,
      body: bodyOf(player),
      hp: player.hp,
      alive: player.alive,
      onField: player.status === PlayerStatus.IN_MATCH && player.alive,
      phased: isPhasedAt(statuses, tick),
      lastInput: ctx.reads.get(sessionId)?.input ?? NEUTRAL,
      lockTargetIndex: player.lockTargetSessionId ? roster.indexOf(player.lockTargetSessionId) : -1,
      shotSeq: shotSeq.countOf(sessionId),
      pendingUntilTick: player.pendingUntilTick,
      switchLockUntilTick: player.switchLockUntilTick,
      lastFiredSlot: player.lastFiredSlot,
      level: player.level,
      diedAtTick: player.diedAtTick,
      slots,
      statuses: statuses.map((row) => ({
        statusId: row.statusId, startTick: row.startTick, endsTick: row.endsTick,
        sourceIndex: row.sourceSessionId ? roster.indexOf(row.sourceSessionId) : -1,
      })),
    });
  });
  // Index order, not `MapSchema` order: the delta pairs rows by index, and a stable order keeps a
  // reordered map from re-sending every field.
  cars.sort((a, b) => a.index - b.index);

  const live = new Set(memory.instances.keys());
  shotSeq.sweep(live);
  const instances: SnapshotInstance[] = [];
  for (const instance of memory.instances.values()) {
    const ownerIndex = roster.indexOf(instance.ownerSessionId);
    if (ownerIndex < 0) continue; // an owner who left mid-flight has no index to send it under
    instances.push({
      ownerIndex,
      shotSeq: shotSeq.seqOf(instance.id, instance.ownerSessionId),
      weaponId: instance.weaponId,
      kind: instance.kind === "beam" ? WeaponKind.BEAM : WeaponKind.PROJECTILE,
      x: instance.x, y: instance.y, angle: instance.angle, extent: instance.extent,
      alive: instance.alive, isExplosion: instance.isExplosion,
      homingTargetIndex: instance.homingTargetId ? roster.indexOf(instance.homingTargetId) : -1,
    });
  }
  instances.sort((a, b) => a.ownerIndex - b.ownerIndex || a.shotSeq - b.shotSeq);

  return { tick, full: true, lateInput: false, ackTick: tick, slackTicks: 0, cars, instances, events: ctx.events };
}
```

- [ ] **Step 4: Write the broadcaster**

```ts
// packages/server/src/net/snapshot-broadcaster.ts
/**
 * One encoded snapshot per client per tick (netcode spec N9), sent inside the tick that produced
 * it — this is what replaces the `broadcastPatch()` call phase 1 left in each room's `wake()`.
 *
 * The baseline is per client and is simply the last snapshot that client was sent: TCP is ordered
 * and reliable, so "sent" and "will be applied" are the same thing and no acknowledgement
 * bookkeeping is needed. A client with no baseline — a joiner, a reconnect, anyone `sendFull` was
 * called for — gets a full snapshot and becomes a delta client on the next tick.
 */
import { MSG_SNAPSHOT, encodeSnapshot, type Roster, type Snapshot } from "@motor-combat-moba/shared";

/** Just enough of `Room` to send bytes to one client at a time. */
interface BytesRoom {
  clients: readonly { sessionId: string; sendBytes(type: string, bytes: Uint8Array): void }[];
}

export class SnapshotBroadcaster {
  private readonly baselines = new Map<string, Snapshot>();

  constructor(
    private readonly room: BytesRoom,
    private roster: Roster,
    private readonly snapshotEvery: number,
  ) {}

  /** Membership changed: later snapshots resolve session ids through the new roster. */
  setRoster(roster: Roster): void {
    this.roster = roster;
  }

  afterTick(tick: number, snapshotForClient: (sessionId: string) => Snapshot): void {
    if (this.snapshotEvery > 1 && tick % this.snapshotEvery !== 0) return;
    for (const client of this.room.clients) {
      const snapshot = snapshotForClient(client.sessionId);
      const previous = this.baselines.get(client.sessionId);
      client.sendBytes(MSG_SNAPSHOT, encodeSnapshot(snapshot, previous, this.roster));
      this.baselines.set(client.sessionId, snapshot);
    }
  }

  /** The next snapshot this client is sent carries every field (join, reconnect, late spectator). */
  sendFull(sessionId: string): void {
    this.baselines.delete(sessionId);
  }

  /** A client that left keeps no baseline, so a reused session id cannot decode against a stale one. */
  forget(sessionId: string): void {
    this.baselines.delete(sessionId);
  }
}
```

- [ ] **Step 5: Split the schema**

`packages/shared/src/schema/PlayerState.ts` — the decorator comes off every sim field; **the field
itself stays**, as a plain property with the same name, type and default, so `serverTick`,
`contactTick`, the combat bridge and the status bridge are untouched. Phase 3 is what moves the
state itself, into `WorldState`.

| Line | Before | After |
|---|---|---|
| 8-10 | `@type("number") x = 0;` (and `y`, `angle`) | `x = 0;` (and `y`, `angle`) |
| 18-19 | `@type("number") speed`, `@type("uint16") reverseHold` | `speed = 0;` `reverseHold = 0;` |
| 28-31 | `@type` on `angVel`, `shoveX`, `shoveY`, `authority` | plain |
| 37-40 | `@type` on `maneuver`, `maneuverTicksLeft`, `maneuverAngle`, `maneuverSpeed` | plain |
| 41-42 | `@type("uint16") hp`, `@type("boolean") alive` | plain |
| 50 | `@type("uint32") diedAtTick` | plain |
| 68 | `@type([WeaponSlotState]) weapons` | `weapons = new ArraySchema<WeaponSlotState>();` (kept as an `ArraySchema` so `writeSlots` is unchanged; it is simply no longer patched) |
| 69-70 | `@type("uint32") switchLockUntilTick`, `@type("uint8") level` | plain |
| 76, 82, 90 | `@type` on `pendingUntilTick`, `lastFiredSlot`, `lockTargetSessionId` | plain |
| 104 | `@type([StatusState]) statuses` | `statuses = new ArraySchema<StatusState>();` |
| (N1's two) | `@type("uint32") ackTick`, `@type("int8") slackTicks` | plain — the snapshot header carries both per client now, which is where they stop being room-wide |
| new, after `sessionId` | — | `/** 0..MAX_PLAYERS-1, assigned at join and published in the roster message (N9). The wire's name for this car. */`<br>`@type("uint8") carIndex = 0;` |

Each stripped field keeps its existing doc comment; append one sentence to the block above `x`:
"These are the server's working copy of the sim state and are **not** networked (N15/N24) — the
binary snapshot carries them. Invariant 8 now reads: if the shared step reads it, it is a snapshot
field."

`ArenaState.ts:32`: delete `@type({ map: WeaponInstanceState }) weapons = new MapSchema<WeaponInstanceState>();`
and the now-unused `WeaponInstanceState` / `MapSchema` imports if nothing else needs them.
`WeaponInstanceState.ts` itself stays on disk and stays exported: it is still the shape the release's
older tooling refers to, and deleting a schema class is a separate cleanup. Add one line to its
header comment: "No longer on the wire as of the phase 2 codec — live instances ride the binary
snapshot's instance section."

`combat-bridge.ts:261-288` collapses to its first line, `memory.instances = new Map(result.instances.map((i) => [i.id, i]));`, and the comment about diffing a `MapSchema` goes with the code it explained. `combat-bridge.ts:308-312`'s `clearInstances` keeps its `state` parameter (it still clears every player's `lockTargetSessionId`) and drops the two `state.weapons` lines. `tick-pipeline.ts:144` `if (state.weapons.size > 0)` → `if (ctx.combat.instances.size > 0)`.

- [ ] **Step 6: Wire the three rooms**

Each room gains, beside the fields N1 left:

```ts
private readonly shotSeq = new ShotSeqTable();
private broadcaster = new SnapshotBroadcaster(this, this.rosterOf(), NET_CONFIG.snapshotEvery);
private sharedSnapshot: { tick: number; snapshot: Snapshot } | null = null;
private lateSeen = new Map<string, number>();
```

and three private methods:

```ts
/** Car indices are dense and stable for the life of a session; the lowest free one is reused. */
private assignCarIndex(player: PlayerState): void {
  const taken = new Set<number>();
  this.state.players.forEach((p) => { if (p !== player) taken.add(p.carIndex); });
  let index = 0;
  while (taken.has(index)) index += 1;
  player.carIndex = index;
}

private rosterOf(): Roster {
  const entries: RosterEntry[] = [];
  this.state.players.forEach((p) => entries.push({ index: p.carIndex, sessionId: p.sessionId }));
  return new Roster(entries);
}

private rosterMessage(): RosterMessage {
  const entries: RosterEntry[] = [];
  this.state.players.forEach((p) => entries.push({ index: p.carIndex, sessionId: p.sessionId }));
  return { protocolHash: protocolHash(), snapshotEvery: NET_CONFIG.snapshotEvery, cars: entries };
}

/**
 * One snapshot body per tick, with only the three per-client header fields differing. Building it
 * once and spreading it is what keeps six clients at one pass over the room rather than six.
 */
private snapshotFor(sessionId: string): Snapshot {
  if (this.sharedSnapshot?.tick !== this.state.tick) {
    this.sharedSnapshot = {
      tick: this.state.tick,
      snapshot: buildSnapshot({
        state: this.state, memory: this.combat, roster: this.roster,
        shotSeq: this.shotSeq, reads: this.lastReads, events: [],
      }),
    };
  }
  const ring = this.rings.get(sessionId);
  const late = ring?.stats.late ?? 0;
  const sawLate = late > (this.lateSeen.get(sessionId) ?? 0);
  this.lateSeen.set(sessionId, late);
  return {
    ...this.sharedSnapshot.snapshot,
    ackTick: this.state.tick,
    slackTicks: this.lastReads.get(sessionId)?.slackTicks ?? 0,
    lateInput: sawLate,
  };
}
```

`this.roster` is a field refreshed by `this.refreshRoster()` — `this.roster = this.rosterOf(); this.broadcaster.setRoster(this.roster); this.broadcast(MSG_ROSTER, this.rosterMessage());` — called at the end of `onJoin` and of `onLeave`. `this.lastReads` is the `reads` map `runPipeline` returns (N1), stored on the room at the end of `tick()`.

The `wake()` N1 left becomes:

| Before | After |
|---|---|
| `this.tick(); this.broadcastPatch();` | `this.tick();`<br>`adoptQuantisedState(this.state, this.combat);`<br>`this.broadcastPatch();  // lobby and flow only now (N24) — a no-op on a tick where none of it changed`<br>`this.broadcaster.afterTick(this.state.tick, (sid) => this.snapshotFor(sid));` |

`onJoin` ends with `this.assignCarIndex(player); this.refreshRoster(); this.broadcaster.sendFull(client.sessionId);`; `onLeave` ends with `this.broadcaster.forget(client.sessionId); this.lateSeen.delete(client.sessionId); this.refreshRoster();`. Where a room resets a match (`clearInstances`), add `this.shotSeq.clear()` on the same line group — a new match starts everyone's shot sequence at 0, which is what a client rebasing from a full snapshot expects.

- [ ] **Step 7: `docs/schema-reference.md`**

Rewrite the header line to: "Colyseus `@type` fields — **lobby and match flow only** since the phase 2 codec (netcode spec N24). Everything the shared step or combat writes per tick rides the binary snapshot; see [`docs/networking.md`](networking.md) for the wire. Enums are explicit uint8; never renumber." Delete the `weapons` row from the `ArenaState` table. In the `PlayerState` table keep only `sessionId`, `status`, `name`, `colorId`, `team`, `joinedAtTick`, `carId`, `kills`, `deaths`, `killedBySessionId`, `selectLocked`, and add `carIndex | uint8 | 0 | 0..5, assigned at join and published in the roster message; the wire's name for this car`. Replace the removed rows with one paragraph naming them and pointing at `SnapshotCar`. Retitle the `StatusState` and `WeaponSlotState` sections "(no longer networked)" with one sentence each: the class survives as the server's working row and as the shape `writeStatuses`/`writeSlots` fill; the wire equivalents are `SnapshotStatus` and `SnapshotSlot`. Do the same for `WeaponInstanceState`.

- [ ] **Step 8: Run everything**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build`
Expected: PASS. Expect compile breaks in exactly two places outside `src`, both fixed here:
`playtest/weapons.ts:582` and `packages/client/src/dev/playground/overlay.ts:341` (Task 5 owns the
client one). For `weapons.ts`, W11 counted leaks twice — once in the live list and once in the schema
projection that no longer exists:

| Before | After |
|---|---|
| `const schemaRows = w.state.weapons.size;` | (deleted) |
| `if (left > 0 \|\| schemaRows > 0) leaked = true;` | `if (left > 0) leaked = true;` |
| `` `… ${left} live, ${schemaRows} schema rows` `` | `` `… ${left} live` `` |

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/schema packages/server/src/net/snapshot-source.ts packages/server/src/net/snapshot-source.test.ts packages/server/src/net/snapshot-broadcaster.ts packages/server/src/net/snapshot-broadcaster.test.ts packages/server/src/sim/combat-bridge.ts packages/server/src/rooms packages/server/playtest/weapons.ts docs/schema-reference.md
git commit -m "feat(net)!: schema keeps lobby and flow only; the server broadcasts binary snapshots (N9, N24)"
```

**Say this loudly in the commit body and in the summary to the user.** This task changes numbers the
probes measure, in two ways:

1. **The server now adopts its own quantised state every tick** (N9). Every pose, speed, knock and
   angle is rounded to 1/16 u, 1/16 u/s or 2π/65536 before the next tick reads it, so **`collision.ts`
   (penetration depth), `ram.ts` (approach speed and trigger rate), `geometry.ts` (hull clearances)
   and `prediction.ts` (correction magnitude) can all move by up to half a quantum per tick**, and a
   contact that sat exactly on a threshold can flip. None of those probes' expectations are edited
   here. **Recommend `npm run playtest` before and after this commit** and read what moved.
2. `playtest/weapons.ts`'s **W11 "Weapon instance leak" loses its second number** ("N schema rows"),
   because the schema projection it counted is deleted. The live-instance count it also reports is
   unchanged and still the probe's verdict.

---

### Task 5: The client draws from snapshots

**Files:**
- Create: `packages/client/src/match/snapshot-view.ts`
- Modify: `packages/client/src/match/frame-builder.ts` (the `FrameSource` types and the two loops), `packages/client/src/match/render-frame.ts` (the `MatchEvent` block), `packages/client/src/match/arena-net.ts` (`seed`, `onPatch`, `frame`, the context builders), `packages/client/src/scenes/ArenaScene.ts` (the room binding), `packages/client/src/dev/playground/overlay.ts:334-345`
- Test: `packages/client/src/match/snapshot-view.test.ts`, `packages/client/src/match/frame-builder.test.ts` (rewrite the fixtures), `packages/client/src/match/arena-net.test.ts` (rewrite the fixtures)

**Interfaces:**
- Consumes: Task 1's codec and `Roster`, Task 2's `MatchTransport`.
- Produces: `SnapshotView`, `FramePlayer`, `FrameInstance`; on `ArenaNet`: `seed(roster, first)`, `onSnapshot(bytes, nowMs)`, `latestSnapshot`, `rosterOf()`.

- [ ] **Step 1: Write the failing view test**

```ts
// packages/client/src/match/snapshot-view.test.ts
import { describe, expect, it } from "vitest";
import {
  ArenaState, PlayerState, PlayerStatus, RoomPhase, Roster, type Snapshot,
} from "@motor-combat-moba/shared";
import { SnapshotView } from "./snapshot-view.js";

const ROSTER = new Roster([{ index: 0, sessionId: "me" }, { index: 1, sessionId: "them" }]);

function lobby(): ArenaState {
  const s = new ArenaState();
  s.tick = 900; s.phase = RoomPhase.MATCH; s.arenaId = "arena-01";
  for (const [i, id] of ["me", "them"].entries()) {
    const p = new PlayerState();
    p.sessionId = id; p.carIndex = i; p.name = id.toUpperCase(); p.carId = "mirage";
    p.colorId = i; p.status = PlayerStatus.IN_MATCH; p.kills = i;
    s.players.set(id, p);
  }
  return s;
}

function snapshot(): Snapshot {
  const car = (index: number, x: number) => ({
    index,
    body: { x, y: 360, angle: 0, speed: 100, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0, authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0 },
    hp: 700, alive: true, onField: true, phased: false,
    lastInput: { steer: 0 as const, throttle: 1 as const, fireSlots: 0 },
    lockTargetIndex: index === 0 ? 1 : -1, shotSeq: 0, pendingUntilTick: 0, switchLockUntilTick: 0,
    lastFiredSlot: -1, level: 2, diedAtTick: 0,
    slots: [{ weaponId: "magmablast", stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0 }],
    statuses: [{ statusId: "spiked", startTick: 880, endsTick: 950, sourceIndex: 1 }],
  });
  return {
    tick: 900, full: true, lateInput: false, ackTick: 899, slackTicks: 2,
    cars: [car(0, 300), car(1, 900)],
    instances: [{ ownerIndex: 0, shotSeq: 4, weaponId: "magmablast", kind: 0, x: 500, y: 360, angle: 0, extent: 0, alive: true, isExplosion: false, homingTargetIndex: -1 }],
    events: [],
  };
}

describe("SnapshotView", () => {
  it("joins the lobby schema to the snapshot, keyed by car index", () => {
    const view = new SnapshotView();
    view.apply(snapshot(), ROSTER, lobby());
    const players: string[] = [];
    view.players.forEach((player, sessionId) => players.push(`${sessionId}:${player.name}:${player.x}:${player.hp}`));
    expect(players.sort()).toEqual(["me:ME:300:700", "them:THEM:900:700"]);
    expect(view.players.get("me")!.kills).toBe(0);
    expect(view.players.get("them")!.kills).toBe(1);
  });

  it("turns indices back into session ids for the lock and the status source", () => {
    const view = new SnapshotView();
    view.apply(snapshot(), ROSTER, lobby());
    expect(view.players.get("me")!.lockTargetSessionId).toBe("them");
    expect(view.players.get("me")!.statuses[0]!.sourceSessionId).toBe("them");
  });

  it("names an instance by owner and shot sequence and remembers the tick it first appeared on", () => {
    const view = new SnapshotView();
    view.apply(snapshot(), ROSTER, lobby());
    expect(view.instances[0]!.id).toBe("0-4");
    expect(view.instances[0]!.ownerSessionId).toBe("me");
    expect(view.instances[0]!.spawnTick).toBe(900);
    const later = { ...snapshot(), tick: 930 };
    view.apply(later, ROSTER, lobby());
    expect(view.instances[0]!.spawnTick).toBe(900);
  });

  it("forgets the spawn tick of an instance that is gone, so ids can be recycled", () => {
    const view = new SnapshotView();
    view.apply(snapshot(), ROSTER, lobby());
    view.apply({ ...snapshot(), tick: 940, instances: [] }, ROSTER, lobby());
    view.apply({ ...snapshot(), tick: 950 }, ROSTER, lobby());
    expect(view.instances[0]!.spawnTick).toBe(950);
  });

  it("satisfies buildStepContext's roster shape: status and carId per car", () => {
    const view = new SnapshotView();
    view.apply(snapshot(), ROSTER, lobby());
    const me = view.players.get("me")!;
    expect(me.status).toBe(PlayerStatus.IN_MATCH);
    expect(me.carId).toBe("mirage");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/client && npx vitest run src/match/snapshot-view.test.ts`
Expected: FAIL — cannot resolve `./snapshot-view.js`.

- [ ] **Step 3: Write the view**

```ts
// packages/client/src/match/snapshot-view.ts
import {
  instanceId,
  type PlayerState, type Roster, type Snapshot, type SnapshotCar, type StatusRow,
} from "@motor-combat-moba/shared";
import type { FrameInstance, FramePlayer } from "./frame-builder.js";

/**
 * The newest snapshot joined to the lobby schema, in the shape the rest of the client already
 * reads: `players.forEach`/`players.get` for `buildRenderFrame`, `buildStepContext` and
 * `localModifiers`, and a flat instance list for the shot renderer.
 *
 * Two halves meet here and nowhere else. The schema owns who is in the room and what they are
 * called; the snapshot owns where they are and what is happening to them. Car indices are resolved
 * back to session ids at this boundary, so nothing above it has to know an index exists.
 */
interface LobbySource {
  players: { forEach(cb: (player: PlayerState, sessionId: string) => void): void };
}

export class SnapshotView {
  private byId = new Map<string, FramePlayer>();
  private list: FrameInstance[] = [];
  /** First tick each live instance was seen. Exact for a client watching continuously — combat runs
   * inside the tick whose snapshot first carries the instance — and a tick or two late for a joiner,
   * which only shifts a flicker phase. */
  private readonly spawnTicks = new Map<string, number>();

  get players(): {
    forEach(cb: (player: FramePlayer, sessionId: string) => void): void;
    get(sessionId: string): FramePlayer | undefined;
  } {
    const byId = this.byId;
    return {
      forEach: (cb) => byId.forEach((player, sessionId) => cb(player, sessionId)),
      get: (sessionId) => byId.get(sessionId),
    };
  }

  get instances(): FrameInstance[] {
    return this.list;
  }

  apply(snapshot: Snapshot, roster: Roster, lobby: LobbySource): void {
    const lobbyById = new Map<string, PlayerState>();
    lobby.players.forEach((player, sessionId) => lobbyById.set(sessionId, player));
    const byIndex = new Map<number, SnapshotCar>();
    for (const car of snapshot.cars) byIndex.set(car.index, car);

    const next = new Map<string, FramePlayer>();
    lobbyById.forEach((lobbyPlayer, sessionId) => {
      const car = byIndex.get(lobbyPlayer.carIndex);
      if (!car) return; // in the room, not yet in a snapshot: nothing to draw for them this frame
      const statuses: StatusRow[] = car.statuses.map((row) => ({
        statusId: row.statusId, startTick: row.startTick, endsTick: row.endsTick,
        sourceSessionId: row.sourceIndex < 0 ? "" : roster.sessionIdOf(row.sourceIndex),
      }));
      next.set(sessionId, {
        sessionId,
        ...car.body,
        status: lobbyPlayer.status,
        alive: car.alive,
        onField: car.onField,
        phased: car.phased,
        hp: car.hp,
        diedAtTick: car.diedAtTick,
        level: car.level,
        switchLockUntilTick: car.switchLockUntilTick,
        pendingUntilTick: car.pendingUntilTick,
        lastFiredSlot: car.lastFiredSlot,
        lockTargetSessionId: car.lockTargetIndex < 0 ? "" : roster.sessionIdOf(car.lockTargetIndex),
        statuses,
        weapons: car.slots.map((slot) => ({ ...slot })),
        ackTick: snapshot.ackTick,
        carId: lobbyPlayer.carId,
        colorId: lobbyPlayer.colorId,
        name: lobbyPlayer.name,
        team: lobbyPlayer.team === 1 ? 1 : 0,
        joinedAtTick: lobbyPlayer.joinedAtTick,
        kills: lobbyPlayer.kills,
        deaths: lobbyPlayer.deaths,
        killedBySessionId: lobbyPlayer.killedBySessionId,
      });
    });
    this.byId = next;

    const seen = new Set<string>();
    this.list = snapshot.instances.map((instance) => {
      const id = instanceId(instance.ownerIndex, instance.shotSeq);
      seen.add(id);
      const spawnTick = this.spawnTicks.get(id) ?? snapshot.tick;
      this.spawnTicks.set(id, spawnTick);
      return {
        id,
        ownerSessionId: roster.sessionIdOf(instance.ownerIndex),
        weaponId: instance.weaponId,
        kind: instance.kind,
        x: instance.x, y: instance.y, angle: instance.angle, extent: instance.extent,
        spawnTick, alive: instance.alive, isExplosion: instance.isExplosion,
      };
    });
    for (const id of [...this.spawnTicks.keys()]) if (!seen.has(id)) this.spawnTicks.delete(id);
  }

  /** A fresh match, a reconnect, or a roster change: drop everything derived from the old stream. */
  reset(): void {
    this.byId = new Map();
    this.list = [];
    this.spawnTicks.clear();
  }
}
```

- [ ] **Step 4: Point the frame builder at the view**

`frame-builder.ts` keeps `bodyOf` and `buildRenderFrame` and changes what it is handed. The
`FrameSource` block becomes:

```ts
/** One car as the frame builder needs it: the snapshot's sim half joined to the schema's lobby half. */
export interface FramePlayer extends BodyFields {
  sessionId: string;
  status: number;
  alive: boolean;
  onField: boolean;
  phased: boolean;
  hp: number;
  diedAtTick: number;
  level: number;
  switchLockUntilTick: number;
  pendingUntilTick: number;
  lastFiredSlot: number;
  lockTargetSessionId: string;
  statuses: readonly StatusRow[];
  weapons: readonly RenderSlot[];
  /** The last input tick the server used for the local car; `RenderCar` still carries P's name. */
  ackTick: number;
  carId: string;
  colorId: number;
  name: string;
  team: number;
  joinedAtTick: number;
  kills: number;
  deaths: number;
  killedBySessionId: string;
}

export type FrameInstance = RenderInstance;

export interface FrameSource {
  tick: number; phase: number; mode: number; arenaId: string;
  countdownEndsTick: number; matchStartedAtTick: number; matchEndsTick: number;
  winnerTeam: number; winnerSessionId: string;
  players: { forEach(callback: (player: FramePlayer, sessionId: string) => void): void };
  instances: readonly FrameInstance[];
}
```

and the two loops change by substitution only:

| Before | After |
|---|---|
| `const serverPose = bodyOf(player);` | `const serverPose = bodyOf(player);` (unchanged — `FramePlayer` extends `BodyFields`) |
| `const onField = player.status === PlayerStatus.IN_MATCH;` | `const onField = player.onField;` (the snapshot already applied the mover gate) |
| `const statuses = [...player.statuses];` | `const statuses = player.statuses;` |
| `phased: isPhasedAt(statuses, state.tick),` | `phased: player.phased,` |
| `weapons: player.weapons.map(...)` | `weapons: player.weapons` |
| `lastProcessedInputSeq: player.lastProcessedInputSeq,` | `lastProcessedInputSeq: player.ackTick,` — `RenderCar` keeps the preparation plan's field name (the ledger fixes `render-frame.ts`); it now carries the snapshot's `ackTick`, and phase 3 removes it with `MatchClient` |
| `state.weapons.forEach((instance, id) => { instances.push({ id, … }); });` | `const instances = [...state.instances];` |

`render-frame.ts`: delete the local `MatchEvent` union and replace it with
`export type { MatchEvent } from "@motor-combat-moba/shared";` (ledger). Every renderer that imports
`MatchEvent` from `./render-frame.js` keeps compiling.

`frame-builder.test.ts`: replace the `PlayerState`/`ArenaState` fixtures with plain `FramePlayer`
objects and a `FrameSource` literal. Every existing assertion survives verbatim except the two the
substitution table changed (`onField` now comes from the source, `phased` likewise); add one — "an
instance list is carried through in the order it was given".

- [ ] **Step 5: `ArenaNet` consumes snapshots**

| Before (preparation plan / N1) | After |
|---|---|
| `seed(state: ArenaState): void` | `seed(roster: RosterMessage, first: Snapshot): void` — builds `this.roster = new Roster(roster.cars)`, stores `roster.protocolHash` and `snapshotEvery`, `this.view.reset()`, applies `first` as the baseline, then runs the old body's prediction seeding off the local car's body |
| `onPatch(state: ArenaState, nowMs: number): void` | `onSnapshot(bytes: Uint8Array, nowMs: number): void` — `const snap = decodeSnapshot(bytes, this.baseline, this.roster); this.baseline = snap; this.lastSnapshotAtMs = nowMs; this.stats?.countBytesIn(bytes.length); if (snap.lateInput) this.stats.lateInputs += 1;` then the **verbatim** body of `onPatch`, with `state.players.get(sid)` replaced by `this.view.players.get(sid)` and `me.ackTick` by `snap.ackTick` |
| `net.frame(state, nowMs, sampleNowMs)` | unchanged signature; its first line becomes `this.view.apply(this.baseline, this.roster, state)` when a new snapshot has arrived since the last frame, and `buildRenderFrame(this.sourceFor(state), inputs)` where `sourceFor` reads the flow fields off `state` and the two collections off the view |
| `buildStepContext(this.arena, state, this.sessionId, state.tick, mods)` | `buildStepContext(this.arena, this.view, this.sessionId, this.baseline.tick, mods)` |
| `localModifiers(state, this.sessionId, state.tick)` | `localModifiers(this.view, this.sessionId, this.baseline.tick)` |
| — | new: `get latestSnapshot(): Snapshot \| undefined`, `get roster(): Roster`, `get serverProtocolHash(): string` |

The prediction, interpolation, `poseFor`, `pumpInput` and `canDrive` bodies are **unchanged**: they
already work off a `SimBody` and a `{ alive }` duck type, and the snapshot supplies both. This phase
does not touch how the client predicts — phase 3 does.

`arena-net.test.ts`: its `matchState()` fixture keeps the `ArenaState` (still the lobby half) and
gains a snapshot builder; `net.seed(state)` becomes `net.seed({ protocolHash: "x", snapshotEvery: 1, cars: [...] }, first)`;
every `net.onPatch(state, t)` becomes `net.onSnapshot(encodeSnapshot(snap, baseline, roster), t)`;
`me.ackTick = sent[1].tick` becomes the same field on the snapshot car. Every scenario is kept.

- [ ] **Step 6: `ArenaScene` and the playground overlay**

In `ArenaScene`'s room binding (the composer's `create`, where the preparation plan left
`this.room.onStateChange(...)` feeding `net.onPatch`):

```ts
this.transport = new ColyseusTransport(this.room);
this.offRoster = this.transport.onRoster((roster) => {
  this.serverProtocolHash = roster.protocolHash;
  if (roster.protocolHash !== protocolHash()) { this.showMismatch(); return; }
  this.pendingRoster = roster;
});
this.offSnapshot = this.transport.onSnapshot((bytes) => {
  const nowMs = performance.now();
  if (this.pendingRoster) {
    // The first snapshot after a roster is always a full one (the server calls `sendFull` at join).
    this.net.seed(this.pendingRoster, decodeSnapshot(bytes, undefined, new Roster(this.pendingRoster.cars)));
    this.pendingRoster = undefined;
    return;
  }
  this.net.onSnapshot(bytes, nowMs);
});
```

and the input send becomes `(msg) => this.transport.sendInput(encodeInput(msg.tick, [msg]))`. Both
`off*` handles are called in the scene's teardown beside the listeners it already unbinds.
`showMismatch()` is the block Task 3 rewrote, hoisted into a method so both call sites use it.

`playground/overlay.ts:334-345`: `carSetupFromPlayer` loses its slot read, because slot rows are no
longer on the schema:

| Before | After |
|---|---|
| `const weapons = player!.weapons.map((slot) => slot.weaponId);`<br>`if (weapons.every(isWeaponId) && isLoadoutLegal(weapons)) { return { carId, colorId, weapons }; }`<br>`return { carId, colorId, weapons: fallback.weapons };` | `// Slot rows left the schema with the phase 2 codec (N24). The settings panel re-seeds its`<br>`// loadout from the client's own stored setup, which is the same value that was sent to the`<br>`// server in the first place; car and colour still come off the wire.`<br>`return { carId, colorId, weapons: fallback.weapons };` |

- [ ] **Step 7: Run everything**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena`
Expected: PASS, and the smoke check drives a practice car with the whole match hot path on binary.
Then play manually: `npm run dev`, Practice → Start, and confirm cars, shots, the HUD, statuses and
the kill banner all still render, and that `?debug=net` shows `bytes in` climbing at roughly
60 snapshots a second.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/match packages/client/src/scenes/ArenaScene.ts packages/client/src/dev/playground/overlay.ts
git commit -m "feat(client): render from binary snapshots through SnapshotView (N9, N24)"
```

No probe compiles against the client's frame path; `playtest/netcode.ts` is Task 6.

---

### Task 6: Measurement, the differ, and the documentation

**Files:**
- Modify: `packages/server/playtest/netcode.ts` (compile break plus the wire columns), `packages/server/playtest/README.md` (the `netcode.ts` paragraph), `docs/networking.md`, `docs/config-reference.md` (NET_CONFIG notes), `docs/project-structure.md`, `docs/glossary.md`, root `CLAUDE.md`, `packages/shared/CLAUDE.md`, `packages/server/CLAUDE.md`, `packages/client/CLAUDE.md`

**Interfaces:**
- Consumes: everything Tasks 1–5 produced.
- Produces: no new exports; the measured acceptance numbers.

- [ ] **Step 1: Fix the harness's compile break and print the wire size**

`playtest/netcode.ts` no longer has a schema patch to measure. Exactly these changes, and no new
scenario:

1. `Patch` becomes `{ bytes: Uint8Array }` and the `down` link carries `Uint8Array | PongMessage`.
   The server half builds `buildSnapshot({...})` from `world.state` and `world.combat` after
   `world.tick()` (with `adoptQuantisedState` immediately before it, as a room does), encodes it
   against a per-trial baseline with `encodeSnapshot`, and pushes the bytes.
2. The client half calls `net.onSnapshot(bytes, nowMs)` in place of writing schema fields and
   calling `net.onPatch`; the divergence lookup reads `snap.cars` for `"me"` instead of
   `msg.players.get("me")`.
3. `r.patchBytes` becomes `r.snapshotBytes`, and `r.fullBytes` records the length of the first
   (full) snapshot of the trial.
4. `PATCH_EVERY` is already `NET_CONFIG.snapshotEvery` (N1); it now gates the encode as well.
5. The N1 report row's `patch NNN B` column becomes `snap p50 NNN B p95 NNN B`, and the row's note
   gains one sentence: `` `full snapshot ${fullBytes} B (phase 2 acceptance: <= 700 B full, <= 350 B steady-state delta)` ``.
   The verdict line gains `|| worstSnapBytes > 350 || worstFullBytes > 700`.

No other row, threshold or verdict changes, and no scenario is added. Update the `netcode.ts`
paragraph in `playtest/README.md` where it says "patch bytes" to "snapshot bytes (full and delta)".

- [ ] **Step 2: Confirm the differ still runs**

`scripts/differ-replay.mjs` imports `sim/world-hash.js` from built shared, which now re-exports
`QUANT` from `net/codec.js`. The differ page serves shared's `dist` from the repo root, so the extra
module resolves the same way in the browser as in Node — and `net/codec.ts` imports nothing outside
`config/` and type-only `sim/step.js`, so no `@colyseus/schema` reaches the page.

Run: `npm run build -w @motor-combat-moba/shared && npm run differ`
Expected: `chromium: no divergence over 300 ticks`, `firefox: no divergence over 300 ticks`, exit 0.
If it exits 2 naming a module, the codec has grown an import the browser cannot load — fix the import
rather than the page.

- [ ] **Step 3: The documentation**

`docs/networking.md`: replace the message paragraph with

```markdown
Clients send inputs, never poses. The wire is binary in both directions (netcode spec N9-N12).

**Upstream**, `INPUT_MESSAGE` carries `tick u32 · count u8 · one byte per input` — steer and
throttle in two bits each, the three slot bits above them (`encodeInput`). Over the reliable
WebSocket the client sends `count = 1`, six bytes, every local tick; the run exists so an unreliable
transport can repeat the last few inputs for free. `decodeInputMessages` validates the payload and
the ring decides late, duplicate and future (N6).

**Downstream**, `MSG_SNAPSHOT` ("s") carries one hand-packed snapshot per tick per client,
delta-compressed against the previous snapshot that client was sent. Positions are 1/16 unit, angles
2pi/65536, speeds and knocks 1/16 u/s, ticks relative to the header tick. Every live car and
instance is listed on every snapshot; only unchanged *fields* are omitted, so a car or instance
absent from the list is gone. A full snapshot of six cars and twenty instances is 683 bytes; a
steady-state delta is about 125. `NET_CONFIG.snapshotEvery` is the divisor knob (1 by default, 2 for
a host whose upload cannot carry 60 Hz).

**The server adopts its own quantised state** after every tick (`adoptQuantisedState`): what the
client receives *is* the server's state, so a resim from a snapshot reproduces the server rather
than sitting a fraction of a quantum off it, and an unchanged field is bit-identical, which is what
makes the delta mask work at all.

Session ids do not appear on the hot path. Each car has an index assigned at join and published on
`MSG_ROSTER`, which also carries `protocolHash()` — a hash of the codec version, the tick rate and
every balance table. The client computes the same from its own build and refuses a mismatch (N11);
this replaced the old arena-id mismatch check, and the playground re-sends it after every
`setTuning`. `MatchTransport` (`packages/client/src/match/transport.ts`) is the seam the bytes cross:
`ColyseusTransport` today, `LoopbackTransport` for tests and the harness.

The Colyseus schema keeps lobby and match flow only (N24) and is still patched inside the tick.
```

Root `CLAUDE.md`: invariant 8 becomes "If the shared step reads it, it is a **snapshot** field — the
Colyseus schema carries lobby and flow only (netcode spec N15/N24)."; the "Arena mismatch" paragraph
in the shared-`dist` gotcha section is retitled to the build-mismatch message and quotes the new
wording. `packages/shared/CLAUDE.md` gains one line under P0 naming `net/codec.ts`, `net/roster.ts`,
`net/events.ts` and `net/protocol-hash.ts` and the rule that the codec is the only file that knows a
byte offset. `packages/server/CLAUDE.md`'s first paragraph gains "…and broadcasts one binary
snapshot per client per tick through `SnapshotBroadcaster`, after rounding its own state onto the
wire's grid." `packages/client/CLAUDE.md`'s third paragraph replaces "reconciles against each state
patch" with "reconciles against each binary snapshot" and adds: "the schema no longer carries poses,
hp, statuses, slots or instances — `SnapshotView` joins the newest snapshot to the lobby schema and
everything above it reads that."

`docs/config-reference.md`: in the `NET_CONFIG` table, `snapshotEvery`'s note becomes "Ticks between
binary snapshots. 1 = every tick; 2 halves the downstream rate for a host whose upload cannot carry
60 Hz. Published to clients in the roster message." `docs/glossary.md`: **Snapshot** becomes "one
binary `MSG_SNAPSHOT` frame describing the end of one whole tick, delta-compressed per client"; add
**Car index** and **Protocol hash**. `docs/project-structure.md`: add `net/codec.ts`, `net/roster.ts`,
`net/events.ts`, `net/protocol-hash.ts` under shared `net/`; `net/snapshot-source.ts` and
`net/snapshot-broadcaster.ts` under server `net/`; `match/transport.ts` and `match/snapshot-view.ts`
under client `match/`.

- [ ] **Step 4: The acceptance run**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena && npm run differ && cd packages/server && npx tsx playtest/netcode.ts`
Expected: all green; `netcode.md`'s N1 row reports `full snapshot 683 B` (or lower, with fewer
statuses live) and a steady-state `snap p95` in the low hundreds, and reads `OK`.

Then the join refusal, by hand: `npm run dev`, join a practice match, and confirm it starts. Stop the
server, change one number in `packages/shared/src/config/drive-config.ts`, rebuild shared, restart
**only** the server, and reload the still-open tab **without** a hard refresh: the join is refused
and the page shows "Build mismatch." naming both hashes. Revert the number.

- [ ] **Step 5: Commit**

```bash
git add packages/server/playtest/netcode.ts packages/server/playtest/README.md docs CLAUDE.md packages/shared/CLAUDE.md packages/server/CLAUDE.md packages/client/CLAUDE.md
git commit -m "docs(net): the binary wire, the schema split and the protocol hash (netcode phase 2)"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Probe note for the summary, again and last:** `playtest/netcode.ts` changed one printed column
(`patch B` → `snap p50/p95 B` plus a full-snapshot figure in the note) because the thing it measured
— a Colyseus schema patch — no longer exists; its scenarios, thresholds and verdict logic are
otherwise untouched. The quantisation adopt rule from Task 4 is the change that can move
`collision.ts`, `ram.ts`, `geometry.ts` and `prediction.ts`; **recommend a full `npm run playtest`
across this phase and read what moved.**

---

## Acceptance

Spec §8, phase 2 row: **Ships** — "binary snapshot and input codec with delta compression,
`snapshotEvery` knob, car indices, `lastInput`, `shotSeq`, `homingTarget`, protocol hash, schema
split (N24), delete `TICK_RATE_HZ` override". **Fixes** — "F9, F10". **Acceptance** — "full snapshot
≤ 700 B, delta steady state ≤ 350 B; join refuses a mismatched build".

| Requirement | Demonstrated by |
|---|---|
| Full snapshot ≤ 700 B | `cd packages/shared && npx vitest run src/net/codec.test.ts` — "encodes a full 6-car, 20-instance snapshot in 683 bytes"; and the live figure in `playtest/netcode.ts`'s N1 note (Task 6 Step 4) |
| Delta steady state ≤ 350 B | the same suite — 125 B steady state, 336 B for the contact-and-volley worst case, 31 B for an idle room; and the N1 row's `snap p95` column |
| Join refuses a mismatched build | `cd packages/shared && npx vitest run src/net/protocol-hash.test.ts`; the by-hand rebuild-one-side check in Task 6 Step 4; `ServerError(4004, PROTOCOL_MISMATCH_ERROR)` in all three rooms |
| Binary snapshot and input codec with delta compression | Task 1's round-trip, delta, removal and new-row tests; Task 2's transport tests |
| `snapshotEvery` knob | `cd packages/server && npx vitest run src/net/snapshot-broadcaster.test.ts` — "sends nothing on the ticks `snapshotEvery` skips" |
| Car indices | `PlayerState.carIndex`, `MSG_ROSTER`, `Roster`; `snapshot-source.test.ts` "lists cars by index with their lock as an index" |
| `lastInput`, `shotSeq`, `homingTarget` | `snapshot-source.test.ts` — the `lastInput` assertion and "gives each owner its own shot sequence, stable for the life of the instance" (which also pins `homingTargetIndex`) |
| Schema split (N24) | `docs/schema-reference.md` rewritten in Task 4 Step 7; `grep -n "@type" packages/shared/src/schema/PlayerState.ts` lists exactly the twelve lobby fields plus `carIndex`; `ArenaState.weapons` is gone |
| `TICK_RATE_HZ` override deleted | `node --test scripts/tick-rate-override.test.mjs` (deleted in phase 1; this is what keeps it deleted) and `TICK_RATE_HZ` inside `protocolHash` |
| Nothing else regressed | `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena && npm run differ` |

## Handoff

Exports and behaviour this plan produces **beyond** the ledger, for N3 and later to consume:

- **Shared.** `net/codec.ts`: `MSG_SNAPSHOT` (`"s"`), `ANG_VEL_SCALE`, `AUTHORITY_STEPS`;
  `Snapshot.lateInput: boolean` (the header flag that feeds `NetStats.lateInputs`);
  `SnapshotCar.level` and `SnapshotCar.diedAtTick` (the ledger's field list omits both, and the HUD's
  weapon level and the death fade have no other source now that the schema does not carry them).
  `quantizePos` and `quantizeAngle` (the scalar pair the server needs for a weapon instance, which has
  no `SimBody`). `net/roster.ts`: `isRosterMessage`, `PROTOCOL_MISMATCH_ERROR`. `net/protocol-hash.ts`:
  `protocolHashInput()`. `sim/world-hash.ts`: `HASH_QUANT` **is** `QUANT` — identity, pinned by a
  test — and the speed term now uses `QUANT.speedPerUnit`.
- **Schema.** Every sim field survives on `PlayerState` as a plain, un-decorated property with its
  old name and default; only the wire changed. Phase 3's `sim/world.ts` `CarState` is where the state
  itself moves, and that is the phase that may delete them. `WeaponInstanceState`, `WeaponSlotState`
  and `StatusState` remain as the server's working row shapes and are no longer networked.
- **Server.** `net/snapshot-source.ts`: `ShotSeqTable` (`seqOf`, `countOf`, `sweep`, `clear`),
  `buildSnapshot(ctx)`, `SnapshotSourceCtx`, `adoptQuantisedState(state, memory)`.
  `net/snapshot-broadcaster.ts`: `SnapshotBroadcaster.setRoster(roster)` and `.forget(sessionId)`
  beside the ledger's `afterTick`/`sendFull`. `net/input-message.ts`: `decodeInputMessages(payload,
  maxTick)` replaces `isInputMessage`. On each room: `assignCarIndex`, `rosterOf()`,
  `rosterMessage()`, `refreshRoster()`, `snapshotFor(sessionId)`, and the `lastReads` field holding
  N1's `runPipeline(...).reads`.
- **Client.** `match/transport.ts`: `LoopbackTransport`'s server half — `onClientInput`,
  `onClientPing`, `pushSnapshot`, `pushPong`, `pushRoster` — which is what the phase 3 harness drives.
  `match/snapshot-view.ts`: `SnapshotView` (`apply`, `players`, `instances`, `reset`).
  `match/frame-builder.ts`: `FramePlayer`, `FrameInstance`, and a `FrameSource` that no longer names
  a schema class. On `ArenaNet`: `latestSnapshot`, `roster`, `serverProtocolHash`, and
  `seed(roster, first)` / `onSnapshot(bytes, nowMs)` — the two members `MatchClient` keeps by name in
  phase 3. `RenderCar.lastProcessedInputSeq` now carries the snapshot's `ackTick`; the ledger fixes
  `render-frame.ts`, so the field keeps the preparation plan's name until phase 3 removes it with
  `MatchClient`.
- **Left for phase 3, deliberately.** The client still predicts only the local car and still
  interpolates remotes through `InterpolationBuffer` and `NET_CONFIG.interpolationDelayMs`; nothing
  about prediction changed here. `Snapshot.events` is always empty — the codec carries the section
  and round-trips every kind, and phase 4 is what fills it. `SnapshotCar.shotSeq` and the per-instance
  sequence are on the wire and stable, but nothing predicts them yet; if phase 4's ghost matching
  needs a stronger guarantee than "assigned in `runCombat`'s output order", `ShotSeqTable` is the one
  place to move into the sim.
- **Not done here, on purpose.** `playtest/lan.ts` still speaks the old message shapes and is an
  existing probe this plan does not edit — it is listed for the user to ask for. The six probe report
  strings that quote schema-patch bytes are likewise untouched beyond the one compile break in
  `weapons.ts`.

## Self-review

**Spec coverage.** N9: Task 1 (layout, quantisation, delta with the full fallback), Task 4 (the
server adopting its own quantised state, `snapshotEvery`, the per-client baseline, one snapshot per
tick inside the tick). N10: Task 1 (`encodeInput`/`decodeInput`, the run) and Task 2 (the server
intake). N10a: **not this phase** — key-event sampling is a client input change phase 4 owns; nothing
here depends on it. N11: Task 3 (the hash, the join refusal, the playground re-send, the override
guard). N12: Task 2 (`MatchTransport`, `ColyseusTransport`, `LoopbackTransport`). N15/N24: Task 4
(the schema split and `docs/schema-reference.md`) and Task 5 (the client half). §6.12: a decode error
throws out of `decodeSnapshot` (a delta with no baseline, a delta naming an unknown car or instance,
a truncated payload) so the room drops the connection rather than rendering garbage; a build mismatch
is refused at join with a message naming it. §6.13: the snapshot is built once per tick and spread
per client, and the delta is a mask compare — no per-client pass over the world. §7: the codec's
byte-budget tests plus the harness's snapshot-bytes column; the differ keeps running because
`HASH_QUANT` is now the codec's own `QUANT`, pinned by a test, so the hash and the wire cannot drift
apart. §8 phase 2: the acceptance table above.

**Placeholder scan.** Every new module is printed in full; every edit to an existing file is a
line-cited substitution table; every test file is real code with real expected values (683, 336, 125
and 31 bytes are computed from the layout table in Task 1 and stated there as the authority).

**Type consistency.** `Snapshot`, `SnapshotCar`, `SnapshotInstance`, `SnapshotSlot` and
`SnapshotStatus` (Task 1) are what `buildSnapshot` produces (Task 4), what `SnapshotBroadcaster`
encodes (Task 4), and what `SnapshotView.apply` reads (Task 5). `Roster` (Task 1) is constructed from
`RosterMessage.cars` on both sides and is the third argument to `encodeSnapshot`/`decodeSnapshot`
everywhere. `RingRead` (N1) is the value type of `SnapshotSourceCtx.reads` and the source of both
`SnapshotCar.lastInput` and the header's `slackTicks`. `FramePlayer`/`FrameInstance` (Task 5) are
what `SnapshotView` fills and what `buildRenderFrame` consumes; `RenderCar` and `RenderSlot` are the
preparation plan's, unchanged. `decodeInputMessages` returns the `InputMessage[]` that
`InputRing.accept` takes.
