import { h } from "../dom.js";

/**
 * A full-bleed error card. Deliberately plain: this screen only appears when the build is
 * inconsistent with the server, so it must not depend on anything the mismatch might have broken.
 */
export function renderArenaMismatch(message: string): HTMLElement {
  return h(
    "div",
    {
      style:
        "position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; " +
        "background: var(--color-surface); pointer-events: auto;",
    },
    [
      h(
        "pre",
        {
          style:
            "max-width: 900px; margin: 0; padding: 32px 40px; white-space: pre-wrap; " +
            "font: 500 20px/1.5 var(--font-body, system-ui); color: var(--color-text);",
        },
        [message],
      ),
    ],
  );
}
