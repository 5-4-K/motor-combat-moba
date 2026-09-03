import { button, h } from "../dom.js";

export interface PauseHandlers {
  onResume(): void;
  onExit(): void;
}

/**
 * The practice pause menu (spec PR22, PR23). Two actions only: Resume, and Exit back to the
 * settings screen.
 *
 * `ArenaScene` mounts this off `state.paused` turning true, never optimistically on the keypress —
 * the alternative shows this menu while the sim is still running underneath, which means the player
 * is being shot at by a bot they cannot see.
 */
export function renderPause(handlers: PauseHandlers): { root: HTMLElement } {
  const root = h(
    "div",
    { class: "dialog-backdrop", style: "position: absolute; pointer-events: auto;" },
    [
      h("div", { class: "dialog" }, [
        h("div", { class: "dialog-title" }, ["Paused"]),
        h("div", { class: "dialog-actions" }, [
          button({ class: "btn btn-primary" }, ["Resume"], handlers.onResume),
          button({ class: "btn btn-secondary" }, ["Exit"], handlers.onExit),
        ]),
      ]),
    ],
  );
  return { root };
}
