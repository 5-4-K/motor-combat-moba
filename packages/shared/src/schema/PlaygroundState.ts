import { type } from "@colyseus/schema";
import { ArenaState } from "./ArenaState.js";

/**
 * Dev-only room state for the playtesting playground (spec PG3/PG5). A release client can never join
 * this room — `PLAYGROUND_ROOM_NAME` is not registered outside dev builds — so the fields below are
 * additive only: nothing here may renumber or touch a field `ArenaState` already ships, or a plain
 * `ArenaState` client (i.e. every shipped client) would fail to decode this room's patches.
 */
export class PlaygroundState extends ArenaState {
  @type("boolean") paused = false;
  @type("string") controlledSessionId = "";
  @type("boolean") botEnabled = true;
  @type("string") tuningJson = "";
  /** The active bot difficulty (PG30). Not read by `stepSim`; networked so the settings panel can
   * seed its select from state rather than from a local guess that goes stale on reopen. */
  @type("string") botDifficulty = "medium";
}
