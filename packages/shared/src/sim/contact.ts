import { RAM_CONFIG } from "../config/ram-config.js";
import { SLAM_CONFIG } from "../config/slam-config.js";
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
import type { Impulse } from "./impulse.js";
import { ManeuverKind } from "./maneuver.js";
import { pairKey, resolveRam, type RamCar } from "./ram.js";
import { canDamage } from "./weapons/targets.js";

/**
 * The contact pass (spec S3). Extends `applyRams`'s pair loop with two maneuver-driven cases that
 * fire ahead of an ordinary ram: a DASH pair reports a hit, and a CHARGE pair reports a hard slam.
 * Neither writes an `Impulse` — a dash's damage and stun ride combat, and a slam's push is assembled
 * from its own weapon row in `ram-bridge.ts` (stage 4). Only the ram fallback still builds one here.
 * Pure: no schema, no room, no wall clock. Table-free: every def-derived fact (`slamsStunned`, the
 * maneuver weapon id) arrives already resolved on `ContactCar`.
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
 * A slam event, plus the contact geometry only this pass can compute.
 *
 * `ram-bridge.ts` assembles the slam's `Impulse` from the weapon's own `ImpulseDef` (spec P30), but
 * that def declares a direction MODE, not a vector: `"radial"` resolves to the OBB CONTACT NORMAL
 * for a maneuver, which needs both hulls and `contactNormalBetween`. The bridge holds poses only,
 * and centre-to-centre is a different vector on any non-dead-on hit — so the geometry rides here.
 *
 * Deliberately not on `ContactHit`: a dash hit shares that type and carries no push. `SlamEvent`
 * stays structurally assignable to it, so `contactHits` takes one unchanged.
 */
export interface SlamEvent extends ContactHit {
  /** Unit vector pointing from the attacker's hull toward the victim's — the push direction. */
  dirX: number;
  dirY: number;
  /**
   * The VICTIM'S OWN CENTRE, in world space — deliberately not a point on the contact surface.
   *
   * Say that plainly because it has a consequence the field name hides: `applyImpulse` derives spin
   * from a lever arm measured as this point minus the centre of the body it is applied to, and the
   * body a slam's impulse is applied to IS this victim. The arm is therefore exactly zero, the
   * torque is zero, and **a maneuver impulse cannot rotate its victim at all** — a charge row
   * authoring a non-zero `ImpulseDef.spin` would produce exactly zero rotation, silently.
   *
   * That is correct for the one row on this path. `wildcharge` authors `spin: 0` on purpose (a
   * clean straight punt is the ult's signature, spec P28/P31), and the pre-stage-4 code carried the
   * same point with `spin: 0` hardcoded here — so nothing about the physics changed when stage 4
   * promoted `spin` to an authored field. An ordinary ram is unaffected and does spin its victims
   * for real: `resolveRam` uses `contactPointOn`, a genuine point clamped into the hull.
   *
   * Giving a charge weapon a working `spin` means deriving a real contact point here first. See
   * `ImpulseDef.spin`, and the guard in `weapon-config.test.ts` that fails the day a row authors
   * one rather than letting the weapon quietly spin nobody.
   */
  contactX: number;
  contactY: number;
}

/**
 * One resolved contact and who threw it. Keyed by VICTIM id in the returned map.
 *
 * `attackerId` rides in the entry rather than being reconstructed downstream — the caller
 * (`ram-bridge.ts`) needs it to know which player each impulse belongs to, and only
 * `resolveRam`/`resolvePair` are in a position to say which of a pair was the attacker.
 */
export interface ImpulseEntry {
  attackerId: string;
  /** What the victim takes. */
  impulse: Impulse;
  /** What the attacker takes. Computed independently by the contest, not a negated copy (R7). */
  attackerImpulse: Impulse;
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
   * last shot them minutes earlier. Self-credit is what the single kill-booking line reads as an
   * environment death, via its `killer !== player` guard (AS21).
   */
  sourceSessionId: string;
}

export interface ContactEvents {
  dashHits: ContactHit[];
  slams: SlamEvent[];
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

function isCharger(c: ContactCar): boolean {
  return c.maneuver === ManeuverKind.CHARGE && c.maneuverWeaponId !== "";
}

/**
 * One tick of contact resolution over every pair, mirroring `applyRams`: sorted session ids,
 * edge-triggered contact set, best-impulse-per-victim — ranked by `impulse.speed` now that the
 * contest replaces a single 0-1 severity grade.
 *
 * **That `best` map holds RAMS ONLY** (stage 4). A slam used to write into it too and win the single
 * per-victim slot on raw magnitude — an ordering nothing enforced structurally (R9 forbids the
 * ceiling that once did), resting only on the measured fact that the roster's hardest ram tops out
 * at 268 u/s against a slam's fixed 520. One consequence of dropping it is deliberate: a victim
 * slammed by A *and* rammed by B on one tick now takes BOTH pushes rather than whichever won the
 * slot. Within a pair nothing changed — still exactly one of dash/slam/ram.
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
 * push (`ImpulseEntry`) — the caller needs to know who threw it to apply the matching
 * `attackerImpulse` to the right player, and only this pass is in a position to say which side of a
 * pair was the attacker.
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
  const slams: SlamEvent[] = [];

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
    impulses: best,
    contacts,
    events: { dashHits, slams, wallBlockedDashers, spikeContacts },
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
  slams: SlamEvent[],
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

      // No `Impulse` is built here (stage 4) — only the event and the geometry. Everything the old
      // inline `Impulse` encoded is authored on the weapon row now: no ramDefence divisor
      // (`defenceScaled: false`, principle C's escape hatch), no spin (P28/P31), and a real
      // `uncontrolMs` where this branch hardcoded `uncontrolTicks: 0` and left a slam with no
      // control loss at all. The attacker's half is gone rather than zeroed: it existed only so the
      // bridge had one code path for both halves of an `ImpulseEntry`, and with the slam off that
      // map "the attacker takes nothing from its own slam" is expressed by not pushing it.
      slams.push({
        attackerSessionId: attacker.sessionId,
        targetSessionId: other.sessionId,
        weaponId: attacker.maneuverWeaponId as WeaponId,
        dirX: away.x,
        dirY: away.y,
        contactX: other.x,
        contactY: other.y,
      });
      anyEvent = true;
    }
  }

  if (anyEvent) return;

  // Case 3: ordinary ram, exactly as `applyRams` resolves it.
  const hit = resolveRam(a, b, mode);
  if (hit === null) return;
  const standing = best.get(hit.victimId);
  if (standing === undefined || hit.impulse.speed > standing.impulse.speed) {
    best.set(hit.victimId, { attackerId: hit.attackerId, impulse: hit.impulse, attackerImpulse: hit.attackerImpulse });
  }
}
