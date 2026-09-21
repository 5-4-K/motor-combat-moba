import { PAUSE_REQUEST_TIMEOUT_MS } from "../config/pause-request.js";

/**
 * A pause request in flight (spec TR54), as a pure decision. The caller keeps one number — when it
 * last asked the server to pause, on a millisecond clock, or `null` — and reads it through these.
 *
 * In flight means: asked, the paused patch has not landed, and the timeout has not run out. While it
 * is, P must be ignored (a second toggle would un-pause before the first ever patched back) and no
 * relock may be asked for (the menu is about to mount under the cursor).
 */
export function pauseInFlight(
  requestedAtMs: number | null,
  paused: boolean,
  nowMs: number,
  timeoutMs: number = PAUSE_REQUEST_TIMEOUT_MS,
): boolean {
  return requestedAtMs !== null && !paused && nowMs - requestedAtMs < timeoutMs;
}

/** The request as it stands now: kept while in flight, dropped once the patch lands or it times out. */
export function settlePauseRequest(
  requestedAtMs: number | null,
  paused: boolean,
  nowMs: number,
  timeoutMs: number = PAUSE_REQUEST_TIMEOUT_MS,
): number | null {
  return pauseInFlight(requestedAtMs, paused, nowMs, timeoutMs) ? requestedAtMs : null;
}
