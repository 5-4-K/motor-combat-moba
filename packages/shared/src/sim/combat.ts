import { CAR_TABLE } from "../config/car-config.js";
import { COMBAT_CONFIG } from "../config/combat-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { WEAPON_CONFIG } from "../config/weapon-config.js";
import { TICK_RATE_HZ } from "../constants.js";
import { obbsOverlap, type Aabb, type Bounds } from "./collide.js";
import { carHullOf, carIdOf } from "./context.js";
import { applyDamage } from "./damage.js";
import {
  canDamage,
  projectileExpired,
  projectileHitsCar,
  projectileHitsObstacle,
  stepProjectile,
  type Proj,
} from "./projectiles.js";
import { isRamming, ramDamage, ramOutcome } from "./ram.js";

/**
 * One player as the combat step sees them. Plain data on purpose: the room maps `PlayerState` onto
 * this and back, so combat can be tested without standing up a Colyseus room.
 *
 * `fired` is "this player pressed fire on an input the server actually simulated this tick", not the
 * raw key state — see `serverTick`, which reports it. The weapon cooldown, not the key, is what
 * gates the rate, so holding the key and tapping it fire at the same speed.
 */
export interface CombatPlayer {
  sessionId: string;
  x: number;
  y: number;
  angle: number;
  team: 0 | 1;
  carId: string;
  hp: number;
  alive: boolean;
  weaponCooldown: number;
  inRoster: boolean;
  fired: boolean;
}

/** Everything about the tick that is the same for every player in it. */
export interface CombatWorld {
  tick: number;
  dt: number;
  mode: "ffa" | "team";
  obstacles: readonly Aabb[];
  bounds: Bounds;
}

export interface CombatInput {
  world: CombatWorld;
  players: readonly CombatPlayer[];
  projectiles: readonly Proj[];
  /** `"idA|idB"` (session ids sorted) to the tick at which that pair may deal ram damage again. */
  ramCooldowns: ReadonlyMap<string, number>;
  /** Monotonic counter behind projectile ids. Carried in and back out so ids never repeat. */
  projectileSeq: number;
}

export interface CombatResult {
  players: CombatPlayer[];
  projectiles: Proj[];
  ramCooldowns: Map<string, number>;
  projectileSeq: number;
}

/** Ticks between shots, from the weapon's fire rate. At 30 Hz and 2 Hz that is 15. */
export function fireCooldownTicks(): number {
  return Math.ceil(TICK_RATE_HZ / WEAPON_CONFIG.fireRateHz);
}

/** How far ahead of the car's centre a shot is born: the front face of its hull. */
export function muzzleOffset(): number {
  return DRIVE_CONFIG.carWidth / 2;
}

/**
 * One tick of combat: cooldowns, shots fired, shots flown, shots landed, rams. Pure — inputs are
 * never mutated, and the result is a fresh set of players, projectiles, and cooldowns for the caller
 * to write back.
 *
 * This runs *after* driving has resolved for the tick, so every hit test reads the poses cars
 * actually ended up at. That ordering is what makes ramming legible: you are damaged by where the
 * other car is now, not by where it was before the collision pushed it off you.
 *
 * The whole step is server-only. The client draws `state.projectiles` and never predicts a shot or
 * an hp change: a mispredicted bullet is a phantom kill, and there is no reconciliation story for
 * "you were dead for 80ms". Prediction covers the local car's motion and nothing else.
 *
 * Hits are tested against the current tick with no lag compensation. A shooter on 80ms therefore has
 * to lead a moving target by roughly their own latency. Rewind-and-replay hit testing is the
 * standard fix and is deliberately out of scope for v1.
 *
 * Everything iterates in sorted `sessionId` order for the same reason `serverTick` does: a
 * projectile that could hit two overlapping cars must always pick the same one.
 */
export function runCombat(input: CombatInput): CombatResult {
  const { world } = input;
  const players = input.players
    .map((p) => ({ ...p }))
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  const byId = new Map(players.map((p) => [p.sessionId, p]));

  let projectileSeq = input.projectileSeq;
  const cooldownTicks = fireCooldownTicks();
  const nose = muzzleOffset();

  // Cooldowns first, so a player whose cooldown expires on this tick may fire on this tick.
  for (const player of players) {
    if (!isFighting(player)) continue;
    if (player.weaponCooldown > 0) player.weaponCooldown -= 1;
  }

  // Existing shots fly before new ones are born, so a fresh shot is drawn at the muzzle rather than
  // a tick's travel beyond it.
  const projectiles: Proj[] = input.projectiles.map((p) => stepProjectile(p, world.dt));

  for (const player of players) {
    if (!player.fired) continue;
    if (!isFighting(player)) continue;
    // `carId === ""` is a player who has not been through the reveal: no chassis, no weapon.
    if (player.carId === "" || player.weaponCooldown > 0) continue;

    projectileSeq += 1;
    projectiles.push({
      id: `${player.sessionId}-${projectileSeq}`,
      ownerSessionId: player.sessionId,
      x: player.x + Math.cos(player.angle) * nose,
      y: player.y + Math.sin(player.angle) * nose,
      angle: player.angle,
      speed: WEAPON_CONFIG.projectileSpeed,
      spawnTick: world.tick,
      alive: true,
    });
    player.weaponCooldown = cooldownTicks;
  }

  const survivors: Proj[] = [];
  for (const projectile of projectiles) {
    if (projectileExpired(projectile, world.tick, WEAPON_CONFIG.lifetimeTicks)) continue;
    if (projectileHitsObstacle(projectile, world.obstacles, world.bounds)) continue;

    const owner = byId.get(projectile.ownerSessionId);
    const target = firstTargetHit(projectile, players, owner?.team ?? 0, world.mode);
    if (!target) {
      survivors.push(projectile);
      continue;
    }
    // One shot, one target: the projectile is spent on the first car it reaches, so a line of cars
    // is never swept by a single bullet.
    damage(target, WEAPON_CONFIG.damage);
  }

  const ramCooldowns = pruneCooldowns(input.ramCooldowns, world.tick);
  for (let i = 0; i < players.length; i++) {
    const a = players[i]!;
    if (!isFighting(a)) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j]!;
      if (!isFighting(b)) continue;

      const key = `${a.sessionId}|${b.sessionId}`;
      if (world.tick < (ramCooldowns.get(key) ?? 0)) continue;
      if (!obbsOverlap(carHullOf(a.x, a.y, a.angle), carHullOf(b.x, b.y, b.angle))) continue;

      const threshold = COMBAT_CONFIG.ramDotThreshold;
      const outcome = ramOutcome(
        isRamming(a.x, a.y, a.angle, b.x, b.y, threshold),
        isRamming(b.x, b.y, b.angle, a.x, a.y, threshold),
      );
      if (outcome === "none") continue;

      // Both halves of a head-on are dealt from the pre-hit state, so the car that dies still trades
      // its damage. There is no first-strike advantage in a mutual ram.
      if (outcome === "both" || outcome === "a_hits_b") damage(b, ramDamageOf(a));
      if (outcome === "both" || outcome === "b_hits_a") damage(a, ramDamageOf(b));
      // Set on any damaging contact, including a one-sided one: the cooldown is per *pair*, so a car
      // grinding along another cannot drain hp at 30 Hz.
      ramCooldowns.set(key, world.tick + COMBAT_CONFIG.collisionDamageCooldownTicks);
    }
  }

  return { players, projectiles: survivors, ramCooldowns, projectileSeq };
}

/** In the match and not yet a wreck: the gate for firing, being shot, and ramming alike. */
function isFighting(player: CombatPlayer): boolean {
  return player.inRoster && player.alive;
}

/**
 * The first car this shot may damage, in sorted `sessionId` order. Deliberately not "the nearest":
 * a shot is a point, so it is inside at most one hull in every case that is not already two cars
 * overlapping, and a fixed order is reproducible where a distance tie-break is not.
 */
function firstTargetHit(
  projectile: Proj,
  players: readonly CombatPlayer[],
  ownerTeam: 0 | 1,
  mode: "ffa" | "team",
): CombatPlayer | null {
  for (const player of players) {
    if (!isFighting(player)) continue;
    if (!canDamage(projectile.ownerSessionId, ownerTeam, player.sessionId, player.team, mode)) {
      continue;
    }
    if (projectileHitsCar(projectile, carHullOf(player.x, player.y, player.angle))) return player;
  }
  return null;
}

/** The only writer of `hp` and `alive`. 0 hp is the wreck: the car stays on the field, inert. */
function damage(player: CombatPlayer, amount: number): void {
  player.hp = applyDamage(player.hp, amount);
  if (player.hp === 0) player.alive = false;
}

function ramDamageOf(attacker: CombatPlayer): number {
  const strength = CAR_TABLE[carIdOf(attacker)].strength;
  return ramDamage(strength, COMBAT_CONFIG.collisionDamagePerStrength);
}

/**
 * Carry forward only the cooldowns that are still holding anything back. Without this the map grows
 * one entry per pair that ever touched and is never emptied for the life of the room.
 */
function pruneCooldowns(cooldowns: ReadonlyMap<string, number>, tick: number): Map<string, number> {
  const next = new Map<string, number>();
  for (const [key, until] of cooldowns) {
    if (until > tick) next.set(key, until);
  }
  return next;
}
