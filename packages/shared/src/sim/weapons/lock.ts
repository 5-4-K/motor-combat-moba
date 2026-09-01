import { AIM_CONFIG, AIM_TICKS } from "../../config/aim-config.js";
import type { Aabb, Bounds } from "../collide.js";
import { muzzleOffset, wallClipDistance, type OwnerPose } from "./instances.js";
import { canDamage } from "./targets.js";

/** The car doing the locking, as the lock step sees it. */
export interface LockOwner {
  sessionId: string;
  team: 0 | 1;
  x: number;
  y: number;
  angle: number;
}

/** A car that might be locked. Poses only -- validity is decided by the caller and `canDamage`. */
export interface LockTarget {
  sessionId: string;
  team: 0 | 1;
  x: number;
  y: number;
}

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/**
 * Where the shot actually leaves from: the front face of the owner's hull, along its heading.
 *
 * Shared by the line-of-sight ray and by the fired angle (A11a), so the two can never disagree
 * about where the weapon is. The muzzle position itself is never moved by the lock (A11b) -- it is
 * a physical point on the car, and a wide-angle lock that moved it would spawn shots off the side
 * of the hull in open space.
 *
 * Takes a POSE, not a `LockOwner`. The muzzle is a fact about where a car is and which way it
 * faces; `sessionId` and `team` were never read here, and demanding them meant a caller holding
 * only a pose had to invent them. That cost the client a compile error: `PlayerState.team` is a
 * `uint8` and so widens to `number`, which is not assignable to `LockOwner`'s `0 | 1`, and
 * `ArenaScene`'s charge-orb telegraph could not call this at all.
 */
export function muzzleOf(owner: OwnerPose): { x: number; y: number } {
  const nose = muzzleOffset();
  return { x: owner.x + Math.cos(owner.angle) * nose, y: owner.y + Math.sin(owner.angle) * nose };
}

/**
 * Signed angle from the car's heading to a target, in degrees, normalised to (-180, 180].
 *
 * Measured from the car CENTRE, not the muzzle: "how far off my nose is this" is a fact about the
 * car's facing, and it is what both the region test and the score are asking. The angle actually
 * FIRED is muzzle-derived instead (A11a) -- the 24 unit offset between the two is a real parallax
 * at close range, and conflating them would miss by about a car length at 100 units and 40 degrees.
 *
 * Normalisation is not decoration: `angle` accumulates as a car spins, so an un-wrapped delta grows
 * without bound and every region test would reject a target sitting straight ahead.
 */
export function signedAngleDegTo(owner: LockOwner, tx: number, ty: number): number {
  const bearing = Math.atan2(ty - owner.y, tx - owner.x);
  let delta = bearing - owner.angle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  return delta * DEG_PER_RAD;
}

/**
 * How good a target is. **Lowest wins** (A5).
 *
 * The distance term is what stops the score being biased toward far targets, which sit near the
 * centreline precisely because they are far. Its coefficient is per WORLD UNIT -- see
 * `AIM_CONFIG.scorePerDistanceUnit` for why the unit is the load-bearing part.
 */
export function lockScore(angleDeg: number, distance: number): number {
  return Math.abs(angleDeg) + distance * AIM_CONFIG.scorePerDistanceUnit;
}

/**
 * The three bounds of the acquisition region, each optionally widened by a pad. Acquisition passes
 * zero pads; retention passes `AIM_CONFIG`'s (A6).
 *
 * `lockRangeUnits` replaces a direct `AIM_CONFIG.lockRange` read: acquisition is now bounded by the
 * PER-CAR range (`carAimRangeOf`, the longest-reaching assisted weapon), not the flat global. No
 * default — same "the compiler keeps the two halves honest" reasoning as `StepContext.modifiers`.
 */
function withinRegion(
  angleDeg: number,
  distance: number,
  conePadDeg: number,
  lateralPadUnits: number,
  rangePadUnits: number,
  lockRangeUnits: number,
): boolean {
  const absDeg = Math.abs(angleDeg);
  if (absDeg > AIM_CONFIG.coneDeg + conePadDeg) return false;
  if (distance > lockRangeUnits + rangePadUnits) return false;
  const lateral = distance * Math.sin(absDeg * RAD_PER_DEG);
  return lateral <= AIM_CONFIG.lateralMax + lateralPadUnits;
}

/** Cone AND lateral cap AND lock range (A2). All three, or the region is wrong at one end. */
export function inAcquireRegion(angleDeg: number, distance: number, lockRangeUnits: number): boolean {
  return withinRegion(angleDeg, distance, 0, 0, 0, lockRangeUnits);
}

/** Acquisition widened by every retention pad. Strictly wider than `inAcquireRegion` (A6). */
export function inRetainRegion(angleDeg: number, distance: number, lockRangeUnits: number): boolean {
  return withinRegion(
    angleDeg,
    distance,
    AIM_CONFIG.retentionConeDeg,
    AIM_CONFIG.retentionLateralUnits,
    AIM_CONFIG.retentionRangeUnits,
    lockRangeUnits,
  );
}

/**
 * Can the muzzle see the target centre? Reuses the beam clip's raycast rather than adding a second
 * spelling of "what stops a ray".
 *
 * The ray is cast exactly as far as the TARGET, never to the weapon's range: a wall standing behind
 * an enemy is not cover.
 *
 * A no-op in every shipped match -- `ACTIVE_ARENA_ID` is `arena-01`, whose `obstacles` is `[]` --
 * and built anyway, because switching arenas is deliberately a one-line edit and `arena-02` already
 * exists with obstacles in it. Without this, that one line would silently turn aim assist into
 * lock-through-walls with no targeting code touched.
 *
 * **Wrecks are not cover.** They are never in the candidate list, and they are not obstacles: a
 * wreck is solid to driving but transparent to combat, so shots already pass straight through one
 * without even spending a pierce budget. Treating it as cover would drop the lock for an
 * obstruction that demonstrably does not stop the bullet.
 *
 * **The arena-bounds branch of the raycast really does fire, once.** `muzzleOffset()` is 24, exactly
 * the hull's forward half-extent, and `pointOutsideBounds` is inclusive of the boundary itself. A
 * car nose-pressed against an arena wall therefore has its muzzle sitting exactly ON that boundary:
 * the ray's reach is 0, and it loses line of sight to everything, lock included. This is accepted,
 * not a bug to fix here -- it degrades safely. No lock just means the weapon falls back to firing
 * straight ahead (A11), which is already correct for a car with its nose in the wall.
 */
export function hasLineOfSight(
  ox: number,
  oy: number,
  tx: number,
  ty: number,
  obstacles: readonly Aabb[],
  bounds: Bounds,
): boolean {
  const distance = Math.hypot(tx - ox, ty - oy);
  if (distance === 0) return true;
  const angle = Math.atan2(ty - oy, tx - ox);
  return wallClipDistance(ox, oy, angle, distance, obstacles, bounds) >= distance;
}

/**
 * One car's lock, carried across ticks. Server-only room memory: only `targetSessionId` is ever
 * projected onto the schema (A14), the same way `pending` stays server-side and only the tick it
 * fires on crosses the wire.
 */
export interface LockState {
  /** Session id of the locked target, or `""` for no lock. */
  targetSessionId: string;
  /** Tick the CURRENT target was acquired. Gates the commit timer. */
  lockedAtTick: number;
  /** Tick sight of the current target was first lost, or 0 while visible. Gates the LOS grace. */
  losLostSinceTick: number;
  /** Tick of the most recent fire press on any slot. Gates the engagement timeout. */
  lastPressTick: number;
}

export function newLockState(): LockState {
  return { targetSessionId: "", lockedAtTick: 0, losLostSinceTick: 0, lastPressTick: 0 };
}

export interface UpdateLockContext {
  owner: LockOwner;
  /** In the roster and not a wreck. A wreck holds no lock. */
  ownerFighting: boolean;
  /**
   * Did this car press any fire slot on an input the server actually simulated this tick?
   *
   * Read BEFORE `beginFire`, so a press a cooldown will reject still counts. The timer answers
   * "has this player disengaged?", which is a fact about the driver, not about a gun -- which is
   * also why a press on any slot refreshes it, not only the aim-assist slot's.
   */
  pressedThisTick: boolean;
  /** Living roster cars. Wrecks and lobby players are simply absent, which is how they release. */
  candidates: readonly LockTarget[];
  mode: "ffa" | "team";
  obstacles: readonly Aabb[];
  bounds: Bounds;
  tick: number;
  /**
   * The acquisition (and, padded, retention) range for THIS car's lock -- `carAimRangeOf(carIdOf(
   * owner))`, the longest-reaching assisted weapon it carries. Required, no default: the caller
   * always knows the owner's chassis, and defaulting here would let a car silently lock out to the
   * global `AIM_CONFIG.lockRange` instead of its own kit's reach.
   */
  lockRangeUnits: number;
}

interface ScoredTarget {
  sessionId: string;
  score: number;
  angleDeg: number;
  distance: number;
  visible: boolean;
}

/**
 * One car's lock for one tick: release, steal and acquisition resolved in a single pass.
 *
 * Pure -- the input state is never mutated.
 *
 * **Two hystereses, deliberately separate.** Getting these confused is the most likely way to
 * implement this wrongly:
 *
 * - *Spatial* -- the retention region (A6) and the LOS grace (A10) -- decides whether the CURRENT
 *   target is still held at all.
 * - *Competitive* -- the 25% steal margin and the commit timer (A7) -- decides whether a RIVAL may
 *   take its place.
 *
 * The engagement timeout (A8) switches off the competitive half only. It therefore never blanks
 * the bracket: a lapsed timer means the best-scoring target simply wins, which is what makes a slow
 * weapon re-pick fresh every shot while a fast one holds its lock.
 *
 * Resolving all of it in one pass is what stops a released-then-re-acquired lock producing an
 * unlocked frame the HUD would flicker on.
 *
 * `world.tick` is `ArenaState.tick`, which is room-monotonic and never reset per match: a match
 * cannot begin before lobby, ready-up, car select, reveal and countdown have elapsed, so `tick` is
 * always far greater than `AIM_TICKS.lockTimeout` by the time a match starts. A fresh `LockState`
 * therefore reads as DISENGAGED (`ctx.tick - lastPressTick < AIM_TICKS.lockTimeout` is false at
 * tick 0's real values), not engaged -- so locks start hysteresis-free: best score wins every tick,
 * no steal margin, no commit window, until the driver's first fire press of the match. That is why
 * `lastPressTick: 0` in `newLockState` is a safe initial value rather than an accident: it is simply
 * "no press has ever happened", and it reads that way for any tick a match could plausibly start on.
 */
export function updateLock(state: LockState, ctx: UpdateLockContext): LockState {
  if (!ctx.ownerFighting) return newLockState();

  const lastPressTick = ctx.pressedThisTick ? ctx.tick : state.lastPressTick;
  const muzzle = muzzleOf(ctx.owner);

  const scored: ScoredTarget[] = [];
  for (const target of ctx.candidates) {
    // The same predicate shots use, so the lock can never disagree with the shot about who is an
    // enemy -- no teammates in team mode, and never yourself.
    if (!canDamage(ctx.owner.sessionId, ctx.owner.team, target.sessionId, target.team, ctx.mode)) {
      continue;
    }
    const angleDeg = signedAngleDegTo(ctx.owner, target.x, target.y);
    const distance = Math.hypot(target.x - ctx.owner.x, target.y - ctx.owner.y);
    // Gated on `inRetainRegion` rather than raycasting every candidate: it is a strict superset of
    // both places `visible` gets read below -- the incumbent's retain test (which already requires
    // `inRetainRegion`) and `best`'s acquire test (which requires `inAcquireRegion`, itself a subset
    // of `inRetainRegion`). A candidate outside the wider region can satisfy neither reader, so
    // skipping its raycast is behaviour-preserving. On arena-02 (2000x2000, ~16 obstacles) this caps
    // the ray at `AIM_CONFIG.lockRange` + retention pads (460 units) instead of casting across the
    // whole map, roughly a 30x reduction in traced distance.
    const inRegion = inRetainRegion(angleDeg, distance, ctx.lockRangeUnits);
    scored.push({
      sessionId: target.sessionId,
      score: lockScore(angleDeg, distance),
      angleDeg,
      distance,
      visible: inRegion && hasLineOfSight(muzzle.x, muzzle.y, target.x, target.y, ctx.obstacles, ctx.bounds),
    });
  }

  // --- Spatial: is the current target still held? ---
  const current = scored.find((s) => s.sessionId === state.targetSessionId) ?? null;
  let losLostSinceTick = 0;
  let held: ScoredTarget | null = null;

  if (current && inRetainRegion(current.angleDeg, current.distance, ctx.lockRangeUnits)) {
    if (current.visible) {
      held = current;
    } else {
      const since = state.losLostSinceTick === 0 ? ctx.tick : state.losLostSinceTick;
      if (ctx.tick - since < AIM_TICKS.losGrace) {
        held = current;
        losLostSinceTick = since;
      }
    }
  }

  // --- The best target anyone could acquire fresh this tick. Sight is required NOW. ---
  let best: ScoredTarget | null = null;
  for (const candidate of scored) {
    if (!candidate.visible || !inAcquireRegion(candidate.angleDeg, candidate.distance, ctx.lockRangeUnits)) {
      continue;
    }
    if (best === null || candidate.score < best.score) best = candidate;
  }

  const acquire = (target: ScoredTarget): LockState => ({
    targetSessionId: target.sessionId,
    lockedAtTick: ctx.tick,
    losLostSinceTick: 0,
    lastPressTick,
  });

  if (!held) {
    // Spelled as `newLockState()` plus the one field that survives, rather than all four written
    // out: the engagement clock deliberately outlives a momentary loss of every target, so seeing
    // `lastPressTick` singled out here is the point, not incidental.
    return best ? acquire(best) : { ...newLockState(), lastPressTick };
  }

  const keep: LockState = {
    targetSessionId: held.sessionId,
    lockedAtTick: state.lockedAtTick,
    losLostSinceTick,
    lastPressTick,
  };

  if (!best || best.sessionId === held.sessionId) return keep;

  // --- Competitive: may this rival take the lock? ---
  const engaged = ctx.tick - lastPressTick < AIM_TICKS.lockTimeout;
  if (!engaged) return best.score < held.score ? acquire(best) : keep;

  const committed = ctx.tick - state.lockedAtTick >= AIM_TICKS.commit;
  const clearsMargin = best.score <= held.score * (1 - AIM_CONFIG.stealMarginFraction);
  return committed && clearsMargin ? acquire(best) : keep;
}
