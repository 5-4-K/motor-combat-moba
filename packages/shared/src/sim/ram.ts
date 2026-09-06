import { RAM_CONFIG } from "../config/ram-config.js";
import { massOf, ramReference } from "../config/car-config.js";
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
 * Ram control-loss (what used to be a steering-authority degrade) is gone until stage 3's `reeling`
 * status; this module carries no stand-in for it (`Impulse.uncontrolTicks` is authored `0` here).
 *
 * **`resolveRam` produces a one-way `Impulse` derived from the attacker's forward momentum**,
 * graded by closing speed, a side bonus and attacker mass, then handed to `applyImpulse`
 * (`sim/impulse.ts`) — the single place victim mass divides the push back down. The caller
 * (`ram-bridge.ts`) is what makes the exchange two-way: it also applies `reactionOf` of the same
 * impulse to the attacker, Newton's third law. Neither half of that exchange happens in this file.
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
   * Scalar velocity along the car's own heading — exactly the `dot(vel, fwd)` the severity needs.
   *
   * **This must be the PRE-COLLISION speed**, and on the server that means the value the car carried
   * into the tick, supplied by `serverTick`'s `TickResult.approachSpeeds`. Collision resolution runs
   * before ram does and rebounds a car to about -35% of its impact speed, so a caller that passes
   * the post-resolution `speed` makes `approachOf` negative on every tick a hull actually overlapped
   * and this module returns `null` for almost every real ram. That is not a hypothetical: it shipped,
   * and it cost 80-90% of all rams until `playtest/ram.ts` measured the trigger rate.
   */
  speed: number;
  carId: CarId;
  /**
   * The car's `ramMass` status multiplier, 1 for a car in no status.
   *
   * Read through `effectiveMassOf` at the two ram sites mass enters the maths — this module's own
   * severity grade, and `ram-bridge.ts`'s `massFor` (which `applyImpulse` reads for both the victim's
   * push and, since stage 2 Task 4, the attacker's equal-and-opposite reaction) — so a mass buff works
   * both ways round: it makes this car hit harder AND makes it harder to shift. That symmetry is
   * the whole reason `ramMass` is one channel rather than two — mass in this game is a single
   * physical fact about a chassis (`CAR_TABLE.mass`, and nothing else reads it), and an effect that
   * could raise a car's ramming power without also anchoring it would not be scaling mass, it would
   * be a damage buff wearing mass's name.
   *
   * **A fourth site, `resolveWorld`'s ordinary car-vs-car separation (`StepContext.selfMass` and
   * `CarObstacle.mass`, stage 2 Task 2), deliberately does NOT read this multiplier** — it is resolved
   * straight from `massOf(carIdOf(player))` in `sim/context.ts`'s `otherCarHulls`/`sim/tick.ts`, with
   * no `ramMass` scaling applied. See `otherCarHulls`'s own doc comment for why that is latent rather
   * than a live bug today.
   */
  massMult: number;
}

export interface RamHit {
  attackerId: string;
  victimId: string;
  side: ImpactSide;
  severity: number;
  impulse: Impulse;
}

/**
 * This car's mass as the ram maths sees it: its chassis rating, scaled by whatever `ramMass` effect
 * it carries. The single reading of "how heavy is this car right now" — `massOf` is never called
 * directly from this module.
 */
function effectiveMassOf(car: RamCar): number {
  return massOf(car.carId) * car.massMult;
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
 * The impulse one ram writes, or `null` when this contact is not a ram.
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
  // Attacker mass enters HERE and nowhere else — this is the severity grade, not the victim's
  // displacement. Clamped before the side bonus and again after, so a rear hit on an
  // already-saturated ram cannot push severity past 1.
  const raw = clamp01((approach * effectiveMassOf(attacker)) / ramReference());
  const severity = clamp01(raw * bonusFor(side));

  // Victim mass no longer enters here at all — `applyImpulse` (`sim/impulse.ts`) is the single
  // place a victim's mass divides out a push, read through `ramReferenceMass()` there. This
  // `Impulse` carries only the un-mass-scaled speed and lets the applier decide.
  const contact = contactPointOn(victim, attacker);
  return {
    attackerId: attacker.sessionId,
    victimId: victim.sessionId,
    side,
    severity,
    impulse: {
      dirX: away.x,
      dirY: away.y,
      speed: severity * RAM_CONFIG.knockMaxSpeed,
      spin: 1,
      massScaled: true,
      uncontrolTicks: 0, // stage 3 fills this in
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
  severity: number;
  impulse: Impulse;
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
 * Iteration is over sorted session ids and each victim keeps only its hardest impulse, so the result
 * does not depend on the order `cars` arrives in. An impulse REPLACES rather than accumulates: two
 * rams landing on one car in one tick is rare, and summing them would let a sandwich stack past what
 * the severity clamp exists to guarantee.
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
      if (standing === undefined || hit.severity > standing.severity) {
        best.set(hit.victimId, { attackerId: hit.attackerId, severity: hit.severity, impulse: hit.impulse });
      }
    }
  }

  return { impulses: best, contacts };
}
