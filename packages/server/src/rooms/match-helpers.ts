import {
  DEFAULT_CAR_ID,
  type CarId,
  type LivingPlayer,
  type Spawn,
} from "@motor-combat-moba/shared";

export function copySpawnNumbers(spawn: Spawn): { x: number; y: number; angle: number } {
  return { x: spawn.x, y: spawn.y, angle: spawn.angle };
}

export function livingAfterLeave(
  remaining: readonly { sessionId: string; team: 0 | 1; alive: boolean }[],
  roster: ReadonlySet<string>,
): LivingPlayer[] {
  return remaining.map((p) => ({
    sessionId: p.sessionId,
    team: p.team,
    alive: p.alive,
    inRoster: roster.has(p.sessionId),
  }));
}

/**
 * The car a roster member is given when the car-select deadline catches them unlocked.
 *
 * Nothing is random: the player gets whatever the screen was showing them. A previewed pick wins,
 * and the fallback is `DEFAULT_CAR_ID` — the very chassis car select opens on — so a player who
 * never touched the screen still drives the car it had selected for them the whole time. Sharing
 * one constant with the screen is what makes that true by construction rather than by coincidence.
 */
export function carAtDeadline(previewed: CarId | undefined): CarId {
  return previewed ?? DEFAULT_CAR_ID;
}
