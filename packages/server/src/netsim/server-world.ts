import {
  ArenaState,
  GameMode,
  MS_PER_TICK,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  getArena,
  hpOf,
  modeConfigOf,
  newCombatEvents,
  newTickInputBuffer,
  rulesOf,
  toWorld,
  withMode,
  type CarId,
  type CombatEvents,
  type InputPacket,
  type ModeConfig,
  type SimBody,
  type StatusRow,
  type TickInputBuffer,
} from "@motor-combat-moba/shared";
import { respawnSweep, runPipeline, type PipelineCtx } from "../rooms/tick-pipeline.js";
import { NetSessions } from "../net/net-session.js";
import { newCombatMemory, type CombatMemory } from "../sim/combat-bridge.js";
import { newContactMemory, type ContactMemory } from "../sim/ram-bridge.js";
import { fovOnBundle } from "../net/fov-bundle.js";
import { FovWire } from "./fov-wire.js";

/** The arena every netsim run plays. */
export const NETSIM_ARENA_ID = "arena-01";
/** Chassis handed out round-robin by seat. */
const NETSIM_CARS: readonly CarId[] = ["mirage", "bullseye", "bastion"];
/**
 * A one-tick velocity change, u/s, past anything the drive model makes on its own (a car's whole
 * engine accel is a few u/s per tick): a ram, a slam, a dash start or a stun (M1 diagnostic).
 */
const KICK_DV = 40;

/** The mode every netsim run plays: respawns, so a spike death does not end the measurement. */
export const NETSIM_MODE = GameMode.FFA_DEATHMATCH;

export interface SnapshotCar {
  id: string;
  body: SimBody;
  alive: boolean;
  /** Owner-only on the wire (NR26): whether this tick ran the car on a repeated or neutral input. */
  ackRepeated: boolean;
  /** Owner-only on the wire (NR21): the server's mean input slack for this car, in ticks. */
  inputSlack: number;
  /** Owner-only on the wire (D5 ruling E): the spread of those same slack samples, in ticks. */
  inputSlackStd: number;
  /** The input the server consumed for this car on this tick (NR33): what dead reckoning steps with. */
  lastSteer: number;
  lastThrottle: number;
  /** Beyond the plan's minimum: what `buildStepContext`/`localModifiers` read off a patched player. */
  carId: string;
  status: number;
  statuses: StatusRow[];
  team: number;
  /** The fire fields `ArenaScene.reconcileLocal` reseeds `LocalFire` from (NR39). */
  fire: {
    weapons: { weaponId: string; stocks: number; rechargeEndsTick: number; refireLockUntilTick: number }[];
    switchLockUntilTick: number;
    pendingUntilTick: number;
    lastFiredSlot: number;
    level: number;
    turretAngle: number;
  };
}

/** One weapon instance row as a patch carries it (`WeaponInstanceState`). */
export interface SnapshotShot {
  id: string;
  ownerSessionId: string;
  weaponId: string;
  x: number;
  y: number;
  angle: number;
  extent: number;
  spawnTick: number;
  isExplosion: boolean;
  lifeOffsetTicks: number;
  /** `false` on an ENDED row: a shot that ended on its own birth tick, sent at its end pose (protocol 5). */
  alive: boolean;
}

/** One patch, as the client decodes it: every player's networked fields at the last completed tick. */
export interface Snapshot {
  tick: number;
  /** Every car this client has in view (the FOV run), or every car (FOV off). */
  cars: SnapshotCar[];
  /** `state.weapons`: every live instance (Phase F, F5 — the netsim's cars fire), as this client holds it. */
  shots: SnapshotShot[];
  /**
   * The FOV run only (`FovWire`): the cars on the field this client's view does NOT hold — their
   * public `alive` alone, which is all a hidden car decodes to (NR42).
   */
  hidden?: { id: string; alive: boolean }[];
  /** The FOV run only: decoded rows the vision oracle did not allow — a car with a pose, an enemy shot. */
  leak?: { cars: number; shots: number };
}

/** One press the server committed (`runCombat`'s `fired` event) and the shot compensation it carried. */
export interface ServerPress {
  sessionId: string;
  tick: number;
  slot: number;
  weaponId: string;
  /** `compTicks` for this press (NR36): 0 when it got none. */
  k: number;
}

/**
 * A `float32` schema field as the client decodes it (NR52). The netsim hands snapshots over as plain
 * objects rather than through the schema encoder, so it narrows each `float32` field itself, exactly
 * where the wire would: the server's own state keeps full precision.
 */
const f32 = Math.fround;

/** The car's `SimBody` as a patch carries it: pose, velocity and the maneuver angle/speed float32. */
function bodyOf(p: PlayerState): SimBody {
  return {
    x: f32(p.x),
    y: f32(p.y),
    angle: f32(p.angle),
    vx: f32(p.vx),
    vy: f32(p.vy),
    angVel: f32(p.angVel),
    maneuver: p.maneuver,
    maneuverTicksLeft: p.maneuverTicksLeft,
    maneuverAngle: f32(p.maneuverAngle),
    maneuverSpeed: f32(p.maneuverSpeed),
  };
}

/**
 * The real server tick pipeline with no Colyseus around it — the slice of `ArenaRoom` a netsim run
 * needs, driven the way `playtest/modes/shared.ts`'s `ModeWorld` drives it:
 *
 *     state.tick += 1 -> respawnSweep (the mode respawns) -> runPipeline
 *
 * Unlike `ModeWorld` it does NOT offer an idle input for a car its client has not fed: the input
 * path is the live one, so a player whose frame has not arrived gets exactly what its
 * `TickInputBuffer` gives it — the repeat, then neutral. Every call runs inside `withMode` for the
 * netsim mode's bundle.
 */
export class ServerWorld {
  readonly state = new ArenaState();
  /** Each car's inputs keyed by the tick they are for (NR22): `ArenaRoom.inputBuffers`. */
  readonly inputBuffers = new Map<string, TickInputBuffer>();
  /** Per car, the (tick time, x, y, angle, alive) truth recorded after every tick. */
  readonly truth = new Map<string, { t: number; x: number; y: number; angle: number; alive: boolean }[]>();
  /** Most `stepSim` calls one car got in the last tick, as `runPipeline` counted them (NR17). */
  lastTickMaxSteps = 0;
  /** For each car, the tick → server ms at which the client's own frame for that tick was simulated. */
  readonly appliedAt = new Map<string, Map<number, number>>();
  /**
   * Per car, the tick times its motion was KICKED (Phase F final review M1 diagnostic): its maneuver
   * kind changed (a dash, slam or HOLD starting or ending), or its velocity changed by more than
   * `KICK_DV` in one tick (a ram or slam impulse, a stun stopping it dead) — the events a remote's
   * dead reckoning cannot foresee.
   */
  readonly kicks = new Map<string, number[]>();
  private readonly lastMotion = new Map<string, { vx: number; vy: number; maneuver: number }>();
  /** Car-ticks that stepped a car, and how many of those ran on a repeated or neutral input (NR22). */
  steppedCarTicks = 0;
  repeatedCarTicks = 0;
  /** Every press the server committed, with its shot compensation (F5). */
  readonly presses: ServerPress[] = [];
  /**
   * The room's time-sync state, answering `MSG_TIME` exactly as `installNetHandlers` does. Each tick is
   * marked at its due time on the harness clock, which here is also the server's wall clock.
   */
  readonly sessions = new NetSessions();
  readonly ids: string[] = [];

  private readonly roster = new Set<string>();
  private readonly prevFireMasks = new Map<string, number>();
  private readonly phaseCaps = new Map<string, number>();
  private readonly combat: CombatMemory = newCombatMemory();
  private readonly ram: ContactMemory = newContactMemory();
  /** This tick's combat observations, read back for `presses` and then dropped. */
  private events: CombatEvents = newCombatEvents();
  readonly modeConfig: ModeConfig;
  /**
   * The truth the phantom-impact counter is scored against (G5): each weapon instance id -> the tick
   * the SIM ended it — it left the combat memory's live set, or was born already over (an ended row
   * that was never live). Read from `CombatMemory`, never from the rows, so a row that merely left a
   * view can never count as an ending.
   */
  readonly endedAt = new Map<string, number>();
  /** The FOV run's real wire (`NetsimOptions.fov`); undefined for the FOV-off run. */
  readonly fov: FovWire | undefined;

  constructor(cars: number, opts: { fov?: boolean; shotMarginUnits?: number } = {}) {
    this.modeConfig = opts.fov ? fovOnBundle(NETSIM_MODE) : modeConfigOf(NETSIM_MODE);
    withMode(this.modeConfig, () => {
      this.state.mode = NETSIM_MODE;
      this.state.arenaId = NETSIM_ARENA_ID;
      this.state.phase = RoomPhase.MATCH;
      const spawns = getArena(NETSIM_ARENA_ID).ffaSpawns;
      for (let i = 0; i < cars; i++) {
        const spawn = spawns[i % spawns.length]!;
        this.add(`p${i}`, NETSIM_CARS[i % NETSIM_CARS.length]!, spawn.x, spawn.y, spawn.angle);
      }
    });
    this.fov = opts.fov ? new FovWire(this.state, this.ids, { shotMarginUnits: opts.shotMarginUnits }) : undefined;
  }

  /**
   * Each client's snapshot of the tick just run: the FOV run's from its own decoded state
   * (`FovWire`), the FOV-off run's one shared `snapshot()`.
   */
  snapshots(): Map<string, Snapshot> {
    if (this.fov) {
      const wire = this.fov;
      return withMode(this.modeConfig, () => wire.snapshots());
    }
    const snap = this.snapshot();
    return new Map(this.ids.map((id) => [id, snap]));
  }

  private add(id: string, carId: CarId, x: number, y: number, angle: number): void {
    const p = new PlayerState();
    p.sessionId = id;
    p.name = id;
    p.carId = carId;
    p.team = 0;
    p.status = PlayerStatus.IN_MATCH;
    p.alive = true;
    p.hp = hpOf(carId);
    p.x = x;
    p.y = y;
    p.angle = angle;
    const v = toWorld(angle, 0, 0);
    p.vx = v.vx;
    p.vy = v.vy;
    this.state.players.set(id, p);
    this.inputBuffers.set(id, newTickInputBuffer());
    this.roster.add(id);
    this.truth.set(id, [{ t: this.timeOfTick(0), x, y, angle, alive: true }]);
    this.appliedAt.set(id, new Map());
    this.ids.push(id);
  }

  /** An input packet from car `id`'s client arrived: `ArenaRoom`'s input handler. */
  receiveInput(id: string, msg: InputPacket): void {
    const buffer = this.inputBuffers.get(id)!;
    for (const frame of msg.inputs) buffer.offer(frame, this.state.tick);
  }

  /** Server time in ms of each completed tick: tick * MS_PER_TICK. */
  timeOfTick(tick: number): number {
    return tick * MS_PER_TICK;
  }

  private ctx(): PipelineCtx {
    return {
      state: this.state,
      inputBuffers: this.inputBuffers,
      prevFireMasks: this.prevFireMasks,
      matchRoster: this.roster,
      phaseCaps: this.phaseCaps,
      combat: this.combat,
      ram: this.ram,
      hz: TICK_RATE_HZ,
      runPhaseSweep: rulesOf(this.state.mode).respawns,
      // The room's own pricing seam (NR36): each session's compensation RTT, measured from the
      // `MSG_PING` echoes the run carries over the links (no transport ping: an honest client's
      // would read the same, so `compRttMs` is the app RTT).
      rttMsOf: (id) => this.sessions.compRttMs(id),
      events: this.events,
    };
  }

  /**
   * One pipeline tick in `ArenaRoom.tick`'s order; records truth, and — from what `runPipeline`
   * reports it actually did — `lastTickMaxSteps`, `appliedAt` and the repeated-input counts.
   */
  tick(): void {
    withMode(this.modeConfig, () => {
      this.state.tick += 1;
      if (this.state.phase === RoomPhase.MATCH && rulesOf(this.state.mode).respawns) {
        respawnSweep(this.ctx());
      }
      this.events = newCombatEvents();
      const liveBefore = [...this.combat.instances.keys()];
      const { steps, compTicks } = runPipeline(this.ctx());
      for (const id of liveBefore) {
        if (!this.combat.instances.has(id) && !this.endedAt.has(id)) this.endedAt.set(id, this.state.tick);
      }
      this.state.weapons.forEach((w, id) => {
        if (!w.alive && !this.combat.instances.has(id) && !this.endedAt.has(id)) this.endedAt.set(id, this.state.tick);
      });
      for (const e of this.events.fired) {
        this.presses.push({
          sessionId: e.shooterSessionId,
          tick: e.tick,
          slot: e.slot,
          weaponId: e.weaponId,
          k: compTicks.get(e.shooterSessionId) ?? 0,
        });
      }
      const t = this.timeOfTick(this.state.tick);
      let max = 0;
      for (const id of this.ids) {
        const p = this.state.players.get(id)!;
        this.truth.get(id)!.push({ t, x: p.x, y: p.y, angle: p.angle, alive: p.alive });
        const was = this.lastMotion.get(id);
        if (was && p.alive && (was.maneuver !== p.maneuver || Math.hypot(p.vx - was.vx, p.vy - was.vy) > KICK_DV)) {
          let list = this.kicks.get(id);
          if (!list) this.kicks.set(id, (list = []));
          list.push(t);
        }
        this.lastMotion.set(id, { vx: p.vx, vy: p.vy, maneuver: p.maneuver });
        const n = steps.get(id) ?? 0;
        max = Math.max(max, n);
        if (n === 0) continue;
        this.steppedCarTicks++;
        if (p.ackRepeated) this.repeatedCarTicks++;
        else this.appliedAt.get(id)!.set(this.state.tick, t);
      }
      this.lastTickMaxSteps = max;
      this.sessions.markTick(this.state.tick, t);
    });
  }

  /** The state a patch would carry right now. */
  snapshot(): Snapshot {
    const shots: SnapshotShot[] = [];
    this.state.weapons.forEach((w) => {
      shots.push({
        id: w.id,
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
    return {
      tick: this.state.tick,
      shots,
      cars: this.ids.map((id) => {
        const p = this.state.players.get(id)!;
        return {
          id,
          body: bodyOf(p),
          alive: p.alive,
          ackRepeated: p.ackRepeated,
          inputSlack: f32(p.inputSlack),
          inputSlackStd: f32(p.inputSlackStd),
          lastSteer: p.lastSteer,
          lastThrottle: p.lastThrottle,
          carId: p.carId,
          status: p.status,
          statuses: p.statuses.map((s) => ({
            statusId: s.statusId,
            startTick: s.startTick,
            endsTick: s.endsTick,
            sourceSessionId: s.sourceSessionId,
          })),
          team: p.team,
          fire: {
            weapons: p.weapons.map((w) => ({
              weaponId: w.weaponId,
              stocks: w.stocks,
              rechargeEndsTick: w.rechargeEndsTick,
              refireLockUntilTick: w.refireLockUntilTick,
            })),
            switchLockUntilTick: p.switchLockUntilTick,
            pendingUntilTick: p.pendingUntilTick,
            lastFiredSlot: p.lastFiredSlot,
            level: p.level,
            turretAngle: f32(p.turretAngle),
          },
        };
      }),
    };
  }
}
