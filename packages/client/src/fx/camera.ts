import type { FxEvent } from "./events.js";
import type { EnvironmentFx } from "./environment.js";
import { ENVIRONMENT_FX } from "./environment.js";

/** A camera shake, in the units `Phaser.Cameras.Scene2D.Camera.shake` takes. */
export interface ShakeSpec {
  readonly durationMs: number;
  readonly intensity: number;
}

/**
 * Weapons whose ending is an explosion worth feeling.
 *
 * `magmablast` is the only row in `WEAPON_TABLE` that authors an `explosion` — `predator` is a
 * homing missile with no area burst, so it does NOT belong here. Adding a weapon to this set means
 * every one of its shots ending (including an ordinary miss or expiry, not just a kill) earns a
 * shake; check `WEAPON_TABLE[id].explosion` before regrowing it.
 */
const EXPLOSIVE = new Set(["magmablast"]);

/**
 * The shake one event earns, or `undefined` for events that must not move the camera.
 *
 * A muzzle flash never shakes: `pepperbox` alone would leave the camera permanently trembling, and
 * a camera that reacts to everything reads as reacting to nothing.
 */
export function shakeFor(
  event: FxEvent,
  env: EnvironmentFx = ENVIRONMENT_FX,
): ShakeSpec | undefined {
  const s = env.shake;
  switch (event.kind) {
    case "died":
      return { durationMs: s.diedMs, intensity: s.max };
    case "damaged":
      return {
        durationMs: s.damagedMs,
        intensity: Math.min(s.max * s.damagedCap, s.damagedBase + event.amount * s.damagedPerHp),
      };
    case "shotEnded":
      return EXPLOSIVE.has(event.weaponId)
        ? { durationMs: s.explosionMs, intensity: s.max * s.explosionCap }
        : undefined;
    case "shotFired":
      return undefined;
  }
}

/**
 * The shake for a ram, from the closing speed.
 *
 * Separate from `shakeFor` because contact is observed locally by `impact-feedback.ts` rather than
 * derived from a state delta — it has to react before the authoritative knock arrives, which is the
 * whole reason that module exists.
 *
 * Ordering across every event kind, smallest to largest, and it must stay this way: a ram must
 * never out-shake an explosion or a kill. `damaged` caps at `max * damagedCap` (0.012), explosive
 * `shotEnded` at `max * explosionCap` (0.015), `died` at `max` (0.02) — `ramShake`'s cap of
 * `max * ramCap` (0.012) ties `damaged`'s but sits strictly below both of those. The caps are
 * fractions of `max` rather than absolute intensities specifically so this ordering survives a
 * retune of `max` alone.
 */
export function ramShake(closingSpeed: number, env: EnvironmentFx = ENVIRONMENT_FX): ShakeSpec {
  const s = env.shake;
  return {
    durationMs: s.ramMs,
    // A floor of 0.006 (not 0.002), so the gentlest nudge still registers at the same feel the
    // fixed 0.006 constant this replaced always had — contact with no feedback reads as the car
    // catching on nothing. The cap sits at max * ramCap (0.6) rather than 0.5 so a supplied
    // closingSpeed still has headroom above the floor instead of saturating almost immediately.
    intensity: Math.min(s.max * s.ramCap, s.ramFloor + Math.abs(closingSpeed) * s.ramPerSpeed),
  };
}

/** A shake currently playing, as far as the caller knows. */
export interface ActiveShake {
  readonly intensity: number;
  readonly endsAtMs: number;
}

/**
 * Whether a new shake should be started, given whatever is already playing.
 *
 * Phaser's `Camera.shake` silently returns without doing anything when a shake is already running
 * unless it is passed `force`, and forcing unconditionally would let a weak shake cut a strong one
 * short. So the rule is "strongest wins": a new shake starts only when nothing is playing, or when
 * it is at least as strong as what is.
 */
export function shouldStartShake(
  active: ActiveShake | undefined,
  incoming: ShakeSpec,
  nowMs: number,
): boolean {
  if (!active || nowMs >= active.endsAtMs) return true;
  return incoming.intensity >= active.intensity;
}
