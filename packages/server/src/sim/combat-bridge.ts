import {
  ProjectileState,
  runCombat,
  type ArenaState,
  type CombatPlayer,
  type CombatResult,
  type Proj,
} from "@motor-combat-moba/shared";

/**
 * The schema half of combat: read `ArenaState` into plain objects, run the pure `runCombat`, write
 * the answer back.
 *
 * The split is deliberate. `runCombat` is where every rule lives and it can be tested without a
 * Colyseus room; this file is the only place that knows about `MapSchema`, and it holds no rules at
 * all. Anything resembling a decision — who may be hit, what a ram costs — belongs on the other side
 * of this boundary, in `@motor-combat-moba/shared`.
 */

/** Room-owned state that lives across ticks but is deliberately never networked. */
export interface CombatMemory {
  /** `"idA|idB"` to the tick that pair may deal ram damage again. Server-only: clients never see it. */
  ramCooldowns: Map<string, number>;
  /** Monotonic across the room's whole life, so a re-used session id cannot re-use a projectile id. */
  projectileSeq: number;
}

export function newCombatMemory(): CombatMemory {
  return { ramCooldowns: new Map(), projectileSeq: 0 };
}

/**
 * Players as combat sees them. Only roster members are marked `inRoster`, which is what gates
 * firing, being hit, and ramming — a lobby player standing in the room is not part of the fight.
 */
export function toCombatPlayers(
  state: ArenaState,
  roster: ReadonlySet<string>,
  fired: ReadonlySet<string>,
): CombatPlayer[] {
  const players: CombatPlayer[] = [];
  state.players.forEach((player, sessionId) => {
    players.push({
      sessionId,
      x: player.x,
      y: player.y,
      angle: player.angle,
      team: player.team === 1 ? 1 : 0,
      carId: player.carId,
      hp: player.hp,
      alive: player.alive,
      weaponCooldown: player.weaponCooldown,
      inRoster: roster.has(sessionId),
      fired: fired.has(sessionId),
    });
  });
  return players;
}

export function toProjectiles(state: ArenaState): Proj[] {
  const projectiles: Proj[] = [];
  state.projectiles.forEach((p) => {
    projectiles.push({
      id: p.id,
      ownerSessionId: p.ownerSessionId,
      x: p.x,
      y: p.y,
      angle: p.angle,
      speed: p.speed,
      spawnTick: p.spawnTick,
      alive: p.alive,
    });
  });
  return projectiles;
}

/**
 * Write a combat result back onto the schema.
 *
 * Only the three fields combat owns — `hp`, `alive`, `weaponCooldown` — are copied onto players.
 * Poses are *not* written back: driving already set them this tick, and combat never moves a car.
 * Copying them anyway would make a stale POJO silently authoritative over the sim.
 *
 * Projectiles are diffed rather than cleared and refilled: a `MapSchema` emptied and repopulated
 * every tick patches every shot to every client every tick, which is precisely the bandwidth the
 * patch rate exists to avoid.
 */
export function applyCombatResult(state: ArenaState, result: CombatResult): void {
  for (const p of result.players) {
    const player = state.players.get(p.sessionId);
    if (!player) continue;
    player.hp = p.hp;
    player.alive = p.alive;
    player.weaponCooldown = p.weaponCooldown;
  }

  const live = new Set(result.projectiles.map((p) => p.id));
  const stale: string[] = [];
  state.projectiles.forEach((_, id) => {
    if (!live.has(id)) stale.push(id);
  });
  for (const id of stale) state.projectiles.delete(id);

  for (const p of result.projectiles) {
    let projectile = state.projectiles.get(p.id);
    if (!projectile) {
      projectile = new ProjectileState();
      projectile.id = p.id;
      projectile.ownerSessionId = p.ownerSessionId;
      projectile.angle = p.angle;
      projectile.speed = p.speed;
      projectile.spawnTick = p.spawnTick;
      state.projectiles.set(p.id, projectile);
    }
    projectile.x = p.x;
    projectile.y = p.y;
    projectile.alive = p.alive;
  }
}

/** Clear every shot in flight. Called when a match ends or a new one is set up. */
export function clearProjectiles(state: ArenaState): void {
  const ids: string[] = [];
  state.projectiles.forEach((_, id) => ids.push(id));
  for (const id of ids) state.projectiles.delete(id);
}

export { runCombat };
