import { describe, expect, it, vi, afterEach } from "vitest";
import {
  DelayLine,
  InputDelay,
  OutgoingDelay,
  latencyActive,
  type LatencyConfig,
} from "./latency-injector.js";

const OFF: LatencyConfig = { latencyMs: 0, jitterMs: 0, lossPct: 0 };

describe("InputDelay (NR56: client -> server)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers straight through, synchronously, when latencyMs and jitterMs are 0", () => {
    const deliver = vi.fn();
    new InputDelay(deliver, OFF).offer("a");
    // Loss alone, with no latency to retransmit over, is still off.
    new InputDelay(deliver, { ...OFF, lossPct: 50 }).offer("b");
    expect(deliver.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("delays delivery by latencyMs when jitter is 0", () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const delay = new InputDelay(deliver, { latencyMs: 20, jitterMs: 0, lossPct: 0 });

    delay.offer("hello");
    expect(deliver).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith("hello");
  });

  it("keeps each key's messages in order under jitter, like one WebSocket per client", () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const delay = new InputDelay<{ k: string; n: number }>(
      (m) => got.push(`${m.k}${m.n}`),
      { latencyMs: 30, jitterMs: 25, lossPct: 0 },
      (m) => m.k,
    );
    for (let n = 0; n < 50; n++) {
      delay.offer({ k: "a", n });
      delay.offer({ k: "b", n });
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(1000);
    const a = got.filter((s) => s.startsWith("a")).map((s) => Number(s.slice(1)));
    const b = got.filter((s) => s.startsWith("b")).map((s) => Number(s.slice(1)));
    expect(a).toEqual([...a].sort((x, y) => x - y));
    expect(b).toEqual([...b].sort((x, y) => x - y));
    expect(a.length).toBe(50);
  });
});

describe("DelayLine (NR56)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("models a lost message as a retransmit one RTT later, holding everything behind it", () => {
    vi.useFakeTimers();
    const draws = [0.99, 0.0, 0.99]; // loss draw per message: first kept, second lost, third kept
    const line = new DelayLine({ latencyMs: 40, jitterMs: 0, lossPct: 10 }, () => draws.shift() ?? 0.99);
    const at: Record<string, number> = {};
    const t0 = Date.now();
    line.schedule(() => (at.a = Date.now() - t0));
    line.schedule(() => (at.b = Date.now() - t0));
    line.schedule(() => (at.c = Date.now() - t0));
    vi.advanceTimersByTime(500);
    expect(at.a).toBe(40);
    expect(at.b).toBe(40 + 2 * 40);
    expect(at.c).toBe(40 + 2 * 40); // in order: it waits for the retransmit
  });
});

describe("OutgoingDelay (NR56: server -> client)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function rawClient(sessionId: string) {
    const sent: { bytes: number[]; at: number }[] = [];
    const client = {
      sessionId,
      raw(data: Uint8Array | Buffer, _options?: unknown, _cb?: (err?: Error) => void) {
        sent.push({ bytes: [...data], at: Date.now() });
      },
    };
    return { client, sent };
  }

  it("is inactive, and leaves the client untouched, when no latency is configured", () => {
    const { client } = rawClient("a");
    const before = client.raw;
    const out = new OutgoingDelay(OFF);
    expect(out.active).toBe(false);
    out.wrapClient(client);
    expect(client.raw).toBe(before);
  });

  it("delays every frame to a client, in order, and copies the bytes it was handed", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    const { client, sent } = rawClient("a");
    const out = new OutgoingDelay({ latencyMs: 25, jitterMs: 0, lossPct: 0 });
    out.wrapClient(client);
    const shared = new Uint8Array([1, 2, 3]);
    client.raw(shared);
    shared[0] = 9; // Colyseus reuses its encode buffer for the next patch
    client.raw(shared);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(25);
    expect(sent.map((s) => s.bytes)).toEqual([
      [1, 2, 3],
      [9, 2, 3],
    ]);
    expect(sent.every((s) => s.at - t0 === 25)).toBe(true);
  });

  it("gives each client its own line, so one client's loss does not hold another's frames", () => {
    vi.useFakeTimers();
    const draws = [0.0, 0.99]; // a's frame lost, b's kept
    const out = new OutgoingDelay({ latencyMs: 30, jitterMs: 0, lossPct: 50 }, () => draws.shift() ?? 0.99);
    const a = rawClient("a");
    const b = rawClient("b");
    out.wrapClient(a.client);
    out.wrapClient(b.client);
    a.client.raw(new Uint8Array([1]));
    b.client.raw(new Uint8Array([2]));
    vi.advanceTimersByTime(30);
    expect(a.sent.length).toBe(0);
    expect(b.sent.length).toBe(1);
    vi.advanceTimersByTime(60);
    expect(a.sent.length).toBe(1);
  });

  it("delayOutgoing runs an arbitrary send on the client's line", () => {
    vi.useFakeTimers();
    const out = new OutgoingDelay({ latencyMs: 10, jitterMs: 0, lossPct: 0 });
    const fn = vi.fn();
    out.delayOutgoing({ sessionId: "a" }, fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("latencyActive", () => {
  it("is on only when there is a delay to apply", () => {
    expect(latencyActive(OFF)).toBe(false);
    expect(latencyActive({ ...OFF, lossPct: 5 })).toBe(false);
    expect(latencyActive({ ...OFF, latencyMs: 1 })).toBe(true);
    expect(latencyActive({ ...OFF, jitterMs: 1 })).toBe(true);
  });
});

describe("DelayLine ordering on REAL timers (fix round I1)", () => {
  /**
   * Node arms each timer from its cached loop time, so two timers armed in different loop iterations
   * with the same absolute due time can fire inverted. A line must deliver in send order regardless.
   */
  it("delivers several hundred jittered, lossy messages in send order", async () => {
    const line = new DelayLine({ latencyMs: 5, jitterMs: 4, lossPct: 5 });
    const got: number[] = [];
    const N = 600;
    for (let n = 0; n < N; n++) {
      line.schedule(() => got.push(n));
      // Spread the sends over many loop iterations, sometimes several per iteration.
      if (n % 3 === 0) await new Promise((r) => setImmediate(r));
    }
    const deadline = Date.now() + 5000;
    while (got.length < N && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    expect(got.length).toBe(N);
    let inversions = 0;
    for (let i = 1; i < got.length; i++) if (got[i]! < got[i - 1]!) inversions++;
    expect(inversions).toBe(0);
  });

  it("OutgoingDelay keeps a client's frames in order on real timers too", async () => {
    const out = new OutgoingDelay({ latencyMs: 5, jitterMs: 4, lossPct: 5 });
    const got: number[] = [];
    const client = {
      sessionId: "a",
      raw(data: Uint8Array | Buffer) {
        got.push(data[0]! + 256 * data[1]!);
      },
    };
    out.wrapClient(client);
    const N = 400;
    for (let n = 0; n < N; n++) {
      client.raw(new Uint8Array([n % 256, Math.floor(n / 256)]));
      if (n % 2 === 0) await new Promise((r) => setImmediate(r));
    }
    const deadline = Date.now() + 5000;
    while (got.length < N && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    expect(got).toEqual(Array.from({ length: N }, (_, i) => i));
  });
});

describe("InputDelay.drop (a client left)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("forgets the session's line and discards what was still queued on it", () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const d = new InputDelay<{ k: string }>((m) => got.push(m.k), { latencyMs: 20, jitterMs: 0, lossPct: 0 }, (m) => m.k);
    d.offer({ k: "a" });
    d.offer({ k: "b" });
    d.drop("a");
    vi.advanceTimersByTime(50);
    expect(got).toEqual(["b"]);
  });
});
