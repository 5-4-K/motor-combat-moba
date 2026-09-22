import { STATUS_TABLE } from "./status-config.js";
import type { StatusDef, StatusId } from "./status-types.js";
import { msToTicks } from "./weapon-ticks.js";
import { derived } from "../modes/active.js";

/**
 * Every status duration the sim counts in ticks, derived once at module load and frozen.
 *
 * Only the **pulse interval** lives here. A status has no duration of its own — the applier decides
 * that, and `WEAPON_TICKS` converts a weapon's authored `applies[].durationMs` for the same reason
 * and in the same way.
 *
 * Same contract as `WEAPON_TICKS`, sharing `msToTicks` with it rather than re-deriving the rounding:
 * intervals are authored in milliseconds, converted in exactly one place, and rounded UP so an
 * authored interval is never shorter than written. Server and client both import shared's built
 * `dist`, so both compute identical tick counts or neither does — which is what keeps ms-authored
 * balance safe for a lockstep sim.
 *
 * `0` for a status with no pulse. Floored at 1 for one that has one, because a pulse interval of 0
 * ticks would fire on every tick of the status and turn an authored 8-damage bleed into 240 hp/s.
 *
 * Reads `table` only, never `STATUS_TABLE` directly, so two mode bundles derive two independent
 * pulse-tick tables from two independent status tables. `table[id]` rather than `statusDefOf(id)`
 * for the same reason: `statusDefOf` reads the module-global `STATUS_TABLE`, which would silently
 * defeat the parameter.
 */
export function resolveStatusPulseTicks(
  table: Readonly<Record<StatusId, StatusDef>> = STATUS_TABLE,
): Readonly<Record<StatusId, number>> {
  return Object.freeze(
    Object.fromEntries(
      (Object.keys(table) as StatusId[]).map((id) => {
        const pulse = table[id].pulse;
        return [id, pulse ? Math.max(1, msToTicks(pulse.intervalMs)) : 0];
      }),
    ) as Record<StatusId, number>,
  );
}

/**
 * Resolved once at module load and frozen, mirroring `WEAPON_TICKS`. Kept as a standalone export —
 * it used to be what `statusPulseTicksOf` read directly before this rewrite (MC14); now it is only
 * the shipped-roster reference value a few tests compare against.
 */
export const STATUS_PULSE_TICKS: Readonly<Record<StatusId, number>> = resolveStatusPulseTicks();

/**
 * A status's pulse interval, in ticks, from the active mode bundle's own `derived.statusPulseTicks`
 * (MC14) — resolved once by `assembleModeConfig` when that bundle was built, not recomputed per call.
 */
export function statusPulseTicksOf(id: StatusId): number {
  return derived().statusPulseTicks[id];
}
