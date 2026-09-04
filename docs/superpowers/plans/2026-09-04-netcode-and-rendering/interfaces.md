# Interface ledger for the netcode and rendering plans

Every plan in this folder produces and consumes the names below **exactly**. A plan may add
exports beyond these; it may not rename, reshape or relocate one listed here without editing this
file in the same commit. Phases are named `N0`–`N6` (netcode, spec
[`2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md))
and `V0`–`V5` (rendering, spec
[`2026-09-04-client-rendering-architecture-design.md`](../../specs/2026-09-04-client-rendering-architecture-design.md));
`P` is the preparation plan (`01-prep-…`). "Produced by" is the plan that creates the name;
"consumed by" lists every later plan that relies on it.

Types are TypeScript. Shared modules live under `packages/shared/src`, server under
`packages/server/src`, client under `packages/client/src`. Every local import carries a `.js`
specifier; shared is imported as `@motor-combat-moba/shared` and consumed as built `dist`.

---

## Shared

### `constants.ts`

| Name | Value | Produced | Consumed |
|---|---|---|---|
| `TICK_RATE_HZ` | `60` (was 30) | N1 | everything |
| `MS_PER_TICK` | `1000 / TICK_RATE_HZ` | existing | everything |
| `DEFAULT_PATCH_RATE_HZ` | **deleted** in N1; snapshots are on the tick | N1 | — |

### `config/net-config.ts` — `NET_CONFIG`

| Key | Value | Produced | Notes |
|---|---|---|---|
| `interpolationDelayMs` | `67` (N0), **deleted** in N3 | N0 | the one-constant fix for the shipped zero-headroom buffer |
| `maxInputsPerTick`, `pendingInputCap` | **deleted** in N1 | N1 | replaced by the input ring |
| `reconcileSnapPos`, `reconcileSnapAngle`, `reconcileEaseRate` | unchanged until **deleted** in N3 | N3 | replaced by resim + render offsets |
| `snapshotEvery` | `1` | N1 | ticks between snapshots; `2` is the constrained-upload fallback |
| `ringSize` | `128` | N1 | input ring length in ticks |
| `repeatMaxTicks` | `12` | N1 | 200 ms of repeated input before neutral |
| `maxCatchUpTicks` | `6` | N1 | server and client catch-up cap per wake/frame |
| `leadMin`, `leadMax` | `2`, `16` | N1 | ticks |
| `slackTargetMin`, `slackTargetMax` | `2`, `3` | N1 | ticks; the note's measured floor at 60 Hz |
| `slackWindowTicks` | `120` | N1 | 2 s window for the 5th-percentile test |
| `leadLowerHoldMs` | `5000` | N1 | how long the median must sit above `slackTargetMax + 1` before lead drops |
| `dilationMax` | `0.1` | N1 | ±10 % tick-period dilation |
| `reanchorTicks` | `4` | N1 | a clock target move beyond this jumps instead of dilating |
| `pingIntervalMs` | `500` | N0 | |
| `clockSamples` | `8` | N0 | lowest-RTT-of-N offset |
| `bufferTicksMax` | `4` | N3 | jitter buffer clamp |
| `maxPredictionTicks` | `30` | N3 | 500 ms predict-through before freezing |
| `maxExtrapolationTicks` | `8` | N3 | remote extrapolation cap |
| `correctionMs` | `120` | N3 | render-offset decay |
| `snapUnits`, `snapRadians` | `48`, `Math.PI / 2` | N3 | a correction past these is applied without an offset and counted |
| `remoteSteerHoldTicks` | `6` | N3 | how long an extrapolated remote keeps a held steer |
| `ghostGraceTicks` | `2` | N4 | ghost expiry is `lead + rttTicks + ghostGraceTicks` |
| `reconnectSeconds` | `60` | N5 | |
| `silenceWarnMs` | `2000` | N5 | |
| `floodRateMultiple`, `floodDisconnectMs` | `3`, `10000` | N5 | |

### `net/ping.ts` — produced N0, consumed N1 (dilation), N5

```ts
export const PING_MESSAGE = "ping";
export const PONG_MESSAGE = "pong";
export interface PingMessage { clientMs: number }
export interface PongMessage { clientMs: number; serverTick: number; msIntoTick: number }
export function isPingMessage(value: unknown): value is PingMessage;
```

### `net/input.ts` — reshaped N1, consumed by everything after

```ts
export const INPUT_MESSAGE = "input";                 // unchanged name
export interface InputFrame { steer: -1 | 0 | 1; throttle: -1 | 0 | 1; fireSlots: number }
export interface InputMessage extends InputFrame { tick: number }   // `seq` is gone
export const NEUTRAL_INPUT: Readonly<InputFrame>;     // { steer: 0, throttle: 0, fireSlots: 0 }
```

`stepSim(body, input: InputFrame, dt, ctx)` — N1 widens the parameter type from `InputMessage` to
`InputFrame`; every existing caller still compiles.

### `net/events.ts` — produced N2 (moved from client `match/render-frame.ts`), consumed N4, V4

```ts
export type MatchEvent =
  | { kind: "hit"; tick: number; attacker: string; victim: string; weaponId: string; x: number; y: number; damage: number }
  | { kind: "kill"; tick: number; killer: string; victim: string }
  | { kind: "ram"; tick: number; attacker: string; victim: string; x: number; y: number; severity: number }
  | { kind: "slam"; tick: number; car: string; x: number; y: number }
  | { kind: "respawn"; tick: number; car: string }
  | { kind: "refused"; tick: number; car: string; slot: number };
```

Car fields are **session ids** at this level; the codec maps them to car indices on the wire.

### `net/codec.ts` — produced N2, consumed N3, N4, N5, N6

```ts
export const PROTOCOL_VERSION = 1;
export const QUANT = { posPerUnit: 16, angleSteps: 65536, speedPerUnit: 16 } as const;

export interface SnapshotSlot { weaponId: string; stocks: number; rechargeEndsTick: number; refireLockUntilTick: number }
export interface SnapshotStatus { statusId: string; startTick: number; endsTick: number; sourceIndex: number }  // -1 = world
export interface SnapshotCar {
  index: number;
  body: SimBody;                 // quantised
  hp: number;
  alive: boolean;
  onField: boolean;
  phased: boolean;
  lastInput: InputFrame;
  lockTargetIndex: number;       // -1 none
  shotSeq: number;
  pendingUntilTick: number;
  switchLockUntilTick: number;
  lastFiredSlot: number;
  slots: SnapshotSlot[];
  statuses: SnapshotStatus[];
}
export interface SnapshotInstance {
  ownerIndex: number; shotSeq: number; weaponId: string; kind: number;
  x: number; y: number; angle: number; extent: number; alive: boolean; isExplosion: boolean;
  homingTargetIndex: number;     // -1 none
}
export interface Snapshot {
  tick: number;
  full: boolean;                 // true = every field present; false = delta against the previous snapshot
  ackTick: number;               // last input tick used for this client
  slackTicks: number;            // how early that input arrived; negative = repeat used
  cars: SnapshotCar[];
  instances: SnapshotInstance[];
  events: MatchEvent[];          // encoded with car indices, decoded back to session ids via the roster
}
export function instanceId(ownerIndex: number, shotSeq: number): string;      // `${ownerIndex}-${shotSeq}`
export function quantizeBody(body: SimBody): SimBody;                          // the server adopts this
export function encodeSnapshot(snapshot: Snapshot, previous: Snapshot | undefined, roster: Roster): Uint8Array;
export function decodeSnapshot(bytes: Uint8Array, previous: Snapshot | undefined, roster: Roster): Snapshot;
export function encodeInput(tick: number, inputs: readonly InputFrame[]): Uint8Array;  // inputs for tick-count+1 … tick
export function decodeInput(bytes: Uint8Array): { tick: number; inputs: InputFrame[] };
export function encodePong(pong: PongMessage): Uint8Array;
export function decodePong(bytes: Uint8Array): PongMessage;
```

`Roster` is `net/roster.ts` below. `SimBody.angle` is wrapped to `[0, 2π)` by `quantizeBody`.

### `net/roster.ts` — produced N2, consumed N3+

```ts
export const MSG_ROSTER = "roster";
export interface RosterEntry { index: number; sessionId: string }
export interface RosterMessage { protocolHash: string; snapshotEvery: number; cars: RosterEntry[] }
export class Roster {
  constructor(entries: readonly RosterEntry[]);
  indexOf(sessionId: string): number;      // -1 unknown
  sessionIdOf(index: number): string;      // "" unknown
  readonly size: number;
}
```

### `net/protocol-hash.ts` — produced N2

```ts
export function protocolHash(): string;   // stable hash over PROTOCOL_VERSION, TICK_RATE_HZ, CAR_TABLE, WEAPON_TABLE, STATUS_TABLE, DRIVE_CONFIG, RAM_CONFIG, COMBAT_CONFIG, AIM_CONFIG, SLAM_CONFIG, DEATHMATCH_CONFIG, the arena registry
```

### `sim/world.ts` — produced N3, consumed N4 and every later server change

```ts
export interface CarState extends SimBody {
  index: number;
  sessionId: string;
  carId: CarId;
  onField: boolean;
  phased: boolean;
  statuses: readonly StatusRow[];
}
export interface SlamClocks { stunWindowUntilTick: number; immuneUntilTick: number }
export interface ContactMemoryState {
  touching: ReadonlySet<string>;                 // "a|b" with a < b by session id
  slammed: ReadonlyMap<string, SlamClocks>;      // by session id
}
export interface WorldState { tick: number; cars: readonly CarState[]; contact: ContactMemoryState }  // cars sorted by index
export interface ContactEvent {
  kind: "ram" | "slam" | "dashHit";
  attacker: string; victim: string; x: number; y: number; severity: number; tick: number;
}
export interface WorldStepResult { world: WorldState; contactEvents: ContactEvent[]; approachSpeeds: ReadonlyMap<string, number> }
export function stepWorld(world: WorldState, inputs: ReadonlyMap<string, InputFrame>, arena: ArenaDef): WorldStepResult;
```

`stepSim` is unchanged inside it. The server's `runPipeline` calls `stepWorld` in place of
`serverTick` + `contactTick`; `runCombat` is untouched and consumes `contactEvents` where it
consumed `contactHits` and `statusRequests`.

### Schema (`schema/PlayerState.ts`, `schema/ArenaState.ts`)

| Change | Phase |
|---|---|
| `PlayerState.lastProcessedInputSeq` → **removed**; `ackTick: uint32` and `slackTicks: int8` added | N1 |
| Every sim field leaves `PlayerState` (`x, y, angle, speed, reverseHold, angVel, shoveX, shoveY, authority, maneuver*, hp, alive, diedAtTick, weapons, switchLockUntilTick, pendingUntilTick, lastFiredSlot, lockTargetSessionId, statuses, level, ackTick, slackTicks`); `carIndex: uint8` added. `ArenaState.weapons` removed. Lobby fields stay: `sessionId, name, colorId, team, status, carId, selectLocked, joinedAtTick, kills, deaths, killedBySessionId` | N2 |
| `ArenaState.tick` stays (flow deadlines read it) | — |

---

## Server

### `net/tick-scheduler.ts` — N1

```ts
export class TickScheduler {
  constructor(periodMs: number, onTick: (tick: number) => void, opts?: { maxCatchUpTicks?: number; now?: () => number; setTimeout?: typeof setTimeout });
  start(): void;
  stop(): void;
  readonly tick: number;
  /** Milliseconds into the current tick period, for pong. */
  msIntoTick(nowMs?: number): number;
}
```

### `net/input-ring.ts` — N1

```ts
export type AcceptResult = "accepted" | "late" | "duplicate" | "future" | "malformed";
export interface RingRead { input: InputFrame; source: "fresh" | "repeat" | "neutral"; slackTicks: number }
export class InputRing {
  constructor(opts?: { size?: number; repeatMaxTicks?: number });
  accept(msg: InputMessage, arrivalTick: number): AcceptResult;
  inputFor(tick: number): RingRead;
  readonly stats: { late: number; duplicate: number; future: number; repeated: number; neutral: number };
}
```

### `rooms/ping-handler.ts` — N0

```ts
export function bindPing(room: Room, clock: () => { tick: number; msIntoTick: number }): void;
```

### `net/input-log.ts` — N0

```ts
export class InputLog {
  constructor(dir: string);                       // gitignored packages/server/logs/<yyyy-MM-dd-NN>/
  record(tick: number, sessionId: string, input: InputFrame): void;
  flush(): Promise<void>;
}
```

### `net/snapshot-broadcaster.ts` — N2

```ts
export class SnapshotBroadcaster {
  constructor(room: Room, roster: Roster, snapshotEvery: number);
  afterTick(tick: number, snapshotForClient: (sessionId: string) => Snapshot): void;   // encodes deltas per client, sends via client.sendBytes
  sendFull(sessionId: string): void;              // join and reconnect
}
```

### `net/differ.ts` — N0

```ts
export function worldHash(cars: readonly SimBody[], contacts: readonly string[]): string;   // FNV-1a over quantised poses and the sorted contact-pair list
```

---

## Client

### `match/render-frame.ts` — P; N2 re-exports `MatchEvent` from shared instead of defining it

Unchanged from the preparation plan. `RenderFrame.events` is empty until N4.

### `match/arena-net.ts` — P; **replaced** by `match/match-client.ts` in N3

Same public surface, renamed:

```ts
export class MatchClient {
  constructor(arena: ArenaDef, sessionId: string, transport: MatchTransport, clock: ClockSync, stats: NetStats);
  seed(roster: RosterMessage, first: Snapshot): void;
  pumpInput(deltaMs: number, sample: () => RawInput): PumpResult;     // sends through the transport
  onSnapshot(bytes: Uint8Array, nowMs: number): void;
  frame(nowMs: number): RenderFrame;
  readonly localTick: number;
  readonly predictedPose: SimBody | undefined;
}
```

`RawInput` and `PumpResult` keep the preparation plan's shapes.

### `match/clock.ts` — N0

```ts
export class ClockSync {
  constructor(opts?: { samples?: number });
  onPong(pong: PongMessage, nowMs: number): void;
  readonly rttMs: number;          // of the lowest-RTT sample
  readonly jitterMs: number;       // standard deviation of RTT over the window
  readonly ready: boolean;         // at least one sample
  serverTickAt(nowMs: number): number;   // fractional
}
```

### `match/lead.ts` — N1

```ts
export class LeadController {
  constructor(cfg: Pick<typeof NET_CONFIG, "leadMin" | "leadMax" | "slackTargetMin" | "slackTargetMax" | "slackWindowTicks" | "leadLowerHoldMs">);
  initial(rttMs: number, jitterMs: number): number;
  observe(slackTicks: number, nowMs: number): void;
  readonly lead: number;
}
```

### `match/tick-loop.ts` — N1

```ts
export class TickLoop {
  constructor(cfg: Pick<typeof NET_CONFIG, "maxCatchUpTicks" | "dilationMax" | "reanchorTicks">);
  /** Returns how many local ticks to run this frame; dilates the period toward `targetTick`. */
  advance(deltaMs: number, targetTick: number): number;
  readonly localTick: number;
  readonly fraction: number;       // [0, 1) through the current tick, for the render blend
  reanchor(tick: number): void;
}
```

### `match/netgraph.ts` — N0

```ts
export class NetStats {
  rttMs: number; jitterMs: number; lead: number;
  slack: number[];                 // ring of the last slackWindowTicks values
  lateInputs: number; repeatedInputs: number;
  corrections: number; snaps: number;
  bytesIn: number; bytesOut: number;
  view(): NetStatsView;            // plain object for the overlay
}
```

`scenes/arena/netgraph-overlay.ts` renders `NetStatsView` when `?debug=net` is set (V0 adds the
perf counters beside it).

### `match/transport.ts` — N2

```ts
export interface MatchTransport {
  sendInput(bytes: Uint8Array): void;
  sendPing(ping: PingMessage): void;
  onSnapshot(cb: (bytes: Uint8Array) => void): () => void;
  onPong(cb: (pong: PongMessage) => void): () => void;
  onRoster(cb: (roster: RosterMessage) => void): () => void;
}
export class ColyseusTransport implements MatchTransport { constructor(room: Room<ArenaState>) }
export class LoopbackTransport implements MatchTransport { /* for tests and the harness; pairs with a server-side peer */ }
```

### `match/prediction.ts` — N3

```ts
export class WorldPredictor {
  constructor(arena: ArenaDef, cfg: Pick<typeof NET_CONFIG, "maxPredictionTicks" | "maxExtrapolationTicks" | "remoteSteerHoldTicks">);
  setBaseline(world: WorldState, inputsEcho: ReadonlyMap<string, InputFrame>): void;
  predictTick(localTick: number, localInput: InputFrame): WorldState;
  worldAt(tick: number): WorldState | undefined;
  /** Re-simulate from a new baseline; returns per-car deltas for the render offsets. */
  resim(localTick: number, localInputs: (tick: number) => InputFrame): ReadonlyMap<string, { dx: number; dy: number; dAngle: number }>;
}
```

### `match/render-offset.ts` — N3

```ts
export class RenderOffsets {
  constructor(cfg: Pick<typeof NET_CONFIG, "correctionMs" | "snapUnits" | "snapRadians">, stats: NetStats);
  add(sessionId: string, dx: number, dy: number, dAngle: number): void;   // counts a snap when past the thresholds and applies none
  decay(deltaMs: number): void;
  offsetOf(sessionId: string): { dx: number; dy: number; dAngle: number };
}
```

### `match/fire-prediction.ts` — N4

```ts
export class FirePrediction {
  constructor(cfg: Pick<typeof NET_CONFIG, "ghostGraceTicks">);
  rebase(car: SnapshotCar, tick: number): void;
  press(localTick: number, fireSlots: number, prevFireSlots: number): GhostSpawn[];   // runs beginFire/releaseShots
  confirm(instances: readonly SnapshotInstance[], tick: number): void;
  expired(localTick: number, leadPlusRtt: number): string[];   // ghost ids removed
  readonly ghosts: readonly GhostInstance[];
}
export interface GhostInstance extends RenderInstance { ghost: true }
export interface GhostSpawn { id: string; weaponId: string; slot: number }
```

### Rendering (V-plans)

| Module | Exports | Produced | Consumed |
|---|---|---|---|
| `render/perf-overlay.ts` | `class PerfOverlay { constructor(scene); frameStart(); mark(label); frameEnd(); }` — draws frame-time split, draw calls, particles, tier | V0 | V1–V5 |
| `dev/BenchScene.ts` | Phaser scene key `"bench"`, reachable by `?dev=bench`, stripped from release like the playground | V0 | V1–V5 |
| `scripts/bench-visual.mjs` | node microbenchmark of the pure builders at the ceiling | V0 | V2, V3 |
| `scripts/bench-arena.mjs` | Playwright runner for the bench scene on Chromium and Firefox; prints p50/p95 | V0 | CI |
| `scenes/HudScene.ts` | Phaser scene key `"hud"`, launched in parallel by `ArenaScene`; reads the same `RenderFrame` through `registry.get("frame")` | V1 | V2–V5 |
| `render/fonts.ts` | `HUD_FONT = "hud-font"`; `scripts/build-bitmap-font.mjs` writes `public/art/fonts/hud-font.png` + `.xml` | V1 | V4, V5 |
| `render/bake.ts` | `bakeAtlas(scene, tier): Promise<void>`; frame names `baked.<name>` | V2 | V3, V4 |
| `render/atlas.ts` | `ART_ATLAS = "art-atlas"`, `BAKED_ATLAS = "baked-atlas"`; `scripts/pack-atlas.mjs` writes `public/art/art-atlas.{png,json}` | V2 | V3, V4 |
| `render/layers.ts` | `enum Layer { Floor, Decals, GroundFx, Cars, Shots, Glow, OverlayFx, Debug }` with depths; replaces the per-renderer depth constants | V2 | V3–V5 |
| `render/beams.ts` | `class BeamRenderer` (flipbook flame, rope bolt, sprite zones) | V3 | V4 |
| `render/particles.ts` | `class ParticleService { burst(kind, x, y, count, priority); stream(kind, follow, rate); setCap(n) }` | V4 | V5 |
| `render/decals.ts` | `class DecalService { place(def: DecalDef, x, y, angle) }`, `DECAL_CONFIG` in `config/decals.ts`, empty `DECAL_DEFS` table | V4 | — |
| `render/effects.ts` | `class EffectRouter { onEvents(events: readonly MatchEvent[]) }` — events → sparks, flashes, shake | V4 | — |
| `render/tiers.ts` | `type Tier = "low" \| "medium" \| "high"`, `TIER_TABLE`, `class TierManager` | V5 | — |
| `render/governor.ts` | `class FrameGovernor { observe(frameMs); allowCosmetic(): boolean }` | V5 | — |

---

## Cross-stream couplings

1. N1 lands before V3: beam timings are authored once at 60 Hz.
2. V4 consumes `RenderFrame.events`, which N4 fills; V4's bench scene synthesises events until then.
3. Both streams edit `ArenaScene.ts` only through the seams the preparation plan leaves: the net
   stream replaces `ArenaNet` with `MatchClient` behind the same `frame()`; the render stream
   replaces renderer classes behind the same `render(frame)`.
4. `packages/shared` is edited by the net stream only; a rendering plan that needs a shared change
   says so in its header and lands it as a separate commit first.
