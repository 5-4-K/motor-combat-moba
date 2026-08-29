import {
  STATUS_CONFIG,
  TICK_RATE_HZ,
  isStatusId,
  statusDefOf,
  type StatusId,
  type StatusKind,
  type StatusRow,
} from "@motor-combat-moba/shared";

/**
 * The status badge strip: pure derivations for what `ArenaScene` draws above the followed car's
 * weapon slots.
 *
 * Lives here rather than in `ArenaScene` for the usual reason — the scene cannot be loaded by a test
 * without a browser, and every rule about what a player is shown about their own statuses is worth
 * pinning. The scene keeps only the Phaser calls.
 *
 * **A status a player cannot see is a bug they will report as the car feeling wrong.** That is the
 * whole justification for this file: a slow with no badge reads as netcode, a bleed with no badge
 * reads as phantom damage, and neither is something a player can learn from. The badge is not
 * decoration, it is the only channel the mechanism has for explaining itself.
 */

/** One badge, ready to draw. Ordered as `statusBadges` returns them — top to bottom. */
export interface StatusBadge {
  statusId: StatusId;
  /** The status's display name, for the badge label. */
  name: string;
  kind: StatusKind;
  /** `weaponFillOf`'s counterpart: the row's own colour, as a Phaser 0xRRGGBB int. */
  fill: number;
  /** Whole seconds left, rounded up. `1` through the final second, never `0` on a live badge. */
  secondsLeft: number;
  /** 1 the tick it lands, easing to 0 as it lapses. The drain bar's height. */
  fraction: number;
}

/** `#rrggbb` to the 0xRRGGBB int Phaser wants. Mirrors `weaponFillOf` in `combat-visual.ts`. */
export function statusFillOf(statusId: StatusId): number {
  return Number.parseInt(statusDefOf(statusId).color.replace("#", ""), 16);
}

/**
 * The badges to draw for one car, as of `tick`.
 *
 * Debuffs come first, then buffs, and within each group the one lapsing soonest leads. That order is
 * a decision, not a convenience: what a player needs from this strip in a fight is "what is being
 * done to me and how long do I have to survive it", and a buff they earned is the thing they already
 * know about. Ties break on `statusId` so the strip cannot flicker between two statuses that happen
 * to end on the same tick.
 *
 * **The drain fraction is measured from the status's own `startTick`, not from anything in
 * `STATUS_TABLE`.** A status has no duration of its own — the weapon that applied it chose one — so
 * the total is only knowable from the pair of ticks on the wire. That is precisely why `startTick`
 * is a networked field.
 *
 * Expired and unrecognised rows are dropped — the same two guards `toActiveStatuses` applies, for
 * the same reasons: a patch can arrive a tick stale, and a client running a different build of
 * shared would otherwise draw a badge it has no name or colour for.
 */
export function statusBadges(rows: Iterable<StatusRow>, tick: number): StatusBadge[] {
  const badges: StatusBadge[] = [];
  for (const row of rows) {
    if (!isStatusId(row.statusId)) continue;
    const remaining = row.endsTick - tick;
    if (remaining <= 0) continue;
    const def = statusDefOf(row.statusId);
    // Floored at 1 tick: a row whose ticks are equal (or reversed, from a malformed patch) must not
    // divide by zero or produce a bar longer than its own track.
    const total = Math.max(1, row.endsTick - row.startTick);
    badges.push({
      statusId: row.statusId,
      name: def.name,
      kind: def.kind,
      fill: statusFillOf(row.statusId),
      secondsLeft: Math.ceil(remaining / TICK_RATE_HZ),
      fraction: Math.min(1, remaining / total),
    });
  }

  return badges.sort(compareBadges);
}

function compareBadges(a: StatusBadge, b: StatusBadge): number {
  if (a.kind !== b.kind) return a.kind === "debuff" ? -1 : 1;
  if (a.secondsLeft !== b.secondsLeft) return a.secondsLeft - b.secondsLeft;
  return a.statusId < b.statusId ? -1 : a.statusId > b.statusId ? 1 : 0;
}

/** One badge's box in HUD (camera-fixed) pixels. */
export interface StatusBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Badge geometry. Small: this strip is a status read, not a control. */
export const STATUS_BADGE_HEIGHT_PX = 20;
export const STATUS_BADGE_GAP_PX = 4;
/** Width of the drain bar down the badge's left edge, inside its box. */
export const STATUS_BAR_WIDTH_PX = 4;
export const STATUS_LABEL_FONT_PX = 11;
/** Air between the strip's last badge and the slot bar's first box, and its inset in the gutter. */
export const STATUS_STRIP_GAP_PX = 16;

/**
 * Where the badge strip sits: a column in the HUD gutter, bottom-aligned to `slotBarTop` so it grows
 * UPWARD as statuses arrive.
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
export function statusStripLayout(
  count: number,
  viewWidth: number,
  viewHeight: number,
  gutterWidth: number,
  slotBarTop: number,
): StatusBox[] {
  const shown = Math.min(count, STATUS_CONFIG.maxActive);
  if (shown <= 0) return [];
  const width = gutterWidth - STATUS_STRIP_GAP_PX * 2;
  const x = viewWidth - gutterWidth + STATUS_STRIP_GAP_PX;
  const pitch = STATUS_BADGE_HEIGHT_PX + STATUS_BADGE_GAP_PX;
  const bottom = Math.min(slotBarTop, viewHeight) - STATUS_STRIP_GAP_PX;
  const top = bottom - shown * pitch + STATUS_BADGE_GAP_PX;
  return Array.from({ length: shown }, (_, i) => ({
    x,
    y: top + i * pitch,
    width,
    height: STATUS_BADGE_HEIGHT_PX,
  }));
}
