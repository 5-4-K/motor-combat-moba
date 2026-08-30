import Phaser from "phaser";
import { VIEW_HEIGHT, VIEW_WIDTH } from "../config/display.js";
import "./organic.css";

/**
 * Hosts one menu screen as real DOM over the canvas.
 *
 * The overlay is a single canvas-sized element handed to `scene.add.dom` at the centre of the
 * logical
 * viewport, which puts it inside the container Phaser's Scale Manager already transforms in lockstep
 * with the canvas. Everything about `FIT` scaling, `CENTER_BOTH` and fullscreen therefore comes for
 * free: the overlay letterboxes exactly as the game does, because it is being moved by the same
 * matrix. Sizing it by hand against `window.innerWidth` would be a second, worse implementation of
 * arithmetic Phaser is already doing.
 *
 * `pointer-events` is left to the screen's own children: the root passes clicks through so nothing
 * here can swallow input meant for a scene that is still running underneath.
 */
export const OVERLAY_WIDTH = VIEW_WIDTH;
export const OVERLAY_HEIGHT = VIEW_HEIGHT;

export class ScreenOverlay {
  private dom: Phaser.GameObjects.DOMElement | undefined;
  private root: HTMLDivElement | undefined;

  constructor(private readonly scene: Phaser.Scene) {}

  /** The element screens render into. Created on first use, reused for the scene's lifetime. */
  mount(): HTMLDivElement {
    if (this.root) return this.root;
    const root = document.createElement("div");
    root.className = "mc-ui";
    root.style.width = `${OVERLAY_WIDTH}px`;
    root.style.height = `${OVERLAY_HEIGHT}px`;
    root.style.position = "relative";
    root.style.overflow = "hidden";
    root.style.pointerEvents = "none";
    this.dom = this.scene.add.dom(OVERLAY_WIDTH / 2, OVERLAY_HEIGHT / 2, root);
    this.root = root;
    return root;
  }

  /** Replace the screen's contents. Children opt back into input; the root never captures it. */
  render(...children: Node[]): void {
    const root = this.mount();
    root.replaceChildren(...children);
    for (const child of children) {
      if (child instanceof HTMLElement) child.style.pointerEvents = "auto";
    }
  }

  destroy(): void {
    this.dom?.destroy();
    this.dom = undefined;
    this.root = undefined;
  }
}
