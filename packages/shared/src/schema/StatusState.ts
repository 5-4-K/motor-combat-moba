import { Schema, type } from "@colyseus/schema";

/**
 * One running status on one car.
 *
 * Networked because `stepSim` reads it (invariant 8): `modifiersOf` collapses this list into the
 * multipliers `stepDrive` applies, and the client predicts the local car through the same `stepSim`.
 * A car under a slow that the client could not see would be mispredicted every tick it lasted and
 * snapped back by every patch.
 *
 * The list is a projection of the sim's `ActiveStatus[]`, and carries all of it. There is
 * deliberately no server-only half: unlike `FireState`'s `pending` machine or an instance's
 * `damageClock`, a status has no hidden rules — it is a row in `STATUS_TABLE` and two ticks, and
 * every part of that is something a player is entitled to see on their own HUD.
 */
export class StatusState extends Schema {
  /** A key into `STATUS_TABLE`. Validated through `isStatusId` by every reader. */
  @type("string") statusId = "";
  /**
   * The tick it was applied on. Networked because two readers need it and neither can derive it: the
   * pulse schedule is counted from here, and the HUD's drain bar needs the total duration, which is
   * not in the status table — the applier chose it.
   */
  @type("uint32") startTick = 0;
  /**
   * The tick it stops applying. Active while `tick < endsTick`, exactly as the HUD reads
   * `tick < pendingUntilTick` — a tick, not a countdown, so it stays right between two patches at
   * 20 Hz against a 30 Hz sim.
   */
  @type("uint32") endsTick = 0;
  /** Who applied it, or `""`. The sim never reads it; see `ActiveStatus.sourceSessionId`. */
  @type("string") sourceSessionId = "";
}
