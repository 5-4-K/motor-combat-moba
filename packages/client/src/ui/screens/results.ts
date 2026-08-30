import { button, h } from "../dom.js";
import type { ResultsView, StatRow } from "../results-view.js";

/**
 * The post-match screen: the winner banner over two K/D/A tables, one per team, each row carrying the
 * player's colour swatch and the car they drove.
 */

export interface ResultsHandlers {
  onBackToLobby(): void;
}

function statTable(rows: StatRow[]): HTMLElement {
  return h("div", { style: "background: var(--color-surface); border-radius: 32px; padding: 20px 24px 12px;" }, [
    h("table", { class: "table" }, [
      h("thead", {}, [
        h("tr", {}, [
          h("th", {}, ["Player"]),
          h("th", { style: "width: 48px;" }, ["K"]),
          h("th", { style: "width: 48px;" }, ["D"]),
          h("th", { style: "width: 48px;" }, ["A"]),
        ]),
      ]),
      h(
        "tbody",
        {},
        rows.map((row) =>
          h("tr", {}, [
            h("td", { style: "padding-block: 14px;" }, [
              h("div", { style: "display: flex; align-items: center; gap: 14px;" }, [
                h("div", { style: `width: 20px; height: 20px; flex: none; border-radius: 50%; background: ${row.hex};` }),
                h("div", { style: "width: 62px; height: 44px; flex: none; border-radius: 14px; background: var(--color-bg); display: grid; place-items: center; overflow: hidden;" }, [
                  h("div", {
                    role: "img",
                    "aria-label": "Car",
                    style: `width: 54px; height: 38px; background-image: ${row.carImage}; background-size: contain; background-position: center; background-repeat: no-repeat;`,
                  }),
                ]),
                h("span", {
                  style: `font-weight: 700; font-size: 16px; color: ${row.isYou ? "var(--color-accent-700)" : "var(--color-text)"};`,
                }, [row.name]),
              ]),
            ]),
            h("td", { style: "padding-block: 14px; font-size: 16px;" }, [String(row.k)]),
            h("td", { style: "padding-block: 14px; font-size: 16px;" }, [String(row.d)]),
            h("td", { style: "padding-block: 14px; font-size: 16px;" }, [String(row.a)]),
          ]),
        ),
      ),
    ]),
  ]);
}

export function renderResults(view: ResultsView, handlers: ResultsHandlers): HTMLElement {
  return h("div", { style: "position: absolute; inset: 0; display: flex; flex-direction: column; padding: 34px 40px 34px;" }, [
    h("div", { style: "display: flex; align-items: center; gap: 16px;" }, [
      h("div", {}, [
        h("div", { style: "font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-accent-700);" }, ["Match over"]),
        h("h2", { style: "margin: 4px 0 0; font-size: 46px; line-height: 1;" }, [view.winnerLabel]),
      ]),
      h("span", { class: "tag tag-accent", style: "align-self: flex-end; position: relative; bottom: 6px;" }, [view.modeLabel]),
      h("span", { class: "tag tag-neutral", style: "align-self: flex-end; position: relative; bottom: 6px;" }, [view.durationLabel]),
    ]),
    h("div", { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 26px;" }, [
      statTable(view.statsA),
      statTable(view.statsB),
    ]),
    h("div", { style: "margin-top: auto; display: flex; align-items: center; gap: 12px;" }, [
      button(
        { class: "btn btn-primary", style: "margin-left: auto; min-height: 48px; font-size: 18px; padding-inline: 34px;" },
        ["Back to lobby"],
        handlers.onBackToLobby,
      ),
    ]),
  ]);
}
