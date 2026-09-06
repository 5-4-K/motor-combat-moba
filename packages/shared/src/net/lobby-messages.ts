export const MSG_SWITCH_TEAM = "switch_team";
export const MSG_SET_MODE = "set_mode";
export const MSG_START_MATCH = "start_match";
export const MSG_KICK = "kick";
export const MSG_START_ERROR = "start_error";
/** Commits the pick and locks it. */
export const MSG_SELECT_CAR = "select_car";
/**
 * A non-binding pick. Tells the server what the player is looking at, so that if the car-select
 * deadline catches them before they lock in they are given the car they were actually on. Never
 * locks, and is not mirrored to other clients — the design shows no "taken" state.
 */
export const MSG_PREVIEW_CAR = "preview_car";
export const MSG_RETURN_TO_LOBBY = "return_to_lobby";

/**
 * A lobby chat message from a client. An intent, not state (invariant 3): the server re-validates
 * the text, decides whether the sender is allowed to speak, and stamps the time.
 */
export const MSG_CHAT = "chat";

/**
 * Wire-shape only — whether the text is *sendable* is `validateChatText`'s question, which is why an
 * empty string passes here. `Object.hasOwn` rather than a bare property read so a payload cannot
 * satisfy the guard through its prototype.
 */
export function isChatPayload(msg: unknown): msg is { text: string } {
  if (msg === null || typeof msg !== "object") return false;
  if (!Object.hasOwn(msg, "text")) return false;
  return typeof (msg as { text: unknown }).text === "string";
}
