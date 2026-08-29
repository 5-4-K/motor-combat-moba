import { EFFECT_CONFIG, effectDefOf, isEffectId } from "../../config/effect-config.js";
import { effectTicksOf } from "../../config/effect-ticks.js";
import type { EffectId } from "../../config/effect-types.js";
import { modifiersOf, type Modifiers } from "./modifiers.js";

/**
 * Buffs and debuffs: the sim's DURATION layer. Pure — no schema, no room, no wall clock.
 *
 * An effect is a timed licence to change a number the sim was already reading. It never deals
 * damage, never moves a car, and never reads another car. Everything it can do is enumerated by
 * `EffectChannel` and `EffectFlag`, and everything it *does* do reaches the sim through exactly one
 * type, `Modifiers`.
 *
 * **Per-tick order, and callers must use exactly this order:**
 *
 *     expireEffects -> (drive) -> (ram) -> (combat, which applies new effects)
 *
 * Expiry runs FIRST, before anything reads a modifier, so a tick never simulates an effect whose
 * last tick was the previous one. New effects land LAST, in combat, so they take hold on the
 * following tick — the same one-tick seam a ram knock already accepts, and for the same reason: the
 * thing that caused it resolved against poses this tick, and the consequence is read next tick.
 *
 * **The clock is exclusive at the end.** An effect applied on tick T with a duration of D ticks
 * carries `endsTick = T + D` and is active while `tick < endsTick`. `expireEffects` drops it on the
 * tick that equals `endsTick`, and `modifiersOf` independently refuses to read it there, so the
 * server's authoritative drop and a client reading a patch-stale list reach the same answer.
 */

/** One running effect on one car. */
export interface ActiveEffect {
  effectId: EffectId;
  /** The tick this stops applying. Active while `tick < endsTick`. */
  endsTick: number;
  /** 1 for every `refresh`/`ignore` effect; up to the row's `maxStacks` for a `stack` one. */
  stacks: number;
  /**
   * Who applied it, or `""` when nothing owned it (a pickup driven over, a room-level grant).
   *
   * The sim never reads this — no rule depends on who applied an effect — but it IS networked, so
   * that the schema stays the whole truth about a car's effects rather than one half of it with a
   * server-only map holding the other. Kill credit and per-source diminishing returns are the two
   * things that will want it; retrofitting a source through every application site later would be
   * far more expensive than the one string it costs now.
   */
  sourceSessionId: string;
}

/** The rows as they arrive off the wire, before validation. `PlayerState.effects` satisfies this. */
export interface EffectRow {
  effectId: string;
  endsTick: number;
  stacks: number;
  sourceSessionId?: string;
}

/** A car with nothing on it. */
export function newEffectState(): ActiveEffect[] {
  return [];
}

/**
 * Validate a wire list into effects the sim may read.
 *
 * Rows with an unrecognised `effectId` are dropped rather than defaulted: an unknown id is either a
 * hand-rolled client or a shared `dist` skew between the two halves of the lockstep, and both are
 * better served by the car simply carrying nothing than by it carrying a guess. `stacks` is clamped
 * into the row's own range for the same reason — the wire cannot buy a stack the table does not
 * offer.
 */
export function toActiveEffects(rows: Iterable<EffectRow>): ActiveEffect[] {
  const out: ActiveEffect[] = [];
  for (const row of rows) {
    if (!isEffectId(row.effectId)) continue;
    if (!Number.isFinite(row.endsTick)) continue;
    out.push({
      effectId: row.effectId,
      endsTick: Math.max(0, Math.trunc(row.endsTick)),
      stacks: clampStacks(row.effectId, row.stacks),
      sourceSessionId: row.sourceSessionId ?? "",
    });
  }
  return out;
}

/** `toActiveEffects` then `modifiersOf`: what a reader with only wire rows in hand actually wants. */
export function modifiersFromRows(rows: Iterable<EffectRow>, tick: number): Modifiers {
  return modifiersOf(toActiveEffects(rows), tick);
}

/**
 * Drop everything whose clock has run out, as of `tick`.
 *
 * Returns the SAME array reference when nothing expired. Most cars carry no effects on most ticks,
 * and this runs for every player every tick before driving; returning the input unchanged is what
 * keeps that free, and it also means the server bridge can skip writing the schema — a rewritten
 * `ArraySchema` patches to every client whether or not its contents changed.
 */
export function expireEffects(effects: ActiveEffect[], tick: number): ActiveEffect[] {
  if (!effects.some((e) => e.endsTick <= tick)) return effects;
  return effects.filter((e) => e.endsTick > tick);
}

/**
 * Apply one effect to a car, returning the new list. Pure: the input is never mutated.
 *
 * The three stacking rules (`EffectStacking`) are resolved here and nowhere else:
 *
 *  - already running, `ignore` — nothing happens at all. Not even the clock moves.
 *  - already running, `refresh` — the clock restarts; the magnitude is unchanged.
 *  - already running, `stack` — the clock restarts and the stack count climbs, capped by the row.
 *  - not running, and the car is at `EFFECT_CONFIG.maxActive` — dropped. A new id never evicts a
 *    running one, so a cheap effect can never be used to strip a meaningful one off a target.
 *
 * The list is kept sorted by `effectId`, which costs nothing at this size and buys a result that
 * cannot depend on the order effects arrived in — the same reason `runCombat` sorts by session id.
 */
export function applyEffect(
  effects: readonly ActiveEffect[],
  effectId: EffectId,
  tick: number,
  sourceSessionId = "",
): ActiveEffect[] {
  const def = effectDefOf(effectId);
  const duration = effectTicksOf(effectId);
  // A row authored at or below one tick would expire on the tick it landed, which reads to a player
  // as an effect that never applied. Never shorter than the one tick it takes to be simulated.
  const endsTick = tick + Math.max(1, duration);

  const existing = effects.find((e) => e.effectId === effectId && e.endsTick > tick);
  if (existing) {
    if (def.stacking === "ignore") return [...effects];
    const stacks =
      def.stacking === "stack" ? clampStacks(effectId, existing.stacks + 1) : existing.stacks;
    return sorted(
      effects.map((e) =>
        e === existing ? { ...e, endsTick, stacks, sourceSessionId } : e,
      ),
    );
  }

  // Expired rows of the same id are replaced outright rather than counted against the cap: they are
  // about to be swept by `expireEffects` and must not block their own re-application.
  const live = effects.filter((e) => e.effectId !== effectId && e.endsTick > tick);
  if (live.length >= EFFECT_CONFIG.maxActive) return [...effects];

  return sorted([...live, { effectId, endsTick, stacks: 1, sourceSessionId }]);
}

/** Every effect gone at once. A fresh match, a respawn — anything that is not "it ran out". */
export function clearEffects(): ActiveEffect[] {
  return [];
}

/** Is this effect running on this car right now? */
export function hasEffect(
  effects: readonly ActiveEffect[],
  effectId: EffectId,
  tick: number,
): boolean {
  return effects.some((e) => e.effectId === effectId && e.endsTick > tick);
}

/** Ticks left before this effect lapses; 0 once it has. The HUD's countdown comes from here. */
export function remainingTicks(effect: ActiveEffect, tick: number): number {
  return Math.max(0, effect.endsTick - tick);
}

function clampStacks(effectId: EffectId, stacks: number): number {
  const max = Math.min(effectDefOf(effectId).maxStacks, EFFECT_CONFIG.maxStacksCap);
  if (!Number.isFinite(stacks)) return 1;
  return Math.min(max, Math.max(1, Math.trunc(stacks)));
}

function sorted(effects: ActiveEffect[]): ActiveEffect[] {
  return effects.sort((a, b) => (a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0));
}
