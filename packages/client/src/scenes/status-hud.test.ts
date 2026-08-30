import { describe, expect, it } from "vitest";
import {
  STATUS_CONFIG,
  STATUS_TABLE,
  TICK_RATE_HZ,
  type StatusRow,
} from "@motor-combat-moba/shared";
import {
  STATUS_BADGE_GAP_PX,
  STATUS_BADGE_HEIGHT_PX,
  statusBadges,
  statusFillOf,
  statusStripLayout,
} from "./status-hud.js";

function row(statusId: string, startTick: number, endsTick: number): StatusRow {
  return { statusId, startTick, endsTick };
}

describe("statusFillOf", () => {
  it("parses the table's own colour", () => {
    expect(statusFillOf("spiked")).toBe(
      Number.parseInt(STATUS_TABLE.spiked.color.replace("#", ""), 16),
    );
  });
});

describe("statusBadges", () => {
  it("names and colours a badge from the table", () => {
    const [badge] = statusBadges([row("fortified", 0, 100)], 0);
    expect(badge!.name).toBe(STATUS_TABLE.fortified.name);
    expect(badge!.kind).toBe("buff");
    expect(badge!.fill).toBe(statusFillOf("fortified"));
  });

  it("drops an expired row — a patch can arrive a tick stale", () => {
    expect(statusBadges([row("spiked", 0, 100)], 99)).toHaveLength(1);
    expect(statusBadges([row("spiked", 0, 100)], 100)).toHaveLength(0);
    expect(statusBadges([row("spiked", 0, 100)], 101)).toHaveLength(0);
  });

  it("drops a row it has no name or colour for", () => {
    expect(statusBadges([row("from-a-newer-build", 0, 100)], 0)).toHaveLength(0);
  });

  it("rounds seconds UP, so a live badge never reads 0s", () => {
    expect(statusBadges([row("spiked", 0, 1)], 0)[0]!.secondsLeft).toBe(1);
    expect(statusBadges([row("spiked", 0, TICK_RATE_HZ)], 0)[0]!.secondsLeft).toBe(1);
    expect(statusBadges([row("spiked", 0, TICK_RATE_HZ + 1)], 0)[0]!.secondsLeft).toBe(2);
  });

  it("drains from the row's OWN duration, which is not knowable from the status table", () => {
    // Two applications of one status with different lengths must each drain across their own span.
    const short = statusBadges([row("spiked", 0, 30)], 15)[0]!;
    const long = statusBadges([row("spiked", 0, 120)], 60)[0]!;
    expect(short.fraction).toBeCloseTo(0.5, 6);
    expect(long.fraction).toBeCloseTo(0.5, 6);
    expect(statusBadges([row("spiked", 0, 30)], 0)[0]!.fraction).toBe(1);
  });

  it("survives a malformed span without dividing by zero or overflowing its track", () => {
    expect(statusBadges([row("spiked", 100, 100)], 50)[0]!.fraction).toBe(1);
    expect(statusBadges([row("spiked", 200, 100)], 50)[0]!.fraction).toBe(1);
  });

  it("leads with debuffs, then buffs — what is being done to you outranks what you earned", () => {
    const badges = statusBadges([row("fortified", 0, 500), row("spiked", 0, 900)], 0);
    expect(badges.map((b) => b.statusId)).toEqual(["spiked", "fortified"]);
  });

  it("within a group, the one lapsing soonest leads", () => {
    const badges = statusBadges([row("spiked", 0, 900), row("corroded", 0, 200)], 0);
    expect(badges.map((b) => b.statusId)).toEqual(["corroded", "spiked"]);
  });

  it("breaks a tie on statusId, so the strip cannot flicker between two ending together", () => {
    const a = statusBadges([row("spiked", 0, 300), row("corroded", 0, 300)], 0);
    const b = statusBadges([row("corroded", 0, 300), row("spiked", 0, 300)], 0);
    expect(a.map((x) => x.statusId)).toEqual(b.map((x) => x.statusId));
  });
});

describe("statusStripLayout", () => {
  const VIEW_W = 1424;
  const VIEW_H = 720;
  const GUTTER = 144;
  const SLOT_TOP = 236;

  it("draws nothing for no badges", () => {
    expect(statusStripLayout(0, VIEW_W, VIEW_H, GUTTER, SLOT_TOP)).toEqual([]);
  });

  it("stays inside the gutter", () => {
    for (const box of statusStripLayout(3, VIEW_W, VIEW_H, GUTTER, SLOT_TOP)) {
      expect(box.x).toBeGreaterThanOrEqual(VIEW_W - GUTTER);
      expect(box.x + box.width).toBeLessThanOrEqual(VIEW_W);
    }
  });

  it("never overlaps the slot bar, even at the cap", () => {
    for (const box of statusStripLayout(STATUS_CONFIG.maxActive, VIEW_W, VIEW_H, GUTTER, SLOT_TOP)) {
      expect(box.y + box.height).toBeLessThanOrEqual(SLOT_TOP);
    }
  });

  it("grows upward, so a badge does not move when another lapses beneath it", () => {
    const two = statusStripLayout(2, VIEW_W, VIEW_H, GUTTER, SLOT_TOP);
    const three = statusStripLayout(3, VIEW_W, VIEW_H, GUTTER, SLOT_TOP);
    expect(three.at(-1)!.y).toBe(two.at(-1)!.y);
    expect(three[0]!.y).toBeLessThan(two[0]!.y);
  });

  it("stacks badges at a fixed pitch without overlapping", () => {
    const boxes = statusStripLayout(4, VIEW_W, VIEW_H, GUTTER, SLOT_TOP);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.y - boxes[i - 1]!.y).toBe(STATUS_BADGE_HEIGHT_PX + STATUS_BADGE_GAP_PX);
    }
  });

  it("never lays out more boxes than a car can carry statuses", () => {
    expect(statusStripLayout(99, VIEW_W, VIEW_H, GUTTER, SLOT_TOP)).toHaveLength(
      STATUS_CONFIG.maxActive,
    );
  });
});
