import { describe, expect, it } from "vitest";
import { NET_CONFIG, msToTicks } from "@motor-combat-moba/shared";
import { shotCompTicks } from "./shot-comp.js";

const cap = msToTicks(NET_CONFIG.shotCompCapMs);

/**
 * The fixtures are the netsim baseline's own numbers (F1): an honest `net80clean` client reads
 * 9 ticks of staleness at p50 and p95, with the server measuring its slack at a mean of ~1.54 ticks
 * and a spread of ~0.34 (p95 0.5); its RTT is 80 ms.
 */
describe("shotCompTicks (NR36)", () => {
  it("sizes the cap from the measured honest net80clean staleness", () => {
    expect(cap).toBe(9);
  });

  it("gives an honest net80clean client its measured staleness", () => {
    expect(shotCompTicks({ pressTick: 1000, viewTick: 991, rttMs: 80, slackMeanTicks: 1.54, slackStdTicks: 0.34 })).toBe(9);
  });

  it("caps a liar on LAN at what its link allows, below the cap", () => {
    const lan = shotCompTicks({ pressTick: 1000, viewTick: 0, rttMs: 1, slackMeanTicks: 1.5, slackStdTicks: 0.37 });
    expect(lan).toBeGreaterThanOrEqual(1);
    expect(lan).toBeLessThanOrEqual(5);
    expect(lan).toBeLessThan(cap);
  });

  it("never lets a lossy, jittery link earn more than the cap", () => {
    expect(shotCompTicks({ pressTick: 1000, viewTick: 0, rttMs: 500, slackMeanTicks: 10, slackStdTicks: 5 })).toBe(cap);
    expect(shotCompTicks({ pressTick: 1000, viewTick: 980, rttMs: 150, slackMeanTicks: 1.86, slackStdTicks: 1.52 })).toBe(cap);
  });

  it("is zero without a viewTick or a measured RTT, and never negative", () => {
    expect(shotCompTicks({ pressTick: 1000, viewTick: undefined, rttMs: 80, slackMeanTicks: 1, slackStdTicks: 0 })).toBe(0);
    expect(shotCompTicks({ pressTick: 1000, viewTick: 994, rttMs: undefined, slackMeanTicks: 1, slackStdTicks: 0 })).toBe(0);
    expect(shotCompTicks({ pressTick: 1000, viewTick: 1005, rttMs: 80, slackMeanTicks: 1, slackStdTicks: 0 })).toBe(0);
  });
});
