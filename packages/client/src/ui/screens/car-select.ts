import type { CarId } from "@motor-combat-moba/shared";
import { button, h, svg } from "../dom.js";
import type { CarBarKey, CarSelectView } from "../car-select-view.js";

/**
 * Car select: three chassis cards against a countdown, with a scrolling full-stats panel.
 *
 * The card shows three summary bars and nothing else — no "taken" pills, because any player may pick
 * any car, including one someone else already has. Clicking is a free preview; "Lock in" commits.
 */

/** Lucide `zap`, `sword`, `shield` at the design system's stroke-width 2.75. */
const BAR_ICONS: Record<CarBarKey, string> = {
  speed: '<path d="M4 14h6v7l10-11h-6V3z"></path>',
  attack:
    '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"></path><path d="m13 19 6-6"></path><path d="m16 16 4 4"></path><path d="m19 21 2-2"></path>',
  hp: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>',
};

const BAR_LABELS: Record<CarBarKey, string> = {
  speed: "Speed",
  attack: "Attack",
  hp: "Bulk",
};

export interface CarSelectHandlers {
  onPick(carId: CarId): void;
  onLockIn(): void;
}

function icon(markup: string, size: number): SVGElement {
  const el = svg(markup);
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", "2.75");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  return el;
}

export function renderCarSelect(view: CarSelectView, handlers: CarSelectHandlers): HTMLElement {
  const cards = view.cars.map((car) => {
    const card = h(
      "div",
      {
        style:
          `cursor: pointer; padding: 18px 20px 20px; border-radius: 4px; background: var(--color-surface); ` +
          `display: flex; flex-direction: column; gap: 14px; ` +
          `border: 1px solid ${car.selected ? "var(--color-accent)" : "var(--color-divider)"}; ` +
          `box-shadow: ${car.selected ? "var(--shadow-md)" : "none"};`,
      },
      [
        h("div", {
          role: "img",
          "aria-label": car.name,
          style:
            `height: 104px; border-radius: 4px; background: var(--color-bg) ${car.image} center / 148px 92px no-repeat;`,
        }),
        h("div", { style: "font-family: var(--font-heading); font-size: 24px;" }, [car.name]),
        h(
          "div",
          { style: "display: flex; flex-direction: column; gap: 10px;" },
          car.bars.map((bar) =>
            h("div", { style: "display: flex; align-items: center; gap: 10px;", title: BAR_LABELS[bar.key] }, [
              h("span", { style: "color: var(--color-neutral-700); display: grid; place-items: center;", "aria-label": BAR_LABELS[bar.key] }, [
                icon(BAR_ICONS[bar.key], 18),
              ]),
              h("div", { style: "flex: 1; height: 8px; border-radius: 999px; background: var(--color-neutral-300); overflow: hidden;" }, [
                h("div", { style: `height: 8px; width: ${bar.percent}%; background: var(--color-accent);` }),
              ]),
            ]),
          ),
        ),
      ],
    );
    card.addEventListener("click", () => handlers.onPick(car.id));
    return card;
  });

  const statsPanel = h(
    "div",
    {
      style:
        "padding: 20px 22px 22px; border-radius: 4px; background: var(--color-surface); " +
        "border: 1px solid var(--color-divider); display: flex; flex-direction: column; min-height: 0;",
    },
    [
      h("div", { style: "font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-accent-700);" }, [
        "Full stats",
      ]),
      h("div", { style: "font-family: var(--font-heading); font-size: 26px; margin-top: 2px;" }, [view.selectedName]),
      h(
        "div",
        { style: "flex: 1; min-height: 0; overflow-y: auto; padding-right: 4px; margin-top: 8px;" },
        view.stats.map((row) =>
          h("div", { style: "display: flex; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--color-neutral-300);" }, [
            h("div", { style: "font-size: 13px; color: var(--color-neutral-700);" }, [row.label]),
            h("div", { style: "margin-left: auto; font-size: 15px; font-weight: 600;" }, [row.value]),
          ]),
        ),
      ),
    ],
  );

  return h("div", { style: "position: absolute; inset: 0; display: flex; flex-direction: column; padding: 30px 40px 34px;" }, [
    h("div", { style: "display: flex; align-items: flex-end; gap: 14px;" }, [
      h("h2", { style: "margin: 0; font-size: 36px; line-height: 1;" }, ["Choose your car"]),
      h("span", { class: "tag tag-accent", style: "position: relative; bottom: 3px;" }, [view.modeLabel]),
      h("div", { style: "margin-left: auto; display: flex; align-items: baseline; gap: 8px;" }, [
        h("div", { style: "font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-neutral-600);" }, [
          "Locks in",
        ]),
        h("div", {
          style: `font-family: var(--font-heading); font-size: 34px; color: ${view.urgent ? "var(--color-accent)" : "var(--color-text)"};`,
        }, [view.clock]),
      ]),
    ]),
    h("div", { style: "display: grid; grid-template-columns: 1fr 1fr 1fr 300px; gap: 18px; margin-top: 24px; min-height: 0;" }, [
      ...cards,
      statsPanel,
    ]),
    // No footer copy: nothing here needs explaining now that the deadline is not a gamble. A player
    // who runs out of time keeps whatever the screen was showing, so there is no penalty to warn about.
    h("div", { style: "margin-top: auto; display: flex; align-items: center; gap: 12px; padding-top: 20px;" }, [
      button(
        {
          class: "btn btn-primary",
          style: "margin-left: auto; min-height: 48px; font-size: 18px; padding-inline: 30px;",
          disabled: !view.canLockIn,
        },
        [view.lockLabel],
        handlers.onLockIn,
      ),
    ]),
  ]);
}
