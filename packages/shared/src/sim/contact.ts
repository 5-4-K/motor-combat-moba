import { RAM_CONFIG } from "../config/ram-config.js";
import { IMPULSE_CONFIG } from "../config/impulse-config.js";
import { SPIKE_CONFIG } from "../config/spike-config.js";
import type { WeaponId } from "../config/weapon-types.js";
import { rectPlanes } from "./boundary.js";
import {
  aabbCorners,
  aabbToObb,
  contactNormalBetween,
  convexOverlap,
  obbCorners,
  type Aabb,
  type Bounds,
  type Obb,
  type Vec2,
} from "./collide.js";
import { carHullOf } from "./context.js";
import { ManeuverKind } from "./maneuver.js";
import { contactPointOn, pairKey, resolveRam, type RamCar, type RamResolution } from "./ram.js";
import { canDamage } from "./weapons/targets.js";

/**
 * The contact pass (spec S3). Extends `applyRams`'s pair loop with one maneuver-driven case that
 * fires ahead of an ordinary ram: a car in a DASH or CHARGE maneuver reports a `ContactHit`, carrying
 * push geometry only when its weapon's `ImpulseDef` says the maneuver pushes on contact
 * (`ContactCar.pushesOnContact`). A dash and a charge were two event types, `ContactHit` and
 * `SlamEvent`, until 2026-09-19, when the only real difference between them collapsed to that one
 * boolean — a property of the weapon, not of the event. Neither builds an `Impulse` here: a dash's
 * damage and stun ride combat, and a push's magnitude, spin and control loss are assembled from the
 * weapon's own row in `ram-bridge.ts` (stage 4). Only the ram fallback still produces anything for a
 * car to be pushed by, and since stage 3 of the Unity port that is a `RamResolution` on the events,
 * not an `Impulse` this pass builds itself.
 * Pure: no schema, no room, no wall clock. Table-free: every def-derived fact (`pushesStunned`,
 * `pushesOnContact`, the maneuver weapon id) arrives already resolved on `ContactCar`.
 *
 * Runs where `applyRams` used to run — after driving has resolved for the tick, before combat.
 */

/** One car as the contact pass sees it. `RamCar` plus the maneuver facts it is table-free without. */
export interface ContactCar extends RamCar {
  maneuver: number;
  /** May this car's push land on an already-stunned victim (O3)? Resolved from its maneuver weapon. */
  pushesStunned: boolean;
  /**
   * Does this car's active maneuver weapon declare an `ImpulseDef`? Resolved by the bridge, like
   * every other def-derived fact on this type — this file stays table-free.
   */
  pushesOnContact: boolean;
  /** Is this car currently stunned? Gates whether an incoming push needs `pushesStunned` to land. */
  stunned: boolean;
  /** The weapon id behind this car's current maneuver, or `""` when it is not mid-maneuver. */
  maneuverWeaponId: WeaponId | "";
}

/** One dash or charge event: who did it, to whom, with what weapon. */
export interface ContactHit {
  attackerSessionId: string;
  targetSessionId: string;
  weaponId: WeaponId;
  /**
   * The contact geometry this push needs, or `undefined` for a hit that pushes nobody.
   *
   * Present when the car's maneuver weapon declares an `ImpulseDef` (`ContactCar.pushesOnContact`)
   * AND the two hulls were far enough apart to measure a normal. Absent covers a dash, a charge
   * whose row declares no impulse, and the degenerate exact overlap where `awayFrom` returns null.
   *
   * **`ram-bridge.ts` cannot recompute either field** — the normal is measured between two moving
   * OBBs at the moment they touched, and this pass is the only place holding both. That is why the
   * geometry rides the event rather than being looked up later.
   *
   * `contactX`/`contactY` is a GENUINE point on the hull, from `contactPointOn` — the same helper
   * every ordinary ram uses. Until 2026-09-19 it was the victim's own centre, which made
   * `applyImpulse`'s lever arm exactly zero and `ImpulseDef.spin` incapable of rotating anyone at
   * any authored value.
   */
  push?: { dirX: number; dirY: number; contactX: number; contactY: number };
}

/** One car found overlapping a `kind: "spike"` obstacle this tick — raw observation, no judgment. */
export interface SpikeContact {
  sessionId: string;
  /** Unit normal pointing OUT of the strip, into the arena — the push direction. */
  nx: number;
  ny: number;
  /** Speed INTO the surface, units/s. Positive when closing. */
  speedIn: number;
}

/**
 * One resolved spike hit. Declared HERE, in shared, rather than in the server bridge that
 * produces it: `combat.ts` consumes it (Task 9), and shared must not depend on the server.
 */
export interface SpikeHit {
  targetSessionId: string;
  /**
   * The car the death is credited to. The VICTIM'S OWN id when nobody shoved them, never `""` —
   * an empty id leaves `lastDamagerSessionId` untouched, which would hand the kill to whoever
   * last shot them minutes earlier. Self-credit is what the single kill-booking line already reads
   * as an environment death, via its `killer !== player` guard (AS21).
   */
  sourceSessionId: string;
}

export interface ContactEvents {
  /**
   * Every maneuver contact this pass resolved — dashes and charges in one list. They were two lists
   * of two types until 2026-09-19, when the only difference left between them became "does this row
   * declare a push", which is a property of the weapon rather than of the event.
   */
  contactHits: ContactHit[];
  /**
   * Every ordinary ram this pass resolved, fully classified. One entry per PAIR (spec §7.4, U39,
   * controller ruling S3-j's neighbour in this file) — there is no per-victim slot to win any more,
   * so a car rammed by two others in one tick takes both; `ram-bridge.ts` expresses that by
   * ACCUMULATING every resolution that names a car and writing the sum once (`flushRamWrites`,
   * controller ruling S3-o). It used to write each side straight onto the body as it came, which
   * silently dropped every push but the last — this claim was false for the whole of stage 3.
   */
  rams: RamResolution[];
  /** Session ids of every DASH car found pressed into level geometry this tick. */
  wallBlockedDashers: string[];
  /**
   * Every car overlapping a `kind: "spike"` obstacle this tick, with the contact normal and the
   * speed into it. Raw observation only: this pass applies no threshold, no lockout and no
   * attribution, because all three are server-side state (AS19). `ram-bridge.ts` filters.
   */
  spikeContacts: SpikeContact[];
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
  const planes = bounds.planes ?? rectPlanes(bounds.width, bounds.height);
  for (const c of obbCorners(hull)) {
    for (const plane of planes) {
      if (plane.nx * c.x + plane.ny * c.y - plane.d <= pad) return true;
    }
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

/** The maneuver loop's gate: a DASH or a CHARGE, mid-maneuver. Whether it pushes is a separate fact. */
function inManeuver(c: ContactCar): boolean {
  return (c.maneuver === ManeuverKind.DASH || c.maneuver === ManeuverKind.CHARGE) && c.maneuverWeaponId !== "";
}

/**
 * One tick of contact resolution over every pair, mirroring `applyRams`'s own pair loop: sorted
 * session ids, an edge-triggered contact set.
 *
 * **There is no per-victim slot any more** (stage 3 of the Unity port, spec §7.4, U39). Through
 * revision 2 of the car-physics rework a `best` map kept only the largest impulse per victim — a
 * maneuver push competed with a ram for that slot, and a car hit by two others in one tick kept only
 * the larger push. `resolveRam` now returns a `RamResolution` that already names every car it acts
 * on, so there is nothing left to contest a slot for: `events.rams` collects one entry per PAIR, and a
 * victim rammed by two attackers in one tick takes both — `ram-bridge.ts`'s accumulate-then-write
 * pass (`flushRamWrites`) is what expresses that, and a bridge that wrote each side onto the body as
 * it arrived would still be throwing every push but the last away. Within a pair nothing changed —
 * still exactly one of maneuver-hit/ram.
 *
 * Classification per fresh touching pair, checked from each car's own side:
 *
 * 1. **Maneuver hit** — a DASH or CHARGE car whose target it may damage reports a `ContactHit`.
 *    Whether the hit carries push geometry is `ContactCar.pushesOnContact` alone (a dash never does
 *    today; a charge does when its weapon declares an `ImpulseDef`) — gated further by the victim
 *    being stunned without `pushesStunned`, or still immune from a previous push. A hit that carries
 *    no push is never gated by either check: there is no victim to protect and no stun to land.
 * 2. **Ram** — `resolveRam(a, b, mode)`, exactly as today, only when neither side produced a hit.
 *
 * After the pair loop, every DASH car is swept against level geometry for `wallBlockedDashers`.
 */
export function resolveContacts(
  cars: readonly ContactCar[],
  previous: ReadonlySet<string>,
  mode: "ffa" | "team",
  tick: number,
  pushImmuneUntil: ReadonlyMap<string, number>,
  obstacles: readonly Aabb[],
  bounds: Bounds,
): { contacts: Set<string>; events: ContactEvents } {
  const ordered = [...cars].sort((x, y) => (x.sessionId < y.sessionId ? -1 : x.sessionId > y.sessionId ? 1 : 0));
  const contacts = new Set<string>();
  const contactHits: ContactHit[] = [];
  const rams: RamResolution[] = [];

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

      resolvePair(a, b, mode, tick, pushImmuneUntil, contactHits, rams);
    }
  }

  const wallBlockedDashers: string[] = [];
  for (const c of ordered) {
    if (!isDasher(c)) continue;
    if (hullTouchesWorld(carHullOf(c.x, c.y, c.angle), obstacles, bounds, IMPULSE_CONFIG.wallContactPad)) {
      wallBlockedDashers.push(c.sessionId);
    }
  }

  // Spike detection: raw observation, no threshold, no lockout, no attribution — those are
  // server-side state (AS19) that `ram-bridge.ts` layers on top next. One report per car per tick:
  // a car overlapping two strips (a corner of the octagon) is still one set of spikes, so the inner
  // loop stops at the first hit.
  const spikeContacts: SpikeContact[] = [];
  for (const c of ordered) {
    const hull = carHullOf(c.x, c.y, c.angle);
    for (const box of obstacles) {
      if (box.kind !== "spike") continue;
      const n = contactNormalBetween(hull, aabbToObb(box), SPIKE_CONFIG.contactPad);
      if (n === null) continue;
      // `contactNormalBetween(a, b)` points from b toward a — out of the strip, into the arena.
      // Speed INTO the surface is therefore the NEGATIVE of the velocity's component along it:
      // positive when the car is closing, negative when it is driving away.
      spikeContacts.push({
        sessionId: c.sessionId,
        nx: n.x,
        ny: n.y,
        speedIn: -(c.vx * n.x + c.vy * n.y),
      });
      break;
    }
  }

  return {
    contacts,
    events: { contactHits, rams, wallBlockedDashers, spikeContacts },
  };
}

/**
 * Classification is per car, checked from each side of the pair independently: a car in a maneuver
 * never also evaluates as a ram attacker for that same side (the `continue` below skips straight to
 * the next side once a hit is reported), but a dash-vs-charge pair can produce a `ContactHit` from
 * each side, independently. Only when NEITHER side of the pair produced a hit does the pair fall
 * through to an ordinary ram.
 */
function resolvePair(
  a: ContactCar,
  b: ContactCar,
  mode: "ffa" | "team",
  tick: number,
  pushImmuneUntil: ReadonlyMap<string, number>,
  contactHits: ContactHit[],
  rams: RamResolution[],
): void {
  let anyEvent = false;

  for (const [attacker, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (!inManeuver(attacker)) continue;
    if (!canDamage(attacker.sessionId, attacker.team, other.sessionId, other.team, mode)) continue;

    // The three gates below are the PUSH's, not the maneuver's: a hit that pushes nobody has no
    // victim to protect from re-pushing and no stun to land, so it is never gated by them.
    let push: ContactHit["push"];
    if (attacker.pushesOnContact) {
      if (other.stunned && !attacker.pushesStunned) continue;
      if (tick < (pushImmuneUntil.get(other.sessionId) ?? 0)) continue;
      const away = awayFrom(attacker, other);
      if (away !== null) {
        const point = contactPointOn(other, attacker);
        push = { dirX: away.x, dirY: away.y, contactX: point.x, contactY: point.y };
      }
    }

    contactHits.push({
      attackerSessionId: attacker.sessionId,
      targetSessionId: other.sessionId,
      weaponId: attacker.maneuverWeaponId as WeaponId,
      push,
    });
    anyEvent = true;
  }

  if (anyEvent) return;

  // Ordinary ram, exactly as `applyRams` resolves it. One resolution per PAIR — unlike the old
  // impulse map there is no per-victim slot to win, because a resolution names every car it acts on.
  // A car rammed by two others in one tick therefore takes both, which `ram-bridge.ts` expresses by
  // summing every resolution that names it and writing the total once (`flushRamWrites`).
  const ram = resolveRam(a, b, mode);
  if (ram !== null) rams.push(ram);
}
