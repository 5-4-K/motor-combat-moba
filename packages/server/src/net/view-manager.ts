import { StateView } from "@colyseus/schema";
import {
  NET_CONFIG,
  PlayerStatus,
  RoomPhase,
  VIEW_OWNER,
  activeCarIds,
  beamShapeAt,
  camera,
  carVisible,
  derived,
  drive,
  driveOf,
  getArena,
  inVision,
  instanceDefOf,
  isArenaId,
  isSpectateTargetMessage,
  isSpectating,
  isWeaponId,
  marginShape,
  msToTicks,
  projectileShapeAt,
  resolveSpectateTarget,
  rulesOf,
  shotSamplePoints,
  spectatableIds,
  visionPoses,
  visionShapeOf,
  type ArenaState,
  type Obstacle,
  PlayerState,
  type Pose,
  type SpectateCandidate,
  type VisionPlayer,
  type VisionShape,
  WeaponInstanceState,
  type WorldShape,
  weapons,
} from "@motor-combat-moba/shared";

/**
 * Interest management (Phase G, NR44–NR47): the server decides, every snapshot, which cars and
 * which weapon instances each client's `StateView` holds.
 *
 * Per viewer:
 * 1. Its own car is in, with `VIEW_OWNER`; so are its teammates' (team modes) — slot timers and
 *    all, even behind a wall.
 * 2. With the mode's `camera().fov.enabled` false, or the phase not `MATCH`, every car and every
 *    instance is in. The SAME code path runs: the vision test simply answers "seen" for everything.
 * 3. Otherwise the perspective is the viewer's own car, or the car it is spectating (the target the
 *    client named with `MSG_SPECTATE_TARGET`, validated; until it names one, the server's own
 *    `resolveSpectateTarget` pick — the one the client's cycle starts on). The perspective and its
 *    allies are in (CB27: watching someone shows exactly what they see, allegiance included), and
 *    the perspective gets `VIEW_OWNER` so the wreck's slot HUD keeps working. An enemy of the
 *    perspective is in while `carVisible` holds against the perspective's vision set (CB26:
 *    `visionPoses` — its own car or the `"pov"` frozen death pose, plus living teammates when vision
 *    is shared), each shape grown by `marginUnits` (`marginShape`) and line of sight measured from
 *    each shape's REAL centre (the margin moves only the cone apex) — so an enemy is dropped only
 *    when its centre AND every hull corner are out or blocked (G1 review ruling). An enemy's shot is
 *    in while any of its `shotSamplePoints` is in vision — vision grown by the SHOT margin
 *    (`visionShotMarginUnits`, G5), since a shot outruns every car; a shot owned by the viewer's
 *    side or the perspective's side is always in — ended rows (NR37) included (the Phase F M6 seam).
 * 4. Hysteresis (NR47): an enemy car or shot enters at once and leaves only once it has been out
 *    for `exitTicks` consecutive ticks of the VIEW CLOCK, so an enemy on the edge does not flicker.
 *    The view clock is the tick the room passes to `update`: `state.tick` while the sim runs, and
 *    still advancing one per room tick while a practice or playground room is paused
 *    (`ViewClock`), so a car that leaves the perspective's vision during a pause (a seat switch, a
 *    spectate pick, a settings edit that moves it) still leaves the view `visionExitMs` later.
 *
 * A `StateView` is imperative — an object reaches a view only by `view.add`, nested rows included
 * — so the G2 rules stay: every visible car's `statuses` rows and every owner car's slots are
 * walked every update and added if missing (guarded by `has`/`hasTag`, because a default-tag `add`
 * of a visible object re-sends its snapshot). Arrays under a visible car must never be REPLACED
 * (measured against schema 5.0.34; see `view-manager.fov-off.test.ts`).
 *
 * Every read of a config accessor happens inside `update`/`pickSpectate`, so the caller must hold a
 * mode scope (every room's tick and handlers already do).
 */

/** One client's view, and the car it drives (`undefined` for none — a seatless playground client). */
export interface Viewer {
  /** The client's own session id: the key its interest memory is kept under. */
  sessionId: string;
  view: StateView;
  /**
   * The car this client drives: its own session in an arena or practice room, the driven seat in the
   * playground. Defaults to `sessionId` when absent; `null` means it drives none.
   */
  owned?: string | null;
}

/** The part of a Colyseus `Client` a room hands in: its session, and its view once it has one. */
export interface ViewClient {
  sessionId: string;
  view?: StateView;
}

/**
 * Gives a client its (empty) view if it has none. Every room calls this in `onJoin`, before the
 * joiner's first `update`: a client with no view receives none of the tagged fields.
 */
export function ensureView(client: ViewClient): StateView {
  if (!client.view) client.view = new StateView();
  return client.view;
}

/**
 * The room's clients as viewers. `ownedOf` names the car a client drives (its own session in an
 * arena or practice room, the driven seat in the playground), or `undefined` for none.
 */
export function viewersOf(
  clients: Iterable<ViewClient>,
  ownedOf: (client: ViewClient) => string | undefined,
): Viewer[] {
  const viewers: Viewer[] = [];
  for (const client of clients) {
    viewers.push({ sessionId: client.sessionId, view: ensureView(client), owned: ownedOf(client) ?? null });
  }
  return viewers;
}

/**
 * The tick a room hands `ViewManager.update` (NR47, G5): `state.tick` plus every room tick spent
 * paused. A paused practice or playground room freezes `state.tick` but keeps calling `update` once per
 * room tick; on the frozen tick the hysteresis would never run out, and an object that left vision
 * during the pause would stay in the view until the room resumed. Holding the clock instead keeps the
 * exit at `visionExitMs` of wall time either way. Monotone, so the memory's "last wanted" ticks stay
 * comparable across a pause.
 */
export class ViewClock {
  private heldTicks = 0;

  /** One room tick on which the sim did not advance (`state.paused`). */
  hold(): void {
    this.heldTicks += 1;
  }

  /** The view tick for this `state.tick`. */
  at(stateTick: number): number {
    return stateTick + this.heldTicks;
  }
}

interface ViewerMemory {
  /** Last tick each object currently in this view was WANTED there (in vision, or always-in). */
  lastWanted: Map<object, number>;
  /** The target the client said it is watching (validated when it arrived), or undefined. */
  spectatePick: string | undefined;
}

/** NR47: `NET_CONFIG.visionExitMs` in ticks. */
export function visionExitTicks(): number {
  return msToTicks(NET_CONFIG.visionExitMs);
}

/**
 * NR46: `ceil(max over the ACTIVE chassis of maxSpeed × visionMarginLeadMs)` — about one car length.
 * Reads the active mode's bundle, so it must run inside a mode scope, and never at module scope.
 */
export function visionMarginUnits(): number {
  let fastest = 0;
  for (const id of activeCarIds()) fastest = Math.max(fastest, driveOf(id).maxSpeed);
  return Math.ceil((fastest * NET_CONFIG.visionMarginLeadMs) / 1000);
}

/**
 * G5 (G3 review): the margin a SHOT's sample points are tested against —
 * `ceil(max(fastest projectile in the mode's weapon table, fastest active chassis) × visionMarginLeadMs
 * / 1000)`. A projectile flies at up to 900 u/s against a car's ~284, so the car margin (~71 u) let a
 * fast shot cross it in under one round trip and pop into the drawn cone. Every projectile row counts,
 * carried or not — over-reaching costs a little information, never a pop-in. Beams are not counted: a
 * beam's reach is drawn from its muzzle, which the owner's own visibility already governs. Mode scope
 * only, never module scope.
 */
export function visionShotMarginUnits(): number {
  let fastest = 0;
  for (const id of activeCarIds()) fastest = Math.max(fastest, driveOf(id).maxSpeed);
  for (const def of Object.values(weapons())) {
    if (def.kind === "projectile") fastest = Math.max(fastest, def.speed);
  }
  return Math.ceil((fastest * NET_CONFIG.visionMarginLeadMs) / 1000);
}

/** The fields of an instance row its visibility shape is built from. */
export interface InstanceShapeRow {
  readonly weaponId: string;
  readonly isExplosion: boolean;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly extent: number;
}

/** What the server tests a shot's visibility against: its hitbox as the sim sees it now. */
export function instanceWorldShape(instance: InstanceShapeRow): WorldShape {
  const point: WorldShape = { kind: "circle", x: instance.x, y: instance.y, radius: 0 };
  if (!isWeaponId(instance.weaponId)) return point;
  if (instance.isExplosion && !derived().burstDefs[instance.weaponId]) return point;
  const def = instanceDefOf(instance.weaponId, instance.isExplosion);
  if (def.kind === "maneuver") return point;
  if (def.kind === "beam") {
    // The same reach the client draws (`beamDrawnExtent`): a burst at its spawned extent, a beam
    // clamped to its range.
    const extent = instance.isExplosion
      ? instance.extent
      : Math.min(def.range, Math.max(0, instance.extent));
    return beamShapeAt(def.hitbox, instance.x, instance.y, instance.angle, extent);
  }
  return projectileShapeAt(def.hitbox, instance.x, instance.y, instance.angle);
}

function poseOf(p: PlayerState): Pose {
  return { x: p.x, y: p.y, angle: p.angle };
}

/** What one viewer's view is computed from this update. */
interface Interest {
  /** Cars that are always in (own side and the perspective's side). */
  always: Set<string>;
  /** Cars whose owner-only fields this viewer reads. */
  owners: Set<string>;
  /** Undefined when everything is seen (FOV off, or not in a match). */
  shapes: VisionShape[] | undefined;
  /** The same vision grown by the shot margin, for instances; undefined exactly when `shapes` is. */
  shotShapes: VisionShape[] | undefined;
}

export class ViewManager {
  private readonly memory = new Map<string, ViewerMemory>();

  /**
   * Both options are for tests; a room passes neither, and each is derived per update from the
   * installed mode (`visionExitTicks`, `visionMarginUnits`), so a mode switch moves them.
   */
  constructor(private readonly opts: { exitTicks?: number; marginUnits?: number; shotMarginUnits?: number } = {}) {}

  /** Recompute every viewer's membership for this tick and apply adds/removes to their StateViews. */
  update(state: ArenaState, viewers: readonly Viewer[], tick: number): void {
    const exitTicks = this.opts.exitTicks ?? visionExitTicks();
    let margin: { car: number; shot: number } | undefined;
    const marginUnits = () =>
      (margin ??= {
        car: this.opts.marginUnits ?? visionMarginUnits(),
        shot: this.opts.shotMarginUnits ?? visionShotMarginUnits(),
      });
    const obstacles: readonly Obstacle[] = isArenaId(state.arenaId)
      ? getArena(state.arenaId).obstacles
      : [];
    const fov = camera().fov;
    const hull = { width: drive().carWidth, height: drive().carHeight };
    // A shot's sample points are the same for every viewer: computed once per update, on demand.
    const samples = new Map<WeaponInstanceState, ReturnType<typeof shotSamplePoints>>();
    const samplesOf = (instance: WeaponInstanceState) => {
      let points = samples.get(instance);
      if (!points) {
        points = shotSamplePoints(instanceWorldShape(instance));
        samples.set(instance, points);
      }
      return points;
    };

    for (const viewer of viewers) {
      const view = viewer.view;
      const mem = this.memoryOf(viewer.sessionId);
      const interest = this.interestOf(state, viewer, mem, marginUnits);
      const next = new Map<object, number>();

      // Membership for one object: in at once while wanted; out once unwanted for `exitTicks`.
      const keep = (obj: object, wanted: boolean): boolean => {
        if (wanted) {
          next.set(obj, tick);
          return true;
        }
        const last = mem.lastWanted.get(obj);
        if (last !== undefined && tick - last < exitTicks) {
          next.set(obj, last);
          return true;
        }
        return false;
      };

      // The map itself is a `@view()` field: without it a client decodes `state.weapons` as
      // undefined. Adding it adds every entry it holds; the instance pass below removes the ones
      // this viewer may not have in the same patch, so they never reach it.
      if (!view.has(state.weapons)) view.add(state.weapons);

      state.players.forEach((player, sessionId) => {
        const wanted =
          interest.always.has(sessionId) ||
          interest.shapes === undefined ||
          player.status !== PlayerStatus.IN_MATCH ||
          carVisible(poseOf(player), hull, interest.shapes, obstacles, fov.blockedByObstacles);
        if (keep(player, wanted)) syncCar(view, player, interest.owners.has(sessionId));
        else hideCar(view, player);
      });

      state.weapons.forEach((instance) => {
        const shapes = interest.shotShapes;
        const wanted =
          shapes === undefined ||
          interest.always.has(instance.ownerSessionId) ||
          samplesOf(instance).some((p) =>
            inVision(p, shapes, obstacles, fov.blockedByObstacles),
          );
        if (keep(instance, wanted)) {
          if (!view.has(instance)) view.add(instance);
        } else if (view.has(instance)) {
          view.remove(instance);
        }
      });

      // Objects no longer in the state drop out of the memory with them.
      mem.lastWanted = next;
    }
  }

  /**
   * `MSG_SPECTATE_TARGET` (NR45): the car this viewer's spectate camera shows. Accepted only while
   * the viewer's car is a spectating wreck and `target` is one it may watch under the mode's
   * `camera().spectate` (`spectatableIds`, the client's own cycle rule); anything else is ignored.
   * Returns whether it was accepted. Call inside the room's mode scope.
   */
  pickSpectate(state: ArenaState, viewer: Pick<Viewer, "sessionId" | "owned">, msg: unknown): boolean {
    if (!isSpectateTargetMessage(msg)) return false;
    const ids = this.spectateCycleOf(state, ownedOf(viewer));
    if (ids === undefined || !ids.includes(msg.target)) return false;
    this.memoryOf(viewer.sessionId).spectatePick = msg.target;
    return true;
  }

  /** For tests: the session ids of cars this viewer currently has in view. */
  carsIn(viewerId: string): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const obj of this.memory.get(viewerId)?.lastWanted.keys() ?? []) {
      if (obj instanceof PlayerState) ids.add(obj.sessionId);
    }
    return ids;
  }

  /** For tests: the ids of the weapon instances this viewer currently has in view. */
  shotsIn(viewerId: string): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const obj of this.memory.get(viewerId)?.lastWanted.keys() ?? []) {
      if (obj instanceof WeaponInstanceState) ids.add(obj.id);
    }
    return ids;
  }

  forget(viewerId: string): void {
    this.memory.delete(viewerId);
  }

  private memoryOf(viewerId: string): ViewerMemory {
    let mem = this.memory.get(viewerId);
    if (!mem) {
      mem = { lastWanted: new Map(), spectatePick: undefined };
      this.memory.set(viewerId, mem);
    }
    return mem;
  }

  /** The wreck's spectate cycle, or undefined when this viewer's car is not spectating. */
  private spectateCycleOf(state: ArenaState, owned: string | undefined): string[] | undefined {
    if (owned === undefined) return undefined;
    const car = state.players.get(owned);
    const target = camera().spectate.target;
    if (!car || !isSpectating(state.phase, car.status, car.alive, target)) return undefined;
    const candidates: SpectateCandidate[] = [];
    state.players.forEach((p, sessionId) =>
      candidates.push({ sessionId, status: p.status, alive: p.alive, team: p.team }),
    );
    return spectatableIds(candidates, target, { sessionId: owned, team: car.team });
  }

  private interestOf(
    state: ArenaState,
    viewer: Viewer,
    mem: ViewerMemory,
    marginUnits: () => { car: number; shot: number },
  ): Interest {
    const owned = ownedOf(viewer);
    const sides = rulesOf(state.mode).sides;
    const ownCar = owned === undefined ? undefined : state.players.get(owned);

    // The perspective: the exact car the wreck is showing, else the viewer's own.
    const cycle = this.spectateCycleOf(state, owned);
    if (cycle === undefined) mem.spectatePick = undefined; // the next wreck starts a fresh cycle
    const watching = cycle === undefined ? "" : resolveSpectateTarget(cycle, mem.spectatePick ?? "");
    const perspectiveId = watching || owned;

    const always = new Set<string>();
    const owners = new Set<string>();
    const sideOf = (id: string | undefined, into: Set<string>[]) => {
      if (id === undefined) return;
      const car = state.players.get(id);
      for (const set of into) set.add(id);
      if (!car || sides !== "team") return;
      state.players.forEach((p, sessionId) => {
        if (p.team === car.team) for (const set of into) set.add(sessionId);
      });
    };
    // Own side: in, with the owner tag (rule 1). Perspective's side: in (CB27).
    sideOf(owned, [always, owners]);
    if (watching !== "") {
      owners.add(watching);
      sideOf(watching, [always]);
    }

    const fov = camera().fov;
    if (!fov.enabled || state.phase !== RoomPhase.MATCH) {
      return { always, owners, shapes: undefined, shotShapes: undefined };
    }

    // CB26's vision set, from authoritative poses. `"pov"` freezes the viewer's own wreck where it
    // lies (the server's pose of a dead car is its death pose) — only while watching nobody.
    const perspective = perspectiveId === undefined ? undefined : state.players.get(perspectiveId);
    if (perspectiveId === undefined || !perspective) return { always, owners, shapes: [], shotShapes: [] };
    const players: VisionPlayer[] = [];
    state.players.forEach((p, sessionId) => {
      if (p.status !== PlayerStatus.IN_MATCH) return;
      players.push({ sessionId, team: p.team, alive: p.alive, pose: poseOf(p) });
    });
    const frozen =
      watching === "" && ownCar && camera().spectate.noTargetVision === "pov"
        ? poseOf(ownCar)
        : undefined;
    const poses = visionPoses({
      perspective: { sessionId: perspectiveId, team: perspective.team },
      players,
      sides,
      sharedVision: fov.sharedVision,
      frozenPose: frozen,
    });
    const margin = marginUnits();
    const drawn = poses.map((pose) => visionShapeOf(pose, fov));
    return {
      always,
      owners,
      shapes: drawn.map((shape) => marginShape(shape, margin.car)),
      shotShapes: drawn.map((shape) => marginShape(shape, margin.shot)),
    };
  }
}

function ownedOf(viewer: Pick<Viewer, "sessionId" | "owned">): string | undefined {
  if (viewer.owned === null) return undefined;
  return viewer.owned ?? viewer.sessionId;
}

/** A car in the view: the car, its status rows, and its slot timers iff `owner`. */
function syncCar(view: StateView, player: PlayerState, owner: boolean): void {
  if (!view.has(player)) view.add(player);
  for (const row of player.statuses) {
    if (!view.has(row)) view.add(row);
  }
  if (owner) {
    if (!view.hasTag(player, VIEW_OWNER)) view.add(player, VIEW_OWNER);
    for (const slot of player.weapons) {
      if (!view.hasTag(slot, VIEW_OWNER)) view.add(slot, VIEW_OWNER);
    }
  } else {
    dropOwner(view, player);
  }
}

/** A car out of the view: owner fields first, then every `@view()` field — public facts stay. */
function hideCar(view: StateView, player: PlayerState): void {
  dropOwner(view, player);
  if (view.has(player)) view.remove(player);
}

/**
 * Re-tagging is `remove(obj, VIEW_OWNER)`, which clears only the owner-tagged fields and leaves the
 * car's public and `@view()` fields in place, so nothing flickers.
 */
function dropOwner(view: StateView, player: PlayerState): void {
  if (view.hasTag(player, VIEW_OWNER)) view.remove(player, VIEW_OWNER);
  for (const slot of player.weapons) {
    if (view.hasTag(slot, VIEW_OWNER)) view.remove(slot, VIEW_OWNER);
  }
}
