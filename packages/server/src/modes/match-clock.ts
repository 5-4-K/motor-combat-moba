import { derived, rulesOf } from "@motor-combat-moba/shared";
import type { ModeRoomView } from "./types.js";

/**
 * Stamps `matchEndsTick` on the edge into MATCH — `rulesOf(mode).hasMatchClock` is the single fact
 * that decides whether a mode has one at all, so every controller's `onMatchStart` reaches this
 * rather than repeating its own `? tick + derived().deathmatchTicks.match : 0` ternary. 0 in every
 * mode without a clock: nothing reads it there, and a stale non-zero value would hand the client's
 * HUD a clock to count down that means nothing.
 */
export function stampMatchClock(room: ModeRoomView): void {
  room.state.matchEndsTick = rulesOf(room.state.mode).hasMatchClock
    ? room.state.tick + derived().deathmatchTicks.match
    : 0;
}
