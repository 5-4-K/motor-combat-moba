export const NET_CONFIG = {
  /**
   * Most inputs one player may have *applied* in a single server tick. An honest client sends one
   * per tick; the headroom absorbs a hitch and the catch-up burst that follows. Inputs past the cap
   * are still drained and still acked, so a client that floods the socket gains no distance — it
   * only diverges from the server and gets snapped back by reconciliation.
   */
  maxInputsPerTick: 5,
  pendingInputCap: 24,
  reconcileSnapPos: 24,
  reconcileSnapAngle: 0.6,
  reconcileEaseRate: 0.25,
  interpolationDelayMs: 50,
} as const;
