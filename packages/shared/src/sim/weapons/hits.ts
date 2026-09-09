import { explosionDamageModeOf, instanceDefOf } from "../../config/weapon-config.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import type { Obb } from "../collide.js";
import type { WeaponInstance } from "./instances.js";
import { beamShapeAt, projectileShapeAt, shapeHitsObb, smear } from "./shapes.js";
import { canDamage } from "./targets.js";

/** One damageable car as the hit test sees it. Poses only — no hp, no status, no schema. */
export interface PoseEntry {
  sessionId: string;
  team: 0 | 1;
  hull: Obb;
}

/**
 * Everyone a hit may land on this tick, sorted by `sessionId`.
 *
 * This is the lag-compensation seam (D20). Hit testing is a pure function of an instance and a
 * snapshot, so adding rewind later means passing a snapshot rebuilt from a pose history — a
 * call-site change, not a refactor of every hit path. Nothing in this module may read player state.
 */
export type PoseSnapshot = readonly PoseEntry[];

export interface HitOutcome {
  /** The instance after the tick: pierce spent, damage clocks armed, possibly dead. */
  instance: WeaponInstance;
  /** Damage to apply, in resolution order. The caller owns hp. */
  damaged: { sessionId: string; amount: number }[];
}

/**
 * Every car this instance damages on this tick.
 *
 * Projectiles are tested as the SMEAR between `previous` and `instance`, so a fast shot cannot
 * straddle a car between samples. Beams are tested at their current extent and are never destroyed
 * by contact — they may catch several cars at once.
 *
 * The amount comes from `instance.damage`, frozen at spawn — this module never reads player state,
 * and the owner's chassis is exactly the player state it would otherwise have to read.
 *
 * Explosions have a third clock besides the interval and the once-ever: `perEntry` re-arms when a
 * car leaves the disc, so returning costs a second hit. Presence in the pose snapshot is not an
 * exit — a car dropped by `isTargetable` keeps its clock entry.
 */
export function resolveInstanceHits(
  instance: WeaponInstance,
  previous: WeaponInstance,
  snapshot: PoseSnapshot,
  mode: "ffa" | "team",
  tick: number,
): HitOutcome {
  const def = instanceDefOf(instance.weaponId, instance.isExplosion);
  // A maneuver spawns no `WeaponInstance` (Task 10 handles that branch), so this is unreachable
  // today — narrows `def` back to the two kinds a hit test has ever had to handle.
  if (def.kind === "maneuver") throw new Error(`resolveInstanceHits: maneuver weapon ${def.id} has no instance`);
  const ticks = weaponTicksOf(instance.weaponId);
  const interval = instance.isExplosion ? ticks.explosion!.damageInterval : ticks.damageInterval;
  // A lingering field asks a different question of the snapshot than a shot does, so it takes a
  // different branch below rather than a different interval. See `ExplosionDamageMode`.
  const perEntry =
    instance.isExplosion && explosionDamageModeOf(instance.weaponId) === "perEntry";

  const shape =
    def.kind === "projectile"
      ? smear(
          projectileShapeAt(def.hitbox, previous.x, previous.y, previous.angle),
          projectileShapeAt(def.hitbox, instance.x, instance.y, instance.angle),
        )
      : beamShapeAt(def.hitbox, instance.x, instance.y, instance.angle, instance.extent);

  const clock = new Map(instance.damageClock);
  const damaged: { sessionId: string; amount: number }[] = [];
  let pierceLeft = instance.pierceLeft;
  let alive = instance.alive;

  for (const entry of snapshot) {
    if (!alive) break;
    // Teammates, wrecks and the shooter are not contacts at all: the instance passes through them
    // freely and they consume no pierce. `instance.ownerTeam` is frozen at spawn (instances.ts) —
    // never looked up here — because the snapshot holds living fighters only, and an owner wrecked
    // while their own shot is in flight would otherwise vanish from it and flip the shot's allegiance.
    if (!canDamage(instance.ownerSessionId, instance.ownerTeam, entry.sessionId, entry.team, mode)) continue;

    if (perEntry) {
      // The shape test runs FIRST here, where every other mode checks the clock first. That
      // inversion IS the feature: this mode has to learn that a car is OUTSIDE, and a clock check
      // that `continue`s never reaches the test that could tell it.
      if (!shapeHitsObb(shape, entry.hull)) {
        // Re-armed. Note this only fires for a car actually IN the snapshot: one that died or went
        // `phased` inside the field was dropped by `isTargetable` and keeps its entry (LZ11).
        clock.delete(entry.sessionId);
        continue;
      }
      if (clock.has(entry.sessionId)) continue;
      damaged.push({ sessionId: entry.sessionId, amount: instance.damage });
      // Presence in the map is the whole flag. The value is Infinity rather than a tick because a
      // finite number would read as "re-arm at tick N" to anything inspecting this map generically,
      // which is precisely what this mode does not mean.
      clock.set(entry.sessionId, Number.POSITIVE_INFINITY);
      // No pierce arithmetic: a burst is a beam, and the block below skips beams anyway.
      continue;
    }

    if (tick < (clock.get(entry.sessionId) ?? 0)) continue;
    if (!shapeHitsObb(shape, entry.hull)) continue;

    damaged.push({ sessionId: entry.sessionId, amount: instance.damage });
    clock.set(entry.sessionId, interval === Number.POSITIVE_INFINITY ? interval : tick + interval);

    if (instance.kind !== "projectile") continue;
    if (pierceLeft <= 0) alive = false;
    else pierceLeft -= 1;
  }

  return { instance: { ...instance, damageClock: clock, pierceLeft, alive }, damaged };
}

export { canDamage };
