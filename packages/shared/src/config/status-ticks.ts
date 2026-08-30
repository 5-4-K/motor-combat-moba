import { STATUS_TABLE, statusDefOf } from "./status-config.js";
import type { StatusId } from "./status-types.js";
import { msToTicks } from "./weapon-ticks.js";

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
 */
export const STATUS_PULSE_TICKS: Readonly<Record<StatusId, number>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(STATUS_TABLE) as StatusId[]).map((id) => {
      // Through `statusDefOf` rather than indexing the table: `as const satisfies` narrows each
      // row to its own literal type, so a row with no pulse has no `pulse` property to read.
      const pulse = statusDefOf(id).pulse;
      return [id, pulse ? Math.max(1, msToTicks(pulse.intervalMs)) : 0];
    }),
  ) as Record<StatusId, number>,
);

export function statusPulseTicksOf(id: StatusId): number {
  return STATUS_PULSE_TICKS[id];
}
