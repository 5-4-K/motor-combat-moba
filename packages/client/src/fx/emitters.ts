import type { FxEvent } from "./events.js";
import { weaponFxOf, type FxBurst, type FxChannel } from "./table.js";

/** One burst, placed in the world. The unit `fx/layer.ts` consumes. */
export interface EmitterSpec {
  readonly channel: FxChannel;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly burst: FxBurst;
}

/** Sparks per point of hp lost. */
export const DAMAGE_SPARK_SCALE = 0.5;

/**
 * The most specs one frame may produce.
 *
 * A cap, not a budget guess: six cars detonating on the same tick would otherwise queue thousands
 * of particles and stall a frame. Degrading — dropping the tail — is always better than a hitch,
 * and the earliest specs are kept so the first explosion is the one the player sees.
 */
export const MAX_SPECS_PER_FRAME = 64;

const TAU = Math.PI * 2;

/** An impact spatter whose size follows the damage. */
function damageBursts(amount: number): FxBurst[] {
  return [
    {
      channel: "spark",
      // At least one: a scratch that produces nothing reads as a hit that did not register.
      count: Math.max(1, Math.min(30, Math.round(amount * DAMAGE_SPARK_SCALE))),
      speed: 240,
      lifeMs: 300,
      size: 5,
      growPerSec: -3,
      alpha: 1,
      soot: false,
      coneRad: TAU,
    },
  ];
}

/** A death. Bigger than any single hit, and the only non-weapon source of soot. */
function deathBursts(): FxBurst[] {
  return [
    { channel: "fire", count: 26, speed: 120, lifeMs: 460, size: 60, growPerSec: 18, alpha: 1, soot: false, coneRad: TAU },
    { channel: "smoke", count: 26, speed: 90, lifeMs: 2600, size: 64, growPerSec: 70, alpha: 0.66, soot: true, coneRad: TAU },
    { channel: "spark", count: 34, speed: 340, lifeMs: 620, size: 7, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
    { channel: "debris", count: 20, speed: 150, lifeMs: 900, size: 5, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
  ];
}

/** Every burst one event asks for, placed at its pose. */
export function emitterSpecsFor(event: FxEvent): EmitterSpec[] {
  const place = (bursts: readonly FxBurst[], angle: number): EmitterSpec[] =>
    bursts.map((burst) => ({ channel: burst.channel, x: event.x, y: event.y, angle, burst }));

  switch (event.kind) {
    case "shotFired":
      return place(weaponFxOf(event.weaponId).muzzle, event.angle);
    case "shotEnded":
      return place(weaponFxOf(event.weaponId).impact, event.angle);
    case "damaged":
      return place(damageBursts(event.amount), 0);
    case "died":
      return place(deathBursts(), 0);
  }
}

/** Every event's specs, flattened and capped at `MAX_SPECS_PER_FRAME`. */
export function emitterSpecsForAll(events: readonly FxEvent[]): EmitterSpec[] {
  const specs: EmitterSpec[] = [];
  for (const event of events) {
    for (const spec of emitterSpecsFor(event)) {
      if (specs.length >= MAX_SPECS_PER_FRAME) return specs;
      specs.push(spec);
    }
  }
  return specs;
}
