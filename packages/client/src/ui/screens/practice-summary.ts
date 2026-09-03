import { COLOR_TABLE } from "@motor-combat-moba/shared";
import { button, h } from "../dom.js";

/**
 * The practice session summary (spec PR24).
 *
 * `resultsView()` is NOT reused and NOT modified: a practice session has no winner, no match length
 * and no ranking, and teaching the match's results view about a mode that never ends is the same
 * mistake as reusing `ResultsScene` itself — which would run `bindViewRouter`, route on a `phase`
 * this room pins to MATCH forever, and bounce straight back into the arena.
 *
 * The ROW rendering is shared with `ui/screens/results.ts` in spirit — same swatch-plus-car-thumbnail
 * markup and the same `.table`/`.tag`/`.btn` classes — so the two screens read as one design, but
 * built fresh here rather than by importing `results.ts`'s unexported `statTable`.
 */

const FALLBACK_HEX = "#888888";
const FALLBACK_CAR = "mirage";

export interface PracticeSummaryPlayer {
  sessionId: string;
  name: string;
  carId: string;
  colorId: number;
  kills: number;
  deaths: number;
}

export interface PracticeSummaryRow {
  name: string;
  carId: string;
  colorId: number;
  kills: number;
  deaths: number;
  isYou: boolean;
}

/**
 * The human first, then the bot. Two rows, so this is an ordering rule rather than a sort — but
 * `.sort` reads correctly for exactly two rows and needs no special-casing if a future practice mode
 * ever seats more than one bot.
 */
export function practiceSummaryRows(
  players: readonly PracticeSummaryPlayer[],
  humanSessionId: string,
): PracticeSummaryRow[] {
  return players
    .map((p) => ({
      name: p.name,
      carId: p.carId,
      colorId: p.colorId,
      kills: p.kills,
      deaths: p.deaths,
      isYou: p.sessionId === humanSessionId,
    }))
    .sort((a, b) => Number(b.isYou) - Number(a.isYou));
}

function summaryTable(rows: readonly PracticeSummaryRow[]): HTMLElement {
  return h("div", { style: "background: var(--color-surface); border-radius: 32px; padding: 20px 24px 12px;" }, [
    h("table", { class: "table" }, [
      h("thead", {}, [
        h("tr", {}, [
          h("th", {}, ["Player"]),
          h("th", { style: "width: 48px;" }, ["K"]),
          h("th", { style: "width: 48px;" }, ["D"]),
        ]),
      ]),
      h(
        "tbody",
        {},
        rows.map((row) =>
          h("tr", {}, [
            h("td", { style: "padding-block: 14px;" }, [
              h("div", { style: "display: flex; align-items: center; gap: 14px;" }, [
                h("div", {
                  style: `width: 20px; height: 20px; flex: none; border-radius: 50%; background: ${COLOR_TABLE[row.colorId]?.hex ?? FALLBACK_HEX};`,
                }),
                h("div", { style: "width: 62px; height: 44px; flex: none; border-radius: 14px; background: var(--color-bg); display: grid; place-items: center; overflow: hidden;" }, [
                  h("div", {
                    role: "img",
                    "aria-label": "Car",
                    style: `width: 54px; height: 38px; background-image: url("art/cars/${row.carId || FALLBACK_CAR}.png"); background-size: contain; background-position: center; background-repeat: no-repeat;`,
                  }),
                ]),
                h("span", {
                  style: `font-weight: 700; font-size: 16px; color: ${row.isYou ? "var(--color-accent-700)" : "var(--color-text)"}; display: inline-flex; align-items: center; gap: 8px;`,
                }, [row.name, row.isYou ? h("span", { class: "tag tag-accent" }, ["You"]) : null]),
              ]),
            ]),
            h("td", { style: "padding-block: 14px; font-size: 16px;" }, [String(row.kills)]),
            h("td", { style: "padding-block: 14px; font-size: 16px;" }, [String(row.deaths)]),
          ]),
        ),
      ),
    ]),
  ]);
}

export function renderPracticeSummary(
  rows: readonly PracticeSummaryRow[],
  handlers: { onBack(): void },
): { root: HTMLElement } {
  const root = h("div", { style: "position: absolute; inset: 0; display: flex; flex-direction: column; padding: 34px 40px 34px;" }, [
    h("div", {}, [
      h("div", { style: "font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-accent-700);" }, ["Practice"]),
      h("h2", { style: "margin: 4px 0 0; font-size: 46px; line-height: 1;" }, ["Session summary"]),
    ]),
    h("div", { style: "margin-top: 26px; max-width: 520px;" }, [summaryTable(rows)]),
    h("div", { style: "margin-top: auto; display: flex; align-items: center; gap: 12px;" }, [
      button(
        { class: "btn btn-primary", style: "margin-left: auto; min-height: 48px; font-size: 18px; padding-inline: 34px;" },
        ["Back to practice settings"],
        handlers.onBack,
      ),
    ]),
  ]);

  return { root };
}
