import { button, h } from "../dom.js";

export interface PauseHandlers {
  onResume(): void;
  onExit(): void;
}

/**
 * The in-match menu (spec PR22, PR23, TR38, TR39). Two actions only, Resume and Exit, in two
 * variants:
 *
 * - `"paused"` — the practice pause. `ArenaScene` mounts it off `state.paused` turning true, never
 *   optimistically on the keypress — the alternative shows this menu while the sim is still running
 *   underneath, which means the player is being shot at by a bot they cannot see. Exit goes back to
 *   the settings screen.
 * - `"overlay"` — the arena's menu, which pauses nothing: a multiplayer match keeps running behind
 *   it, so the backdrop is translucent and the match stays visible. The `.dialog` panel keeps its
 *   opaque background, so the title and buttons still read over any arena. Exit leaves the room.
 */
export function renderPause(
  handlers: PauseHandlers,
  variant: "paused" | "overlay" = "paused",
): { root: HTMLElement } {
  const overlay = variant === "overlay";
  const root = h(
    "div",
    {
      class: overlay ? "dialog-backdrop overlay-translucent" : "dialog-backdrop",
      style: "position: absolute; pointer-events: auto;",
    },
    [
      h("div", { class: "dialog" }, [
        h("div", { class: "dialog-title" }, [overlay ? "Menu" : "Paused"]),
        h("div", { class: "dialog-actions" }, [
          button({ class: "btn btn-primary" }, ["Resume"], handlers.onResume),
          button({ class: "btn btn-secondary" }, ["Exit"], handlers.onExit),
        ]),
      ]),
    ],
  );
  return { root };
}
