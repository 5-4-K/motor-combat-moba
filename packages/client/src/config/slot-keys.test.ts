import { describe, expect, it } from "vitest";
import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import { SLOT_KEYS, slotMaskFrom } from "./slot-keys.js";

describe("slot keys", () => {
  it("binds at least as many keys as there are slots", () => {
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
});

describe("slot key glyphs", () => {
  it("binds the slots to J / K / L, in slot order", () => {
    expect(SLOT_KEYS.map((key) => key.code)).toEqual([74, 75, 76]);
    expect(SLOT_KEYS.map((key) => key.glyph)).toEqual(["J", "K", "L"]);
  });

  it("keeps no hidden alternate on the old Space / Q / E codes", () => {
    for (const code of [32, 81, 69]) expect(SLOT_KEYS.some((key) => key.code === code)).toBe(false);
  });
});
