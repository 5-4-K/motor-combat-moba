import { describe, expect, it } from "vitest";
import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import { SLOT_KEYS, slotMaskFrom } from "./slot-keys.js";

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

  it("fires the basic attack from the left mouse button and ability 1 from the right (BA16)", () => {
    // LMB is the basic attack now — the button a mouse hand reaches for first, for the weapon
    // pressed most. The abilities shifted to RMB / SHIFT / SPACE.
    expect(slotMaskFrom([], 0b01)).toBe(0b1000);
    expect(slotMaskFrom([], 0b10)).toBe(0b0001);
    expect(slotMaskFrom([], 0b11)).toBe(0b1001);
  });

  it("ORs mouse buttons with keys instead of replacing them", () => {
    expect(slotMaskFrom([false, false, true], 0b01)).toBe(0b1100);
    expect(slotMaskFrom([true, false, false], 0)).toBe(0b0001);
  });

  it("ignores mouse bits no slot claims", () => {
    // Middle button (bit 4 of MouseEvent.buttons) is deliberately unbound.
    expect(slotMaskFrom([], 0b100)).toBe(0);
  });
});

describe("slot key glyphs", () => {
  it("binds H / J / K / L with the mouse-hand alternates, in FIRE SLOT order (BA16)", () => {
    // Indexed by fire slot: 0-2 are the ability kit, 3 is the basic attack. SHIFT (16) is a second
    // keyCode on ability 2 the same way SPACE (32) already is on ability 3.
    expect(SLOT_KEYS.map((key) => [...key.codes])).toEqual([[74], [75, 16], [76, 32], [72]]);
    expect(SLOT_KEYS.map((key) => key.buttonsMask)).toEqual([2, 0, 0, 1]);
  });

  it("prints the mouse-hand binding on the gutter pill and keeps a letter glyph for the hint", () => {
    expect(SLOT_KEYS.map((key) => key.glyph)).toEqual(["RMB", "SHIFT", "SPACE", "LMB"]);
    expect(SLOT_KEYS.map((key) => key.keyGlyph)).toEqual(["J", "K", "L", "H"]);
  });

  it("leaves Q and E unbound — still reserved", () => {
    for (const code of [81, 69]) {
      expect(SLOT_KEYS.some((key) => (key.codes as readonly number[]).includes(code))).toBe(false);
    }
  });
});
