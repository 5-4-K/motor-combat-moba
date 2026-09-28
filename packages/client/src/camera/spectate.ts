import { PlayerStatus, RoomPhase, type SpectateTarget } from "@motor-combat-moba/shared";

/**
 * Is this player watching rather than playing? True only for a wreck in a live match whose mode's
 * camera config actually gives them somewhere to look — `camera().spectate.target` (CB18), not
 * `rulesOf(mode).respawns`: whether a mode respawns and whether it spectates a wreck are two
 * separate authoring choices now, and this reads only the second.
 *
 * Deliberately not "cannot drive right now". The drive gate is also false during the countdown, and
 * keying the camera off it meant the 3-2-1 was spent watching whichever car happened to sort first
 * by session id instead of your own. Being dead is what makes you a spectator; not being able to
 * move yet is not.
 */
export function isSpectating(
  phase: number,
  status: number,
  alive: boolean,
  target: SpectateTarget,
): boolean {
  if (phase !== RoomPhase.MATCH) return false;
  if (target === "none") return false;
  return status === PlayerStatus.IN_MATCH && !alive;
}

/** The fields spectate target selection reads off a networked player. */
export interface SpectateCandidate {
  sessionId: string;
  status: number;
  alive: boolean;
  team: number;
}

/**
 * Who a wreck may cycle through (CB19, CB20). "none" and "free" watch nobody — "none" because the
 * mode does not spectate at all, "free" because its whole spectating rule is an unattached camera
 * rather than a cycle of cars.
 *
 * Sorted rather than in `MapSchema` order for the same reason the sim sorts: the cycle has to be
 * stable. In insertion order a player who joins mid-match would silently reshuffle the order under
 * a spectator's fingers, so pressing `]` twice would not land where pressing it once and once again
 * did.
 */
export function spectatableIds(
  players: readonly SpectateCandidate[],
  target: SpectateTarget,
  viewer: { sessionId: string; team: number },
): string[] {
  if (target === "none" || target === "free") return [];
  return players
    .filter((p) => p.status === PlayerStatus.IN_MATCH && p.alive)
    .filter(
      (p) => target === "anyone" || (p.team === viewer.team && p.sessionId !== viewer.sessionId),
    )
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

/** The spectator banner for a wreck (CB24); undefined means no banner. */
export function spectateBanner(target: SpectateTarget, watchedName: string): string | undefined {
  if (target === "none") return undefined;
  if (target === "free") return "Free roam — WASD/arrows to pan";
  return watchedName === ""
    ? "Wrecked — no one left to watch"
    : `Spectating ${watchedName} — [ ] or Left/Right to switch`;
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

/** The frame time `camera().camLerp` is expressed against, so 60 Hz behaviour is unchanged. */
const REFERENCE_FRAME_MS = 1000 / 60;

/**
 * Soft-follow the camera focus toward a target for one frame.
 *
 * `camLerp` is a fraction of the remaining gap per *reference* frame, rescaled here by the real
 * frame time. Applying it as a flat per-frame constant — which is what this replaces — closes the
 * gap 2.4x faster on a 144 Hz display than a 60 Hz one, and while following a car at constant speed
 * that settles into a trailing offset of `speed / (fps * camLerp)`. At 540 units/second that is 75
 * world units of lag at 60 Hz against 31 at 144: the same car, framed differently, with the slower
 * display seeing ~44 fewer units of road ahead. Compounding per elapsed time instead makes the decay
 * depend only on how long a frame took, not how the second was sliced up. Same reasoning as
 * `panFreeCam`, which has always been time-based.
 */
export function smoothFollow(
  focus: { x: number; y: number },
  target: { x: number; y: number },
  camLerp: number,
  deltaMs: number,
): { x: number; y: number } {
  const alpha = 1 - Math.pow(1 - camLerp, deltaMs / REFERENCE_FRAME_MS);
  return {
    x: focus.x + (target.x - focus.x) * alpha,
    y: focus.y + (target.y - focus.y) * alpha,
  };
}
