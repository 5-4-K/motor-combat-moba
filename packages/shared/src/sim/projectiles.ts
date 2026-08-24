import { pointInAabb, pointInObb, type Aabb, type Bounds, type Obb } from "./collide.js";

/**
 * One shot in flight. The plain-object mirror of `ProjectileState`: the sim reasons about these, the
 * room maps them onto the schema. `speed` is world units per **second**, matching
 * `WEAPON_CONFIG.projectileSpeed` and the `dt` every other sim function takes.
 *
 * `spawnTick` is what the lifetime is measured against, so a shot expires the same number of ticks
 * after firing regardless of how the room's tick counter is doing.
 */
export interface Proj {
  id: string;
  ownerSessionId: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  spawnTick: number;
  alive: boolean;
}

/**
 * One tick of flight. Straight line, no drag and no gravity: a shot's whole trajectory is fixed at
 * the muzzle, which is what makes leading a moving target a skill rather than a guess.
 *
 * Pure — the input is never mutated, so the caller decides whether a stepped shot survives the
 * hit tests that follow.
 */
export function stepProjectile(p: Proj, dt: number): Proj {
  return {
    ...p,
    x: p.x + Math.cos(p.angle) * p.speed * dt,
    y: p.y + Math.sin(p.angle) * p.speed * dt,
  };
}

/**
 * Has the shot hit level geometry or left the arena? Both answers end a shot the same way, so they
 * are one question. Leaving the arena counts because bounds are a clamp rather than four wall boxes
 * (see `resolveWorld`), so there is no obstacle out there to hit.
 *
 * This is a *point* test at the shot's current position, sampled once per tick. At
 * `WEAPON_CONFIG.projectileSpeed` a shot covers 30 units per tick, so it can straddle anything
 * thinner than that between samples. Every obstacle in `ARENA_01` is at least 80 units thick, which
 * is why v1 gets away without a swept test.
 */
export function projectileHitsObstacle(
  p: Proj,
  obstacles: readonly Aabb[],
  bounds: Bounds,
): boolean {
  if (p.x < 0 || p.y < 0 || p.x > bounds.width || p.y > bounds.height) return true;
  for (const obstacle of obstacles) {
    if (pointInAabb(p.x, p.y, obstacle)) return true;
  }
  return false;
}

/** Does the shot's current position lie inside a car's collision hull? */
export function projectileHitsCar(p: Proj, car: Obb): boolean {
  return pointInObb(p.x, p.y, car);
}

/** Has the shot been in flight long enough to expire? */
export function projectileExpired(p: Proj, tick: number, lifetimeTicks: number): boolean {
  return tick - p.spawnTick >= lifetimeTicks;
}

/**
 * May the owner's shot damage this target? Friendly fire is off in team mode and there is no
 * self-damage in either mode — a shot spawns at the muzzle, which sits on the shooter's own hull,
 * so without the self check every shot would kill its own shooter on the tick it was fired.
 */
export function canDamage(
  ownerId: string,
  ownerTeam: 0 | 1,
  targetId: string,
  targetTeam: 0 | 1,
  mode: "ffa" | "team",
): boolean {
  if (ownerId === targetId) return false;
  if (mode === "ffa") return true;
  return ownerTeam !== targetTeam;
}
