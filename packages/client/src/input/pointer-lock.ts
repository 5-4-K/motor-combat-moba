/**
 * Pointer lock as a pure reducer (spec TR31). `ArenaScene` feeds it DOM events and reads back the
 * cursor, the buttons it may fire with, and whether to open the menu.
 *
 * - A lock needs a user gesture, so the first click on the canvas asks for it — and that click never
 *   fires: every button down when the lock arrives is swallowed until it is released.
 * - While locked, the cursor is integrated from movementX/Y and clamped to the canvas.
 * - Losing the lock unasked (the browser's Esc, alt-tab, focus loss) opens the menu; a release the
 *   game asked for (`release`, e.g. the menu opening) does not.
 */
export interface LockState {
  locked: boolean;
  /** Mouse buttons held when the lock arrived; ignored until released. */
  swallow: number;
  /** Virtual cursor, canvas pixels. */
  cursor: { x: number; y: number };
  /** The game asked for the lock to go; the next `lost` is expected. */
  releasing: boolean;
}

export type LockEvent =
  | { type: "acquired"; buttons: number }
  | { type: "lost" }
  | { type: "release" }
  | { type: "move"; dx: number; dy: number; w: number; h: number }
  | { type: "buttons"; buttons: number };

export function initialLock(w: number, h: number): LockState {
  return { locked: false, swallow: 0, cursor: { x: w / 2, y: h / 2 }, releasing: false };
}

export function reduceLock(s: LockState, e: LockEvent): { state: LockState; openMenu: boolean } {
  switch (e.type) {
    case "acquired":
      return { state: { ...s, locked: true, swallow: e.buttons, releasing: false }, openMenu: false };
    case "release":
      return { state: { ...s, releasing: true }, openMenu: false };
    case "lost":
      return { state: { ...s, locked: false, swallow: 0, releasing: false }, openMenu: s.locked && !s.releasing };
    case "move": {
      if (!s.locked) return { state: s, openMenu: false };
      const x = Math.min(e.w, Math.max(0, s.cursor.x + e.dx));
      const y = Math.min(e.h, Math.max(0, s.cursor.y + e.dy));
      return { state: { ...s, cursor: { x, y } }, openMenu: false };
    }
    case "buttons":
      return { state: { ...s, swallow: s.swallow & e.buttons }, openMenu: false };
  }
}

/** Mouse buttons that may fire: none while unlocked, and never a swallowed one. */
export function fireButtons(s: LockState, buttons: number): number {
  return s.locked ? buttons & ~s.swallow : 0;
}

/**
 * Should a canvas click ask the browser for the lock (final-fixes item 1)? `menuOpen` alone is not
 * enough: practice and the playground read it off `state.paused`, which stays false for a whole
 * round trip after a pause has been requested — a click in that window would otherwise re-lock the
 * cursor just before the menu mounts under it, invisible. `pauseRequested` closes that window: the
 * caller sets it the moment it asks the server to pause and clears it once the patch lands.
 */
export function shouldRequestLock(locked: boolean, menuOpen: boolean, pauseRequested: boolean): boolean {
  return !locked && !menuOpen && !pauseRequested;
}

/** Should a held lock be given up right now? A per-frame safety net for any room kind: if a menu is
 * considered open while the cursor is still locked, the lock has no business being held. */
export function shouldReleaseLock(locked: boolean, menuOpen: boolean): boolean {
  return locked && menuOpen;
}

/**
 * Ask the browser for the lock on `canvas`. Current browsers answer with a promise and reject it
 * when they refuse (no gesture, a lock released too recently, an automated browser); older ones
 * return nothing. A refusal only means the next click asks again, so it is logged, not thrown —
 * left unhandled it would surface as an uncaught rejection on every refused click.
 */
export function requestLock(canvas: HTMLCanvasElement): void {
  const pending = canvas.requestPointerLock() as Promise<void> | undefined;
  pending?.catch((error: unknown) => console.warn(`[input] pointer lock refused: ${String(error)}`));
}
