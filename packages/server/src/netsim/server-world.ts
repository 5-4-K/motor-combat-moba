import {
  ArenaState,
  GameMode,
  MS_PER_TICK,
  NET_CONFIG,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  getArena,
  hpOf,
  isOnField,
  modeConfigOf,
  rulesOf,
  toWorld,
  withMode,
  type CarId,
  type InputMessage,
  type ModeConfig,
  type SimBody,
  type StatusRow,
} from "@motor-combat-moba/shared";
import { respawnSweep, runPipeline, type PipelineCtx } from "../rooms/tick-pipeline.js";
import { newCombatMemory, type CombatMemory } from "../sim/combat-bridge.js";
import { newContactMemory, type ContactMemory } from "../sim/ram-bridge.js";

/** The arena every netsim run plays. */
export const NETSIM_ARENA_ID = "arena-01";
/** Chassis handed out round-robin by seat. */
const NETSIM_CARS: readonly CarId[] = ["mirage", "bullseye", "bastion"];
/** The mode every netsim run plays: respawns, so a spike death does not end the measurement. */
export const NETSIM_MODE = GameMode.FFA_DEATHMATCH;

export interface SnapshotCar {
  id: string;
  body: SimBody;
  alive: boolean;
  lastProcessedInputSeq: number;
  /** Beyond the plan's minimum: what `buildStepContext`/`localModifiers` read off a patched player. */
  carId: string;
  status: number;
  statuses: StatusRow[];
}

/** One patch, as the client decodes it: every player's networked fields at the last completed tick. */
export interface Snapshot {
  tick: number;
  cars: SnapshotCar[];
}

function bodyOf(p: PlayerState): SimBody {
  return {
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
  };
}

/**
 * The real server tick pipeline with no Colyseus around it — the slice of `ArenaRoom` a netsim run
 * needs, driven the way `playtest/modes/shared.ts`'s `ModeWorld` drives it:
 *
 *     state.tick += 1 -> respawnSweep (the mode respawns) -> runPipeline
 *
 * Unlike `ModeWorld` it does NOT inject an idle input into an empty queue: the input path is the
 * live one, so a player whose inputs have not arrived gets exactly what `serverTick` gives them.
 * Every call runs inside `withMode` for the netsim mode's bundle.
 */
export class ServerWorld {
  readonly state = new ArenaState();
  /** Legacy path: today's per-player queues. Phase D replaces this with tick input buffers. */
  readonly inputQueues = new Map<string, InputMessage[]>();
  /** Per car, the (tick time, x, y) truth recorded after every tick. */
  readonly truth = new Map<string, { t: number; x: number; y: number }[]>();
  /** Most `stepSim` calls one car got in the last tick (legacy: min(queue length, maxInputsPerTick)). */
  lastTickMaxSteps = 0;
  /** For each car, the seq → server ms at which that input was FIRST simulated. */
  readonly appliedAt = new Map<string, Map<number, number>>();
  readonly ids: string[] = [];

  private readonly roster = new Set<string>();
  private readonly prevFireMasks = new Map<string, number>();
  private readonly silentTicks = new Map<string, number>();
  private readonly phaseCaps = new Map<string, number>();
  private readonly combat: CombatMemory = newCombatMemory();
  private readonly ram: ContactMemory = newContactMemory();
  readonly modeConfig: ModeConfig;

  constructor(cars: number) {
    this.modeConfig = modeConfigOf(NETSIM_MODE);
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
    this.inputQueues.set(id, []);
    this.roster.add(id);
    this.truth.set(id, [{ t: this.timeOfTick(0), x, y }]);
    this.appliedAt.set(id, new Map());
    this.ids.push(id);
  }

  /** An input message from car `id`'s client arrived: `ArenaRoom`'s input handler, legacy path. */
  receiveInput(id: string, msg: InputMessage): void {
    this.inputQueues.get(id)!.push(msg);
  }

  /** Server time in ms of each completed tick: tick * MS_PER_TICK. */
  timeOfTick(tick: number): number {
    return tick * MS_PER_TICK;
  }

  private ctx(): PipelineCtx {
    return {
      state: this.state,
      inputQueues: this.inputQueues,
      prevFireMasks: this.prevFireMasks,
      silentTicks: this.silentTicks,
      matchRoster: this.roster,
      phaseCaps: this.phaseCaps,
      combat: this.combat,
      ram: this.ram,
      hz: TICK_RATE_HZ,
      runPhaseSweep: rulesOf(this.state.mode).respawns,
    };
  }

  /** One pipeline tick in `ArenaRoom.tick`'s order; records truth, `lastTickMaxSteps`, `appliedAt`. */
  tick(): void {
    withMode(this.modeConfig, () => {
      this.state.tick += 1;
      if (this.state.phase === RoomPhase.MATCH && rulesOf(this.state.mode).respawns) {
        respawnSweep(this.ctx());
      }
      this.recordIntake();
      runPipeline(this.ctx());
      const t = this.timeOfTick(this.state.tick);
      for (const id of this.ids) {
        const p = this.state.players.get(id)!;
        this.truth.get(id)!.push({ t, x: p.x, y: p.y });
      }
    });
  }

  /**
   * What `serverTick` is about to simulate, read off the queues before it drains them: it sorts the
   * batch by seq and steps the first `maxInputsPerTick` — only for a car on the field in `MATCH`
   * (its `ctx !== null` gate). The rest are drained and acked, never stepped.
   */
  private recordIntake(): void {
    let max = 0;
    const now = this.timeOfTick(this.state.tick);
    const moving = this.state.phase === RoomPhase.MATCH;
    for (const id of this.ids) {
      const player = this.state.players.get(id)!;
      const queue = this.inputQueues.get(id) ?? [];
      if (!moving || !isOnField(player) || queue.length === 0) continue;
      const simulated = [...queue].sort((a, b) => a.seq - b.seq).slice(0, NET_CONFIG.maxInputsPerTick);
      max = Math.max(max, simulated.length);
      const applied = this.appliedAt.get(id)!;
      // The FIRST time a seq is simulated is when it took effect; never overwrite it.
      for (const msg of simulated) if (!applied.has(msg.seq)) applied.set(msg.seq, now);
    }
    this.lastTickMaxSteps = max;
  }

  /** The state a patch would carry right now. */
  snapshot(): Snapshot {
    return {
      tick: this.state.tick,
      cars: this.ids.map((id) => {
        const p = this.state.players.get(id)!;
        return {
          id,
          body: bodyOf(p),
          alive: p.alive,
          lastProcessedInputSeq: p.lastProcessedInputSeq,
          carId: p.carId,
          status: p.status,
          statuses: p.statuses.map((s) => ({
            statusId: s.statusId,
            startTick: s.startTick,
            endsTick: s.endsTick,
            sourceSessionId: s.sourceSessionId,
          })),
        };
      }),
    };
  }
}
