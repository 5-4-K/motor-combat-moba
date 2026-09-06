import { RAM_CONFIG } from "../config/ram-config.js";
import { ramAttackOf, ramDefenceOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { CarId } from "../config/types.js";
import { contactNormalBetween, type Vec2 } from "./collide.js";
import { carHullOf } from "./context.js";
import type { Impulse } from "./impulse.js";
import { canDamage } from "./weapons/targets.js";

/**
 * Ram control-and-knockback. Pure: no schema, no room, no wall clock.
 *
 * **A ram deals no damage.** It spins the victim and knocks it sideways, and that is all —
 * `applyDamage` is never called from here. Weapons remain the only damage source, so the `attack`
 * rating keeps meaning exactly what its name says. Ramming sets up the kill; weapons land it.
 * Ram control-loss (what used to be a steering-authority degrade) is gone until stage 3b's `reeling`
 * status; this module carries no stand-in for it (`Impulse.uncontrolTicks` is authored `0` here).
 *
 * **`resolveRam` resolves a CONTEST between both cars, not a one-way push derived from the
 * attacker's momentum (spec R2-R7, revision 2).** Each car brings a push into the collision — its
 * `ramAttack` rating times how hard it is driving in, plus a speed-independent term scaled from its
 * `ramDefence` rating (`pushOf`) — and what each car actually takes is the OTHER car's push, shared
 * out by the contest, adjusted for the struck face, and divided by its own `ramDefence`
 * (`impactOn`). Both outcomes are computed independently: the attacker's `Impulse` is never a
 * negated copy of the victim's (spec R7). The caller (`ram-bridge.ts`) applies both impulses
 * directly, with no equal-and-opposite step of its own.
 *
 * Runs AFTER driving has resolved for the tick, so every measurement reads the poses cars actually
 * ended up at, and BEFORE combat. The impulse it produces is applied by the caller that same tick.
 */

export type ImpactSide = "front" | "flank" | "rear";

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
   * before ram does and reflects a car off what it hit, so a caller that passes post-resolution
   * velocity makes every drive-in term wrong on exactly the ticks a hull overlapped. That is not
   * hypothetical: it shipped, and it cost 80-90% of all rams until `playtest/ram.ts` measured the
   * trigger rate.
   *
   * These are the WHOLE velocity, lateral component included, as of stage 3 Task 4. Through Task 2
   * and 3 the cache was a forward scalar (`TickResult.approachSpeeds`) and `contactCarsOf` rebuilt a
   * purely-forward `vx`/`vy` from it — a shim that was exactly right while nothing could drive
   * sideways into a ram, and wrong the moment a lateral pre-collision component mattered. Since the
   * vector-drive rework a car genuinely carries one, so the shim is gone and `driveInOf` dots the
   * real vector against the contact normal: a car sliding sideways PAST someone still contributes
   * nothing (the dot is zero or negative), while one sliding sideways INTO them now contributes what
   * it is actually closing at.
   */
  vx: number;
  vy: number;
  carId: CarId;
  /**
   * The car's `ramDefence` status multiplier, 1 for a car in no status. There is deliberately no
   * `ramAttack` multiplier — spec R11 gives statuses no offence channel.
   */
  defenceMult: number;
}

export interface RamHit {
  attackerId: string;
  victimId: string;
  side: ImpactSide;
  /** What the victim takes. */
  impulse: Impulse;
  /** What the attacker takes. Computed independently, NOT a negated copy (spec R7). */
  attackerImpulse: Impulse;
}

/** Unordered pair identity, so contact tracking cannot depend on iteration order. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Which face of the victim was struck, measured in the victim's own frame.
 *
 * `n` points from the victim toward the attacker (see `contactNormalBetween`), so a positive local x
 * means the attacker is off the victim's nose. The hull is 48 long by 32 wide, so front and rear are
 * the narrow faces and the flanks are the long ones — which is the geometry the bonus table assumes.
 */
export function impactSideOf(n: Vec2, victimAngle: number): ImpactSide {
  const cos = Math.cos(-victimAngle);
  const sin = Math.sin(-victimAngle);
  const localX = n.x * cos - n.y * sin;
  const localY = n.x * sin + n.y * cos;
  if (Math.abs(localX) <= Math.abs(localY)) return "flank";
  return localX > 0 ? "front" : "rear";
}

function bonusFor(side: ImpactSide): number {
  if (side === "front") return RAM_CONFIG.bonusFront;
  if (side === "rear") return RAM_CONFIG.bonusRear;
  return RAM_CONFIG.bonusFlank;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * How fast this car is driving INTO the contact, along the normal pointing at the other car.
 * Clamped at zero: a car moving away brings nothing to the contest rather than a negative push.
 *
 * This is NOT closing speed. Closing speed is the SUM of the two cars' drive-ins; the contest needs
 * them separately, because who is losing decides who absorbs the hit (spec R3, R4).
 */
function driveInOf(car: RamCar, towardOther: Vec2): number {
  return Math.max(0, car.vx * towardOther.x + car.vy * towardOther.y);
}

/**
 * What this car brings to the contest (spec R2): what it is driving in with, plus what it is
 * standing there being. The defence term is speed-independent on purpose — solidity does not depend
 * on motion, and it is what stops a stationary car being a completely free hit.
 */
function pushOf(car: RamCar, driveIn: number): number {
  return (
    ramAttackOf(car.carId) * driveIn +
    ramDefenceOf(car.carId) * car.defenceMult * RAM_CONFIG.defencePushScale
  );
}

/**
 * What one car takes (spec R5): the other car's push, reduced by how much you are winning the
 * contest, adjusted for which of YOUR faces got hit, and softened by your own solidity.
 *
 * The face bonus is yours, not the other car's (spec R6) — your own nose is braced too, which is
 * what makes a head-on far gentler than a T-bone at the same closing speed.
 */
function impactOn(theirPush: number, myPush: number, myFaceBonus: number, myRamDefence: number): number {
  const total = myPush + theirPush;
  if (total <= 0 || myRamDefence <= 0) return 0;
  const myShare = theirPush / total;
  return (theirPush * myShare * myFaceBonus * RAM_CONFIG.globalScale) / myRamDefence;
}

/**
 * The impulses one ram writes, or `null` when this contact is not a ram.
 *
 * `null` covers four distinct cases deliberately kept indistinguishable to the caller: the pair is
 * not in contact, they are teammates, neither is driving into the other, or their combined drive-in
 * is below `minApproachSpeed`.
 */
export function resolveRam(a: RamCar, b: RamCar, mode: "ffa" | "team"): RamHit | null {
  // Friendly fire is off for contact exactly as it is for shots, decided by the same predicate, so
  // the two can never disagree about who is on your side. Teammates still collide and shove each
  // other through ordinary resolution; they simply cost each other no control.
  if (!canDamage(a.sessionId, a.team, b.sessionId, b.team, mode)) return null;

  const n = contactNormalBetween(
    carHullOf(a.x, a.y, a.angle),
    carHullOf(b.x, b.y, b.angle),
    RAM_CONFIG.contactPad,
  );
  if (n === null) return null;

  // `n` points from b toward a, so a drives along -n to reach b and b drives along +n to reach a.
  const approachA = driveInOf(a, { x: -n.x, y: -n.y });
  const approachB = driveInOf(b, n);

  const aAttacks = approachA >= approachB;
  const attacker = aAttacks ? a : b;
  const victim = aAttacks ? b : a;

  // Points from the attacker toward the victim.
  const towardVictim: Vec2 = aAttacks ? { x: -n.x, y: -n.y } : n;
  // Points from the victim toward the attacker: what the side classification reads.
  const towardAttacker: Vec2 = { x: -towardVictim.x, y: -towardVictim.y };

  // `driveInOf(attacker, towardVictim)`/`driveInOf(victim, towardAttacker)` would recompute exactly
  // `approachA`/`approachB` above — same cars, same directions, just relabelled by which one won
  // `aAttacks` — so reuse them instead of dotting the same vectors twice.
  const attackerDriveIn = aAttacks ? approachA : approachB;
  const victimDriveIn = aAttacks ? approachB : approachA;
  if (attackerDriveIn + victimDriveIn <= RAM_CONFIG.minApproachSpeed) return null;

  const attackerPush = pushOf(attacker, attackerDriveIn);
  const victimPush = pushOf(victim, victimDriveIn);

  const side = impactSideOf(towardAttacker, victim.angle);
  // The attacker's own struck face is read the same way as the victim's: from the normal pointing
  // at the OTHER car, in ITS OWN frame (spec R6 — the bonus applies to the face each car presents,
  // not only the victim's). It is tempting to assume the attacker is always nose-first — `bonusFront`
  // hardcoded here used to make exactly that assumption — but `driveInOf` dots a car's WHOLE velocity
  // against the contact normal, and since the vector-drive rework that velocity is not always aligned
  // with the car's heading: a car spun or slid sideways by an earlier hit, or one genuinely reversing,
  // can win the drive-in contest (becoming `resolveRam`'s "attacker") while presenting its flank or
  // its rear to the car it is colliding with. Computing it, rather than assuming it, is also what
  // keeps R7's symmetry: two cars sliding sideways into each other must not have their face bonus
  // decided by the arbitrary `approachA >= approachB` tiebreak that only picks who counts as attacker.
  const attackerSide = impactSideOf(towardVictim, attacker.angle);
  const victimImpact = impactOn(
    attackerPush, victimPush, bonusFor(side), ramDefenceOf(victim.carId) * victim.defenceMult,
  );
  const attackerImpact = impactOn(
    victimPush, attackerPush, bonusFor(attackerSide), ramDefenceOf(attacker.carId) * attacker.defenceMult,
  );

  // Both impulses recover the SAME contact point exactly as before — `contactPointOn` is unchanged.
  const contact = contactPointOn(victim, attacker);
  return {
    attackerId: attacker.sessionId,
    victimId: victim.sessionId,
    side,
    impulse: {
      dirX: towardVictim.x,
      dirY: towardVictim.y,
      speed: victimImpact,
      spin: 1,
      // `impactOn` already divided by the victim's own `ramDefence` above, so `false` here stops
      // `applyImpulse` (`sim/impulse.ts`) dividing a second time. The flag exists for impulses whose
      // magnitude was NOT built from a contest — a weapon reading fixed numbers off its own row
      // (stage 4) — which DO need the applier to divide.
      defenceScaled: false,
      uncontrolTicks: 0, // stage 3b fills this in
      contactX: contact.x,
      contactY: contact.y,
    },
    attackerImpulse: {
      dirX: towardAttacker.x,
      dirY: towardAttacker.y,
      speed: attackerImpact,
      spin: 1,
      defenceScaled: false,
      uncontrolTicks: 0,
      contactX: contact.x,
      contactY: contact.y,
    },
  };
}

/**
 * Recovers an approximate contact point, in WORLD space, for the lever arm `applyImpulse` needs.
 *
 * Clamping the attacker's centre into the victim's hull, in the victim's local frame, gives the
 * point — the same technique `circleOverlapsObb` uses to find a nearest point — and then rotates it
 * back out of that frame. World space, rather than a lever arm pre-resolved in the victim's own
 * frame, is what lets `Impulse.contactX/contactY` mean the same thing regardless of who built the
 * impulse: `applyImpulse` (`sim/impulse.ts`) is the one place that turns a world contact point and a
 * body's own pose into the local lever arm and the torque it produces, so a dead-centre hit still
 * behaves correctly by construction rather than by tuning — this function's only job is finding the
 * point, not judging what it does.
 */
function contactPointOn(victim: RamCar, attacker: RamCar): Vec2 {
  const cos = Math.cos(-victim.angle);
  const sin = Math.sin(-victim.angle);
  const dx = attacker.x - victim.x;
  const dy = attacker.y - victim.y;

  // Derived from `DRIVE_CONFIG` rather than typed, same as `inertiaCoefficient` — both must move
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
 * One resolved push and who threw it, keyed by victim id — `applyRams`'s own flavour of
 * `contact.ts`'s `ImpulseEntry` (same shape, kept local rather than imported: `contact.ts` already
 * imports FROM this module, and this module must not import back from it).
 */
export interface RamImpulseEntry {
  attackerId: string;
  /** What the victim takes. */
  impulse: Impulse;
  /** What the attacker takes. Computed independently by the contest, not a negated copy (R7). */
  attackerImpulse: Impulse;
}

/**
 * One tick of ramming over every pair.
 *
 * **Edge triggered.** A ram fires only on the tick a pair *enters* contact. `previous` is the set of
 * pairs that were touching last tick; the returned `contacts` replaces it. Holding the throttle into
 * someone therefore lands one impulse, not a stun-lock — to ram again you must separate and
 * re-approach, which is the skill expression the mechanic wants.
 *
 * Contact is tracked even for pairs that produce no ram, so a slow touch still occupies the pair and
 * cannot be converted into a fresh trigger by accelerating while already touching.
 *
 * Iteration is over sorted session ids and each victim keeps only its hardest impulse, ranked by
 * `impulse.speed` now that the contest replaces a single 0-1 severity grade, so the result does not
 * depend on the order `cars` arrives in. An impulse REPLACES rather than accumulates: two rams
 * landing on one car in one tick is rare, and summing them would let a sandwich stack past what a
 * single contest is meant to produce.
 */
export function applyRams(
  cars: readonly RamCar[],
  previous: ReadonlySet<string>,
  mode: "ffa" | "team",
): { impulses: Map<string, RamImpulseEntry>; contacts: Set<string> } {
  const ordered = [...cars].sort((x, y) => (x.sessionId < y.sessionId ? -1 : x.sessionId > y.sessionId ? 1 : 0));
  const contacts = new Set<string>();
  const best = new Map<string, RamImpulseEntry>();

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
      if (hit === null) continue;

      const standing = best.get(hit.victimId);
      if (standing === undefined || hit.impulse.speed > standing.impulse.speed) {
        best.set(hit.victimId, { attackerId: hit.attackerId, impulse: hit.impulse, attackerImpulse: hit.attackerImpulse });
      }
    }
  }

  return { impulses: best, contacts };
}
