/**
 * Pointer lock as a pure reducer (spec TR31). `ArenaScene` feeds it DOM events and reads back
 * whether the lock is held, the buttons it may fire with, and whether to open the menu. The
 * crosshair itself is not here: since TR56 it is a world offset from the car
 * (`input/aim-offset.ts`), which the scene moves only while `locked`.
 *
 * - A lock needs a user gesture, so the first click on the canvas asks for it — and that click never
 *   fires: every button down when the lock arrives is swallowed until it is released.
 * - Losing the lock unasked (the browser's Esc, alt-tab, focus loss) opens the menu; a release the
 *   game asked for (`release`, e.g. the menu opening) does not.
 */
export interface LockState {
  locked: boolean;
  /** Mouse buttons held when the lock arrived; ignored until released. */
  swallow: number;
  /** The game asked for the lock to go; the next `lost` is expected. */
  releasing: boolean;
}

export type LockEvent =
  | { type: "acquired"; buttons: number }
  | { type: "lost" }
  | { type: "release" }
  | { type: "buttons"; buttons: number };

export function initialLock(): LockState {
  return { locked: false, swallow: 0, releasing: false };
}

export function reduceLock(s: LockState, e: LockEvent): { state: LockState; openMenu: boolean } {
  switch (e.type) {
    case "acquired":
      return { state: { ...s, locked: true, swallow: e.buttons, releasing: false }, openMenu: false };
    case "release":
      return { state: { ...s, releasing: true }, openMenu: false };
    case "lost":
      return { state: { ...s, locked: false, swallow: 0, releasing: false }, openMenu: s.locked && !s.releasing };
    case "buttons":
      return { state: { ...s, swallow: s.swallow & e.buttons }, openMenu: false };
  }
}

/**
 * Mouse buttons that may fire, and never a swallowed one.
 *
 * `usesLock` is the whole of the turret-less case. A car that aims a turret holds the lock to do it,
 * so an unlocked pointer means the cursor is loose on the page and a click there is not a shot — the
 * original rule. A car with NO turret weapon never asks for the lock at all (`wantsPointerLock`), so
 * that rule would leave LMB and RMB dead for a car whose only aiming is its own heading. Pass
 * `false` there and the buttons read straight through, which is exactly how mouse fire worked before
 * the turret existed: click anywhere, the shot leaves the fixed muzzle it was always going to leave.
 *
 * `swallow` is still honoured either way, and is always 0 on the unlocked path — only `acquired`
 * ever sets it, and a car that never locks never acquires.
 */
export function fireButtons(s: LockState, buttons: number, usesLock = true): number {
  return s.locked || !usesLock ? buttons & ~s.swallow : 0;
}

/**
 * Should a canvas click ask the browser for the lock (final-fixes item 1)? `menuOpen` alone is not
 * enough: practice and the playground read it off `state.paused`, which stays false for a whole
 * round trip after a pause has been requested — a click in that window would otherwise re-lock the
 * cursor just before the menu mounts under it, invisible. `pauseRequested` closes that window: the
 * caller sets it the moment it asks the server to pause and clears it once the patch lands.
 */
export function shouldRequestLock(
  locked: boolean,
  menuOpen: boolean,
  pauseRequested: boolean,
  wantsLock = true,
): boolean {
  return wantsLock && !locked && !menuOpen && !pauseRequested;
}

/**
 * Should a held lock be given up right now? A per-frame safety net for any room kind: if a menu is
 * considered open while the cursor is still locked, the lock has no business being held.
 *
 * `wantsLock` false is the second way to have no business holding it: the driven car has no turret
 * weapon, so there is nothing to aim. It is checked every frame rather than only at the request
 * sites because a loadout can change under a held lock — the playground swaps one live — and a lock
 * that was legitimate when it was taken must not outlive the turret that justified it.
 */
export function shouldReleaseLock(locked: boolean, menuOpen: boolean, wantsLock = true): boolean {
  return locked && (menuOpen || !wantsLock);
}

/** Keys that must never trigger the first-keypress auto-lock (TR31a): Escape is what closes the
 * lock/opens the menu, and P is the menu toggle in every room kind — neither should relock the
 * cursor as a side effect of the very key that is trying to get the menu open. */
const AUTO_LOCK_EXCLUDED_KEYS = new Set(["Escape", "p", "P"]);

/**
 * Should a keydown ask the browser for the lock (TR31a, the auto-lock follow-up)? A keydown is a
 * user gesture just like a click, so the very first driving key pressed after a match starts (or
 * after a menu closes with no gesture-capable relock) can re-acquire the lock without making the
 * player click first. Same three gates as `shouldRequestLock`, plus Escape/P are never the key that
 * does it — they have their own jobs (closing to the menu, toggling it) and must not fight a relock.
 */
export function shouldAutoLockOnKey(
  locked: boolean,
  menuOpen: boolean,
  pauseRequested: boolean,
  key: string,
  wantsLock = true,
): boolean {
  return (
    shouldRequestLock(locked, menuOpen, pauseRequested, wantsLock) && !AUTO_LOCK_EXCLUDED_KEYS.has(key)
  );
}

/**
 * Ask the browser for the lock on `canvas`. Current browsers answer with a promise and reject it
 * when they refuse (no gesture, a lock released too recently, an automated browser); older ones
 * return nothing. A refusal only means the next click asks again, so it is logged, not thrown —
 * left unhandled it would surface as an uncaught rejection on every refused click.
 *
 * `quiet` is for the one caller that EXPECTS to be refused often: the scene-start auto-attempt
 * (TR31a) fires before any gesture may exist yet, so a rejection there is the normal case, not a
 * surprise worth a console warning every time a match starts.
 */
export function requestLock(canvas: HTMLCanvasElement, quiet = false): void {
  const pending = canvas.requestPointerLock() as Promise<void> | undefined;
  pending?.catch((error: unknown) => {
    if (!quiet) console.warn(`[input] pointer lock refused: ${String(error)}`);
  });
}
