import { RAM_CONFIG } from "../config/ram-config.js";
import { SLAM_CONFIG } from "../config/slam-config.js";
import type { WeaponId } from "../config/weapon-types.js";
import {
  aabbCorners,
  contactNormalBetween,
  convexOverlap,
  obbCorners,
  type Aabb,
  type Bounds,
  type Obb,
  type Vec2,
} from "./collide.js";
import { carHullOf } from "./context.js";
import type { Impulse } from "./impulse.js";
import { ManeuverKind } from "./maneuver.js";
import { pairKey, resolveRam, type RamCar } from "./ram.js";
import { canDamage } from "./weapons/targets.js";

/**
 * The contact pass (spec S3). Extends `applyRams`'s pair loop with two maneuver-driven cases that
 * fire ahead of an ordinary ram: a DASH pair reports a hit and writes no `Impulse` at all (damage and
 * stun ride combat), and a CHARGE pair resolves a hard slam — a fixed impulse, unlike the graded ram
 * it otherwise falls back to. Pure: no schema, no room, no wall clock. Table-free: every def-derived
 * fact (`slamsStunned`, the maneuver weapon id) arrives already resolved on `ContactCar`.
 *
 * Runs where `applyRams` used to run — after driving has resolved for the tick, before combat.
 */

/** One car as the contact pass sees it. `RamCar` plus the maneuver facts it is table-free without. */
export interface ContactCar extends RamCar {
  maneuver: number;
  /** May this car's slam land on an already-stunned victim (O3)? Resolved from its charge weapon. */
  slamsStunned: boolean;
  /** Is this car currently stunned? Gates whether an incoming slam needs `slamsStunned` to land. */
  stunned: boolean;
  /** The weapon id behind this car's current maneuver, or `""` when it is not mid-maneuver. */
  maneuverWeaponId: WeaponId | "";
}

/** One dash or slam event: who did it, to whom, with what weapon. */
export interface ContactHit {
  attackerSessionId: string;
  targetSessionId: string;
  weaponId: WeaponId;
}

/**
 * One resolved push and who threw it. Keyed by VICTIM id in `resolveContacts`'s returned map.
 *
 * `attackerId` rides in the entry rather than being reconstructed downstream — the caller (stage 2
 * Task 5, `ram-bridge.ts`) needs it to apply the attacker's own equal-and-opposite reaction, and
 * only `resolveRam`/`resolvePair` are in a position to say which of a pair was the attacker.
 */
export interface ImpulseEntry {
  attackerId: string;
  severity: number;
  impulse: Impulse;
}

export interface ContactEvents {
  dashHits: ContactHit[];
  slams: ContactHit[];
  /** Session ids of every DASH car found pressed into level geometry this tick. */
  wallBlockedDashers: string[];
}

/**
 * Is this hull within `pad` of the arena edge or an obstacle? The wall half of dash-end and
 * wall-stun.
 *
 * The obstacle test inflates BOTH the hull and the box by `pad`, mirroring `contactNormalBetween`'s
 * convention (see `collide.ts`): `convexOverlap` treats a bare touch as separated, so a one-sided
 * inflation cannot close a gap exactly `pad` wide down to the strict overlap SAT requires — it lands
 * on that boundary and reports clear. Inflating both shapes gives the full `2 * pad` of slack the
 * predicate's name promises.
 */
export function hullTouchesWorld(hull: Obb, obstacles: readonly Aabb[], bounds: Bounds, pad: number): boolean {
  for (const c of obbCorners(hull)) {
    if (c.x <= pad || c.y <= pad || c.x >= bounds.width - pad || c.y >= bounds.height - pad) return true;
  }
  const corners = obbCorners({ x: hull.x, y: hull.y, angle: hull.angle, w: hull.w + 2 * pad, h: hull.h + 2 * pad });
  return obstacles.some((o) =>
    convexOverlap(corners, aabbCorners({ x: o.x - pad, y: o.y - pad, w: o.w + 2 * pad, h: o.h + 2 * pad })),
  );
}

/** Points from the attacker toward the victim, derived exactly as `resolveRam` derives its `away`. */
function awayFrom(attacker: ContactCar, victim: ContactCar): Vec2 | null {
  const n = contactNormalBetween(
    carHullOf(attacker.x, attacker.y, attacker.angle),
    carHullOf(victim.x, victim.y, victim.angle),
    RAM_CONFIG.contactPad,
  );
  if (n === null) return null;
  // `n` points from victim toward attacker (see `contactNormalBetween`); `away` is the reverse.
  return { x: -n.x, y: -n.y };
}

function isDasher(c: ContactCar): boolean {
  return c.maneuver === ManeuverKind.DASH && c.maneuverWeaponId !== "";
}

function isCharger(c: ContactCar): boolean {
  return c.maneuver === ManeuverKind.CHARGE && c.maneuverWeaponId !== "";
}

/**
 * One tick of contact resolution over every pair, mirroring `applyRams`: sorted session ids,
 * edge-triggered contact set, best-impulse-per-victim (a slam counts as severity 1, which always
 * wins over a graded ram).
 *
 * Classification per fresh touching pair, checked from each car's own side:
 *
 * 1. **Dash** — a DASH car whose target it may damage pushes a `dashHit` and writes no impulse.
 * 2. **Slam** — otherwise, a CHARGE car whose target it may damage slams, unless the victim is
 *    stunned and this charger's weapon does not slam stunned victims, or the victim is still immune
 *    from a previous slam. Blocked slams fall through to an ordinary ram.
 * 3. **Ram** — `resolveRam(a, b, mode)`, exactly as today.
 *
 * After the pair loop, every DASH car is swept against level geometry for `wallBlockedDashers`.
 *
 * `impulses` is keyed by VICTIM id, each entry carrying the `attackerId` alongside the resolved
 * push (`ImpulseEntry`) — the caller needs to know who threw it to apply the equal-and-opposite
 * reaction, and only this pass is in a position to say which side of a pair was the attacker.
 */
export function resolveContacts(
  cars: readonly ContactCar[],
  previous: ReadonlySet<string>,
  mode: "ffa" | "team",
  tick: number,
  slamImmuneUntil: ReadonlyMap<string, number>,
  obstacles: readonly Aabb[],
  bounds: Bounds,
): { impulses: Map<string, ImpulseEntry>; contacts: Set<string>; events: ContactEvents } {
  const ordered = [...cars].sort((x, y) => (x.sessionId < y.sessionId ? -1 : x.sessionId > y.sessionId ? 1 : 0));
  const contacts = new Set<string>();
  const best = new Map<string, ImpulseEntry>();
  const dashHits: ContactHit[] = [];
  const slams: ContactHit[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j]!;
      const key = pairKey(a.sessionId, b.sessionId);

      const touching =
        contactNormalBetween(carHullOf(a.x, a.y, a.angle), carHullOf(b.x, b.y, b.angle), RAM_CONFIG.contactPad) !==
        null;
      if (!touching) continue;
      contacts.add(key);
      if (previous.has(key)) continue;

      resolvePair(a, b, mode, tick, slamImmuneUntil, dashHits, slams, best);
    }
  }

  const wallBlockedDashers: string[] = [];
  for (const c of ordered) {
    if (!isDasher(c)) continue;
    if (hullTouchesWorld(carHullOf(c.x, c.y, c.angle), obstacles, bounds, SLAM_CONFIG.wallContactPad)) {
      wallBlockedDashers.push(c.sessionId);
    }
  }

  return {
    impulses: best,
    contacts,
    events: { dashHits, slams, wallBlockedDashers },
  };
}

/**
 * Classification is per car, dash checked first for that car: a dashing car never also charges
 * (one maneuver at a time), but a dash-vs-charger pair can produce a dashHit from the dasher AND,
 * independently, a slam from the charger against the dasher. Only when NEITHER side of the pair
 * produced a dash or an (unblocked) slam does the pair fall through to an ordinary ram.
 */
function resolvePair(
  a: ContactCar,
  b: ContactCar,
  mode: "ffa" | "team",
  tick: number,
  slamImmuneUntil: ReadonlyMap<string, number>,
  dashHits: ContactHit[],
  slams: ContactHit[],
  best: Map<string, ImpulseEntry>,
): void {
  let anyEvent = false;

  for (const [attacker, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (isDasher(attacker)) {
      if (canDamage(attacker.sessionId, attacker.team, other.sessionId, other.team, mode)) {
        dashHits.push({
          attackerSessionId: attacker.sessionId,
          targetSessionId: other.sessionId,
          weaponId: attacker.maneuverWeaponId as WeaponId,
        });
        anyEvent = true;
      }
      // Dash checked first for THIS car: a dashing car never also evaluates as a charger.
      continue;
    }

    if (isCharger(attacker)) {
      if (!canDamage(attacker.sessionId, attacker.team, other.sessionId, other.team, mode)) continue;
      if (other.stunned && !attacker.slamsStunned) continue;
      if (tick < (slamImmuneUntil.get(other.sessionId) ?? 0)) continue;

      const away = awayFrom(attacker, other);
      if (away === null) continue;

      slams.push({
        attackerSessionId: attacker.sessionId,
        targetSessionId: other.sessionId,
        weaponId: attacker.maneuverWeaponId as WeaponId,
      });
      // A slam REPLACES the graded ram with a fixed exchange (spec S3): no mass factor (`massScaled:
      // false` — a designer's escape hatch from physics, spec principle C) and no spin (`spin: 0` —
      // "a clean straight punt is the ult's signature", spec P28/P31). `uncontrolTicks` is authored
      // `0` here, same as `resolveRam`; stage 4 moves it onto `wildcharge`'s own weapon row.
      const imp: Impulse = {
        dirX: away.x,
        dirY: away.y,
        speed: SLAM_CONFIG.knockSpeed,
        spin: 0,
        massScaled: false,
        uncontrolTicks: 0,
        contactX: other.x,
        contactY: other.y,
      };
      const standing = best.get(other.sessionId);
      // A slam is severity 1 — the maximum a graded ram can ever reach — so it always wins the
      // best-impulse-per-victim contest, including a tie against an EARLIER slam on the same victim
      // this tick (two chargers landing on one car): `>=`, not `>`, is what makes "always" literal.
      if (standing === undefined || 1 >= standing.severity) {
        best.set(other.sessionId, { attackerId: attacker.sessionId, severity: 1, impulse: imp });
      }
      anyEvent = true;
    }
  }

  if (anyEvent) return;

  // Case 3: ordinary ram, exactly as `applyRams` resolves it.
  const hit = resolveRam(a, b, mode);
  if (hit === null) return;
  const standing = best.get(hit.victimId);
  if (standing === undefined || hit.severity > standing.severity) {
    best.set(hit.victimId, { attackerId: hit.attackerId, severity: hit.severity, impulse: hit.impulse });
  }
}
