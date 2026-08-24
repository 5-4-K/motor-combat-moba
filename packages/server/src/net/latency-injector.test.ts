import { describe, expect, it, vi, afterEach } from "vitest";
import { withSimulatedLatency, type LatencyConfig } from "./latency-injector.js";

describe("withSimulatedLatency", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the same function when latencyMs and jitterMs are 0", () => {
    const deliver = (_msg: string) => {};
    const cfg: LatencyConfig = { latencyMs: 0, jitterMs: 0 };
    expect(withSimulatedLatency(deliver, cfg)).toBe(deliver);
  });

  it("delays delivery by latencyMs when jitter is 0", () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const cfg: LatencyConfig = { latencyMs: 20, jitterMs: 0 };
    const wrapped = withSimulatedLatency(deliver, cfg);

    wrapped("hello");
    expect(deliver).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith("hello");
  });
});
