import { PlayerStatus, type RemoteSnapshot } from "@motor-combat-moba/shared";

/**
 * What this client may know about a car under interest management (NR44, NR48).
 *
 * The server removes a hidden enemy's `@view()` fields from this client's state: its pose, velocity,
 * hp, statuses and the rest decode as `undefined`, and `inView` — `true` on the server always — is
 * `true` here exactly while the car is in this client's view. Its public fields (name, colour, team,
 * `alive`, kills, deaths) keep arriving: those are scoreboard facts, and a death is public.
 *
 * Every client system that reads a car's tagged fields therefore asks this first, and a car that is
 * not in view is treated as ABSENT — not drawn, not in the fx world, not collided against in
 * prediction, its remote timeline forgotten so it reappears at its first visible snapshot instead of
 * sliding there from where it was last seen.
 */
export interface ViewTagged {
  readonly inView?: boolean | undefined;
}

/** A roster as both a Colyseus `MapSchema` and a test's plain object present it. */
export interface Roster<P> {
  forEach(callback: (player: P, sessionId: string) => void): void;
}

/**
 * Is this car's view state on this client? The driven car always is (the server's view rule puts
 * your own car in your view; reading its own `inView` would make the local car's prediction hang on a
 * field it never needs).
 */
export function carInView(sessionId: string, player: ViewTagged, drivenSid: string): boolean {
  return sessionId === drivenSid || player.inView === true;
}

/**
 * The roster with every car not in view left out, for `buildStepContext` (local prediction): a hidden
 * enemy has no pose to collide against, and a stale one would shove the predicted car off a car that
 * is no longer there. The server still resolves any real contact; the snapshot corrects the rest.
 */
export function inViewRoster<P extends ViewTagged>(players: Roster<P>, drivenSid: string): Roster<P> {
  return {
    forEach(callback) {
      players.forEach((player, sessionId) => {
        if (carInView(sessionId, player, drivenSid)) callback(player, sessionId);
      });
    },
  };
}

/** What `feedRemoteTimeline` needs of the remote timeline. */
export interface RemoteTimelineSink {
  push(id: string, tick: number, snap: RemoteSnapshot): void;
  forget(id: string): void;
}

/**
 * One patch into the remote timeline (NR29): every remote on the field that is in view is pushed;
 * every one that is not is FORGOTTEN, so its interpolation, reckoning and contact blend start fresh
 * from its first visible snapshot when it comes back — it never slides from where it was last seen
 * (a short hide sits under `remoteTeleportCars`, the timeline's own reset distance). The driven car
 * is prediction's, never the timeline's.
 */
export function feedRemoteTimeline<P extends ViewTagged & { readonly status: number }>(
  timeline: RemoteTimelineSink,
  players: Roster<P>,
  drivenSid: string,
  tick: number,
  snapshotOf: (player: P, sessionId: string) => RemoteSnapshot,
): void {
  players.forEach((player, sessionId) => {
    if (sessionId === drivenSid) return;
    if (player.status !== PlayerStatus.IN_MATCH) return;
    if (player.inView !== true) {
      timeline.forget(sessionId);
      return;
    }
    timeline.push(sessionId, tick, snapshotOf(player, sessionId));
  });
}

/**
 * An instance owner's wire pose, for `ShotView.update` (an attached beam's muzzle), or `null` when
 * the owner is gone or out of view — a hidden owner has no pose, and its beam then draws at its own
 * snapshot pose rather than welded to `undefined`.
 */
export function ownerWirePose(
  owner: (ViewTagged & { readonly x: number; readonly y: number; readonly angle: number }) | undefined,
): { x: number; y: number; angle: number } | null {
  if (!owner || owner.inView !== true) return null;
  return { x: owner.x, y: owner.y, angle: owner.angle };
}
