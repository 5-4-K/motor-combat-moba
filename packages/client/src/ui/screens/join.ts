import { FLOW_CONFIG } from "@motor-combat-moba/shared";
import { button, h } from "../dom.js";
import { FULLSCREEN_KEY } from "../../config/display.js";

/**
 * The join screen: the design's left-aligned hero over the cream ground, with the name field and
 * primary action on one baseline.
 *
 * The error line has no counterpart in the mockup, which only draws the happy path. It stays because
 * "Name is taken" and a refused connection are the two things a player on a LAN actually hits, and a
 * screen that swallows them is a screen you cannot get past.
 */

export interface JoinHandlers {
  onSubmit(name: string): void;
}

export interface JoinScreen {
  root: HTMLElement;
  focus(): void;
  setError(message: string): void;
  setBusy(busy: boolean): void;
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
    style: "min-height: 52px; font-size: 18px;",
  });

  const submit = (): void => handlers.onSubmit(input.value.trim());
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") submit();
  });

  const joinButton = button(
    {
      class: "btn btn-primary",
      style: "min-height: 52px; font-size: 18px; padding-inline: 32px;",
    },
    ["Join lobby"],
    submit,
  );

  const error = h("div", {
    style:
      "font-size: 14px; min-height: 20px; color: var(--color-accent-700); max-width: 480px;",
  });

  const root = h(
    "div",
    { style: "position: absolute; inset: 0; display: flex;" },
    [
      h(
        "div",
        {
          style:
            "flex: 1; padding: 88px 80px; display: flex; flex-direction: column; justify-content: center; gap: 26px;",
        },
        [
          h("h1", { style: "font-size: 84px; line-height: 0.95; margin: 0; max-width: 620px; text-wrap: pretty;" }, [
            "Motor Combat",
          ]),
          h(
            "p",
            {
              style:
                "font-size: 22px; line-height: 1.4; max-width: 480px; margin: 0; color: var(--color-neutral-800);",
            },
            ["Top down car shooter battle arena"],
          ),
          h("div", { style: "display: flex; align-items: flex-end; gap: 12px; margin-top: 12px;" }, [
            h("div", { class: "field", style: "width: 320px;" }, [
              h("label", { for: "pname" }, ["Your name"]),
              input,
            ]),
            joinButton,
          ]),
          error,
          h("div", { style: "font-size: 13px; color: var(--color-neutral-600);" }, [
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
      input.disabled = busy;
    },
  };
}
