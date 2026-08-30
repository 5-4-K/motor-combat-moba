import { MS_PER_TICK, NET_CONFIG } from "@motor-combat-moba/shared";

export interface DrainResult {
  /** Time left over, carried into the next frame. Always in `[0, MS_PER_TICK)`. */
  accMs: number;
  /** How many input ticks to emit this frame. */
  ticks: number;
}

/**
 * Turn elapsed frame time into whole sim ticks. Inputs go out on the sim clock, not the render
 * clock, so a 144 Hz client does not send — and predict — five times as many steps as a 30 Hz one.
 *
 * The clamp happens *before* the drain, and it is capped at what the server will actually
 * **simulate** in one tick (`MS_PER_TICK * NET_CONFIG.maxInputsPerTick`), not at some arbitrary
 * ceiling. Inputs past that cap are drained and acked by the server but never stepped, so emitting
 * them would manufacture divergence that reconciliation then has to snap away. Clamping first also
 * means a long stall (an alt-tab, a GC pause) can never turn into an unbounded catch-up burst.
 */
export function drainTicks(accMs: number, deltaMs: number): DrainResult {
  const maxCatchUpMs = MS_PER_TICK * NET_CONFIG.maxInputsPerTick;
  const clamped = Math.min(accMs + deltaMs, maxCatchUpMs);
  const ticks = Math.floor(clamped / MS_PER_TICK);
  return { accMs: clamped - ticks * MS_PER_TICK, ticks };
}

/**
 * One axis of a two-key control as the `-1 | 0 | 1` the wire expects. Both keys down is a
 * deliberate `0` rather than a last-key-wins fight: holding left and right at once should mean "no
 * steering", not an arbitrary direction that depends on keyboard scan order.
 *
 * That rule is also what lets each side be an OR of two key sets — the arrows and WASD both steer,
 * and the free-look camera pans on either — without this function knowing there are two. Holding A
 * and Right is the same situation as holding Left and Right, and it already answers 0.
 */
export function axisOf(negative: boolean, positive: boolean): -1 | 0 | 1 {
  if (negative === positive) return 0;
  return positive ? 1 : -1;
}
