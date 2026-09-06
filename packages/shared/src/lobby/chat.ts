import { CHAT_CONFIG } from "../config/chat-config.js";

export type ValidateChatResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * A lobby message is one line. Control characters (`\p{Cc}`) become spaces rather than vanishing --
 * "gl\nhf" is two words, not "glhf" -- and runs then collapse, so a pasted block cannot smuggle in a
 * wide gap that breaks the panel's row alignment. The explicit bidi-control characters alongside
 * `\p{Cc}` (LRM/RLM, ALM, the LRE/RLE/PDF/LRO/RLO embedding controls, and the LRI/RLI/FSI/PDI
 * isolates) exist for the same reason as the control characters: an unpaired one of these would let
 * a single message scramble the reading order of the whole panel.
 *
 * This is deliberately narrower than `\p{Cf}`, which also contains ZERO WIDTH JOINER (U+200D) and
 * ZERO WIDTH NON-JOINER (U+200C). Those two are never stripped here: a joiner is not a formatting
 * hazard, it is load-bearing text -- it is what fuses a multi-part emoji sequence into one glyph
 * (a family emoji is four person glyphs plus three ZWJs) and what splits or joins letters in
 * Persian and Hindi spelling. Widening this back to `\p{Cf}` breaks multi-part emoji into their
 * separate parts and silently changes the spelling of real words in those languages. Do not
 * "simplify" it back.
 */
export function normalizeChatText(raw: string): string {
  return raw
    .replace(/[\p{Cc}\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/gu, " ")
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
