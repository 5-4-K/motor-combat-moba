import type { FxEvent } from "./events.js";
import { weaponFxOf, type FxBurst, type FxChannel } from "./table.js";
import type { WeaponFxResolver } from "./tuning.js";
import type { EnvironmentFx } from "./environment.js";
import { ENVIRONMENT_FX } from "./environment.js";

/** One burst, placed in the world. The unit `fx/layer.ts` consumes. */
export interface EmitterSpec {
  readonly channel: FxChannel;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly burst: FxBurst;
}

/**
 * The most specs one frame may produce.
 *
 * A cap, not a budget guess: six cars detonating on the same tick would otherwise queue thousands
 * of particles and stall a frame. Degrading — dropping the tail — is always better than a hitch,
 * and the earliest specs are kept so the first explosion is the one the player sees.
 */
export const MAX_SPECS_PER_FRAME = 64;

/**
 * The damage row's bursts with their counts scaled to the hp lost (EV22).
 *
 * The row's authored `count` is the CAP. A cap of zero means the cell is switched off and must stay
 * off — flooring it back to `countFloor` there would make a disabled burst impossible to express,
 * which is the whole point of PG42's `count: 0` off switch.
 */
function damageBursts(amount: number, template: readonly FxBurst[], env: EnvironmentFx): FxBurst[] {
  const { sparkPerHp, countFloor } = env.carBursts;
  return template.map((burst) => ({
    ...burst,
    count:
      burst.count === 0
        ? 0
        : Math.max(countFloor, Math.min(burst.count, Math.round(amount * sparkPerHp))),
  }));
}

/**
 * Every burst one event asks for, placed at its pose.
 *
 * `resolve` defaults to the shipped table. The playground passes its own (spec PG46) — injected
 * rather than read from a module-level store, so a shipped arena or practice session cannot render
 * anything but `WEAPON_FX` no matter what a developer saved in this browser.
 */
export function emitterSpecsFor(
  event: FxEvent,
  resolve: WeaponFxResolver = weaponFxOf,
  env: EnvironmentFx = ENVIRONMENT_FX,
): EmitterSpec[] {
  const place = (bursts: readonly FxBurst[], angle: number): EmitterSpec[] =>
    bursts
      // PG47: a zero-count burst is dropped here rather than handed to `emitParticleAt`, so an off
      // channel costs no emitter call and none of `MAX_SPECS_PER_FRAME`.
      .filter((burst) => burst.count > 0)
      .map((burst) => ({ channel: burst.channel, x: event.x, y: event.y, angle, burst }));

  switch (event.kind) {
    case "shotFired":
      return place(resolve(event.weaponId).muzzle, event.angle);
    case "shotEnded":
      return place(resolve(event.weaponId).impact, event.angle);
    case "damaged":
      return place(damageBursts(event.amount, resolve("carDamage").impact, env), 0);
    case "died":
      return place(resolve("carDeath").impact, 0);
  }
}

/** Every event's specs, flattened and capped at `MAX_SPECS_PER_FRAME`. */
export function emitterSpecsForAll(
  events: readonly FxEvent[],
  resolve: WeaponFxResolver = weaponFxOf,
  env: EnvironmentFx = ENVIRONMENT_FX,
): EmitterSpec[] {
  const specs: EmitterSpec[] = [];
  for (const event of events) {
    for (const spec of emitterSpecsFor(event, resolve, env)) {
      if (specs.length >= MAX_SPECS_PER_FRAME) return specs;
      specs.push(spec);
    }
  }
  return specs;
}
