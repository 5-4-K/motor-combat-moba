import { describe, expect, it } from "vitest";
import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import { SLOT_KEYS, slotMaskFrom } from "./slot-keys.js";

describe("slot keys", () => {
  it("binds at least as many slots as there are weapon slots", () => {
    expect(SLOT_KEYS.length).toBeGreaterThanOrEqual(WEAPON_SLOT_CONFIG.maxWeaponSlots);
  });

  it("gives every slot a display glyph for the HUD", () => {
    for (const key of SLOT_KEYS) expect(key.glyph.length).toBeGreaterThan(0);
  });

  it("packs held keys into a bitmask, slot 1 as bit 0", () => {
    expect(slotMaskFrom([true, false, false])).toBe(0b001);
    expect(slotMaskFrom([false, true, false])).toBe(0b010);
    expect(slotMaskFrom([true, true, true])).toBe(0b111);
    expect(slotMaskFrom([])).toBe(0);
  });

  it("ignores keys past the slot limit", () => {
    expect(slotMaskFrom([true, true, true, true])).toBe(0b111);
  });

  it("fires slot 1 from the left mouse button and slot 2 from the right", () => {
    expect(slotMaskFrom([], 0b01)).toBe(0b001);
    expect(slotMaskFrom([], 0b10)).toBe(0b010);
    expect(slotMaskFrom([], 0b11)).toBe(0b011);
  });

  it("ORs mouse buttons with keys instead of replacing them", () => {
    expect(slotMaskFrom([false, false, true], 0b01)).toBe(0b101);
    expect(slotMaskFrom([true, false, false], 0)).toBe(0b001);
  });

  it("ignores mouse bits no slot claims", () => {
    // Middle button (bit 4 of MouseEvent.buttons) is deliberately unbound.
    expect(slotMaskFrom([], 0b100)).toBe(0);
  });
});

describe("slot key glyphs", () => {
  it("binds the slots to J / K / L with the mouse-hand alternates, in slot order", () => {
    expect(SLOT_KEYS.map((key) => [...key.codes])).toEqual([[74], [75], [76, 32]]);
    expect(SLOT_KEYS.map((key) => key.buttonsMask)).toEqual([1, 2, 0]);
    expect(SLOT_KEYS.map((key) => key.glyph)).toEqual(["J·LMB", "K·RMB", "L·SPC"]);
  });

  it("prints every binding it holds — no hidden alternates", () => {
    // Space is bound again, but on the pill ("L·SPC"), not as a silent extra; Q and E stay
    // reserved and unbound.
    for (const code of [81, 69]) {
      expect(SLOT_KEYS.some((key) => (key.codes as readonly number[]).includes(code))).toBe(false);
    }
    expect(SLOT_KEYS[2].glyph).toContain("SPC");
  });
});
