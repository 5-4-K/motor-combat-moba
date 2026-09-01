import { describe, expect, it } from "vitest";
import { FLOW_CONFIG, MAX_PLAYERS, PlayerStatus } from "@motor-combat-moba/shared";
import { ARENA_VIEW_WIDTH, HUD_GUTTER_WIDTH, VIEW_WIDTH } from "../config/display.js";
import {
  ROSTER_KILLS_COLUMN_PX,
  ROSTER_NAME_CHAR_PX,
  ROSTER_PAD_BOTTOM_PX,
  ROSTER_PAD_TOP_PX,
  ROSTER_PAD_X_PX,
  ROSTER_ROW_GAP_PX,
  ROSTER_ROW_HEIGHT_PX,
  type RosterPlayer,
  rosterPanelLayout,
  rosterRows,
  truncateName,
} from "./roster-panel.js";

function player(over: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    sessionId: "a",
    name: "Ana",
    colorId: 0,
    team: 0,
    joinedAtTick: 0,
    alive: true,
    status: PlayerStatus.IN_MATCH,
    kills: 0,
    ...over,
  };
}

describe("rosterRows", () => {
  it("orders by team, then joinedAtTick, then sessionId", () => {
    const rows = rosterRows([
      player({ sessionId: "d", team: 1, joinedAtTick: 5 }),
      player({ sessionId: "c", team: 0, joinedAtTick: 9 }),
      player({ sessionId: "b", team: 0, joinedAtTick: 3 }),
      player({ sessionId: "a", team: 0, joinedAtTick: 3 }),
    ]);
    expect(rows.map((r) => r.sessionId)).toEqual(["a", "b", "c", "d"]);
  });

  it("degrades to join order in FFA, where everyone is team 0", () => {
    const rows = rosterRows([
      player({ sessionId: "z", joinedAtTick: 12 }),
      player({ sessionId: "y", joinedAtTick: 4 }),
    ]);
    expect(rows.map((r) => r.sessionId)).toEqual(["y", "z"]);
  });

  /** The row must not move when the player dies — that is the whole reason the sort is derived. */
  it("keeps a dead player listed, flagged, and in the same place", () => {
    const alive = rosterRows([player({ sessionId: "a" }), player({ sessionId: "b" })]);
    const dead = rosterRows([
      player({ sessionId: "a", alive: false }),
      player({ sessionId: "b" }),
    ]);
    expect(dead.map((r) => r.sessionId)).toEqual(alive.map((r) => r.sessionId));
    expect(dead[0]!.alive).toBe(false);
    expect(dead[1]!.alive).toBe(true);
  });

  it("lists nobody who is not in the match", () => {
    const rows = rosterRows([
      player({ sessionId: "a", status: PlayerStatus.READY }),
      player({ sessionId: "b", status: PlayerStatus.POST_MATCH }),
      player({ sessionId: "c" }),
    ]);
    expect(rows.map((r) => r.sessionId)).toEqual(["c"]);
  });

  it("never returns more rows than the room can hold", () => {
    const many = Array.from({ length: MAX_PLAYERS + 3 }, (_, i) =>
      player({ sessionId: `p${i}`, joinedAtTick: i }),
    );
    expect(rosterRows(many)).toHaveLength(MAX_PLAYERS);
  });

  it("carries the colour, so the panel never re-derives it", () => {
    expect(rosterRows([player({ colorId: 4 })])[0]!.colorId).toBe(4);
  });

  it("carries each player's kill count through to the row", () => {
    const rows = rosterRows([player({ sessionId: "a", kills: 4 })]);
    expect(rows[0]!.kills).toBe(4);
  });
});

describe("rosterPanelLayout", () => {
  const full = rosterPanelLayout(MAX_PLAYERS, VIEW_WIDTH, HUD_GUTTER_WIDTH);

  /** The number the whole gutter budget is built on. If this moves, so does the slot inset. */
  it("costs 138 px at six players", () => {
    expect(full.height).toBe(
      ROSTER_PAD_TOP_PX +
        MAX_PLAYERS * ROSTER_ROW_HEIGHT_PX +
        (MAX_PLAYERS - 1) * ROSTER_ROW_GAP_PX +
        ROSTER_PAD_BOTTOM_PX,
    );
    expect(full.height).toBe(138);
  });

  /** Zero rows must not inset the slots by two paddings' worth of nothing. */
  it("is empty and costs no height with nobody in the match", () => {
    const empty = rosterPanelLayout(0, VIEW_WIDTH, HUD_GUTTER_WIDTH);
    expect(empty.rows).toEqual([]);
    expect(empty.height).toBe(0);
  });

  it("stacks rows at a constant pitch, top down", () => {
    for (let i = 1; i < full.rows.length; i++) {
      expect(full.rows[i]!.centerY - full.rows[i - 1]!.centerY).toBe(
        ROSTER_ROW_HEIGHT_PX + ROSTER_ROW_GAP_PX,
      );
    }
  });

  /** The panel lives in the gutter for the same reason the slots do: no world is drawn under it. */
  it("keeps every swatch and name column inside the gutter", () => {
    for (const row of full.rows) {
      expect(row.x).toBeGreaterThanOrEqual(ARENA_VIEW_WIDTH);
      expect(row.labelX).toBeGreaterThan(row.x + row.size);
      expect(row.labelX).toBeLessThan(VIEW_WIDTH);
    }
  });

  it("keeps every row inside the height it charges for", () => {
    for (const row of full.rows) {
      expect(row.y).toBeGreaterThanOrEqual(0);
      expect(row.y + row.size).toBeLessThanOrEqual(full.height);
    }
  });

  it("never lays out more rows than the room can hold", () => {
    expect(rosterPanelLayout(99, VIEW_WIDTH, HUD_GUTTER_WIDTH).rows).toHaveLength(MAX_PLAYERS);
  });

  /** The budget is a character count, so it has to be one the label column can actually draw. */
  it("affords a name budget that fits the label column", () => {
    expect(full.nameMaxChars * ROSTER_NAME_CHAR_PX).toBeLessThanOrEqual(
      VIEW_WIDTH - full.rows[0]!.labelX,
    );
    expect(full.nameMaxChars).toBeGreaterThan(0);
  });

  /** The gutter is narrower than the longest legal name, so truncation is a real case. */
  it("affords fewer characters than a name may legally hold", () => {
    expect(full.nameMaxChars).toBeLessThan(FLOW_CONFIG.nameMax);
  });
});

describe("rosterPanelLayout's kills column", () => {
  const without = rosterPanelLayout(MAX_PLAYERS, VIEW_WIDTH, HUD_GUTTER_WIDTH);
  const with_ = rosterPanelLayout(MAX_PLAYERS, VIEW_WIDTH, HUD_GUTTER_WIDTH, true);

  /**
   * The whole reason the flag exists. Every pre-Deathmatch caller passes three arguments, and Last
   * Standing's and Team's panels have to stay exactly what they were — so the default is off, and
   * "off" has to be the same layout as before the parameter existed.
   */
  it("defaults off, so an unflagged call is laid out as it always was", () => {
    expect(rosterPanelLayout(MAX_PLAYERS, VIEW_WIDTH, HUD_GUTTER_WIDTH, false)).toEqual(without);
    expect(with_.nameMaxChars).toBeLessThan(without.nameMaxChars);
  });

  /** The column is horizontal budget only — it must not move a row or change the slots' inset. */
  it("changes nothing but the name budget", () => {
    expect(with_.height).toBe(without.height);
    expect(with_.rows).toEqual(without.rows);
    expect(with_.killsX).toBe(without.killsX);
  });

  it("charges exactly the column's width against the label column", () => {
    const labelX = without.rows[0]!.labelX;
    expect(with_.nameMaxChars).toBe(
      Math.floor((without.killsX - labelX - ROSTER_KILLS_COLUMN_PX) / ROSTER_NAME_CHAR_PX),
    );
  });

  /** Right-aligned on the panel's edge, the mirror of the swatch column's left inset. */
  it("anchors the count on the panel's right edge, inside the gutter", () => {
    expect(without.killsX).toBe(VIEW_WIDTH - ROSTER_PAD_X_PX);
    expect(without.killsX).toBeLessThan(VIEW_WIDTH);
    expect(without.killsX).toBeGreaterThan(without.rows[0]!.labelX);
  });

  /**
   * The bug the column was written to avoid: `nameMaxChars` is the residual of every other claim on
   * the row, so without the reservation a name using its full budget runs under a count
   * right-aligned on `killsX`. The name is truncated to the budget, so the longest one that can ever
   * be DRAWN is `nameMaxChars` characters — even though a player may legally hold `nameMax` of them.
   */
  it("keeps the longest drawable name clear of a three-digit count", () => {
    const labelX = with_.rows[0]!.labelX;
    const longest = truncateName("W".repeat(FLOW_CONFIG.nameMax), with_.nameMaxChars);
    expect(longest).toHaveLength(with_.nameMaxChars);

    const nameRight = labelX + longest.length * ROSTER_NAME_CHAR_PX;
    // Right-aligned, so a count grows leftward from `killsX`. Three digits is past anything this
    // mode's clock affords, which is the point: the budget is not sized to the expected score.
    const countLeft = with_.killsX - 3 * ROSTER_NAME_CHAR_PX;
    expect(nameRight).toBeLessThanOrEqual(countLeft);
  });

  /** The same check for the panel it replaces, to show the reservation is load-bearing. */
  it("is load-bearing: the unreserved budget would collide with a two-digit count", () => {
    const labelX = without.rows[0]!.labelX;
    const nameRight = labelX + without.nameMaxChars * ROSTER_NAME_CHAR_PX;
    expect(nameRight).toBeGreaterThan(without.killsX - 2 * ROSTER_NAME_CHAR_PX);
  });

  /** A gutter too narrow to seat both must still hand back a budget a name can be cut to. */
  it("never starves the name column, however narrow the gutter", () => {
    const narrow = rosterPanelLayout(MAX_PLAYERS, 400, 40, true);
    expect(narrow.nameMaxChars).toBeGreaterThan(0);
  });

  /** An empty roster returns no rows, but still has to answer where the column would sit. */
  it("answers killsX with nobody in the match", () => {
    expect(rosterPanelLayout(0, VIEW_WIDTH, HUD_GUTTER_WIDTH, true).killsX).toBe(without.killsX);
  });
});

describe("truncateName", () => {
  it("leaves a name that fits alone", () => {
    expect(truncateName("Ana", 13)).toBe("Ana");
    expect(truncateName("1234567890123", 13)).toBe("1234567890123");
  });

  it("cuts to the budget and spends the last character saying so", () => {
    const cut = truncateName("Bartholomew The Third", 13);
    expect(cut).toHaveLength(13);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.startsWith("Bartholomew")).toBe(true);
  });
});
