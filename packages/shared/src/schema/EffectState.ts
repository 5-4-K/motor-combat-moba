import { Schema, type } from "@colyseus/schema";

/**
 * One running buff or debuff on one car.
 *
 * Networked because `stepSim` reads it (invariant 8): `modifiersOf` collapses this list into the
 * multipliers `stepDrive` applies, and the client predicts the local car through the same
 * `stepSim`. A car under a slow that the client could not see would be mispredicted every tick it
 * lasted and snapped back by every patch.
 *
 * The list is a projection of the sim's `ActiveEffect[]`, and carries all of it. There is
 * deliberately no server-only half: unlike `FireState`'s `pending` machine or an instance's
 * `damageClock`, an effect has no hidden rules — it is a row in `EFFECT_TABLE`, a clock, and a stack
 * count, and every one of the three is something a player is entitled to see on their own HUD.
 */
export class EffectState extends Schema {
  /** A key into `EFFECT_TABLE`. Validated through `isEffectId` by every reader. */
  @type("string") effectId = "";
  /**
   * The tick this stops applying. Active while `tick < endsTick`, exactly as the HUD reads
   * `tick < pendingUntilTick` — a tick, not a countdown, so it stays right between two patches at
   * 20 Hz against a 30 Hz sim.
   */
  @type("uint32") endsTick = 0;
  @type("uint8") stacks = 1;
  /** Who applied it, or `""`. The sim never reads it; see `ActiveEffect.sourceSessionId`. */
  @type("string") sourceSessionId = "";
}
