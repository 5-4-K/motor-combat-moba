# Phase D — time and inputs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One authoritative clock: every car steps exactly once per tick with the input its owner sent for that tick; clients sync to the server's clock and run slightly ahead; the speed hack is gone.

**Architecture:** Pure shared modules first (`tick-input.ts`, `clock-sync.ts`, `input-scheduler.ts`, a tick-keyed prediction buffer), then additive clock messages, then one atomic switch of the wire protocol on server, bots, harnesses and client together, then hardening and measurement.

**Tech Stack:** TypeScript, vitest, Colyseus 0.18.

**Spec:** `docs/superpowers/specs/2026-09-29-online-netcode-redesign-design.md` (NR17–NR28, NR54–NR56)

## Global Constraints

- `NET_CONFIG` values introduced here: `targetSlackTicks: 1.5`, `maxDilation: 0.04`, `inputRepeatMs: 250`, `maxInputLeadMs: 250`, `inputRedundancy: 3`, `maxCatchUpTicks: 8`, `timeSyncIntervalMs: 500`, `timeSyncBurstMs: 100`, `timeSyncBurstWindowMs: 1000`.
- Deleted by the end of the phase: `NET_CONFIG.maxInputsPerTick`, `silentCoastGraceMs`, `pendingInputCap`; `PlayerState.lastProcessedInputSeq`; `InputMessage.seq`; `drainTicks`; the silent-coast branch of `serverTick`.
- The input *content* (`steer`, `throttle`, `fireSlots`, `aimAngle`) and all of `stepSim` are unchanged.
- Press detection stays server-side against the previous **consumed** mask.

## Review Focus

- A client whose clock runs 1 % fast or slow for a minute still lands inputs on time — pinned by D2's scheduler drift test.
- A burst of 5 duplicate packets for the same ticks never steps a car twice — pinned by D1's buffer test and D4's `serverTick` test.
- A browser tab that stalls for 2 s then resumes must not flood 120 inputs: it resyncs and skips — pinned by D2's catch-up test.
- A held fire key across a repeated (missing) input never fires twice — pinned by D4's press test.
- A client sending frames 10 s in the future or in the past has them dropped, not buffered — pinned by D1.
- `stepsPerTickMax` counts actual `stepSim` calls per car per tick (reported by `serverTick`/its result or a test spy), not a re-implementation of the drain rule — otherwise the speed-hack acceptance line proves nothing.

---

### Task 1 (D1): `InputFrame`, packet validation and `TickInputBuffer`

**Files:**
- Create: `packages/shared/src/net/tick-input.ts`, `packages/shared/src/net/tick-input.test.ts`
- Modify: `packages/shared/src/index.ts` (export it), `packages/shared/src/config/net-config.ts` (the new knobs from Global Constraints; leave the old ones until D4)

**Interfaces:**
- Produces:
  ```ts
  export interface InputKeys { steer: -1 | 0 | 1; throttle: -1 | 0 | 1; fireSlots: number; aimAngle?: number }
  export interface InputFrame extends InputKeys { tick: number; viewTick?: number }
  export interface InputPacket { inputs: InputFrame[] }
  export const NEUTRAL_KEYS: Readonly<InputKeys>;
  export const MAX_FRAMES_PER_PACKET = 4;
  export function isInputPacket(msg: unknown): msg is InputPacket;
  export type OfferResult = "accepted" | "duplicate" | "late" | "early";
  export interface TakenInput { keys: InputKeys; frame: InputFrame | undefined; repeated: boolean }
  export class TickInputBuffer {
    constructor(repeatTicks: number, maxLeadTicks: number);
    offer(frame: InputFrame, lastCompletedTick: number): OfferResult;
    take(tick: number): TakenInput;
    slackMeanTicks(): number;   // mean of (frame.tick − (lastCompletedTick+1)) over the last 30 accepted
    slackStdTicks(): number;    // standard deviation of the same window
  }
  export function newTickInputBuffer(): TickInputBuffer; // from NET_CONFIG via msToTicks
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/net/tick-input.test.ts
import { describe, expect, it } from "vitest";
import { NEUTRAL_KEYS, TickInputBuffer, isInputPacket, type InputFrame } from "./tick-input.js";

const f = (tick: number, over: Partial<InputFrame> = {}): InputFrame => ({ tick, steer: 0, throttle: 1, fireSlots: 0, ...over });

describe("isInputPacket", () => {
  it("accepts 1..4 valid frames", () => {
    expect(isInputPacket({ inputs: [f(10)] })).toBe(true);
    expect(isInputPacket({ inputs: [f(7), f(8), f(9), f(10, { aimAngle: 1.2, viewTick: 4 })] })).toBe(true);
  });
  it("rejects bad shapes", () => {
    expect(isInputPacket(null)).toBe(false);
    expect(isInputPacket({ inputs: [] })).toBe(false);
    expect(isInputPacket({ inputs: [f(1), f(2), f(3), f(4), f(5)] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), steer: 2 }] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), tick: -1 }] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), tick: 1.5 }] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), fireSlots: 1.5 }] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), aimAngle: Number.NaN }] })).toBe(false);
    expect(isInputPacket({ inputs: [{ ...f(1), viewTick: -3 }] })).toBe(false);
  });
});

describe("TickInputBuffer", () => {
  it("consumes the frame for its own tick, once", () => {
    const b = new TickInputBuffer(15, 15);
    expect(b.offer(f(11, { steer: 1 }), 10)).toBe("accepted");
    expect(b.offer(f(11, { steer: -1 }), 10)).toBe("duplicate");
    const got = b.take(11);
    expect(got.repeated).toBe(false);
    expect(got.keys.steer).toBe(1);
  });

  it("drops late and far-future frames", () => {
    const b = new TickInputBuffer(15, 15);
    expect(b.offer(f(10), 10)).toBe("late");
    expect(b.offer(f(11 + 16), 10)).toBe("early");
    expect(b.offer(f(11 + 15), 10)).toBe("accepted");
  });

  it("repeats the last real input while missing, then goes neutral", () => {
    const b = new TickInputBuffer(2, 15);
    b.offer(f(1, { steer: 1, fireSlots: 2 }), 0);
    b.take(1);
    expect(b.take(2)).toMatchObject({ repeated: true, keys: { steer: 1, fireSlots: 2 } });
    expect(b.take(3)).toMatchObject({ repeated: true, keys: { steer: 1 } });
    expect(b.take(4)).toMatchObject({ repeated: true, keys: NEUTRAL_KEYS });
  });

  it("discards frames at or below a taken tick", () => {
    const b = new TickInputBuffer(15, 15);
    b.offer(f(5), 3);
    b.take(6);
    expect(b.take(5).repeated).toBe(true); // already discarded
  });

  it("measures slack from accepted frames only", () => {
    const b = new TickInputBuffer(15, 15);
    b.offer(f(12), 10); // slack 1
    b.offer(f(14), 10); // slack 3
    b.offer(f(14), 10); // duplicate, ignored
    expect(b.slackMeanTicks()).toBe(2);
    expect(b.slackStdTicks()).toBe(1);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root packages/shared src/net/tick-input.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/net/tick-input.ts
import { NET_CONFIG } from "../config/net-config.js";
import { msToTicks } from "../config/weapon-ticks.js";

/** What a player's hands are doing on one tick. `stepSim` reads only these. */
export interface InputKeys {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  /** Slot bitmask, bit 0 = the basic attack (VS15); the server masks it to the car's real slots. */
  fireSlots: number;
  /** World bearing from the turret pivot to the crosshair (TR21); read only on a new press (TR23). */
  aimAngle?: number;
}

/** One tick's input, stamped with the tick it is FOR (NR17, NR25). The tick is the sequence number. */
export interface InputFrame extends InputKeys {
  tick: number;
  /** The render tick the client was drawing remotes at when it produced this frame (NR35). */
  viewTick?: number;
}

/** The newest frame plus up to three before it, oldest first (NR24). */
export interface InputPacket {
  inputs: InputFrame[];
}

export const NEUTRAL_KEYS: Readonly<InputKeys> = Object.freeze({ steer: 0, throttle: 0, fireSlots: 0 });
export const MAX_FRAMES_PER_PACKET = 4;

const isAxis = (n: unknown): n is -1 | 0 | 1 => n === -1 || n === 0 || n === 1;
const isTick = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

function isInputFrame(v: unknown): v is InputFrame {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    isTick(r.tick) &&
    isAxis(r.steer) &&
    isAxis(r.throttle) &&
    Number.isInteger(r.fireSlots) &&
    (r.aimAngle === undefined || (typeof r.aimAngle === "number" && Number.isFinite(r.aimAngle))) &&
    (r.viewTick === undefined || isTick(r.viewTick))
  );
}

/** Wire validation. Everything a client sends is untrusted. */
export function isInputPacket(msg: unknown): msg is InputPacket {
  if (msg === null || typeof msg !== "object") return false;
  const inputs = (msg as Record<string, unknown>).inputs;
  return (
    Array.isArray(inputs) &&
    inputs.length >= 1 &&
    inputs.length <= MAX_FRAMES_PER_PACKET &&
    inputs.every(isInputFrame)
  );
}

export type OfferResult = "accepted" | "duplicate" | "late" | "early";

export interface TakenInput {
  keys: InputKeys;
  /** The real frame for this tick, when one arrived in time. */
  frame: InputFrame | undefined;
  /** True when this tick ran on a repeated or neutral input (NR22). */
  repeated: boolean;
}

const SLACK_WINDOW = 30;

/**
 * One player's inputs, keyed by the tick they are for (NR22). The server takes exactly one per tick,
 * so no amount of sending moves a car further than one step per tick (F1). A missing tick repeats
 * the last real input — held keys stay held, and because press detection compares against the
 * previous consumed mask, a repeat can never create a fire press — for `repeatTicks`, then goes
 * neutral so a vanished client's car coasts and stays rammable.
 */
export class TickInputBuffer {
  private readonly frames = new Map<number, InputFrame>();
  private last: InputKeys = NEUTRAL_KEYS;
  private lastRealTick = Number.NEGATIVE_INFINITY;
  private readonly slacks: number[] = [];

  constructor(
    private readonly repeatTicks: number,
    private readonly maxLeadTicks: number,
  ) {}

  offer(frame: InputFrame, lastCompletedTick: number): OfferResult {
    const next = lastCompletedTick + 1;
    if (frame.tick < next) return "late";
    if (frame.tick > next + this.maxLeadTicks) return "early";
    if (this.frames.has(frame.tick)) return "duplicate";
    this.frames.set(frame.tick, frame);
    this.slacks.push(frame.tick - next);
    if (this.slacks.length > SLACK_WINDOW) this.slacks.shift();
    return "accepted";
  }

  take(tick: number): TakenInput {
    const frame = this.frames.get(tick);
    for (const key of this.frames.keys()) if (key <= tick) this.frames.delete(key);
    if (frame) {
      this.last = frame;
      this.lastRealTick = tick;
      return { keys: frame, frame, repeated: false };
    }
    const keys = tick - this.lastRealTick <= this.repeatTicks ? this.last : NEUTRAL_KEYS;
    return { keys, frame: undefined, repeated: true };
  }

  slackMeanTicks(): number {
    if (this.slacks.length === 0) return 0;
    return this.slacks.reduce((s, v) => s + v, 0) / this.slacks.length;
  }

  slackStdTicks(): number {
    if (this.slacks.length === 0) return 0;
    const m = this.slackMeanTicks();
    return Math.sqrt(this.slacks.reduce((s, v) => s + (v - m) ** 2, 0) / this.slacks.length);
  }
}

export function newTickInputBuffer(): TickInputBuffer {
  return new TickInputBuffer(msToTicks(NET_CONFIG.inputRepeatMs), msToTicks(NET_CONFIG.maxInputLeadMs));
}
```

Add the Global Constraints knobs to `NET_CONFIG`, each with a one-line doc comment citing its NR id.

- [ ] **Step 4: Run to see it pass** → `npx vitest run --root packages/shared src/net/tick-input.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(net): tick-stamped input frames and the one-per-tick input buffer (NR22, NR24, NR25)"
```

---

### Task 2 (D2): `ClockSync`, `InputScheduler`, tick-keyed prediction

**Files:**
- Create: `packages/shared/src/net/clock-sync.ts` (+ test), `packages/shared/src/net/input-scheduler.ts` (+ test)
- Modify: `packages/shared/src/net/prediction.ts` (+ test) — add `TickPrediction` beside `PredictionBuffer`; `PredictionBuffer` is deleted in D4
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: D1's `InputFrame`, `InputKeys`.
- Produces:
  ```ts
  export interface TimePong { c: number; t: number; p: number } // client ms echoed, server tick, ms into that tick
  export class ClockSync {
    onPong(nowMs: number, pong: TimePong): void;
    get ready(): boolean;               // at least one sample
    serverTick(nowMs: number): number;  // fractional
    rttMs(): number;                    // median of the window
    jitterMs(): number;                 // (p90 − p10) / 2 of the window's rtts
  }
  export class InputScheduler {
    constructor(clock: ClockSync);
    /** Ticks the client must produce now, ascending (possibly empty). `slackTicks` from the latest snapshot. */
    due(nowMs: number, frameMs: number, slackTicks: number | undefined): number[];
    get leadMs(): number;
  }
  export class TickPrediction {
    predict(state: SimBody, frame: InputFrame, ctx: StepContext): SimBody;
    reconcile(authoritative: SimBody, snapshotTick: number, current: SimBody, ctx: StepContext): SimBody;
    replayTarget(authoritative: SimBody, snapshotTick: number, ctx: StepContext): SimBody;
    frameAt(tick: number): InputFrame | undefined;
    recent(count: number): InputFrame[]; // newest last, for packet redundancy
    clear(): void;
  }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/net/clock-sync.test.ts
import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
import { ClockSync } from "./clock-sync.js";

/** A server whose tick 0 began at client time `origin`, answering after `oneWay` each way. */
function pong(sendAt: number, oneWay: number, origin: number) {
  const serverMs = sendAt + oneWay - origin;
  return { at: sendAt + 2 * oneWay, pong: { c: sendAt, t: Math.floor(serverMs / MS_PER_TICK), p: serverMs % MS_PER_TICK } };
}

describe("ClockSync", () => {
  it("recovers the server tick from symmetric pings", () => {
    const clock = new ClockSync();
    for (let i = 0; i < 10; i++) {
      const { at, pong: p } = pong(1000 + i * 100, 40, 500);
      clock.onPong(at, p);
    }
    expect(clock.rttMs()).toBeCloseTo(80, 5);
    expect(clock.serverTick(3000)).toBeCloseTo((3000 - 500) / MS_PER_TICK, 1);
  });

  it("ignores a late pong through the lowest-RTT filter", () => {
    const clock = new ClockSync();
    for (let i = 0; i < 12; i++) {
      const { at, pong: p } = pong(1000 + i * 100, 40, 500);
      clock.onPong(at, p);
    }
    const late = pong(3000, 40, 500);
    clock.onPong(late.at + 300, late.pong); // arrived 300 ms late
    expect(clock.serverTick(4000)).toBeCloseTo((4000 - 500) / MS_PER_TICK, 1);
  });
});
```

```ts
// packages/shared/src/net/input-scheduler.test.ts
import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "../constants.js";
import { ClockSync } from "./clock-sync.js";
import { InputScheduler } from "./input-scheduler.js";

function syncedClock(oneWay: number): ClockSync {
  const c = new ClockSync();
  for (let i = 0; i < 16; i++) {
    const sendAt = i * 100;
    const serverMs = sendAt + oneWay;
    c.onPong(sendAt + 2 * oneWay, { c: sendAt, t: Math.floor(serverMs / MS_PER_TICK), p: serverMs % MS_PER_TICK });
  }
  return c;
}

describe("InputScheduler", () => {
  it("produces each tick exactly once, ahead of the server by about half an RTT", () => {
    const s = new InputScheduler(syncedClock(40));
    const seen: number[] = [];
    for (let now = 2000; now < 4000; now += 1000 / 60) seen.push(...s.due(now, 1000 / 60, 1.5));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBe(seen[i - 1]! + 1);
    const lastServerTick = (4000 - 1000 / 60) / MS_PER_TICK;
    expect(seen.at(-1)! - lastServerTick).toBeGreaterThan(40 / MS_PER_TICK);
  });

  it("resyncs instead of flooding after a long stall", () => {
    const s = new InputScheduler(syncedClock(40));
    s.due(2000, 1000 / 60, 1.5);
    const burst = s.due(4000, 2000, 1.5); // 2 s stall
    expect(burst.length).toBeLessThanOrEqual(8);
  });

  it("moves its lead by at most maxDilation of elapsed time per call", () => {
    const s = new InputScheduler(syncedClock(40));
    s.due(2000, 1000 / 60, 1.5);
    const before = s.leadMs;
    s.due(2000 + 1000 / 60, 1000 / 60, -10); // slack says 'way too late'
    expect(Math.abs(s.leadMs - before)).toBeLessThanOrEqual(0.04 * (1000 / 60) + 1e-9);
  });
});
```

Add to `prediction.test.ts` a `TickPrediction` block: predict three frames for ticks 11–13 from a pose, then `reconcile(authoritativeAtTick11, 11, current, ctx)` must equal (within 1e-9) the pose obtained by stepping the authoritative pose through frames 12 and 13 when that is within the snap/ease thresholds' ease branch's target (assert against `replayTarget`), and `frameAt(11)` is `undefined` afterwards while `frameAt(12)` is defined.

- [ ] **Step 2: Run to see them fail** → FAIL (modules missing).

- [ ] **Step 3: Implement `ClockSync`**

```ts
// packages/shared/src/net/clock-sync.ts
import { MS_PER_TICK } from "../constants.js";

export interface TimePong {
  /** The client's send time, echoed. */
  c: number;
  /** The server's last completed tick when it answered. */
  t: number;
  /** Milliseconds the server was into the next tick when it answered, in [0, MS_PER_TICK). */
  p: number;
}

const WINDOW = 16;
const SNAP_MS = 50;
const SLEW_MS = 2;

/**
 * The client's estimate of the server's clock (NR18). Each pong gives one offset sample; the estimate
 * is the median offset of the lowest-RTT third of the last 16, so one delayed pong cannot drag it.
 * After the first sample it slews by at most 2 ms per pong, so the tick estimate never jumps —
 * unless it is more than 50 ms off, which only happens on join or after a long stall.
 */
export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];
  private offsetMs = Number.NaN;

  onPong(nowMs: number, pong: TimePong): void {
    const rtt = Math.max(0, nowMs - pong.c);
    const serverMs = pong.t * MS_PER_TICK + pong.p + rtt / 2;
    this.samples.push({ rtt, offset: serverMs - nowMs });
    if (this.samples.length > WINDOW) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.floor(this.samples.length / 3)));
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
    const target = offsets[Math.floor(offsets.length / 2)]!;
    if (Number.isNaN(this.offsetMs) || Math.abs(target - this.offsetMs) > SNAP_MS) this.offsetMs = target;
    else this.offsetMs += Math.max(-SLEW_MS, Math.min(SLEW_MS, target - this.offsetMs));
  }

  get ready(): boolean {
    return !Number.isNaN(this.offsetMs);
  }

  serverTick(nowMs: number): number {
    return (nowMs + this.offsetMs) / MS_PER_TICK;
  }

  rttMs(): number {
    const r = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    return r.length === 0 ? 0 : r[Math.floor(r.length / 2)]!;
  }

  jitterMs(): number {
    const r = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    if (r.length < 2) return 0;
    const at = (q: number) => r[Math.min(r.length - 1, Math.floor(q * (r.length - 1)))]!;
    return (at(0.9) - at(0.1)) / 2;
  }
}
```

- [ ] **Step 4: Implement `InputScheduler`**

```ts
// packages/shared/src/net/input-scheduler.ts
import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import type { ClockSync } from "./clock-sync.js";

const SAFETY_GAIN = 0.1; // ms of safety per tick of slack error, per snapshot

/**
 * Which ticks the client must produce input for, right now (NR20, NR21). The client runs `leadMs`
 * ahead of its estimate of the server clock: half the RTT plus a safety margin steered so the
 * server reports `targetSlackTicks` of slack. The lead moves by at most `maxDilation` of elapsed
 * time per call — the client's tick clock runs up to 4 % fast or slow, and never jumps.
 */
export class InputScheduler {
  private lastTick = -1;
  private lead = Number.NaN;
  private safetyMs = MS_PER_TICK * NET_CONFIG.targetSlackTicks;

  constructor(private readonly clock: ClockSync) {}

  get leadMs(): number {
    return this.lead;
  }

  due(nowMs: number, frameMs: number, slackTicks: number | undefined): number[] {
    if (!this.clock.ready) return [];
    if (slackTicks !== undefined) {
      this.safetyMs += (NET_CONFIG.targetSlackTicks - slackTicks) * SAFETY_GAIN * MS_PER_TICK;
      this.safetyMs = Math.max(0, Math.min(this.safetyMs, NET_CONFIG.maxInputLeadMs));
    }
    const wanted = this.clock.rttMs() / 2 + this.safetyMs;
    if (Number.isNaN(this.lead)) this.lead = wanted;
    const step = NET_CONFIG.maxDilation * frameMs;
    this.lead += Math.max(-step, Math.min(step, wanted - this.lead));

    const target = Math.floor(this.clock.serverTick(nowMs) + this.lead / MS_PER_TICK);
    if (this.lastTick < 0 || target - this.lastTick > NET_CONFIG.maxCatchUpTicks) this.lastTick = target - 1;
    const out: number[] = [];
    for (let t = this.lastTick + 1; t <= target; t++) out.push(t);
    if (target > this.lastTick) this.lastTick = target;
    return out;
  }
}
```

- [ ] **Step 5: Implement `TickPrediction`** in `prediction.ts`, reusing the existing `reconcile` body's snap/ease logic verbatim (factor it into a private `settle(target, current)` shared by both classes):

```ts
export class TickPrediction {
  private frames: InputFrame[] = []; // ascending by tick

  predict(state: SimBody, frame: InputFrame, ctx: StepContext): SimBody {
    this.frames.push(frame);
    return stepSim(state, frame, DT_SECONDS, ctx);
  }

  replayTarget(authoritative: SimBody, snapshotTick: number, ctx: StepContext): SimBody {
    this.frames = this.frames.filter((f) => f.tick > snapshotTick);
    let target = copyBody(authoritative);
    for (const f of this.frames) target = stepSim(target, f, DT_SECONDS, ctx);
    return target;
  }

  reconcile(authoritative: SimBody, snapshotTick: number, current: SimBody, ctx: StepContext): SimBody {
    return settle(this.replayTarget(authoritative, snapshotTick, ctx), current);
  }

  frameAt(tick: number): InputFrame | undefined {
    return this.frames.find((f) => f.tick === tick);
  }

  recent(count: number): InputFrame[] {
    return this.frames.slice(-count);
  }

  clear(): void {
    this.frames = [];
  }
}
```

(`copyBody` is the ten-field copy the existing `reconcile` builds inline — factor it out too.) Cap `frames` at `msToTicks(NET_CONFIG.maxInputLeadMs) + NET_CONFIG.maxCatchUpTicks` entries, dropping the oldest.

- [ ] **Step 6: Run to see them pass, commit**

Run: `npx vitest run --root packages/shared src/net` → PASS.

```bash
git add packages/shared/src
git commit -m "feat(net): clock sync, input scheduler and tick-keyed prediction (NR18, NR20, NR21, NR26)"
```

---

### Task 3 (D3): Time-sync messages on every room (additive)

**Files:**
- Modify: `packages/shared/src/net/tick-input.ts` — add message names: `export const MSG_TIME = "time"; export const MSG_PING = "ping";` plus `isTimeRequest(msg): msg is { c: number }` and `isPingEcho(msg): msg is { s: number }` (finite numbers)
- Create: `packages/server/src/net/net-session.ts` (+ test)
- Modify: `packages/server/src/rooms/{ArenaRoom,PracticeRoom,PlaygroundRoom}.ts` (install handlers; record tick wall times)
- Modify: `packages/client/src/scenes/ArenaScene.ts` (send `MSG_TIME` on the NR18 cadence; feed `ClockSync`); nothing reads it yet

**Interfaces:**
- Produces (server):
  ```ts
  export class NetSessions {
    /** Call at the end of every tick with the tick number and Date.now(). */
    markTick(tick: number, wallMs: number): void;
    /** Reply for MSG_TIME. */
    pong(c: number, wallMs: number): TimePong;
    /** Server-initiated RTT (NR19): what to send, and how to record the echo. */
    pingPayload(wallMs: number): { s: number };
    onPingEcho(sessionId: string, s: number, wallMs: number): void;
    rttMs(sessionId: string): number | undefined; // median of the last 8 echoes
    drop(sessionId: string): void;
  }
  export function installNetHandlers(room: Room, sessions: NetSessions, scope: <T>(fn: () => T) => T): void;
  ```
  `installNetHandlers` registers `MSG_TIME` (reply `client.send(MSG_TIME, sessions.pong(msg.c, Date.now()))`) and `MSG_PING` (record echo), and starts a `room.clock.setInterval` every 1000 ms sending `MSG_PING` with `pingPayload` to each client.

- [ ] **Step 1: Test `NetSessions`**

```ts
// packages/server/src/net/net-session.test.ts
import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "@motor-combat-moba/shared";
import { NetSessions } from "./net-session.js";

describe("NetSessions", () => {
  it("answers with the last completed tick and the ms into the next", () => {
    const s = new NetSessions();
    s.markTick(100, 5000);
    const p = s.pong(42, 5000 + MS_PER_TICK / 2);
    expect(p).toEqual({ c: 42, t: 100, p: MS_PER_TICK / 2 });
  });
  it("clamps p into [0, MS_PER_TICK)", () => {
    const s = new NetSessions();
    s.markTick(1, 0);
    expect(s.pong(0, 10 * MS_PER_TICK).p).toBeLessThan(MS_PER_TICK);
  });
  it("measures RTT from echoed pings", () => {
    const s = new NetSessions();
    const { s: sent } = s.pingPayload(1000);
    s.onPingEcho("a", sent, 1080);
    expect(s.rttMs("a")).toBe(80);
    s.drop("a");
    expect(s.rttMs("a")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement** `net-session.ts` to pass it (`p = Math.min(MS_PER_TICK - 0.001, Math.max(0, wallMs - lastTickWall))`; `pingPayload` returns `{ s: wallMs }`; echoes keep the last 8 RTTs per session). Implement `installNetHandlers` wrapping handler bodies in `scope` (each room passes its own `scoped(this.modeConfig, …)`).

- [ ] **Step 3: Wire the rooms** — construct one `NetSessions` per room; call `installNetHandlers` in `onCreate`; call `sessions.markTick(this.state.tick, Date.now())` at the end of `tick()`; `sessions.drop(sessionId)` on leave.

- [ ] **Step 4: Wire the client** — in `ArenaScene`, own a `ClockSync`; on join and every `timeSyncBurstMs` for `timeSyncBurstWindowMs`, then every `timeSyncIntervalMs`, `room.send(MSG_TIME, { c: performance.now() })`; `room.onMessage(MSG_TIME, (p) => this.clock.onPong(performance.now(), p))`; `room.onMessage(MSG_PING, (m) => room.send(MSG_PING, m))`. Nothing else reads the clock yet.

- [ ] **Step 5: Tests, build, commit**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL" && npm run build`

```bash
git add packages
git commit -m "feat(net): time sync and server-measured RTT on every room (NR18, NR19)"
```

---

### Task 4 (D4): The switch — one input per tick, everywhere

This is the atomic wire change: server, every in-process input producer, and the client move together so `development/main` is never unplayable.

**Files:**
- Modify: `packages/server/src/sim/tick.ts` (`serverTick`), `packages/server/src/rooms/tick-pipeline.ts` (`PipelineCtx.inputBuffers` replaces `inputQueues` and `silentTicks`)
- Modify: `packages/server/src/rooms/{ArenaRoom,PracticeRoom,PlaygroundRoom}.ts` (INPUT handler, buffers per player, bot offers)
- Modify: `packages/server/balance/match.ts`, `packages/server/playtest/modes/shared.ts`, `packages/server/playtest/common/*.ts` that push inputs, `packages/server/src/netsim/server-world.ts`
- Modify: `packages/shared/src/schema/PlayerState.ts` (delete `lastProcessedInputSeq`; add `@type("boolean") ackRepeated = false;` and `@type("float32") inputSlack = 0;`)
- Modify: `packages/shared/src/net/input.ts` (delete `InputMessage`; re-export `InputKeys`/`InputFrame` from `tick-input.ts`), `packages/server/src/net/input-message.ts` (delete; `isInputPacket` replaces it), every `InputMessage` reader (`stepSim`'s parameter becomes `InputKeys`)
- Modify: `packages/shared/src/config/net-config.ts` (delete `maxInputsPerTick`, `silentCoastGraceMs`, `pendingInputCap`)
- Modify: `packages/shared/src/net/prediction.ts` (delete `PredictionBuffer`), `packages/client/src/scenes/ArenaScene.ts` (`pumpInput`, `sendInputTick`, `reconcileLocal`, `syncDrivenCar`), `packages/client/src/scenes/arena-input.ts` (delete `drainTicks`)
- Modify: `packages/server/src/sim/tick.test.ts`, `pipeline-order.test.ts`, `tick-pipeline.test.ts`, room tests
- Create: `packages/server/src/netsim/tick-client.ts`; modify `run.ts` (`ClientModel = "tick"`; delete `legacy-client.ts` and the legacy model)

**Interfaces:**
- Consumes: D1 `TickInputBuffer`/`newTickInputBuffer`/`isInputPacket`; D2 `ClockSync`/`InputScheduler`/`TickPrediction`; D3 `NetSessions`.
- Produces: `PipelineCtx.inputBuffers: Map<string, TickInputBuffer>`; `serverTick(state, buffers, dt, phase, statusMods, prevFireMasks): TickResult`.

- [ ] **Step 1: Rewrite `serverTick`'s tests first**

In `tick.test.ts`, replace the queue-based cases with these (keep every case about gates, sorting, fire masking, aim and approach velocity, re-expressed with buffers):

```ts
function buffers(entries: Record<string, InputFrame[]>, lastCompletedTick: number) {
  const map = new Map<string, TickInputBuffer>();
  for (const [id, frames] of Object.entries(entries)) {
    const b = newTickInputBuffer();
    for (const f of frames) b.offer(f, lastCompletedTick);
    map.set(id, b);
  }
  return map;
}

it("steps every car exactly once per tick, however many frames arrived (F1)", () => {
  // state.tick is the tick being simulated; frames for it and five future ticks are buffered
  const frames = [1, 2, 3, 4, 5, 6].map((t) => ({ tick: t, steer: 0 as const, throttle: 1 as const, fireSlots: 0 }));
  const oneStep = /* step a copy of the car once with frame 1 through stepSim */;
  state.tick = 1;
  serverTick(state, buffers({ a: frames }, 0), DT, RoomPhase.MATCH, NO_MODS, new Map());
  expect(state.players.get("a")!.x).toBeCloseTo(oneStep.x, 9);
});

it("a car with no input for the tick still steps, on the repeated input, and says so", () => {
  state.tick = 1;
  const b = buffers({ a: [] }, 0);
  serverTick(state, b, DT, RoomPhase.MATCH, NO_MODS, new Map());
  expect(state.players.get("a")!.ackRepeated).toBe(true);
});

it("a held fire key across a repeated tick fires once", () => {
  const prev = new Map<string, number>();
  state.tick = 1;
  const b = buffers({ a: [{ tick: 1, steer: 0, throttle: 0, fireSlots: 2 }] }, 0);
  const r1 = serverTick(state, b, DT, RoomPhase.MATCH, NO_MODS, prev);
  state.tick = 2;
  const r2 = serverTick(state, b, DT, RoomPhase.MATCH, NO_MODS, prev); // tick 2 missing → repeat
  expect(r1.masks.get("a")).toBe(2);
  expect(r2.masks.get("a")).toBeUndefined();
});
```

(Fill `oneStep` with the same `stepSim(bodyOf(car), frame, DT, ctx)` call the existing tests already use to compute an expected pose.)

- [ ] **Step 2: Rewrite `serverTick`**

Replace the per-player drain with:

```ts
  for (const { sessionId, player } of entries) {
    approachVelocities.set(sessionId, { vx: player.vx, vy: player.vy });
    const ctx: StepContext | null = /* unchanged */;
    const taken = buffers.get(sessionId)?.take(state.tick);
    if (!taken) continue;
    player.ackRepeated = taken.repeated;
    player.inputSlack = buffers.get(sessionId)!.slackMeanTicks();
    if (ctx === null) continue;
    writeBody(player, stepSim(bodyOf(player), taken.keys, dt, ctx));
    const raw = taken.keys.fireSlots;
    const clean = Number.isInteger(raw) && raw > 0 ? raw & slotMask : 0;
    const prev = prevFireMasks.get(sessionId) ?? 0;
    const pressed = clean & ~prev;
    prevFireMasks.set(sessionId, clean);
    if (pressed !== 0) {
      masks.set(sessionId, pressed);
      if (taken.keys.aimAngle !== undefined) aims.set(sessionId, wrapAngle(taken.keys.aimAngle));
    }
  }
```

Delete `silenceGraceTicks`, `hasMotionToResolve`, `COAST_INPUT`, `bySeq`, the `silentTicks` parameter, and rewrite the function's doc comment to NR17/NR22 (keep the gate, sorting and fire-mask paragraphs that still hold).

- [ ] **Step 3: Pipeline and rooms**

`PipelineCtx`: `inputBuffers: Map<string, TickInputBuffer>`; drop `inputQueues`, `silentTicks`. Each room: `private readonly inputBuffers = new Map<string, TickInputBuffer>()`; on join `set(sessionId, newTickInputBuffer())`; on leave delete. INPUT handler:

```ts
this.onMessage(INPUT_MESSAGE, (client, msg: unknown) =>
  scoped(this.modeConfig, () => {
    if (!isInputPacket(msg)) return;
    const buffer = this.inputBuffers.get(client.sessionId);
    if (!buffer) return;
    for (const frame of msg.inputs) buffer.offer(frame, this.state.tick);
  }),
);
```

(keep `withSimulatedLatency` wrapping the offer loop, as today.) Practice's presence stamp reads the newest frame of the packet. Bots (practice, playground, balance, playtest `World.input`, netsim `ServerWorld`) offer `{ tick: state.tick + 1, ...keys }` against `state.tick` **before** the tick that consumes it — i.e. exactly where they push today.

- [ ] **Step 4: Client**

`ArenaScene`:
- fields: `clock: ClockSync` (from D3), `scheduler = new InputScheduler(this.clock)`, `prediction = new TickPrediction()`, `lastSnapshotSlack: number | undefined`.
- `pumpInput(room, delta)`: after the existing gates, `for (const tick of this.scheduler.due(performance.now(), delta, this.lastSnapshotSlack)) this.sendInputTick(room, tick);`.
- `sendInputTick(room, tick)`: build `InputFrame { tick, ...keys, aimAngle }` exactly as `readInput` builds keys today; `this.predicted = this.prediction.predict(from, frame, ctx)`; send `room.send(INPUT_MESSAGE, { inputs: this.prediction.recent(1 + NET_CONFIG.inputRedundancy) })`.
- `reconcileLocal(room)`: `this.lastSnapshotSlack = local.inputSlack;` then `this.prediction.reconcile(authoritative, room.state.tick, this.predicted, ctx)`.
- `syncDrivenCar`: `this.prediction.clear()` instead of a new buffer. Delete `inputSeq`.
- `localRenderPose`'s blend alpha: use the fractional part of `clock.serverTick(now) + scheduler.leadMs / MS_PER_TICK` instead of `inputAccumulatorMs / MS_PER_TICK`; delete `inputAccumulatorMs`.

Delete `drainTicks` and its test.

- [ ] **Step 5: netsim `tick` model**

`tick-client.ts`: a headless client mirroring Step 4 — `ClockSync` fed by `MSG_TIME` pongs through the links every `timeSyncIntervalMs` (burst on start), `InputScheduler`, `TickPrediction`, and for remotes the existing `InterpolationBuffer` keyed by arrival (Phase E replaces it). `run.ts`: model `"tick"`; the server side offers packets into buffers (through `ServerWorld.receiveInput`), answers pongs with `NetSessions`, and records `repeatedInputRate` from `ackRepeated`. Delete the legacy model and file. The determinism and finiteness tests run on `"tick"`.

Switch `ServerWorld`'s step counting to the REAL count: `lastTickMaxSteps` comes from the number of `stepSim` calls `serverTick` actually made per car this tick (returned by `serverTick`/`runPipeline`, or counted by a spy), and `recordIntake`'s re-implementation of the drain rule is deleted. `appliedAt` likewise records the tick an input was actually consumed.

Don't write a third copy of the client's input clock or replay. `legacy-client.ts` (~line 135) re-implements `drainTicks` (`packages/client/src/scenes/arena-input.ts`) and the replay loop of `PredictionBuffer.reconcile` (`replayTarget`). The tick client reuses shared code instead: the `InputScheduler` itself, and a read-only accessor on `TickPrediction` (its pending tail, or an exported `replayTarget`) so the harness can read the correction before the ease without re-implementing it.

- [ ] **Step 6: Everything green**

Run: `npm run build -w @motor-combat-moba/shared && npm test 2>&1 | grep -E "Test Files|Tests |FAIL" && npm run build`
Then the live smoke from A2 Step 6.
Expected: only the known failures; `playtest:lan` passes.

- [ ] **Step 7: Commit**

```bash
git add -A packages docs
git commit -m "feat(net): one input per car per tick, clock-synced client lead (NR17-NR28)"
```

---

### Task 5 (D5): Hardening — rate limits, payload cap, protocol version, two-way latency

**Files:**
- Create: `packages/server/src/net/rate-limit.ts` (+ test)
- Modify: `packages/server/src/index.ts` (`new WebSocketTransport({ server: httpServer, maxPayload: 4096 })`)
- Modify: `packages/shared/src/constants.ts` (`export const PROTOCOL_VERSION = 1;` — bumped by every later wire change in this plan)
- Modify: the three rooms (`onAuth`/`onJoin` refuse `options.protocol !== PROTOCOL_VERSION` with `"Client and server are different versions (client protocol X, server Y). Refresh the page."`), `packages/client/src/net/connection.ts` (send `protocol: PROTOCOL_VERSION` in every join)
- Modify: `packages/server/src/net/latency-injector.ts`, `packages/server/src/mode.ts` (`SIM_LOSS_PCT`; outgoing delay per client)

**Interfaces:**
- Produces: `class TokenBucket { constructor(ratePerSec: number, burst: number); take(nowMs: number): boolean }` and `class ClientLimits { allow(sessionId: string, kind: "input" | "time" | "lobby", nowMs: number): boolean; overLimitFor(sessionId: string, nowMs: number): number /* ms continuously over */; drop(sessionId: string): void }` with the NR54 budgets.

- [ ] **Step 1: Test the bucket and the limits**

```ts
// packages/server/src/net/rate-limit.test.ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { ClientLimits, TokenBucket } from "./rate-limit.js";

describe("TokenBucket", () => {
  it("allows the burst, then the rate", () => {
    const b = new TokenBucket(10, 3);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(100)).toBe(true); // 0.1 s refills one token at 10/s
    expect(b.take(100)).toBe(false);
  });
});

describe("ClientLimits (NR54)", () => {
  it("lets an honest client's input rate through", () => {
    const l = new ClientLimits();
    let ok = 0;
    for (let i = 0; i < TICK_RATE_HZ * 5; i++) if (l.allow("a", "input", (i * 1000) / TICK_RATE_HZ)) ok++;
    expect(ok).toBe(TICK_RATE_HZ * 5);
  });
  it("drops a flood and reports how long it has been over", () => {
    const l = new ClientLimits();
    let dropped = 0;
    for (let i = 0; i < 1000; i++) if (!l.allow("a", "input", i)) dropped++;
    expect(dropped).toBeGreaterThan(800);
    expect(l.overLimitFor("a", 999)).toBeGreaterThan(900);
  });
});
```

- [ ] **Step 2: Implement** (`input`: `2 * TICK_RATE_HZ`/s burst 30; `time`: 20/s burst 20; `lobby`: 10/s burst 10; `overLimitFor` = now − the start of the current unbroken run of refusals, 0 if the last call was allowed).

- [ ] **Step 3: Apply in rooms** — every `onMessage` handler begins with `if (!this.limits.allow(client.sessionId, kind, Date.now())) { if (this.limits.overLimitFor(client.sessionId, Date.now()) > 5000) client.leave(4002); return; }` (`kind` = `"input"` for `INPUT_MESSAGE`, `"time"` for `MSG_TIME`/`MSG_PING`, else `"lobby"`).

- [ ] **Step 4: Protocol version** — room test: a join with `protocol: PROTOCOL_VERSION - 1` rejects with the message above; the client surfaces it through the existing join-error path.

- [ ] **Step 5: Two-way latency** — extend `LatencyConfig` with `lossPct`; add `delayOutgoing(client, send: () => void)` used by `NetSessions` replies and by the room's broadcast (wrap `broadcastPatch` per client only when latency is configured: when `SIM_LATENCY_MS` is set, rooms send snapshots per client through `setTimeout` in order, modelling loss as an extra `2 × latency` on that message and everything after it, like `Link`). Document in `docs/networking.md`.

- [ ] **Step 6: Tests, build, commit**

```bash
git add -A packages docs/networking.md
git commit -m "feat(net): rate limits, payload cap, protocol version, two-way latency injection (NR54-NR56)"
```

---

### Task 6 (D6): Measure and document

**Files:**
- Modify: `docs/networking.md` (rewrite "Client — movement" and "Server" for NR17–NR28), `docs/config-reference.md` (`NET_CONFIG` table), `docs/schema-reference.md` (`ackRepeated`, `inputSlack`; `lastProcessedInputSeq` gone), `EXECUTION.md`

- [ ] **Step 1:** `npm run build -w @motor-combat-moba/shared && NETSIM_BASELINE=1 NETSIM_REPORT=1 npx vitest run --root packages/server src/netsim` and fill EXECUTION.md's "after D" column from the mean over seeds 1–3 (the baseline's shape). `stepsPerTickMax` must read 1 and `repeatedInputRate` on net80 ≤ 2 %; if not, record it as a deviation and tune `targetSlackTicks`/`SAFETY_GAIN` before closing the phase.
- [ ] **Step 2:** Rewrite the docs sections named above.
- [ ] **Step 3:** Phase row `Landed`; in-flight → Phase E. Summary says loudly: **the input path the playtest probes drive changed (one input per tick); recommend `npm run playtest -- --scope=all`.**
- [ ] **Step 4: Commit**

```bash
git add docs packages/server/src/netsim
git commit -m "docs(net): tick-stamped inputs and clock sync; phase D numbers"
```
