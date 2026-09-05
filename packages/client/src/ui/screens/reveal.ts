import { h, svg } from "../dom.js";
import type { RevealPanel, RevealView } from "../reveal-view.js";

/**
 * "Cars locked in": the whole grid, read-only, counting itself down to the match.
 *
 * No button. The dwell is server-authoritative — the scene feeds a new view on every patch and this
 * just draws it — so every player leaves for the arena on the same tick.
 */

/** The same filled steering wheel the lobby marks the host with. */
const HOST_WHEEL =
  '<path d="M12 1.5A10.5 10.5 0 1 0 12 22.5 10.5 10.5 0 0 0 12 1.5Zm0 3.1a7.4 7.4 0 0 1 7.1 5.3H14.9a3.1 3.1 0 0 0-5.8 0H4.9A7.4 7.4 0 0 1 12 4.6ZM5.2 13h4.2a3.1 3.1 0 0 0 1.1 1.5v4.8A7.4 7.4 0 0 1 5.2 13Zm8.3 6.3v-4.8A3.1 3.1 0 0 0 14.6 13h4.2a7.4 7.4 0 0 1-5.3 6.3Z"></path>';

function hostBadge(): SVGElement {
  const el = svg(HOST_WHEEL);
  el.setAttribute("width", "22");
  el.setAttribute("height", "22");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("fill", "currentColor");
  return el;
}

function panel(data: RevealPanel, showHeading: boolean): HTMLElement {
  return h("div", { style: "background: var(--color-surface); border: 1px solid var(--color-divider); border-radius: 4px; padding: 20px 22px 24px;" }, [
    showHeading
      ? h("div", { style: "display: flex; align-items: center; gap: 10px; margin-bottom: 14px;" }, [
          h("h4", { style: "margin: 0; font-size: 22px;" }, [data.title]),
          h("span", { style: "font-size: 12px; color: var(--color-neutral-600);" }, [data.count]),
        ])
      : null,
    h(
      "div",
      { style: "display: flex; flex-direction: column; gap: 10px;" },
      data.rows.map((row) =>
        h(
          "div",
          {
            style:
              `display: flex; align-items: center; gap: 18px; min-height: 96px; padding: 10px 20px; border-radius: 4px; ` +
              (row.filled
                ? `background: var(--color-bg); border: 1px solid ${row.isYou ? "var(--color-accent)" : "transparent"};`
                : "background: transparent; border: 1px dashed var(--color-neutral-400);"),
          },
          [
            h(
              "div",
              {
                style:
                  `width: 34px; height: 34px; flex: none; border-radius: 50%; background: ${row.hex}; ` +
                  `display: grid; place-items: center; color: var(--color-bg);`,
              },
              [row.isHostRow ? hostBadge() : null],
            ),
            h("div", {
              style: `flex: 1; min-width: 0; font-size: 19px; font-weight: 600; color: ${row.filled ? "var(--color-text)" : "var(--color-neutral-500)"};`,
            }, [row.name]),
            // Driverless rows get no thumbnail well at all — the design leaves the space empty
            // rather than showing an empty frame.
            row.carImage
              ? h("div", {
                  role: "img",
                  "aria-label": "Car",
                  style: `width: 116px; height: 76px; flex: none; border-radius: 4px; background: var(--color-bg) ${row.carImage} center / 104px 68px no-repeat;`,
                })
              : null,
          ],
        ),
      ),
    ),
  ]);
}

export function renderReveal(view: RevealView): HTMLElement {
  return h("div", { style: "position: absolute; inset: 0; display: flex; flex-direction: column; padding: 30px 40px 34px;" }, [
    h("div", { style: "display: flex; align-items: center; gap: 14px;" }, [
      h("h2", { style: "margin: 0; font-size: 36px;" }, ["Cars locked in"]),
      h("span", { class: "tag tag-accent" }, [view.modeLabel]),
      h("span", { class: "tag tag-neutral" }, [view.countLabel]),
    ]),
    h("div", { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 22px;" }, [
      panel(view.panelA, view.showTeamHeadings),
      panel(view.panelB, view.showTeamHeadings),
    ]),
    h("div", { style: "margin-top: auto; display: flex; align-items: baseline; gap: 8px; padding-top: 20px;" }, [
      h("div", { style: "margin-left: auto; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-neutral-600);" }, [
        "Match starts in",
      ]),
      h("div", {
        style: `font-family: var(--font-heading); font-size: 34px; color: ${view.urgent ? "var(--color-accent)" : "var(--color-text)"};`,
      }, [String(view.secondsLeft)]),
    ]),
  ]);
}
