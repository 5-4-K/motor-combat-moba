import type { Spawn } from "../arena/types.js";

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
