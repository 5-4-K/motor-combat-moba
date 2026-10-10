import { describe, expect, it } from "vitest";
import { NET_CONFIG } from "../config/net-config.js";
import { meanSlack, simulate, WARMUP_MS } from "./input-scheduler.fixture.js";

const cells = [60, 144].flatMap((fps) =>
  [0, 5, 10, 20, 30].flatMap((jitter) =>
    [0, 0.01, -0.01].flatMap((drift) => [0, 0.05, 0.2].map((spike) => ({ fps, jitter, drift, spike }))),
  ),
);

describe("InputScheduler closed-loop acceptance envelope (NR18, NR20, NR21)", () => {
  // 80 ms RTT; the jitter and spikes are on the clock-sync pongs, which is what the estimate has to
  // see through. Inputs themselves travel a steady 40 ms, so a late input is the clock's fault.
  it.each(cells)(
    "$fps fps, pong jitter +-$jitter ms, drift $drift, spiked legs $spike: no late input, slack 1.5 +- 0.5",
    ({ fps, jitter, drift, spike }) => {
      for (const seed of [1, 2]) {
        const sim = simulate(1 / (1 + drift), () => 40, 60, { fps, jitter, spike, seed });
        const late = sim.inputs.filter((i) => i.at > WARMUP_MS && i.slack < 0).length;
        expect(late, `seed ${seed}`).toBe(0);
        expect(Math.abs(meanSlack(sim, 30_000) - NET_CONFIG.targetSlackTicks), `seed ${seed}`).toBeLessThanOrEqual(0.5);
      }
    },
  );
});
