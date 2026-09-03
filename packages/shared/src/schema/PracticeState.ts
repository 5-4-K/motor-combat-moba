import { type } from "@colyseus/schema";
import { ArenaState } from "./ArenaState.js";

/**
 * Practice-room state (spec PR6). Additive only: nothing here may renumber or touch a field
 * `ArenaState` already ships, because `ArenaScene` decodes this room with the ordinary arena schema
 * and rendering it as a normal match is the whole design.
 *
 * Exactly one field, and the omissions are deliberate. No `controlledSessionId` — the player always
 * drives their own car (PR12), so `controlledCarOf` resolves through its absent-field path. No
 * `tuningJson` (there is no tuning, PR10), no `botEnabled` (there is always a bot), no
 * `botDifficulty` — the client chose it and holds it, and networking it would be a second source of
 * a truth nothing on the wire reads.
 */
export class PracticeState extends ArenaState {
  /** The sim is frozen (PR13). `tick()` returns before incrementing `tick` while this is true. */
  @type("boolean") paused = false;
}
