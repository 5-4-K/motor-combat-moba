import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE, NEUTRAL_MODIFIERS, TICK_RATE_HZ, installMode, modeConfigOf,
} from "@motor-combat-moba/shared";
import { RESOLVED_BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView, BotView } from "../types.js";
import { HumanController } from "./controller.js";
import { enemy, view } from "./fixtures.js";
import { bodyFromSelf, rollForward, type DriveAction } from "./predict.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/**
 * THE STATED BUDGET (P33), in milliseconds per `decide()` call: 37 ms of CPU per SIMULATED second,
 * the figure the user set on 2026-09-30. v7 has no planner; every bot calls `decide` once a tick, so
 * six bots are 6 x `TICK_RATE_HZ` decides per simulated second.
 *
 * ⚠ THE v7 BRAIN DOES NOT MEET IT, AND THIS FILE SAYS SO RATHER THAN HIDING IT. Measured 2026-10-10:
 * hard costs ~0.55-0.58 ms of CPU per `decide` averaged over consecutive ticks (~2.2 ms on each
 * recompute tick, ~1.4 us on the others), 5.3-5.6x this budget — six hard bots would spend ~200 ms of
 * CPU per simulated second. Almost all of it is `solve()`: one call costs ~1.47 ms for `pepperbox`
 * (every pellet of every quadrature node marched), ~0.53 ms for `lance`, ~0.10 ms for `predator`;
 * the predictor's 180-tick rollout is ~0.06 ms. That is a question about the solver, not a stopwatch,
 * and it is printed on every run. It is NOT asserted: BB64 makes the reference ratio the gate, and an
 * assertion on a budget the shipped brain misses five-fold would only teach the next reader to delete
 * it. Never move this constant to make a number look better.
 */
const BUDGET_MS = 37 / (6 * TICK_RATE_HZ);

/**
 * THE REFERENCE WORKLOAD, and why the gate is a RATIO against it rather than a stopwatch reading
 * (R-PF2, carried over from `planner.bench.test.ts`, which measured the method in 26 runs).
 *
 * This file is one of many the runner executes in parallel, so shared cache, SMT siblings and
 * all-core frequency scaling make the same instructions cost more when every core is busy: the
 * planner's absolute reading moved 1.58x between an idle box and the full suite. Timing a fixed
 * reference in the same process, moments apart, and gating the ratio divides that load out (the
 * planner's median-of-five ratio moved 1.14x over the same runs). The reference is
 * `REFERENCE_ROLLOUTS` x `REFERENCE_TICKS` `stepDrive` calls through `rollForward`, so the gated
 * number reads "one decide costs about N drive ticks" — a statement about the brain, not the box.
 *
 * The MEDIAN of the five ratios is gated, not the best: a ratio has two noisy halves and
 * `process.cpuUsage` advances in coarse steps, so min-of-five preferentially picks a repeat whose
 * denominator quantised high. All five are printed — one wild repeat beside four tight ones is a
 * busy machine; five drifting together is a regression.
 */
const REFERENCE_TICKS = 100;

/**
 * 10,000 rollouts x 100 ticks = one million `stepDrive` calls, ~0.5 s of work per repeat — the same
 * ORDER as the timed decide block, so neither half is quantisation-limited. FIXED, never read off a
 * profile: a denominator that grew with a brain knob would cancel the regression it exists to catch.
 */
const REFERENCE_ROLLOUTS = 10_000;

/**
 * THE SHIPPED READING the gate is derived from: the WORST median-of-five ratio measured on the v7
 * brain (BB64), in drive ticks per `decide`, so the margin below is headroom against a different
 * machine and not spent on this one's own noise.
 *
 * Measured 2026-10-10 at `08d5ef56` + this file, Windows, hard Bullseye vs the scene below: ALONE
 * (`vitest -c vitest.slow.config.ts src/bot/brain/brain.bench.test.ts`) x5 medians 1475.1, 1561.1,
 * 1561.1, 1478.3, 1633.7; LOADED (`... src/bot/ src/config/`, 19 files) x2 medians 1541.3, 1445.5.
 * The worst is 1633.7, recorded as 1634; the gate trips at ~2124.
 *
 * IF THIS EVER FLAKES ON A DIFFERENT MACHINE, raise THIS or `NORMALISED_MARGIN` and record the
 * reading that made you — never `BUDGET_MS`.
 */
const MEASURED_RATIO = 1634;

/** 30% on top of the measured reading: trips on a real creep, clears this box's own spread. */
const NORMALISED_MARGIN = 1.3;

/**
 * The worst BEST-of-five absolute reading over the same runs, in ms of CPU per `decide`: 0.546-0.562
 * alone, 0.562-0.578 loaded. The backstop below is anchored here rather than on `BUDGET_MS`, which the
 * v7 brain misses five-fold (see its doc).
 */
const MEASURED_DECIDE_MS = 0.578;

/**
 * The absolute assertion, kept as a backstop at 3x the measured reading. Normalising has one blind
 * spot: if `stepDrive` itself regressed, the denominator would grow with the numerator and the ratio
 * would not move. Loose on purpose — it has to clear a loaded machine — and not the gate.
 */
const ABSOLUTE_BACKSTOP_MARGIN = 3;

/** Decides thrown away before the clock starts, so the assertion times optimised code. */
const WARM_UP = 300;

/**
 * Decides per timed repeat, over CONSECUTIVE ticks of one bot: hard recomputes every
 * `recomputeTicks`, and perception, aim drift and the delay line run every tick, so a block of
 * consecutive ticks is the real mix of cheap and recompute ticks. Sized so the block is the same
 * order as the reference (see the measured figure in the console line).
 */
const ITERATIONS = 1000;

/** Five timed repeats of both halves, interleaved. */
const REPEATS = 5;

/**
 * A hard Bullseye mid-fight: a Mirage 250 u out, 20° off the nose — inside every turret arc and the
 * kit's reach, so the bot solves every ready slot, fights and presses a turret slot with a bearing.
 * Stationary, so the open-loop view (the pose never moves) is self-consistent.
 */
function targetCar(): BotCarView {
  return { ...enemy(), x: 200 + Math.cos(0.35) * 250, y: 360 + Math.sin(0.35) * 250, vx: 0 };
}

function sceneAt(tick: number, target: BotCarView, rng: BotView["rng"]): BotView {
  return view(tick, { others: [target], rng });
}

/** One timed repeat: the mean cost of `ITERATIONS` decides, in milliseconds, as CPU and wall. */
function timeDecides(bot: HumanController, clock: { tick: number }, target: BotCarView, rng: BotView["rng"]): { cpu: number; wall: number } {
  // Views built outside the timed block: building one is the host's cost, not the brain's.
  const views = Array.from({ length: ITERATIONS }, (_, i) => sceneAt(clock.tick + i, target, rng));
  // `process.cpuUsage` is this process's own CPU; vitest's default `forks` pool runs each file in its
  // own child process, so it is blind to the other suites on the other cores. Wall is printed too:
  // `wall >> cpu` means the box was loaded.
  const cpuBefore = process.cpuUsage();
  const wallBefore = performance.now();
  for (const v of views) bot.decide(v);
  const wall = (performance.now() - wallBefore) / ITERATIONS;
  const spent = process.cpuUsage(cpuBefore);
  clock.tick += ITERATIONS;
  return { cpu: (spent.user + spent.system) / 1000 / ITERATIONS, wall };
}

/**
 * The REFERENCE WORKLOAD: a fixed number of `stepDrive` calls via `rollForward` (the predictor's own
 * inner loop), timed exactly as `timeDecides` times a decide. Returned per STEP, so the ratio reads
 * as drive ticks per decide.
 */
function timeReference(self: BotSelfView): { cpu: number; wall: number } {
  const held: DriveAction = { steer: 1, throttle: 1 };
  const body = bodyFromSelf(self);
  let sink = 0;
  const cpuBefore = process.cpuUsage();
  const wallBefore = performance.now();
  for (let i = 0; i < REFERENCE_ROLLOUTS; i++) {
    const poses = rollForward(body, self.carId, held, REFERENCE_TICKS, NEUTRAL_MODIFIERS);
    // Consumed, so neither the rollout nor the loop can be optimised away as dead code.
    sink += poses[poses.length - 1]!.x;
  }
  const steps = REFERENCE_ROLLOUTS * REFERENCE_TICKS;
  const wall = (performance.now() - wallBefore) / steps;
  const spent = process.cpuUsage(cpuBefore);
  if (!Number.isFinite(sink)) throw new Error("reference workload diverged");
  return { cpu: (spent.user + spent.system) / 1000 / steps, wall };
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

describe("brain cost (BB64)", () => {
  it("times hard, the tier that recomputes most often", () => {
    // Hard is the heaviest by `recomputeTicks` (it solves every ready slot most often); if a retune
    // inverted that, the gate below would be watching the cheap tier.
    const cadence = (tier: "easy" | "medium" | "hard") => RESOLVED_BOT_PROFILES[tier].recomputeTicks;
    expect(cadence("hard")).toBeLessThanOrEqual(cadence("medium"));
    expect(cadence("hard")).toBeLessThanOrEqual(cadence("easy"));
  });

  it("costs no more than the shipped measurement allows, normalised (BB64, R-PF2)", () => {
    const bot = new HumanController("hard");
    const rng = makeRng(17);
    const clock = { tick: 0 };
    const target = targetCar();
    const self = view(0).self;

    // Both halves warmed before either is timed, so the reference is not paying JIT tiering the
    // brain already paid.
    for (let i = 0; i < WARM_UP; i++) bot.decide(sceneAt(clock.tick++, target, rng));
    expect(bot.debug()?.situation).toBe("fight");
    timeReference(self);

    // INTERLEAVED, one reference immediately after each decide block: the normalisation only cancels
    // load both halves actually saw.
    const decideRepeats: { cpu: number; wall: number }[] = [];
    const refRepeats: { cpu: number; wall: number }[] = [];
    const ratios: number[] = [];
    for (let r = 0; r < REPEATS; r++) {
      const decided = timeDecides(bot, clock, target, rng);
      const reference = timeReference(self);
      decideRepeats.push(decided);
      refRepeats.push(reference);
      ratios.push(decided.cpu / reference.cpu);
    }
    const best = Math.min(...decideRepeats.map((x) => x.cpu));
    const median = medianOf(decideRepeats.map((x) => x.cpu));
    const bestWall = Math.min(...decideRepeats.map((x) => x.wall));
    const refMedian = medianOf(refRepeats.map((x) => x.cpu));
    const bestRatio = Math.min(...ratios);
    const medianRatio = medianOf(ratios);
    const gate = MEASURED_RATIO * NORMALISED_MARGIN;

    // The ABSOLUTE figure is printed beside the ratio on every run: the ratio is what trips, but
    // "one decide costs N drive ticks" says nothing about whether the budget is met.
    // eslint-disable-next-line no-console
    console.log(
      `[brain perf] hard recompute=${RESOLVED_BOT_PROFILES.hard.recomputeTicks} ticks: `
      + `${(best * 1000).toFixed(2)} us/decide cpu best (median ${(median * 1000).toFixed(2)}, `
      + `wall ${(bestWall * 1000).toFixed(2)}), block ${(median * ITERATIONS).toFixed(0)} ms, `
      + `budget ${(BUDGET_MS * 1000).toFixed(1)} us -> ${(best / BUDGET_MS).toFixed(3)}x budget. `
      + `Reference ${(refMedian * 1000).toFixed(4)} us/step. `
      + `GATED: ${medianRatio.toFixed(1)} drive ticks/decide (median of `
      + `[${ratios.map((x) => x.toFixed(1)).join(" ")}], best ${bestRatio.toFixed(1)}), `
      + `gate ${gate.toFixed(0)}`,
    );

    // The gate (R-PF2): normalised, so it trips on a real regression and not on a busy machine.
    expect(medianRatio).toBeLessThan(gate);
    // The backstop: catches a regression that moved the reference along with the brain.
    expect(best).toBeLessThan(MEASURED_DECIDE_MS * ABSOLUTE_BACKSTOP_MARGIN);
  });
});
