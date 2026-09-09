import {
  DRIVE_CONFIG,
  TICK_RATE_HZ,
  beamShapeAt,
  carHullOf,
  instanceDefOf,
  isWeaponId,
  nearestPointOnObb,
  shapeHitsObb,
  type BeamWeaponDef,
  type Obb,
  type ProjectileHitbox,
  type ProjectileWeaponDef,
  type Vec2,
  type WeaponDef,
} from "@motor-combat-moba/shared";
import type { FxCarView, FxInstanceView } from "./events.js";

/**
 * Where an effect belongs: the point the weapon actually touched, not the pose of whatever produced
 * it.
 *
 * **The bug this module exists for.** `FxEvent` used to carry a pose straight through — a shot's own
 * `x/y` for `shotEnded`, the victim's centre for `damaged` — and neither is a contact point:
 *
 * - `WeaponInstance.x/y` is a beam's **origin** (see `sim/weapons/instances.ts`), so `lance`'s
 *   authored impact burst detonated on the shooter's own nose rather than at the far end of the beam.
 * - A projectile's pose is where it sat at the end of a tick, but the hit test is the **smear** over
 *   that whole tick (`sim/weapons/hits.ts`). A `predator` dart covers 30 u per tick against a 48 u
 *   hull, so the observed pose lands anywhere from the near face to a car-length past the car, chosen
 *   by nothing but sub-tick phase. That is the "random" in a misplaced burst.
 * - The victim's centre is never where it was struck.
 *
 * **Everything here is derived client-side from views the client already holds.** No new schema
 * field, no new wire traffic: `extent` and `isExplosion` are already networked, and the geometry
 * comes from `WEAPON_TABLE` through the same `beamShapeAt`/`shapeHitsObb` the sim itself runs. That
 * keeps VFX9-12 and hard invariant 8 intact and, the reason that actually decides it, means netcode
 * phase 2 swapping the Colyseus schema for a binary snapshot cannot throw this away.
 *
 * Nothing here is authoritative. A contact point is cosmetic: being wrong costs one frame of sparks
 * on the wrong flank, which is why a heuristic is allowed to live here and never in `sim/`.
 *
 * **Both entry points are per-PAIR, and a worst-case frame is six cars against ~60 live instances**
 * (`fx/perf.test.ts`), so 360 pairs. Two things keep that affordable, and both are load-bearing
 * rather than tidiness: `ShotGeometry` resolves everything about an instance that does not depend on
 * the car ONCE for the frame, and `withinReach` then settles almost every pair in a handful of flops
 * with no trig and no allocation. Only survivors build a polygon and run SAT. The first cut had
 * neither and measured 0.36 ms a frame against the 0.25 ms bound that file holds.
 */

/** Half the hull's diagonal: no part of a car reaches further than this from its centre. */
const HULL_RADIUS = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2;

/** How far a projectile of this def covers in one sim tick. The whole span its smear may have hit in. */
function travelPerTick(def: ProjectileWeaponDef): number {
  return def.speed / TICK_RATE_HZ;
}

/** A projectile hitbox's half-width ACROSS its heading — what the shot's line must be inflated by. */
function acrossRadiusOf(hitbox: ProjectileHitbox): number {
  return hitbox.shape === "circle" ? hitbox.radius : hitbox.radiusAcross;
}

/** A beam's half-width at full reach — a cone fans out with `extent`, a rect does not. */
function beamHalfAcross(def: BeamWeaponDef, extent: number): number {
  if (def.hitbox.shape === "rect") return def.hitbox.width / 2;
  if (def.hitbox.shape === "disc") return 0;
  return Math.tan((def.hitbox.angleDeg * Math.PI) / 360) * Math.max(0, extent);
}

/** The def a live instance actually is, or `null` for an id this build cannot resolve. */
function defOf(instance: FxInstanceView): WeaponDef | null {
  if (!isWeaponId(instance.weaponId)) return null;
  return instanceDefOf(instance.weaponId, instance.isExplosion);
}

/** Squared distance from a point to the segment `(ax, ay) -> (bx, by)`. No sqrt, no allocation. */
function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/**
 * One instance's geometry, resolved ONCE for the frame.
 *
 * A frame with several damaged cars would otherwise re-resolve every instance's def and re-derive
 * every beam's axis per car — 360 lots of trig at the six-by-sixty ceiling `fx/perf.test.ts` pins.
 * Everything expensive about an instance that does not depend on which car is being asked about
 * lives here.
 */
export interface ShotGeometry {
  readonly instance: FxInstanceView;
  /**
   * Narrowed to the two kinds that carry a hitbox. A maneuver spawns no instance at all, so
   * `geometryOf` refuses it outright and no consumer needs a third arm.
   */
  readonly def: BeamWeaponDef | ProjectileWeaponDef;
  /**
   * The far end of the broad-phase axis: a beam's tip, or the origin again for anything with no
   * length of its own (a projectile, a disc blast), which makes the segment test below a point test.
   */
  readonly axisX: number;
  readonly axisY: number;
  /** How far a car's CENTRE may sit from that axis and still possibly have been touched. */
  readonly limit: number;
}

/** Every instance's frame-constant geometry, skipping ids and kinds that can contact nothing. */
export function shotGeometriesOf(instances: readonly FxInstanceView[]): ShotGeometry[] {
  const shots: ShotGeometry[] = [];
  for (const instance of instances) {
    const geometry = geometryOf(instance);
    if (geometry) shots.push(geometry);
  }
  return shots;
}

function geometryOf(instance: FxInstanceView): ShotGeometry | null {
  const def = defOf(instance);
  if (!def) return null;
  if (def.kind === "beam") {
    const reach = Math.max(0, instance.extent);
    // A disc is radially symmetric: its extent IS its radius and its axis means nothing, so the
    // segment collapses to the origin and the whole reach becomes the limit.
    if (def.hitbox.shape === "disc") {
      return {
        instance,
        def,
        axisX: instance.x,
        axisY: instance.y,
        limit: reach + HULL_RADIUS,
      };
    }
    return {
      instance,
      def,
      axisX: instance.x + Math.cos(instance.angle) * reach,
      axisY: instance.y + Math.sin(instance.angle) * reach,
      limit: beamHalfAcross(def, reach) + HULL_RADIUS,
    };
  }
  if (def.kind !== "projectile") return null;
  // A projectile is a point plus its own cross-section, anywhere within one tick of travel of the
  // pose the client observed — the same window `projectileContact` then measures exactly.
  return {
    instance,
    def,
    axisX: instance.x,
    axisY: instance.y,
    limit: acrossRadiusOf(def.hitbox) + travelPerTick(def) + HULL_RADIUS,
  };
}

/**
 * The conservative broad phase: could this instance's geometry have touched a car centred here?
 *
 * A `false` is a certainty; a `true` is only a maybe, which the exact tests below then settle. Pure
 * arithmetic against the pre-resolved axis, so it costs no trig and allocates nothing.
 */
function withinReach(shot: ShotGeometry, cx: number, cy: number): boolean {
  const gapSq = distSqToSegment(cx, cy, shot.instance.x, shot.instance.y, shot.axisX, shot.axisY);
  return gapSq <= shot.limit * shot.limit;
}

/**
 * Where the line through `(x, y)` along `(dirX, dirY)`, inflated by `radius`, crosses `hull` — as the
 * two parameters `enter`/`exit` measured from that point, negative behind it.
 *
 * A slab test in the hull's own frame, which is the cheap exact answer for a line against an oriented
 * box. Inflating the box by `radius` instead of sweeping the real hitbox shape overstates the corners
 * very slightly; that is the same generous bias the sim's own smear takes, and it is the correct one
 * for placing an effect.
 *
 * The direction arrives already resolved so a caller sweeping one shot across several cars pays for
 * its trig once rather than once per car.
 */
function crossing(
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  radius: number,
  hull: Obb,
): { enter: number; exit: number } | null {
  const cos = Math.cos(-hull.angle);
  const sin = Math.sin(-hull.angle);
  const dx = x - hull.x;
  const dy = y - hull.y;

  // The two slabs are written out rather than looped over an array of pairs: this runs for every
  // projectile against every car that survives the broad phase, and three throwaway arrays per call
  // is exactly the kind of allocation `fx/perf.test.ts`'s budget is there to catch.
  let enter = Number.NEGATIVE_INFINITY;
  let exit = Number.POSITIVE_INFINITY;

  const fromX = dx * cos - dy * sin;
  const localDirX = dirX * cos - dirY * sin;
  const halfX = hull.w / 2 + radius;
  // A line exactly parallel to a slab never crosses it: it is either inside that band for its whole
  // length or outside it for its whole length. Testing `=== 0` rather than a small epsilon is safe
  // because the division is well behaved for any non-zero d — an almost-parallel line yields a huge
  // but finite interval, which is the right answer.
  if (localDirX === 0) {
    if (Math.abs(fromX) > halfX) return null;
  } else {
    const a = (-halfX - fromX) / localDirX;
    const b = (halfX - fromX) / localDirX;
    enter = Math.min(a, b);
    exit = Math.max(a, b);
  }

  const fromY = dx * sin + dy * cos;
  const localDirY = dirX * sin + dirY * cos;
  const halfY = hull.h / 2 + radius;
  if (localDirY === 0) {
    if (Math.abs(fromY) > halfY) return null;
  } else {
    const a = (-halfY - fromY) / localDirY;
    const b = (halfY - fromY) / localDirY;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  return enter > exit ? null : { enter, exit };
}

/** One candidate contact: where on the hull, and how far the instance is from having made it. */
interface Candidate {
  point: Vec2;
  /**
   * Zero for a CONFIRMED contact — the shot is on the car — and grows with how far past it the
   * observed pose has flown. Smaller wins, and a zero ends the search: nothing can beat a shot that
   * is actually touching, so both loops below stop there rather than scoring the rest of the frame.
   */
  gap: number;
}

/**
 * Where a projectile travelling along its own heading entered `hull`, or `null` if it cannot have.
 *
 * The entry face rather than the nearest face, because a shot that buried itself in a car — or shot
 * clean through it — came in one side, and a burst on the other reads as the wrong hit entirely. The
 * point is then clamped onto the hull so it sits on the skin instead of `radius` out from it.
 *
 * The window is one tick of the shot's own travel either side of the observed pose: a shot dies on
 * the tick it lands, so its entry is within one tick's smear of where the client last saw it. Either
 * side, not just behind, because the client observes render frames rather than sim ticks and the pose
 * it holds may be a patch stale. Anything further off the line than that is a car this shot flew past
 * ticks ago, or one behind the wall it actually died on.
 */
function projectileContact(
  instance: FxInstanceView,
  def: ProjectileWeaponDef,
  hull: Obb,
): Candidate | null {
  const radius = acrossRadiusOf(def.hitbox);
  const dirX = Math.cos(instance.angle);
  const dirY = Math.sin(instance.angle);
  const span = crossing(instance.x, instance.y, dirX, dirY, radius, hull);
  if (!span) return null;

  const window = travelPerTick(def);
  if (span.enter > window || span.exit < -window) return null;

  const entryX = instance.x + dirX * span.enter;
  const entryY = instance.y + dirY * span.enter;
  // How far the observed pose sits outside the crossing itself: zero while the shot is still within
  // the car, growing as it flies on past. Ranks candidates without needing a second distance metric.
  const gap = Math.max(0, span.enter, -span.exit);
  return { point: nearestPointOnObb(entryX, entryY, hull), gap };
}

/**
 * Where a beam that is actually washing over `hull` meets it, or `null` if it is not.
 *
 * The face turned toward the beam's SOURCE — its muzzle, or a blast's centre — because that is the
 * side the energy arrives from. `shapeHitsObb` against the beam's real shape is the same test the sim
 * ran to award the damage, so the client cannot disagree with the server about whether this beam is
 * the one that landed.
 */
function beamContact(instance: FxInstanceView, def: BeamWeaponDef, hull: Obb): Candidate | null {
  const shape = beamShapeAt(def.hitbox, instance.x, instance.y, instance.angle, instance.extent);
  if (!shapeHitsObb(shape, hull)) return null;
  // Gap zero: `shapeHitsObb` passing IS the beam washing over this hull, so there is nothing left to
  // rank it against. The distance from the muzzle would only say which shooter stood closer, which
  // is not what "which shot hit me" means.
  return { point: nearestPointOnObb(instance.x, instance.y, hull), gap: 0 };
}

/** Whichever of the two shapes this instance is, resolved against one hull. */
function contactOn(shot: ShotGeometry, hull: Obb): Candidate | null {
  return shot.def.kind === "beam"
    ? beamContact(shot.instance, shot.def, hull)
    : projectileContact(shot.instance, shot.def, hull);
}

/**
 * Where a shot that just ended should burst.
 *
 * A **beam** ends at its tip — `origin + extent` along its heading, which is exactly where it is
 * drawn ending and where `beamReach` already stopped it against level geometry. A **disc** beam is
 * the exception and stays at its origin: an explosion is radially symmetric, its pose already IS the
 * blast centre, and pushing it along the dead shell's old heading would be strictly wrong.
 *
 * A **projectile** ends on the hull it struck, and falls back to its own pose when it struck none — a
 * wall hit or a range expiry is already its own contact point.
 *
 * Cars are read at the pose they are DRAWN at this frame (`ArenaScene.renderFx` builds the view from
 * the render poses), so a burst always lands on the car the player can see, even where the shot's
 * pose and the car's pose are a patch apart.
 */
export function shotEndPoint(instance: FxInstanceView, cars: readonly FxCarView[]): Vec2 {
  const pose = { x: instance.x, y: instance.y };
  const shot = geometryOf(instance);
  if (!shot) return pose;

  if (shot.def.kind === "beam") {
    // `axisX/axisY` already IS the tip for a rect or cone beam, and the origin again for a disc —
    // exactly the two answers this needs, so there is nothing to recompute.
    return { x: shot.axisX, y: shot.axisY };
  }

  let best: Candidate | null = null;
  for (const car of cars) {
    if (!withinReach(shot, car.x, car.y)) continue;
    const hit = projectileContact(instance, shot.def, carHullOf(car.x, car.y, car.angle));
    if (hit && (!best || hit.gap < best.gap)) best = hit;
    if (best?.gap === 0) break;
  }
  return best ? best.point : pose;
}

/**
 * Where a car that just lost hp should throw its sparks.
 *
 * The skin the incoming shot reached, picking whichever live instance is closest to having touched
 * this hull. With none — a ram, or a source the client's view cannot reconcile — it falls back to the
 * car's centre, which is what a ram wants anyway: a body blow has no entry face.
 *
 * Attribution is by geometry rather than ownership because a `WeaponInstance`'s owner is not in the
 * FX view, and adding it would buy a heuristic's last few percent at the cost of a field the netcode
 * rewrite deletes. A shot grazing past a car damaged by something else on the same frame can pull the
 * sparks to the wrong flank; that is one frame of cosmetics, and it self-corrects on the next.
 */
export function damagePoint(car: FxCarView, shots: readonly ShotGeometry[]): Vec2 {
  let best: Candidate | null = null;
  let hull: Obb | null = null;
  for (const shot of shots) {
    if (!withinReach(shot, car.x, car.y)) continue;
    // Built on the first survivor rather than up front, so a frame where nothing comes near this car
    // allocates nothing at all.
    hull ??= carHullOf(car.x, car.y, car.angle);
    const hit = contactOn(shot, hull);
    if (hit && (!best || hit.gap < best.gap)) best = hit;
    if (best?.gap === 0) break;
  }
  return best ? best.point : { x: car.x, y: car.y };
}
