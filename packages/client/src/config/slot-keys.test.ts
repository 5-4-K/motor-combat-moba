import { describe, expect, it } from "vitest";
import { ABILITY_SLOT_CEILING, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
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

  it("packs held keys into a bitmask, the basic attack as bit 0 (VS6)", () => {
    expect(slotMaskFrom([true, false, false])).toBe(0b0001);
    expect(slotMaskFrom([false, true, false])).toBe(0b0010);
    expect(slotMaskFrom([true, true, true])).toBe(0b0111);
    expect(slotMaskFrom([])).toBe(0);
  });

  it("packs ability 3 as bit 3, one left of where the kit sits", () => {
    expect(slotMaskFrom([false, false, false, true])).toBe(0b1000);
    expect(slotMaskFrom([true, true, true, true])).toBe(0b1111);
  });

  it("ignores keys past the fire-slot limit", () => {
    expect(slotMaskFrom([true, true, true, true, true])).toBe(0b1111);
  });

  it("fires the basic attack from the left mouse button and ability 1 from the right (BA16)", () => {
    // LMB is the basic attack — the button a mouse hand reaches for first, for the weapon pressed
    // most — and it is fire slot 0 now, so it lands on bit 0 rather than on the kit's far end.
    expect(slotMaskFrom([], 0b01)).toBe(0b0001);
    expect(slotMaskFrom([], 0b10)).toBe(0b0010);
    expect(slotMaskFrom([], 0b11)).toBe(0b0011);
  });

  it("ORs mouse buttons with keys instead of replacing them", () => {
    expect(slotMaskFrom([false, false, true], 0b01)).toBe(0b0101);
    expect(slotMaskFrom([true, false, false], 0)).toBe(0b0001);
  });

  it("ignores a mouse bit whose slot this build does not have", () => {
    // The middle button (bit 2 of MouseEvent.buttons, value 4) belongs to ability 4 now, which is
    // fire slot 4 — past `maxFireSlots` at N = 3, so `slotMaskFrom` never scans its row (VS18).
    expect(slotMaskFrom([], 0b100)).toBe(0);
  });
});

describe("slot key glyphs", () => {
  it("binds slot 0 to the basic attack and the abilities after it", () => {
    // VS15. Every binding a player already uses fires the same weapon it fired before: H/LMB was
    // slot 3 and is now slot 0; J/RMB was 0 and is now 1; K/SHIFT was 1 and is now 2; L/SPACE was
    // 2 and is now 3. The renumbering is internal.
    expect(SLOT_KEYS.map((k) => k.keyGlyph)).toEqual(["H", "J", "K", "L", ";"]);
    expect(SLOT_KEYS.map((k) => k.glyph)).toEqual(["LMB", "RMB", "SHIFT", "SPACE", "MMB"]);
  });

  it("is ceiling-length at every N, so the table never has to grow again", () => {
    // VS16. `slotMaskFrom` limits its own scan to `maxFireSlots`, so rows past N are simply never
    // read into a mask — the key for a slot this build does not have does nothing.
    expect(SLOT_KEYS).toHaveLength(ABILITY_SLOT_CEILING + 1);
  });

  it("narrows the mask with N, so an unavailable slot cannot be pressed", () => {
    // VS18. `SLOT_MASK` in the server's tick derives from `maxFireSlots`, so it narrows with N by
    // construction; `slotMaskFrom` limits its own scan the same way. A hand-rolled client cannot
    // press a slot this build does not have.
    const all = [true, true, true, true, true];
    expect(slotMaskFrom(all, 0)).toBe((1 << WEAPON_SLOT_CONFIG.maxFireSlots) - 1);
  });

  it("reads the basic attack's mouse button on bit 0", () => {
    expect(slotMaskFrom([], 1)).toBe(0b0001); // LMB -> basic attack
    expect(slotMaskFrom([], 2)).toBe(0b0010); // RMB -> ability 1
  });

  it("binds H / J / K / L / ; with the mouse-hand alternates, in FIRE SLOT order (BA16, VS15)", () => {
    // Indexed by fire slot: 0 is the basic attack, 1..4 are the ability kit. SHIFT (16) is a second
    // keyCode on ability 2 the same way SPACE (32) already is on ability 3.
    expect(SLOT_KEYS.map((key) => [...key.codes])).toEqual([[72], [74], [75, 16], [76, 32], [186]]);
    expect(SLOT_KEYS.map((key) => key.buttonsMask)).toEqual([1, 2, 0, 0, 4]);
  });

  it("prints the mouse-hand binding on the gutter pill and keeps a letter glyph for the hint", () => {
    expect(SLOT_KEYS.map((key) => key.glyph)).toEqual(["LMB", "RMB", "SHIFT", "SPACE", "MMB"]);
    expect(SLOT_KEYS.map((key) => key.keyGlyph)).toEqual(["H", "J", "K", "L", ";"]);
  });

  it("leaves Q and E unbound — still reserved", () => {
    for (const code of [81, 69]) {
      expect(SLOT_KEYS.some((key) => (key.codes as readonly number[]).includes(code))).toBe(false);
    }
  });
});

describe("hintSlotOrder (basic-attack-toggle)", () => {
  it("teaches the basic attack first when the toggle is enabled (BA19)", () => {
    // Plain fire-slot order now that the basic attack IS slot 0 (VS6) — the hint no longer has to
    // reorder the table to teach it first.
    expect(hintSlotOrder(true)).toEqual([0, 1, 2, 3]);
  });

  it("drops the basic attack's pill entirely when the toggle is disabled", () => {
    expect(hintSlotOrder(false)).toEqual([1, 2, 3]);
  });

  it("follows the ability count it is given, so the row is right at every N", () => {
    expect(hintSlotOrder(true, 1)).toEqual([0, 1]);
    expect(hintSlotOrder(false, 4)).toEqual([1, 2, 3, 4]);
  });

  it("HINT_SLOT_ORDER reflects the toggle's default (enabled) value", () => {
    expect(HINT_SLOT_ORDER).toEqual(hintSlotOrder(true));
  });
});
