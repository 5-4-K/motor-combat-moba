/**
 * The FX event seam: what to spawn an effect for, derived by diffing two consecutive world views.
 *
 * **Nothing here goes on the wire (VFX9–VFX12).** Every event is recovered from state a client
 * already has, which keeps hard invariant 8 intact — `stepSim` reads none of it — and, the reason
 * that actually decides the design, means replacing the Colyseus schema with a different wire
 * format later cannot throw this work away. A schema field added here would be.
 *
 * The views are **structural**, not schema classes. `ArenaScene` adapts whatever it is holding into
 * `FxWorldView`, so this module is testable with plain objects and the adapter is the only thing
 * such a change touches.
 */

import { isShotEnding } from "@motor-combat-moba/shared";
import { damagePoint, shotGeometriesOf, shotEndPoint, type ShotGeometry } from "./contact.js";

export interface FxCarView {
  readonly sessionId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly hp: number;
  readonly alive: boolean;
  readonly carId: string;
  // Carried for a later task (car speed for FX), not read by deriveFxEvents itself. Sourced from
  // PlayerState.vx/vy so speed can go through sim/velocity.ts's speedOf — the only place the
  // world-frame velocity conversion may be written — rather than a re-derivation from pose deltas.
  readonly vx: number;
  readonly vy: number;
}

export interface FxInstanceView {
  readonly id: string;
  readonly weaponId: string;
  /**
   * A projectile's centre, or a BEAM'S ORIGIN — never a contact point. `fx/contact.ts` is what turns
   * this into one; see its header for why the raw pose is the wrong place to burst.
   */
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /**
   * A beam's current reach along `angle`, or a burst's radius (P15: explosions spawn at full
   * extent). 0 for a flying projectile. Mirrors `WeaponInstanceState.extent`.
   *
   * `fx/contact.ts` uses it to place a burst on the point a weapon actually touched. The lava
   * stamps use it as the field's world diameter. Both already live on the schema — no new field.
   */
  readonly extent: number;
  /**
   * This row is its weapon's explosion rather than its shell. A burst carries its shell's
   * `weaponId`, so without this `instanceDefOf` would resolve a 60 u disc as a 12 u dart, and the
   * lava layer could not tell a field on the ground from the shell that made it.
   */
  readonly isExplosion: boolean;
  // Mirrors WeaponInstanceState.alive. `alive: false` is an ENDED row, and since protocol 8 it is the
  // ONLY way a shot ends on the wire: the server writes every ending onto the shot's row at its end
  // pose and holds it for `endedShotRowMs` (`combat-bridge.ts`) — a row that flips from alive, or one
  // that arrives already dead (it ended on its birth tick, or while out of this client's view). A row
  // that VANISHES has left the view (NR44) or finished its hold, and is silent. `deriveFxEvents` fires
  // `shotEnded` through the shared `isShotEnding`, exactly once per shot.
  readonly alive: boolean;
}

export interface FxWorldView {
  readonly cars: readonly FxCarView[];
  readonly instances: readonly FxInstanceView[];
}

export type FxEvent =
  | { kind: "shotFired"; weaponId: string; x: number; y: number; angle: number; instanceId: string }
  | { kind: "shotEnded"; weaponId: string; x: number; y: number; angle: number; instanceId: string }
  | { kind: "damaged"; sessionId: string; x: number; y: number; amount: number }
  | { kind: "died"; sessionId: string; x: number; y: number };

/**
 * Every effect worth firing between `prev` and `next`.
 *
 * A missing `prev` yields nothing rather than treating the whole world as new: the first view a
 * client sees would otherwise detonate every instance already in flight and spawn a muzzle flash
 * for each, which is exactly what a late joiner must not see.
 *
 * A car present in only one of the two views is skipped entirely. Joining is not a spawn effect and
 * leaving is not a death — a disconnect would otherwise blow up the car of whoever closed their
 * laptop.
 */
export function deriveFxEvents(prev: FxWorldView | undefined, next: FxWorldView): FxEvent[] {
  if (!prev) return [];
  const events: FxEvent[] = [];

  const prevInstances = new Map(prev.instances.map((i) => [i.id, i]));
  const nextInstances = new Map(next.instances.map((i) => [i.id, i]));

  for (const [id, instance] of nextInstances) {
    const before = prevInstances.get(id);
    // shotFired only for an instance that is new AND alive: one that arrives already dead gets no
    // muzzle flash — its pose is where it ENDED, nowhere near the muzzle.
    if (!before && instance.alive) {
      events.push({
        kind: "shotFired",
        weaponId: instance.weaponId,
        x: instance.x,
        y: instance.y,
        angle: instance.angle,
        instanceId: id,
      });
      continue;
    }
    // An ENDED row this view and not last view (protocol 8, `isShotEnding`): a shot that was alive
    // and has ended, or one that arrives already dead — it ended on its birth tick (a close hit or a
    // wall inside its fast-forward, Phase F final review I1), or ended while out of this client's
    // view. Its pose is its END pose, written by the server, refined into where the shot actually
    // terminated: a beam's tip rather than its muzzle, a projectile's entry face rather than wherever
    // a tick of travel left it. Cars come from `next` — the poses they are drawn at as the burst
    // spawns — so an effect always lands on the car the player sees.
    //
    // Exactly once: on the next view `before` is the ended row itself, and `isShotEnding` refuses a
    // row that was already ended. A burst never ends this way (its shell's ending is the blast, and a
    // lava field's expiry is the fade of its stamps), and a row that VANISHES fires nothing — it left
    // this client's view, or its ended row's hold ran out (G4 review, risk 1: no impact in mid-air for
    // a shot that is still flying).
    if (!isShotEnding(before, instance)) continue;
    const end = shotEndPoint(instance, next.cars);
    events.push({ kind: "shotEnded", weaponId: instance.weaponId, x: end.x, y: end.y, angle: instance.angle, instanceId: id });
  }

  const prevCars = new Map(prev.cars.map((c) => [c.sessionId, c]));
  // Resolved on the first car that actually took damage and reused for the rest: most frames have
  // no `damaged` event at all, and one that has six must not re-derive every instance six times.
  let shots: ShotGeometry[] | undefined;
  for (const car of next.cars) {
    const before = prevCars.get(car.sessionId);
    if (!before) continue;
    if (before.alive && !car.alive) {
      // A death subsumes its own killing blow: one event, not a damaged plus a died.
      events.push({ kind: "died", sessionId: car.sessionId, x: car.x, y: car.y });
      continue;
    }
    const lost = before.hp - car.hp;
    // Strictly greater than zero, so a repair pulse — hp going up — is never an impact.
    if (lost > 0) {
      // Sparks come off the skin that was struck, not the middle of the car. Falls back to the
      // centre when no shot can account for the loss — a ram, which has no entry face anyway.
      shots ??= shotGeometriesOf(next.instances);
      const hit = damagePoint(car, shots);
      events.push({ kind: "damaged", sessionId: car.sessionId, x: hit.x, y: hit.y, amount: lost });
    }
  }

  return events;
}
