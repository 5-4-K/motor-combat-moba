import { RAM_CONFIG } from "../config/ram-config.js";
import { RAM_REFERENCE, RAM_REFERENCE_MASS, massOf } from "../config/car-config.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { CarId } from "../config/types.js";
import { contactNormalBetween, type Vec2 } from "./collide.js";
import { carHullOf } from "./context.js";
import { canDamage } from "./weapons/targets.js";

/**
 * Ram control-and-knockback. Pure: no schema, no room, no wall clock.
 *
 * **A ram deals no damage.** It spins the victim, knocks it sideways, and degrades its steering, and
 * that is all — `applyDamage` is never called from here. Weapons remain the only damage source, so
 * the `attack` rating keeps meaning exactly what its name says. Ramming sets up the kill; weapons
 * land it.
 *
 * **This does not conserve momentum, and is not trying to.** It is a tuned one-way knock derived
 * from the attacker's forward momentum, layered on top of a collision resolver that has already
 * separated the pair. Real exchange would need an impulse solver with a contact manifold; see the
 * design doc's future-work section.
 *
 * Runs AFTER driving has resolved for the tick, so every measurement reads the poses cars actually
 * ended up at, and BEFORE combat. The knock it writes is read by `stepDrive` on the following tick.
 */

export type ImpactSide = "front" | "flank" | "rear";

/** One car as the ram step sees it. Plain data: the room maps `PlayerState` onto this. */
export interface RamCar {
  sessionId: string;
  team: 0 | 1;
  x: number;
  y: number;
  angle: number;
  /** Scalar velocity along the car's own heading — exactly the `dot(vel, fwd)` the severity needs. */
  speed: number;
  carId: CarId;
}

/** What one ram writes onto its victim. Absolute values, not deltas: a knock replaces, never stacks. */
export interface RamKnock {
  sessionId: string;
  angVel: number;
  shoveX: number;
  shoveY: number;
  authority: number;
}

export interface RamHit {
  attackerId: string;
  victimId: string;
  side: ImpactSide;
  severity: number;
  knock: RamKnock;
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

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * How fast this car is closing on the other along its own nose.
 *
 * `car.speed` IS `dot(vel, fwd)` in this drive model, so no vector state is needed. Multiplying by
 * how squarely the nose points down the contact normal grades what used to be a yes/no facing test:
 * a glancing approach scores proportionally less rather than falling off a threshold.
 *
 * A car shunted backwards has negative `speed` and so scores negative — it deals nothing, which is
 * what keeps "get behind them" a strategy rather than "be moving fastest".
 */
function approachOf(car: RamCar, towardOther: Vec2): number {
  const fwdX = Math.cos(car.angle);
  const fwdY = Math.sin(car.angle);
  return car.speed * (fwdX * towardOther.x + fwdY * towardOther.y);
}

/**
 * The knock one ram writes, or `null` when this contact is not a ram.
 *
 * `null` covers four distinct cases deliberately kept indistinguishable to the caller: the pair is
 * not in contact, they are teammates, neither is driving into the other, or the closing speed is
 * below `minApproachSpeed`.
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
  const approachA = approachOf(a, { x: -n.x, y: -n.y });
  const approachB = approachOf(b, n);

  const aAttacks = approachA >= approachB;
  const attacker = aAttacks ? a : b;
  const victim = aAttacks ? b : a;
  const approach = aAttacks ? approachA : approachB;
  if (approach < RAM_CONFIG.minApproachSpeed) return null;

  // Points from the attacker toward the victim: the direction the victim is pushed.
  const away: Vec2 = aAttacks ? { x: -n.x, y: -n.y } : n;
  // Points from the victim toward the attacker: what the side classification reads.
  const incoming: Vec2 = aAttacks ? n : { x: -n.x, y: -n.y };

  const side = impactSideOf(incoming, victim.angle);
  // Attacker mass enters HERE and nowhere else. Clamped before the side bonus and again after, so a
  // rear hit on an already-saturated ram cannot drive `authority` below its own floor.
  const raw = clamp01((approach * massOf(attacker.carId)) / RAM_REFERENCE);
  const severity = clamp01(raw * bonusFor(side));

  const impulse = severity * RAM_CONFIG.knockMaxSpeed;
  const victimMass = massOf(victim.carId);
  // Victim mass enters HERE — the same impulse displaces a light car further. Clamped at both ends so
  // neither the heaviest nor the lightest chassis degenerates.
  const massFactor = clamp(
    RAM_REFERENCE_MASS / victimMass,
    RAM_CONFIG.massFactorMin,
    RAM_CONFIG.massFactorMax,
  );

  const shoveX = away.x * impulse * massFactor;
  const shoveY = away.y * impulse * massFactor;

  return {
    attackerId: attacker.sessionId,
    victimId: victim.sessionId,
    side,
    severity,
    knock: {
      sessionId: victim.sessionId,
      angVel: spinOf(attacker, victim, away, impulse),
      shoveX,
      shoveY,
      authority: 1 + (RAM_CONFIG.authorityFloor - 1) * severity,
    },
  };
}

/**
 * Spin from a recovered contact point rather than a guessed direction.
 *
 * Clamping the attacker's centre into the victim's hull, in the victim's local frame, gives an
 * approximate contact point — the same technique `circleOverlapsObb` uses to find a nearest point.
 * The 2D cross product of that lever arm with the knock force is the torque term a real impulse
 * solver would produce, evaluated at one point instead of over a manifold.
 *
 * It behaves correctly by construction rather than by tuning: a dead-centre nose hit puts the lever
 * arm and the force on the same line, so the cross product is zero and there is no spin. A flank hit
 * forward of centre spins the nose away; aft of centre spins the tail away.
 *
 * `spinScale` absorbs the unit mismatch that follows from `impulse` being expressed as a speed. It
 * exists to be calibrated by feel, not derived.
 */
function spinOf(attacker: RamCar, victim: RamCar, away: Vec2, impulse: number): number {
  const cos = Math.cos(-victim.angle);
  const sin = Math.sin(-victim.angle);
  const dx = attacker.x - victim.x;
  const dy = attacker.y - victim.y;

  // Derived from `DRIVE_CONFIG` rather than typed, same as `inertiaCoefficient` two lines below —
  // both must move with `carHullOf` in lockstep, or the torque lever and the inertia it divides by
  // would silently disagree about the hull the ram actually collided against.
  const hullHalfLength = DRIVE_CONFIG.carWidth / 2;
  const hullHalfWidth = DRIVE_CONFIG.carHeight / 2;
  const rx = clamp(dx * cos - dy * sin, -hullHalfLength, hullHalfLength);
  const ry = clamp(dx * sin + dy * cos, -hullHalfWidth, hullHalfWidth);

  const fx = (away.x * cos - away.y * sin) * impulse;
  const fy = (away.x * sin + away.y * cos) * impulse;

  const torque = rx * fy - ry * fx;
  const inertia = massOf(victim.carId) * RAM_CONFIG.inertiaCoefficient;
  const spin = (torque / inertia) * RAM_CONFIG.spinScale;
  return clamp(spin, -RAM_CONFIG.spinMaxRate, RAM_CONFIG.spinMaxRate);
}

/**
 * One tick of ramming over every pair.
 *
 * **Edge triggered.** A ram fires only on the tick a pair *enters* contact. `previous` is the set of
 * pairs that were touching last tick; the returned `contacts` replaces it. Holding the throttle into
 * someone therefore lands one knock, not a stun-lock — to ram again you must separate and
 * re-approach, which is the skill expression the mechanic wants.
 *
 * Contact is tracked even for pairs that produce no ram, so a slow touch still occupies the pair and
 * cannot be converted into a fresh trigger by accelerating while already touching.
 *
 * Iteration is over sorted session ids and each victim keeps only its hardest knock, so the result
 * does not depend on the order `cars` arrives in. A knock REPLACES rather than accumulates: two rams
 * landing on one car in one tick is rare, and summing them would let a sandwich stack past the
 * authority floor the severity clamp exists to guarantee.
 */
export function applyRams(
  cars: readonly RamCar[],
  previous: ReadonlySet<string>,
  mode: "ffa" | "team",
): { knocks: RamKnock[]; contacts: Set<string> } {
  const ordered = [...cars].sort((x, y) => (x.sessionId < y.sessionId ? -1 : x.sessionId > y.sessionId ? 1 : 0));
  const contacts = new Set<string>();
  const best = new Map<string, { severity: number; knock: RamKnock }>();

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
      if (standing === undefined || hit.severity > standing.severity) {
        best.set(hit.victimId, { severity: hit.severity, knock: hit.knock });
      }
    }
  }

  return { knocks: [...best.values()].map((entry) => entry.knock), contacts };
}
