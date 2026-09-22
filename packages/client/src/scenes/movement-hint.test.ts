import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { GameMode, PlayerStatus, RoomPhase } from "@motor-combat-moba/shared";
import { isSpectating } from "./spectate.js";
import { BASIC_ATTACK_CONFIG, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import { SLOT_KEYS, hintSlotOrder, hintSlotOrderDefault } from "../config/slot-keys.js";
import {
  MOVEMENT_ARROWS,
  MOVEMENT_KEYS,
  actionAltsFor,
  actionKeysFor,
  movementHintItems,
  placeMovementHint,
  showMovementHint,
} from "./movement-hint.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

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

  it("teaches only the slots the driven chassis actually has", () => {
    // VS19. This used to be a pair of module constants bound to `maxAbilitySlots`, so a two-weapon
    // chassis would have been taught the semicolon for a slot it does not carry. Those constants
    // are gone — nothing in production read them once `ArenaScene` passed the driven car's own
    // count — and these cases are the coverage that was always doing the work.
    //
    // One layout now (TR29): `actionKeysFor` prints one glyph per slot and `actionAltsFor` prints
    // no alternates at all, since there is no second binding left to show. The basic attack still
    // comes first (BA19) — but it comes first because it IS fire slot 0 now, not because the hint
    // reorders the table around it (VS15).
    expect(actionKeysFor(2, true)).toEqual(["LMB", "RMB", "Q"]);
    expect(actionKeysFor(3, true)).toEqual(["LMB", "RMB", "Q", "E"]);
    expect(actionKeysFor(4, true)).toEqual(["LMB", "RMB", "Q", "E", "SPACE"]);
    expect(actionKeysFor(3, false)).toEqual(["RMB", "Q", "E"]);
    expect(actionAltsFor(2, true)).toEqual([]);
    expect(actionAltsFor(3, true)).toEqual([]);
    expect(actionAltsFor(3, false)).toEqual([]);
    expect(hintSlotOrder(true, 3)).toEqual([0, 1, 2, 3]);
    expect(hintSlotOrder(false, 3)).toEqual([1, 2, 3]);
    // Subset, not equality: SLOT_KEYS is ceiling-length while a hint row prints one chassis's kit.
    for (const glyph of actionKeysFor(4, true)) {
      expect(SLOT_KEYS.map((k) => k.glyph)).toContain(glyph);
    }
  });

  it("teaches the basic attack first now it is on, LMB RMB Q E, with no alternates (TR30)", () => {
    // Keyed off hintSlotOrderDefault() rather than all of SLOT_KEYS, so the assertion survives the
    // basic-attack toggle in either position instead of pinning one build's slot count. The row a
    // full-kit chassis is taught in THIS build is exactly that order's glyphs, and with one layout
    // now `actionAltsFor` has nothing left to print.
    const full = WEAPON_SLOT_CONFIG.maxAbilitySlots;
    const enabled = BASIC_ATTACK_CONFIG.enabled;
    expect(actionKeysFor(full, enabled)).toEqual(["LMB", "RMB", "Q", "E"]);
    expect(actionKeysFor(full, enabled)).toEqual(hintSlotOrderDefault().map((s) => SLOT_KEYS[s]!.glyph));
    expect(actionAltsFor(full, enabled)).toEqual([]);
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
    expect(
      isSpectating(RoomPhase.COUNTDOWN, GameMode.FFA_LAST_STANDING, PlayerStatus.IN_MATCH, false),
    ).toBe(false);
  });
});
