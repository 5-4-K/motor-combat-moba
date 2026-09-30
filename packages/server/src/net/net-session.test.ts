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
    const { s: sent } = s.pingPayload(1000);
    s.onPingEcho("a", sent, 1080);
    expect(s.rttMs("a")).toBe(80);
    s.drop("a");
    expect(s.rttMs("a")).toBeUndefined();
  });
  it("reports the median of the last 8 echoes", () => {
    const s = new NetSessions();
    for (let i = 0; i < 8; i++) s.onPingEcho("a", 0, 100);
    for (let i = 0; i < 5; i++) s.onPingEcho("a", 0, 20);
    // last 8: three 100s and five 20s
    expect(s.rttMs("a")).toBe(20);
  });
  it("ignores an echo from the future or a non-finite one", () => {
    const s = new NetSessions();
    s.onPingEcho("a", 2000, 1000);
    s.onPingEcho("a", Number.NaN, 1000);
    expect(s.rttMs("a")).toBeUndefined();
  });
});
