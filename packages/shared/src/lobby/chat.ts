import { CHAT_CONFIG } from "../config/chat-config.js";

export type ValidateChatResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * A lobby message is one line. Control and format characters become spaces rather than vanishing —
 * "gl\nhf" is two words, not "glhf" — and runs then collapse, so a pasted block cannot smuggle in a
 * wide gap that breaks the panel's row alignment. \p{Cf} is in there for the bidi overrides, which
 * would otherwise let one message scramble the reading order of the whole list.
 */
export function normalizeChatText(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The single authority on whether a message may be sent (LC14). The client calls it to decide
 * whether Send does anything; the server calls it to actually decide. Length is measured on the
 * normalized text, and normalization only ever shrinks, so anything the client's `maxLength`
 * attribute allows through also passes here.
 */
export function validateChatText(raw: string): ValidateChatResult {
  const text = normalizeChatText(raw);
  if (text.length === 0) return { ok: false, error: "Message is empty" };
  if (text.length > CHAT_CONFIG.maxLength) {
    return { ok: false, error: `Message must be ${CHAT_CONFIG.maxLength} characters or fewer` };
  }
  return { ok: true, text };
}
