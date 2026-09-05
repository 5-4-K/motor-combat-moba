import { describe, expect, it } from "vitest";
import { CHAT_CONFIG } from "../config/chat-config.js";
import { normalizeChatText, validateChatText } from "./chat.js";

describe("CHAT_CONFIG", () => {
  it("carries the three chat numbers", () => {
    expect(CHAT_CONFIG.maxLength).toBe(100);
    expect(CHAT_CONFIG.maxMessages).toBe(20);
    expect(CHAT_CONFIG.sendCooldownMs).toBe(500);
  });
});

describe("normalizeChatText", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeChatText("  gl hf  ")).toBe("gl hf");
  });

  it("turns a newline into a space rather than deleting it", () => {
    // "glhf" would be wrong: they are two words, and the panel is one line per message.
    expect(normalizeChatText("gl\nhf")).toBe("gl hf");
  });

  it("replaces control and format characters", () => {
    // Written as escapes on purpose. A literal BEL or a literal U+202E bidi override in a source
    // file is the trojan-source pattern: editors strip them silently and reviewers cannot see them.
    expect(normalizeChatText("gl\u0007hf")).toBe("gl hf");
    expect(normalizeChatText("gl\u202Ehf")).toBe("gl hf");
  });

  it("collapses runs of whitespace", () => {
    expect(normalizeChatText("gl     hf")).toBe("gl hf");
  });

  it("leaves an ordinary message alone", () => {
    expect(normalizeChatText("bastion again i guess")).toBe("bastion again i guess");
  });
});

describe("validateChatText", () => {
  it("accepts an ordinary message", () => {
    expect(validateChatText("gl hf everyone")).toEqual({ ok: true, text: "gl hf everyone" });
  });

  it("returns the normalized text, not the raw input", () => {
    const result = validateChatText("  no   rush  ");
    expect(result).toEqual({ ok: true, text: "no rush" });
  });

  it("rejects an empty message", () => {
    expect(validateChatText("").ok).toBe(false);
  });

  it("rejects a whitespace-only message", () => {
    expect(validateChatText("     ").ok).toBe(false);
  });

  it("rejects a message that is only control characters", () => {
    expect(validateChatText("\n\n\n").ok).toBe(false);
  });

  it("accepts exactly maxLength characters", () => {
    const text = "a".repeat(CHAT_CONFIG.maxLength);
    expect(validateChatText(text)).toEqual({ ok: true, text });
  });

  it("rejects one character over maxLength", () => {
    expect(validateChatText("a".repeat(CHAT_CONFIG.maxLength + 1)).ok).toBe(false);
  });

  it("names the limit in the error", () => {
    const result = validateChatText("a".repeat(CHAT_CONFIG.maxLength + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(CHAT_CONFIG.maxLength));
  });
});
