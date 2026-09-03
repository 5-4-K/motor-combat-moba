import type { DeployMode } from "@motor-combat-moba/shared";
import type { LatencyConfig } from "./net/latency-injector.js";

export function getDeployMode(): DeployMode {
  return process.env.DEPLOY_MODE === "cloud" ? "cloud" : "lan";
}

/**
 * Whether dev-only tooling is registered on this process (spec PG3) — today, the `PlaygroundRoom`.
 *
 * Deliberately an exact-`"1"` match rather than a truthiness test: the playground's tuning store is
 * process-wide and its room bypasses every lobby rule, so a stray `DEV_TOOLS=0` or `DEV_TOOLS=false`
 * in a release `.env` must read as OFF. `npm run dev:server` is the one place that sets it.
 */
export function isDevToolsEnabled(): boolean {
  return process.env.DEV_TOOLS === "1";
}

export function getPort(): number {
  const n = Number(process.env.PORT);
  return Number.isFinite(n) && n > 0 ? n : 2567;
}

export function getTickRateHz(fallback: number): number {
  const n = Number(process.env.TICK_RATE_HZ);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function parseCarSelectSeconds(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getCarSelectSeconds(fallback: number): number {
  return parseCarSelectSeconds(process.env.CAR_SELECT_SECONDS, fallback);
}

/** Same shape as the car-select override, so the reveal dwell can be shortened while testing a flow. */
export function getRevealSeconds(fallback: number): number {
  return parseCarSelectSeconds(process.env.REVEAL_SECONDS, fallback);
}

export function getSimulatedLatency(): LatencyConfig {
  const latencyMs = Number(process.env.SIM_LATENCY_MS);
  const jitterMs = Number(process.env.SIM_JITTER_MS);
  return {
    latencyMs: Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : 0,
    jitterMs: Number.isFinite(jitterMs) && jitterMs > 0 ? jitterMs : 0,
  };
}

/**
 * How many practice rooms this process will host at once (spec PR29). Same override shape as the
 * knobs above, and `>= 0` rather than `> 0` on purpose: `MAX_PRACTICE_ROOMS=0` is how a host turns
 * practice off on a machine that is only there to run the arena.
 */
export function getMaxPracticeRooms(fallback: number): number {
  const raw = process.env.MAX_PRACTICE_ROOMS;
  // The empty string is excluded before `Number` sees it, because `Number("") === 0` and zero is a
  // MEANINGFUL value here — a blank `MAX_PRACTICE_ROOMS=` left in a `.env` would otherwise turn
  // practice off across the whole host. The other overrides above cannot hit this: zero is not a
  // legal value for any of them, so their `> 0` test already rejects it.
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
