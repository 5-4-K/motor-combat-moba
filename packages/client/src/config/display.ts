/**
 * How the 1280x720 game reaches the screen. The logical size never changes: the Scale Manager
 * `FIT`s it into the window with letterbox bars, so every player sees the same world window
 * whatever their monitor's shape — a wider window earns black bars, never more arena.
 */

/**
 * The logical size every scene is laid out against, and the size the arena camera sees at zoom 1.
 * Named rather than repeated as a literal because two places now depend on it agreeing: the Phaser
 * game config, and `fitsViewport`, which decides whether the arena camera needs to scroll at all.
 */
export const VIEW_WIDTH = 1280;
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
