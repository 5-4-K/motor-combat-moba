import { STATUS_CONFIG, isStatusId, statusDefOf } from "../../config/status-config.js";
import { statusPulseTicksOf } from "../../config/status-ticks.js";
import type { StatusId } from "../../config/status-types.js";
import { modifiersOf, type Modifiers } from "./modifiers.js";

/**
 * Statuses: the sim's duration layer. Pure — no schema, no room, no wall clock.
 *
 * A status is a timed licence to change a number the sim was already reading, plus at most a pulse
 * and a one-shot on-apply action. It never moves a car and never reads another car. Everything it
 * can change continuously is enumerated by `StatusChannel` and `StatusFlag`, and all of that reaches
 * the sim through exactly one type, `Modifiers`.
 *
 * **Per-tick order, and callers must use exactly this order:**
 *
 *     expireStatuses -> (drive) -> (ram) -> (combat: pulses, then new statuses)
 *
 * Expiry runs FIRST, before anything reads a modifier, so a tick never simulates a status whose last
 * tick was the previous one. New statuses land LAST, in combat, so they take hold on the following
 * tick — the same one-tick seam a ram knock already accepts, and for the same reason: the thing that
 * caused it resolved against poses this tick, and the consequence is read next tick.
 *
 * **The clock is exclusive at the end.** A status applied on tick T for D ticks carries
 * `endsTick = T + D` and is active while `tick < endsTick`. `expireStatuses` drops it on the tick
 * that equals `endsTick`, and `modifiersOf` independently refuses to read it there, so the server's
 * authoritative drop and a client reading a patch-stale list reach the same answer.
 *
 * **A status does not own its duration.** Every application site supplies one, because the same
 * status is a flicker from one source and a real window from another.
 */

/** One running status on one car. */
export interface ActiveStatus {
  statusId: StatusId;
  /**
   * The tick it was applied on.
   *
   * Two things need it and neither can be derived without it. Pulses are counted from here, so two
   * cars hit a tick apart bleed a tick apart instead of in lockstep, and no accumulator has to exist
   * or be networked. And the HUD's drain bar is `(endsTick - tick) / (endsTick - startTick)` — since
   * the duration comes from the applier, the total is not recoverable from the status table.
   */
  startTick: number;
  /** The tick it stops applying. Active while `tick < endsTick`. */
  endsTick: number;
  /**
   * Who applied it, or `""` when nothing owned it (a pickup driven over, a room-level grant).
   *
   * The sim never reads this — no rule depends on who applied a status — but it IS networked, so
   * that the schema stays the whole truth about a car's statuses rather than one half of it with a
   * server-only map holding the other. Kill credit for a bleed and per-source diminishing returns
   * are the two things that will want it; retrofitting a source through every application site later
   * would be far more expensive than the one string it costs now.
   */
  sourceSessionId: string;
}

/** The rows as they arrive off the wire, before validation. `PlayerState.statuses` satisfies this. */
export interface StatusRow {
  statusId: string;
  startTick: number;
  endsTick: number;
  sourceSessionId?: string;
}

/** One hp change a pulse asks for. The caller owns hp — this module never writes it. */
export interface StatusPulseResult {
  statusId: StatusId;
  sourceSessionId: string;
  /** Hp to remove. Mutually exclusive with `heal` within one pulse. */
  damage: number;
  /** Hp to restore, before any max-hp cap the caller applies. */
  heal: number;
}

/** A car in no status. */
export function newStatusState(): ActiveStatus[] {
  return [];
}

/**
 * Validate a wire list into statuses the sim may read.
 *
 * Rows with an unrecognised `statusId` are dropped rather than defaulted: an unknown id is either a
 * hand-rolled client or a shared `dist` skew between the two halves of the lockstep, and both are
 * better served by the car carrying nothing than by it carrying a guess.
 */
export function toActiveStatuses(rows: Iterable<StatusRow>): ActiveStatus[] {
  const out: ActiveStatus[] = [];
  for (const row of rows) {
    if (!isStatusId(row.statusId)) continue;
    if (!Number.isFinite(row.endsTick) || !Number.isFinite(row.startTick)) continue;
    out.push({
      statusId: row.statusId,
      startTick: Math.max(0, Math.trunc(row.startTick)),
      endsTick: Math.max(0, Math.trunc(row.endsTick)),
      sourceSessionId: row.sourceSessionId ?? "",
    });
  }
  return out;
}

/** `toActiveStatuses` then `modifiersOf`: what a reader with only wire rows in hand actually wants. */
export function modifiersFromRows(rows: Iterable<StatusRow>, tick: number): Modifiers {
  return modifiersOf(toActiveStatuses(rows), tick);
}

/**
 * Drop everything whose clock has run out, as of `tick`.
 *
 * Returns the SAME array reference when nothing expired. Most cars are in no status on most ticks,
 * and this runs for every player every tick before driving; returning the input unchanged is what
 * keeps that free, and it also means the server bridge can skip writing the schema — a rewritten
 * `ArraySchema` patches to every client whether or not its contents changed.
 */
export function expireStatuses(statuses: ActiveStatus[], tick: number): ActiveStatus[] {
  if (!statuses.some((s) => s.endsTick <= tick)) return statuses;
  return statuses.filter((s) => s.endsTick > tick);
}

/**
 * Apply one status to a car for `durationTicks`, returning the new list. Pure: the input is never
 * mutated.
 *
 * The rules resolved here and nowhere else:
 *
 *  - `onApply.cleanse` strips every running status of that kind BEFORE this one is added, so a
 *    cleanse can never remove itself. It removes statuses; it never restores hp.
 *  - already running, `ignore` — nothing happens at all. Not even the clock moves.
 *  - already running, `refresh` — the clock is EXTENDED, never shortened. A weak, short re-application
 *    from a second source must not be able to cut a long one down, which a plain overwrite would do.
 *  - not running, and the car is at `STATUS_CONFIG.maxActive` — dropped. A new status never evicts a
 *    running one, so a cheap status can never be used to strip a meaningful one off a target.
 *
 * A duration of zero or less is refused outright rather than clamped to a tick: it means the applier
 * is misconfigured, and a status that lands for one tick reads to a player as one that never landed.
 *
 * The list is kept sorted by `statusId`, which costs nothing at this size and buys a result that
 * cannot depend on the order statuses arrived in — the same reason `runCombat` sorts by session id.
 */
export function applyStatus(
  statuses: readonly ActiveStatus[],
  statusId: StatusId,
  tick: number,
  durationTicks: number,
  sourceSessionId = "",
): ActiveStatus[] {
  if (!Number.isFinite(durationTicks) || durationTicks <= 0) return [...statuses];

  const def = statusDefOf(statusId);
  const endsTick = tick + Math.trunc(durationTicks);

  const cleanse = def.onApply?.cleanse;
  // Before the existing-instance check below, so a status that cleanses its own kind still sees a
  // correct "am I already running" answer afterwards.
  const base = cleanse
    ? statuses.filter((s) => s.endsTick <= tick || statusDefOf(s.statusId).kind !== cleanse)
    : statuses;

  const existing = base.find((s) => s.statusId === statusId && s.endsTick > tick);
  if (existing) {
    if (def.reapply === "ignore") return [...base];
    return sorted(
      base.map((s) =>
        s === existing
          ? { ...s, endsTick: Math.max(s.endsTick, endsTick), sourceSessionId }
          : s,
      ),
    );
  }

  // Expired rows of the same id are replaced outright rather than counted against the cap: they are
  // about to be swept by `expireStatuses` and must not block their own re-application.
  const live = base.filter((s) => s.statusId !== statusId && s.endsTick > tick);
  if (live.length >= STATUS_CONFIG.maxActive) return [...base];

  return sorted([...live, { statusId, startTick: tick, endsTick, sourceSessionId }]);
}

/**
 * The hp changes this car's statuses ask for on this tick.
 *
 * A pulse fires when a whole number of intervals has elapsed since the status was applied, so the
 * first one lands one interval IN rather than on the application tick — the weapon that applied the
 * status already dealt its own impact damage, and a bleed that bit instantly would be indistinguishable
 * from a bigger hit.
 *
 * Deriving the schedule from `startTick` is what keeps this stateless. An accumulator would have to
 * be networked (it changes every tick, so it would patch every tick, for every burning car), and a
 * schedule anchored to the absolute tick number would make every car in the room pulse in unison.
 *
 * Pure and read-only: it reports what should happen and the caller owns hp, exactly as `hits.ts`
 * reports damage and `runCombat` applies it.
 */
export function statusPulses(
  statuses: readonly ActiveStatus[],
  tick: number,
): StatusPulseResult[] {
  const out: StatusPulseResult[] = [];
  for (const status of statuses) {
    if (status.endsTick <= tick) continue;
    if (tick <= status.startTick) continue;
    const def = statusDefOf(status.statusId);
    if (!def.pulse) continue;
    const interval = statusPulseTicksOf(status.statusId);
    if (interval <= 0) continue;
    if ((tick - status.startTick) % interval !== 0) continue;
    out.push({
      statusId: status.statusId,
      sourceSessionId: status.sourceSessionId,
      damage: def.pulse.damage ?? 0,
      heal: def.pulse.heal ?? 0,
    });
  }
  return out;
}

/** Every status gone at once. A fresh match, a respawn — anything that is not "it ran out". */
export function clearStatuses(): ActiveStatus[] {
  return [];
}

/** Is this car in this status right now? */
export function hasStatus(
  statuses: readonly ActiveStatus[],
  statusId: StatusId,
  tick: number,
): boolean {
  return statuses.some((s) => s.statusId === statusId && s.endsTick > tick);
}

/** Ticks left before this status lapses; 0 once it has. The HUD's countdown comes from here. */
export function remainingTicks(status: ActiveStatus, tick: number): number {
  return Math.max(0, status.endsTick - tick);
}

function sorted(statuses: ActiveStatus[]): ActiveStatus[] {
  return statuses.sort((a, b) => (a.statusId < b.statusId ? -1 : a.statusId > b.statusId ? 1 : 0));
}
