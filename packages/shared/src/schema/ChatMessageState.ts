import { Schema, type } from "@colyseus/schema";

/**
 * One lobby chat message (LC11).
 *
 * `name` and `colorId` are snapshotted at send time, not resolved through `ArenaState.players` at
 * render time (LC1). A message is a record of something that was said, so it has to outlive its
 * sender: a lookup would render every message from a player who left or was kicked as nameless and
 * grey the instant their PlayerState was deleted.
 *
 * `seq` is a monotonic id derived from the previous row (LC12). The client's render signature needs
 * it because `chat.length` cannot detect a new message once the buffer is at its cap — an append
 * plus a shift leaves the length unchanged — and comparing text fails on two identical messages in
 * the same minute. It doubles as a stable render key.
 *
 * `at` is a server-formatted HH:MM string (LC3), not an epoch: an epoch rendered per-machine shows
 * each viewer their own timezone, which is not "server time".
 *
 * Display-only. `stepSim` never reads any of it, which is why invariant 8 — a one-way rule — is not
 * strained here; chat is networked for the reason `winnerSessionId` is, so that a client which never
 * observed the event can still draw it.
 */
export class ChatMessageState extends Schema {
  @type("uint32") seq = 0;
  @type("string") sessionId = "";
  @type("string") name = "";
  @type("uint8") colorId = 0;
  @type("string") text = "";
  @type("string") at = "";
}
