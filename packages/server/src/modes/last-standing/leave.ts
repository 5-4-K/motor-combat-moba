import type { LivingPlayer } from "@motor-combat-moba/shared";

/**
 * Snapshots the roster that remains after a leaver has already been removed from `state.players`
 * and the room's roster set, in the shape `livingSides` reads. Lives under `last-standing/` (not
 * `rooms/`) because it is that family's `afterLeave` helper alone — `modes/` never imports from
 * `rooms/`.
 */
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
