import { DEATHMATCH_TICKS, TICK_RATE_HZ } from "@motor-combat-moba/shared";

/** How long "[name] killed you" stays up. Render-only, so it lives here rather than in shared. */
export const KILLED_BY_TICKS = 3 * TICK_RATE_HZ;

/**
 * The deathmatch HUD's pure derivations, kept out of `ArenaScene` for the reason every other
 * `*-hud.ts` module in this directory exists: the scene cannot be unit-tested without a browser, so
 * anything with a rule in it lives beside it and the scene stays a shell over the top.
 *
 * Every one of these is derived from state the schema already carries. The respawn countdown reads
 * `diedAtTick`, which was networked for the death fade long before respawning existed, so neither it
 * nor the banner costs a new field.
 */

/** `m:ss` remaining, or `""` when this mode has no clock. Floors, and never counts past zero. */
export function matchClockLabel(tick: number, matchEndsTick: number): string {
  if (matchEndsTick <= 0) return "";
  const remaining = Math.max(0, matchEndsTick - tick);
  const total = Math.floor(remaining / TICK_RATE_HZ);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Whole seconds until this car is back, or 0 once it is due.
 *
 * Rounds UP, so the last displayed number is 1 rather than a second of "0" the player sits through
 * wondering whether the game has hung. `diedAtTick` of 0 is `PlayerState`'s own "has not died"
 * sentinel — its doc comment reads "the tick this car's hp reached 0, or 0 while it lives," and
 * `ArenaRoom.tick()` increments `state.tick` before anything else runs, so a real death can never be
 * stamped at tick 0. That makes this function safe to call unconditionally, alive or dead: no `alive`
 * parameter needed, and no second source of the same truth for it to drift from.
 */
export function respawnSeconds(diedAtTick: number, tick: number): number {
  if (diedAtTick <= 0) return 0;
  const remaining = diedAtTick + DEATHMATCH_TICKS.respawnDelay - tick;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / TICK_RATE_HZ);
}

/** Is the local player inside the banner's window? Local player only — nobody else sees this. */
export function showKilledBy(alive: boolean, diedAtTick: number, tick: number): boolean {
  if (alive || diedAtTick <= 0) return false;
  return tick - diedAtTick < KILLED_BY_TICKS;
}

/** A killer who left the room before the patch landed leaves no name to print. */
export function killedByText(killerName: string): string {
  return killerName === "" ? "You were destroyed" : `${killerName} killed you`;
}
