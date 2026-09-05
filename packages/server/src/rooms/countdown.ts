import {
  FLOW_CONFIG,
  RoomPhase,
  TICK_RATE_HZ,
  type ArenaState,
} from "@motor-combat-moba/shared";

/**
 * The 3-2-1 before the green light, for the two rooms that do not reduce a flow.
 *
 * `ArenaRoom` gets its countdown from `flow/`, which sequences a whole match — lobby, car select,
 * reveal, countdown, match, results. `PracticeRoom` and `PlaygroundRoom` have none of those states
 * and deliberately do not import the reducer, so before this module they simply pinned `phase` to
 * `MATCH` at creation and started live. That is what left them as the only two rooms in the game
 * where a match opened with no warning.
 *
 * Nothing here is a second countdown *mechanism*. The freeze already exists and is already shared:
 * `serverTick` moves cars only in `RoomPhase.MATCH` (`moving = phase === RoomPhase.MATCH`), and
 * `combatTick` skips combat and contact outside it. Setting the phase is the whole of it — the same
 * two lines `ArenaRoom` reaches through its reducer — which is why this is 20 lines rather than a
 * copy of the flow machine.
 *
 * The client needs no change either: `viewFor(IN_MATCH, COUNTDOWN)` already routes to the arena
 * scene, `syncMatchHud` already draws the numeral for the phase, and `canDrive` already refuses to
 * send input during it.
 */

/** The countdown's length in ticks — the same figure `ArenaRoom` hands its reducer. */
export const COUNTDOWN_TICKS = FLOW_CONFIG.countdownSeconds * TICK_RATE_HZ;

/**
 * Start (or restart) the countdown from the room's current tick.
 *
 * Anchored to `state.tick` rather than to a fixed constant so it can be called at any point in a
 * room's life, not only at creation — practice re-stamps it on join, once the cars actually exist,
 * so the numeral a player sees counts their own three seconds rather than however many ticks the
 * room happened to spend waiting for them to arrive.
 */
export function beginCountdown(state: ArenaState): void {
  state.phase = RoomPhase.COUNTDOWN;
  state.countdownEndsTick = state.tick + COUNTDOWN_TICKS;
}

/**
 * Flip `COUNTDOWN` to `MATCH` once the clock runs out. A no-op in every other phase, so it is safe
 * to call unconditionally at the top of a tick.
 *
 * Deliberately does NOT stamp `matchEndsTick`. Both callers want it left at 0 — practice hides the
 * match clock that way (PR9) and the playground has no match to end (PG6) — and a helper that
 * quietly started a three-minute timer would break both of them at once.
 */
export function countdownSweep(state: ArenaState): void {
  if (state.phase !== RoomPhase.COUNTDOWN) return;
  if (state.tick < state.countdownEndsTick) return;
  state.phase = RoomPhase.MATCH;
}
