import { describe, expect, it } from "vitest";
import {
  InputScheduler,
  MS_PER_TICK,
  newTickInputBuffer,
  type InputFrame,
  type TimePong,
} from "@motor-combat-moba/shared";
import { InputClock, axisOf, localBlendAlpha, type DueTicks } from "./arena-input.js";

function spyScheduler(): DueTicks & { slacks: Array<number | undefined> } {
  const slacks: Array<number | undefined> = [];
  return {
    slacks,
    due(_now, _frame, slack) {
      slacks.push(slack);
      return [];
    },
  };
}

describe("InputClock (NR21 slack, once per snapshot)", () => {
  it("passes a snapshot's slack to the scheduler once, then undefined on every other frame", () => {
    const spy = spyScheduler();
    const clock = new InputClock(0, () => spy);
    clock.due(0, 7);
    clock.onSnapshot(2.5);
    clock.due(7, 7);
    clock.due(14, 7);
    clock.due(21, 7);
    clock.onSnapshot(1.25);
    clock.due(28, 7);
    clock.due(35, 7);
    expect(spy.slacks).toEqual([undefined, 2.5, undefined, undefined, 1.25, undefined]);
  });

  it("keeps only the newest of several snapshots between two frames", () => {
    const spy = spyScheduler();
    const clock = new InputClock(0, () => spy);
    clock.onSnapshot(3);
    clock.onSnapshot(1);
    clock.due(0, 16);
    clock.due(16, 16);
    expect(spy.slacks).toEqual([1, undefined]);
  });

  it("drops a pending sample on a frame that does not send, rather than holding it", () => {
    const spy = spyScheduler();
    const clock = new InputClock(0, () => spy);
    clock.onSnapshot(4);
    clock.discard();
    clock.due(0, 16);
    expect(spy.slacks).toEqual([undefined]);
  });
});

describe("localBlendAlpha (the local car's render blend)", () => {
  it("is the server clock's own fraction through the tick, and 1 before the clock is ready", () => {
    expect(localBlendAlpha(undefined)).toBe(1);
    expect(localBlendAlpha(Number.NaN)).toBe(1);
    expect(localBlendAlpha(41.25)).toBeCloseTo(0.25, 12);
  });

  it("draws a steadily driving car monotonically at 144 Hz with a fractional lead", () => {
    // A perfectly synced clock at 20 ms RTT: lead = 10 ms + the default safety, a fractional number
    // of ticks. The car advances exactly 1 u per predicted tick; the drawn position must never step
    // backwards between frames.
    const ONE_WAY = 10;
    let scheduler: InputScheduler | undefined;
    const input = new InputClock(0, (clock) => (scheduler = new InputScheduler(clock)));
    const pongAt = (now: number): TimePong => {
      const server = now - ONE_WAY; // the server's clock is the harness clock
      const t = Math.floor(server / MS_PER_TICK);
      return { c: now - 2 * ONE_WAY, t, p: server - t * MS_PER_TICK };
    };
    for (let now = 20; now <= 1000; now += 20) input.onPong(now, pongAt(now));

    const frameMs = 1000 / 144;
    let prev: number | undefined;
    let predicted: number | undefined;
    let drawnBefore = -Infinity;
    let oldFormulaWentBack = false;
    let oldBefore = -Infinity;
    for (let now = 1000; now < 3000; now += frameMs) {
      for (const tick of input.due(now, frameMs)) {
        prev = predicted;
        predicted = tick; // 1 u per tick
      }
      if (prev === undefined || predicted === undefined) continue;
      const drawn = prev + (predicted - prev) * input.blendAlpha(now);
      expect(drawn).toBeGreaterThanOrEqual(drawnBefore - 1e-9);
      drawnBefore = drawn;
      // Precondition: the lead really is fractional, and the pre-fix blend (serverTick + lead)
      // would have drawn the car stepping backwards on this same schedule.
      const lead = scheduler!.leadMs / MS_PER_TICK;
      const st = input.clock.serverTick(now) + lead;
      const old = prev + (predicted - prev) * (st - Math.floor(st));
      if (old < oldBefore - 1e-9) oldFormulaWentBack = true;
      oldBefore = old;
    }
    expect(scheduler!.leadMs / MS_PER_TICK % 1).not.toBeCloseTo(0, 2);
    expect(oldFormulaWentBack).toBe(true);
  });
});

/**
 * A practice or playground pause, end to end on the real shared modules: a `ClockSync` and an
 * `InputScheduler` (inside `InputClock`) on the client, a `TickInputBuffer` on the server, 10 ms each
 * way. While paused the server's tick stands still but it keeps answering `MSG_TIME` with that frozen
 * tick, exactly as the rooms do (`NetSessions.pong` off a `markTick` that keeps being called).
 * Returns how many ticks after the resume the server ran on a repeated or neutral input.
 */
function repeatsAfterPause(pauseMs: number, tellClockAboutPause: boolean): { before: number; after: number } {
  const ONE_WAY = 10;
  const FRAME_MS = 1000 / 60;
  const PAUSE_AT = 5000;
  const RESUME_AT = PAUSE_AT + pauseMs;
  const END = RESUME_AT + 5000;
  type Up = { at: number; kind: "time"; c: number } | { at: number; kind: "input"; frames: InputFrame[] };
  type Down = { at: number; kind: "pong"; pong: TimePong } | { at: number; kind: "snap"; paused: boolean; slack: number };
  const up: Up[] = [];
  const down: Down[] = [];
  const buffer = newTickInputBuffer();
  const input = new InputClock(0);
  let tick = 0;
  let lastDue = 0;
  let nextTickAt = MS_PER_TICK;
  let clientPaused = false;
  let nextFrameAt = 0;
  const sent: InputFrame[] = [];
  let before = 0;
  let after = 0;

  for (let now = 0; now <= END; now++) {
    const serverPaused = now >= PAUSE_AT && now < RESUME_AT;
    while (now >= nextTickAt) {
      if (!serverPaused) {
        tick += 1;
        const taken = buffer.take(tick);
        if (taken.repeated && nextTickAt >= RESUME_AT) after++;
        if (taken.repeated && nextTickAt >= 2000 && nextTickAt < PAUSE_AT) before++;
      }
      lastDue = nextTickAt;
      down.push({ at: now + ONE_WAY, kind: "snap", paused: serverPaused, slack: buffer.slackMeanTicks() });
      nextTickAt += MS_PER_TICK;
    }
    while (up.length > 0 && up[0]!.at <= now) {
      const m = up.shift()!;
      if (m.kind === "time") {
        const p = Math.min(MS_PER_TICK - 0.001, Math.max(0, now - lastDue));
        down.push({ at: now + ONE_WAY, kind: "pong", pong: { c: m.c, t: tick, p } });
      } else {
        for (const f of m.frames) buffer.offer(f, tick);
      }
    }
    while (down.length > 0 && down[0]!.at <= now) {
      const m = down.shift()!;
      if (m.kind === "pong") input.onPong(now, m.pong);
      else {
        clientPaused = m.paused;
        input.onSnapshot(m.slack);
      }
    }
    const request = input.timeRequest(now);
    if (request) up.push({ at: now + ONE_WAY, kind: "time", c: request.c });
    if (now >= nextFrameAt) {
      nextFrameAt += FRAME_MS;
      if (tellClockAboutPause) input.setPaused(clientPaused, now);
      if (clientPaused) {
        input.discard();
        continue;
      }
      for (const t of input.due(now, FRAME_MS)) {
        sent.push({ tick: t, steer: 0, throttle: 1, fireSlots: 0 });
        up.push({ at: now + ONE_WAY, kind: "input", frames: sent.slice(-4) });
      }
    }
  }
  return { before, after };
}

describe("InputClock across a practice/playground pause (20 ms RTT)", () => {
  for (const pauseMs of [1000, 30_000]) {
    it(`resumes driving within 15 repeated ticks after a ${pauseMs / 1000} s pause`, () => {
      const { before, after } = repeatsAfterPause(pauseMs, true);
      expect(before).toBe(0);
      expect(after).toBeLessThanOrEqual(15);
    });
  }

  it("needs the resume edge: without it the car sits on repeats long after a 1 s pause", () => {
    expect(repeatsAfterPause(1000, false).after).toBeGreaterThan(15);
  });
});

describe("axisOf", () => {
  it("maps a single held key to its direction", () => {
    expect(axisOf(false, true)).toBe(1);
    expect(axisOf(true, false)).toBe(-1);
  });

  it("is neutral when neither or both keys are held", () => {
    expect(axisOf(false, false)).toBe(0);
    // Both down is deliberately 0, not last-key-wins.
    expect(axisOf(true, true)).toBe(0);
  });
});
