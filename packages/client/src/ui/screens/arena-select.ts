import { button, h } from "../dom.js";
import type { ArenaCard } from "../arena-cards.js";
import type { ArenaSelectCardView, ArenaSelectView } from "../arena-select-view.js";

/**
 * The arena select screen (AR28-AR36): a centred grid of up to three cards a row, the host's clock,
 * Select / Select random, and the reveal. Draws `ArenaCard`s only — it knows nothing about arenas.
 */
export interface ArenaSelectHandlers {
  onHighlight(arenaId: string): void;
  onSelect(): void;
  onRandom(): void;
}

/** ≈340 px at 1280 × 720 (AR29); three of these plus two gaps fit the overlay's width. */
const CARD_WIDTH = 340;
const GAP = 22;
const CHOSEN_WIDTH = 560;

function preview(card: ArenaCard, width: string): HTMLElement {
  // AR30: the same 16:9 well with or without art, so a card never changes height for lack of it.
  const style = `width: ${width}; aspect-ratio: 16 / 9; background: var(--color-neutral-200); display: block; object-fit: cover;`;
  return card.previewUrl
    ? h("img", { src: card.previewUrl, alt: "", style })
    : h("div", { "aria-hidden": "true", style });
}

function cardEl(card: ArenaSelectCardView, view: ArenaSelectView, onClick: () => void): HTMLElement {
  const dismissed = view.stage === "revealed" && view.chosen?.id !== card.id;
  const el = h(
    "div",
    {
      class: dismissed ? "mc-arena-dismissed" : undefined,
      "data-arena-id": card.id,
      style:
        `width: ${CARD_WIDTH}px; border-radius: 4px; overflow: hidden; background: var(--color-surface); ` +
        `border: 2px solid ${card.highlighted ? "var(--color-accent)" : "var(--color-neutral-300)"}; ` +
        `cursor: ${view.canAct ? "pointer" : "default"};`,
    },
    [
      preview(card, "100%"),
      h("div", { style: "padding: 10px 14px; font-family: var(--font-heading); font-size: 20px; text-transform: uppercase; letter-spacing: 0.04em;" }, [card.name]),
    ],
  );
  if (view.canAct) el.addEventListener("click", onClick);
  return el;
}

function revealStage(view: ArenaSelectView): HTMLElement | null {
  if (view.stage !== "revealed" || !view.chosen) return null;
  return h(
    "div",
    {
      class: "mc-arena-stage",
      style:
        "position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; " +
        "background: color-mix(in srgb, var(--color-bg) 86%, transparent);",
    },
    [
      h("div", { style: "font-size: 13px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--color-accent-700); margin-bottom: 16px;" }, ["Arena selected"]),
      h("div", { class: "mc-arena-chosen", style: "border: 2px solid var(--color-accent); border-radius: 4px; overflow: hidden; background: var(--color-surface); box-shadow: var(--shadow-lg);" }, [
        preview(view.chosen, `${CHOSEN_WIDTH}px`),
        h("div", { style: "padding: 14px 18px; text-align: center; font-family: var(--font-heading); font-size: 34px; text-transform: uppercase; letter-spacing: 0.05em;" }, [view.chosen.name]),
      ]),
      h("div", { "data-reveal-count": "", style: "margin-top: 16px; font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-neutral-700);" }, [view.revealLabel]),
    ],
  );
}

export function renderArenaSelect(view: ArenaSelectView, handlers: ArenaSelectHandlers): HTMLElement {
  return h("div", { style: "position: absolute; inset: 0; display: flex; flex-direction: column; padding: 30px 40px 34px;" }, [
    h("div", { style: "display: flex; align-items: flex-end; gap: 14px;" }, [
      h("h2", { style: "margin: 0; font-size: 36px; line-height: 1;" }, ["Choose the arena"]),
      h("span", { class: "tag tag-accent", style: "position: relative; bottom: 3px;" }, [view.modeLabel]),
      view.showClock && h("div", { style: "margin-left: auto; display: flex; align-items: baseline; gap: 8px;" }, [
        h("div", { style: "font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-neutral-600);" }, ["Picks in"]),
        h("div", { style: `font-family: var(--font-heading); font-size: 34px; color: ${view.urgent ? "var(--color-accent)" : "var(--color-text)"};` }, [view.clock]),
      ]),
    ]),
    // AR29: wrap at three, centred both ways in whatever space the header and footer leave.
    h("div", { style: "flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;" }, [
      h(
        "div",
        { style: `display: flex; flex-wrap: wrap; justify-content: center; gap: ${GAP}px; max-width: ${3 * CARD_WIDTH + 2 * GAP + 8}px;` },
        view.cards.map((card) => cardEl(card, view, () => handlers.onHighlight(card.id))),
      ),
    ]),
    h("div", { style: "display: flex; align-items: center; gap: 12px; padding-top: 20px;" }, [
      h("div", { style: "font-size: 14px; color: var(--color-neutral-700);" }, [view.status]),
      button(
        { class: "btn btn-secondary", style: "margin-left: auto; min-height: 48px; font-size: 18px; padding-inline: 26px;", disabled: !view.canAct },
        ["Select random"],
        handlers.onRandom,
      ),
      button(
        { class: "btn btn-primary", style: "min-height: 48px; font-size: 18px; padding-inline: 30px;", disabled: !view.canAct },
        ["Select"],
        handlers.onSelect,
      ),
    ]),
    revealStage(view),
  ]);
}
