import { FLOW_CONFIG } from "@motor-combat-moba/shared";
import { button, h, svg } from "../dom.js";
import { FULLSCREEN_KEY } from "../../config/display.js";
import { FEEDBACK_LABEL, FEEDBACK_URL } from "../../config/feedback.js";
import { MANUAL_LABEL, MANUAL_PATH } from "../../config/manual.js";

/**
 * The join screen: a hero half carrying the banner art and tagline, and a console panel with the one
 * path onward — a name field, then Join Lobby, then Practice as the visually secondary fallback below
 * an "or" divider. The guide/feedback links are reference material, not actions on the same footing as
 * joining a match, so they sit small and quiet at the foot of the hero rather than lined up with the
 * buttons.
 *
 * The error line has no counterpart in the mockup, which only draws the happy path. It stays because
 * "Name is taken" and a refused connection are the two things a player on a LAN actually hits, and a
 * screen that swallows them is a screen you cannot get past.
 */

export interface JoinHandlers {
  onSubmit(name: string): void;
  onPractice(name: string): void;
}

/**
 * The name a practice session runs under (spec PR20).
 *
 * Optional by design: practice rooms are per-player, so the arena's uniqueness rule has no
 * counterpart here, and blocking a solo mode behind a text field is friction with no payoff. A
 * player who typed a name sees it in the HUD exactly as in a match; one who did not sees "Player".
 */
export function practiceName(raw: string): string {
  return raw.trim() || "Player";
}

export interface JoinScreen {
  root: HTMLElement;
  focus(): void;
  setError(message: string): void;
  setBusy(busy: boolean): void;
}

const ARROW_RIGHT = '<path d="M5 12h14M13 6l6 6-6 6"></path>';

function referenceLink(label: string, attrs: Record<string, string>): HTMLAnchorElement {
  return h(
    "a",
    {
      style:
        "font-family: var(--font-heading); font-size: 13px; font-weight: 600; " +
        "letter-spacing: 0.22em; text-transform: uppercase; color: var(--color-neutral-700);",
      ...attrs,
    },
    [label],
  );
}

export function renderJoin(handlers: JoinHandlers): JoinScreen {
  const input = h("input", {
    class: "input",
    id: "pname",
    type: "text",
    maxLength: FLOW_CONFIG.nameMax,
    placeholder: "Name",
    autocomplete: "off",
    spellcheck: false,
    style: "min-height: 54px; font-size: 17px;",
  });

  const submit = (): void => handlers.onSubmit(input.value.trim());
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") submit();
  });

  const joinButton = button(
    {
      class: "btn btn-primary",
      style: "min-height: 56px; width: 100%; font-size: 17px; margin-top: 22px; gap: 10px;",
    },
    ["Join Lobby", (() => {
      const icon = svg(ARROW_RIGHT);
      icon.setAttribute("width", "18");
      icon.setAttribute("height", "18");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("stroke-width", "3");
      icon.setAttribute("stroke-linecap", "round");
      icon.setAttribute("stroke-linejoin", "round");
      return icon;
    })()],
    submit,
  );

  /**
   * A solo car-select-vs-bot session, off `practiceName(input.value)` (PR20). `btn-secondary`
   * because Join Lobby is still the primary path onto a LAN game; Practice is the offline fallback
   * below the "or" divider, not a co-equal choice.
   */
  const practiceButton = button(
    {
      class: "btn btn-secondary",
      style: "min-height: 52px; width: 100%; font-size: 15px;",
    },
    ["Practice vs. Bot"],
    () => handlers.onPractice(practiceName(input.value)),
  );

  /**
   * Anchors, not `button`s: middle-click, ctrl-click and "open in new tab" all have to work.
   * `setBusy` deliberately leaves them alone — reading the manual or leaving feedback while a join is
   * in flight is fine.
   */
  const manualLink = referenceLink(MANUAL_LABEL, { href: MANUAL_PATH, target: "_blank", rel: "noopener" });
  const feedbackLink = referenceLink(FEEDBACK_LABEL, {
    href: FEEDBACK_URL,
    target: "_blank",
    rel: "noopener noreferrer",
  });

  const error = h("div", {
    style: "font-size: 14px; min-height: 20px; color: var(--color-accent); max-width: 480px; margin-top: 14px;",
  });

  const root = h(
    "div",
    { style: "position: absolute; inset: 0; display: flex;" },
    [
      // hero
      h(
        "div",
        { style: "flex: 1; position: relative; padding: 64px 72px; display: flex; flex-direction: column; justify-content: center; overflow: hidden;" },
        [
          h("div", {
            style:
              "position: absolute; left: -120px; bottom: -160px; width: 640px; height: 640px; border-radius: 50%; " +
              "background: radial-gradient(circle, color-mix(in srgb, var(--color-accent) 28%, transparent) 0%, " +
              "color-mix(in srgb, var(--color-accent) 8%, transparent) 45%, transparent 72%); pointer-events: none;",
          }),
          h("img", {
            src: "art/ui/banner.jpg",
            alt: "Motor Combat",
            style: "position: relative; display: block; width: min(620px, 100%); height: auto; border-radius: 4px;",
          }),
          h(
            "p",
            { style: "position: relative; font-size: 21px; line-height: 1.5; max-width: 460px; margin: 26px 0 0; color: var(--color-neutral-800);" },
            ["Top-down car combat arena. Load in, pick a chassis, last one running wins."],
          ),
          h(
            "div",
            { style: "position: relative; margin-top: auto; padding-top: 40px; display: flex; align-items: center; gap: 16px;" },
            [manualLink, h("div", { style: "width: 3px; height: 3px; border-radius: 50%; background: var(--color-neutral-400);" }), feedbackLink],
          ),
        ],
      ),
      // console panel
      h(
        "div",
        {
          style:
            "width: 480px; flex: none; background: var(--color-surface); border-left: 1px solid var(--color-divider); " +
            "padding: 76px 52px; display: flex; flex-direction: column; justify-content: center;",
        },
        [
          h("div", { style: "font-family: var(--font-heading); font-size: 12px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-accent);" }, [
            "Join a match",
          ]),
          h("h2", { style: "font-size: 30px; margin: 6px 0 0;" }, ["Enter the Arena"]),
          h("div", { class: "field", style: "margin-top: 36px;" }, [
            h("label", { for: "pname", style: "font-family: var(--font-heading); font-size: 11px; letter-spacing: 0.1em;" }, ["Callsign"]),
            input,
          ]),
          joinButton,
          h("div", { style: "display: flex; align-items: center; gap: 14px; margin: 22px 0;" }, [
            h("div", { style: "flex: 1; height: 1px; background: var(--color-divider);" }),
            h("div", { style: "font-size: 11px; letter-spacing: 0.12em; color: var(--color-neutral-600);" }, ["OR"]),
            h("div", { style: "flex: 1; height: 1px; background: var(--color-divider);" }),
          ]),
          practiceButton,
          error,
          h("div", { style: "font-size: 12px; color: var(--color-neutral-600); margin-top: 26px;" }, [
            `Max ${FLOW_CONFIG.nameMax} characters. ${FULLSCREEN_KEY.toUpperCase()} — fullscreen.`,
          ]),
        ],
      ),
    ],
  );

  return {
    root,
    focus: () => input.focus(),
    setError: (message) => {
      error.textContent = message;
    },
    setBusy: (busy) => {
      joinButton.disabled = busy;
      practiceButton.disabled = busy;
      input.disabled = busy;
    },
  };
}
