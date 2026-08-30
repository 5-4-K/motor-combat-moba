import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, STATUS_CONFIG, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import type { TextureLookup } from "../assets/car-sprite.js";
import type { AssetManifest, SpriteEntry } from "../assets/manifest-schema.js";
import { ARENA_VIEW_WIDTH, HUD_GUTTER_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from "../config/display.js";
import {
  HUD_DIM,
  countdownSeconds,
  resolveWeaponIcon,
  SLOT_KEY_COLUMN_PX,
  SLOT_NAME_FONT_PX,
  SLOT_NAME_GAP_PX,
  slotBarLayout,
  slotVisualState,
  sweepFraction,
} from "./weapon-hud.js";
import { rosterPanelLayout } from "./roster-panel.js";
import { statusStripLayout } from "./status-hud.js";

describe("sweep", () => {
  it("is full the tick a recharge starts and empty when it ends", () => {
    expect(sweepFraction(115, 15, 100)).toBeCloseTo(1);
    expect(sweepFraction(115, 15, 115)).toBeCloseTo(0);
    expect(sweepFraction(115, 15, 107.5)).toBeCloseTo(0.5);
  });

  it("is zero when nothing is recharging", () => {
    expect(sweepFraction(0, 15, 100)).toBe(0);
  });

  it("never reports outside [0,1], however stale the tick", () => {
    expect(sweepFraction(115, 15, 900)).toBe(0);
    expect(sweepFraction(115, 15, 0)).toBe(1);
  });
});

describe("countdown", () => {
  it("shows seconds only above a second, so short cooldowns stay uncluttered", () => {
    expect(countdownSeconds(160, 100)).toBeCloseTo(2); // 60 ticks == 2s
    expect(countdownSeconds(115, 100)).toBeNull(); // 0.5s: no number
    expect(countdownSeconds(0, 100)).toBeNull();
  });
});

describe("slot state", () => {
  const fireball = { unlocksAt: 1 };
  const slot = { stocks: 1, rechargeEndsTick: 0 };

  it("reads ready when stocked, unlocked and unblocked", () => {
    expect(slotVisualState(slot, fireball, 1, 0, null, 100)).toBe("ready");
  });

  it("reads locked when the weapon is above the player's level", () => {
    expect(slotVisualState(slot, { unlocksAt: 2 }, 1, 0, null, 100)).toBe("locked");
  });

  it("reads recharging while its own timer runs", () => {
    expect(slotVisualState({ stocks: 0, rechargeEndsTick: 115 }, fireball, 1, 0, null, 100)).toBe("recharging");
  });

  it("reads car-locked for every slot during a wind-up or volley", () => {
    const pending = { slot: 0 };
    expect(slotVisualState(slot, fireball, 1, 0, pending, 100)).toBe("car-locked");
  });

  it("reads car-locked during recovery only for OTHER slots", () => {
    // switch lock to tick 150; this slot is not the one that fired
    expect(slotVisualState(slot, fireball, 1, 150, null, 100, false)).toBe("car-locked");
    expect(slotVisualState(slot, fireball, 1, 150, null, 100, true)).toBe("ready");
  });

  it("reads car-locked, not ready, for a mid-volley slot with no stock and no timer yet", () => {
    // `beginFire` spends the stock at press time and `releaseShots` does not write
    // `rechargeEndsTick` until the volley's LAST shot, so a burst sits at `stocks: 0` with no timer
    // for its whole duration. The pending — `PlayerState.pendingUntilTick` on the wire — is the only
    // thing separating that from a genuinely ready slot.
    expect(slotVisualState({ stocks: 0, rechargeEndsTick: 0 }, fireball, 1, 0, { slot: 0 }, 100)).toBe("car-locked");
  });

  it("dims a locked slot harder than a recharging one", () => {
    expect(HUD_DIM.locked).toBeLessThan(HUD_DIM.recharging);
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
