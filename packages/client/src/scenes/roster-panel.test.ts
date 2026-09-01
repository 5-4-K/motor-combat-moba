import { describe, expect, it } from "vitest";
import { FLOW_CONFIG, MAX_PLAYERS, PlayerStatus } from "@motor-combat-moba/shared";
import { ARENA_VIEW_WIDTH, HUD_GUTTER_WIDTH, VIEW_WIDTH } from "../config/display.js";
import {
  ROSTER_NAME_CHAR_PX,
  ROSTER_PAD_BOTTOM_PX,
  ROSTER_PAD_TOP_PX,
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
