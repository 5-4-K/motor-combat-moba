import { CHAT_CONFIG } from "@motor-combat-moba/shared";
import { button, h, icon } from "../dom.js";
import type { ChatViewMessage } from "../chat-view.js";

/**
 * The lobby's chat panel: a scrolling list of the last `CHAT_CONFIG.maxMessages` messages, oldest at
 * the top (LC2), over a one-line composer.
 *
 * The panel holds no state. The draft text lives on `LobbyScene` and arrives as a parameter (LC21),
 * because the lobby re-renders wholesale and an `<input>`'s value would not survive it. The two
 * `data-` attributes are how the scene finds the input and the scroller again after a render to put
 * focus, selection and scroll position back.
 */

/** Lucide `send`. */
const PAPER_PLANE = '<path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path>';

/** How near the bottom still counts as "at the bottom", in px. Covers sub-pixel and rounding drift. */
export const SCROLL_PIN_SLACK_PX = 24;

/**
 * Should the list jump to the newest message after a render? Only if it was already at the bottom —
 * otherwise a player scrolled up reading history is yanked back every time someone talks (LC22).
 *
 * A list shorter than its container yields a negative distance, which is correctly "at the bottom".
 */
export function shouldPinToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= SCROLL_PIN_SLACK_PX;
}

export interface ChatHandlers {
  onChatInput(text: string): void;
  onChatSend(): void;
}

function messageRow(message: ChatViewMessage): HTMLElement {
  return h("div", { style: "margin-bottom: 10px;" }, [
    h("div", { style: "display: flex; align-items: baseline; gap: 8px;" }, [
      h("span", { style: `font-size: 13px; font-weight: 600; color: ${message.hex};` }, [message.label]),
      h("span", { style: "font-size: 11px; color: var(--color-neutral-600);" }, [message.at]),
    ]),
    h("div", { style: "font-size: 13px; color: var(--color-text); word-break: break-word;" }, [message.text]),
  ]);
}

export function chatPanel(
  messages: ChatViewMessage[],
  draft: string,
  handlers: ChatHandlers,
): HTMLElement {
  const field = h("input", {
    type: "text",
    placeholder: "Say something...",
    value: draft,
    maxLength: CHAT_CONFIG.maxLength,
    "data-chat-input": "true",
    "aria-label": "Chat message",
    style:
      "flex: 1; min-width: 0; min-height: 40px; padding: 0 14px; font: inherit; font-size: 13px; " +
      "color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-divider); " +
      "border-radius: 4px; outline: none;",
  });

  field.addEventListener("input", () => handlers.onChatInput(field.value));
  field.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    // Stop here rather than letting it bubble: nothing else on this screen should treat Enter as a
    // press, and the scene is about to re-render underneath us.
    event.preventDefault();
    event.stopPropagation();
    handlers.onChatSend();
  });

  const list = h(
    "div",
    {
      "data-chat-list": "true",
      style: "flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; background: var(--color-bg); border-radius: 4px;",
    },
    messages.length > 0
      ? messages.map((message) => messageRow(message))
      : [h("div", { style: "font-size: 13px; color: var(--color-neutral-600);" }, ["No messages yet."])],
  );

  return h(
    "div",
    {
      style:
        "display: flex; flex-direction: column; width: 100%; max-width: 652px; height: 100%; min-height: 0; gap: 12px; " +
        "padding: 16px 18px; background: var(--color-surface); border: 1px solid var(--color-divider);",
    },
    [
      h(
        "div",
        { style: "font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-accent);" },
        ["Chat"],
      ),
      list,
      h("div", { style: "display: flex; gap: 10px; align-items: stretch;" }, [
        field,
        button(
          {
            class: "btn btn-primary btn-icon",
            style: "width: 40px; min-height: 40px; flex: none;",
            "aria-label": "Send message",
          },
          [icon(PAPER_PLANE, 17, false)],
          handlers.onChatSend,
        ),
      ]),
    ],
  );
}
