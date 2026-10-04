import { Encoder, Reflection, StateView } from "@colyseus/schema";
import {
  NET_CONFIG,
  PlayerStatus,
  camera,
  carVisible,
  drive,
  getArena,
  inVision,
  marginShape,
  msToTicks,
  rulesOf,
  shotSamplePoints,
  visionPoses,
  visionShapeOf,
  type ArenaState,
  type PlayerState,
  type Pose,
  type VisionPlayer,
  type VisionShape,
} from "@motor-combat-moba/shared";
import {
  ViewManager,
  instanceWorldShape,
  visionMarginUnits,
  visionShotMarginUnits,
  type Viewer,
} from "../net/view-manager.js";
import type { Snapshot, SnapshotCar, SnapshotShot } from "./server-world.js";

/**
 * The netsim's FOV run through the REAL wire (Phase G, G5): the room's `ViewManager` decides each
 * client's view every snapshot tick, the schema `Encoder` encodes the state through each client's
 * `StateView` exactly as Colyseus's `SchemaSerializer` does (a joiner gets `encodeAll` +
 * `encodeAllView`, every patch after `encode` + `encodeView`), and each client's snapshot is built
 * from what ITS decoder decoded — so a field the view withheld is absent from that client's
 * snapshot, not merely filtered by the harness. The FOV-off run keeps its plain-object snapshot
 * (`ServerWorld.snapshot`), so its numbers are untouched.
 *
 * Beside the wire it keeps an independent ORACLE of what each client may hold: each viewer's
 * margined vision recomputed from the authoritative state with the shared vision functions, the car
 * margin for cars and the shot margin for shots, held for `visionExitMs` (NR46, NR47). A decoded car
 * with a pose, or a decoded enemy shot, that the oracle does not allow is a LEAK.
 */
export class FovWire {
  private readonly encoder: Encoder<ArenaState>;
  private readonly views: ViewManager;
  private readonly clients: { viewer: Viewer; decoded: ArenaState; dec: { decode(b: Uint8Array): unknown } }[];
  private joined = false;
  /** Client snapshots that decoded a row the oracle did not allow (a leak), over the run. */
  leakSnapshots = 0;
  /** Per viewer, the last snapshot tick each car / shot id was in its margined vision (or always-in). */
  private readonly lastAllowed = new Map<string, Map<string, number>>();

  constructor(
    private readonly state: ArenaState,
    private readonly ids: readonly string[],
    private readonly opts: { shotMarginUnits?: number } = {},
  ) {
    this.encoder = new Encoder(state);
    this.views = new ViewManager({ shotMarginUnits: opts.shotMarginUnits });
    this.clients = ids.map((id) => {
      const dec = Reflection.decode<ArenaState>(Reflection.encode(this.encoder));
      return { viewer: { sessionId: id, view: new StateView(), owned: id }, decoded: dec.state, dec };
    });
    for (const id of ids) this.lastAllowed.set(id, new Map());
  }

  /** The margins the run used (for the report). Mode scope. */
  margins(): { car: number; shot: number } {
    return { car: visionMarginUnits(), shot: this.opts.shotMarginUnits ?? visionShotMarginUnits() };
  }

  /**
   * One snapshot tick: update every view, encode and decode for every client, and return each
   * client's snapshot from its own decoded state, with the oracle's leak count. Mode scope.
   */
  snapshots(): Map<string, Snapshot> {
    const tick = this.state.tick;
    this.views.update(this.state, this.clients.map((c) => c.viewer), tick);
    if (!this.joined) {
      // Every client joins on the first snapshot: the shared full state plus its own view.
      for (const c of this.clients) {
        const it = { offset: 0 };
        const shared = this.encoder.encodeAll(it);
        const buf = new Uint8Array(Encoder.BUFFER_SIZE);
        buf.set(shared.subarray(0, it.offset));
        c.dec.decode(this.encoder.encodeAllView(c.viewer.view, it.offset, { ...it }, buf).slice());
      }
      this.joined = true;
    } else {
      const it = { offset: 0 };
      this.encoder.encode(it);
      const sharedOffset = it.offset;
      for (const c of this.clients) {
        c.dec.decode(this.encoder.encodeView(c.viewer.view, sharedOffset, { offset: sharedOffset }).slice());
      }
    }
    this.encoder.discardChanges();

    const out = new Map<string, Snapshot>();
    for (const c of this.clients) {
      const allowed = this.allowedFor(c.viewer.sessionId, tick);
      const snap = this.snapshotOf(c.viewer.sessionId, c.decoded, tick, allowed);
      if (snap.leak!.cars + snap.leak!.shots > 0) this.leakSnapshots++;
      out.set(c.viewer.sessionId, snap);
    }
    return out;
  }

  private snapshotOf(selfId: string, decoded: ArenaState, tick: number, allowed: Set<string>): Snapshot {
    const cars: SnapshotCar[] = [];
    const hidden: { id: string; alive: boolean }[] = [];
    let leakCars = 0;
    let leakShots = 0;
    for (const id of this.ids) {
      const p = decoded.players.get(id);
      if (!p) continue;
      const posed = p.x !== undefined;
      if (posed && id !== selfId && !allowed.has(id)) leakCars++;
      if (p.inView !== true && id !== selfId) {
        hidden.push({ id, alive: p.alive });
        continue;
      }
      cars.push(carOf(id, p));
    }
    const shots: SnapshotShot[] = [];
    decoded.weapons?.forEach((w, id) => {
      if (w.ownerSessionId !== selfId && !allowed.has(`shot:${id}`)) leakShots++;
      shots.push({
        id,
        ownerSessionId: w.ownerSessionId,
        weaponId: w.weaponId,
        x: w.x,
        y: w.y,
        angle: w.angle,
        extent: w.extent,
        spawnTick: w.spawnTick,
        isExplosion: w.isExplosion,
        lifeOffsetTicks: w.lifeOffsetTicks,
        alive: w.alive,
      });
    });
    return { tick, cars, shots, hidden, leak: { cars: leakCars, shots: leakShots } };
  }

  /**
   * The oracle: every car and shot this viewer may hold at this snapshot tick — in the viewer's
   * margined vision now, or within the last `exitTicks`, or its own. FFA only (the netsim's mode).
   */
  private allowedFor(viewerId: string, tick: number): Set<string> {
    const exitTicks = msToTicks(NET_CONFIG.visionExitMs);
    const memory = this.lastAllowed.get(viewerId)!;
    const fov = camera().fov;
    const obstacles = getArena(this.state.arenaId).obstacles;
    const hull = { width: drive().carWidth, height: drive().carHeight };
    const { car: carMargin, shot: shotMargin } = this.margins();
    const self = this.state.players.get(viewerId)!;
    const players: VisionPlayer[] = [];
    this.state.players.forEach((p, sessionId) => {
      if (p.status === PlayerStatus.IN_MATCH) players.push({ sessionId, team: p.team, alive: p.alive, pose: poseOf(p) });
    });
    const poses = visionPoses({
      perspective: { sessionId: viewerId, team: self.team },
      players,
      sides: rulesOf(this.state.mode).sides,
      sharedVision: fov.sharedVision,
      frozenPose: camera().spectate.noTargetVision === "pov" ? poseOf(self) : undefined,
    });
    const drawn = poses.map((pose) => visionShapeOf(pose, fov));
    const carShapes: VisionShape[] = drawn.map((s) => marginShape(s, carMargin));
    const shotShapes: VisionShape[] = drawn.map((s) => marginShape(s, shotMargin));
    this.state.players.forEach((p, id) => {
      if (id === viewerId || p.status !== PlayerStatus.IN_MATCH || carVisible(poseOf(p), hull, carShapes, obstacles, fov.blockedByObstacles)) {
        memory.set(id, tick);
      }
    });
    this.state.weapons.forEach((w, id) => {
      const mine = w.ownerSessionId === viewerId;
      if (mine || shotSamplePoints(instanceWorldShape(w)).some((pt) => inVision(pt, shotShapes, obstacles, fov.blockedByObstacles))) {
        memory.set(`shot:${id}`, tick);
      }
    });
    const allowed = new Set<string>();
    for (const [key, last] of memory) {
      if (tick - last < exitTicks) allowed.add(key);
      else memory.delete(key);
    }
    return allowed;
  }
}

function poseOf(p: PlayerState): Pose {
  return { x: p.x, y: p.y, angle: p.angle };
}

/** A decoded car as `TickClient` reads it. Owner-only fields of another car decode `undefined`. */
function carOf(id: string, p: PlayerState): SnapshotCar {
  return {
    id,
    body: {
      x: p.x,
      y: p.y,
      angle: p.angle,
      vx: p.vx,
      vy: p.vy,
      angVel: p.angVel,
      maneuver: p.maneuver,
      maneuverTicksLeft: p.maneuverTicksLeft,
      maneuverAngle: p.maneuverAngle,
      maneuverSpeed: p.maneuverSpeed,
    },
    alive: p.alive,
    ackRepeated: p.ackRepeated ?? false,
    inputSlack: p.inputSlack ?? 0,
    inputSlackStd: p.inputSlackStd ?? 0,
    lastSteer: p.lastSteer,
    lastThrottle: p.lastThrottle,
    carId: p.carId,
    status: p.status,
    statuses: (p.statuses ?? []).map((s) => ({
      statusId: s.statusId,
      startTick: s.startTick,
      endsTick: s.endsTick,
      sourceSessionId: s.sourceSessionId,
    })),
    team: p.team,
    fire: {
      weapons: p.weapons.map((w) => ({
        weaponId: w.weaponId,
        stocks: w.stocks ?? 0,
        rechargeEndsTick: w.rechargeEndsTick ?? 0,
        refireLockUntilTick: w.refireLockUntilTick ?? 0,
      })),
      switchLockUntilTick: p.switchLockUntilTick ?? 0,
      pendingUntilTick: p.pendingUntilTick ?? 0,
      lastFiredSlot: p.lastFiredSlot ?? 0,
      level: p.level,
      turretAngle: p.turretAngle ?? 0,
    },
  };
}
