import { PlayerStatus, RoomPhase } from "@motor-arena/shared";

/**
 * Is this player watching rather than playing? True only for a wreck in a live match.
 *
 * Deliberately not "cannot drive right now". The drive gate is also false during the countdown, and
 * keying the camera off it meant the 3-2-1 was spent watching whichever car happened to sort first
 * by session id instead of your own. Being dead is what makes you a spectator; not being able to
 * move yet is not.
 */
export function isSpectating(phase: number, status: number, alive: boolean): boolean {
  if (phase !== RoomPhase.MATCH) return false;
  return status === PlayerStatus.IN_MATCH && !alive;
}

/** The fields spectate target selection reads off a networked player. */
export interface SpectateCandidate {
  sessionId: string;
  status: number;
  alive: boolean;
}

/**
 * Everyone still fighting, in sorted `sessionId` order.
 *
 * Sorted rather than in `MapSchema` order for the same reason the sim sorts: the cycle has to be
 * stable. In insertion order a player who joins mid-match would silently reshuffle the order under
 * a spectator's fingers, so pressing `]` twice would not land where pressing it once and once again
 * did.
 */
export function spectatableIds(players: readonly SpectateCandidate[]): string[] {
  return players
    .filter((p) => p.status === PlayerStatus.IN_MATCH && p.alive)
    .map((p) => p.sessionId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Step one place along the cycle, wrapping at both ends.
 *
 * A `current` that is no longer in the list — the car you were watching just died — restarts the
 * cycle from its first entry rather than returning nothing, so a spectator is never left staring at
 * a wreck. An empty list yields `""`, which the caller reads as "nobody left to watch".
 */
export function cycleSpectate(ids: readonly string[], current: string, step: 1 | -1): string {
  if (ids.length === 0) return "";
  const index = ids.indexOf(current);
  if (index === -1) return ids[0]!;
  // `+ ids.length` before the modulo: JS `%` keeps the sign of the dividend, so -1 % n is -1.
  return ids[(index + step + ids.length) % ids.length]!;
}

/**
 * The target to actually watch this frame. Keeps the current pick while it is still alive, and
 * otherwise falls to the front of the cycle — so the moment you are wrecked the camera lands on
 * someone rather than freezing over your own remains.
 */
export function resolveSpectateTarget(ids: readonly string[], current: string): string {
  if (ids.includes(current)) return current;
  return ids[0] ?? "";
}

/**
 * Free-roam camera pan for one frame, in world units.
 *
 * `deltaMs` rather than a per-frame step: panning must feel the same at 60 and 144 Hz, and a
 * per-frame constant would move the camera 2.4x faster on the faster display. Diagonal input is
 * deliberately not normalised — this is a debug-ish free look, not a character controller.
 */
export function panFreeCam(
  focus: { x: number; y: number },
  axisX: number,
  axisY: number,
  deltaMs: number,
  speed: number,
): { x: number; y: number } {
  const step = (speed * deltaMs) / 1000;
  return { x: focus.x + axisX * step, y: focus.y + axisY * step };
}
