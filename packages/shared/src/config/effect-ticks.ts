import { EFFECT_TABLE } from "./effect-config.js";
import type { EffectId } from "./effect-types.js";
import { msToTicks } from "./weapon-ticks.js";

/**
 * Every effect duration in the integer ticks the sim actually counts, derived once at module load
 * and frozen.
 *
 * Same contract as `WEAPON_TICKS`, and it shares `msToTicks` with it rather than re-deriving the
 * rounding: durations are authored in milliseconds, converted in exactly one place, and rounded UP
 * so an authored duration is never shorter than written. Server and client both import shared's
 * built `dist`, so both compute identical tick counts or neither does — which is what makes an
 * ms-authored duration safe for a lockstep sim.
 */
export const EFFECT_TICKS: Readonly<Record<EffectId, number>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(EFFECT_TABLE) as EffectId[]).map((id) => [id, msToTicks(EFFECT_TABLE[id].durationMs)]),
  ) as Record<EffectId, number>,
);

export function effectTicksOf(id: EffectId): number {
  return EFFECT_TICKS[id];
}
