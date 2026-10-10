import { describe, expect, it } from "vitest";
import { MS_PER_TICK, SNAPSHOT_RATE_HZ } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { ClockSync } from "./clock-sync.js";
import { InputScheduler, SLACK_QUANTISATION_STD_TICKS } from "./input-scheduler.js";
import { pongFields, meanSlack, simulate, WARMUP_MS } from "./input-scheduler.fixture.js";
import { LATE_SLACK_FLOOR_TICKS, newTickInputBuffer } from "./tick-input.js";

function syncedClock(oneWay: number): ClockSync {
  const c = new ClockSync();
  for (let i = 0; i < 16; i++) {
    const sendAt = i * 100;
    c.onPong(sendAt + 2 * oneWay, { c: sendAt, ...pongFields(sendAt + oneWay) });
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

  it("steers slack to targetSlackTicks + slackSpreadK x the reported spread (NR21, D5 ruling E)", () => {
    // Same clock, same mean-slack samples sitting exactly on the old target; only the spread differs.
    const flat = new InputScheduler(syncedClock(40));
    const spread = new InputScheduler(syncedClock(40));
    for (let now = 2000; now < 6000; now += 1000 / 60) {
      flat.due(now, 1000 / 60, NET_CONFIG.targetSlackTicks, 0);
      spread.due(now, 1000 / 60, NET_CONFIG.targetSlackTicks, 2);
    }
    // On target with no spread: the lead does not move off rtt/2 + the initial safety.
    expect(flat.leadMs).toBeCloseTo(40 + NET_CONFIG.targetSlackTicks * MS_PER_TICK, 6);
    // A 2-tick spread means slack is 2K ticks short of its target: the safety grows.
    expect(NET_CONFIG.slackSpreadK).toBeGreaterThan(0);
    expect(spread.leadMs).toBeGreaterThan(flat.leadMs + MS_PER_TICK);
  });

  it("ignores a spread no larger than integer quantisation (fix round I3)", () => {
    // Slack samples are whole ticks: a steady path with a fractional true lead reads as a Bernoulli
    // mix of two neighbouring integers, std up to 0.5, with nothing late about it.
    const flat = new InputScheduler(syncedClock(40));
    const quantised = new InputScheduler(syncedClock(40));
    for (let now = 2000; now < 6000; now += 1000 / 60) {
      flat.due(now, 1000 / 60, NET_CONFIG.targetSlackTicks, 0);
      quantised.due(now, 1000 / 60, NET_CONFIG.targetSlackTicks, SLACK_QUANTISATION_STD_TICKS);
    }
    expect(SLACK_QUANTISATION_STD_TICKS).toBe(0.5);
    expect(quantised.leadMs).toBeCloseTo(flat.leadMs, 9);
  });

  it("moves its lead by at most maxDilation of elapsed time per call", () => {
    const s = new InputScheduler(syncedClock(40));
    s.due(2000, 1000 / 60, 1.5);
    const before = s.leadMs;
    s.due(2000 + 1000 / 60, 1000 / 60, -10); // slack says 'way too late'
    expect(Math.abs(s.leadMs - before)).toBeLessThanOrEqual(0.04 * (1000 / 60) + 1e-9);
  });
});


describe("InputScheduler closed loop", () => {
  it("settles slack to the target after a one-way step from 40 to 70 ms, never late once settled", () => {
    const sim = simulate(1, (t) => (t < 5000 ? 40 : 70), 25);
    const tail = sim.measured.filter((m) => m.at > 15_000);
    for (const m of tail) expect(Math.abs(m.slack - NET_CONFIG.targetSlackTicks)).toBeLessThanOrEqual(0.5);
    for (const i of sim.inputs.filter((i) => i.at > 15_000)) expect(i.slack).toBeGreaterThanOrEqual(0);
  });

  it.each([0.99, 1.01])("a client clock at %s of the server's for a minute still lands inputs on time", (rate) => {
    const sim = simulate(rate, () => 40, 60);
    expect(sim.clockErrMs).toBeLessThan(25);
    for (const i of sim.inputs.filter((i) => i.at > 5000)) expect(i.tick).toBeGreaterThanOrEqual(i.next);
    for (let k = 1; k < sim.inputs.length; k++) expect(sim.inputs[k]!.tick).toBeGreaterThan(sim.inputs[k - 1]!.tick);
  });

  it("reaches the same steady state at 144 fps as at 60 (slack integrates per snapshot, not per frame)", () => {
    const a = simulate(1, () => 40, 40, { fps: 60 });
    const b = simulate(1, () => 40, 40, { fps: 144 });
    expect(Math.abs(meanSlack(b, 20_000) - NET_CONFIG.targetSlackTicks)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(meanSlack(b, 20_000) - meanSlack(a, 20_000))).toBeLessThanOrEqual(0.3);
  });
});


const cells = [60, 144].flatMap((fps) =>
  [0, 30].flatMap((jitter) =>
    [0, 0.01, -0.01].flatMap((drift) => [0, 0.2].map((spike) => ({ fps, jitter, drift, spike }))),
  ),
);

describe("InputScheduler closed-loop acceptance corners (NR18, NR20, NR21)", () => {
  // 80 ms RTT; the jitter and spikes are on the clock-sync pongs, which is what the estimate has to
  // see through. Inputs themselves travel a steady 40 ms, so a late input is the clock's fault.
  it.each(cells)(
    "$fps fps, pong jitter +-$jitter ms, drift $drift, spiked legs $spike: no late input, slack 1.5 +- 0.5",
    ({ fps, jitter, drift, spike }) => {
      for (const seed of [1]) {
        const sim = simulate(1 / (1 + drift), () => 40, 60, { fps, jitter, spike, seed });
        const late = sim.inputs.filter((i) => i.at > WARMUP_MS && i.slack < 0).length;
        expect(late, `seed ${seed}`).toBe(0);
        expect(Math.abs(meanSlack(sim, 30_000) - NET_CONFIG.targetSlackTicks), `seed ${seed}`).toBeLessThanOrEqual(0.5);
      }
    },
  );
});

/**
 * Closed loop against the REAL server buffer (`TickInputBuffer`, so its slack statistics and the
 * late-sample rule are the ones under test): one-way 40 ms both ways, and at `STALL_AT` both
 * directions stall for `STALL_MS`, then everything held is delivered at once, in order — the netsim
 * `Link` model of a TCP outage. Returns the scheduler's lead sampled per frame.
 *
 * The client keeps only the NEWEST snapshot that arrived since its last frame (`fresh` is
 * overwritten), so the burst of held snapshots a stall releases reads as one slack sample — the
 * per-frame rule `TickClient` and the browser's `InputClock` follow. A client that integrated every
 * held snapshot would see the burst as many samples.
 */
function stallLoop(): { at: number; lead: number }[] {
  const oneWay = 40;
  const sched = new InputScheduler(syncedClock(oneWay));
  const buf = newTickInputBuffer();
  const up: { at: number; tick: number }[] = [];
  const down: { at: number; slack: number; std: number }[] = [];
  const held = (at: number) => (at >= STALL_AT && at < STALL_AT + STALL_MS ? STALL_AT + STALL_MS : at);
  const leads: { at: number; lead: number }[] = [];
  let serverTick = 0;
  let nextTickAt = MS_PER_TICK;
  let nextFrame = 2000;
  let fresh: { slack: number; std: number } | undefined;
  for (let now = 0; now < STALL_AT + STALL_MS + 10_000; now++) {
    while (now >= nextTickAt) {
      serverTick++;
      buf.take(serverTick);
      down.push({ at: held(now + oneWay), slack: buf.slackMeanTicks(), std: buf.slackStdTicks() });
      nextTickAt += MS_PER_TICK;
    }
    while (up.length && up[0]!.at <= now) buf.offer({ tick: up.shift()!.tick, steer: 0, throttle: 0, fireSlots: 0 }, serverTick);
    while (down.length && down[0]!.at <= now) fresh = down.shift()!;
    if (now < nextFrame) continue;
    nextFrame += 1000 / 60;
    const sample = fresh;
    fresh = undefined;
    for (const tick of sched.due(now, 1000 / 60, sample?.slack, sample?.std ?? 0)) up.push({ at: held(now + oneWay), tick });
    leads.push({ at: now, lead: sched.leadMs });
  }
  return leads;
}

const STALL_AT = 20_000;
const STALL_MS = 10_000;
/**
 * How long after a 10 s outage ends the lead may take to settle back within one tick of before it.
 * Measured at D6's final settings (gain 0.03, `slackSpreadK` 1): 0.62 s with late samples floored at
 * LATE_SLACK_FLOOR_TICKS (-1), 4.57 s unfloored.
 */
const STALL_RECOVERY_MS = 1_000;

describe("InputScheduler after a long stall (D6)", () => {
  it("returns to its pre-stall lead within STALL_RECOVERY_MS: the backlog's late frames cannot pin the safety", () => {
    const leads = stallLoop();
    const before = leads.filter((l) => l.at > STALL_AT - 5_000 && l.at < STALL_AT).map((l) => l.lead);
    const settled = before.reduce((a, l) => a + l, 0) / before.length;
    const end = STALL_AT + STALL_MS;
    const lastOff = Math.max(end, ...leads.filter((l) => l.at > end && Math.abs(l.lead - settled) > MS_PER_TICK).map((l) => l.at));
    expect(lastOff - end).toBeLessThanOrEqual(STALL_RECOVERY_MS);
  });

  it("a window of floored late samples still drives the lead at the full maxDilation (the floor loses no speed)", () => {
    // At the floor, the integrator must out-run the lead's own slew limit, so flooring a sample can
    // never make a genuinely short lead recover slower than an unfloored one would.
    const s = new InputScheduler(syncedClock(40));
    const frame = 1000 / SNAPSHOT_RATE_HZ;
    s.due(2000, frame, NET_CONFIG.targetSlackTicks);
    const start = s.leadMs;
    const calls = SNAPSHOT_RATE_HZ;
    for (let k = 1; k <= calls; k++) s.due(2000 + k * frame, frame, LATE_SLACK_FLOOR_TICKS, 0);
    // The first call only starts the integrator off equilibrium; every one after it is slew-limited.
    expect(s.leadMs - start).toBeGreaterThanOrEqual(NET_CONFIG.maxDilation * frame * (calls - 1) - 1e-6);
  });
});
