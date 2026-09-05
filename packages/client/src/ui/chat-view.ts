import { COLOR_TABLE } from "@motor-combat-moba/shared";

/**
 * Chat rows to everything the panel draws. Pure and Phaser-free, for the same reason `lobby-view.ts`
 * is: the rules worth testing live here, leaving the screen module with nothing but markup.
 */

const FALLBACK_HEX = "#888888";

/** The shape of a `ChatMessageState` row, structurally typed so tests need no schema instance. */
export interface ChatViewRow {
  seq: number;
  sessionId: string;
  name: string;
  colorId: number;
  text: string;
  at: string;
}

export interface ChatViewMessage {
  key: string;
  label: string;
  hex: string;
  text: string;
  at: string;
}

/**
 * Nothing in here consults the player list — the row already carries the sender's name and colour
 * (LC1), which is what lets a message from someone who has left keep reading correctly.
 */
export function chatView(
  rows: readonly ChatViewRow[],
  mySessionId: string,
): ChatViewMessage[] {
  return rows.map((row) => ({
    key: String(row.seq),
    label: row.sessionId === mySessionId ? "You" : row.name,
    hex: COLOR_TABLE[row.colorId]?.hex ?? FALLBACK_HEX,
    text: row.text,
    at: row.at,
  }));
}
