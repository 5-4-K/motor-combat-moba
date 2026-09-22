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

/**
 * THE pause request — one per page, not one per caller (TR54). Practice and the playground can ask
 * for a pause from more than one place (`ArenaScene`'s P and its Esc/lock-loss `openMenu`, the
 * playground overlay's own P), and a request stamped by any of them must make P a no-op for all of
 * them until it settles; two private trackers let Esc-then-P send a second toggle. Module state on
 * purpose: the overlay outlives the scene and shares no object with it, and there is only ever one
 * pausable room on the page. Every read settles it, so a landed or expired stamp is dropped the
 * first time anyone asks.
 */
let sharedRequestAtMs: number | null = null;

/** Record that a pause message was just SENT — only then, never for a P that sent nothing. */
export function markPauseRequested(nowMs: number): void {
  sharedRequestAtMs = nowMs;
}

/** Is the page's pause request still in flight? Settles the shared stamp as it answers. */
export function isPauseInFlight(paused: boolean, nowMs: number): boolean {
  sharedRequestAtMs = settlePauseRequest(sharedRequestAtMs, paused, nowMs);
  return sharedRequestAtMs !== null;
}

/** Forget any request — the match state reset, or the room is gone. */
export function clearPauseRequest(): void {
  sharedRequestAtMs = null;
}
