import { GameMode } from "@motor-combat-moba/shared";
import { button, h, svg } from "../dom.js";
import { modeCards, type LobbySlot, type LobbyView } from "../lobby-view.js";

/**
 * The lobby screen. Two team panels of rows over the dark ground, a host-only settings menu, and the
 * kick / game-mode / start-confirmation modals.
 *
 * Re-rendered wholesale whenever the room's lobby signature changes, so nothing in here holds state
 * except the menu flags the caller owns and passes back in.
 */

/** Variant D from `Host icon options.dc.html` — the filled wheel with cut-outs the main design uses. */
const HOST_WHEEL =
  '<path d="M12 1.5A10.5 10.5 0 1 0 12 22.5 10.5 10.5 0 0 0 12 1.5Zm0 3.1a7.4 7.4 0 0 1 7.1 5.3H14.9a3.1 3.1 0 0 0-5.8 0H4.9A7.4 7.4 0 0 1 12 4.6ZM5.2 13h4.2a3.1 3.1 0 0 0 1.1 1.5v4.8A7.4 7.4 0 0 1 5.2 13Zm8.3 6.3v-4.8A3.1 3.1 0 0 0 14.6 13h4.2a7.4 7.4 0 0 1-5.3 6.3Z"></path>';

const HAMBURGER =
  '<line x1="4" x2="20" y1="6" y2="6"></line><line x1="4" x2="20" y1="12" y2="12"></line><line x1="4" x2="20" y1="18" y2="18"></line>';

const SWAP_ARROWS =
  '<path d="m16 3 4 4-4 4"></path><path d="M20 7H4"></path><path d="m8 21-4-4 4-4"></path><path d="M4 17h16"></path>';

/** The chamfered corner every team panel and stat panel cuts — a small fixed notch, not a percentage,
 * so it reads the same regardless of the panel's size. */
const CUT_TOP_RIGHT = "polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%)";
const CUT_BOTTOM_LEFT = "polygon(0 0, 100% 0, 100% 100%, 16px 100%, 0 calc(100% - 16px))";

export interface LobbyMenus {
  menuOpen: boolean;
  modesOpen: boolean;
  pendingMode: GameMode;
  kickTarget: { sessionId: string; name: string } | null;
  /** Start Match was pressed while not everyone is Ready — confirm before actually starting. */
  confirmStartOpen: boolean;
}

export interface LobbyHandlers {
  onToggleMenu(): void;
  onOpenModes(): void;
  onCloseModes(): void;
  onPickMode(mode: GameMode): void;
  onApplyMode(): void;
  onSwitchTeam(): void;
  onStart(): void;
  onRequestStartConfirm(): void;
  onCancelStartConfirm(): void;
  onConfirmStart(): void;
  onRequestKick(sessionId: string, name: string): void;
  onCancelKick(): void;
  onConfirmKick(): void;
}

function icon(markup: string, size: number, filled: boolean): SVGElement {
  const el = svg(markup);
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("viewBox", "0 0 24 24");
  if (filled) {
    el.setAttribute("fill", "currentColor");
  } else {
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", "currentColor");
    el.setAttribute("stroke-width", "2.75");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
  }
  return el;
}

function slotRow(slot: LobbySlot, handlers: LobbyHandlers): HTMLElement {
  const border = slot.filled
    ? `border: 1px solid ${slot.isYou ? "var(--color-accent)" : "transparent"};`
    : "border: 1px dashed var(--color-neutral-400);";
  const background = slot.filled ? "var(--color-bg)" : "transparent";
  const nameColor = slot.filled ? "var(--color-text)" : "var(--color-neutral-600)";

  return h(
    "div",
    {
      style:
        `display: flex; align-items: center; gap: 14px; min-height: 52px; padding: 6px 16px; ` +
        `border-radius: 4px; background: ${background}; ${border}`,
    },
    [
      h(
        "div",
        {
          style:
            `width: 28px; height: 28px; flex: none; border-radius: 50%; background: ${slot.hex}; ` +
            `display: grid; place-items: center; color: var(--color-bg);`,
        },
        [slot.isHostRow ? icon(HOST_WHEEL, 15, true) : null],
      ),
      h("div", { style: "min-width: 0; flex: 1;" }, [
        h("div", { style: `font-size: 14px; font-weight: 600; color: ${nameColor};` }, [slot.name]),
      ]),
      h("div", { style: "width: 64px; flex: none; display: flex; justify-content: flex-start;" }, [
        slot.canKick
          ? button({ class: "btn btn-secondary", style: "font-size: 11px; min-height: 24px; padding: 0 12px;" }, ["Kick"], () =>
              handlers.onRequestKick(slot.sessionId, slot.name),
            )
          : null,
      ]),
      h("div", { style: "width: 96px; flex: none; display: flex; justify-content: flex-end;" }, [
        slot.filled
          ? h(
              "span",
              {
                class: "tag",
                style: `background: ${slot.status.bg}; color: ${slot.status.fg}; white-space: nowrap;`,
              },
              [slot.status.label],
            )
          : null,
      ]),
    ],
  );
}

/**
 * One column of seats, chamfered on its outer top corner (left column) or outer bottom corner (right
 * column) — a small deliberate flourish, not applied to every panel in the app. `showHeading` is false
 * in Brawl, where the columns are seating rather than sides — the heading row is dropped whole rather
 * than blanked, so the panel loses its offset with it instead of opening a gap where a title used to
 * be. Same shape as `reveal.ts`'s panel.
 */
function teamPanel(
  title: string,
  count: string,
  slots: LobbySlot[],
  handlers: LobbyHandlers,
  showHeading: boolean,
  cut: string,
): HTMLElement {
  return h(
    "div",
    { style: `background: var(--color-surface); border: 1px solid var(--color-divider); clip-path: ${cut}; padding: 20px 22px;` },
    [
      showHeading
        ? h("div", { style: "display: flex; align-items: center; gap: 10px; margin-bottom: 14px;" }, [
            h("h4", { style: "margin: 0; font-size: 18px;" }, [title]),
            h("span", { style: "font-size: 12px; color: var(--color-neutral-600);" }, [count]),
          ])
        : null,
      h(
        "div",
        { style: "display: flex; flex-direction: column; gap: 8px;" },
        slots.map((slot) => slotRow(slot, handlers)),
      ),
    ],
  );
}

function modesModal(_view: LobbyView, menus: LobbyMenus, handlers: LobbyHandlers): HTMLElement {
  const cards = modeCards();
  const selected = cards.find((m) => m.id === menus.pendingMode);
  return backdrop(10, [
    h("div", { style: "width: 760px; padding: 30px 32px 26px; background: var(--color-surface); border: 1px solid var(--color-divider); border-radius: 4px; box-shadow: var(--shadow-lg);" }, [
      h("div", { style: "display: flex; align-items: baseline; gap: 12px;" }, [
        h("h3", { style: "margin: 0; font-size: 26px;" }, ["Game modes"]),
        h("div", { style: "font-size: 13px; color: var(--color-neutral-700);" }, [
          "Pick a mode, then apply it to the lobby.",
        ]),
        button({ class: "btn btn-ghost", style: "margin-left: auto; font-size: 14px;" }, ["Close"], handlers.onCloseModes),
      ]),
      h(
        "div",
        // One column per published mode. Was a hard `1fr 1fr 1fr` when all three shipped visible,
        // which left an empty third column (or a lone half-width card) the moment a row flipped
        // `isActive`. The count is `modeCards()`, so hiding a mode also reflows the grid.
        { style: `display: grid; grid-template-columns: repeat(${cards.length}, 1fr); gap: 18px; margin-top: 22px;` },
        cards.map((mode) => {
          const active = mode.id === menus.pendingMode;
          const card = h(
            "div",
            {
              style:
                `cursor: pointer; padding: 22px; border-radius: 4px; background: var(--color-bg); ` +
                `border: 1px solid ${active ? "var(--color-accent)" : "var(--color-divider)"}; ` +
                `box-shadow: ${active ? "var(--shadow-md)" : "none"};`,
            },
            [
              h("div", { style: "display: flex; align-items: center; gap: 10px;" }, [
                h("div", {
                  style: `width: 14px; height: 14px; border-radius: 50%; background: ${active ? "var(--color-accent)" : "var(--color-neutral-400)"};`,
                }),
                h("div", { style: "font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-accent);" }, [mode.kicker]),
              ]),
              h("div", { style: "font-family: var(--font-heading); font-size: 24px; text-transform: uppercase; margin-top: 10px;" }, [mode.name]),
              h("p", { style: "font-size: 14px; margin: 8px 0 0; color: var(--color-neutral-800);" }, [mode.body]),
              h("div", { style: "display: flex; gap: 8px; margin-top: 16px;" }, [
                h("span", { class: "tag tag-neutral" }, [mode.metaA]),
                h("span", { class: "tag tag-neutral" }, [mode.metaB]),
              ]),
            ],
          );
          card.addEventListener("click", () => handlers.onPickMode(mode.id));
          return card;
        }),
      ),
      h("div", { style: "display: flex; align-items: center; gap: 12px; margin-top: 24px;" }, [
        h("div", { style: "font-size: 13px; color: var(--color-neutral-700);" }, [
          selected ? `Selected: ${selected.name}` : "Pick a mode",
        ]),
        h("div", { style: "margin-left: auto; display: flex; gap: 10px;" }, [
          button({ class: "btn btn-secondary", style: "min-height: 42px;" }, ["Cancel"], handlers.onCloseModes),
          button({ class: "btn btn-primary", style: "min-height: 42px; padding-inline: 28px;" }, ["Apply"], handlers.onApplyMode),
        ]),
      ]),
    ]),
  ]);
}

function kickModal(menus: LobbyMenus, handlers: LobbyHandlers): HTMLElement {
  const name = menus.kickTarget?.name ?? "";
  return backdrop(12, [
    h("div", { style: "width: 460px; padding: 28px 30px 24px; background: var(--color-surface); border: 1px solid var(--color-divider); border-radius: 4px; box-shadow: var(--shadow-lg);" }, [
      h("h3", { style: "margin: 0; font-size: 24px;" }, ["Kick player"]),
      h("p", { style: "font-size: 15px; margin: 10px 0 0; color: var(--color-neutral-800);" }, [
        `Remove ${name} from the lobby? They will be sent back to the join screen and can rejoin while the lobby is open.`,
      ]),
      h("div", { style: "display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px;" }, [
        button({ class: "btn btn-secondary", style: "min-height: 42px;" }, ["Cancel"], handlers.onCancelKick),
        button({ class: "btn btn-primary", style: "min-height: 42px; padding-inline: 26px;" }, [`Kick ${name}`], handlers.onConfirmKick),
      ]),
    ]),
  ]);
}

/** Start Match was pressed while not everyone is Ready (spec: confirm before starting anyway). */
function startConfirmModal(handlers: LobbyHandlers): HTMLElement {
  return backdrop(12, [
    h("div", { style: "width: 460px; padding: 28px 30px 26px; background: var(--color-surface); border: 1px solid var(--color-divider); border-radius: 4px; box-shadow: var(--shadow-lg);" }, [
      h("h3", { style: "margin: 0; font-size: 24px;" }, ["Start match?"]),
      h("p", { style: "font-size: 15px; line-height: 1.5; margin: 14px 0 0; color: var(--color-neutral-800);" }, [
        "Some players are not ready. Are you sure you want to start a match?",
      ]),
      h("div", { style: "display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px;" }, [
        button({ class: "btn btn-secondary", style: "min-height: 42px;" }, ["No"], handlers.onCancelStartConfirm),
        button({ class: "btn btn-primary", style: "min-height: 42px; padding-inline: 26px;" }, ["Yes"], handlers.onConfirmStart),
      ]),
    ]),
  ]);
}

function backdrop(z: number, children: HTMLElement[]): HTMLElement {
  return h(
    "div",
    {
      style:
        `position: absolute; inset: 0; z-index: ${z}; display: grid; place-items: center; padding: 40px; ` +
        `background: color-mix(in srgb, var(--color-bg) 72%, transparent);`,
    },
    children,
  );
}

export function renderLobby(
  view: LobbyView,
  menus: LobbyMenus,
  handlers: LobbyHandlers,
): HTMLElement {
  const settings = h("div", { style: "margin-left: auto; display: flex; align-items: center; gap: 10px; position: relative;" }, [
    button({ class: "btn btn-secondary btn-icon", style: "width: 44px; height: 44px;", "aria-label": "Settings" }, [icon(HAMBURGER, 20, false)], handlers.onToggleMenu),
    menus.menuOpen
      ? h("div", { style: "position: absolute; top: 52px; right: 0; z-index: 5; width: 214px; padding: 8px; background: var(--color-surface); border: 1px solid var(--color-divider); border-radius: 6px; box-shadow: var(--shadow-lg);" }, [
          button({ class: "btn", style: "width: 100%; justify-content: flex-start; font-size: 14px; padding: 10px 14px;" }, ["Game modes"], handlers.onOpenModes),
        ])
      : null,
  ]);

  const switchButton = button(
    {
      class: "btn btn-secondary btn-icon",
      style: "width: 44px; height: 44px; background: var(--color-surface); border-color: var(--color-divider);",
      "aria-label": "Switch team",
      title: view.canSwitchTeam ? "Switch team" : "The other team is full",
      disabled: !view.canSwitchTeam,
    },
    [icon(SWAP_ARROWS, 20, false)],
    handlers.onSwitchTeam,
  );

  const startClick = (): void => {
    if (view.allReady) handlers.onStart();
    else handlers.onRequestStartConfirm();
  };

  return h("div", { style: "position: absolute; inset: 0;" }, [
    h("div", { style: "position: absolute; inset: 0; display: flex; flex-direction: column; padding: 40px 56px;" }, [
      h("div", { style: "display: flex; align-items: flex-start;" }, [
        h("div", {}, [
          h("h2", { style: "margin: 0; font-size: 34px;" }, [`Mode — ${view.modeLabel}`]),
          h("div", { style: "display: flex; align-items: center; gap: 10px; margin-top: 12px;" }, [
            h("span", { class: "tag tag-neutral" }, [view.countLabel]),
            view.isHost ? h("span", { class: "tag tag-outline host-pulse" }, ["You are host"]) : null,
          ]),
        ]),
        view.isHost && view.canChangeMode ? settings : null,
      ]),
      h("div", { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 26px;" }, [
        teamPanel("Team A", view.teamACount, view.teamA, handlers, view.showTeamHeadings, CUT_TOP_RIGHT),
        teamPanel("Team B", view.teamBCount, view.teamB, handlers, view.showTeamHeadings, CUT_BOTTOM_LEFT),
      ]),
      h("div", { style: "display: flex; justify-content: center; margin-top: 14px;" }, [switchButton]),
      h("div", { style: "flex: 1; min-height: 0;" }),
      h("div", { style: "display: flex; align-items: center; gap: 12px;" }, [
        view.startError
          ? h("div", { style: "font-size: 14px; color: var(--color-accent);" }, [view.startError])
          : null,
        h("div", { style: "margin-left: auto; display: flex; align-items: center; gap: 12px;" }, [
          view.isHost
            ? button({ class: "btn btn-primary", style: "min-height: 52px; font-size: 16px; padding-inline: 34px;" }, ["Start Match"], startClick)
            : h("div", { style: "min-height: 52px; display: flex; align-items: center; padding: 0 26px; border-radius: 6px; background: var(--color-accent-2-200); color: var(--color-accent-2-800); font-size: 14px;" }, ["Waiting for host to start"]),
        ]),
      ]),
    ]),
    menus.modesOpen && view.canChangeMode ? modesModal(view, menus, handlers) : null,
    menus.kickTarget ? kickModal(menus, handlers) : null,
    menus.confirmStartOpen ? startConfirmModal(handlers) : null,
  ]);
}
