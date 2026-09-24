import { captureCountdownSeconds } from "@motor-combat-moba/shared";
import { hpBarColor } from "./combat-visual.js";
import {
  ROSTER_NAME_CHAR_PX,
  ROSTER_PAD_BOTTOM_PX,
  ROSTER_PAD_X_PX,
  ROSTER_ROW_GAP_PX,
  ROSTER_ROW_HEIGHT_PX,
  ROSTER_SWATCH_GAP_PX,
  ROSTER_SWATCH_PX,
  type RosterRowBox,
} from "./roster-panel.js";

/**
 * Conquer's right gutter (CQ54–CQ57), pure layout and pure text, in the shape every other
 * `*-hud.ts` module here uses — `ArenaScene` owns the pooled `Text`s and the `Graphics`, and every
 * rule about what is said and where it sits lives here, where a Node test can reach it.
 *
 * The column reads top to bottom as:
 *
 * 1. a **control panel** of fixed height {@link CONTROL_PANEL_H} — the clock, an ally and an enemy
 *    control bar with their percentages, and a one-line capture chip;
 * 2. the ordinary **weapon slots and status strip**, laid out by `slotBarLayout`/`statusStripLayout`
 *    with the panel's height as their `topInset`, exactly as the roster panel's height is in every
 *    other mode;
 * 3. the **roster**, grouped by team and anchored to the BOTTOM of the gutter, since the top is the
 *    panel's now.
 *
 * The worst case is arithmetic, pinned by `conquer-hud.test.ts` — three slots, six badges, three
 * players a side:
 *
 * ```
 * panel       112                                        -> topInset 112
 * slots       112 + 167 = 279 .. last name 463 + 64 + 6 + 12 = 545
 * strip       bottom 279 - 16 = 263, top 263 - 140 = 123 -> 11 px clear of the panel
 * roster      14 + 58 + 6 + 14 + 58 = 150, top 720 - 10 - 150 = 560 -> 15 px under the last name
 * ```
 *
 * Other modes never reach this module: the scene selects it by `winRuleOf(mode) === "conquer"`, so
 * their gutter stays exactly as it was (CQ57).
 */

// --- the control panel (CQ54) ------------------------------------------------------------------
/** The panel's full height, and therefore the slot stack's `topInset` in Conquer. */
export const CONTROL_PANEL_H = 112;
/** The clock's top edge inside the panel, and its size. */
export const CONQUER_CLOCK_Y = 6;
export const CONQUER_CLOCK_FONT_PX = 26;
/** The ally row: label and percent share a line, the bar hangs under it. */
export const CONQUER_ALLY_LABEL_Y = 38;
export const CONQUER_ALLY_BAR_Y = 52;
/** The enemy row, one row pitch (26 px) below the ally's. */
export const CONQUER_ENEMY_LABEL_Y = 64;
export const CONQUER_ENEMY_BAR_Y = 78;
/** Both control bars' thickness. */
export const CONQUER_BAR_H = 8;
/** The capture chip: ends at 92 + 16 = 108, inside the panel's 112. */
export const CONQUER_CHIP_Y = 92;
export const CONQUER_CHIP_H = 16;
/** Bar label and percent size — the gutter's one small text scale. */
export const CONQUER_LABEL_FONT_PX = 12;
/**
 * The chip's text size, and why it is small. Its longest line, `ENEMY TAKING CONTROL · 5`, is 24
 * characters; at the monospace 0.6 em advance that is 24 × 5.4 = 129.6 px at 9 px, which fits the
 * chip's {@link CONQUER_CHIP_INSET_PX}-inset 136 px and would not fit the 112 px column every other
 * row uses at any size that still reads (12 px costs 172.8).
 */
export const CONQUER_CHIP_FONT_PX = 9;
/**
 * The chip's inset from each gutter edge — narrower than `ROSTER_PAD_X_PX` on purpose: the chip is
 * the one row whose text is a sentence rather than a label, so it takes the gutter's width.
 */
export const CONQUER_CHIP_INSET_PX = 4;
/** The bars' labels (CQ54): viewer-relative, never "Team A"/"Team B". */
export const CONQUER_ALLY_LABEL = "US";
export const CONQUER_ENEMY_LABEL = "THEM";

// --- the roster (CQ54) -------------------------------------------------------------------------
/** A team header's line, above that team's rows. */
export const CONQUER_HEADER_H = 14;
/** Air between the ally group's last row and the enemy header. */
export const CONQUER_GROUP_GAP_PX = 6;
export const CONQUER_ALLY_HEADER = "YOUR TEAM";
export const CONQUER_ENEMY_HEADER = "ENEMY";

/** Where a text anchors: `x` its left edge (or its centre/right edge, per the draw), `y` its top. */
export interface HudPoint {
  readonly x: number;
  readonly y: number;
}

export interface ConquerBarLayout {
  /** Left-aligned, top-anchored. */
  readonly label: HudPoint;
  /** Right-aligned on the bar's right edge, top-anchored. */
  readonly percent: HudPoint;
  readonly bar: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface ConquerGutterLayout {
  /** Horizontally centred in the gutter, top-anchored. */
  readonly clock: HudPoint;
  /** `[ally, enemy]`. */
  readonly bars: readonly [ConquerBarLayout, ConquerBarLayout];
  readonly chip: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Pass as `slotBarLayout`'s `topInset`. */
  readonly slotTopInset: number;
  readonly roster: {
    /** `[ally, enemy]`: each header's left edge and vertical centre. */
    readonly headers: readonly [HudPoint, HudPoint];
    /** The ally rows, then the enemy rows — the same box shape `rosterPanelLayout` returns. */
    readonly rows: RosterRowBox[];
    /** The block's top edge: header of the ally group. */
    readonly top: number;
    /** Characters a name may draw, before any ` · n` respawn suffix is charged against it. */
    readonly nameMaxChars: number;
  };
}

/** A group of `n` rows' height at the roster panel's own pitch; 0 for an empty team. */
function groupRowsHeight(n: number): number {
  return n <= 0 ? 0 : n * ROSTER_ROW_HEIGHT_PX + (n - 1) * ROSTER_ROW_GAP_PX;
}

/**
 * Every anchor in Conquer's gutter, in HUD (camera-fixed) pixels. Everything but the chip is inset
 * `ROSTER_PAD_X_PX` from the gutter's left edge, the same inset the roster and the badge strip use,
 * so the column keeps one left edge; the chip is the exception, see {@link CONQUER_CHIP_INSET_PX}.
 */
export function conquerGutterLayout(
  allyCount: number,
  enemyCount: number,
  viewWidth: number,
  viewHeight: number,
  gutterWidth: number,
): ConquerGutterLayout {
  const left = viewWidth - gutterWidth + ROSTER_PAD_X_PX;
  const right = viewWidth - ROSTER_PAD_X_PX;
  const w = gutterWidth - 2 * ROSTER_PAD_X_PX;
  const bar = (labelY: number, barY: number): ConquerBarLayout => ({
    label: { x: left, y: labelY },
    percent: { x: right, y: labelY },
    bar: { x: left, y: barY, w, h: CONQUER_BAR_H },
  });

  const allyH = groupRowsHeight(allyCount);
  const enemyH = groupRowsHeight(enemyCount);
  const blockH = CONQUER_HEADER_H + allyH + CONQUER_GROUP_GAP_PX + CONQUER_HEADER_H + enemyH;
  const top = viewHeight - ROSTER_PAD_BOTTOM_PX - blockH;
  const labelX = left + ROSTER_SWATCH_PX + ROSTER_SWATCH_GAP_PX;
  const pitch = ROSTER_ROW_HEIGHT_PX + ROSTER_ROW_GAP_PX;
  const rowsFrom = (groupTop: number, n: number): RosterRowBox[] =>
    Array.from({ length: Math.max(0, n) }, (_, i) => {
      const rowTop = groupTop + i * pitch;
      return {
        x: left,
        y: rowTop + (ROSTER_ROW_HEIGHT_PX - ROSTER_SWATCH_PX) / 2,
        size: ROSTER_SWATCH_PX,
        labelX,
        centerY: rowTop + ROSTER_ROW_HEIGHT_PX / 2,
      };
    });
  const allyRowsTop = top + CONQUER_HEADER_H;
  const enemyHeaderTop = allyRowsTop + allyH + CONQUER_GROUP_GAP_PX;
  const enemyRowsTop = enemyHeaderTop + CONQUER_HEADER_H;

  return {
    clock: { x: viewWidth - gutterWidth / 2, y: CONQUER_CLOCK_Y },
    bars: [bar(CONQUER_ALLY_LABEL_Y, CONQUER_ALLY_BAR_Y), bar(CONQUER_ENEMY_LABEL_Y, CONQUER_ENEMY_BAR_Y)],
    chip: {
      x: viewWidth - gutterWidth + CONQUER_CHIP_INSET_PX,
      y: CONQUER_CHIP_Y,
      w: gutterWidth - 2 * CONQUER_CHIP_INSET_PX,
      h: CONQUER_CHIP_H,
    },
    slotTopInset: CONTROL_PANEL_H,
    roster: {
      headers: [
        { x: left, y: top + CONQUER_HEADER_H / 2 },
        { x: left, y: enemyHeaderTop + CONQUER_HEADER_H / 2 },
      ],
      rows: [...rowsFrom(allyRowsTop, allyCount), ...rowsFrom(enemyRowsTop, enemyCount)],
      top,
      nameMaxChars: Math.max(1, Math.floor((right - labelX) / ROSTER_NAME_CHAR_PX)),
    },
  };
}

// --- text --------------------------------------------------------------------------------------
export type ChipTone = "ally" | "enemy" | "neutral" | "muted";

/**
 * The capture chip (CQ55), viewer-relative: the viewer's own team reads green, the other red. A
 * holder whose streak has reached the delay is in control; before that it is counting down.
 */
export function captureChip(
  viewerTeam: number,
  holder: number,
  streak: number,
  contested: boolean,
  delayTicks: number,
  hz: number,
): { text: string; tone: ChipTone } {
  if (contested) return { text: "CONTESTED", tone: "neutral" };
  if (holder < 0) return { text: "ZONE EMPTY", tone: "muted" };
  const ours = holder === viewerTeam;
  const tone: ChipTone = ours ? "ally" : "enemy";
  const prefix = ours ? "" : "ENEMY ";
  const seconds = captureCountdownSeconds(streak, delayTicks, hz);
  if (seconds <= 0) return { text: `${prefix}HOLDING`, tone };
  return { text: `${prefix}TAKING CONTROL · ${seconds}`, tone };
}

/** Muted chip grey: the roster's dead-name grey, so the gutter has one "not happening" colour. */
export const CONQUER_MUTED_COLOR = 0x8d9096;
/** The contested chip: plain white, like the zone ring's neutral tint. */
export const CONQUER_NEUTRAL_COLOR = 0xffffff;

/** A tone's colour — ally/enemy through `hpBarColor`, so the chip, bars and zone ring agree. */
export function chipToneColor(tone: ChipTone): number {
  if (tone === "ally" || tone === "enemy") return hpBarColor(tone);
  return tone === "neutral" ? CONQUER_NEUTRAL_COLOR : CONQUER_MUTED_COLOR;
}

/** A packed `0xrrggbb` as a CSS string, for `Text.setColor`. */
export function cssOf(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/**
 * The panel's clock (CQ54): `OVERTIME` once set, otherwise `m:ss` remaining, rounded UP so the
 * first frame reads the full authored length and the last second reads 0:01 rather than 0:00.
 *
 * `matchEndsTick` is 0 for every tick before the edge into MATCH (CAR_SELECT / REVEAL /
 * COUNTDOWN) — counting down against it would misread the countdown as an elapsed, expired clock.
 * `matchTicks` (the resolved match length, e.g. `derived().deathmatchTicks.match`) is what this
 * shows instead, formatted the same way as the live countdown's first frame.
 */
export function conquerClockLabel(
  tick: number,
  matchEndsTick: number,
  overtime: boolean,
  hz: number,
  matchTicks: number,
): string {
  if (overtime) return "OVERTIME";
  const total = matchEndsTick <= 0 ? Math.max(0, Math.ceil(matchTicks / hz)) : Math.max(0, Math.ceil((matchEndsTick - tick) / hz));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** A roster name with a dead row's respawn seconds (`name · 3`), truncated to fit with the suffix. */
export function conquerRosterName(name: string, respawnIn: number, maxChars: number): string {
  const suffix = respawnIn > 0 ? ` · ${respawnIn}` : "";
  const budget = Math.max(1, maxChars - suffix.length);
  const cut = name.length <= budget ? name : `${name.slice(0, Math.max(0, budget - 1))}…`;
  return `${cut}${suffix}`;
}

/** A control bar's filled fraction, clamped to [0, 1]. */
export function controlFillFraction(controlTicks: number, targetTicks: number): number {
  if (targetTicks <= 0) return 0;
  return Math.min(1, Math.max(0, controlTicks / targetTicks));
}
