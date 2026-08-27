import { DRIVE_CONFIG } from "../../config/drive-config.js";
import { weaponDefOf } from "../../config/weapon-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import type { WeaponId } from "../../config/weapon-types.js";
import { pointInAabb, type Aabb, type Bounds } from "../collide.js";

/**
 * One live hitbox in the world. Projectiles use `x/y/angle/distance`; beams use `x/y/angle` as the
 * ORIGIN and `extent` as the current reach.
 *
 * `damageClock` is server-only bookkeeping (target -> next tick it may be damaged again) and is
 * never networked; it dies with the instance.
 */
export interface WeaponInstance {
  id: string;
  ownerSessionId: string;
  weaponId: WeaponId;
  kind: "projectile" | "beam";
  x: number;
  y: number;
  angle: number;
  extent: number;
  spawnTick: number;
  distance: number;
  pierceLeft: number;
  attached: boolean;
  damageClock: Map<string, number>;
  alive: boolean;
}

/** One group of instances to emit: which weapon, from which slot. */
export interface ShotOrder {
  weaponId: WeaponId;
  slot: number;
}

export interface OwnerPose {
  x: number;
  y: number;
  angle: number;
}

export interface StepInstanceContext {
  dt: number;
  tick: number;
  obstacles: readonly Aabb[];
  bounds: Bounds;
  /** The owner's current pose, for an attached beam. `null` for everything else. */
  ownerPose: OwnerPose | null;
}

/** How far ahead of the car's centre an instance is born: the front face of its hull. */
export function muzzleOffset(): number {
  return DRIVE_CONFIG.carWidth / 2;
}

/** Step length of the wall raycast, in world units. Finer than the thinnest sane obstacle. */
export const MUZZLE_STEP_UNITS = 4;

/**
 * Emit one order's instances from the owner's pose AT THIS TICK — a shot is aimed by where the car
 * is when it exits, not where it was when the key went down (D3), which is what makes a sequential
 * burst steerable.
 *
 * Pellets are fanned evenly and symmetrically about the heading; a single-pellet volley gets no
 * offset at all.
 */
export function spawnInstances(
  order: ShotOrder,
  owner: { sessionId: string } & OwnerPose,
  tick: number,
  seq: number,
): { instances: WeaponInstance[]; seq: number } {
  const def = weaponDefOf(order.weaponId);
  const pellets = def.kind === "projectile" ? def.volley.pelletsPerVolley : 1;
  const spread = def.kind === "projectile" ? (def.volley.spreadAngleDeg * Math.PI) / 180 : 0;
  const nose = muzzleOffset();

  const instances: WeaponInstance[] = [];
  let next = seq;
  for (let i = 0; i < pellets; i++) {
    const offset = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5) * spread;
    const angle = owner.angle + offset;
    next += 1;
    instances.push({
      id: `${owner.sessionId}-${next}`,
      ownerSessionId: owner.sessionId,
      weaponId: order.weaponId,
      kind: def.kind,
      x: owner.x + Math.cos(owner.angle) * nose,
      y: owner.y + Math.sin(owner.angle) * nose,
      angle,
      extent: 0,
      spawnTick: tick,
      distance: 0,
      pierceLeft: def.kind === "projectile" ? def.pierce : 0,
      attached: def.kind === "beam" ? def.attached : false,
      damageClock: new Map(),
      alive: true,
    });
  }
  return { instances, seq: next };
}

/**
 * One tick of existence. Pure: the input is never mutated.
 *
 * A projectile integrates a straight line from its own frozen heading and never reads its owner. A
 * beam grows toward `min(range, wall)` and then holds; an attached beam re-reads its owner's pose
 * and re-runs the wall clip every tick, which is what lets it be swept by turning.
 */
export function stepInstance(instance: WeaponInstance, ctx: StepInstanceContext): WeaponInstance {
  const def = weaponDefOf(instance.weaponId);

  if (instance.kind === "projectile") {
    const step = def.speed * ctx.dt;
    return {
      ...instance,
      x: instance.x + Math.cos(instance.angle) * step,
      y: instance.y + Math.sin(instance.angle) * step,
      distance: instance.distance + step,
      // Fresh copy, not the input's reference: a shallow spread would otherwise alias `damageClock`
      // between the pre- and post-step instance, so a later write through either object would be
      // visible through both. Same reasoning as `pruneCooldowns` in combat.ts, which never hands
      // back the caller's own cooldown map either.
      damageClock: new Map(instance.damageClock),
    };
  }

  const origin =
    instance.attached && ctx.ownerPose
      ? {
          x: ctx.ownerPose.x + Math.cos(ctx.ownerPose.angle) * muzzleOffset(),
          y: ctx.ownerPose.y + Math.sin(ctx.ownerPose.angle) * muzzleOffset(),
          angle: ctx.ownerPose.angle,
        }
      : { x: instance.x, y: instance.y, angle: instance.angle };

  const reach = wallClipDistance(origin.x, origin.y, origin.angle, def.range, ctx.obstacles, ctx.bounds);
  return {
    ...instance,
    x: origin.x,
    y: origin.y,
    angle: origin.angle,
    extent: Math.min(reach, instance.extent + def.speed * ctx.dt),
    // See the projectile branch above: a fresh copy, so the returned instance and the one it was
    // stepped from never share the same live `damageClock` object.
    damageClock: new Map(instance.damageClock),
  };
}

/**
 * Has this instance finished? A projectile dies at its range; a beam dies once it has been at full
 * extension for its linger. Obstacle and bounds death for projectiles is handled by the caller,
 * which owns the world.
 */
export function instanceExpired(instance: WeaponInstance, tick: number): boolean {
  const def = weaponDefOf(instance.weaponId);
  if (instance.kind === "projectile") return instance.distance >= def.range;
  const ticks = weaponTicksOf(instance.weaponId);
  return tick - instance.spawnTick >= ticks.flight + ticks.lifetime;
}

/**
 * How far a beam may reach before level geometry stops it: a ray marched down its CENTRE AXIS
 * against obstacles and the arena edge.
 *
 * Centre-axis only, deliberately. A full polygon sweep against every obstacle for every beam every
 * tick buys precision nobody can see; the visible consequence of this simplification is that a
 * wide beam may overhang a wall's corner slightly.
 */
export function wallClipDistance(
  x: number,
  y: number,
  angle: number,
  range: number,
  obstacles: readonly Aabb[],
  bounds: Bounds,
): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let d = MUZZLE_STEP_UNITS; d <= range; d += MUZZLE_STEP_UNITS) {
    const px = x + cos * d;
    const py = y + sin * d;
    // Inclusive on every edge, matching `pointInAabb`'s own convention (a point ON an obstacle's
    // face counts as inside it). Report the distance to the FIRST blocked sample directly rather
    // than backing off by one step: backing off is only correct when the boundary test is
    // exclusive, and mixing an exclusive bounds check with `pointInAabb`'s inclusive one made this
    // under-report a wall that happened to land exactly on a sampled distance.
    if (px <= 0 || py <= 0 || px >= bounds.width || py >= bounds.height) return d;
    for (const obstacle of obstacles) {
      if (pointInAabb(px, py, obstacle)) return d;
    }
  }
  return range;
}
