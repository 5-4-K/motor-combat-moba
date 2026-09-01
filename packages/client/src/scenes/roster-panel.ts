import { MAX_PLAYERS, PlayerStatus } from "@motor-combat-moba/shared";
import { STATUS_STRIP_GAP_PX } from "./status-hud.js";

/**
 * The roster panel: who is in this match, what colour they are, and whether they are still alive.
 *
 * Pure layout and pure ordering, in the shape `weapon-hud.ts` and `status-hud.ts` already use —
 * `ArenaScene` owns the `Text` pool and the `Graphics`, and every rule about what is listed and
 * where it sits is here, where a Node test can reach it without a canvas.
 *
 * **The panel carries no HP bar (D3).** Health already has a channel — the bar over the car — and a
 * second copy of it in the gutter builds a second place to look mid-fight, which is the cost the
 * panel exists to remove. This is glanced at between engagements; the bars are read during them.
 *
 * The panel sits at the TOP of the gutter, and the two things already in that column are pushed
 * down by exactly its height: `slotBarLayout` takes it as a `topInset`, and the status strip follows
 * for free because it is anchored to the slots. Every constant below is therefore spending against
 * a budget three things draw from — see the arithmetic on {@link rosterPanelLayout}.
 */

/** One player as the panel needs them. A structural subset of `PlayerState`, so the scene can pass
 * the schema objects straight in without copying. */
export interface RosterPlayer {
  readonly sessionId: string;
  readonly name: string;
  readonly colorId: number;
  readonly team: number;
  readonly joinedAtTick: number;
  readonly alive: boolean;
  readonly status: PlayerStatus;
  /** Shown only in Deathmatch; the panel's caller decides whether to draw the column. */
  readonly kills: number;
}

/** One row to draw, in panel order. */
export interface RosterRow {
  readonly sessionId: string;
  readonly name: string;
  readonly colorId: number;
  readonly alive: boolean;
  /** Shown only in Deathmatch; the panel's caller decides whether to draw the column. */
  readonly kills: number;
}

/**
 * Everyone in the match, in a stable order.
 *
 * Ordering is **team, then `joinedAtTick`, then `sessionId`** — derived, never insertion order, and
 * never anything that changes during a match. A row that jumps when someone dies or a patch arrives
 * is worse than no panel at all, and `joinedAtTick` is already networked for exactly this kind of
 * tie-break (D11). In FFA every player is team 0, so the sort degrades to join order.
 *
 * Dead players stay listed and are flagged rather than dropped: removing the row would shuffle the
 * list under the reader's eye at the worst possible moment, and "who is left" is a question greyed
 * rows answer better than a shrinking list does (D3). A player who *left* the room is gone from
 * `state.players` and so drops off — that is correct, and different from being dead.
 */
export function rosterRows(players: readonly RosterPlayer[]): RosterRow[] {
  return players
    .filter((player) => player.status === PlayerStatus.IN_MATCH)
    .sort(comparePlayers)
    // A room cannot hold more than `MAX_PLAYERS`, so this only ever fires on a malformed state —
    // but the panel's height is the slots' inset, and a seventh row would silently move the whole
    // gutter budget rather than merely drawing one row too many.
    .slice(0, MAX_PLAYERS)
    .map((player) => ({
      sessionId: player.sessionId,
      name: player.name,
      colorId: player.colorId,
      alive: player.alive,
      kills: player.kills,
    }));
}

function comparePlayers(a: RosterPlayer, b: RosterPlayer): number {
  if (a.team !== b.team) return a.team - b.team;
  if (a.joinedAtTick !== b.joinedAtTick) return a.joinedAtTick - b.joinedAtTick;
  return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
}

// --- the gutter budget (D12) -------------------------------------------------------------------
/**
 * A row's height and the air between rows. 18 + 2 is what makes six rows cost 138 px of a 720 px
 * column; every pixel added here comes straight out of the status strip's headroom, which clears
 * the panel by only 11 px at the shipped numbers.
 */
export const ROSTER_ROW_HEIGHT_PX = 18;
export const ROSTER_ROW_GAP_PX = 2;
/** Air above the first row and below the last, so the panel reads as a block rather than as text
 * jammed into the canvas corner. Both count against the same 11 px of slack. */
export const ROSTER_PAD_TOP_PX = 10;
export const ROSTER_PAD_BOTTOM_PX = 10;
/** The colour swatch: square, and small enough to leave 3 px of air inside `ROSTER_ROW_HEIGHT_PX`. */
export const ROSTER_SWATCH_PX = 12;
/** Swatch to name. Spends against the label column, not against the vertical budget. */
export const ROSTER_SWATCH_GAP_PX = 6;
/**
 * The panel's inset in the gutter, shared with the badge strip rather than chosen again: the two
 * are the only things in the column with a left edge, and one import is what keeps them lined up
 * when either moves.
 */
export const ROSTER_PAD_X_PX = STATUS_STRIP_GAP_PX;
/** Name size. Matches the weapon name under a slot — the gutter has one text scale, not three. */
export const ROSTER_NAME_FONT_PX = 12;
/**
 * One character's advance at `ROSTER_NAME_FONT_PX`, used to turn the label column into a character
 * budget. Sound because every HUD `Text` uses Phaser's default monospace face (`ArenaScene`'s
 * `makeHudText` sets no family), where an advance is 0.6 em — measuring the real string would need
 * a canvas, and this module stays pure for the same reason `SLOT_KEY_COLUMN_PX` is a reserved
 * budget rather than a measurement.
 */
export const ROSTER_NAME_CHAR_PX = ROSTER_NAME_FONT_PX * 0.6;

/** One row's anchors: the swatch's rect, and where its name hangs off it. */
export interface RosterRowBox {
  /** Left edge and top of the colour swatch. */
  readonly x: number;
  readonly y: number;
  /** The swatch is square. */
  readonly size: number;
  /** Left edge of the name, drawn left-aligned and vertically centred on `centerY`. */
  readonly labelX: number;
  /** The row's vertical middle — the swatch's too, so the two always share a centre line. */
  readonly centerY: number;
}

/** The panel: its rows, its total height, and the name budget its label column affords. */
export interface RosterPanelLayout {
  readonly rows: RosterRowBox[];
  /**
   * The panel's full height including padding, and therefore the slots' `topInset`. **0 for an
   * empty roster**, so a pre-reveal or free-roam frame leaves the rest of the gutter exactly where
   * it is today rather than insetting it by two paddings' worth of nothing.
   */
  readonly height: number;
  /** Characters a name may draw before {@link truncateName} has to cut it. */
  readonly nameMaxChars: number;
}

/**
 * Where the panel's rows sit, in HUD (camera-fixed) pixels. Top-anchored in the gutter, mirroring
 * `slotBarLayout`'s shape: pure in the layout it is handed, `gutterWidth` a parameter rather than an
 * import.
 *
 * The worst case is arithmetic, not hope — six players, six badges and three slots is a reachable
 * match, and it is the one this game is designed around:
 *
 * ```
 * panel      10 + 6*18 + 5*2 + 10                     = 138   -> topInset 138
 * slots      3*64 + 2*28                              = 248
 * slot top   138 + (720 - 138 - 248) / 2              = 305
 * strip      bottom 305 - 16 = 289, height 6*24 - 4 = 140
 * strip top  289 - 140                                = 149   -> 11 px clear of the panel
 * ```
 *
 * Eleven pixels is not comfortable, which is exactly why it is written down and why
 * `weapon-hud.test.ts` asserts it: the row pitch and padding above are not free parameters. A nudge
 * to either has to fail loudly rather than slide a badge under a name.
 *
 * `HUD_GUTTER_WIDTH` does not grow to fit a long name (D12) — every pixel of the gutter is width the
 * whole picture loses to `FIT`, so names truncate to the column instead.
 */
export function rosterPanelLayout(
  count: number,
  viewWidth: number,
  gutterWidth: number,
): RosterPanelLayout {
  const shown = Math.min(count, MAX_PLAYERS);
  const labelX = viewWidth - gutterWidth + ROSTER_PAD_X_PX + ROSTER_SWATCH_PX + ROSTER_SWATCH_GAP_PX;
  // Both paddings, both insets: what is left of the gutter once the swatch column and the panel's
  // own margins are paid for.
  const labelWidth = viewWidth - ROSTER_PAD_X_PX - labelX;
  const nameMaxChars = Math.max(1, Math.floor(labelWidth / ROSTER_NAME_CHAR_PX));
  if (shown <= 0) return { rows: [], height: 0, nameMaxChars };

  const x = viewWidth - gutterWidth + ROSTER_PAD_X_PX;
  const pitch = ROSTER_ROW_HEIGHT_PX + ROSTER_ROW_GAP_PX;
  const rows = Array.from({ length: shown }, (_, i) => {
    const top = ROSTER_PAD_TOP_PX + i * pitch;
    return {
      x,
      // Centred in the row rather than flush with its top, so a swatch shorter than the row's text
      // line still reads as belonging to it.
      y: top + (ROSTER_ROW_HEIGHT_PX - ROSTER_SWATCH_PX) / 2,
      size: ROSTER_SWATCH_PX,
      labelX,
      centerY: top + ROSTER_ROW_HEIGHT_PX / 2,
    };
  });
  return {
    rows,
    height:
      ROSTER_PAD_TOP_PX +
      shown * ROSTER_ROW_HEIGHT_PX +
      (shown - 1) * ROSTER_ROW_GAP_PX +
      ROSTER_PAD_BOTTOM_PX,
    nameMaxChars,
  };
}

/**
 * A name cut to the label column, with the last character spent on an ellipsis so the cut is visibly
 * a cut rather than a different name. `FLOW_CONFIG.nameMax` is 16 and the column affords fewer, so
 * this is a case players will hit rather than a guard against the impossible.
 */
export function truncateName(name: string, maxChars: number): string {
  if (name.length <= maxChars) return name;
  return `${name.slice(0, Math.max(0, maxChars - 1))}…`;
}
