import { describe, expect, it } from "vitest";
import {
  EFFECT_CONFIG,
  EFFECT_TABLE,
  TICK_RATE_HZ,
  type EffectRow,
} from "@motor-combat-moba/shared";
import {
  EFFECT_BADGE_GAP_PX,
  EFFECT_BADGE_HEIGHT_PX,
  effectBadges,
  effectFillOf,
  effectStripLayout,
} from "./effect-hud.js";

function row(effectId: string, endsTick: number, stacks = 1): EffectRow {
  return { effectId, endsTick, stacks };
}

describe("effectFillOf", () => {
  it("parses the table's own colour", () => {
    expect(effectFillOf("overdrive")).toBe(
      Number.parseInt(EFFECT_TABLE.overdrive.color.replace("#", ""), 16),
    );
  });
});

describe("effectBadges", () => {
  it("names and colours a badge from the table", () => {
    const [badge] = effectBadges([row("overdrive", 100)], 0);
    expect(badge!.name).toBe(EFFECT_TABLE.overdrive.name);
    expect(badge!.kind).toBe("buff");
    expect(badge!.fill).toBe(effectFillOf("overdrive"));
  });

  it("drops an expired row — a patch can arrive a tick stale", () => {
    expect(effectBadges([row("overdrive", 100)], 99)).toHaveLength(1);
    expect(effectBadges([row("overdrive", 100)], 100)).toHaveLength(0);
    expect(effectBadges([row("overdrive", 100)], 101)).toHaveLength(0);
  });

  it("drops a row it has no name or colour for", () => {
    expect(effectBadges([row("from-a-newer-build", 100)], 0)).toHaveLength(0);
  });

  it("rounds seconds UP, so a live badge never reads 0s", () => {
    expect(effectBadges([row("overdrive", 1)], 0)[0]!.secondsLeft).toBe(1);
    expect(effectBadges([row("overdrive", TICK_RATE_HZ)], 0)[0]!.secondsLeft).toBe(1);
    expect(effectBadges([row("overdrive", TICK_RATE_HZ + 1)], 0)[0]!.secondsLeft).toBe(2);
  });

  it("drains its fraction from 1 toward 0 and never past either end", () => {
    const ticks = (EFFECT_TABLE.overdrive.durationMs / 1000) * TICK_RATE_HZ;
    expect(effectBadges([row("overdrive", ticks)], 0)[0]!.fraction).toBeCloseTo(1, 6);
    expect(effectBadges([row("overdrive", ticks)], ticks / 2)[0]!.fraction).toBeCloseTo(0.5, 6);
    // A re-applied `stack` clock can briefly exceed the authored duration; the bar must not overflow.
    expect(effectBadges([row("overdrive", ticks * 3)], 0)[0]!.fraction).toBe(1);
  });

  it("reports stacks only for a row that can carry more than one", () => {
    expect(effectBadges([row("overdrive", 100, 1)], 0)[0]!.stacks).toBe(0);
    expect(effectBadges([row("tarred", 100, 1)], 0)[0]!.stacks).toBe(1);
    expect(effectBadges([row("tarred", 100, 2)], 0)[0]!.stacks).toBe(2);
  });

  it("leads with debuffs, then buffs — what is being done to you outranks what you picked up", () => {
    const badges = effectBadges([row("overdrive", 500), row("tarred", 900)], 0);
    expect(badges.map((b) => b.effectId)).toEqual(["tarred", "overdrive"]);
  });

  it("within a group, the one lapsing soonest leads", () => {
    const badges = effectBadges([row("tarred", 900), row("rattled", 200)], 0);
    expect(badges.map((b) => b.effectId)).toEqual(["rattled", "tarred"]);
  });

  it("breaks a tie on effectId, so the strip cannot flicker between two effects ending together", () => {
    const a = effectBadges([row("tarred", 300), row("rattled", 300)], 0);
    const b = effectBadges([row("rattled", 300), row("tarred", 300)], 0);
    expect(a.map((x) => x.effectId)).toEqual(b.map((x) => x.effectId));
  });
});

describe("effectStripLayout", () => {
  const VIEW_W = 1424;
  const VIEW_H = 720;
  const GUTTER = 144;
  const SLOT_TOP = 236;

  it("draws nothing for no badges", () => {
    expect(effectStripLayout(0, VIEW_W, VIEW_H, GUTTER, SLOT_TOP)).toEqual([]);
  });

  it("stays inside the gutter", () => {
    const boxes = effectStripLayout(3, VIEW_W, VIEW_H, GUTTER, SLOT_TOP);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(VIEW_W - GUTTER);
      expect(box.x + box.width).toBeLessThanOrEqual(VIEW_W);
    }
  });

  it("never overlaps the slot bar", () => {
    const boxes = effectStripLayout(EFFECT_CONFIG.maxActive, VIEW_W, VIEW_H, GUTTER, SLOT_TOP);
    for (const box of boxes) expect(box.y + box.height).toBeLessThanOrEqual(SLOT_TOP);
  });

  it("grows upward, so a badge does not move when another lapses beneath it", () => {
    const two = effectStripLayout(2, VIEW_W, VIEW_H, GUTTER, SLOT_TOP);
    const three = effectStripLayout(3, VIEW_W, VIEW_H, GUTTER, SLOT_TOP);
    // The bottom badge sits at the same y whatever the count; the strip extends off the top.
    expect(three.at(-1)!.y).toBe(two.at(-1)!.y);
    expect(three[0]!.y).toBeLessThan(two[0]!.y);
  });

  it("stacks badges at a fixed pitch without overlapping", () => {
    const boxes = effectStripLayout(4, VIEW_W, VIEW_H, GUTTER, SLOT_TOP);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.y - boxes[i - 1]!.y).toBe(EFFECT_BADGE_HEIGHT_PX + EFFECT_BADGE_GAP_PX);
    }
  });

  it("never lays out more boxes than a car can carry effects", () => {
    expect(effectStripLayout(99, VIEW_W, VIEW_H, GUTTER, SLOT_TOP)).toHaveLength(
      EFFECT_CONFIG.maxActive,
    );
  });
});
