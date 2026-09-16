import type { FxEvent } from "./events.js";
import type { EnvironmentFx } from "./environment.js";
import { ENVIRONMENT_FX } from "./environment.js";

/** A camera shake, in the units `Phaser.Cameras.Scene2D.Camera.shake` takes. */
export interface ShakeSpec {
  readonly durationMs: number;
  readonly intensity: number;
}

/**
 * Whether an event happened to the car this client drives — the only thing allowed to move its camera.
 *
 * With six cars on the field, shaking for every hit, kill and explosion anywhere left the camera
 * trembling almost continuously and the match barely readable. So the camera reacts to your own car
 * being struck and nothing else: another car's damage or death is someone else's shake, and an
 * explosion only counts through the `damaged` it deals you. A spike hit on your own car counts too —
 * the client sees an hp loss, not its source, and it is still your car being hurt.
 */
export function isSelfImpact(event: FxEvent, selfSessionId: string): boolean {
  return (event.kind === "damaged" || event.kind === "died") && event.sessionId === selfSessionId;
}

/**
 * The shake one event earns, or `undefined` for events that must not move the camera.
 *
 * This answers "how hard", never "whose camera" — callers gate on {@link isSelfImpact} first. A shot
 * firing or ending never shakes: `pepperbox` alone would leave the camera permanently trembling, and
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
 * Like every other shake, only for the car this client drives: `impact-feedback.ts` reports contact
 * with the local car alone.
 *
 * Ordering across every event kind, smallest to largest, and it must stay this way: a ram must
 * never out-shake a kill. `damaged` caps at `max * damagedCap` (0.012), `died` at `max` (0.02) —
 * `ramShake`'s cap of `max * ramCap` (0.012) ties `damaged`'s but sits strictly below a kill's. The
 * caps are fractions of `max` rather than absolute intensities specifically so this ordering
 * survives a retune of `max` alone.
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
