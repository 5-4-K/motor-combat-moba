import { ArraySchema } from "@colyseus/schema";
import { describe, expect, it } from "vitest";
import { CHAT_CONFIG, ChatMessageState, PlayerStatus } from "@motor-combat-moba/shared";
import { canSendChat, formatClockTime, pushChatMessage } from "./chat.js";

const SENDER = { sessionId: "s1", name: "Redline", colorId: 3 };

function push(chat: ArraySchema<ChatMessageState>, text: string): ChatMessageState {
  return pushChatMessage(chat, { sender: SENDER, text, at: "14:32" });
}

describe("canSendChat (LC17, LC20)", () => {
  it("lets a READY player speak when they have never sent", () => {
    expect(canSendChat({ status: PlayerStatus.READY, lastSentAt: undefined, now: 1000 })).toBe(true);
  });

  it("refuses a player who is in a match", () => {
    // READY is exactly the status viewFor maps to the lobby screen, so this gate and the UI that
    // shows the panel are the same predicate and cannot drift apart.
    expect(canSendChat({ status: PlayerStatus.IN_MATCH, lastSentAt: undefined, now: 1000 })).toBe(false);
  });

  it("refuses a player on the results screen", () => {
    expect(canSendChat({ status: PlayerStatus.POST_MATCH, lastSentAt: undefined, now: 1000 })).toBe(false);
  });

  it("refuses a second send inside the cooldown", () => {
    const now = 1000 + CHAT_CONFIG.sendCooldownMs - 1;
    expect(canSendChat({ status: PlayerStatus.READY, lastSentAt: 1000, now })).toBe(false);
  });

  it("allows a send exactly at the cooldown boundary", () => {
    const now = 1000 + CHAT_CONFIG.sendCooldownMs;
    expect(canSendChat({ status: PlayerStatus.READY, lastSentAt: 1000, now })).toBe(true);
  });

  it("allows a send well after the cooldown", () => {
    expect(canSendChat({ status: PlayerStatus.READY, lastSentAt: 1000, now: 99000 })).toBe(true);
  });
});

describe("pushChatMessage (LC4, LC12)", () => {
  it("copies the sender onto the row rather than referencing them (LC1)", () => {
    const chat = new ArraySchema<ChatMessageState>();
    const row = push(chat, "gl hf");
    expect(row.sessionId).toBe("s1");
    expect(row.name).toBe("Redline");
    expect(row.colorId).toBe(3);
    expect(row.text).toBe("gl hf");
    expect(row.at).toBe("14:32");
  });

  it("numbers the first message 1", () => {
    const chat = new ArraySchema<ChatMessageState>();
    expect(push(chat, "one").seq).toBe(1);
  });

  it("increments seq for each message", () => {
    const chat = new ArraySchema<ChatMessageState>();
    push(chat, "one");
    push(chat, "two");
    expect(push(chat, "three").seq).toBe(3);
  });

  it("holds maxMessages without dropping anything", () => {
    const chat = new ArraySchema<ChatMessageState>();
    for (let i = 0; i < CHAT_CONFIG.maxMessages; i += 1) push(chat, `m${i}`);
    expect(chat.length).toBe(CHAT_CONFIG.maxMessages);
    expect(chat.at(0)!.text).toBe("m0");
  });

  it("drops the oldest message on the one past the cap", () => {
    const chat = new ArraySchema<ChatMessageState>();
    for (let i = 0; i < CHAT_CONFIG.maxMessages + 1; i += 1) push(chat, `m${i}`);
    expect(chat.length).toBe(CHAT_CONFIG.maxMessages);
    expect(chat.at(0)!.text).toBe("m1");
    expect(chat.at(chat.length - 1)!.text).toBe(`m${CHAT_CONFIG.maxMessages}`);
  });

  it("keeps seq monotonic across a shift, which is why length cannot be the change signal (LC12)", () => {
    const chat = new ArraySchema<ChatMessageState>();
    for (let i = 0; i < CHAT_CONFIG.maxMessages; i += 1) push(chat, `m${i}`);
    const lengthBefore = chat.length;
    const seqBefore = chat.at(chat.length - 1)!.seq;
    push(chat, "one more");
    expect(chat.length).toBe(lengthBefore);
    expect(chat.at(chat.length - 1)!.seq).toBe(seqBefore + 1);
  });
});

describe("formatClockTime (LC3)", () => {
  it("formats an afternoon time 24-hour", () => {
    expect(formatClockTime(new Date(2026, 8, 6, 14, 32))).toBe("14:32");
  });

  it("zero-pads hours and minutes", () => {
    expect(formatClockTime(new Date(2026, 8, 6, 9, 5))).toBe("09:05");
  });

  it("renders midnight as 00:00", () => {
    expect(formatClockTime(new Date(2026, 8, 6, 0, 0))).toBe("00:00");
  });
});
