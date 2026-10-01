import { afterEach, describe, expect, it, vi } from "vitest";
import type { Room } from "@colyseus/core";
import { MSG_PING, MSG_TIME, MS_PER_TICK, type TimePong } from "@motor-combat-moba/shared";
import { FixedStepper } from "../rooms/fixed-step.js";
import { NetSessions, installNetHandlers, netNowMs } from "./net-session.js";
import { readFileSync } from "node:fs";
import { ClientLimits } from "./rate-limit.js";

describe("NetSessions", () => {
  it("answers with the last completed tick and the ms into the next", () => {
    const s = new NetSessions();
    s.markTick(100, 5000);
    const p = s.pong(42, 5000 + MS_PER_TICK / 2);
    expect(p.c).toBe(42);
    expect(p.t).toBe(100);
    expect(p.p).toBeCloseTo(MS_PER_TICK / 2, 9);
  });
  it("floors p at 0 but does not cap it at one tick (review M1): t*MS_PER_TICK + p stays the server time", () => {
    const s = new NetSessions();
    s.markTick(1, 0);
    expect(s.pong(0, 1.5 * MS_PER_TICK).p).toBeCloseTo(1.5 * MS_PER_TICK, 9);
    expect(s.pong(0, -50).p).toBe(0);
  });
  it("is unbiased against the room's real cadence: 16 ms callbacks on a 16.67 ms grid (review M1)", () => {
    // The room's interval fires every 16 ms (Node truncation) and the stepper marks the last completed
    // tick's due time. A pong asked at any moment between callbacks must read the server time on the
    // grid: t * MS_PER_TICK + p == wall time (tick 0 due at wall 0). The old clamp read ~2.5 ms early.
    const s = new NetSessions();
    const stepper = new FixedStepper(MS_PER_TICK, 4);
    const callbackMs = 16;
    let tick = 0;
    let wall = 0;
    s.markTick(0, 0);
    let sum = 0;
    let n = 0;
    let worst = 0;
    for (let cb = 0; cb < 600; cb++) {
      for (let q = 0.25; q < callbackMs; q += 0.5) {
        const at = wall + q;
        const pong = s.pong(0, at);
        const err = pong.t * MS_PER_TICK + pong.p - at;
        sum += err;
        n += 1;
        worst = Math.max(worst, Math.abs(err));
      }
      wall += callbackMs;
      stepper.advance(callbackMs, () => (tick += 1));
      s.markTick(tick, wall - stepper.remainderMs);
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
    expect(worst).toBeLessThan(1e-6);
  });
  it("describes the tick grid: a due time earlier than the callback moves p, not t", () => {
    const s = new NetSessions();
    // The callback ran at 1010 but the tick was due at 1000.
    s.markTick(7, 1000);
    expect(s.pong(1, 1010)).toEqual({ c: 1, t: 7, p: 10 });
  });
  it("measures RTT from echoed pings", () => {
    const s = new NetSessions();
    const { s: sent } = s.pingPayload("a", 1000);
    s.onPingEcho("a", sent, 1080);
    expect(s.rttMs("a")).toBe(80);
    s.drop("a");
    expect(s.rttMs("a")).toBeUndefined();
  });
  it("reports the median of the last 8 echoes", () => {
    const s = new NetSessions();
    let t = 0;
    const echo = (rtt: number): void => {
      t += 1000;
      s.onPingEcho("a", s.pingPayload("a", t).s, t + rtt);
    };
    for (let i = 0; i < 8; i++) echo(100);
    for (let i = 0; i < 5; i++) echo(20);
    // last 8: three 100s and five 20s
    expect(s.rttMs("a")).toBe(20);
  });
  it("ignores an echo from the future or a non-finite one", () => {
    const s = new NetSessions();
    s.pingPayload("a", 2000);
    s.onPingEcho("a", 2000, 1000);
    s.onPingEcho("a", Number.NaN, 1000);
    expect(s.rttMs("a")).toBeUndefined();
  });

  describe("echo validation (D5 ruling C: server RTT will cap shot compensation)", () => {
    it("refuses a stamp the server never sent — a forged high RTT", () => {
      const s = new NetSessions();
      s.pingPayload("a", 5000);
      s.onPingEcho("a", 1000, 5080); // claims 4080 ms
      expect(s.rttMs("a")).toBeUndefined();
      s.onPingEcho("a", 5000, 5080);
      expect(s.rttMs("a")).toBe(80);
    });

    it("accepts each stamp at most once — a replayed echo cannot stack samples", () => {
      const s = new NetSessions();
      s.onPingEcho("a", s.pingPayload("a", 1000).s, 1040);
      for (let i = 0; i < 10; i++) s.onPingEcho("a", 1000, 9000 + i);
      expect(s.rttMs("a")).toBe(40);
    });

    it("refuses another session's stamp", () => {
      const s = new NetSessions();
      const { s: forB } = s.pingPayload("b", 1000);
      s.onPingEcho("a", forB, 1300);
      expect(s.rttMs("a")).toBeUndefined();
    });

    it("remembers only the last 4 stamps it sent a session", () => {
      const s = new NetSessions();
      const stamps = [1000, 2000, 3000, 4000, 5000].map((t) => s.pingPayload("a", t).s);
      s.onPingEcho("a", stamps[0]!, 5100); // aged out of the ring: an echo this late is not trusted
      expect(s.rttMs("a")).toBeUndefined();
      s.onPingEcho("a", stamps[4]!, 5100);
      expect(s.rttMs("a")).toBe(100);
    });

    it("forgets a session's stamps on drop", () => {
      const s = new NetSessions();
      const { s: sent } = s.pingPayload("a", 1000);
      s.drop("a");
      s.onPingEcho("a", sent, 1050);
      expect(s.rttMs("a")).toBeUndefined();
    });
  });
});

describe("installNetHandlers on the monotonic time-sync clock (review M2)", () => {
  afterEach(() => vi.restoreAllMocks());

  function fakeRoom() {
    const handlers = new Map<string, (client: unknown, msg: unknown) => void>();
    let interval: (() => void) | undefined;
    const sent: Array<[string, unknown]> = [];
    const client = { sessionId: "a", send: (type: string, m: unknown) => sent.push([type, m]) };
    const room = {
      onMessage: (type: string, cb: (client: unknown, msg: unknown) => void) => handlers.set(type, cb),
      clock: { setInterval: (cb: () => void) => (interval = cb) },
      clients: [client],
    };
    return { room: room as unknown as Room, handlers, sent, client, fire: () => interval!() };
  }
  const limits = new ClientLimits();

  it("netNowMs is performance.now(), not the steppable wall clock", () => {
    const perf = vi.spyOn(performance, "now").mockReturnValue(1234.5);
    vi.spyOn(Date, "now").mockReturnValue(9e12);
    expect(netNowMs()).toBe(1234.5);
    perf.mockRestore();
  });

  it("a wall-clock step between ping and echo neither drops nor inflates the RTT", () => {
    const f = fakeRoom();
    const sessions = new NetSessions();
    installNetHandlers(f.room, sessions, (fn) => fn(), limits);
    const perf = vi.spyOn(performance, "now");
    const wall = vi.spyOn(Date, "now");
    perf.mockReturnValue(5000);
    wall.mockReturnValue(1_700_000_000_000);
    f.fire();
    const ping = f.sent.find(([t]) => t === MSG_PING)![1];
    perf.mockReturnValue(5040);
    wall.mockReturnValue(1_700_000_000_000 - 30_000); // w32time stepped the wall clock back 30 s
    f.handlers.get(MSG_PING)!(f.client, ping);
    expect(sessions.rttMs("a")).toBe(40);
  });

  it("every room dates markTick on netNowMs, never on Date.now", () => {
    for (const room of ["ArenaRoom", "PracticeRoom", "PlaygroundRoom"]) {
      const src = readFileSync(new URL(`../rooms/${room}.ts`, import.meta.url), "utf8");
      const marks = src.match(/markTick\([^;]*\);/g) ?? [];
      expect(marks.length, room).toBeGreaterThan(0);
      for (const m of marks) expect(m, room).toMatch(/netNowMs\(\)/);
    }
  });

  it("a pong is dated on the same clock markTick's due times use", () => {
    const f = fakeRoom();
    const sessions = new NetSessions();
    installNetHandlers(f.room, sessions, (fn) => fn(), limits);
    sessions.markTick(10, 2000);
    vi.spyOn(performance, "now").mockReturnValue(2005);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    f.handlers.get(MSG_TIME)!(f.client, { c: 1 });
    const pong = f.sent.find(([t]) => t === MSG_TIME)![1] as TimePong;
    expect(pong).toEqual({ c: 1, t: 10, p: 5 });
  });
});
