/**
 * How the game reaches the screen. The logical size never changes: the Scale Manager `FIT`s it into
 * the window with letterbox bars, so every player sees the same world window whatever their
 * monitor's shape — a wider window earns black bars, never more arena.
 */

/**
 * The camera's window onto the world, and the size `ARENA_01` is authored to.
 *
 * This is the number that decides how much arena anyone can see, so it is deliberately NOT the
 * canvas width: growing the canvas to make room for HUD must never quietly hand players a wider
 * view of the floor than the arena they are standing in. `fitsViewport` reads this one.
 */
export const ARENA_VIEW_WIDTH = 1280;

/**
 * The column down the right of the canvas that the arena camera never draws into, where the weapon
 * slots live. Sized to the widest thing it has to hold on one line — a 64px slot circle, the gap,
 * and the longest key label ("space") in its pill beside it — plus 6px either side. Every pixel of
 * it is width the whole picture loses to `FIT` on a 16:9 monitor (1424 wide scales to 90% of what
 * 1280 did), which is why it tracks the labels rather than being rounded up to a comfortable 160.
 *
 * Widened from 128 when the key label gained a pill: `SLOT_KEY_COLUMN_PX` grew by the pill's
 * horizontal padding, and the gutter has to grow with it or the pill spills past the canvas edge.
 * `weapon-hud.test.ts` asserts exactly that, so this number and that one move together.
 *
 * The slots sat over the floor before this existed, and cars drove under them.
 */
export const HUD_GUTTER_WIDTH = 144;

/**
 * The logical size every scene is laid out against. Named rather than repeated as a literal because
 * three places now depend on it agreeing: the Phaser game config, `ScreenOverlay` (which centres
 * every menu on it), and the weapon slot column.
 */
export const VIEW_WIDTH = ARENA_VIEW_WIDTH + HUD_GUTTER_WIDTH;
export const VIEW_HEIGHT = 720;

/** Toggles browser fullscreen. A key, not automatic: browsers only grant fullscreen on a gesture. */
export const FULLSCREEN_KEY = "f";

/** The slice of a `KeyboardEvent` the toggle reads, so the decision is testable without a DOM. */
export interface KeyPress {
  readonly key: string;
  readonly repeat: boolean;
  readonly target: { readonly tagName: string } | null;
}

const TEXT_FIELD_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA"]);

/**
 * Whether a key press should toggle fullscreen. Case-insensitive so Caps Lock does not disarm it;
 * held-key repeats are dropped so one long press cannot flicker in and out; and presses that land in
 * a text field are ignored, or typing a name containing the letter would throw the page fullscreen.
 */
export function isFullscreenToggle(press: KeyPress): boolean {
  if (press.repeat) return false;
  if (press.key.toLowerCase() !== FULLSCREEN_KEY) return false;
  if (press.target && TEXT_FIELD_TAGS.has(press.target.tagName)) return false;
  return true;
}

/** Wire the toggle to a window. Returns the unbind, in the same shape the scenes use for room hooks. */
export function bindFullscreenToggle(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  scale: { toggleFullscreen(): void },
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isFullscreenToggle({ key: event.key, repeat: event.repeat, target: event.target as HTMLElement | null }))
      scale.toggleFullscreen();
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
