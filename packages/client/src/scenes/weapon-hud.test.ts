import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, STATUS_CONFIG, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import type { TextureLookup } from "../assets/car-sprite.js";
import type { AssetManifest, SpriteEntry } from "../assets/manifest-schema.js";
import { ARENA_VIEW_WIDTH, HUD_GUTTER_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from "../config/display.js";
import {
  cooldownFillFraction,
  HUD_DIM,
  isRechargeDisplayed,
  isSlotBlocked,
  resolveWeaponIcon,
  SLOT_BLOCKED_RING_GAP_PX,
  SLOT_BLOCKED_RING_WIDTH_PX,
  SLOT_BOX_PX,
  SLOT_KEY_COLUMN_PX,
  SLOT_NAME_FONT_PX,
  SLOT_NAME_GAP_PX,
  SLOT_RING_BOX_PX,
  slotBarLayout,
  slotVisualState,
  type SlotVisual,
} from "./weapon-hud.js";
import { rosterPanelLayout } from "./roster-panel.js";
import { statusStripLayout } from "./status-hud.js";

describe("cooldown fill", () => {
  it("is empty the tick a recharge starts and full when it ends - the ring FILLS, it does not drain", () => {
    expect(cooldownFillFraction(115, 15, 100)).toBeCloseTo(0);
    expect(cooldownFillFraction(115, 15, 115)).toBeCloseTo(1);
    expect(cooldownFillFraction(115, 15, 107.5)).toBeCloseTo(0.5);
  });

  it("is zero when nothing is recharging, so a ready slot draws no arc", () => {
    expect(cooldownFillFraction(0, 15, 100)).toBe(0);
  });

  it("never reports outside [0,1], however stale the tick", () => {
    expect(cooldownFillFraction(115, 15, 900)).toBe(1);
    expect(cooldownFillFraction(115, 15, 0)).toBe(0);
  });

  it("arrives at a COMPLETE circle on the last tick, so the handover to the ready ring never pops", () => {
    // The old draining sweep shrank to nothing and then snapped to a full bright ring.
    for (let tick = 100; tick <= 115; tick++) {
      const f = cooldownFillFraction(115, 15, tick);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(cooldownFillFraction(115, 15, 115)).toBe(1);
  });
});

describe("slot state", () => {
  const fireball = { unlocksAt: 1 };
  const slot = { stocks: 1, rechargeEndsTick: 0 };

  it("reads ready when stocked and unlocked", () => {
    expect(slotVisualState(slot, fireball, 1)).toBe("ready");
  });

  it("reads locked when the weapon is above the player level", () => {
    expect(slotVisualState(slot, { unlocksAt: 2 }, 1)).toBe("locked");
  });

  it("reads recharging while its own timer runs", () => {
    expect(slotVisualState({ stocks: 0, rechargeEndsTick: 115 }, fireball, 1)).toBe("recharging");
  });

  it("knows nothing about car-wide lockout - that is isSlotBlocked", () => {
    // The whole point of the split: a wind-up no longer changes what STATE a slot is in, only
    // whether the prohibition sign is drawn over it. A mid-volley slot (stock spent, timer not yet
    // written) therefore reads "ready" here and is blocked by the sign, at full brightness.
    expect(slotVisualState({ stocks: 0, rechargeEndsTick: 0 }, fireball, 1)).toBe("ready");
  });

  it("dims a locked slot harder than a recharging one", () => {
    expect(HUD_DIM.locked).toBeLessThan(HUD_DIM.recharging);
  });

  it("has no dim level for a blocked slot - blocked is a sign, not an alpha", () => {
    expect(Object.keys(HUD_DIM).sort()).toEqual(["locked", "ready", "recharging"]);
  });
});

describe("isSlotBlocked", () => {
  const unblocked: {
    state: SlotVisual;
    pending: { slot: number } | null;
    switchLock: number;
    isLastFired: boolean;
    disarmed: boolean;
    tick: number;
  } = { state: "ready", pending: null, switchLock: 0, isLastFired: false, disarmed: false, tick: 100 };
  const call = (o: Partial<typeof unblocked> = {}) => {
    const a = { ...unblocked, ...o };
    return isSlotBlocked(a.state, a.pending, a.switchLock, a.isLastFired, a.disarmed, a.tick);
  };

  it("is false for an ordinary ready slot", () => {
    expect(call()).toBe(false);
  });

  it("blocks EVERY slot during a wind-up or volley (D3), not just the firing one", () => {
    expect(call({ pending: { slot: 0 } })).toBe(true);
    expect(call({ pending: { slot: 0 }, isLastFired: true })).toBe(true);
  });

  it("blocks during recovery only for the OTHER slots", () => {
    expect(call({ switchLock: 150, isLastFired: false })).toBe(true);
    expect(call({ switchLock: 150, isLastFired: true })).toBe(false);
  });

  it("blocks a disarmed car - the stun signal the HUD never used to show at all", () => {
    expect(call({ disarmed: true })).toBe(true);
    expect(call({ disarmed: true, state: "recharging" })).toBe(true);
  });

  it("never blocks a level-locked slot: not owned yet is not blocked right now", () => {
    expect(call({ state: "locked", pending: { slot: 0 } })).toBe(false);
    expect(call({ state: "locked", disarmed: true })).toBe(false);
    expect(call({ state: "locked", switchLock: 150 })).toBe(false);
  });

  it("stacks with recharging: a cooling slot inside another slot press wears both channels", () => {
    expect(call({ state: "recharging", pending: { slot: 1 } })).toBe(true);
  });

  it("lets a lapsed switch lock go", () => {
    expect(call({ switchLock: 100, tick: 100 })).toBe(false);
    expect(call({ switchLock: 99, tick: 100 })).toBe(false);
  });
});

describe("slot ring box", () => {
  it("reserves an annulus inside the layout box for the prohibition sign", () => {
    expect(SLOT_RING_BOX_PX).toBeLessThan(SLOT_BOX_PX);
    expect(SLOT_RING_BOX_PX).toBe(SLOT_BOX_PX - 2 * (SLOT_BLOCKED_RING_WIDTH_PX + SLOT_BLOCKED_RING_GAP_PX));
  });

  it("leaves the ring big enough to still read as the slot", () => {
    expect(SLOT_RING_BOX_PX).toBeGreaterThan(SLOT_BOX_PX * 0.75);
  });
});

describe("resolveWeaponIcon", () => {
  function iconEntry(over: Partial<SpriteEntry> = {}): SpriteEntry {
    return {
      file: "weapon-icons/fireball.png",
      rotationOffset: 0,
      scale: "fit",
      colorMode: "none",
      origin: [0.5, 0.5],
      ...over,
    };
  }

  function manifestOf(sprites: Record<string, SpriteEntry>): AssetManifest {
    return { sprites };
  }

  /** Stands in for Phaser's TextureManager: every key it was given counts as loaded. */
  function loaded(sizes: Record<string, { width: number; height: number }>): TextureLookup {
    return {
      exists: (key) => Object.hasOwn(sizes, key),
      sizeOf: (key) => sizes[key]!,
    };
  }

  it("resolves an icon whose entry exists and whose texture loaded", () => {
    const resolved = resolveWeaponIcon(
      manifestOf({ "weapon-icon.fireball": iconEntry() }),
      loaded({ "weapon-icon.fireball": { width: 128, height: 128 } }),
      "fireball",
      64,
    );
    expect(resolved?.key).toBe("weapon-icon.fireball");
    expect(resolved?.fit.scale).toBeCloseTo(0.5);
  });

  it("falls through to undefined when there is no manifest entry", () => {
    const resolved = resolveWeaponIcon(
      manifestOf({}),
      loaded({ "weapon-icon.fireball": { width: 128, height: 128 } }),
      "fireball",
      64,
    );
    expect(resolved).toBeUndefined();
  });

  it("falls through to undefined when the entry exists but the texture never loaded", () => {
    const resolved = resolveWeaponIcon(
      manifestOf({ "weapon-icon.fireball": iconEntry() }),
      loaded({}),
      "fireball",
      64,
    );
    expect(resolved).toBeUndefined();
  });

  it("does not fall back to any other weapon's icon for an unknown id", () => {
    const resolved = resolveWeaponIcon(
      manifestOf({ "weapon-icon.fireball": iconEntry() }),
      loaded({ "weapon-icon.fireball": { width: 128, height: 128 } }),
      "needler",
      64,
    );
    expect(resolved).toBeUndefined();
  });
});

describe("layout", () => {
  // Inset 0: the layout as it was before the roster panel existed. Every assertion below is the
  // regression guard for that — with nothing above them, the slots must still centre in the whole
  // column exactly as they used to.
  const boxes = slotBarLayout(3, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, 0);

  /**
   * The whole point of the column. A slot that starts before `ARENA_VIEW_WIDTH` is a slot the arena
   * camera draws floor under, which is the state this replaced: cars drove over the slot bar. The
   * key label counts too — it is the rightmost thing in the gutter, so it is what can spill out.
   */
  it("keeps every slot and its key label inside the gutter, clear of the arena viewport", () => {
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(ARENA_VIEW_WIDTH);
      expect(box.keyX + SLOT_KEY_COLUMN_PX).toBeLessThanOrEqual(VIEW_WIDTH);
    }
  });

  it("puts the key label beside the slot rather than under it", () => {
    const box = boxes[0]!;
    expect(box.keyX).toBeGreaterThanOrEqual(box.x + box.size);
  });

  it("puts the weapon name under the slot", () => {
    const box = boxes[0]!;
    expect(box.nameY).toBeGreaterThanOrEqual(box.y + box.size);
  });

  it("stacks the slots top to bottom in slot order, all on one x", () => {
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);
    expect(boxes[1]!.x).toBe(boxes[0]!.x);
    expect(boxes[2]!.x).toBe(boxes[0]!.x);
  });

  it("centres the column vertically", () => {
    const top = boxes[0]!.y;
    const bottom = boxes[2]!.y + boxes[2]!.size;
    expect(top).toBeCloseTo(VIEW_HEIGHT - bottom, 0);
  });

  /** The name sits in the band between two slots: too tight and slot 1's name lands on slot 2. */
  it("leaves room under each slot for its name", () => {
    const gap = boxes[1]!.y - (boxes[0]!.y + boxes[0]!.size);
    expect(gap).toBeGreaterThanOrEqual(SLOT_NAME_GAP_PX + SLOT_NAME_FONT_PX);
  });

  it("keeps the last name inside the view rather than off the bottom edge", () => {
    const last = boxes[2]!;
    expect(last.nameY + SLOT_NAME_FONT_PX).toBeLessThanOrEqual(VIEW_HEIGHT);
  });

  it("draws nothing for a car with no slots", () => {
    expect(slotBarLayout(0, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, 0)).toEqual([]);
  });
});

describe("layout with a roster panel above it", () => {
  const INSET = 100;
  const inset = slotBarLayout(3, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, INSET);
  const flush = slotBarLayout(3, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, 0);

  it("starts the stack below the panel", () => {
    expect(inset[0]!.y).toBeGreaterThanOrEqual(INSET);
  });

  it("centres the stack in what is left, not in the whole column", () => {
    const top = inset[0]!.y - INSET;
    const bottom = VIEW_HEIGHT - (inset[2]!.y + inset[2]!.size);
    expect(top).toBeCloseTo(bottom, 0);
  });

  /** The panel moves the slots; it must never resize them, or the icons stop fitting their boxes. */
  it("leaves the stack's own height and column alone", () => {
    expect(inset[2]!.y - inset[0]!.y).toBe(flush[2]!.y - flush[0]!.y);
    expect(inset[0]!.size).toBe(flush[0]!.size);
    expect(inset[0]!.x).toBe(flush[0]!.x);
  });
});

/**
 * The gutter's three tenants at once (D12). Six players, six badges and three slots is a reachable
 * match and the one the game is designed around, and the coupling between them is the part that is
 * easy to get wrong: the panel pushes the slots down, the slots drag the badge strip down with
 * them, and the strip grows UPWARD from there — so making room at the top is also what hands the
 * strip the headroom it can collide with the panel in.
 *
 * This is the test that makes a later nudge to `ROSTER_ROW_HEIGHT_PX` fail loudly instead of
 * sliding a badge under a player's name.
 */
describe("the gutter budget", () => {
  const panel = rosterPanelLayout(MAX_PLAYERS, VIEW_WIDTH, HUD_GUTTER_WIDTH);
  const slots = slotBarLayout(
    WEAPON_SLOT_CONFIG.maxWeaponSlots,
    VIEW_WIDTH,
    VIEW_HEIGHT,
    HUD_GUTTER_WIDTH,
    panel.height,
  );
  const strip = statusStripLayout(
    STATUS_CONFIG.maxActive,
    VIEW_WIDTH,
    VIEW_HEIGHT,
    HUD_GUTTER_WIDTH,
    slots[0]!.y,
  );

  it("lays the worst case out at the numbers the budget was written for", () => {
    expect(panel.height).toBe(138);
    expect(slots[0]!.y).toBe(305);
    expect(strip[0]!.y).toBe(149);
  });

  it("never lets the badge strip climb into the panel", () => {
    expect(strip[0]!.y).toBeGreaterThanOrEqual(panel.height);
  });

  it("never lets the badge strip reach the slots", () => {
    expect(strip.at(-1)!.y + strip.at(-1)!.height).toBeLessThanOrEqual(slots[0]!.y);
  });

  it("keeps the slot stack and its names inside the view below the panel", () => {
    expect(slots[0]!.y).toBeGreaterThanOrEqual(panel.height);
    expect(slots.at(-1)!.nameY + SLOT_NAME_FONT_PX).toBeLessThanOrEqual(VIEW_HEIGHT);
  });

  /**
   * The slack itself, written down rather than merely satisfied. Eleven pixels is what the whole
   * column has left over: this asserting an exact number is the point, because any constant that
   * spends more than it should has to show up here as a number that moved.
   */
  it("clears the panel by 11 px, and no more", () => {
    expect(strip[0]!.y - panel.height).toBe(11);
  });
});
