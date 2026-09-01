import {
  RoomPhase,
  getArena,
  hpOf,
  sidesOf,
  DEATHMATCH_TICKS,
  farthestSpawn,
  isDueToRespawn,
  phaseDecision,
  applyStatus,
  newFireState,
  hasStatus,
  carHullOf,
  obbsOverlap,
  isSolid,
  carIdOf,
  type ArenaState,
  type InputMessage,
  type PlayerState,
} from "@motor-combat-moba/shared";
import { serverTick } from "../sim/tick.js";
import {
  applyCombatResult,
  clearInstances,
  runCombat,
  toCombatPlayers,
  toInstances,
  type CombatMemory,
  type CombatResultPlayer,
} from "../sim/combat-bridge.js";
import { readStatuses, statusTick, writeStatuses } from "../sim/status-bridge.js";
import {
  clearKnock,
  contactTick,
  type ContactMemory,
  type ContactTickResult,
} from "../sim/ram-bridge.js";

/**
 * One tick of the simulation, lifted out of `ArenaRoom` so a second room can run the identical
 * pipeline rather than a copy of it. Nothing here decides when a match ends: the caller owns its own
 * win rule and gets back what it needs to run it.
 *
 * Everything the pipeline touches arrives in a `PipelineCtx`. The room still owns the maps and the
 * memory bags — they are long-lived per-room state — and hands them over each tick.
 */
export interface PipelineCtx {
  state: ArenaState;
  inputQueues: Map<string, InputMessage[]>;
  prevFireMasks: Map<string, number>;
  matchRoster: ReadonlySet<string>;
  /**
   * Per-player tick at which spawn protection must end no matter what. Server-only: the client reads
   * the status row's own `endsTick`, and this is the ceiling that row may never pass.
   */
  phaseCaps: Map<string, number>;
  combat: CombatMemory;
  ram: ContactMemory;
  hz: number;
  /**
   * Whether to run `phaseEndSweep` at the end of combat. Not derived from the mode: the playground
   * needs the phased spawn-protection lifecycle without being a deathmatch.
   */
  runPhaseSweep: boolean;
}

/**
 * `statusTick` → `serverTick` → `contactTick` → combat.
 *
 * Returns `runCombat`'s players (or null when combat was skipped) and the fire masks, for the
 * caller's win checks.
 */
export function runPipeline(ctx: PipelineCtx): {
  masks: ReadonlyMap<string, number>;
  combatPlayers: CombatResultPlayer[] | null;
} {
  const state = ctx.state;
  const dt = 1 / ctx.hz;
  // Buffs and debuffs FIRST, before anything reads a modifier. `statusTick` sweeps every expired
  // effect and returns the multipliers driving, ramming and combat all share for this tick, so no
  // two phases can disagree about whether a car is still slowed, and no tick ever simulates an
  // effect whose last tick was the previous one. New effects are only ever added at the far end of
  // the tick, by combat, and take hold on the next one.
  const statusMods = statusTick(state, state.tick);
  const { masks, approachSpeeds } = serverTick(
    state,
    ctx.inputQueues,
    dt,
    state.phase,
    statusMods,
    ctx.prevFireMasks,
  );
  // Contact, after driving and before combat. The order is the rule: contacts are measured against
  // the poses driving actually produced, and the knock written here is read by stepDrive next tick.
  // Dash hits and hard slams it finds this tick are priced by combat below, in phase 0d.
  //
  // `approachSpeeds` is the one thing contact must NOT read from the poses driving produced.
  // Contact resolution reflected `speed` on its way through `serverTick`, so the post-drive value
  // is the rebound, not the impact — see `TickResult.approachSpeeds`.
  let contact: ContactTickResult = { contactHits: [], statusRequests: [] };
  if (state.phase === RoomPhase.MATCH && ctx.matchRoster.size > 0) {
    contact = contactTick(
      state,
      ctx.matchRoster,
      ctx.ram,
      sidesOf(state.mode),
      statusMods,
      approachSpeeds,
      ctx.combat.maneuverWeapons,
      state.tick,
    );
  }
  return { masks, combatPlayers: combatTick(ctx, dt, masks, contact) };
}

/**
 * Combat, after driving. The order is the rule, not an implementation detail: hits are tested
 * against the poses cars actually ended the tick at, not where they were a moment before.
 *
 * Only `MATCH` runs combat, and only with a live roster. Outside that the whole thing is skipped
 * and any instance still in flight is cleared — a shot that survived into the lobby would be
 * drawn to everyone and could never hit anything.
 */
function combatTick(
  ctx: PipelineCtx,
  dt: number,
  masks: ReadonlyMap<string, number>,
  contact: ContactTickResult,
): CombatResultPlayer[] | null {
  const state = ctx.state;
  if (state.phase !== RoomPhase.MATCH || ctx.matchRoster.size === 0) {
    if (state.weapons.size > 0) clearInstances(state, ctx.combat);
    return null;
  }

  const arena = getArena(state.arenaId);
  const result = runCombat({
    world: {
      tick: state.tick,
      dt,
      mode: sidesOf(state.mode),
      obstacles: arena.obstacles,
      bounds: { width: arena.width, height: arena.height },
    },
    players: toCombatPlayers(state, ctx.matchRoster, masks, ctx.combat),
    instances: toInstances(ctx.combat),
    instanceSeq: ctx.combat.instanceSeq,
    contactHits: contact.contactHits,
    statusRequests: contact.statusRequests,
  });

  applyCombatResult(state, result, ctx.combat);
  ctx.combat.instanceSeq = result.instanceSeq;

  if (ctx.runPhaseSweep) phaseEndSweep(ctx, masks);

  return result.players;
}

/**
 * Bring back everyone whose respawn timer has run out.
 *
 * Runs at the TOP of the tick, before `statusTick`, and that placement is the decision (M21):
 * writing the status list here means the modifiers derived moments later already include `phased`,
 * so there is no tick on which a freshly respawned car is solid. The documented `statusRequests`
 * seam is the right route for a pickup and the wrong one here, because by design a request lands
 * this tick and bites on the NEXT one — precisely the window a spawn must not have.
 */
export function respawnSweep(ctx: PipelineCtx): void {
  for (const id of ctx.matchRoster) {
    const player = ctx.state.players.get(id);
    if (!player || player.alive) continue;
    if (!isDueToRespawn(player.diedAtTick, ctx.state.tick)) continue;
    respawnPlayer(ctx, player);
  }
}

/** One car back on the field. Nothing survives a death except the score. */
export function respawnPlayer(ctx: PipelineCtx, player: PlayerState): void {
  const enemies: { x: number; y: number }[] = [];
  for (const id of ctx.matchRoster) {
    if (id === player.sessionId) continue;
    const other = ctx.state.players.get(id);
    if (other?.alive) enemies.push({ x: other.x, y: other.y });
  }

  const spawn = farthestSpawn(getArena(ctx.state.arenaId).ffaSpawns, enemies);
  player.x = spawn.x;
  player.y = spawn.y;
  player.angle = spawn.angle;
  player.speed = 0;
  // Or the car returns already spinning, its steering still degraded by the ram that killed it.
  clearKnock(player);

  const carId = carIdOf(player);
  player.hp = hpOf(carId);
  player.alive = true;
  player.diedAtTick = 0;
  player.killedBySessionId = "";

  // No stock, no switch lock and no half-finished burst carries across a death.
  ctx.combat.fireStates.set(player.sessionId, newFireState(carId, player.level));
  // Or whoever last hurt you before this death is credited with your next one.
  ctx.combat.lastDamagers.set(player.sessionId, "");

  ctx.phaseCaps.set(player.sessionId, ctx.state.tick + DEATHMATCH_TICKS.phaseMax);
  // Applied to an EMPTY list, not to the car's current one: every debuff goes with the wreck, so a
  // lingering slow cannot ride back onto the field with a car that was just rebuilt.
  writeStatuses(
    player,
    applyStatus([], "phased", ctx.state.tick, DEATHMATCH_TICKS.phase, ""),
  );
}

/**
 * End spawn protection, per `phaseDecision`.
 *
 * Runs at the END of the tick, unlike `respawnSweep`, and the asymmetry is deliberate: this needs
 * the fire masks the tick actually simulated and the poses driving finally settled on. A one-tick
 * lag on *ending* protection is harmless; a one-tick lag on *starting* it would leave a car solid
 * on its spawn frame.
 */
export function phaseEndSweep(ctx: PipelineCtx, masks: ReadonlyMap<string, number>): void {
  const tick = ctx.state.tick;
  for (const id of ctx.matchRoster) {
    const player = ctx.state.players.get(id);
    if (!player) continue;

    const rows = readStatuses(player);
    if (!hasStatus(rows, "phased", tick)) {
      ctx.phaseCaps.delete(id);
      continue;
    }
    const phase = rows.find((s) => s.statusId === "phased");
    if (!phase) continue;

    const action = phaseDecision({
      tick,
      endsTick: phase.endsTick,
      capTick: ctx.phaseCaps.get(id) ?? tick,
      fired: (masks.get(id) ?? 0) !== 0,
      overlapping: overlapsSolid(ctx, player),
    });

    if (action === "run") continue;
    if (action === "drop") {
      writeStatuses(player, rows.filter((s) => s.statusId !== "phased"));
      ctx.phaseCaps.delete(id);
      continue;
    }
    // `refresh` extends rather than overwrites, which is what `chainable` exists to permit for a
    // flag-carrying row. Two ticks, so the new end is strictly beyond the one about to lapse.
    writeStatuses(player, applyStatus(rows, "phased", tick, 2, ""));
  }
}

/** Is this car's hull touching any car that is actually solid right now? */
function overlapsSolid(ctx: PipelineCtx, player: PlayerState): boolean {
  const hull = carHullOf(player.x, player.y, player.angle);
  for (const id of ctx.matchRoster) {
    if (id === player.sessionId) continue;
    const other = ctx.state.players.get(id);
    if (!other || !isSolid(other, ctx.state.tick)) continue;
    if (obbsOverlap(hull, carHullOf(other.x, other.y, other.angle))) return true;
  }
  return false;
}
