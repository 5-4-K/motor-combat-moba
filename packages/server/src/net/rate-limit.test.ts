import { describe, expect, it } from "vitest";
import { CLOSE_CODES, MS_PER_TICK, NET_CONFIG, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { ClientLimits, RATE_LIMIT_KICK_MS, TokenBucket, admit, type MessageKind } from "./rate-limit.js";

describe("TokenBucket", () => {
  it("allows the burst, then the rate", () => {
    const b = new TokenBucket(10, 3);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(100)).toBe(true); // 0.1 s refills one token at 10/s
    expect(b.take(100)).toBe(false);
  });

  it("never banks more than its burst, however long it sits idle", () => {
    const b = new TokenBucket(10, 3);
    let ok = 0;
    for (let i = 0; i < 10; i++) if (b.take(60_000)) ok++;
    expect(ok).toBe(3);
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
    expect(l.droppedFor("a")).toBe(dropped);
  });

  it("reads 0 once the last call of the flooded kind was allowed", () => {
    const l = new ClientLimits();
    for (let i = 0; i < 100; i++) l.allow("a", "lobby", 0);
    expect(l.overLimitFor("a", 0)).toBe(0); // a run that has only just started
    expect(l.overLimitFor("a", 50)).toBe(50);
    expect(l.allow("a", "lobby", 1000)).toBe(true);
    expect(l.overLimitFor("a", 1000)).toBe(0);
  });

  it("does not let an old, abandoned refusal count as being over now", () => {
    // One excess lobby click, then an honest client stops clicking. Seconds later its run is stale,
    // not six seconds long.
    const l = new ClientLimits();
    for (let i = 0; i < 11; i++) l.allow("a", "lobby", 0);
    expect(l.overLimitFor("a", 0)).toBe(0);
    expect(l.overLimitFor("a", 6000)).toBe(0);
  });

  it("keeps sessions and kinds apart, and forgets a dropped session", () => {
    const l = new ClientLimits();
    for (let i = 0; i < 100; i++) l.allow("a", "time", 0);
    expect(l.allow("a", "input", 0)).toBe(true);
    expect(l.allow("b", "time", 0)).toBe(true);
    l.drop("a");
    expect(l.allow("a", "time", 0)).toBe(true);
    expect(l.overLimitFor("a", 0)).toBe(0);
  });
});

describe("admit (the rooms' handler gate)", () => {
  function fakeClient(): { sessionId: string; closed: number[]; leave(code?: number): void } {
    return {
      sessionId: "a",
      closed: [],
      leave(code?: number) {
        this.closed.push(code ?? -1);
      },
    };
  }

  it("disconnects a client over a limit for more than RATE_LIMIT_KICK_MS straight, once", () => {
    const l = new ClientLimits();
    const c = fakeClient();
    for (let t = 0; t <= RATE_LIMIT_KICK_MS + 500; t += 1) admit(l, c, "input", t);
    expect(c.closed).toEqual([CLOSE_CODES.RATE_LIMITED]);
  });

  it("drops but never disconnects a client that is only briefly over", () => {
    const l = new ClientLimits();
    const c = fakeClient();
    let refused = 0;
    for (let s = 0; s < 20; s++) {
      // A 200-packet burst once a second: over the limit in bursts, never for 5 s straight.
      for (let i = 0; i < 200; i++) if (!admit(l, c, "input", s * 1000 + i)) refused++;
    }
    expect(refused).toBeGreaterThan(0);
    expect(c.closed).toEqual([]);
  });
});

/**
 * Deterministic PRNG (mulberry32), so the honest mix below is the same on every run.
 */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("an honest client of this build is never refused (NR54)", () => {
  /**
   * 60 s of what `ArenaScene` sends, as the SERVER sees it arrive: an input packet per tick from a
   * 144 fps render loop (so 0-2 packets per frame), an 8-tick catch-up burst after each of a few
   * frame stalls, the `MSG_TIME` join burst then the steady rate, one `MSG_PING` echo a second, and
   * lobby clicking at a human's fastest (car-preview cycling, a chat line, pause toggles). Arrival
   * times carry +-10 ms of network jitter and a TCP retransmit stall (every message held 300 ms,
   * then delivered together) twice a minute.
   */
  it("drives the full message mix through ClientLimits for 60 s with zero refusals", () => {
    const rand = rng(42);
    const sends: { at: number; kind: MessageKind }[] = [];
    const DURATION = 60_000;

    // Inputs: the scheduler emits one tick per MS_PER_TICK, drained by 144 fps frames.
    const frame = 1000 / 144;
    let nextTickAt = 0;
    const stalls = [5_000, 17_000, 33_000, 48_000]; // a 250 ms frame hitch each
    for (let now = 0; now < DURATION; now += frame) {
      const stalled = stalls.some((s) => now >= s && now < s + 250);
      if (stalled) continue;
      let burst = 0;
      while (nextTickAt <= now) {
        if (burst < NET_CONFIG.clientMaxCatchUpTicks) sends.push({ at: now, kind: "input" });
        burst++;
        nextTickAt += MS_PER_TICK;
      }
    }
    // Time sync: join burst, then the steady rate, re-bursting on two pause-resumes; ping echoes 1/s.
    for (const joinAt of [0, 20_000, 40_000]) {
      for (let t = joinAt; t < joinAt + NET_CONFIG.timeSyncBurstWindowMs; t += NET_CONFIG.timeSyncBurstMs) {
        sends.push({ at: t, kind: "time" });
      }
    }
    for (let t = 0; t < DURATION; t += NET_CONFIG.timeSyncIntervalMs) sends.push({ at: t, kind: "time" });
    for (let t = 0; t < DURATION; t += 1000) sends.push({ at: t + 3, kind: "time" });
    // Lobby: a car-preview click every 120 ms for 3 s, twice; a chat line and a pause toggle now and then.
    for (const from of [2_000, 30_000]) for (let t = from; t < from + 3_000; t += 120) sends.push({ at: t, kind: "lobby" });
    for (let t = 1_000; t < DURATION; t += 4_000) sends.push({ at: t, kind: "lobby" }, { at: t + 150, kind: "lobby" });

    // The wire: jitter on every message, in order, with two retransmit stalls.
    const retransmits = [12_000, 41_000];
    let lastArrival = -Infinity;
    const arrivals = sends
      .sort((a, b) => a.at - b.at)
      .map((m) => {
        let at = m.at + 20 + (rand() * 2 - 1) * 10;
        for (const r of retransmits) if (m.at >= r && m.at < r + 300) at = Math.max(at, r + 300 + 20);
        at = Math.max(at, lastArrival);
        lastArrival = at;
        return { ...m, at };
      });

    const limits = new ClientLimits();
    const refused: string[] = [];
    for (const m of arrivals) if (!limits.allow("honest", m.kind, m.at)) refused.push(`${m.kind}@${m.at.toFixed(0)}`);
    expect(arrivals.filter((m) => m.kind === "input").length).toBeGreaterThan(TICK_RATE_HZ * 55);
    expect(refused).toEqual([]);
  });
});
