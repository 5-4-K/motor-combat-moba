import { describe, expect, it } from "vitest";
import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import { HINT_SLOT_ORDER, SLOT_KEYS, hintSlotOrder, slotMaskFrom } from "./slot-keys.js";

describe("slot keys", () => {
  it("binds every fire slot, the basic attack included", () => {
    expect(SLOT_KEYS.length).toBeGreaterThanOrEqual(WEAPON_SLOT_CONFIG.maxFireSlots);
  });

  it("gives every slot a display glyph for the HUD", () => {
    for (const key of SLOT_KEYS) expect(key.glyph.length).toBeGreaterThan(0);
  });

  it("keeps every printed glyph inside the pill's five-character budget (BA18)", () => {
    // `SLOT_KEY_COLUMN_PX` was measured against "SPACE"; a sixth character overflows the gutter.
    for (const key of SLOT_KEYS) expect(key.glyph.length).toBeLessThanOrEqual(5);
  });

  it("packs held keys into a bitmask, ability slot 1 as bit 0", () => {
    expect(slotMaskFrom([true, false, false])).toBe(0b0001);
    expect(slotMaskFrom([false, true, false])).toBe(0b0010);
    expect(slotMaskFrom([true, true, true])).toBe(0b0111);
    expect(slotMaskFrom([])).toBe(0);
  });

  it("packs the basic attack as bit 3 (BA13)", () => {
    expect(slotMaskFrom([false, false, false, true])).toBe(0b1000);
    expect(slotMaskFrom([true, true, true, true])).toBe(0b1111);
  });

  it("ignores keys past the fire-slot limit", () => {
    expect(slotMaskFrom([true, true, true, true, true])).toBe(0b1111);
  });

  it("fires ability 1 from the left mouse button and ability 2 from the right", () => {
    // The mouse hand belongs to the abilities: LMB fires ability 1, RMB ability 2. The basic
    // attack surrendered LMB when the toggle went off and now carries no mouse binding at all,
    // which is what keeps bit 3 clear here.
    expect(slotMaskFrom([], 0b01)).toBe(0b0001);
    expect(slotMaskFrom([], 0b10)).toBe(0b0010);
    expect(slotMaskFrom([], 0b11)).toBe(0b0011);
  });

  it("ORs mouse buttons with keys instead of replacing them", () => {
    expect(slotMaskFrom([false, false, true], 0b10)).toBe(0b0110);
    expect(slotMaskFrom([true, false, false], 0)).toBe(0b0001);
  });

  it("ignores mouse bits no slot claims", () => {
    // Middle button (bit 4 of MouseEvent.buttons) is deliberately unbound.
    expect(slotMaskFrom([], 0b100)).toBe(0);
  });
});

describe("slot key glyphs", () => {
  it("binds J / K / L with the mouse-hand alternates, in FIRE SLOT order", () => {
    // Indexed by fire slot: 0-2 are the ability kit, 3 is the basic attack. SPACE (32) is a second
    // keyCode on ability 3; slot 3 is keyboard-only (H) since the basic attack gave up LMB.
    expect(SLOT_KEYS.map((key) => [...key.codes])).toEqual([[74], [75], [76, 32], [72]]);
    expect(SLOT_KEYS.map((key) => key.buttonsMask)).toEqual([1, 2, 0, 0]);
  });

  it("never lets two slots claim the same input", () => {
    // The whole reason the basic attack lost LMB: a duplicate binding fires two slots at once.
    const codes = SLOT_KEYS.flatMap((key) => [...key.codes]);
    expect(new Set(codes).size).toBe(codes.length);
    const masks = SLOT_KEYS.map((key) => key.buttonsMask).filter((mask) => mask !== 0);
    expect(masks.reduce((a, b) => a & b, 0b11)).toBe(0);
    expect(new Set(masks).size).toBe(masks.length);
  });

  it("prints the mouse-hand binding on the gutter pill and keeps a letter glyph for the hint", () => {
    expect(SLOT_KEYS.map((key) => key.glyph)).toEqual(["LMB", "RMB", "SPACE", "H"]);
    expect(SLOT_KEYS.map((key) => key.keyGlyph)).toEqual(["J", "K", "L", "H"]);
  });

  it("leaves SHIFT unbound — it left with the basic attack's mouse binding", () => {
    expect(SLOT_KEYS.some((key) => (key.codes as readonly number[]).includes(16))).toBe(false);
  });

  it("leaves Q and E unbound — still reserved", () => {
    for (const code of [81, 69]) {
      expect(SLOT_KEYS.some((key) => (key.codes as readonly number[]).includes(code))).toBe(false);
    }
  });
});

describe("hintSlotOrder (basic-attack-toggle)", () => {
  it("teaches the basic attack first when the toggle is enabled (BA19)", () => {
    expect(hintSlotOrder(true)).toEqual([3, 0, 1, 2]);
  });

  it("drops the basic attack's pill entirely when the toggle is disabled", () => {
    expect(hintSlotOrder(false)).toEqual([0, 1, 2]);
  });

  it("HINT_SLOT_ORDER reflects the toggle's shipped (disabled) value", () => {
    expect(HINT_SLOT_ORDER).toEqual(hintSlotOrder(false));
  });
});
