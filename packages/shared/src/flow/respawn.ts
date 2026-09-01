import type { Spawn } from "../arena/types.js";
import { DEATHMATCH_TICKS } from "../config/deathmatch-config.js";

/**
 * Where a respawning car should appear: the spawn point whose NEAREST living enemy is furthest away.
 *
 * Maximising the nearest distance rather than the sum is the whole rule. A spawn far from the pack
 * but touching one camper is the worst place on the map, and a sum would happily choose it.
 *
 * This is the upstream layer every competitive shooter leans on, and it is what makes the overlap
 * case rare before spawn protection (M23) has to handle it at all. Ties break toward the earlier
 * spawn so the choice is deterministic and testable — there is deliberately no randomness here.
 */
export function farthestSpawn(
  spawns: readonly Spawn[],
  enemies: readonly { x: number; y: number }[],
): Spawn {
  const first = spawns[0];
  if (!first) throw new Error("No spawn points to respawn into");
  if (enemies.length === 0) return first;

  let best = first;
  let bestDistance = -1;
  for (const spawn of spawns) {
    let nearest = Infinity;
    for (const enemy of enemies) {
      const dx = spawn.x - enemy.x;
      const dy = spawn.y - enemy.y;
      // Squared throughout: the ordering is identical and the square root buys nothing.
      nearest = Math.min(nearest, dx * dx + dy * dy);
    }
    // Strictly greater, so an equal candidate never displaces an earlier one.
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = spawn;
    }
  }
  return best;
}

/**
 * Has this wreck waited long enough?
 *
 * `diedAtTick` is 0 for a living car — the schema's own "has not died" sentinel — and that must not
 * be read as "died on tick zero", which would respawn the whole roster on the match's first tick.
 */
export function isDueToRespawn(diedAtTick: number, tick: number): boolean {
  if (diedAtTick <= 0) return false;
  return tick >= diedAtTick + DEATHMATCH_TICKS.respawnDelay;
}

/** What the room should do with a car's spawn protection this tick. */
export type PhaseAction =
  /** Inside its window and not due to lapse. Leave it alone. */
  | "run"
  /** It would lapse this tick, into another car's hull. Refresh it. */
  | "extend"
  /** End it now. */
  | "drop";

export interface PhaseInput {
  tick: number;
  /** The status row's own end, as applied or last extended. */
  endsTick: number;
  /** The room-owned ceiling this protection may never pass. */
  capTick: number;
  /** Did the player commit a press on a tick the server actually simulated? */
  fired: boolean;
  /** Is this car's hull touching any car that is solid right now? */
  overlapping: boolean;
}

/**
 * The whole of M23 in one pure function, so the room is left holding no rules at all.
 *
 * The ordering IS the design. Firing wins over everything: protection is traded for the shot, and a
 * player who shoots from inside someone has chosen to be shootable. The cap wins over extension, or
 * a car parked on a ghost could hold it intangible indefinitely. And overlap is consulted ONLY on
 * the tick protection would otherwise lapse — asking sooner would extend a car that is merely
 * driving past someone, which is not what the rule is for.
 *
 * "Drop" rather than "let it expire on its own" is deliberate: it makes the end deterministic and
 * immediate, rather than depending on which of two sweeps happens to run first next tick.
 */
export function phaseDecision(input: PhaseInput): PhaseAction {
  if (input.fired) return "drop";
  if (input.tick >= input.capTick) return "drop";
  // `endsTick` is exclusive — a status is active while `tick < endsTick` — so it lapses at
  // `tick + 1` exactly when `endsTick <= tick + 1`.
  if (input.endsTick > input.tick + 1) return "run";
  return input.overlapping ? "extend" : "drop";
}
