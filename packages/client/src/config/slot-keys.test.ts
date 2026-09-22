import { describe, expect, it } from "vitest";
import { ABILITY_SLOT_CEILING, BASIC_ATTACK_CONFIG, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
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

  it("binds exactly one layout: LMB, RMB, Q, E, Space (TR29)", () => {
    expect(SLOT_KEYS.map((k) => k.glyph)).toEqual(["LMB", "RMB", "Q", "E", "SPACE"]);
    expect(SLOT_KEYS.map((k) => k.buttonsMask)).toEqual([1, 2, 0, 0, 0]);
    expect(SLOT_KEYS.map((k) => [...k.codes])).toEqual([[], [], [81], [69], [32]]);
  });

  it("maps held inputs to fire slots, capped at maxFireSlots", () => {
    expect(slotMaskFrom([], 1)).toBe(1 << 0);
    expect(slotMaskFrom([], 2)).toBe(1 << 1);
    expect(slotMaskFrom([false, false, true])).toBe(1 << 2);
    expect(slotMaskFrom([false, false, false, true])).toBe(1 << 3);
    expect(slotMaskFrom([false, false, false, false, true])).toBe(0); // slot 4 inert while N = 3
  });

  it("ORs mouse buttons with keys instead of replacing them", () => {
    // Ability 2's own key (Q, slot 2) held alongside LMB (the basic attack, slot 0).
    expect(slotMaskFrom([false, false, true], 0b01)).toBe(0b0101);
    expect(slotMaskFrom([false, false, false], 0b01)).toBe(0b0001);
  });
});

describe("slot key glyphs", () => {
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

  it("gives the basic attack the left mouse button, in fire-slot 0 (TR29, TR46)", () => {
    // The BINDING, which the toggle does not touch: bit 0 is set by the left button alone, never a
    // keyboard code, whether or not this build lets slot 0 fire. With the basic attack off
    // (`development/main`) LMB is bound to a weapon that refuses every press, which is what a dead
    // LMB looks like from here.
    expect(SLOT_KEYS[WEAPON_SLOT_CONFIG.basicAttackSlotIndex]!.buttonsMask).toBe(1);
    expect(SLOT_KEYS[WEAPON_SLOT_CONFIG.basicAttackSlotIndex]!.codes).toEqual([]);
    expect(slotMaskFrom([], 0b01) & 0b0001).toBe(0b0001);
  });

  it("never lets two slots claim the same input", () => {
    const codes = SLOT_KEYS.flatMap((key) => [...key.codes]);
    expect(new Set(codes).size).toBe(codes.length);
    const masks = SLOT_KEYS.map((key) => key.buttonsMask).filter((mask) => mask !== 0);
    for (let i = 0; i < masks.length; i++) {
      for (let j = i + 1; j < masks.length; j++) expect(masks[i]! & masks[j]!).toBe(0);
    }
    expect(new Set(masks).size).toBe(masks.length);
  });

  it("leaves SHIFT unbound", () => {
    expect(SLOT_KEYS.some((key) => (key.codes as readonly number[]).includes(16))).toBe(false);
  });

  it("leaves H, J, K, L and ; unbound — retired with the old two-binding layout", () => {
    for (const code of [72, 74, 75, 76, 186]) {
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

  it("resolves HINT_SLOT_ORDER from whichever way this build ships the toggle (TR30)", () => {
    // Against the flag, not against one build's answer: `feature/mouse-aim` ships it on and gets
    // [0, 1, 2, 3]; `development/main` ships it off and gets [1, 2, 3]. Both rows are pinned
    // explicitly by the two cases above — this one is about `HINT_SLOT_ORDER` being resolved from
    // the flag at module load rather than hardcoded.
    expect(HINT_SLOT_ORDER).toEqual(hintSlotOrder(BASIC_ATTACK_CONFIG.enabled));
  });
});
