import type { ArraySchema } from "@colyseus/schema";
import { CHAT_CONFIG, ChatMessageState, PlayerStatus } from "@motor-combat-moba/shared";

/**
 * Lobby chat's server-side rules, kept out of `ArenaRoom` so they can be tested directly — the same
 * shape `MSG_START_MATCH` already uses when it defers to `canStart`. The room tests in this package
 * exercise extracted helpers, never a live `onMessage` through a Colyseus room.
 */

export interface ChatSendGate {
  status: PlayerStatus;
  /** When this player last sent, or undefined if they never have. */
  lastSentAt: number | undefined;
  /** Wall-clock milliseconds. Passed in rather than read here so the cooldown is testable. */
  now: number;
}

/**
 * Both send gates in one predicate (LC17, LC20).
 *
 * `READY` is exactly the status `viewFor` maps to the lobby screen, so "may speak" and "is looking
 * at the chat panel" are the same question and cannot drift apart.
 */
export function canSendChat(gate: ChatSendGate): boolean {
  if (gate.status !== PlayerStatus.READY) return false;
  if (gate.lastSentAt === undefined) return true;
  return gate.now - gate.lastSentAt >= CHAT_CONFIG.sendCooldownMs;
}

export interface ChatSender {
  sessionId: string;
  name: string;
  colorId: number;
}

/**
 * Append a message and enforce the cap (LC4). `seq` is derived from the previous row rather than
 * held in a counter field somewhere (LC12) — there is nothing to keep in sync with the array, and a
 * uint32 cannot be exhausted at typing speed within one room's life.
 */
export function pushChatMessage(
  chat: ArraySchema<ChatMessageState>,
  row: { sender: ChatSender; text: string; at: string },
): ChatMessageState {
  const previous = chat.length > 0 ? chat.at(chat.length - 1) : undefined;
  const message = new ChatMessageState();
  message.seq = (previous?.seq ?? 0) + 1;
  message.sessionId = row.sender.sessionId;
  message.name = row.sender.name;
  message.colorId = row.sender.colorId;
  message.text = row.text;
  message.at = row.at;
  chat.push(message);
  while (chat.length > CHAT_CONFIG.maxMessages) chat.shift();
  return message;
}

/** `HH:MM`, 24-hour, zero-padded (LC3). Takes a Date so the format is testable without faking time. */
export function formatClockTime(now: Date): string {
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
