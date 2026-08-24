export interface LatencyConfig {
  latencyMs: number;
  jitterMs: number;
}

export function withSimulatedLatency<T>(
  deliver: (msg: T) => void,
  cfg: LatencyConfig,
): (msg: T) => void {
  if (cfg.latencyMs <= 0 && cfg.jitterMs <= 0) return deliver;
  return (msg: T) => {
    const jitter = cfg.jitterMs ? (Math.random() * 2 - 1) * cfg.jitterMs : 0;
    const delay = Math.max(0, cfg.latencyMs + jitter);
    setTimeout(() => deliver(msg), delay);
  };
}
