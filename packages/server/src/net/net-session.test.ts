import { describe, expect, it } from "vitest";
import { MS_PER_TICK } from "@motor-combat-moba/shared";
import { NetSessions } from "./net-session.js";

describe("NetSessions", () => {
  it("answers with the last completed tick and the ms into the next", () => {
    const s = new NetSessions();
    s.markTick(100, 5000);
    const p = s.pong(42, 5000 + MS_PER_TICK / 2);
    expect(p.c).toBe(42);
    expect(p.t).toBe(100);
    expect(p.p).toBeCloseTo(MS_PER_TICK / 2, 9);
  });
  it("clamps p into [0, MS_PER_TICK)", () => {
    const s = new NetSessions();
    s.markTick(1, 0);
    expect(s.pong(0, 10 * MS_PER_TICK).p).toBeLessThan(MS_PER_TICK);
    expect(s.pong(0, -50).p).toBe(0);
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
