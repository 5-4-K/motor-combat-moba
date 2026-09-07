import type { FxEvent } from "./events.js";

/** A camera shake, in the units `Phaser.Cameras.Scene2D.Camera.shake` takes. */
export interface ShakeSpec {
  readonly durationMs: number;
  readonly intensity: number;
}

/**
 * How long the world runs slow after a kill, and how slow.
 *
 * Partial and brief on purpose. A full freeze reads as a dropped frame or a stutter, which is the
 * opposite of the weight it is meant to add.
 */
export const HIT_STOP_MS = 90;
export const HIT_STOP_SCALE = 0.25;

/** Beyond this, more damage buys no more shake. */
const MAX_SHAKE = 0.02;

/** Weapons whose ending is an explosion worth feeling. */
const EXPLOSIVE = new Set(["magmablast", "predator"]);

/**
 * The shake one event earns, or `undefined` for events that must not move the camera.
 *
 * A muzzle flash never shakes: `pepperbox` alone would leave the camera permanently trembling, and
 * a camera that reacts to everything reads as reacting to nothing.
 */
export function shakeFor(event: FxEvent): ShakeSpec | undefined {
  switch (event.kind) {
    case "died":
      return { durationMs: 260, intensity: MAX_SHAKE };
    case "damaged":
      return {
        durationMs: 120,
        intensity: Math.min(MAX_SHAKE * 0.6, 0.0015 + event.amount * 0.00018),
      };
    case "shotEnded":
      return EXPLOSIVE.has(event.weaponId)
        ? { durationMs: 200, intensity: MAX_SHAKE * 0.75 }
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
 */
export function ramShake(closingSpeed: number): ShakeSpec {
  return {
    durationMs: 120,
    // A floor, so the gentlest nudge still registers: contact with no feedback reads as the car
    // catching on nothing.
    intensity: Math.min(MAX_SHAKE * 0.5, 0.002 + Math.abs(closingSpeed) * 0.00002),
  };
}
