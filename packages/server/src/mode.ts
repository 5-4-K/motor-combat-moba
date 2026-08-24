import type { DeployMode } from "@motor-arena/shared";
import type { LatencyConfig } from "./net/latency-injector.js";

export function getDeployMode(): DeployMode {
  return process.env.DEPLOY_MODE === "cloud" ? "cloud" : "lan";
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

export function getSimulatedLatency(): LatencyConfig {
  const latencyMs = Number(process.env.SIM_LATENCY_MS);
  const jitterMs = Number(process.env.SIM_JITTER_MS);
  return {
    latencyMs: Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : 0,
    jitterMs: Number.isFinite(jitterMs) && jitterMs > 0 ? jitterMs : 0,
  };
}
