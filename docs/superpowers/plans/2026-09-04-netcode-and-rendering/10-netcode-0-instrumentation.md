# Netcode Phase 0: Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put numbers on the shipped netcode before any of it changes — ping/pong clock sync with an RTT and jitter estimate, an in-client netgraph, a server-side input log, a headless netcode harness driven by the real `ArenaNet`, a cross-engine determinism differ — and land the one-constant fix (`interpolationDelayMs` 50 → 67) with a before/after measurement.

**Architecture:** Every measurement rides beside the existing sim rather than through it: ping/pong are ordinary Colyseus messages bound by one `bindPing` helper in all three rooms; the input log records what `serverTick` is about to drain; the client's `ClockSync`, `NetStats` and `PoseHistory` are pure modules under `match/` that `ArenaNet` feeds and the scene draws through one `NetgraphOverlay`. The harness (`playtest/netcode.ts`) runs `PlaytestWorld` and a real `ArenaNet` over a seeded link model and reports; it never asserts. The differ hashes quantised poses **and** contact sets in shared code that both Node and a browser can load, so Chromium and Firefox replay the same log and are compared tick by tick.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest (node environment) in every package, `node --test` for `scripts/*.test.mjs`, Colyseus 0.15 (`room.onMessage` / `client.send`), Playwright 1.62.1 (Chromium + Firefox) for the differ, `tsx` for the playtest harness.

**Spec:** [`../../specs/2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) — §6.1 N3 (clock sync), §6.9 N23 (`netgraph.ts`), §6.11 N29 (the `D` knob) and N30 (input log), §7 (harness, divergence metric and the three differ conditions, weapon exposure), §8 phase 0 row, §13 ("Interpolation buffer today"). Ledger: [`interfaces.md`](interfaces.md). Prior plan: [`01-prep-arena-scene-split-and-render-frame.md`](01-prep-arena-scene-split-and-render-frame.md) — assumed landed; `match/arena-net.ts`, `match/render-frame.ts`, `scenes/arena/*` and the composer `ArenaScene.ts` exist with the shapes it defines.

## Global Constraints

- Rebuild shared before testing (`npm run build -w @motor-combat-moba/shared`); tests import `src` but consume shared's built `dist`.
- Verify with root `npm test`, never a per-workspace run alone; then `npm run typecheck` (root) and root `npm run build`.
- `.js` import specifiers on every local import; shared is imported as `@motor-combat-moba/shared` (server `src` and client `src`), and by deep `dist` path only from `scripts/*.mjs`.
- Nothing under `packages/client/src/match/` imports Phaser and no test imports Phaser.
- Do not touch `packages/server/playtest/` except to fix a compile break, and say loudly in the task's commit step which probe numbers your change moves. **The one exception in this plan** is Task 8: spec §7 names `playtest/netcode.ts` as the successor of `prediction.ts`, so that file, its `run-all.ts` registration and its README entry are created here. Every other probe is untouched.
- Do not edit `docs/ideas/` or `docs/invariants/`.
- Commit after every task on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch off it).
- No magic numbers in logic: every threshold is a named constant with a comment, and every balance-flavoured number lives in shared config.
- Ping/pong ride as ordinary Colyseus messages (`room.onMessage` / `client.send`) in this phase; the binary codec is N2.
- No task here changes a balance table, `TICK_RATE_HZ`, `DRIVE_CONFIG`, `COMBAT_CONFIG`, `AIM_CONFIG.lockRange` or `ARENA_WIDTH`, so no `npm run build:manual` or `docs/turn-tuning.md` step is owed. `NET_CONFIG` changes in Task 9; it is not an input to the manual or the turn page.

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/net/ping.ts` (create) | `PING_MESSAGE`, `PONG_MESSAGE`, `PingMessage`, `PongMessage`, `isPingMessage`, `isPongMessage` |
| `packages/shared/src/net/input.ts` (modify) | adds `InputFrame`; `InputMessage extends InputFrame` |
| `packages/shared/src/sim/world-hash.ts` (create) | `worldHash` (FNV-1a over quantised poses + sorted contact list), `contactSet`, `HASH_QUANT` — loadable by Node and a browser |
| `packages/shared/src/config/net-config.ts` (modify) | `pingIntervalMs`, `clockSamples` (Task 1); `interpolationDelayMs` 67 (Task 9) |
| `packages/shared/src/index.ts` (modify) | exports the above |
| `packages/server/src/rooms/ping-handler.ts` (create) | `bindPing(room, clock)` |
| `packages/server/src/net/input-log.ts` (create) | `InputLog`, `InputLogHeader`, `configureInputLogs`, `openInputLog` |
| `packages/server/src/net/differ.ts` (create) | re-exports `worldHash` / `contactSet` for server-side callers (the harness) |
| `packages/server/src/rooms/{ArenaRoom,PracticeRoom,PlaygroundRoom}.ts` (modify) | `lastTickAtMs` stamp, `bindPing`; Arena and Practice also record the input log |
| `packages/server/src/index.ts`, `packages/server/src/mode.ts` (modify) | `configureInputLogs`, `INPUT_LOG` env knob |
| `packages/server/playtest/netcode.ts` (create), `run-all.ts`, `README.md` (modify) | the netcode harness |
| `packages/client/src/config/client-mode.ts` (modify) | `isNetgraphEnabled` (`?debug=net`) |
| `packages/client/src/match/clock.ts` (create) | `ClockSync` |
| `packages/client/src/match/netgraph.ts` (create) | `NetStats`, `NetStatsView` |
| `packages/client/src/match/pose-history.ts` (create) | `PoseHistory`, the bounded per-car server-pose ring the `D` knob reads |
| `packages/client/src/match/byte-counter.ts` (create) | `countBytes(connection, stats)` |
| `packages/client/src/match/arena-net.ts` (modify) | `attachStats`, `setRenderDelay`, `renderDelay`, correction recording, pose history |
| `packages/client/src/scenes/arena/netgraph-overlay.ts` (create) | `NetgraphOverlay` |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | ping loop, pong handler, byte counter, overlay, dev-only `D` hotkeys |
| `scripts/differ-replay.mjs`, `scripts/differ.mjs`, `scripts/differ.test.mjs` (create) | log parser + replay (shared by Node and the browser page), the Playwright runner |
| `package.json` (root), `.gitignore` (modify) | `differ` script; `packages/server/logs/` |
| `docs/networking.md`, `docs/config-reference.md`, `docs/project-structure.md`, `packages/client/CLAUDE.md` (modify) | name the new seams and knobs |

---

### Task 1: Ping messages, `InputFrame`, and the two clock knobs

**Files:**
- Create: `packages/shared/src/net/ping.ts`
- Modify: `packages/shared/src/net/input.ts`, `packages/shared/src/config/net-config.ts:1-19`, `packages/shared/src/index.ts:15-16`, `packages/shared/src/config/config.test.ts:264-270`
- Test: `packages/shared/src/net/ping.test.ts`

**Interfaces:**
- Produces: `PING_MESSAGE = "ping"`, `PONG_MESSAGE = "pong"`, `PingMessage { clientMs }`, `PongMessage { clientMs; serverTick; msIntoTick }`, `isPingMessage(value): value is PingMessage`, `isPongMessage(value): value is PongMessage`; `InputFrame { steer; throttle; fireSlots }`; `NET_CONFIG.pingIntervalMs = 500`, `NET_CONFIG.clockSamples = 8`. Tasks 3, 5, 7, 8 consume them.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/net/ping.test.ts
import { describe, expect, it } from "vitest";
import { PING_MESSAGE, PONG_MESSAGE, isPingMessage, isPongMessage } from "./ping.js";

describe("ping/pong wire guards", () => {
  it("names the two message types", () => {
    expect(PING_MESSAGE).toBe("ping");
    expect(PONG_MESSAGE).toBe("pong");
  });
  it("accepts a ping with a finite clientMs and nothing else", () => {
    expect(isPingMessage({ clientMs: 12.5 })).toBe(true);
    expect(isPingMessage({ clientMs: Number.NaN })).toBe(false);
    expect(isPingMessage({})).toBe(false);
    expect(isPingMessage(null)).toBe(false);
    expect(isPingMessage("ping")).toBe(false);
  });
  it("accepts a pong with clientMs, an integer serverTick and a finite msIntoTick", () => {
    expect(isPongMessage({ clientMs: 1, serverTick: 30, msIntoTick: 4.2 })).toBe(true);
    expect(isPongMessage({ clientMs: 1, serverTick: 30.5, msIntoTick: 4.2 })).toBe(false);
    expect(isPongMessage({ clientMs: 1, serverTick: 30 })).toBe(false);
  });
});
```

Append to the `describe("NET_CONFIG"...)` block in `config.test.ts` (after the `maxInputsPerTick` case at 264–269):

```ts
  it("pings twice a second and keeps eight clock samples (N3)", () => {
    expect(NET_CONFIG.pingIntervalMs).toBe(500);
    expect(NET_CONFIG.clockSamples).toBe(8);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/shared && npx vitest run src/net/ping.test.ts src/config/config.test.ts`
Expected: FAIL — cannot resolve `./ping.js`; `pingIntervalMs` undefined.

- [ ] **Step 3: Write the module, widen the input type, add the knobs**

```ts
// packages/shared/src/net/ping.ts
/**
 * Clock sync (netcode spec N3). The client sends `ping { clientMs }` every
 * `NET_CONFIG.pingIntervalMs`; the room answers `pong` with the client's own stamp echoed back plus
 * where the server's tick clock was when it answered. Ordinary Colyseus messages in this phase —
 * the binary form is N2 — so both are validated on arrival like every other wire message.
 */
export const PING_MESSAGE = "ping";
export const PONG_MESSAGE = "pong";

export interface PingMessage {
  /** `performance.now()` on the client when the ping left. Echoed, never interpreted by the server. */
  clientMs: number;
}

export interface PongMessage {
  clientMs: number;
  serverTick: number;
  /** Milliseconds since the server began `serverTick`, so the client can place the tick boundary. */
  msIntoTick: number;
}

export function isPingMessage(value: unknown): value is PingMessage {
  if (value === null || typeof value !== "object") return false;
  return Number.isFinite((value as Record<string, unknown>).clientMs);
}

export function isPongMessage(value: unknown): value is PongMessage {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return (
    Number.isFinite(rec.clientMs) &&
    Number.isInteger(rec.serverTick) &&
    Number.isFinite(rec.msIntoTick)
  );
}
```

`packages/shared/src/net/input.ts` becomes:

```ts
export const INPUT_MESSAGE = "input";

/** One tick's worth of intent, with no sequencing on it — what the input log and the sim read. */
export interface InputFrame {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  /** Slot bitmask: bit 0 = slot 1. The server masks it to the car's real slots before simulating. */
  fireSlots: number;
}

/** The wire message: an `InputFrame` plus the connection-monotonic `seq` (replaced by `tick` in N1). */
export interface InputMessage extends InputFrame {
  seq: number;
}
```

Every existing caller of `InputMessage` still compiles (the fields are identical). In `net-config.ts`, append two keys before the closing `} as const;`:

```ts
  /** Clock-sync cadence (N3). Two pings a second is enough for a lowest-RTT-of-eight estimate. */
  pingIntervalMs: 500,
  /** How many pong samples `ClockSync` keeps; the offset comes from the lowest-RTT one. */
  clockSamples: 8,
```

In `index.ts`, replace lines 15–16 with:

```ts
export { INPUT_MESSAGE } from "./net/input.js";
export type { InputFrame, InputMessage } from "./net/input.js";
export { PING_MESSAGE, PONG_MESSAGE, isPingMessage, isPongMessage } from "./net/ping.js";
export type { PingMessage, PongMessage } from "./net/ping.js";
```

- [ ] **Step 4: Rebuild shared and run the tests**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/shared && npx vitest run src/net/ping.test.ts src/config/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/net/ping.ts packages/shared/src/net/ping.test.ts packages/shared/src/net/input.ts packages/shared/src/config/net-config.ts packages/shared/src/config/config.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): ping/pong messages, InputFrame, and the clock-sync knobs (N3)"
```

---

### Task 2: `worldHash` and `contactSet` — the divergence detector's hash

**Files:**
- Create: `packages/shared/src/sim/world-hash.ts`, `packages/server/src/net/differ.ts`
- Modify: `packages/shared/src/index.ts` (append one export line)
- Test: `packages/shared/src/sim/world-hash.test.ts`

**Interfaces:**
- Consumes: `SimBody` (`sim/step.ts`), `carHullOf` (`sim/context.ts`), `contactNormalBetween` (`sim/collide.ts`), `hullTouchesWorld` (`sim/contact.ts`), `pairKey` (`sim/ram.ts`), `RAM_CONFIG.contactPad`, `SLAM_CONFIG.wallContactPad`.
- Produces: `worldHash(cars: readonly SimBody[], contacts: readonly string[]): string` (ledger; 8 hex chars), `contactSet(cars, arena): string[]`, `HASH_QUANT`, `WALL_CONTACT_SUFFIX`. Tasks 8 and 10 consume them. The ledger places `worldHash` in server `net/differ.ts`; it is **implemented in shared** so the browser page of Task 10 can load the same function, and `net/differ.ts` re-exports it under the ledger name.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/sim/world-hash.test.ts
import { describe, expect, it } from "vitest";
import { getArena } from "../arena/registry.js";
import type { SimBody } from "./step.js";
import { HASH_QUANT, WALL_CONTACT_SUFFIX, contactSet, worldHash } from "./world-hash.js";

const body = (x: number, y: number, angle = 0, speed = 0): SimBody => ({
  x, y, angle, speed, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0, authority: 1,
  maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
});
const ARENA = getArena("arena-01");

describe("worldHash", () => {
  it("is eight hex characters and deterministic", () => {
    const h = worldHash([body(100, 200)], []);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(worldHash([body(100, 200)], [])).toBe(h);
  });
  it("ignores movement below the position quantum and sees one quantum", () => {
    const base = worldHash([body(100, 200)], []);
    expect(worldHash([body(100 + 1 / (HASH_QUANT.posPerUnit * 4), 200)], [])).toBe(base);
    expect(worldHash([body(100 + 1 / HASH_QUANT.posPerUnit, 200)], [])).not.toBe(base);
  });
  it("wraps the angle so 0 and 2π hash alike, and sees one angle step", () => {
    const base = worldHash([body(0, 0, 0)], []);
    expect(worldHash([body(0, 0, Math.PI * 2)], [])).toBe(base);
    expect(worldHash([body(0, 0, (Math.PI * 2) / HASH_QUANT.angleSteps + 1e-9)], [])).not.toBe(base);
  });
  it("hashes the contact list order-insensitively, and a contact changes the hash", () => {
    const cars = [body(0, 0), body(48, 0)];
    expect(worldHash(cars, ["a|b", "b|c"])).toBe(worldHash(cars, ["b|c", "a|b"]));
    expect(worldHash(cars, ["a|b"])).not.toBe(worldHash(cars, []));
  });
});

describe("contactSet", () => {
  it("lists a touching pair by pairKey and nothing for cars apart", () => {
    const touching = [
      { sessionId: "b", x: 400, y: 360, angle: 0 },
      { sessionId: "a", x: 447, y: 360, angle: 0 },
    ];
    expect(contactSet(touching, ARENA)).toEqual(["a|b"]);
    expect(contactSet([{ sessionId: "a", x: 400, y: 360, angle: 0 }, { sessionId: "b", x: 800, y: 360, angle: 0 }], ARENA)).toEqual([]);
  });
  it("lists a car pressed against the arena edge with the wall suffix", () => {
    // A 48-wide car centred at x = 24 has its nose corners on x = 0, inside the wall pad.
    expect(contactSet([{ sessionId: "a", x: 24, y: 360, angle: 0 }], ARENA)).toEqual([`a${WALL_CONTACT_SUFFIX}`]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/shared && npx vitest run src/sim/world-hash.test.ts`
Expected: FAIL — cannot resolve `./world-hash.js`.

- [ ] **Step 3: Write the module**

```ts
// packages/shared/src/sim/world-hash.ts
import { RAM_CONFIG } from "../config/ram-config.js";
import { SLAM_CONFIG } from "../config/slam-config.js";
import type { Aabb, Bounds } from "./collide.js";
import { contactNormalBetween } from "./collide.js";
import { hullTouchesWorld } from "./contact.js";
import { carHullOf } from "./context.js";
import { pairKey } from "./ram.js";
import type { SimBody } from "./step.js";

/**
 * The desync detector's hash (netcode spec §7). Two simulations agree on a tick when their
 * quantised poses AND their contact sets agree; a pose-only comparison can miss the failure that
 * matters — one ULP of `cos` flipping a separating-axis test so one side has a contact the other
 * does not. Lives in shared, with no schema import anywhere beneath it, so the cross-engine differ
 * can load this exact function into a browser as well as into Node.
 *
 * `posPerUnit` and `angleSteps` are the values N2's codec adopts as `QUANT`; when that lands, this
 * table is replaced by a re-export of it so the wire and the hash never disagree.
 */
export const HASH_QUANT = { posPerUnit: 16, angleSteps: 65536 } as const;

/** Appended to a session id in a contact list to mean "touching the arena edge or an obstacle". */
export const WALL_CONTACT_SUFFIX = "|#wall";

const TWO_PI = Math.PI * 2;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function wrapAngle(angle: number): number {
  const r = angle % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** FNV-1a, 32-bit, over quantised `x, y, angle, speed` per car in the order given, then the sorted contacts. */
export function worldHash(cars: readonly SimBody[], contacts: readonly string[]): string {
  let h = FNV_OFFSET;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, FNV_PRIME) >>> 0;
    }
  };
  for (const c of cars) {
    const qa = Math.round((wrapAngle(c.angle) / TWO_PI) * HASH_QUANT.angleSteps) % HASH_QUANT.angleSteps;
    mix(
      `${Math.round(c.x * HASH_QUANT.posPerUnit)},${Math.round(c.y * HASH_QUANT.posPerUnit)},` +
        `${qa},${Math.round(c.speed * HASH_QUANT.posPerUnit)};`,
    );
  }
  mix(`|${[...contacts].sort().join(",")}`);
  return h.toString(16).padStart(8, "0");
}

export interface ContactSetCar {
  sessionId: string;
  x: number;
  y: number;
  angle: number;
}

/**
 * Every touching pair (`pairKey`) plus every car touching the world (`sid|#wall`), using the same
 * pads `resolveContacts` and the wall-stun test use, so "touching" here means what the sim means.
 */
export function contactSet(
  cars: readonly ContactSetCar[],
  arena: { obstacles: readonly Aabb[]; width: number; height: number },
): string[] {
  const bounds: Bounds = { width: arena.width, height: arena.height };
  const ordered = [...cars].sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  const out: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    const hullA = carHullOf(a.x, a.y, a.angle);
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j]!;
      if (contactNormalBetween(hullA, carHullOf(b.x, b.y, b.angle), RAM_CONFIG.contactPad) !== null) {
        out.push(pairKey(a.sessionId, b.sessionId));
      }
    }
    if (hullTouchesWorld(hullA, arena.obstacles, bounds, SLAM_CONFIG.wallContactPad)) {
      out.push(`${a.sessionId}${WALL_CONTACT_SUFFIX}`);
    }
  }
  return out;
}
```

Append to `packages/shared/src/index.ts`:

```ts
export { HASH_QUANT, WALL_CONTACT_SUFFIX, contactSet, worldHash } from "./sim/world-hash.js";
export type { ContactSetCar } from "./sim/world-hash.js";
```

```ts
// packages/server/src/net/differ.ts
/**
 * The server's name for the desync detector (netcode spec §7). The implementation is shared
 * `sim/world-hash.ts` so the browser half of `scripts/differ.mjs` can load the identical function;
 * server code and the netcode harness import it from here.
 */
export { HASH_QUANT, WALL_CONTACT_SUFFIX, contactSet, worldHash } from "@motor-combat-moba/shared";
export type { ContactSetCar } from "@motor-combat-moba/shared";
```

- [ ] **Step 4: Rebuild shared, run the test, typecheck the server**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/shared && npx vitest run src/sim/world-hash.test.ts && cd ../server && npm run typecheck`
Expected: PASS (6 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/world-hash.ts packages/shared/src/sim/world-hash.test.ts packages/shared/src/index.ts packages/server/src/net/differ.ts
git commit -m "feat(shared): worldHash over quantised poses and contact sets, the desync detector"
```

---

### Task 3: `bindPing` and the tick stamp in every room

**Files:**
- Create: `packages/server/src/rooms/ping-handler.ts`
- Modify: `packages/server/src/rooms/ArenaRoom.ts:111-134, 300-301`, `PracticeRoom.ts:152-231, 330-338`, `PlaygroundRoom.ts:170-235, 337-340`
- Test: `packages/server/src/rooms/ping-handler.test.ts`

**Interfaces:**
- Consumes: Task 1's `PING_MESSAGE`, `PONG_MESSAGE`, `isPingMessage`, `PongMessage`.
- Produces: `bindPing(room: Room, clock: () => { tick: number; msIntoTick: number }): void` (ledger).

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/rooms/ping-handler.test.ts
import { describe, expect, it } from "vitest";
import type { Room } from "@colyseus/core";
import { bindPing } from "./ping-handler.js";

type Handler = (client: { send(type: string, msg: unknown): void }, msg: unknown) => void;

function fakeRoom(): { room: Room; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const room = { onMessage: (type: string, cb: Handler) => handlers.set(type, cb) } as unknown as Room;
  return { room, handlers };
}

describe("bindPing", () => {
  it("answers a ping with the echoed stamp and the room clock", () => {
    const { room, handlers } = fakeRoom();
    bindPing(room, () => ({ tick: 42, msIntoTick: 7 }));
    const sent: unknown[] = [];
    handlers.get("ping")!({ send: (_t, m) => sent.push(m) }, { clientMs: 5 });
    expect(sent).toEqual([{ clientMs: 5, serverTick: 42, msIntoTick: 7 }]);
  });
  it("ignores a malformed ping", () => {
    const { room, handlers } = fakeRoom();
    bindPing(room, () => ({ tick: 1, msIntoTick: 0 }));
    const sent: unknown[] = [];
    handlers.get("ping")!({ send: (_t, m) => sent.push(m) }, { clientMs: "now" });
    expect(sent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && npx vitest run src/rooms/ping-handler.test.ts`
Expected: FAIL — cannot resolve `./ping-handler.js`.

- [ ] **Step 3: Write the handler and bind it in the three rooms**

```ts
// packages/server/src/rooms/ping-handler.ts
import type { Room } from "@colyseus/core";
import { PING_MESSAGE, PONG_MESSAGE, isPingMessage, type PongMessage } from "@motor-combat-moba/shared";

/**
 * One binding for all three rooms (netcode spec N3). Answers straight from the message handler —
 * no queue, no tick alignment — because the whole point of the pong is to carry the room clock as
 * it stood the instant the ping was seen. `clock` is the room's own `(tick, msIntoTick)` read.
 */
export function bindPing(room: Room, clock: () => { tick: number; msIntoTick: number }): void {
  room.onMessage(PING_MESSAGE, (client, msg: unknown) => {
    if (!isPingMessage(msg)) return;
    const now = clock();
    const pong: PongMessage = { clientMs: msg.clientMs, serverTick: now.tick, msIntoTick: now.msIntoTick };
    client.send(PONG_MESSAGE, pong);
  });
}
```

In each room add a field and a clock read, then bind. `ArenaRoom.ts`: after `private ram: ContactMemory = newContactMemory();` (line 109) add

```ts
  /** `performance.now()` at the top of the newest `tick()`, so a pong can say how far into it we are. */
  private lastTickAtMs = 0;

  private roomClock(): { tick: number; msIntoTick: number } {
    return { tick: this.state.tick, msIntoTick: performance.now() - this.lastTickAtMs };
  }
```

and in `onCreate`, directly after `this.setSimulationInterval(...)` (line 120): `bindPing(this, () => this.roomClock());` with `import { bindPing } from "./ping-handler.js";`. In `tick()` make the first statement `this.lastTickAtMs = performance.now();` (before `this.state.tick += 1;` at line 301).

`PracticeRoom.ts`: same field and `roomClock()`; `bindPing(this, () => this.roomClock());` after line 184's `setSimulationInterval`; the stamp goes at the very top of `tick()` (line 330), **above** `sweepIdle` and the pause return, so a paused room still reports a fresh `msIntoTick` rather than a value growing for the length of the pause. `PlaygroundRoom.ts`: same, bind after line 193, stamp above the pause return at line 339.

- [ ] **Step 4: Test and typecheck**

Run: `cd packages/server && npx vitest run src/rooms/ping-handler.test.ts && npm run typecheck`
Expected: PASS (2 tests); typecheck clean (the practice-room source-scan tests strip comments, and nothing here names `setTuning`).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/rooms/ping-handler.ts packages/server/src/rooms/ping-handler.test.ts packages/server/src/rooms/ArenaRoom.ts packages/server/src/rooms/PracticeRoom.ts packages/server/src/rooms/PlaygroundRoom.ts
git commit -m "feat(server): bindPing answers ping with the room's tick clock in all three rooms (N3)"
```

---

### Task 4: The input log (N30)

**Files:**
- Create: `packages/server/src/net/input-log.ts`
- Modify: `packages/server/src/rooms/ArenaRoom.ts` (fields, `tick()`, `onDispose`), `PracticeRoom.ts` (same), `packages/server/src/index.ts:17-20`, `packages/server/src/mode.ts` (append), `.gitignore` (append)
- Test: `packages/server/src/net/input-log.test.ts`

**Interfaces:**
- Consumes: `InputFrame` (Task 1), `createRunDir` (`src/run-dir.ts`).
- Produces: `class InputLog { constructor(dir); begin(header: InputLogHeader); record(tick, sessionId, input: InputFrame); flush(): Promise<void> }` (ledger plus `begin`), `InputLogHeader`, `configureInputLogs(root: string | undefined)`, `openInputLog(): InputLog | undefined`, `INPUT_LOG_FILE = "inputs.log"`, `isInputLogEnabled()` in `mode.ts`. Task 10 parses the file; Task 8 does not need it.

Format, one text file per room, `inputs.log`: a first line `# <json header>` written by `begin`, then one line per **applied** input: `<tick> <sessionId> <steer> <throttle> <fireSlots>`, in the order `serverTick` applies them (seq-sorted, capped at `maxInputsPerTick`). About 20 bytes a line: 3.6 KB/s for six players at 30 Hz.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/net/input-log.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INPUT_LOG_FILE, InputLog, configureInputLogs, openInputLog } from "./input-log.js";

const temps: string[] = [];
const tempDir = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "input-log-"));
  temps.push(d);
  return d;
};
afterEach(() => {
  configureInputLogs(undefined);
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("InputLog", () => {
  it("writes the header, then one line per applied input, in record order", async () => {
    const dir = tempDir();
    const log = new InputLog(dir);
    log.begin({ v: 1, tick: 90, arenaId: "arena-01", cars: [{ sessionId: "a", carId: "mirage", x: 300, y: 360, angle: 0 }] });
    log.record(91, "a", { steer: 0, throttle: 1, fireSlots: 0 });
    log.record(91, "b", { steer: -1, throttle: 0, fireSlots: 3 });
    await log.flush();
    const lines = fs.readFileSync(path.join(dir, INPUT_LOG_FILE), "utf8").trimEnd().split("\n");
    expect(lines[0]!.startsWith("# ")).toBe(true);
    expect(JSON.parse(lines[0]!.slice(2)).arenaId).toBe("arena-01");
    expect(lines.slice(1)).toEqual(["91 a 0 1 0", "91 b -1 0 3"]);
  });
  it("appends across flushes", async () => {
    const dir = tempDir();
    const log = new InputLog(dir);
    log.record(1, "a", { steer: 0, throttle: 0, fireSlots: 0 });
    await log.flush();
    log.record(2, "a", { steer: 1, throttle: 0, fireSlots: 0 });
    await log.flush();
    expect(fs.readFileSync(path.join(dir, INPUT_LOG_FILE), "utf8")).toBe("1 a 0 0 0\n2 a 1 0 0\n");
  });
});

describe("openInputLog", () => {
  it("is undefined until configured, then mints a dated folder under the root", () => {
    expect(openInputLog()).toBeUndefined();
    const root = tempDir();
    configureInputLogs(root);
    const log = openInputLog();
    expect(log).toBeDefined();
    expect(fs.readdirSync(root)).toHaveLength(1);
    expect(fs.readdirSync(root)[0]).toMatch(/^\d{4}-\d{2}-\d{2}-01$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && npx vitest run src/net/input-log.test.ts`
Expected: FAIL — cannot resolve `./input-log.js`.

- [ ] **Step 3: Write the log**

```ts
// packages/server/src/net/input-log.ts
import fs from "node:fs";
import path from "node:path";
import type { InputFrame } from "@motor-combat-moba/shared";
import { createRunDir } from "../run-dir.js";

export const INPUT_LOG_FILE = "inputs.log";

export interface InputLogHeader {
  v: 1;
  /** The tick the match entered MATCH; input lines start after it. */
  tick: number;
  arenaId: string;
  cars: { sessionId: string; carId: string; x: number; y: number; angle: number }[];
}

/**
 * The per-tick input stream (netcode spec N30): every input the room is about to simulate, in the
 * order it will simulate them. Text, one line each, buffered in memory and appended on `flush`.
 * Gives deterministic bug reproduction and feeds `scripts/differ.mjs` and the netcode harness with
 * real input distributions — in particular whether steering reversals cluster at contact, the
 * unknown that decides how good N20's extrapolation is.
 */
export class InputLog {
  private pending: string[] = [];
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, INPUT_LOG_FILE);
  }

  begin(header: InputLogHeader): void {
    this.pending.push(`# ${JSON.stringify(header)}`);
  }

  record(tick: number, sessionId: string, input: InputFrame): void {
    this.pending.push(`${tick} ${sessionId} ${input.steer} ${input.throttle} ${input.fireSlots}`);
  }

  /** Append everything recorded so far. Serialised, so overlapping flushes keep line order. */
  flush(): Promise<void> {
    if (this.pending.length === 0) return this.writing;
    const chunk = `${this.pending.join("\n")}\n`;
    this.pending = [];
    this.writing = this.writing.then(() => fs.promises.appendFile(this.file, chunk, "utf8"));
    return this.writing;
  }
}

let logsRoot: string | undefined;

/**
 * Where logs go: `packages/server/logs/<yyyy-MM-dd-NN>/`, gitignored like the playtest reports.
 * `index.ts` configures it once from its own location, so `src` under `tsx` and `dist` under node
 * resolve to the same folder; `undefined` (or `INPUT_LOG=0`) turns logging off for the process.
 */
export function configureInputLogs(root: string | undefined): void {
  logsRoot = root;
}

/** A fresh log in a fresh dated folder, or `undefined` when logging is off. One per room. */
export function openInputLog(): InputLog | undefined {
  return logsRoot === undefined ? undefined : new InputLog(createRunDir(logsRoot));
}
```

Append to `mode.ts`:

```ts
/** `INPUT_LOG=0` turns the per-tick input log (N30) off; anything else, including unset, leaves it on. */
export function isInputLogEnabled(): boolean {
  return process.env.INPUT_LOG !== "0";
}
```

In `index.ts`, after `const __dirname = ...` (line 17) add:

```ts
// `src/index.ts` and `dist/index.js` both sit one level under `packages/server`, so `../logs` is
// the same folder whichever one is running.
configureInputLogs(isInputLogEnabled() ? path.resolve(__dirname, "../logs") : undefined);
```

with `import { configureInputLogs } from "./net/input-log.js";` and `isInputLogEnabled` added to the `./mode.js` import. Append `packages/server/logs/` to `.gitignore` under the playtest-reports entry with the comment `# Input logs (N30) — a record of one match on one machine, never source`.

- [ ] **Step 4: Record from the rooms**

`ArenaRoom.ts` — add a field `private inputLog = openInputLog();` and a flag `private inputLogBegun = false;`, `import { openInputLog } from "../net/input-log.js";`, then in `tick()` insert this block immediately before `const { combatPlayers } = runPipeline(this.ctx());` (line 335):

```ts
    this.logInputsForTick();
```

and add the method:

```ts
  /**
   * What `serverTick` is about to apply, in the order it applies it (seq-sorted, capped at
   * `NET_CONFIG.maxInputsPerTick`). Recorded BEFORE the pipeline drains the queues; the header is
   * written on the first MATCH tick so the log opens with every car's spawn pose.
   */
  private logInputsForTick(): void {
    const log = this.inputLog;
    if (!log || this.state.phase !== RoomPhase.MATCH) return;
    if (!this.inputLogBegun) {
      this.inputLogBegun = true;
      const cars: { sessionId: string; carId: string; x: number; y: number; angle: number }[] = [];
      for (const id of [...this.matchRoster].sort()) {
        const p = this.state.players.get(id);
        if (p) cars.push({ sessionId: id, carId: p.carId, x: p.x, y: p.y, angle: p.angle });
      }
      log.begin({ v: 1, tick: this.state.tick - 1, arenaId: this.state.arenaId, cars });
    }
    for (const id of [...this.inputQueues.keys()].sort()) {
      const queue = this.inputQueues.get(id) ?? [];
      const applied = [...queue].sort((a, b) => a.seq - b.seq).slice(0, NET_CONFIG.maxInputsPerTick);
      for (const msg of applied) log.record(this.state.tick, id, msg);
    }
    if (this.state.tick % INPUT_LOG_FLUSH_TICKS === 0) void log.flush();
  }
```

`NET_CONFIG` joins the shared import list. Add a module-level `const INPUT_LOG_FLUSH_TICKS = 300; // ten seconds at 30 Hz — small enough to lose little on a crash, large enough to never write per tick`. Add `onDispose(): void { void this.inputLog?.flush(); }` (ArenaRoom has no `onDispose` today). A new match in the same room reuses the log file: `endMatch` sets `this.inputLogBegun = false;` so the next MATCH writes a second header, which the differ (Task 10) treats as a new replay segment.

`PracticeRoom.ts` — identical field, method and flush; `matchRoster` and `inputQueues` exist there under the same names; the bot's inputs are in `inputQueues` too, so they are logged as a player. Practice pins `phase = MATCH`, so the header is written on its first tick. `PlaygroundRoom` does not log (dev-only, and it rewrites tables).

- [ ] **Step 5: Test, typecheck, run the practice room's source-scan suite**

Run: `cd packages/server && npx vitest run src/net/input-log.test.ts src/rooms/practice-room.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/net/input-log.ts packages/server/src/net/input-log.test.ts packages/server/src/rooms/ArenaRoom.ts packages/server/src/rooms/PracticeRoom.ts packages/server/src/index.ts packages/server/src/mode.ts .gitignore
git commit -m "feat(server): log the per-tick input stream to packages/server/logs (N30)"
```

---

### Task 5: `ClockSync`, `NetStats`, and the byte counter

**Files:**
- Create: `packages/client/src/match/clock.ts`, `packages/client/src/match/netgraph.ts`, `packages/client/src/match/byte-counter.ts`
- Modify: `packages/client/src/config/client-mode.ts:1-7`
- Test: `packages/client/src/match/clock.test.ts`, `packages/client/src/match/netgraph.test.ts`, `packages/client/src/match/byte-counter.test.ts`, `packages/client/src/config/client-mode.test.ts`

**Interfaces:**
- Consumes: `PongMessage`, `NET_CONFIG.clockSamples`, `NET_CONFIG.reconcileSnapPos`, `MS_PER_TICK`.
- Produces (ledger, plus the additions marked †): `class ClockSync { constructor(opts?: { samples?: number }); onPong(pong, nowMs); rttMs; jitterMs; ready; serverTickAt(nowMs) }`; `class NetStats { rttMs; jitterMs; lead; slack: number[]; lateInputs; repeatedInputs; corrections; snaps; bytesIn; bytesOut; view(): NetStatsView }` with † `recordCorrection(distanceU: number)`, † `correctionMagnitudes: number[]` (bounded ring), † `shots`, † `manualShots`; `NetStatsView` (plain object); † `countBytes(connection, stats): () => void`; † `isNetgraphEnabled(search)`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/client/src/match/clock.test.ts
import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "@motor-combat-moba/shared";
import { ClockSync } from "./clock.js";

describe("ClockSync", () => {
  it("is not ready with no sample and reports zero", () => {
    const c = new ClockSync();
    expect(c.ready).toBe(false);
    expect(c.rttMs).toBe(0);
    expect(c.jitterMs).toBe(0);
  });
  it("places the server tick from one pong: tick + msIntoTick + half the RTT", () => {
    const c = new ClockSync();
    c.onPong({ clientMs: 1000, serverTick: 300, msIntoTick: 10 }, 1100);
    expect(c.ready).toBe(true);
    expect(c.rttMs).toBe(100);
    expect(c.serverTickAt(1100)).toBeCloseTo(300 + (10 + 50) / MS_PER_TICK, 6);
    expect(c.serverTickAt(1100 + MS_PER_TICK)).toBeCloseTo(300 + (10 + 50) / MS_PER_TICK + 1, 6);
  });
  it("takes the offset from the lowest-RTT sample and jitter as the RTT standard deviation", () => {
    const c = new ClockSync();
    c.onPong({ clientMs: 1000, serverTick: 300, msIntoTick: 0 }, 1100); // rtt 100
    c.onPong({ clientMs: 2000, serverTick: 330, msIntoTick: 0 }, 2060); // rtt 60
    expect(c.rttMs).toBe(60);
    expect(c.jitterMs).toBeCloseTo(20, 6);
    expect(c.serverTickAt(2060)).toBeCloseTo(330 + 30 / MS_PER_TICK, 6);
  });
  it("keeps only the newest `samples` pongs", () => {
    const c = new ClockSync({ samples: 2 });
    c.onPong({ clientMs: 0, serverTick: 0, msIntoTick: 0 }, 20); // rtt 20, evicted below
    c.onPong({ clientMs: 500, serverTick: 15, msIntoTick: 0 }, 600); // rtt 100
    c.onPong({ clientMs: 1000, serverTick: 30, msIntoTick: 0 }, 1080); // rtt 80
    expect(c.rttMs).toBe(80);
  });
});
```

```ts
// packages/client/src/match/netgraph.test.ts
import { describe, expect, it } from "vitest";
import { NET_CONFIG } from "@motor-combat-moba/shared";
import { CORRECTION_FLOOR_U, NetStats } from "./netgraph.js";

describe("NetStats", () => {
  it("counts a correction above the noise floor and a snap above reconcileSnapPos", () => {
    const s = new NetStats();
    s.recordCorrection(CORRECTION_FLOOR_U / 2);
    s.recordCorrection(3);
    s.recordCorrection(NET_CONFIG.reconcileSnapPos + 1);
    expect(s.corrections).toBe(2);
    expect(s.snaps).toBe(1);
    expect(s.correctionMagnitudes).toEqual([3, NET_CONFIG.reconcileSnapPos + 1]);
  });
  it("views as a plain object with every counter", () => {
    const s = new NetStats();
    s.rttMs = 90;
    s.bytesIn = 10;
    const v = s.view();
    expect(v).toEqual({
      rttMs: 90, jitterMs: 0, lead: 0, slackP5: 0, slackMedian: 0, lateInputs: 0, repeatedInputs: 0,
      corrections: 0, snaps: 0, correctionP95U: 0, bytesIn: 10, bytesOut: 0, shots: 0, manualShotFraction: 0,
    });
  });
});
```

```ts
// packages/client/src/match/byte-counter.test.ts
import { describe, expect, it } from "vitest";
import { countBytes } from "./byte-counter.js";
import { NetStats } from "./netgraph.js";

describe("countBytes", () => {
  it("counts inbound message bytes and outbound send bytes, then restores on unbind", () => {
    const seen: number[] = [];
    const sent: number[] = [];
    const conn = {
      events: { onmessage: (e: { data: ArrayBuffer }) => seen.push(e.data.byteLength) } as { onmessage?: (e: { data: ArrayBuffer }) => void },
      send: (data: ArrayBuffer | Uint8Array) => sent.push(data.byteLength),
    };
    const stats = new NetStats();
    const unbind = countBytes(conn, stats);
    conn.events.onmessage!({ data: new ArrayBuffer(10) });
    conn.send(new Uint8Array(5));
    expect(stats.bytesIn).toBe(10);
    expect(stats.bytesOut).toBe(5);
    expect(seen).toEqual([10]);
    expect(sent).toEqual([5]);
    unbind();
    conn.events.onmessage!({ data: new ArrayBuffer(4) });
    expect(stats.bytesIn).toBe(10);
  });
});
```

Add to `client-mode.test.ts`:

```ts
describe("isNetgraphEnabled", () => {
  it("is on only for debug=net", () => {
    expect(isNetgraphEnabled("?debug=net")).toBe(true);
    expect(isNetgraphEnabled("?debug=1")).toBe(false);
    expect(isNetgraphEnabled("")).toBe(false);
  });
});
```

(and `isNetgraphEnabled` to that file's import).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/client && npx vitest run src/match/clock.test.ts src/match/netgraph.test.ts src/match/byte-counter.test.ts src/config/client-mode.test.ts`
Expected: FAIL — modules not found; `isNetgraphEnabled` not exported.

- [ ] **Step 3: Write the three modules and the flag**

```ts
// packages/client/src/match/clock.ts
import { MS_PER_TICK, NET_CONFIG, type PongMessage } from "@motor-combat-moba/shared";

interface Sample {
  rttMs: number;
  /** `serverMs - clientMs` at the pong's arrival: add it to `performance.now()` to get server time. */
  offsetMs: number;
}

/**
 * Clock sync (netcode spec N3). Keeps the last `samples` pongs, takes the offset from the
 * lowest-RTT one — the NTP rule: the fastest packet had the least queueing — and reports jitter as
 * the RTT standard deviation over the window. Server time is `serverTick * MS_PER_TICK +
 * msIntoTick` at the instant the pong left, plus half the RTT to reach us. Nothing here dilates a
 * local clock yet; that is N1's `TickLoop`, which reads `serverTickAt`.
 */
export class ClockSync {
  private readonly samples: number;
  private readonly window: Sample[] = [];

  constructor(opts: { samples?: number } = {}) {
    this.samples = opts.samples ?? NET_CONFIG.clockSamples;
  }

  onPong(pong: PongMessage, nowMs: number): void {
    const rttMs = Math.max(0, nowMs - pong.clientMs);
    const serverMsNow = pong.serverTick * MS_PER_TICK + pong.msIntoTick + rttMs / 2;
    this.window.push({ rttMs, offsetMs: serverMsNow - nowMs });
    if (this.window.length > this.samples) this.window.splice(0, this.window.length - this.samples);
  }

  get ready(): boolean {
    return this.window.length > 0;
  }

  private best(): Sample | undefined {
    let best: Sample | undefined;
    for (const s of this.window) if (!best || s.rttMs < best.rttMs) best = s;
    return best;
  }

  /** RTT of the lowest-RTT sample in the window. */
  get rttMs(): number {
    return this.best()?.rttMs ?? 0;
  }

  /** Population standard deviation of RTT over the window. */
  get jitterMs(): number {
    const n = this.window.length;
    if (n === 0) return 0;
    const mean = this.window.reduce((a, s) => a + s.rttMs, 0) / n;
    const variance = this.window.reduce((a, s) => a + (s.rttMs - mean) ** 2, 0) / n;
    return Math.sqrt(variance);
  }

  /** The server's tick at local time `nowMs`, fractional. 0 before the first pong. */
  serverTickAt(nowMs: number): number {
    const best = this.best();
    if (!best) return 0;
    return (nowMs + best.offsetMs) / MS_PER_TICK;
  }
}
```

```ts
// packages/client/src/match/netgraph.ts
import { NET_CONFIG } from "@motor-combat-moba/shared";

/** A reconcile that moved the car less than this is float noise, not a correction. */
export const CORRECTION_FLOOR_U = 1e-3;
/** How many correction magnitudes the p95 is computed over (about a minute of patches at 20 Hz). */
export const CORRECTION_RING = 1024;

export interface NetStatsView {
  rttMs: number;
  jitterMs: number;
  lead: number;
  slackP5: number;
  slackMedian: number;
  lateInputs: number;
  repeatedInputs: number;
  corrections: number;
  snaps: number;
  correctionP95U: number;
  bytesIn: number;
  bytesOut: number;
  shots: number;
  /** Presses made with no lock target — the manual zone the netcode exposes (spec §7). */
  manualShotFraction: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/**
 * The netgraph counters (netcode spec N23). Plain mutable fields: `ArenaNet` and the scene write
 * them, `NetgraphOverlay` draws `view()`. `lead`, `slack`, `lateInputs` and `repeatedInputs` are
 * placeholders until N1 has a lead controller and an input ring to fill them.
 */
export class NetStats {
  rttMs = 0;
  jitterMs = 0;
  lead = 0;
  slack: number[] = [];
  lateInputs = 0;
  repeatedInputs = 0;
  corrections = 0;
  snaps = 0;
  bytesIn = 0;
  bytesOut = 0;
  shots = 0;
  manualShots = 0;
  correctionMagnitudes: number[] = [];

  recordCorrection(distanceU: number): void {
    if (distanceU < CORRECTION_FLOOR_U) return;
    this.corrections += 1;
    if (distanceU > NET_CONFIG.reconcileSnapPos) this.snaps += 1;
    this.correctionMagnitudes.push(distanceU);
    if (this.correctionMagnitudes.length > CORRECTION_RING) this.correctionMagnitudes.shift();
  }

  view(): NetStatsView {
    const slack = [...this.slack].sort((a, b) => a - b);
    const corrections = [...this.correctionMagnitudes].sort((a, b) => a - b);
    return {
      rttMs: this.rttMs,
      jitterMs: this.jitterMs,
      lead: this.lead,
      slackP5: percentile(slack, 0.05),
      slackMedian: percentile(slack, 0.5),
      lateInputs: this.lateInputs,
      repeatedInputs: this.repeatedInputs,
      corrections: this.corrections,
      snaps: this.snaps,
      correctionP95U: percentile(corrections, 0.95),
      bytesIn: this.bytesIn,
      bytesOut: this.bytesOut,
      shots: this.shots,
      manualShotFraction: this.shots === 0 ? 0 : this.manualShots / this.shots,
    };
  }
}
```

```ts
// packages/client/src/match/byte-counter.ts
import type { NetStats } from "./netgraph.js";

/** The slice of colyseus.js's `Room.connection` this reads: the raw socket events and `send`. */
export interface CountableConnection {
  events: { onmessage?: (event: { data: ArrayBuffer }) => void };
  send(data: ArrayBuffer | Uint8Array): void;
}

/**
 * Counts every byte over the socket (spec F9: "nothing counts bytes"). Wraps the connection's
 * `onmessage` and `send` in place — colyseus.js exposes both as plain properties — and returns the
 * unbind that restores them. Exact for the whole socket, so it includes schema patches, messages
 * and the transport's own frames; the codec of N2 replaces the estimate with a per-snapshot count.
 */
export function countBytes(connection: CountableConnection, stats: NetStats): () => void {
  const originalOnMessage = connection.events.onmessage;
  const originalSend = connection.send;
  connection.events.onmessage = (event) => {
    stats.bytesIn += event.data.byteLength;
    originalOnMessage?.(event);
  };
  connection.send = (data) => {
    stats.bytesOut += data.byteLength;
    originalSend.call(connection, data);
  };
  return () => {
    connection.events.onmessage = originalOnMessage;
    connection.send = originalSend;
  };
}
```

In `client-mode.ts`, after `isDebugEnabled` add:

```ts
/** `?debug=net` draws the netgraph overlay (netcode spec §7). Separate from `?debug=1` on purpose. */
export function isNetgraphEnabled(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get("debug") === "net";
}
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/client && npx vitest run src/match/clock.test.ts src/match/netgraph.test.ts src/match/byte-counter.test.ts src/config/client-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/match/clock.ts packages/client/src/match/clock.test.ts packages/client/src/match/netgraph.ts packages/client/src/match/netgraph.test.ts packages/client/src/match/byte-counter.ts packages/client/src/match/byte-counter.test.ts packages/client/src/config/client-mode.ts packages/client/src/config/client-mode.test.ts
git commit -m "feat(client): ClockSync, NetStats and a socket byte counter for the netgraph (N3, N23)"
```

---

### Task 6: `PoseHistory` and the `ArenaNet` hooks (stats, `D` render delay)

**Files:**
- Create: `packages/client/src/match/pose-history.ts`
- Modify: `packages/client/src/match/arena-net.ts` (the class from the preparation plan's Task 3)
- Test: `packages/client/src/match/pose-history.test.ts`, `packages/client/src/match/arena-net.test.ts` (append)

**Interfaces:**
- Consumes: `NetStats` (Task 5), `bodyOf` (`match/frame-builder.ts`), `PredictionBuffer.reconcile`.
- Produces: `class PoseHistory { push(tick, sessionId, pose); at(sessionId, tick): SimBody | undefined; forget(sessionId) }`, `POSE_HISTORY_TICKS = 128`; on `ArenaNet`: `attachStats(stats: NetStats): void`, `setRenderDelay(ticks: number): void`, `get renderDelay(): number`, `get lastPatchTick(): number`. Tasks 7 and 8 consume them.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/client/src/match/pose-history.test.ts
import { describe, expect, it } from "vitest";
import type { SimBody } from "@motor-combat-moba/shared";
import { POSE_HISTORY_TICKS, PoseHistory } from "./pose-history.js";

const pose = (x: number): SimBody => ({
  x, y: 0, angle: 0, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0, authority: 1,
  maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
});

describe("PoseHistory", () => {
  it("answers the newest pose at or before the tick, per car", () => {
    const h = new PoseHistory();
    h.push(100, "a", pose(1));
    h.push(103, "a", pose(2));
    h.push(103, "b", pose(9));
    expect(h.at("a", 103)?.x).toBe(2);
    expect(h.at("a", 102)?.x).toBe(1);
    expect(h.at("a", 99)).toBeUndefined();
    expect(h.at("b", 200)?.x).toBe(9);
    expect(h.at("zz", 200)).toBeUndefined();
  });
  it("forgets entries older than the window", () => {
    const h = new PoseHistory();
    h.push(0, "a", pose(0));
    h.push(POSE_HISTORY_TICKS + 1, "a", pose(1));
    expect(h.at("a", 0)).toBeUndefined();
    expect(h.at("a", POSE_HISTORY_TICKS + 1)?.x).toBe(1);
  });
});
```

Append to `arena-net.test.ts`'s `describe("ArenaNet")` (it already has `state`, `net`, `sent`, `FORWARD`):

```ts
  it("records a correction on the attached stats when the server disagrees", () => {
    const stats = new NetStats();
    net.attachStats(stats);
    net.pumpInput(state, MS_PER_TICK, () => FORWARD, (msg) => sent.push(msg));
    const me = state.players.get("me")!;
    me.lastProcessedInputSeq = sent[0].seq;
    me.x = net.predictedPose!.x + 10;
    net.onPatch(state, 1000);
    expect(stats.corrections).toBe(1);
    expect(stats.snaps).toBe(0);
  });

  it("renders every car D ticks behind the newest patch when the render delay is set", () => {
    net.onPatch(state, 1000);
    state.tick = 103;
    state.players.get("them")!.x = 960;
    state.players.get("me")!.x = 330;
    net.onPatch(state, 1100);
    net.setRenderDelay(2);
    expect(net.renderDelay).toBe(2);
    expect(net.lastPatchTick).toBe(103);
    const frame = net.frame(state, 1100, 1100);
    expect(frame.cars.map((c) => c.pose.x)).toEqual([300, 900]);
    net.setRenderDelay(0);
    expect(net.frame(state, 1100, 1100).cars[1].serverPose.x).toBe(960);
  });
```

with `import { NetStats } from "./netgraph.js";` added to that test file.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/client && npx vitest run src/match/pose-history.test.ts src/match/arena-net.test.ts`
Expected: FAIL — `pose-history.js` not found; `attachStats` is not a function.

- [ ] **Step 3: Write `PoseHistory` and extend `ArenaNet`**

```ts
// packages/client/src/match/pose-history.ts
import type { SimBody } from "@motor-combat-moba/shared";

/** How many ticks of server poses are kept per car — about four seconds at 30 Hz, N1's ring length. */
export const POSE_HISTORY_TICKS = 128;

interface Entry {
  tick: number;
  pose: SimBody;
}

/**
 * Every car's server poses by tick, bounded (netcode spec N29). This is what the dev-only `D` knob
 * reads: "render every car `D` ticks behind the newest patch" is `at(sid, lastPatchTick - D)`.
 * Not read by prediction or interpolation; it exists so raw server state can be drawn with
 * prediction bypassed, which is how a bug is sorted into "sim" or "prediction".
 */
export class PoseHistory {
  private readonly cars = new Map<string, Entry[]>();

  push(tick: number, sessionId: string, pose: SimBody): void {
    let entries = this.cars.get(sessionId);
    if (!entries) {
      entries = [];
      this.cars.set(sessionId, entries);
    }
    entries.push({ tick, pose: { ...pose } });
    const horizon = tick - POSE_HISTORY_TICKS;
    let drop = 0;
    while (drop < entries.length && entries[drop]!.tick < horizon) drop++;
    if (drop > 0) entries.splice(0, drop);
  }

  /** The newest pose recorded at or before `tick`, or `undefined` if none survives. */
  at(sessionId: string, tick: number): SimBody | undefined {
    const entries = this.cars.get(sessionId);
    if (!entries) return undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]!.tick <= tick) return { ...entries[i]!.pose };
    }
    return undefined;
  }

  forget(sessionId: string): void {
    this.cars.delete(sessionId);
  }
}
```

In `arena-net.ts` (the preparation plan's class), add imports `import type { NetStats } from "./netgraph.js";` and `import { PoseHistory } from "./pose-history.js";`, then:

| Where | Add |
|---|---|
| fields | `private stats: NetStats \| undefined;` `private readonly history = new PoseHistory();` `private renderDelayTicks = 0;` `private patchTick = 0;` |
| after `get predictedPose()` | `attachStats(stats: NetStats): void { this.stats = stats; }` · `setRenderDelay(ticks: number): void { this.renderDelayTicks = Math.max(0, Math.floor(ticks)); }` · `get renderDelay(): number { return this.renderDelayTicks; }` · `get lastPatchTick(): number { return this.patchTick; }` |
| `onPatch`, first lines | `this.patchTick = state.tick;` then `state.players.forEach((player, sessionId) => { if (player.status === PlayerStatus.IN_MATCH) this.history.push(state.tick, sessionId, bodyOf(player)); });` before `this.reconcileLocal(state)` |
| `reconcileLocal`, the `this.predicted = this.prediction.reconcile(...)` statement | replace with `const before = this.predicted; const after = this.prediction.reconcile(authoritative, local.lastProcessedInputSeq, before, this.stepContext(state)); this.predicted = after; this.stats?.recordCorrection(Math.hypot(after.x - before.x, after.y - before.y));` |
| `poseFor`, first line | `if (this.renderDelayTicks > 0) return this.history.at(sessionId, this.patchTick - this.renderDelayTicks) ?? serverPose;` — **before** the `alive` check, so the delay applies to every car uniformly (N29: your car at the present and remotes in the past is the very error the design removes) |
| `forgetRemote` | also `this.history.forget(sessionId);` |

- [ ] **Step 4: Run the client suite**

Run: `cd packages/client && npx vitest run`
Expected: PASS; no test imports Phaser.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/match/pose-history.ts packages/client/src/match/pose-history.test.ts packages/client/src/match/arena-net.ts packages/client/src/match/arena-net.test.ts
git commit -m "feat(client): ArenaNet records corrections into NetStats and keeps a pose history for the D knob (N29)"
```

---

### Task 7: The netgraph overlay, the ping loop, and the dev-only `D` hotkeys

**Files:**
- Create: `packages/client/src/scenes/arena/netgraph-overlay.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (the composer from the preparation plan's Task 9: fields, `create`, `bindRoom`, `update`, `resetMatchState`)

**Interfaces:**
- Consumes: `NetStats`, `NetStatsView`, `ClockSync`, `countBytes` (Task 5); `ArenaNet.attachStats/setRenderDelay/renderDelay/lastPatchTick` (Task 6); `ArenaLayers`, `HUD_TEXT` (`hud-renderer.ts`) from the preparation plan; `PING_MESSAGE`, `PONG_MESSAGE`, `isPongMessage`, `NET_CONFIG.pingIntervalMs`, `MS_PER_TICK`.
- Produces: `class NetgraphOverlay { constructor(scene: Phaser.Scene, layers: ArenaLayers); render(view: NetStatsView, delay: { renderDelay: number; suggestedDelay: number }): void; destroy(): void }`.

- [ ] **Step 1: Write the overlay**

```ts
// packages/client/src/scenes/arena/netgraph-overlay.ts
import Phaser from "phaser";
import type { NetStatsView } from "../../match/netgraph.js";
import type { ArenaLayers } from "./arena-layers.js";
import { HUD_TEXT } from "./hud-renderer.js";

const NETGRAPH_X = 12;
/** Below the match clock, which hangs from the top edge; above the movement hint. */
const NETGRAPH_Y = 96;
const NETGRAPH_DEPTH = 1100;
const NETGRAPH_FONT = "14px monospace";

/**
 * The `?debug=net` read-out (netcode spec §7): the N23 counters as text, so a LAN or internet
 * playtest can be read without the harness. One HUD-camera `Text`, rebuilt each frame; nothing
 * here is a sim input.
 */
export class NetgraphOverlay {
  private readonly text: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, layers: ArenaLayers) {
    this.text = layers.hud(
      scene.add
        .text(NETGRAPH_X, NETGRAPH_Y, "", { font: NETGRAPH_FONT, color: HUD_TEXT })
        .setScrollFactor(0)
        .setDepth(NETGRAPH_DEPTH),
    );
  }

  render(view: NetStatsView, delay: { renderDelay: number; suggestedDelay: number }): void {
    this.text.setText([
      `rtt ${view.rttMs.toFixed(0)} ms  jitter ${view.jitterMs.toFixed(1)} ms  lead ${view.lead}`,
      `slack p5 ${view.slackP5}  median ${view.slackMedian}  late ${view.lateInputs}  repeated ${view.repeatedInputs}`,
      `corrections ${view.corrections}  p95 ${view.correctionP95U.toFixed(1)} u  snaps ${view.snaps}`,
      `bytes in ${view.bytesIn}  out ${view.bytesOut}`,
      `shots ${view.shots}  manual ${(view.manualShotFraction * 100).toFixed(0)}%`,
      `D ${delay.renderDelay} ticks (raw server at ${delay.suggestedDelay}; , and . to change)`,
    ]);
  }

  destroy(): void {
    this.text.destroy();
  }
}
```

- [ ] **Step 2: Wire the scene**

Add fields to `ArenaScene`:

```ts
private stats: NetStats | undefined;
private clock: ClockSync | undefined;
private netgraph: NetgraphOverlay | undefined;
private pingEvent: Phaser.Time.TimerEvent | undefined;
private delayKeys: { down: Phaser.Input.Keyboard.Key; up: Phaser.Input.Keyboard.Key } | undefined;
private lastFireSlots = 0;
```

In `create`, after `this.net.seed(this.room.state);`:

```ts
  this.stats = new NetStats();
  this.clock = new ClockSync();
  this.net.attachStats(this.stats);
```

and after `this.banners = new MatchBanners(this, this.layers);`:

```ts
  if (isNetgraphEnabled()) {
    this.netgraph = new NetgraphOverlay(this, this.layers);
    // Dev-only (N29): the knob draws raw server state with prediction bypassed. Vite replaces
    // `import.meta.env.DEV` with `false` in a release build, so the binding is dropped there.
    if (import.meta.env.DEV) this.delayKeys = this.bindDelayKeys();
  }
```

```ts
private bindDelayKeys(): { down: Phaser.Input.Keyboard.Key; up: Phaser.Input.Keyboard.Key } | undefined {
  const keyboard = this.input.keyboard;
  if (!keyboard) return undefined;
  const Codes = Phaser.Input.Keyboard.KeyCodes;
  // Comma and period: every letter near WASD is taken by driving, panning or a weapon slot.
  return { down: keyboard.addKey(Codes.COMMA), up: keyboard.addKey(Codes.PERIOD) };
}
```

In `bindRoom`, after the idle-warning binding:

```ts
  const stats = this.stats;
  const clock = this.clock;
  if (stats && clock) {
    this.unbind.push(countBytes(room.connection as unknown as CountableConnection, stats));
    this.unbind.push(
      room.onMessage(PONG_MESSAGE, (msg: unknown) => {
        if (!isPongMessage(msg)) return;
        clock.onPong(msg, performance.now());
        stats.rttMs = clock.rttMs;
        stats.jitterMs = clock.jitterMs;
      }),
    );
    this.pingEvent = this.time.addEvent({
      delay: NET_CONFIG.pingIntervalMs,
      loop: true,
      callback: () => room.send(PING_MESSAGE, { clientMs: performance.now() } satisfies PingMessage),
    });
    this.unbind.push(() => this.pingEvent?.remove(false));
  }
```

In `update`, after `if (pumped.activeInput) this.banners?.hideIdleWarning();`:

```ts
  this.countShots(room.state);
  if (this.delayKeys && net) {
    if (Phaser.Input.Keyboard.JustDown(this.delayKeys.up)) net.setRenderDelay(net.renderDelay + 1);
    if (Phaser.Input.Keyboard.JustDown(this.delayKeys.down)) net.setRenderDelay(net.renderDelay - 1);
  }
```

and at the end of `update`:

```ts
  if (this.netgraph && this.stats && this.clock) {
    this.netgraph.render(this.stats.view(), {
      renderDelay: net.renderDelay,
      // Lead is 0 until N1, so "raw server state" is one RTT behind the present (N29: D = lead + RTT).
      suggestedDelay: Math.ceil(this.clock.rttMs / MS_PER_TICK),
    });
  }
```

```ts
/** A press edge on any slot counts one shot; with no lock target it is in the manual zone (spec §7). */
private countShots(state: ArenaState): void {
  const stats = this.stats;
  const me = state.players.get(this.net?.drivenSid(state) ?? "");
  if (!stats || !me) return;
  const now = this.sampleInput().fireSlots;
  const pressed = now & ~this.lastFireSlots;
  this.lastFireSlots = now;
  if (pressed === 0) return;
  stats.shots += 1;
  if (me.lockTargetSessionId === "") stats.manualShots += 1;
}
```

In `resetMatchState`, alongside the other renderer teardown: `this.netgraph?.destroy(); this.netgraph = undefined; this.stats = undefined; this.clock = undefined; this.delayKeys = undefined; this.lastFireSlots = 0;` (`pingEvent` is removed by `unbindAll`). Imports: `NetStats`, `ClockSync`, `countBytes`, `type CountableConnection`, `NetgraphOverlay`, `isNetgraphEnabled`, and `PING_MESSAGE`, `PONG_MESSAGE`, `isPongMessage`, `NET_CONFIG`, `MS_PER_TICK`, `type PingMessage` from shared.

- [ ] **Step 3: Typecheck, build, smoke**

Run: `cd packages/client && npm run typecheck && cd ../.. && npm run build && npm run smoke:arena`
Expected: clean; the smoke check still passes (it does not pass `?debug=net`). Then `npm run dev`, open `http://localhost:5173/?debug=net`, Practice → Start: the overlay shows an RTT of a few ms, bytes climbing, and `.` raises `D` — at `D = 3` the driven car visibly lags the keys and no correction is counted; `,` returns it to 0.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/scenes/arena/netgraph-overlay.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(client): ?debug=net netgraph overlay, ping loop, and the dev-only D render-delay knob (N23, N29)"
```

---

### Task 8: The netcode harness, `playtest/netcode.ts`

**Files:**
- Create: `packages/server/playtest/netcode.ts`
- Modify: `packages/server/playtest/run-all.ts:21`, `packages/server/playtest/README.md` (probe list, the file table)

**Interfaces:**
- Consumes: `PlaytestWorld` (`playtest/world.ts`), `Reporter`/`VERDICT` (`playtest/reporter.ts`), `ArenaNet` (`client/src/match/arena-net.ts`, as `prediction.ts` already imports `PredictionBuffer` from the client package), `NetStats`, `ClockSync` (Task 5), `contactSet`/`worldHash` (Task 2 via `src/net/differ.ts`), `HASH_QUANT`.
- Produces: `npm run playtest` runs it as the seventh probe; `npx tsx playtest/netcode.ts` alone. Reports only; no export.

Spec §7 names this file as the successor of `prediction.ts`; `prediction.ts` stays and is not edited.

- [ ] **Step 1: Write the harness**

```ts
// packages/server/playtest/netcode.ts
/**
 * The netcode harness (netcode spec §7): the real room pipeline (`PlaytestWorld`) and the real
 * client net half (`ArenaNet`) joined by a link model — latency, jitter, loss-as-stall — driven by
 * scripted inputs. It follows the playtest rules: it reports, it sweeps the sub-tick phase for
 * contact, and it never asserts. Phase 0 measures the SHIPPED client: prediction of the local car
 * only, remotes interpolated `NET_CONFIG.interpolationDelayMs` in the past, patches at
 * `DEFAULT_PATCH_RATE_HZ`. Later phases keep the scenarios and change what the numbers say.
 */
import {
  AIM_CONFIG,
  ArenaState,
  DEFAULT_PATCH_RATE_HZ,
  DRIVE_CONFIG,
  MS_PER_TICK,
  NET_CONFIG,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  WEAPON_TABLE,
  forwardMaxSpeedOf,
  getArena,
  type InputMessage,
  type PongMessage,
  type SimBody,
} from "@motor-combat-moba/shared";
import { ArenaNet, type RawInput } from "../../client/src/match/arena-net.js";
import { ClockSync } from "../../client/src/match/clock.js";
import { NetStats } from "../../client/src/match/netgraph.js";
import { HASH_QUANT } from "../src/net/differ.js";
import { PlaytestWorld } from "./world.js";
import { Reporter, VERDICT } from "./reporter.js";

const ARENA = getArena("arena-01");
const FRAME_MS = 1000 / 60;
const PATCH_EVERY = Math.round(TICK_RATE_HZ / DEFAULT_PATCH_RATE_HZ);
const ANGLE_QUANTUM = (Math.PI * 2) / HASH_QUANT.angleSteps;
const POS_QUANTUM = 1 / HASH_QUANT.posPerUnit;
/** Cars closer than this are "in contact" for the contact-phase numbers, as `prediction.ts` counts it. */
const CONTACT_GAP_U = 70;

/* ------------------------------------------------------------------------------- link model */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LinkOpts { latencyMs: number; jitterMs: number; lossRate: number; seed: number }

/** One direction of a TCP-like link: in-order delivery, a lost packet stalls itself and everything behind it by one RTT. */
class Link<T> {
  private queue: { at: number; msg: T }[] = [];
  private lastDelivery = 0;
  private readonly rand: () => number;
  constructor(private readonly opts: LinkOpts) { this.rand = mulberry32(opts.seed); }
  send(msg: T, nowMs: number): void {
    const jitter = (this.rand() * 2 - 1) * this.opts.jitterMs;
    const stall = this.rand() < this.opts.lossRate ? 2 * this.opts.latencyMs : 0;
    const at = Math.max(this.lastDelivery, nowMs + Math.max(0, this.opts.latencyMs + jitter) + stall);
    this.lastDelivery = at;
    this.queue.push({ at, msg });
  }
  drain(untilMs: number): T[] {
    const due = this.queue.filter((e) => e.at <= untilMs).map((e) => e.msg);
    this.queue = this.queue.filter((e) => e.at > untilMs);
    return due;
  }
}

/* ------------------------------------------------------------------------------- one trial */
interface PlayerSnap extends SimBody { lastProcessedInputSeq: number; alive: boolean; hp: number }
interface Patch { tick: number; players: Map<string, PlayerSnap>; bytes: number }

interface TrialOpts {
  latencyMs: number; jitterMs?: number; lossRate?: number; seed?: number; ticks?: number;
  /** Head-on: "them" starts this many units short of one tick of closing travel from contact. */
  headOn?: { startGap: number };
}

interface TrialResult {
  corrections: number[]; snaps: number; contactCorrections: number[];
  frames: number; frozenFrames: number; remoteErrors: number[];
  starvedTicks: number; matchTicks: number; divergent: Record<string, number>; divergenceSamples: number;
  patchBytes: number[]; tickMs: number[]; rttMs: number; jitterMs: number;
}

const bodyOf = (p: PlayerState): SimBody => ({
  x: p.x, y: p.y, angle: p.angle, speed: p.speed, reverseHold: p.reverseHold, angVel: p.angVel,
  shoveX: p.shoveX, shoveY: p.shoveY, authority: p.authority, maneuver: p.maneuver,
  maneuverTicksLeft: p.maneuverTicksLeft, maneuverAngle: p.maneuverAngle, maneuverSpeed: p.maneuverSpeed,
});

function writeBody(p: PlayerState, b: SimBody): void {
  p.x = b.x; p.y = b.y; p.angle = b.angle; p.speed = b.speed; p.reverseHold = b.reverseHold;
  p.angVel = b.angVel; p.shoveX = b.shoveX; p.shoveY = b.shoveY; p.authority = b.authority;
  p.maneuver = b.maneuver; p.maneuverTicksLeft = b.maneuverTicksLeft;
  p.maneuverAngle = b.maneuverAngle; p.maneuverSpeed = b.maneuverSpeed;
}

function trial(opts: TrialOpts): TrialResult {
  const seed = opts.seed ?? 1;
  const total = opts.ticks ?? 240;
  const closingPerTick = (2 * forwardMaxSpeedOf("mirage")) / TICK_RATE_HZ;
  const themX = opts.headOn ? 300 + DRIVE_CONFIG.carWidth + 8 * closingPerTick + opts.headOn.startGap : 900;
  const world = new PlaytestWorld([
    { id: "me", carId: "mirage", x: 300, y: 360, angle: 0 },
    { id: "them", carId: "mirage", x: themX, y: opts.headOn ? 360 : 200, angle: Math.PI },
  ]);

  // The client's mirror of the room state, refreshed from each delivered patch.
  const view = new ArenaState();
  view.phase = RoomPhase.MATCH;
  view.arenaId = "arena-01";
  for (const id of ["me", "them"]) {
    const p = new PlayerState();
    const src = world.get(id);
    p.sessionId = id; p.carId = "mirage"; p.status = PlayerStatus.IN_MATCH; p.alive = true; p.hp = src.hp;
    writeBody(p, bodyOf(src));
    view.players.set(id, p);
  }
  const net = new ArenaNet(ARENA, "me");
  const stats = new NetStats();
  const clock = new ClockSync();
  net.attachStats(stats);
  net.seed(view);

  const link = { latencyMs: opts.latencyMs, jitterMs: opts.jitterMs ?? 0, lossRate: opts.lossRate ?? 0 };
  const up = new Link<InputMessage | { ping: number }>({ ...link, seed });
  const down = new Link<Patch | PongMessage>({ ...link, seed: seed + 1 });

  const predictedAfterSeq = new Map<number, SimBody>();
  const r: TrialResult = {
    corrections: [], snaps: 0, contactCorrections: [], frames: 0, frozenFrames: 0, remoteErrors: [],
    starvedTicks: 0, matchTicks: 0, divergent: { x: 0, y: 0, angle: 0, speed: 0 }, divergenceSamples: 0,
    patchBytes: [], tickMs: [], rttMs: 0, jitterMs: 0,
  };
  let lastRemoteRender: SimBody | undefined;
  let nextPingMs = 0;
  const FORWARD: RawInput = { steer: 0, throttle: 1, fireSlots: 0 };

  for (let t = 1; t <= total; t++) {
    const nowMs = t * MS_PER_TICK;
    // ---- client tick: sample, send, predict
    net.pumpInput(view, MS_PER_TICK, () => FORWARD, (msg) => {
      up.send(msg, nowMs);
      if (net.predictedPose) predictedAfterSeq.set(msg.seq, { ...net.predictedPose });
    });
    if (nowMs >= nextPingMs) { up.send({ ping: nowMs }, nowMs); nextPingMs = nowMs + NET_CONFIG.pingIntervalMs; }
    // ---- server: intake, tick, patch
    let sawInput = false;
    for (const msg of up.drain(nowMs)) {
      if ("ping" in msg) down.send({ clientMs: msg.ping, serverTick: world.state.tick, msIntoTick: 0 }, nowMs);
      else { world.queues.get("me")!.push(msg); sawInput = true; }
    }
    if (!sawInput) r.starvedTicks++;
    r.matchTicks++;
    world.input("them", { throttle: 1 });
    const t0 = performance.now();
    world.tick();
    r.tickMs.push(performance.now() - t0);
    if (t % PATCH_EVERY === 0) {
      const players = new Map<string, PlayerSnap>();
      world.state.players.forEach((p, id) => players.set(id, { ...bodyOf(p), lastProcessedInputSeq: p.lastProcessedInputSeq, alive: p.alive, hp: p.hp }));
      const bytes = world.state.encode().length;
      world.state.discardAllChanges();
      r.patchBytes.push(bytes);
      down.send({ tick: world.state.tick, players, bytes }, nowMs);
    }
    // ---- client: apply whatever arrived, frame at 60 Hz until the next tick
    for (const msg of down.drain(nowMs)) {
      if ("clientMs" in msg) { clock.onPong(msg, nowMs); continue; }
      view.tick = msg.tick;
      for (const [id, snap] of msg.players) {
        const p = view.players.get(id)!;
        writeBody(p, snap); p.lastProcessedInputSeq = snap.lastProcessedInputSeq; p.alive = snap.alive; p.hp = snap.hp;
      }
      const before = stats.correctionMagnitudes.length;
      const snapsBefore = stats.snaps;
      net.onPatch(view, nowMs);
      const moved = stats.correctionMagnitudes.length > before ? stats.correctionMagnitudes.at(-1)! : 0;
      r.corrections.push(moved);
      r.snaps += stats.snaps - snapsBefore;
      const gap = Math.hypot(world.get("me").x - world.get("them").x, world.get("me").y - world.get("them").y);
      if (gap < CONTACT_GAP_U) r.contactCorrections.push(moved);
      // Divergence: the server's pose after seq k against what the client predicted after seq k.
      const me = msg.players.get("me")!;
      const predicted = predictedAfterSeq.get(me.lastProcessedInputSeq);
      if (predicted) {
        r.divergenceSamples++;
        if (Math.abs(predicted.x - me.x) > POS_QUANTUM) r.divergent.x += 1;
        if (Math.abs(predicted.y - me.y) > POS_QUANTUM) r.divergent.y += 1;
        if (Math.abs(Math.atan2(Math.sin(predicted.angle - me.angle), Math.cos(predicted.angle - me.angle))) > ANGLE_QUANTUM) r.divergent.angle += 1;
        if (Math.abs(predicted.speed - me.speed) > POS_QUANTUM) r.divergent.speed += 1;
        for (const k of [...predictedAfterSeq.keys()]) if (k <= me.lastProcessedInputSeq) predictedAfterSeq.delete(k);
      }
    }
    for (let f = nowMs; f < nowMs + MS_PER_TICK; f += FRAME_MS) {
      const frame = net.frame(view, f, f);
      const them = frame.cars.find((c) => c.sessionId === "them")!;
      const truth = world.get("them");
      r.frames++;
      r.remoteErrors.push(Math.hypot(them.pose.x - truth.x, them.pose.y - truth.y));
      if (lastRemoteRender && truth.speed !== 0 && them.pose.x === lastRemoteRender.x && them.pose.y === lastRemoteRender.y && them.pose.angle === lastRemoteRender.angle) r.frozenFrames++;
      lastRemoteRender = them.pose;
    }
  }
  r.rttMs = clock.rttMs;
  r.jitterMs = clock.jitterMs;
  return r;
}

/* ------------------------------------------------------------------------------- reporting */
function pct(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}
const f1 = (n: number): string => n.toFixed(1).padStart(6);
const f2 = (n: number): string => n.toFixed(2).padStart(7);

const reporter = new Reporter(
  "netcode",
  "Real ArenaNet against the real pipeline over a link model: corrections, remote error, frozen frames, divergence, bytes.",
);

/* N1. free driving by latency */
{
  const rows: string[] = [];
  let worstP95 = 0;
  for (const latencyMs of [0, 30, 45, 60, 75]) {
    const r = trial({ latencyMs });
    worstP95 = Math.max(worstP95, pct(r.corrections, 0.95));
    const div = Object.entries(r.divergent).map(([k, v]) => `${k} ${v}/${r.divergenceSamples}`).join(" ");
    rows.push(
      `${String(latencyMs).padStart(3)} ms one-way  correction p50 ${f2(pct(r.corrections, 0.5))}u p95 ${f2(pct(r.corrections, 0.95))}u max ${f2(Math.max(0, ...r.corrections))}u  ` +
        `starved ${((r.starvedTicks / r.matchTicks) * 100).toFixed(1).padStart(5)}%  remote err p95 ${f1(pct(r.remoteErrors, 0.95))}u  ` +
        `patch ${f1(pct(r.patchBytes, 0.5))} B  tick ${(pct(r.tickMs, 0.5)).toFixed(3)} ms  rtt est ${f1(r.rttMs)} ms  divergent fields: ${div}`,
    );
  }
  reporter.report(
    "N1. Free driving: local correction, starved ticks, remote display error, divergence, bytes, tick time",
    worstP95 > 1 ? VERDICT.FINDING : VERDICT.OK,
    `sim ${TICK_RATE_HZ} Hz, patches ${DEFAULT_PATCH_RATE_HZ} Hz, interpolation ${NET_CONFIG.interpolationDelayMs} ms, ` +
      `divergence quantum ${POS_QUANTUM} u / ${ANGLE_QUANTUM.toExponential(2)} rad (§7: a field past the quantum on >1% of\n` +
      `samples is a bug in the shared step). "starved" = server ticks with no input for "me" (F2).\n${rows.join("\n")}`,
  );
}

/* N2. head-on collision, sub-tick phase sweep */
{
  const closingPerTick = (2 * forwardMaxSpeedOf("mirage")) / TICK_RATE_HZ;
  const phases = 12;
  const rows: string[] = [];
  let worstMax = 0;
  for (const latencyMs of [0, 30, 45, 60]) {
    const maxes: number[] = [];
    const p95s: number[] = [];
    for (let i = 0; i < phases; i++) {
      const r = trial({ latencyMs, headOn: { startGap: (i / phases) * closingPerTick } });
      maxes.push(Math.max(0, ...r.contactCorrections));
      p95s.push(pct(r.contactCorrections, 0.95));
    }
    worstMax = Math.max(worstMax, ...maxes);
    rows.push(`${String(latencyMs).padStart(3)} ms one-way  in-contact correction: p95 over phases ${f2(pct(p95s, 0.95))}u  max ${f2(Math.max(...maxes))}u  min-of-max ${f2(Math.min(...maxes))}u`);
  }
  reporter.report(
    "N2. Head-on collision: correction in contact, swept over the sub-tick phase",
    worstMax > DRIVE_CONFIG.carWidth ? VERDICT.FINDING : VERDICT.OK,
    `Two mirages closing at ${closingPerTick.toFixed(1)} u/tick; startGap swept across one tick of closing travel in ${phases} steps.\n` +
      `A correction past a car length (${DRIVE_CONFIG.carWidth} u) is a snap the player sees (F1). Phase 3's acceptance line is p95 < 12 u, max < 48 u.\n${rows.join("\n")}`,
  );
}

/* N3. jitter and loss at the design point */
{
  const rows: string[] = [];
  let frozenAt25 = 0;
  for (const jitterMs of [0, 10, 25]) {
    for (const lossRate of [0, 0.01]) {
      const r = trial({ latencyMs: 45, jitterMs, lossRate, ticks: 600, seed: 7 });
      const frozen = (r.frozenFrames / r.frames) * 100;
      if (jitterMs === 25 && lossRate === 0) frozenAt25 = frozen;
      rows.push(`jitter ±${String(jitterMs).padStart(2)} ms loss ${(lossRate * 100).toFixed(0)}%  frozen remote frames ${frozen.toFixed(2).padStart(6)}%  ` +
        `remote err p95 ${f1(pct(r.remoteErrors, 0.95))}u  correction p95 ${f2(pct(r.corrections, 0.95))}u  snaps ${r.snaps}  rtt est ${f1(r.rttMs)} ms  jitter est ${f1(r.jitterMs)} ms`);
    }
  }
  reporter.report(
    "N3. Jitter and loss at 90 ms RTT: frozen remote frames (interpolation hold-last), estimates",
    frozenAt25 >= 1 ? VERDICT.FINDING : VERDICT.OK,
    `A frame is "frozen" when the remote's render pose is identical to the previous frame's while the server car was moving —\n` +
      `the InterpolationBuffer's hold-last branch. Phase 0's acceptance: under 1% at 25 ms jitter. 60 Hz frames, 20 s per cell.\n${rows.join("\n")}`,
  );
}

/* N4. weapon exposure, recomputed from the live tables */
{
  const halfExtent = DRIVE_CONFIG.carHeight / 2;
  const rows: string[] = [];
  for (const [id, def] of Object.entries(WEAPON_TABLE)) {
    if (def.kind === "maneuver") { rows.push(`${id.padEnd(12)} maneuver — contact, not a shot`); continue; }
    const reach = Math.min(def.range, AIM_CONFIG.lockRange);
    const flightMs = (reach / def.speed) * 1000 + def.startUpMs;
    const hb = def.hitbox;
    const halfWidth =
      hb.shape === "circle" ? hb.radius
      : hb.shape === "rect" ? hb.width / 2
      : hb.shape === "cone" ? reach * Math.tan((hb.angleDeg / 2) * (Math.PI / 180))
      : hb.shape === "disc" ? reach
      : hb.radiusAcross;
    rows.push(`${id.padEnd(12)} flight to ${reach.toFixed(0).padStart(4)} u: ${flightMs.toFixed(0).padStart(4)} ms (${(flightMs / MS_PER_TICK).toFixed(1).padStart(5)} ticks)` +
      `${def.range < AIM_CONFIG.lockRange ? " [short of lockRange]" : ""}  hit tolerance ${(halfWidth + halfExtent).toFixed(1).padStart(6)} u`);
  }
  reporter.report(
    "N4. Weapon exposure: flight time to lockRange and hit tolerance (§7)",
    VERDICT.BY_DESIGN,
    `flight = min(range, lockRange ${AIM_CONFIG.lockRange}) / speed + startUpMs: the victim's reaction window. tolerance = hitbox half-width\n` +
      `across the flight line + the car's narrow half-extent (${halfExtent} u): the shooter's exposure to prediction error. Measurements, not balance.\n${rows.join("\n")}`,
  );
}

reporter.finish();
```

- [ ] **Step 2: Register it and document it**

`run-all.ts:21` becomes `const PROBES = ["collision", "ram", "geometry", "weapons", "weapons2", "prediction", "netcode"] as const;` — cheapest first still holds; N2's sweep is the slowest cell here. In `README.md` add under the one-probe list `npx tsx playtest/netcode.ts   # ArenaNet vs the pipeline over a link model: corrections, frozen frames, divergence, bytes`, change "all six probe files" / "six probes" to seven where the text counts them, add `netcode.md` to the report listing, and add this paragraph to "The two harnesses":

```markdown
**`netcode.ts` — the netcode harness (netcode spec §7).** The real client net half (`ArenaNet`
from the client package, the way `prediction.ts` imports `PredictionBuffer`) against `PlaytestWorld`
over a seeded link model — latency, ±jitter, loss as a one-RTT stall, in-order delivery. Reports
local correction p50/p95/max, in-contact correction over a sub-tick phase sweep, frozen remote
frames, remote display error, starved ticks, the per-field divergence histogram, patch bytes, tick
time, and the per-weapon exposure table. Its expectations move with each netcode phase, on request.
```

- [ ] **Step 3: Run it and record the baseline**

Run: `npm run build -w @motor-combat-moba/shared && cd packages/server && npm run typecheck && npx tsx playtest/netcode.ts`
Expected: a report in `playtest/reports/<date-NN>/netcode.md`. With the shipped 50 ms buffer expect N1 `OK` (free-driving correction 0.00 u, divergent fields 0), N2 `FINDING` (in-contact max in the tens of units at 45–60 ms, matching `prediction.ts` P1's F1 numbers), and N3 `FINDING` — frozen remote frames well above 1 % at ±25 ms jitter, because 50 ms is exactly one patch interval and any late patch drops into hold-last. **Keep this report**: it is phase 0's "baseline numbers recorded", and Task 9 is compared against it. Then `npm run playtest` to confirm the seventh probe lands in the shared folder and `summary.md` lists its verdicts.

- [ ] **Step 4: Commit**

```bash
git add packages/server/playtest/netcode.ts packages/server/playtest/run-all.ts packages/server/playtest/README.md
git commit -m "feat(playtest): netcode harness — ArenaNet vs the pipeline over a link model (spec §7)"
```

This task creates a probe. It is the one the spec names; no other probe file, expectation, or number was touched, and `prediction.ts` still reports what it did.

---

### Task 9: `interpolationDelayMs` 50 → 67, measured

**Files:**
- Modify: `packages/shared/src/config/net-config.ts` (one value + comment), `packages/shared/src/config/config.test.ts` (NET_CONFIG block), `packages/client/src/scenes/impact-feedback.ts:13` (comment), `docs/config-reference.md:731-739`, `docs/networking.md:52`

- [ ] **Step 1: Write the failing test**

Append to the `NET_CONFIG` describe block:

```ts
  it("interpolates remotes more than one patch interval in the past, so a late patch has headroom (§13)", () => {
    expect(NET_CONFIG.interpolationDelayMs).toBe(67);
    expect(NET_CONFIG.interpolationDelayMs).toBeGreaterThan(1000 / DEFAULT_PATCH_RATE_HZ);
  });
```

(`DEFAULT_PATCH_RATE_HZ` joins the test's imports from `../constants.js`.)

Run: `cd packages/shared && npx vitest run src/config/config.test.ts` — Expected: FAIL, 50 ≠ 67.

- [ ] **Step 2: Change the constant**

In `net-config.ts` replace `interpolationDelayMs: 50,` with:

```ts
  /**
   * Remotes are drawn this far in the past. 50 ms was exactly one patch interval at 20 Hz — zero
   * jitter headroom, so any late patch dropped the sample into hold-last (spec F4, §13). 67 ms is
   * a patch and a third; measured by `playtest/netcode.ts` N3. Deleted again in netcode phase 3,
   * when remotes are predicted rather than interpolated.
   */
  interpolationDelayMs: 67,
```

Change `impact-feedback.ts:13`'s `(50 ms)` to `(67 ms)` — a comment quoting the value. Update `docs/config-reference.md`'s NET_CONFIG table: `interpolationDelayMs` 67, and add rows `pingIntervalMs` 500 and `clockSamples` 8; add `INPUT_LOG` to the env-knob table (`server mode.ts`, default on, `0` turns the input log off, logs under `packages/server/logs/`). In `docs/networking.md:52`, after "sampled at `now - NET_CONFIG.interpolationDelayMs`" add "(67 ms: a patch interval and a third, so a late patch has headroom before the hold-last branch — the buffer is deleted when remotes are predicted in netcode phase 3)".

- [ ] **Step 3: Rebuild, run the full suite, re-run the harness**

Run: `npm run build -w @motor-combat-moba/shared && npm test && cd packages/server && npx tsx playtest/netcode.ts`
Expected: every suite green (the interpolation tests read `DELAY` from the config, so they follow). The new `netcode.md` N3 row `jitter ±25 ms loss 0%` reports frozen remote frames **under 1 %** and reads `OK`; N1 and N2 are unchanged from Task 8's baseline (the buffer is not on the local car's path). Put both numbers — before and after — in the commit message.

Say it loudly: `NET_CONFIG` is on the list of things the probes read. No existing probe reads `interpolationDelayMs` (`prediction.ts` builds its own client context and never touches `InterpolationBuffer`), so no existing probe number moves; the only report that moves is the new `netcode.md` N3 row, which is the point.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/config/net-config.ts packages/shared/src/config/config.test.ts packages/client/src/scenes/impact-feedback.ts docs/config-reference.md docs/networking.md
git commit -m "fix(net): interpolationDelayMs 50 -> 67, a patch interval and a third of headroom (frozen remote frames <before>% -> <after>% at ±25 ms jitter)"
```

---

### Task 10: The cross-engine differ, `scripts/differ.mjs`

**Files:**
- Create: `scripts/differ-replay.mjs`, `scripts/differ.mjs`, `scripts/differ.test.mjs`
- Modify: `package.json` (root `scripts`), `docs/project-structure.md`, `packages/server/playtest/README.md` (a "Cross-engine differ" section), `packages/client/CLAUDE.md` (one line for `?debug=net`), `docs/networking.md` (a "Instrumentation" section)

**Interfaces:**
- Consumes: built shared `dist` by deep path (`sim/step.js`, `sim/context.js`, `sim/status/modifiers.js`, `sim/world-hash.js`, `arena/registry.js`); the input log format of Task 4; `playwright` (root devDependency from the preparation plan).
- Produces: `npm run differ [-- --log <file>] [--browsers chromium,firefox]`; `parseInputLog(text)`, `replayLog(text)` in `differ-replay.mjs`.

The replay module is loaded by Node **and** by the browser page, unchanged: the page is served from the repo root, so its relative `../packages/shared/dist/...` imports resolve to the same files. None of those `dist` modules import `@colyseus/schema` (checked: `sim/`, `sim/status/`, `arena/`, `config/` carry no schema import), which is what makes a bare static server enough.

- [ ] **Step 1: Write the failing test**

```js
// scripts/differ.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInputLog, replayLog, syntheticLog } from "./differ-replay.mjs";

describe("parseInputLog", () => {
  it("reads the header and the input lines", () => {
    const text = '# {"v":1,"tick":10,"arenaId":"arena-01","cars":[{"sessionId":"a","carId":"mirage","x":1,"y":2,"angle":0}]}\n11 a 0 1 0\n11 b -1 0 3\n';
    const log = parseInputLog(text);
    assert.equal(log.header.arenaId, "arena-01");
    assert.deepEqual(log.inputs, [
      { tick: 11, sessionId: "a", steer: 0, throttle: 1, fireSlots: 0 },
      { tick: 11, sessionId: "b", steer: -1, throttle: 0, fireSlots: 3 },
    ]);
  });
});

describe("replayLog", () => {
  it("is deterministic in one engine and reaches contact on a head-on script", () => {
    const text = syntheticLog(60);
    const a = replayLog(text);
    const b = replayLog(text);
    assert.deepEqual(a.map((r) => r.hash), b.map((r) => r.hash));
    assert.equal(a.length, 60);
    assert.ok(a.some((r) => r.contacts.includes("a|b")), "the two cars never touched");
  });
  it("changes the hash when one input changes", () => {
    const base = replayLog(syntheticLog(20));
    const edited = replayLog(syntheticLog(20).replace("\n15 a 0 1 0\n", "\n15 a 1 1 0\n"));
    assert.notEqual(base.at(-1).hash, edited.at(-1).hash);
  });
});
```

Run: `node --test scripts/differ.test.mjs` — Expected: FAIL, module not found.

- [ ] **Step 2: Write the replay module**

```js
// scripts/differ-replay.mjs
// The one replay that both Node and the browser page run (netcode spec §7, differ condition 2).
// Imports shared's built dist by relative path; served from the repo root, the same specifiers
// resolve in a browser. Keep this file free of Node-only imports.
import { stepSim } from "../packages/shared/dist/sim/step.js";
import { otherCarHulls } from "../packages/shared/dist/sim/context.js";
import { NEUTRAL_MODIFIERS } from "../packages/shared/dist/sim/status/modifiers.js";
import { contactSet, worldHash } from "../packages/shared/dist/sim/world-hash.js";
import { getArena } from "../packages/shared/dist/arena/registry.js";
import { MS_PER_TICK } from "../packages/shared/dist/constants.js";

const IN_MATCH = 1;
const DT = MS_PER_TICK / 1000;

/** `# <json>` then `tick sid steer throttle fireSlots` lines. A second header starts a new match. */
export function parseInputLog(text) {
  let header;
  const inputs = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("# ")) {
      if (header) break; // first match only; a rematch is a second replay
      header = JSON.parse(line.slice(2));
      continue;
    }
    const [tick, sessionId, steer, throttle, fireSlots] = line.split(" ");
    inputs.push({ tick: Number(tick), sessionId, steer: Number(steer), throttle: Number(throttle), fireSlots: Number(fireSlots) });
  }
  if (!header) throw new Error("input log has no header line");
  return { header, inputs };
}

const bodyFrom = (car) => ({
  x: car.x, y: car.y, angle: car.angle, speed: 0, reverseHold: 0, angVel: 0, shoveX: 0, shoveY: 0,
  authority: 1, maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
});

/**
 * Drive-only replay: each logged input steps its car through `stepSim` against the other cars'
 * hulls exactly as `serverTick` does (sorted by session id, hulls read live), with neutral
 * modifiers and no ram knock — those are server-only bridges, so this replay diverges from the
 * real match on the first ram but never from ITSELF across engines, which is the property tested.
 * Returns one `{ tick, hash, contacts }` per tick from the header tick + 1 to the last input tick.
 */
export function replayLog(text) {
  const { header, inputs } = parseInputLog(text);
  const arena = getArena(header.arenaId);
  const entries = [...header.cars]
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))
    .map((car) => ({ sessionId: car.sessionId, carId: car.carId, body: bodyFrom(car), player: { x: car.x, y: car.y, angle: car.angle, status: IN_MATCH, carId: car.carId, alive: true, statuses: [] } }));
  const byTick = new Map();
  for (const input of inputs) {
    if (!byTick.has(input.tick)) byTick.set(input.tick, []);
    byTick.get(input.tick).push(input);
  }
  const lastTick = inputs.length > 0 ? inputs[inputs.length - 1].tick : header.tick;
  const out = [];
  for (let tick = header.tick + 1; tick <= lastTick; tick++) {
    const applied = byTick.get(tick) ?? [];
    for (const entry of entries) {
      for (const input of applied) {
        if (input.sessionId !== entry.sessionId) continue;
        const ctx = {
          carId: entry.carId,
          others: otherCarHulls(entries, entry.sessionId, tick),
          obstacles: arena.obstacles,
          bounds: { width: arena.width, height: arena.height },
          modifiers: NEUTRAL_MODIFIERS,
        };
        entry.body = stepSim(entry.body, { seq: 0, steer: input.steer, throttle: input.throttle, fireSlots: input.fireSlots }, DT, ctx);
        entry.player.x = entry.body.x; entry.player.y = entry.body.y; entry.player.angle = entry.body.angle;
      }
    }
    const contacts = contactSet(entries.map((e) => ({ sessionId: e.sessionId, x: e.body.x, y: e.body.y, angle: e.body.angle })), arena);
    out.push({ tick, hash: worldHash(entries.map((e) => e.body), contacts), contacts });
  }
  return out;
}

/** Two mirages driving at each other for `ticks` ticks — the test fixture and the no-log fallback. */
export function syntheticLog(ticks) {
  const lines = [`# ${JSON.stringify({ v: 1, tick: 0, arenaId: "arena-01", cars: [
    { sessionId: "a", carId: "mirage", x: 300, y: 360, angle: 0 },
    { sessionId: "b", carId: "mirage", x: 700, y: 360, angle: Math.PI },
  ] })}`];
  for (let t = 1; t <= ticks; t++) lines.push(`${t} a 0 1 0`, `${t} b 0 1 0`);
  return `${lines.join("\n")}\n`;
}
```

Run: `node --test scripts/differ.test.mjs` — Expected: PASS (3 tests).

- [ ] **Step 3: Write the runner**

```js
// scripts/differ.mjs
// Cross-engine determinism differ (netcode spec §7). Replays an input log through built shared in
// Node, Chromium and Firefox, and compares worldHash per tick. Exit 0: no divergence in every
// engine asked for. Exit 1: a divergence (the report names the first tick and whether the contact
// set differed — the pre-committed trigger). Exit 2: an engine could not run, so "no divergence"
// cannot be claimed. `npm run differ -- --log <file>`; default: newest packages/server/logs/*/inputs.log,
// or the synthetic head-on script when there is none.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright";
import { replayLog, syntheticLog } from "./differ-replay.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 2598;
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".json": "application/json" };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function newestLog() {
  const root = path.join(ROOT, "packages/server/logs");
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).sort().reverse();
  for (const d of dirs) {
    const file = path.join(root, d, "inputs.log");
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

const logFile = arg("log", newestLog());
const text = logFile ? fs.readFileSync(logFile, "utf8") : syntheticLog(300);
console.log(`[differ] replaying ${logFile ?? "the synthetic head-on script (no log found)"}`);
const nodeRun = replayLog(text);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<script type="module">import { replayLog } from "/scripts/differ-replay.mjs"; window.replayLog = replayLog;</script>');
    return;
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

let exitCode = 0;
const wanted = arg("browsers", "chromium,firefox").split(",");
for (const name of wanted) {
  const engine = name === "firefox" ? firefox : chromium;
  let browser;
  try {
    browser = await engine.launch();
  } catch (error) {
    console.error(`[differ] ${name}: cannot launch (${String(error).split("\n")[0]}) — run: npx playwright install ${name}`);
    exitCode = Math.max(exitCode, 2);
    continue;
  }
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => typeof window.replayLog === "function");
  const run = await page.evaluate((t) => window.replayLog(t), text);
  await browser.close();
  const first = run.findIndex((r, i) => r.hash !== nodeRun[i]?.hash);
  if (first < 0) { console.log(`[differ] ${name}: no divergence over ${run.length} ticks`); continue; }
  const contactsDiffer = JSON.stringify(run[first].contacts) !== JSON.stringify(nodeRun[first].contacts);
  console.error(`[differ] ${name}: DIVERGENCE at tick ${run[first].tick} (${first + 1} ticks in): node ${nodeRun[first].hash} vs ${name} ${run[first].hash}` +
    (contactsDiffer ? ` — CONTACT SET differs (${JSON.stringify(nodeRun[first].contacts)} vs ${JSON.stringify(run[first].contacts)}): §7's trigger for a shared lookup table` : " — poses only"));
  exitCode = 1;
}
server.close();
if (exitCode === 2) console.error("[differ] INCOMPLETE: a supported engine did not run, so no divergence claim is made");
process.exit(exitCode);
```

Add to root `package.json` scripts: `"differ": "npm run build -w @motor-combat-moba/shared && node scripts/differ.mjs"`. `scripts/differ.test.mjs` is picked up by the existing `test:scripts` glob.

- [ ] **Step 4: Run it**

Run: `npx playwright install firefox` once (Chromium is already under `/opt/pw-browsers`), then `npm run differ`.
Expected: `chromium: no divergence over 300 ticks`, `firefox: no divergence over 300 ticks`, exit 0. Then play a practice match with `npm run dev` for a minute, stop the server, and run `npm run differ` again — it picks up `packages/server/logs/<date>-01/inputs.log`.

- [ ] **Step 5: Documentation**

`docs/project-structure.md`: add `scripts/differ.mjs` and `scripts/differ-replay.mjs` beside `scripts/build-release.mjs`; under `packages/shared/src/net/` add `ping.ts`; under `sim/` add `world-hash.ts  # worldHash + contactSet: the desync detector, browser-loadable`; under server `net/` add `input-log.ts  # the per-tick input stream (N30)` and `differ.ts  # server-side name for worldHash`; under `rooms/` add `ping-handler.ts`; under client `match/` add `clock.ts`, `netgraph.ts`, `pose-history.ts`, `byte-counter.ts`; under `scenes/arena/` add `netgraph-overlay.ts`.

`docs/networking.md`: append a section:

```markdown
## Instrumentation (netcode phase 0)

**Clock sync.** Every `NET_CONFIG.pingIntervalMs` the client sends `ping { clientMs }`; each room's
`bindPing` answers `pong { clientMs, serverTick, msIntoTick }`. `ClockSync` (`match/clock.ts`) keeps
the last `clockSamples` pongs, takes the offset from the lowest-RTT one and reports jitter as the RTT
standard deviation. Nothing consumes the estimate yet beyond the netgraph; N1's tick loop will.

**Netgraph.** `?debug=net` draws `NetStats` (`match/netgraph.ts`): RTT, jitter, corrections and their
p95, snaps, socket bytes in/out, and the fraction of presses made with no lock target. In a dev build
`,` and `.` change the `D` render delay: every car is drawn `D` ticks behind the newest patch from
`PoseHistory`, prediction bypassed — a bug that survives `D = RTT` is in the sim, one that vanishes
is in prediction.

**Input log.** `ArenaRoom` and `PracticeRoom` write every input they are about to simulate to
`packages/server/logs/<date-NN>/inputs.log` (`INPUT_LOG=0` turns it off). `npm run differ` replays
the newest log through built shared in Node, Chromium and Firefox and compares `worldHash` — quantised
poses plus the contact set — per tick. `npm run playtest` runs `playtest/netcode.ts`, the harness that
measures the shipped client over a link model.
```

`packages/client/CLAUDE.md`: after the `?debug=1` line add "`?debug=net` draws the netgraph overlay (`scenes/arena/netgraph-overlay.ts`), fed by `match/netgraph.ts`; in a dev build `,`/`.` set the `D` render delay on `ArenaNet`." `packages/server/playtest/README.md`: a short "Cross-engine differ" section pointing at `npm run differ` and the exit codes.

- [ ] **Step 6: Full verification and commit**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build`
Expected: every suite green including `scripts/differ.test.mjs`; typecheck clean; build clean.

```bash
git add scripts/differ.mjs scripts/differ-replay.mjs scripts/differ.test.mjs package.json docs/project-structure.md docs/networking.md packages/server/playtest/README.md packages/client/CLAUDE.md
git commit -m "feat(scripts): cross-engine differ replays the input log in Node, Chromium and Firefox and compares worldHash (spec §7)"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

---

## Acceptance

Spec §8, phase 0 row: **Ships** — "`NET_CONFIG.interpolationDelayMs` 50 → 67 (a one-constant fix for the shipped zero-headroom buffer, deleted again by phase 3); ping/pong, RTT and jitter estimate, netgraph overlay, the input log (N30), the netcode harness with today's client, the differ (§7)". **Fixes** — "F4 (half)". **Acceptance** — "baseline numbers recorded; frozen-remote frames under 1 % at 25 ms jitter".

| Requirement | Demonstrated by |
|---|---|
| Baseline numbers recorded | Task 8 Step 3: `cd packages/server && npx tsx playtest/netcode.ts` **before** Task 9 — the report folder it names holds N1–N4 at the 50 ms buffer; Task 9's commit message quotes the N3 frozen-frame figure from it |
| Frozen-remote frames under 1 % at 25 ms jitter | Task 9 Step 3: the same command after the constant change; `netcode.md` N3 row `jitter ±25 ms loss 0%` reads `OK` with the percentage under 1 |
| Ping/pong, RTT and jitter estimate | `cd packages/client && npx vitest run src/match/clock.test.ts`; `cd packages/server && npx vitest run src/rooms/ping-handler.test.ts`; `?debug=net` shows a live RTT in the browser (Task 7 Step 3) |
| Netgraph overlay | `npm run dev`, `http://localhost:5173/?debug=net`, Practice → Start |
| Input log | play a practice match, then `ls packages/server/logs/*/inputs.log` |
| Harness with today's client | `npm run playtest` lists `netcode` in `summary.md` |
| Differ | `npm run differ` exits 0 with both `chromium` and `firefox` reporting no divergence |
| Everything else still green | `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena` |

## Handoff

Exports this plan produces **beyond** the ledger, for N1–N3 to consume or retire:

- Shared: `isPongMessage` (`net/ping.ts`); `InputFrame` landed in N0 (ledger dates it N1; `InputMessage extends InputFrame { seq }` until N1 replaces `seq` with `tick`); `sim/world-hash.ts` — `worldHash` (implemented here, re-exported by server `net/differ.ts`), `contactSet`, `ContactSetCar`, `HASH_QUANT` (`{ posPerUnit: 16, angleSteps: 65536 }` — N2's `QUANT` should be the single source and this a re-export of it), `WALL_CONTACT_SUFFIX`.
- Server: `InputLog.begin(header: InputLogHeader)`, `InputLogHeader`, `INPUT_LOG_FILE`, `configureInputLogs`, `openInputLog` (`net/input-log.ts`); `isInputLogEnabled` (`mode.ts`); each room's private `roomClock()` / `lastTickAtMs` — N1's `TickScheduler.msIntoTick` replaces the stamp, and `bindPing`'s `clock` argument is where it plugs in.
- Client: `NetStats.recordCorrection(distanceU)`, `NetStats.correctionMagnitudes`, `NetStats.shots`, `NetStats.manualShots`, `NetStatsView.{slackP5, slackMedian, correctionP95U, shots, manualShotFraction}`, `CORRECTION_FLOOR_U`, `CORRECTION_RING` (`match/netgraph.ts`); `countBytes`, `CountableConnection` (`match/byte-counter.ts`); `PoseHistory`, `POSE_HISTORY_TICKS` (`match/pose-history.ts`); on `ArenaNet`: `attachStats`, `setRenderDelay`, `renderDelay`, `lastPatchTick` — `MatchClient` (N3) keeps all four behind the same names; `isNetgraphEnabled` (`config/client-mode.ts`); `NetgraphOverlay` (`scenes/arena/netgraph-overlay.ts`).
- Scripts: `parseInputLog`, `replayLog`, `syntheticLog` (`scripts/differ-replay.mjs`); `npm run differ` (exit 0 / 1 divergence / 2 incomplete).
- Not done here, on purpose: `playtest:lan` printing the netgraph counters (spec §7) — `lan.ts` is an existing probe and this plan does not edit probes; it is listed for the user to ask for.

## Self-review

**Spec coverage.** N3: Task 1 (messages), Task 3 (server), Task 5 (`ClockSync`, lowest-RTT offset, RTT-stddev jitter) — dilation is N1 and deliberately absent. N23's `netgraph.ts`: Task 5, drawn by Task 7 under `?debug=net`. N29: Task 6 (history, uniform delay, prediction bypassed) and Task 7 (dev-only hotkeys, `D = RTT` suggested since lead is 0). N30: Task 4 (per-tick, applied order, gitignored, header for replay). §7 harness: Task 8 (link with latency/jitter/loss-as-stall, sub-tick sweep, reports-not-asserts, the per-metric list — slack, late/repeated and ghost mismatch are named as not yet measurable). §7 divergence and differ conditions: Task 2 (contact sets and wall booleans hashed), Task 10 (Chromium + Firefox, exit 2 when either is missing, contact-set divergence named as the trigger). §7 weapon exposure: Task 8 N4; manual-zone fraction: Task 7's `countShots`. §8 row and §13: Task 9, measured before/after by Task 8's harness.

**Placeholder scan.** Every code step prints its code; the three room edits and the `ArenaNet` edit are substitution tables against the preparation plan's named members; no "TBD", no "handle edge cases".

**Type consistency.** `PongMessage` (Task 1) is what `ClockSync.onPong` (Task 5), `bindPing` (Task 3) and the harness's `down` link (Task 8) carry. `NetStats.recordCorrection(distanceU)` (Task 5) is what `ArenaNet.reconcileLocal` calls (Task 6) and what the harness reads through `correctionMagnitudes` (Task 8). `NetStatsView` (Task 5) is `NetgraphOverlay.render`'s first parameter (Task 7). `ArenaNet.attachStats/setRenderDelay/renderDelay/lastPatchTick` are named identically in Tasks 6, 7 and 8. `contactSet(cars, arena)` (Task 2) takes the `{ sessionId, x, y, angle }` list both `replayLog` (Task 10) builds. `InputLog.begin/record/flush` (Task 4) match the room calls in the same task and the format `parseInputLog` (Task 10) reads.
