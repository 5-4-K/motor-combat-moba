import { EFFECT_LIMITS, effectDefOf } from "../../config/effect-config.js";
import type { EffectChannel, EffectFlag } from "../../config/effect-types.js";
import type { ActiveEffect } from "./effects.js";

/**
 * One car's effects, collapsed into the numbers the sim reads.
 *
 * This is the whole interface between the effect system and the rest of the tick. Nothing outside
 * this module looks at an effect list to decide anything: driving, ramming and combat each read a
 * `Modifiers` and nothing else, which is why adding an effect never touches the sim and adding a
 * channel touches exactly one call site.
 */
export interface Modifiers {
  topSpeed: number;
  accel: number;
  turnRate: number;
  damageDealt: number;
  damageTaken: number;
  weaponCooldown: number;
  ramMass: number;
  /** No new press may be committed. A press already committed still finishes — see `runCombat`. */
  disarmed: boolean;
  /** Throttle is forced to neutral. Steering, braking and drag are untouched. No row uses this. */
  immobilised: boolean;
}

/**
 * A car carrying nothing.
 *
 * Every multiplier is exactly 1 and every flag false, so a sim step taken with these is
 * arithmetically identical to the same step before the effect system existed. That is the property
 * `golden.test.ts` pins, and it is why every channel is a multiplier rather than an additive term.
 *
 * Frozen and shared: it is read on most ticks by most cars and never written.
 */
export const NEUTRAL_MODIFIERS: Readonly<Modifiers> = Object.freeze({
  topSpeed: 1,
  accel: 1,
  turnRate: 1,
  damageDealt: 1,
  damageTaken: 1,
  weaponCooldown: 1,
  ramMass: 1,
  disarmed: false,
  immobilised: false,
});

const CHANNELS = Object.keys(EFFECT_LIMITS) as EffectChannel[];

/**
 * Collapse a car's active effects into its modifiers, as of `tick`.
 *
 * Multipliers compose by multiplication, once per stack, then clamp to `EFFECT_LIMITS`. Flags OR
 * together. Both are order-independent, so the result cannot depend on the order effects landed in
 * or on the order the list happens to be stored in.
 *
 * **Expired entries are skipped rather than trusted.** The authoritative expiry pass runs once a
 * tick on the server, but the client reads this same list off a schema patch that can be up to a
 * patch behind (20 Hz patches against a 30 Hz sim), so a client would otherwise predict one or two
 * ticks of an effect the server has already dropped. Filtering here means the two sides agree on
 * the tick, not on the patch — the same reason the HUD reads `tick < pendingUntilTick` rather than
 * a boolean.
 *
 * An unrecognised id has already been dropped by `toActiveEffects`, so nothing here can reach an
 * undefined def.
 */
export function modifiersOf(effects: readonly ActiveEffect[], tick: number): Modifiers {
  const mods: Modifiers = { ...NEUTRAL_MODIFIERS };
  const flags = new Set<EffectFlag>();
  let any = false;

  for (const effect of effects) {
    if (effect.endsTick <= tick) continue;
    any = true;
    const def = effectDefOf(effect.effectId);
    const stacks = Math.max(1, effect.stacks);
    for (const channel of CHANNELS) {
      const per = def.modifiers[channel];
      if (per === undefined) continue;
      mods[channel] *= per ** stacks;
    }
    for (const flag of def.flags ?? []) flags.add(flag);
  }

  if (!any) return { ...NEUTRAL_MODIFIERS };

  for (const channel of CHANNELS) {
    const limit = EFFECT_LIMITS[channel];
    mods[channel] = Math.min(limit.max, Math.max(limit.min, mods[channel]));
  }
  mods.disarmed = flags.has("disarmed");
  mods.immobilised = flags.has("immobilised");
  return mods;
}
