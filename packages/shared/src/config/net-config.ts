export const NET_CONFIG = {
  /**
   * Most inputs one player may have *applied* in a single server tick. An honest client sends one
   * per tick; the headroom absorbs a hitch and the catch-up burst that follows. Inputs past the cap
   * are still drained and still acked, never simulated.
   *
   * This *bounds* a flooder’s advantage at `maxInputsPerTick`x rather than eliminating it: the
   * translation step still runs this many times per tick even once `speed` saturates, so a flooder
   * covers that multiple of an honest client’s distance. Some multiple above 1x is inherent to any
   * per-tick cap, and a cap of 1 would strand honest clients after every network stall. Raising this
   * buys stall headroom and raises the flood ceiling by the same factor.
   */
  maxInputsPerTick: 5,
  pendingInputCap: 24,
  reconcileSnapPos: 24,
  reconcileSnapAngle: 0.6,
  reconcileEaseRate: 0.25,
  interpolationDelayMs: 50,
} as const;
