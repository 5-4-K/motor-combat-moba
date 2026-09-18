import { inertiaRadiusSquared, RAM_CONFIG } from "../config/ram-config.js";
import { ramAttackOf, ramDefenceOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { CarId } from "../config/types.js";
import { contactNormalBetween, type Vec2 } from "./collide.js";
import { carHullOf } from "./context.js";
import { forwardOf } from "./velocity.js";
import { canDamage } from "./weapons/targets.js";

/**
 * Ram classification and knockback. Pure: no schema, no room, no wall clock.
 *
 * **A ram deals no damage** (spec U28). It flings the victim, spins it and leaves it reeling, and
 * that is all — `applyDamage` is never called from here, and Unity's own `flankDamage`/`rearDamage`
 * are deliberately not ported. Weapons remain the only damage source, so the `attack` rating keeps
 * meaning exactly what its name says. Ramming sets up the kill; weapons land it.
 *
 * **This is Unity's ram rule, not a contest** (spec §7, U23-U29). A ram is one car's punch: a
 * nose-first hit above `RAM_CONFIG.minRamSpeed`, where the attacker **stops dead** and is locked and
 * the victim is **flung, spun and left reeling**. The two-sided contest that stood here through
 * revision 2 of the car-physics rework — `pushOf`, `impactOn`, the three face bonuses,
 * `defencePushScale`, `minApproachSpeed` — is deleted rather than retuned: the attacker's outcome is
 * now a rule ("you stop"), not a computed push, so there is nothing left to share out. The only case
 * where both cars are written is a head-on, and even there each side's shove is authored by the
 * OTHER car alone.
 *
 * **This module decides, it does not apply.** It returns a `RamResolution` — who is shoved, by how
 * much, who is locked, who reels — and `packages/server/src/sim/ram-bridge.ts` writes it onto the
 * cars. Three things deliberately live there rather than here, and each would be a bug here:
 *
 * - **The spin clamp.** `RAM_CONFIG.spinMaxRate` is applied where the spin is written onto a car. A
 *   clamp inside a pure classifier would make a resolution's meaning depend on the car it is later
 *   applied to.
 * - **Diminishing returns.** `resolveRam` returns full-strength values; the bridge scales the shove,
 *   the spin and the reel duration by the victim's own falloff stack (spec §7.3).
 * - **The statuses themselves.** `locked` and `reeled` name the cars; `RAM_CONFIG.attackerLockMs`
 *   and `ramUncontrolMs` are read, and `applyStatus` called, by the bridge.
 *
 * Runs AFTER driving has resolved for the tick, so every measurement reads the poses cars actually
 * ended up at, and BEFORE combat.
 */

/**
 * Which face of a car a contact landed nearest, in that car's own frame — Unity's `RamRules.Region`
 * (spec U23). Replaces the old three-way `ImpactSide`.
 */
export type RamRegion = "front" | "frontCorner" | "side" | "rearCorner" | "rear";

/** The kind of ram, which decides the shove multiplier and (for a head-on) who gets written. */
export type RamType = "headOn" | "flank" | "rear";

/** One car as the ram step sees it. Plain data: the room maps `PlayerState` onto this. */
export interface RamCar {
  sessionId: string;
  team: 0 | 1;
  x: number;
  y: number;
  angle: number;
  /**
   * World velocity. **These must be the PRE-COLLISION values** — the ones the car carried into the
   * tick, supplied by `serverTick`'s `TickResult.approachVelocities`. Collision resolution runs
   * before ram does, so a caller that passes post-resolution velocity makes every drive-in wrong on
   * exactly the ticks a hull overlapped. That is not hypothetical: it shipped, and it cost 80-90% of
   * all rams until `playtest/ram.ts` measured the trigger rate.
   *
   * The WHOLE velocity, lateral component included — `forwardOf` is what projects it onto the car's
   * nose, which is the only component the Unity rule reads.
   */
  vx: number;
  vy: number;
  carId: CarId;
  /**
   * The car's `ramDefence` status multiplier, 1 for a car in no status. There is deliberately no
   * `ramAttack` multiplier — spec R11 gives statuses no offence channel.
   */
  defenceMult: number;
  /**
   * May this car throw a punch at all? `Modifiers.ramBlocked` (spec §8), which covers both a reeling
   * victim and a car still inside its own attacker lock. A blocked car can still BE rammed — this
   * gates the attacker side only, which is what stops a ram chain paying its winner twice.
   */
  ramBlocked: boolean;
}

/** What one car receives from a ram. */
export interface RamSide {
  sessionId: string;
  shoveX: number;
  shoveY: number;
  /**
   * A yaw DELTA in rad/s, **always added to the car's existing `angVel`, never assigned** — spec
   * §7.2 reads "spin set to pre-collision spin + spinDelta", and `replacesVelocity` below governs the
   * VELOCITY only. An attacker's side and both sides of a head-on carry 0, which under that rule
   * preserves whatever rotation the car already had rather than cancelling it; that is the intent
   * (§7.2's "spin unchanged"), not an omission.
   *
   * **Not clamped here** — `RAM_CONFIG.spinMaxRate` is the bridge's, applied where the sum is written
   * onto a body (spec U26), because a clamp inside a pure classifier would make a resolution's
   * meaning depend on the car it is later applied to.
   */
  spin: number;
  /**
   * true: this car's VELOCITY is replaced by the shove (attacker stop, head-on). false: added to it.
   * Says nothing about `spin`, which always accumulates.
   */
  replacesVelocity: boolean;
}

/**
 * One ram, fully classified.
 *
 * The `sides` list, rather than spec §7.4's sketched `{ victimId, shove, spin }`, is what lets a
 * head-on be expressed at all: §7.2 requires a head-on to write BOTH cars' velocities, lock BOTH,
 * spin and reel NEITHER, and credit each car's shove to the other. A single victim-and-shove pair
 * has no room for the second car (controller ruling S3-f).
 */
export interface RamResolution {
  type: RamType;
  /** The attacker's id, or `""` for a head-on, which has none (U27). */
  attackerId: string;
  /** Every car this contact acts on: attacker and victim for a flank or rear, both cars for a head-on. */
  sides: readonly RamSide[];
  /** Takes `ramLock`: the attacker, or both cars on a head-on. */
  locked: readonly string[];
  /** Takes `reeling`: the victim, or nobody on a head-on (U27). */
  reeled: readonly string[];
}

/** Unordered pair identity, so contact tracking cannot depend on iteration order. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Which face of this car a contact landed on, in the car's own frame — Unity's `RamRules.Region`.
 *
 * FACES, not volumes, and that is the whole subtlety: a front zone deep enough to catch corner hits
 * would also swallow the side panel behind the bumper and call a T-bone a head-on. Every branch here
 * compares DISTANCES TO FACES (`toFront`, `toRear`, `toSide`) and picks the nearest, so a point deep
 * inside the hull still names the panel it is closest to rather than a region it happens to sit in.
 * The corner band is the narrow strip where a front or rear face meets a side.
 */
export function regionOf(localX: number, localY: number, cornerBand: number): RamRegion {
  const halfLength = DRIVE_CONFIG.carWidth / 2;
  const halfWidth = DRIVE_CONFIG.carHeight / 2;
  const toFront = halfLength - localX;
  const toRear = halfLength + localX;
  const toSide = halfWidth - Math.abs(localY);

  if (toSide <= cornerBand && toFront <= cornerBand) return "frontCorner";
  if (toSide <= cornerBand && toRear <= cornerBand) return "rearCorner";
  if (toFront <= toRear && toFront <= toSide) return "front";
  if (toRear <= toSide) return "rear";
  return "side";
}

/** Only a nose can throw a ram. Unity's `RamRules.IsAttackRegion`. */
function isAttackRegion(region: RamRegion): boolean {
  return region === "front" || region === "frontCorner";
}

/** Unsigned angle between two unit vectors, radians. */
function angleBetween(a: Vec2, b: Vec2): number {
  const dot = clamp(a.x * b.x + a.y * b.y, -1, 1);
  return Math.acos(dot);
}

/**
 * The kind of ram, from the face the VICTIM was struck on and how the two cars line up. Unity's
 * `RamRules.Classify`: a side hit is always a flank; a front or rear hit is a head-on or a rear only
 * when the headings agree within `headOnAngleDeg`.
 */
export function ramTypeOf(
  victimRegion: RamRegion,
  attackerForward: Vec2,
  victimForward: Vec2,
  headOnAngleDeg: number,
): RamType {
  const limit = (headOnAngleDeg * Math.PI) / 180;
  if (victimRegion === "front" || victimRegion === "frontCorner") {
    return angleBetween(attackerForward, { x: -victimForward.x, y: -victimForward.y }) <= limit
      ? "headOn"
      : "flank";
  }
  if (victimRegion === "rear" || victimRegion === "rearCorner") {
    return angleBetween(attackerForward, victimForward) <= limit ? "rear" : "flank";
  }
  return "flank";
}

/** The shove multiplier for a ram of this kind. Unity's `RamRules.ScaleFor`. */
function scaleFor(type: RamType): number {
  if (type === "headOn") return RAM_CONFIG.headOnScale;
  if (type === "rear") return RAM_CONFIG.rearScale;
  return RAM_CONFIG.flankScale;
}

/** One car resolved against a contact point: everything the classification needs, measured once. */
interface Participant {
  car: RamCar;
  /** The car's heading as a unit vector — where its nose points, not where it is going. */
  forward: Vec2;
  /** Speed along its OWN heading, floored at zero. Unity's drive-in; NOT speed toward the other car. */
  forwardSpeed: number;
  region: RamRegion;
  /** May it be the one throwing the punch (spec U24)? */
  qualifies: boolean;
}

function participantOf(car: RamCar, contact: Vec2): Participant {
  const forward: Vec2 = { x: Math.cos(car.angle), y: Math.sin(car.angle) };
  const forwardSpeed = Math.max(0, forwardOf(car.vx, car.vy, car.angle));

  // The contact point, rotated into this car's own frame. A point transform, not a velocity one, so
  // it does not belong in `velocity.ts`.
  const cos = Math.cos(-car.angle);
  const sin = Math.sin(-car.angle);
  const dx = contact.x - car.x;
  const dy = contact.y - car.y;
  const region = regionOf(dx * cos - dy * sin, dx * sin + dy * cos, RAM_CONFIG.cornerBandUnits);

  return {
    car,
    forward,
    forwardSpeed,
    region,
    qualifies: !car.ramBlocked && isAttackRegion(region) && forwardSpeed >= RAM_CONFIG.minRamSpeed,
  };
}

/**
 * The shove one car lands on another. Unity's `RamRules.ShoveDelta`, with `strength`/`resistance`
 * read off this game's `ramAttack`/`ramDefence` (U11) and `globalScale` reconciling the two scales:
 * Unity's ratings are 1-vs-1, this roster's are 45-70 against 30-90.
 *
 * Along the ATTACKER's heading, not along the line between the two centres — that is what makes a
 * glancing nose-in shove the victim the way the attacker was actually travelling.
 */
function shoveOf(attacker: Participant, victim: Participant, type: RamType): Vec2 {
  const resistance = ramDefenceOf(victim.car.carId) * victim.car.defenceMult;
  if (resistance <= 0) return { x: 0, y: 0 };
  const magnitude =
    (attacker.forwardSpeed *
      scaleFor(type) *
      RAM_CONFIG.globalScale *
      ramAttackOf(attacker.car.carId)) /
    resistance;
  return { x: attacker.forward.x * magnitude, y: attacker.forward.y * magnitude };
}

/**
 * Yaw the shove imparts at the contact point: the 2D cross product of the lever arm with the push,
 * over the hull's squared radius of gyration. Unity's `PushMath.SpinDelta`.
 *
 * Correct by construction rather than by tuning — a dead-centre hit puts lever and push on one line,
 * so the cross product is zero and there is no spin. NOT clamped here: the clamp belongs where the
 * spin is written onto a car (`ram-bridge.ts`), because a clamp inside a pure classifier would make
 * a resolution's meaning depend on the car it is later applied to.
 */
function spinOf(contact: Vec2, victim: RamCar, shove: Vec2): number {
  const rx = contact.x - victim.x;
  const ry = contact.y - victim.y;
  return (RAM_CONFIG.spinScale * (rx * shove.y - ry * shove.x)) / inertiaRadiusSquared();
}

/** A flank or rear ram: the attacker stops and locks, the victim is flung, spun and left reeling. */
function oneWayResolution(
  attacker: Participant,
  victim: Participant,
  type: RamType,
  contact: Vec2,
): RamResolution {
  const shove = shoveOf(attacker, victim, type);
  return {
    type,
    attackerId: attacker.car.sessionId,
    sides: [
      // Unity's `ApplyRam` sets the attacker's velocity to zero outright — it does not slow it, and
      // it does not bounce it back. `replacesVelocity` with a zero shove is exactly that.
      { sessionId: attacker.car.sessionId, shoveX: 0, shoveY: 0, spin: 0, replacesVelocity: true },
      {
        sessionId: victim.car.sessionId,
        shoveX: shove.x,
        shoveY: shove.y,
        spin: spinOf(contact, victim.car, shove),
        replacesVelocity: false,
      },
    ],
    locked: [attacker.car.sessionId],
    reeled: [victim.car.sessionId],
  };
}

/**
 * A head-on: each car's velocity is REPLACED by the shove the other car's heading, speed and
 * `ramAttack` produce against its own `ramDefence`, at `headOnScale`. Both are locked; **neither
 * spins and neither reels** (U27) — a head-on is a mutual stop, not a mutual delete.
 *
 * There is no attacker, which is why `attackerId` is `""`: each car is the other's. The bridge reads
 * that to credit each car as the other's shover for the spike window (U38).
 *
 * Takes no contact point, unlike `oneWayResolution`: with no spin there is no lever arm to read.
 */
function headOnResolution(a: Participant, b: Participant): RamResolution {
  const ontoA = shoveOf(b, a, "headOn");
  const ontoB = shoveOf(a, b, "headOn");
  return {
    type: "headOn",
    attackerId: "",
    sides: [
      { sessionId: a.car.sessionId, shoveX: ontoA.x, shoveY: ontoA.y, spin: 0, replacesVelocity: true },
      { sessionId: b.car.sessionId, shoveX: ontoB.x, shoveY: ontoB.y, spin: 0, replacesVelocity: true },
    ],
    locked: [a.car.sessionId, b.car.sessionId],
    reeled: [],
  };
}

/**
 * The ram one contact produces, or `null` when this contact is not a ram.
 *
 * `null` covers five cases deliberately kept indistinguishable to the caller: the pair is not in
 * contact, they are teammates, neither car leads with its nose, neither is driving in at
 * `RAM_CONFIG.minRamSpeed`, and every car that would otherwise qualify is `ramBlocked`. Following
 * `RammingModule.OnCollisionEnter` plus `RamRules.Resolve`.
 */
export function resolveRam(a: RamCar, b: RamCar, mode: "ffa" | "team"): RamResolution | null {
  // Friendly fire is off for contact exactly as it is for shots, decided by the same predicate, so
  // the two can never disagree about who is on your side. Teammates still collide and shove each
  // other through ordinary resolution; they simply cannot ram.
  if (!canDamage(a.sessionId, a.team, b.sessionId, b.team, mode)) return null;

  const touching = contactNormalBetween(
    carHullOf(a.x, a.y, a.angle),
    carHullOf(b.x, b.y, b.angle),
    RAM_CONFIG.contactPad,
  );
  if (touching === null) return null;

  // ONE contact point, not one per car: the midpoint of each car's own recovered point. Classifying
  // the two cars against two different points is how a single collision ends up being a nose hit for
  // nobody, or for both — the regions must be two readings of the same event.
  const onA = contactPointOn(a, b);
  const onB = contactPointOn(b, a);
  const contact: Vec2 = { x: (onA.x + onB.x) / 2, y: (onA.y + onB.y) / 2 };

  const pa = participantOf(a, contact);
  const pb = participantOf(b, contact);

  if (!pa.qualifies && !pb.qualifies) return null;

  if (pa.qualifies && pb.qualifies) {
    const aOnB = ramTypeOf(pb.region, pa.forward, pb.forward, RAM_CONFIG.headOnAngleDeg);
    const bOnA = ramTypeOf(pa.region, pb.forward, pa.forward, RAM_CONFIG.headOnAngleDeg);
    // Either car reading it as a head-on makes it one for both — a mutual stop cannot be mutual for
    // one side only. An exact tie in drive-in is a head-on too (spec §7.1): with no faster car there
    // is nobody to name the attacker, and picking one by argument order would make the outcome
    // depend on which way the pair loop happened to walk.
    if (aOnB === "headOn" || bOnA === "headOn" || pa.forwardSpeed === pb.forwardSpeed) {
      return headOnResolution(pa, pb);
    }
    return pa.forwardSpeed > pb.forwardSpeed
      ? resolutionFor(pa, pb, aOnB, contact)
      : resolutionFor(pb, pa, bOnA, contact);
  }

  const attacker = pa.qualifies ? pa : pb;
  const victim = pa.qualifies ? pb : pa;
  const type = ramTypeOf(victim.region, attacker.forward, victim.forward, RAM_CONFIG.headOnAngleDeg);
  return resolutionFor(attacker, victim, type, contact);
}

/**
 * Routes a classified ram to the shape §7.2 gives it. A `headOn` type is a head-on however it was
 * reached — including the case where only one car qualifies and drives into a stationary car's nose
 * — because the type IS the rule for what gets written, not a label on top of one.
 */
function resolutionFor(
  attacker: Participant,
  victim: Participant,
  type: RamType,
  contact: Vec2,
): RamResolution {
  return type === "headOn"
    ? headOnResolution(attacker, victim)
    : oneWayResolution(attacker, victim, type, contact);
}

/**
 * Recovers an approximate contact point, in WORLD space, for the lever arm the spin needs.
 *
 * Clamping the attacker's centre into the victim's hull, in the victim's local frame, gives the
 * point — the same technique `circleOverlapsObb` uses to find a nearest point — and then rotates it
 * back out of that frame. World space, rather than a lever arm pre-resolved in one car's own frame,
 * is what lets the point be shared: `resolveRam` calls this BOTH ways round and takes the midpoint,
 * which only means anything if the two answers are in the same coordinates.
 *
 * Exported since stage 3 so `ram-bridge.ts` and the contact pass can recover the same point without
 * a second definition of it.
 */
export function contactPointOn(victim: RamCar, attacker: RamCar): Vec2 {
  const cos = Math.cos(-victim.angle);
  const sin = Math.sin(-victim.angle);
  const dx = attacker.x - victim.x;
  const dy = attacker.y - victim.y;

  // Derived from `DRIVE_CONFIG` rather than typed, same as `inertiaRadiusSquared` — both must move
  // with `carHullOf` in lockstep, or the recovered lever arm would silently disagree about the hull
  // the ram actually collided against.
  const hullHalfLength = DRIVE_CONFIG.carWidth / 2;
  const hullHalfWidth = DRIVE_CONFIG.carHeight / 2;
  const rx = clamp(dx * cos - dy * sin, -hullHalfLength, hullHalfLength);
  const ry = clamp(dx * sin + dy * cos, -hullHalfWidth, hullHalfWidth);

  // Rotate the clamped local point back out of the victim's frame into world space.
  const cosBack = Math.cos(victim.angle);
  const sinBack = Math.sin(victim.angle);
  return {
    x: victim.x + (rx * cosBack - ry * sinBack),
    y: victim.y + (rx * sinBack + ry * cosBack),
  };
}

/**
 * One tick of ramming over every pair.
 *
 * **Edge triggered.** A ram fires only on the tick a pair *enters* contact. `previous` is the set of
 * pairs that were touching last tick; the returned `contacts` replaces it. Holding the throttle into
 * someone therefore lands one ram, not a stun-lock — to ram again you must separate and re-approach,
 * which is the skill expression the mechanic wants.
 *
 * Contact is tracked even for pairs that produce no ram, so a slow touch still occupies the pair and
 * cannot be converted into a fresh trigger by accelerating while already touching.
 *
 * Iteration is over sorted session ids, so the returned list does not depend on the order `cars`
 * arrives in. **Every ram is kept.** The contest-era version kept only each victim's hardest impulse,
 * which a `RamResolution` cannot do without lying: a resolution carries the ATTACKER's stop and lock
 * as well as the victim's push, so discarding the weaker one would silently let one of two
 * simultaneous attackers drive straight through. Merging two pushes onto one car is the bridge's
 * decision now, where both halves are visible.
 *
 * **No production caller.** `resolveContacts` (`sim/contact.ts`) is what the room runs; this is the
 * same pair loop without the maneuver arms, kept as the unit-test surface for the ram rule itself.
 */
export function applyRams(
  cars: readonly RamCar[],
  previous: ReadonlySet<string>,
  mode: "ffa" | "team",
): { rams: RamResolution[]; contacts: Set<string> } {
  const ordered = [...cars].sort((x, y) => (x.sessionId < y.sessionId ? -1 : x.sessionId > y.sessionId ? 1 : 0));
  const contacts = new Set<string>();
  const rams: RamResolution[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j]!;
      const key = pairKey(a.sessionId, b.sessionId);

      const touching =
        contactNormalBetween(
          carHullOf(a.x, a.y, a.angle),
          carHullOf(b.x, b.y, b.angle),
          RAM_CONFIG.contactPad,
        ) !== null;
      if (!touching) continue;
      contacts.add(key);
      if (previous.has(key)) continue;

      const hit = resolveRam(a, b, mode);
      if (hit !== null) rams.push(hit);
    }
  }

  return { rams, contacts };
}
