/**
 * Setup shared by the mode-specific probes under `playtest/modes/<family>/` (Task 15, GM32).
 *
 * `common/world.ts`'s `PlaytestWorld` drives the sim pipeline and nothing else — it has no respawn
 * sweep, no phase sweep and no win check, because the common probes measure the game regardless of
 * mode. A mode probe needs exactly the part it leaves out, so `ModeWorld` below drives the SAME
 * three steps `ArenaRoom.tick` runs, in the same order:
 *
 *     respawnSweep (only if `rulesOf(mode).respawns`) -> runPipeline -> controllerOf(mode).afterTick
 *
 * through the real `rooms/tick-pipeline.ts` and the real `ModeController`. No Colyseus, no sockets,
 * no flow reducer: the probe places cars already in `MATCH`, calls `start()` for the edge into it
 * (`onMatchStart`, as `ArenaRoom.applyFlow` does), and reads the outcome the controller returns
 * where `ArenaRoom` would call `endMatch`.
 *
 * Lives here, not in a family folder, because `run-all.ts` runs every `.ts` in
 * `modes/<family>/` as a probe; this file is a helper, not one.
 */
import {
  ArenaState,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  activeCarIds,
  applyDamage,
  applyStatus,
  fireSlotsOf,
  hasStatus,
  hpOf,
  modeConfigOf,
  modeLabelOf,
  rulesOf,
  slotsOf,
  statusPulseTicksOf,
  toWorld,
  weaponDefOf,
  type CarId,
  type GameMode,
  type InputMessage,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { respawnSweep, runPipeline, type PipelineCtx } from "../../src/rooms/tick-pipeline.js";
import { controllerOf } from "../../src/modes/registry.js";
import type { MatchOutcome, ModeRoomView } from "../../src/modes/types.js";
import { newCombatMemory, type CombatMemory } from "../../src/sim/combat-bridge.js";
import { newContactMemory, type ContactMemory } from "../../src/sim/ram-bridge.js";
import { readStatuses, writeStatuses } from "../../src/sim/status-bridge.js";
import { FAMILY_OF, installPlaytestMode } from "../common/mode.js";
import { IDLE, type SpawnSpec } from "../common/world.js";

/**
 * Install the run's mode (same resolution every common probe uses) and refuse — printing why and
 * exiting 0 — when it is outside this probe's family. Exit 0, not 1: a probe asked about a mode it
 * does not cover has nothing to measure, which is not a broken harness.
 */
export function installFamilyMode(family: string): GameMode {
  const mode = installPlaytestMode();
  if (FAMILY_OF[mode] !== family) {
    console.log(
      `this probe covers the "${family}" family; mode ${modeLabelOf(mode)} is "${FAMILY_OF[mode]}". Nothing to measure.`,
    );
    process.exit(0);
  }
  return mode;
}

/** The arena the mode actually plays first — `ModeTables.arenas`, never a hard-coded id. */
export function arenaOfMode(mode: GameMode): string {
  const first = modeConfigOf(mode).arenas[0];
  if (!first) throw new Error(`mode ${modeLabelOf(mode)} lists no arenas`);
  return first;
}

/** A tick-driven room slice: `ArenaState` plus the maps and memory bags `ArenaRoom` owns. */
export class ModeWorld {
  readonly state = new ArenaState();
  readonly roster = new Set<string>();
  readonly inputQueues = new Map<string, InputMessage[]>();
  readonly prevFireMasks = new Map<string, number>();
  readonly silentTicks = new Map<string, number>();
  readonly phaseCaps = new Map<string, number>();
  readonly combat: CombatMemory = newCombatMemory();
  readonly ram: ContactMemory = newContactMemory();
  /** Set the tick the controller first reports an outcome; `tick()` is a no-op after that. */
  ended: { tick: number; outcome: MatchOutcome } | null = null;
  /**
   * Called after the respawn sweep and before `runPipeline` — the moment whose statuses the tick's
   * driving, contact and combat all read. What a probe samples here is what the tick simulated.
   */
  beforePipeline?: (tick: number) => void;
  private seq = new Map<string, number>();

  constructor(
    readonly mode: GameMode,
    spawns: readonly SpawnSpec[],
    arenaId: string = arenaOfMode(mode),
  ) {
    this.state.mode = mode;
    this.state.arenaId = arenaId;
    this.state.phase = RoomPhase.MATCH;
    for (const spec of spawns) this.add(spec);
  }

  add(spec: SpawnSpec): PlayerState {
    const p = new PlayerState();
    p.sessionId = spec.id;
    p.name = spec.id;
    p.carId = spec.carId;
    p.team = spec.team ?? 0;
    p.status = PlayerStatus.IN_MATCH;
    p.alive = true;
    p.hp = spec.hp ?? hpOf(spec.carId);
    p.x = spec.x;
    p.y = spec.y;
    p.angle = spec.angle;
    const v = toWorld(spec.angle, spec.speed ?? 0, 0);
    p.vx = v.vx;
    p.vy = v.vy;
    this.state.players.set(spec.id, p);
    this.inputQueues.set(spec.id, []);
    this.roster.add(spec.id);
    this.seq.set(spec.id, 0);
    return p;
  }

  get(id: string): PlayerState {
    const p = this.state.players.get(id);
    if (!p) throw new Error(`no player ${id}`);
    return p;
  }

  view(): ModeRoomView {
    return { state: this.state, roster: this.roster };
  }

  ctx(): PipelineCtx {
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

  /** The edge into MATCH, as `ArenaRoom.applyFlow` takes it: stamp the start, then `onMatchStart`. */
  start(): void {
    this.state.matchStartedAtTick = this.state.tick;
    controllerOf(this.state.mode).onMatchStart(this.view());
  }

  /** Queue one input for the next tick. A player with nothing queued gets `IDLE`, as a live client sends. */
  input(id: string, msg: Partial<Omit<InputMessage, "seq">> = {}): void {
    const next = (this.seq.get(id) ?? 0) + 1;
    this.seq.set(id, next);
    this.inputQueues.get(id)?.push({ seq: next, ...IDLE, ...msg });
  }

  /** One tick in `ArenaRoom.tick`'s order. Returns the outcome if the match ended on this tick. */
  tick(): MatchOutcome | undefined {
    if (this.ended) return undefined;
    for (const id of this.roster) {
      if ((this.inputQueues.get(id)?.length ?? 0) === 0) this.input(id);
    }
    this.state.tick += 1;
    if (this.state.phase === RoomPhase.MATCH && rulesOf(this.state.mode).respawns) {
      respawnSweep(this.ctx());
    }
    this.beforePipeline?.(this.state.tick);
    const { combatPlayers } = runPipeline(this.ctx());
    if (!combatPlayers) return undefined;
    const out = controllerOf(this.state.mode).afterTick(this.view(), combatPlayers);
    if (out) this.ended = { tick: this.state.tick, outcome: out };
    return out;
  }

  /** Up to `n` ticks, stopping early if the match ends. `each` runs after every tick. */
  run(n: number, each?: (tick: number) => void): void {
    for (let i = 0; i < n && !this.ended; i++) {
      this.tick();
      each?.(this.state.tick);
    }
  }

  /**
   * A leaver, in `ArenaRoom.onLeave`'s order: gone from `state.players` and the roster FIRST, then
   * the controller reads whatever remains.
   */
  leave(id: string): MatchOutcome | undefined {
    this.state.players.delete(id);
    this.roster.delete(id);
    this.inputQueues.delete(id);
    this.prevFireMasks.delete(id);
    this.silentTicks.delete(id);
    const out = controllerOf(this.state.mode).afterLeave(this.view());
    if (out && !this.ended) this.ended = { tick: this.state.tick, outcome: out };
    return out;
  }

  /** Place a car at rest — the probe's way of driving it somewhere without a route. */
  teleport(id: string, x: number, y: number, angle?: number): void {
    const p = this.get(id);
    p.x = x;
    p.y = y;
    if (angle !== undefined) p.angle = angle;
    p.vx = 0;
    p.vy = 0;
  }

  isPhased(id: string): boolean {
    return hasStatus(readStatuses(this.get(id)), "phased", this.state.tick);
  }
}

/**
 * Arrange for `victimId` to die on the NEXT tick, through the game's own damage path.
 *
 * Writing `hp = 0` straight onto the schema is not a death: `alive` only flips inside combat's
 * `dealDamageTo`, and `applyCombatResult` books the kill (`deaths`, `diedAtTick`, the killer's
 * `kills`) only on that transition. So: `applyDamage` (sim/damage.ts, the only hp writer) takes
 * the car to 1 hp, and an `overheated` row — the one status with a damage pulse — is back-dated so
 * its first pulse lands on the next tick, credited to `killerId`. That pulse runs through
 * `recordDamage` → `dealDamageTo` → `applyDamage` like any bullet, so the win check, the kill
 * booking and the respawn timer all see an ordinary death.
 */
export function killNextTick(w: ModeWorld, victimId: string, killerId: string): void {
  const interval = statusPulseTicksOf("overheated");
  // `StatusState.startTick` is a uint32 on the schema: a back-dated start below 0 would wrap to
  // ~4e9 and the pulse would never land. Idle forward until the back-date fits.
  while (w.state.tick + 1 - interval < 1 && !w.ended) w.tick();
  const victim = w.get(victimId);
  victim.hp = applyDamage(victim.hp, victim.hp - 1);
  const startTick = w.state.tick + 1 - interval;
  writeStatuses(victim, applyStatus(readStatuses(victim), "overheated", startTick, interval + 5, killerId));
}

/** Every ability-slot projectile an active chassis can press, with its carrier and fire-slot bit. */
export function projectileAbilities(): { weaponId: WeaponId; carId: CarId; bit: number }[] {
  const out: { weaponId: WeaponId; carId: CarId; bit: number }[] = [];
  for (const carId of activeCarIds()) {
    for (const weaponId of slotsOf(carId)) {
      if (weaponDefOf(weaponId).kind !== "projectile") continue;
      out.push({ weaponId, carId, bit: 1 << fireSlotsOf(carId).indexOf(weaponId) });
    }
  }
  return out;
}

/**
 * The five run-up distances a single-shot scenario is swept over: `base` plus fifths of one tick of
 * the projectile's travel, so the shot meets its target at five different sub-tick phases.
 */
export function subTickOffsets(base: number, unitsPerTick: number): number[] {
  return [0, 1, 2, 3, 4].map((k) => base + (k * unitsPerTick) / 5);
}
