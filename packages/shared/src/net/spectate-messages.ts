/**
 * The car a spectating wreck is showing (Phase G, NR45). Client → server, sent by the arena scene
 * when its spectate pick changes — the `[`/`]` cycle, the wreck's first frame, and the fall to the
 * front of the cycle when the watched car dies. An intent, not state (invariant 3): the server
 * re-validates it against `spectatableIds` for that viewer under the mode's `camera().spectate`, and
 * ignores a target it would not let that wreck watch. The server uses it as the wreck's perspective
 * for interest management (what the wreck's view holds) and as the one car whose owner-only fields
 * (slot timers) the wreck's HUD reads.
 */
export const MSG_SPECTATE_TARGET = "spectate_target";

export interface SpectateTargetMessage {
  readonly target: string;
}

/** Longest target string the server will look at; a session id is far shorter. */
export const SPECTATE_TARGET_MAX_LENGTH = 64;

/** Wire-shape only — whether the target is WATCHABLE is the server's question. */
export function isSpectateTargetMessage(msg: unknown): msg is SpectateTargetMessage {
  if (typeof msg !== "object" || msg === null || !Object.hasOwn(msg, "target")) return false;
  const target = (msg as { target: unknown }).target;
  return typeof target === "string" && target.length <= SPECTATE_TARGET_MAX_LENGTH;
}
