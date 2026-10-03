import {
  PlayerStatus,
  axisOfWire,
  buildStepContext,
  modifiersFromRows,
  type ArenaDef,
  type ContextPlayer,
  type Modifiers,
  type PoseOf,
  type RemoteSnapshot,
  type SimBody,
  type StepContext,
} from "@motor-combat-moba/shared";

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

/**
 * The local car's prediction context (NR32) over the cars in view only (`inViewRoster`). Every client
 * `StepContext` is built from visible rows: `buildStepContext` runs `otherCarHulls` over every row it
 * is handed, and a hidden row's `statuses` is `undefined` — `isSolid` would throw on it.
 */
export function predictionStepContext<P extends ViewTagged & ContextPlayer>(
  arena: ArenaDef,
  players: Roster<P>,
  selfSid: string,
  tick: number,
  modifiers: Readonly<Modifiers>,
  poseOf?: PoseOf,
): StepContext {
  return buildStepContext(arena, { players: inViewRoster(players, selfSid) }, selfSid, tick, modifiers, poseOf);
}

/** What `remoteSnapshotOf` reads off an in-view remote's row. */
export interface RemoteRow extends ContextPlayer {
  readonly vx: number;
  readonly vy: number;
  readonly angVel: number;
  readonly maneuver: number;
  readonly maneuverTicksLeft: number;
  readonly maneuverAngle: number;
  readonly maneuverSpeed: number;
  readonly lastSteer: number;
  readonly lastThrottle: number;
}

/**
 * One in-view remote's snapshot for the timeline (NR31, NR33): its pose, its last consumed input, and
 * a step context of its OWN — its chassis and status modifiers, and no other cars. Built from a
 * roster holding only that remote: the reckoner discards `others` anyway, and the full roster would
 * hand `buildStepContext` every hidden row too (G4 review C1). Call it only for a car in view.
 */
export function remoteSnapshotOf(arena: ArenaDef, player: RemoteRow, sessionId: string, tick: number): RemoteSnapshot {
  const body: SimBody = {
    x: player.x,
    y: player.y,
    angle: player.angle,
    vx: player.vx,
    vy: player.vy,
    angVel: player.angVel,
    maneuver: player.maneuver,
    maneuverTicksLeft: player.maneuverTicksLeft,
    maneuverAngle: player.maneuverAngle,
    maneuverSpeed: player.maneuverSpeed,
  };
  const alone: Roster<RemoteRow> = { forEach: (callback) => callback(player, sessionId) };
  return {
    body,
    keys: { steer: axisOfWire(player.lastSteer), throttle: axisOfWire(player.lastThrottle), fireSlots: 0 },
    ctx: {
      ...buildStepContext(arena, { players: alone }, sessionId, tick, modifiersFromRows(player.statuses, tick)),
      others: [],
    },
    // Death and respawn reset the remote's interpolation and reckoning (no slide from the wreck to
    // the spawn); so does a jump of more than `remoteTeleportCars` car lengths.
    alive: player.alive,
  };
}
