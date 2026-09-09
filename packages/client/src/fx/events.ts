/**
 * The FX event seam: what to spawn an effect for, derived by diffing two consecutive world views.
 *
 * **Nothing here goes on the wire (VFX9–VFX12).** Every event is recovered from state a client
 * already has, which keeps hard invariant 8 intact — `stepSim` reads none of it — and, the reason
 * that actually decides the design, means netcode phase 2 replacing the Colyseus schema with a
 * hand-packed binary snapshot cannot throw this work away. A schema field added here would be.
 *
 * The views are **structural**, not schema classes. `ArenaScene` adapts whatever it is holding into
 * `FxWorldView`, so this module is testable with plain objects and the adapter is the only thing
 * phase 2 touches.
 */

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
  // Mirrors WeaponInstanceState.alive. The server flips this false on the tick a shot actually
  // ends, and only deletes the row on a later tick — see deriveFxEvents for why shotEnded keys off
  // this instead of the id disappearing from the map.
  readonly alive: boolean;
}

export interface FxWorldView {
  readonly cars: readonly FxCarView[];
  readonly instances: readonly FxInstanceView[];
}

export type FxEvent =
  | { kind: "shotFired"; weaponId: string; x: number; y: number; angle: number }
  | { kind: "shotEnded"; weaponId: string; x: number; y: number; angle: number }
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
    // shotFired only for an instance that is new AND alive: one that arrives already dead (e.g. it
    // fired and ended within a single tick boundary the client observed) gets no muzzle flash.
    if (!before && instance.alive) {
      events.push({
        kind: "shotFired",
        weaponId: instance.weaponId,
        x: instance.x,
        y: instance.y,
        angle: instance.angle,
      });
    }
  }
  for (const [id, instance] of prevInstances) {
    if (!instance.alive) continue; // already ended last frame; do not fire again on deletion
    const after = nextInstances.get(id);
    // shotEnded fires the moment an instance that was alive goes away OR goes not-alive. Keying off
    // `alive` rather than the id vanishing from the map matches the client's own renderShots, which
    // stops drawing at !instance.alive — the server flips `alive` on one tick and only deletes the
    // row on a later tick, so waiting for deletion would detonate the effect ~1 tick late.
    //
    // This check is stateless yet still fires exactly once: on the frame `alive` flips false, `prev`
    // has it alive and `next` has it dead (or gone), so the event fires. On the following frame
    // `prev` itself already carries the dead (or absent) instance, so the `if (!instance.alive)
    // continue` guard above skips it before it can ever fire a second time.
    if (!after || !after.alive) {
      // A lava field's expiry is the fade of the stamps, not a second detonation. The shell's own
      // `shotEnded` is the blast; this instance carries the same `weaponId` and would otherwise
      // fire magmablast's impact bursts, scorch and camera shake two seconds later.
      if (instance.isExplosion) continue;
      // The pose is the instance's LAST KNOWN one (from `prev`), refined into where the shot
      // actually terminated: a beam's tip rather than its muzzle, a projectile's entry face rather
      // than wherever a tick of travel happened to leave it. Cars come from `next` — the poses they
      // are drawn at as the burst spawns — so an effect always lands on the car the player sees.
      const end = shotEndPoint(instance, next.cars);
      events.push({
        kind: "shotEnded",
        weaponId: instance.weaponId,
        x: end.x,
        y: end.y,
        angle: instance.angle,
      });
    }
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
