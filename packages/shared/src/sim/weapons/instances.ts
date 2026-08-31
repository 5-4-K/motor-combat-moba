import { DRIVE_CONFIG } from "../../config/drive-config.js";
import { weaponDefOf } from "../../config/weapon-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import type { WeaponDef, WeaponId } from "../../config/weapon-types.js";
import { pointInAabb, pointOutsideBounds, type Aabb, type Bounds } from "../collide.js";
import { carIdOf } from "../context.js";
import { scaleDamage, weaponDamageOf } from "../damage.js";

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
  /**
   * Whether this instance came from the last volley of its press. Frozen at spawn and SIM-ONLY —
   * never networked — for exactly the reason `damage` and `ownerTeam` are: it must be answerable at
   * impact, long after the press, without reading back mutable state.
   *
   * Always true for a single-volley weapon, which is every row but `shockwave`.
   */
  finalWave: boolean;
  /**
   * The owner's team, frozen at the moment this instance is spawned — never looked up later.
   * `resolveInstanceHits` (hits.ts) tests against a snapshot of living fighters only, so an owner
   * wrecked while their own shot is still in flight would otherwise vanish from that snapshot and a
   * live lookup would silently fall back to a default team, flipping the shot's allegiance mid-flight
   * (D9/D10). Freezing it here also means a mid-match team switch cannot retroactively change who an
   * already-fired shot may hit.
   */
  ownerTeam: 0 | 1;
  /**
   * What this shot costs on a hit, resolved from the owner's chassis `attack` and frozen at spawn —
   * never looked up later, for exactly the reason `ownerTeam` is frozen above it. `hits.ts` tests
   * against a snapshot of living fighters only, so an owner wrecked while their own shot is still in
   * flight has vanished from any lookup by the time it lands, and a live one would quietly fall back
   * to the default chassis. Freezing also stops a mid-match car change re-powering a shot already in
   * the air.
   *
   * Already rounded (`damageFor`), so a piercing shot deals the identical number to every car it
   * passes through. Sim-only, like `ownerTeam` and `damageClock`: the client is told the resulting
   * hp, never the arithmetic.
   */
  damage: number;
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
  /**
   * This instance's muzzle direction, radians off the owner's heading, frozen at spawn. 0 for
   * every single-muzzle weapon. Sim-only, like `damageClock`: an attached beam re-anchors through
   * it every tick, so a rear flame stays welded to the tail rather than snapping to the nose.
   */
  muzzleDir: number;
}

/** One group of instances to emit: which weapon, from which slot. */
export interface ShotOrder {
  weaponId: WeaponId;
  slot: number;
  /**
   * True on the LAST volley of the press. Carried rather than recomputed downstream: only
   * `releaseShots` knows how many volleys are left, and a `StatusApplication` marked
   * `onWave: "final"` needs the answer at hit time, arbitrarily far from the press.
   */
  finalVolley: boolean;
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
  /** A homing shot's current target point. Inert until Task 6; `null` for everything else. */
  homingTarget: { x: number; y: number } | null;
}

/** How far ahead of the car's centre an instance is born: the front face of its hull. */
export function muzzleOffset(): number {
  return DRIVE_CONFIG.carWidth / 2;
}

/** Step length of the wall raycast, in world units. Finer than the thinnest sane obstacle. */
export const MUZZLE_STEP_UNITS = 4;

/**
 * One pellet's angular offset from the car's heading. `pellets` samples spread evenly and
 * symmetrically across `spreadRad`, so a 3-pellet 60-degree fan is -30 / 0 / +30 and a single pellet
 * sits exactly on the heading whatever the configured spread.
 *
 * Its own function, and exported, so the fan math is directly testable rather than inlined.
 */
export function fanOffset(index: number, pellets: number, spreadRad: number): number {
  if (pellets <= 1) return 0;
  return (index / (pellets - 1) - 0.5) * spreadRad;
}

/**
 * Emit one order's instances from the owner's pose AT THIS TICK — a shot is aimed by where the car
 * is when it exits, not where it was when the key went down (D3), which is what makes a sequential
 * burst steerable.
 *
 * Pellets are fanned evenly and symmetrically about the heading; a single-pellet volley gets no
 * offset at all.
 *
 * `aimAngle` is the car's lock direction, or `null` for "welded to the heading" -- which is what
 * every non-aim-assist weapon passes and what the whole table did before aim assist existed
 * (A11c). It replaces the heading as the axis the pellet fan is symmetric about, and it is re-read
 * by the caller at EACH shot's own tick, so a burst tracks a moving target the same way it already
 * tracks a turning driver.
 *
 * It never moves the muzzle (A11b): the shot always leaves the car's physical nose, derived from
 * `owner.angle`, and only its travel direction changes.
 *
 * `damageMult` is the owner's `damageDealt` status channel, and it is applied HERE, at spawn,
 * so it is frozen into `instance.damage` alongside `ownerTeam` for exactly the same reason those
 * are: a shot's cost is decided the moment it leaves the barrel. A buff that expires while the shot
 * is still in the air therefore does not un-power it, and one that lands while it flies does not
 * power it up — which is the answer a player expects from watching their own tracer, and the only
 * one available to a module that must never read player state at impact time.
 */
export function spawnInstances(
  order: ShotOrder,
  owner: { sessionId: string; team: 0 | 1; carId: string } & OwnerPose,
  tick: number,
  seq: number,
  aimAngle: number | null = null,
  damageMult = 1,
  homingTargetId = "", // consumed in Task 6; "" = none
  def: WeaponDef = weaponDefOf(order.weaponId), // test seam — see plan "Testing seams"
): { instances: WeaponInstance[]; seq: number } {
  // A maneuver moves the car instead of spawning an instance (Task 10's real branch); no table row
  // is one yet, so this narrows `def` back to the two kinds this function has ever had to handle.
  if (def.kind === "maneuver") throw new Error(`spawnInstances: maneuver weapon ${def.id} spawns no instance`);
  const damage = scaleDamage(weaponDamageOf(carIdOf(owner), order.weaponId), damageMult);
  const pellets = def.kind === "projectile" ? def.pellets.pelletsPerVolley : 1;
  const spread = def.kind === "projectile" ? (def.pellets.spreadAngleDeg * Math.PI) / 180 : 0;
  // A centre-origin beam is BORN at the car centre as well as re-anchored there every tick, so an
  // aura's first frame is already concentric rather than jumping back on its second.
  const nose = def.kind === "beam" && def.origin === "center" ? 0 : muzzleOffset();

  // Absent means `[0]`: one muzzle, dead ahead, exactly the pre-multi-muzzle behavior. Degrees
  // convert to radians unnormalized — a 270-degree muzzle produces a 3*pi/2 instance angle, not a
  // -pi/2 one — because nothing downstream needs the shot on a canonical range.
  const muzzleDirs = (def.muzzles ?? [0]).map((deg) => (deg * Math.PI) / 180);

  const instances: WeaponInstance[] = [];
  let next = seq;
  for (const dir of muzzleDirs) {
    // A11b: the muzzle is derived from the HEADING (plus this muzzle's own offset), never from the
    // aim angle.
    const exitHeading = owner.angle + dir;
    const muzzleX = owner.x + Math.cos(exitHeading) * nose;
    const muzzleY = owner.y + Math.sin(exitHeading) * nose;
    // Multi-muzzle forces assist off (table guard), so `aimAngle` only ever steers the single
    // forward muzzle — for every other direction the axis is the heading plus the muzzle offset.
    const axis = (aimAngle ?? owner.angle) + dir;
    for (let i = 0; i < pellets; i++) {
      const angle = axis + fanOffset(i, pellets, spread);
      next += 1;
      instances.push({
        id: `${owner.sessionId}-${next}`,
        ownerSessionId: owner.sessionId,
        ownerTeam: owner.team,
        finalWave: order.finalVolley,
        damage,
        weaponId: order.weaponId,
        kind: def.kind,
        x: muzzleX,
        y: muzzleY,
        angle,
        extent: 0,
        spawnTick: tick,
        distance: 0,
        pierceLeft: def.kind === "projectile" ? def.pierce : 0,
        attached: def.kind === "beam" ? def.attached : false,
        damageClock: new Map(),
        alive: true,
        muzzleDir: dir,
      });
    }
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
export function stepInstance(
  instance: WeaponInstance,
  ctx: StepInstanceContext,
  def: WeaponDef = weaponDefOf(instance.weaponId),
): WeaponInstance {
  // `WeaponInstance.kind` excludes "maneuver" — a maneuver spawns no instance (Task 10) — so this
  // narrows `def` the same way, and every read below it is only ever projectile or beam.
  if (def.kind === "maneuver") throw new Error(`stepInstance: maneuver weapon ${def.id} has no instance`);

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

  // A centre-origin beam (an aura) grows from the car itself rather than from its nose. That single
  // offset is the whole geometric difference between an aura and every other beam in the game.
  const nose = def.kind === "beam" && def.origin === "center" ? 0 : muzzleOffset();
  // Re-anchored through the instance's OWN frozen muzzle direction, not the car's nose: a rear
  // flame (muzzleDir == pi) stays welded to the tail as the car turns, rather than snapping to
  // whichever direction happens to be dead ahead.
  const anchorAngle = ctx.ownerPose ? ctx.ownerPose.angle + instance.muzzleDir : instance.angle;
  const origin =
    instance.attached && ctx.ownerPose
      ? {
          x: ctx.ownerPose.x + Math.cos(anchorAngle) * nose,
          y: ctx.ownerPose.y + Math.sin(anchorAngle) * nose,
          angle: anchorAngle,
        }
      : { x: instance.x, y: instance.y, angle: instance.angle };

  // A disc has no direction, so there is nothing for a raycast to follow: it grows to its full range
  // and passes through level geometry. That is a deliberate consequence of the shape rather than an
  // omission — clipping a radial field would have to mean an occlusion test per target, which is a
  // different feature. An aura is a field around a car, not a line of fire.
  const reach =
    def.hitbox.shape === "disc"
      ? def.range
      : wallClipDistance(origin.x, origin.y, origin.angle, def.range, ctx.obstacles, ctx.bounds);
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
export function instanceExpired(
  instance: WeaponInstance,
  tick: number,
  def: WeaponDef = weaponDefOf(instance.weaponId),
): boolean {
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
  // Sampling starts at the ORIGIN, not one step out. Starting at `MUZZLE_STEP_UNITS` never looked at
  // the first 4 units of the ray, so an obstacle face inside that gap went unseen and the beam was
  // born inside the wall; a car nosed up against level geometry is exactly where that happens. At
  // d = 0 a blocked sample yields a reach of 0, which `beamShapeAt` turns into a shape that hits
  // nothing — the right answer for a muzzle buried in a wall.
  for (let d = 0; d <= range; d += MUZZLE_STEP_UNITS) {
    const px = x + cos * d;
    const py = y + sin * d;
    // `pointOutsideBounds` is inclusive on every edge, matching `pointInAabb`'s own convention (a
    // point ON an obstacle's face counts as inside it) — and it is the same predicate `combat.ts`
    // uses for a projectile leaving the arena, so the two can no longer disagree about a shot
    // exactly on the edge. Report the distance to the FIRST blocked sample directly rather than
    // backing off by one step: backing off is only correct when the boundary test is exclusive, and
    // mixing an exclusive bounds check with `pointInAabb`'s inclusive one made this under-report a
    // wall that happened to land exactly on a sampled distance.
    if (pointOutsideBounds(px, py, bounds)) return d;
    for (const obstacle of obstacles) {
      if (pointInAabb(px, py, obstacle)) return d;
    }
  }
  return range;
}
