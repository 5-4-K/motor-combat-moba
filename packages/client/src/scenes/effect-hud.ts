import {
  EFFECT_CONFIG,
  TICK_RATE_HZ,
  effectDefOf,
  isEffectId,
  type EffectId,
  type EffectKind,
  type EffectRow,
} from "@motor-combat-moba/shared";

/**
 * The buff/debuff badge strip: pure derivations for what `ArenaScene` draws above the followed car's
 * weapon slots.
 *
 * Lives here rather than in `ArenaScene` for the usual reason — the scene cannot be loaded by a test
 * without a browser, and every rule about what a player is shown about their own effects is worth
 * pinning. The scene keeps only the Phaser calls.
 *
 * **An effect a player cannot see is a bug they will report as the car feeling wrong.** That is the
 * whole justification for this file: a slow with no badge reads as netcode, a damage buff with no
 * badge reads as inconsistent weapon damage, and neither is something a player can learn from. The
 * badge is not decoration, it is the only channel the mechanism has for explaining itself.
 */

/** One badge, ready to draw. Ordered as `effectBadges` returns them — left to right. */
export interface EffectBadge {
  effectId: EffectId;
  /** The effect's display name, for the label under (or beside) the badge. */
  name: string;
  kind: EffectKind;
  /** `WEAPON_TABLE.color`'s counterpart: the row's own colour, as a Phaser 0xRRGGBB int. */
  fill: number;
  /** Stack count, or `0` when the effect cannot stack — the caller draws a number only above 1. */
  stacks: number;
  /** Whole seconds left, rounded up. `1` through the final second, never `0` on a live badge. */
  secondsLeft: number;
  /** 1 the tick it lands, easing to 0 as it lapses. The drain bar's height. */
  fraction: number;
}

/** `#rrggbb` to the 0xRRGGBB int Phaser wants. Mirrors `weaponFillOf` in `combat-visual.ts`. */
export function effectFillOf(effectId: EffectId): number {
  return Number.parseInt(effectDefOf(effectId).color.replace("#", ""), 16);
}

/**
 * The badges to draw for one car, as of `tick`.
 *
 * Debuffs come first, then buffs, and within each group the one lapsing soonest leads. That order is
 * a decision, not a convenience: what a player needs from this strip in a fight is "what is being
 * done to me and how long do I have to survive it", and a buff they chose to pick up is the thing
 * they already know about. Ties break on `effectId` so the strip cannot flicker between two effects
 * that happen to end on the same tick.
 *
 * Expired and unrecognised rows are dropped — the same two guards `toActiveEffects` applies, for the
 * same reasons: a patch can arrive a tick stale, and a client running a different build of shared
 * would otherwise draw a badge it has no name or colour for.
 */
export function effectBadges(rows: Iterable<EffectRow>, tick: number): EffectBadge[] {
  const badges: EffectBadge[] = [];
  for (const row of rows) {
    if (!isEffectId(row.effectId)) continue;
    const remaining = row.endsTick - tick;
    if (remaining <= 0) continue;
    const def = effectDefOf(row.effectId);
    const total = Math.max(1, (def.durationMs / 1000) * TICK_RATE_HZ);
    badges.push({
      effectId: row.effectId,
      name: def.name,
      kind: def.kind,
      fill: effectFillOf(row.effectId),
      // 0 rather than 1 for a non-stacking effect, so the caller's "draw a count" test is a single
      // `> 1` and never has to know which rows can stack.
      stacks: def.maxStacks > 1 ? Math.max(1, row.stacks) : 0,
      secondsLeft: Math.ceil(remaining / TICK_RATE_HZ),
      // Clamped at 1: a `stack` re-application restarts a clock that can briefly exceed the row's
      // authored duration in ticks (durations round UP to whole ticks), and a bar drawn past full
      // would overflow its track.
      fraction: Math.min(1, remaining / total),
    });
  }

  return badges.sort(compareBadges);
}

function compareBadges(a: EffectBadge, b: EffectBadge): number {
  if (a.kind !== b.kind) return a.kind === "debuff" ? -1 : 1;
  if (a.secondsLeft !== b.secondsLeft) return a.secondsLeft - b.secondsLeft;
  return a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0;
}

/** One badge's box in HUD (camera-fixed) pixels. */
export interface EffectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Badge geometry. Small: this strip is a status read, not a control. */
export const EFFECT_BADGE_HEIGHT_PX = 20;
export const EFFECT_BADGE_GAP_PX = 4;
/** Width of the drain bar down the badge's left edge, inside its box. */
export const EFFECT_BAR_WIDTH_PX = 4;
export const EFFECT_LABEL_FONT_PX = 11;
/** Air between the strip's last badge and the slot bar's first box. */
export const EFFECT_STRIP_BOTTOM_GAP_PX = 16;

/**
 * Where the badge strip sits: a column in the HUD gutter, bottom-aligned to `slotBarTop` so it grows
 * UPWARD as effects arrive.
 *
 * Growing upward rather than downward is what keeps the strip from ever colliding with the weapon
 * slots, whose layout is fixed and vertically centred. It also means a badge does not move when
 * another lapses beneath it, so the eye can stay on the one it was reading — the opposite of a
 * top-anchored list, where every expiry shuffles everything below it.
 *
 * `slotBarTop` is `slotBarLayout(...)[0].y`, or the view's vertical centre when the car has no slots
 * (pre-reveal, or a spectated car whose chassis has not resolved) — the strip still has somewhere
 * sensible to be.
 */
export function effectStripLayout(
  count: number,
  viewWidth: number,
  viewHeight: number,
  gutterWidth: number,
  slotBarTop: number,
): EffectBox[] {
  const shown = Math.min(count, EFFECT_CONFIG.maxActive);
  if (shown <= 0) return [];
  const width = gutterWidth - EFFECT_STRIP_BOTTOM_GAP_PX * 2;
  const x = viewWidth - gutterWidth + EFFECT_STRIP_BOTTOM_GAP_PX;
  const pitch = EFFECT_BADGE_HEIGHT_PX + EFFECT_BADGE_GAP_PX;
  const bottom = Math.min(slotBarTop, viewHeight) - EFFECT_STRIP_BOTTOM_GAP_PX;
  const top = bottom - shown * pitch + EFFECT_BADGE_GAP_PX;
  return Array.from({ length: shown }, (_, i) => ({
    x,
    y: top + i * pitch,
    width,
    height: EFFECT_BADGE_HEIGHT_PX,
  }));
}
