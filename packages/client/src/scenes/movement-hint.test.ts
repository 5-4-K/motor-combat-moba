import { describe, expect, it } from "vitest";
import { PlayerStatus, RoomPhase } from "@motor-combat-moba/shared";
import { isSpectating } from "./spectate.js";
import {
  MOVEMENT_ARROWS,
  MOVEMENT_KEYS,
  movementHintItems,
  placeMovementHint,
  showMovementHint,
} from "./movement-hint.js";

const metrics = { padX: 8, gap: 6, centerX: 640 };

describe("placeMovementHint", () => {
  it("pads a pill on both sides and leaves a label bare", () => {
    const { placements } = placeMovementHint(
      [
        { kind: "pill", width: 10 },
        { kind: "label", width: 10 },
      ],
      metrics,
    );
    expect(placements[0]!.width).toBe(26);
    expect(placements[1]!.width).toBe(10);
  });

  it("centres the whole run on centerX rather than any one cluster", () => {
    const items = movementHintItems([12, 12, 12, 12], 18, [10, 10, 10, 10], 52);
    const { placements, totalWidth } = placeMovementHint(items, metrics);
    const left = placements[0]!.x;
    const last = placements[placements.length - 1]!;
    expect(left + totalWidth).toBeCloseTo(last.x + last.width, 9);
    expect((left + last.x + last.width) / 2).toBeCloseTo(metrics.centerX, 9);
  });

  it("puts exactly one gap between neighbours and none on the ends", () => {
    const { placements, totalWidth } = placeMovementHint(
      [
        { kind: "pill", width: 10 },
        { kind: "pill", width: 10 },
        { kind: "label", width: 10 },
      ],
      metrics,
    );
    expect(placements[1]!.x - (placements[0]!.x + placements[0]!.width)).toBe(metrics.gap);
    expect(placements[2]!.x - (placements[1]!.x + placements[1]!.width)).toBe(metrics.gap);
    // 26 + 26 + 10 of drawn width, plus two gaps — never three.
    expect(totalWidth).toBe(26 + 26 + 10 + metrics.gap * 2);
  });

  it("widens the row when a glyph measures wider, without moving its centre", () => {
    // The arrows are not letter-width in most faces, which is the whole reason widths are measured
    // rather than assumed. A wider glyph must grow the row symmetrically.
    const narrow = placeMovementHint([{ kind: "pill", width: 10 }], metrics);
    const wide = placeMovementHint([{ kind: "pill", width: 30 }], metrics);
    expect(wide.totalWidth).toBe(narrow.totalWidth + 20);
    expect(wide.placements[0]!.x + wide.placements[0]!.width / 2).toBeCloseTo(metrics.centerX, 9);
    expect(narrow.placements[0]!.x + narrow.placements[0]!.width / 2).toBeCloseTo(metrics.centerX, 9);
  });

  it("survives an empty row without inventing a negative gap", () => {
    expect(placeMovementHint([], metrics)).toEqual({ placements: [], totalWidth: 0 });
  });
});

describe("movementHintItems", () => {
  it("orders the row as keys, joiner, arrows, label", () => {
    const items = movementHintItems([1, 2, 3, 4], 5, [6, 7, 8, 9], 10);
    expect(items.map((i) => i.kind)).toEqual([
      "pill", "pill", "pill", "pill",
      "label",
      "pill", "pill", "pill", "pill",
      "label",
    ]);
    expect(items.map((i) => i.width)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("prints both bindings, because arena-input accepts either", () => {
    expect(MOVEMENT_KEYS).toEqual(["W", "A", "S", "D"]);
    expect(MOVEMENT_ARROWS).toHaveLength(MOVEMENT_KEYS.length);
  });
});

describe("showMovementHint", () => {
  it("shows during the countdown", () => {
    expect(showMovementHint(RoomPhase.COUNTDOWN)).toBe(true);
  });

  it("leaves at the green light, so it never sits under a fight", () => {
    expect(showMovementHint(RoomPhase.MATCH)).toBe(false);
  });

  it("stays off in every other phase", () => {
    for (const phase of [RoomPhase.LOBBY, RoomPhase.CAR_SELECT, RoomPhase.REVEAL]) {
      expect(showMovementHint(phase)).toBe(false);
    }
  });

  /**
   * The hint draws on the spectate banner's line in the same style, so the two must never be up at
   * once. Nothing guards it — `isSpectating` is false outside `MATCH` and this is false outside
   * `COUNTDOWN`, so the phases alone keep them apart. Pinned here because extending the hint into
   * `MATCH` would silently start stacking two texts at the same y.
   */
  it("cannot overlap the spectate banner, which only appears in MATCH", () => {
    expect(showMovementHint(RoomPhase.MATCH)).toBe(false);
    expect(isSpectating(RoomPhase.COUNTDOWN, PlayerStatus.IN_MATCH, false)).toBe(false);
  });
});
