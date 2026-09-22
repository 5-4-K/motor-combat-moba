import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, STATUS_CONFIG, WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import type { TextureLookup } from "../assets/car-sprite.js";
import type { AssetManifest, SpriteEntry } from "../assets/manifest-schema.js";
import { ARENA_VIEW_WIDTH, HUD_GUTTER_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from "../config/display.js";
import {
  abilityCountOf,
  abilitySlotOffset,
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
  SLOT_STACK_TOP_GAP_PX,
  slotBarLayout,
  slotVisualState,
  type SlotVisual,
} from "./weapon-hud.js";
import { rosterPanelLayout } from "./roster-panel.js";
import { statusStripLayout } from "./status-hud.js";

const ARENA_SCENE_SOURCE = readFileSync(
  fileURLToPath(new URL("./ArenaScene.ts", import.meta.url)),
  "utf8",
);

/** The module minus its prose: these are assertions about CODE, not about how it is commented. */
const ARENA_SCENE_CODE = ARENA_SCENE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/.*$/gm,
  "$1",
);

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

describe("abilityCountOf (BA15)", () => {
  // The basic attack must never earn a HUD box. This used to be enforced by an accident of
  // `slotBarLayout`'s clamp; VS22 removed that clamp, and this is where the rule lives now.

  it("gives a 4-length fire-slot array 3 ability boxes", () => {
    expect(abilityCountOf(4)).toBe(3);
  });

  it("gives a 2-length fire-slot array 1 ability box", () => {
    expect(abilityCountOf(2)).toBe(1);
  });

  it("gives a car with no chassis zero boxes, not a basic attack alone", () => {
    expect(abilityCountOf(0)).toBe(0);
  });

  it("never goes negative for a fire-slot array shorter than the offset", () => {
    expect(abilityCountOf(0)).toBeGreaterThanOrEqual(0);
  });

  it("ties the count to the offset: ability box i reads fire slot i + abilitySlotOffset(), never fire slot 0", () => {
    const fireSlots = ["basicAttack", "abilityA", "abilityB", "abilityC"];
    const count = abilityCountOf(fireSlots.length);
    for (let i = 0; i < count; i++) {
      expect(fireSlots[i + abilitySlotOffset()]).not.toBe("basicAttack");
    }
    // And the offset itself never points at fire slot 0, the basic attack's own slot.
    expect(abilitySlotOffset()).toBeGreaterThan(0);
  });

  /**
   * A SOURCE-TEXT test, not a behavioural one, and deliberately so: `ArenaScene.ts` is Phaser-only
   * and cannot be unit-tested in this repo's node-environment suites
   * (`packages/client/CLAUDE.md`), so `abilityCountOf` being correct proves nothing about whether
   * `renderWeaponHud` actually CALLS it. It is `slotBarLayout`'s removed clamp (VS22) all over
   * again: that clamp was BA15's only guard, and this is the only guard available to replace it —
   * grepping the call site is possible where exercising it is not.
   *
   * This is a stopgap, not a model to imitate elsewhere. **Delete it the day a browser or
   * integration test covers `renderWeaponHud` for real** — that test would be strictly better,
   * since it could not be fooled by a rename that keeps the string but breaks the wiring.
   */
  it("pins ArenaScene's call site so nobody re-derives the count inline (BA15 source guard)", () => {
    // Positive: the real call site imports and uses this helper, not just some code that happens
    // to exist near it.
    expect(ARENA_SCENE_CODE).toMatch(/import\s*\{[^}]*\babilityCountOf\b[^}]*\}\s*from\s*"\.\/weapon-hud\.js"/);
    // The bar is sized from the car it DRAWS — `hudTargetPlayer`'s `player` — not from the car the
    // viewer drives. The two differ while spectating, and sizing from `localAbilityCount()` there
    // loses the watched car's trailing abilities (or draws boxes it has no weapons for) and
    // anchors the status strip off a `boxes[0]` belonging to neither car.
    expect(ARENA_SCENE_CODE).toMatch(/slotBarLayout\(\s*abilityCountOf\(player\.weapons\.length\)/);
    // ...and `localAbilityCount()` keeps the job it IS right for: the countdown hint teaches the
    // local player their own keys. If this ever moves, it must not move back onto the slot bar.
    expect(ARENA_SCENE_CODE).toMatch(/actionKeysFor\(\s*this\.localAbilityCount\(\)/);
    expect(ARENA_SCENE_CODE).toMatch(/actionAltsFor\(\s*this\.localAbilityCount\(\)/);

    // Negative: nobody re-derived the count by hand instead of calling the helper. Whitespace
    // variants (`- 1`, `-1`, `- 1`) are all covered, since that is exactly the kind of edit that
    // would slip past a narrower pattern.
    expect(ARENA_SCENE_CODE).not.toMatch(/weapons\.length\s*-\s*1\b/);
    // And the slot bar is never sized from a raw array length, the other way to get this wrong.
    expect(ARENA_SCENE_CODE).not.toMatch(/slotBarLayout\(\s*\w+(?:\.\w+)*\.weapons\.length/);
  });

  /**
   * The other half of the same stopgap, and the same caveat applies: source text, because
   * `ArenaScene.ts` cannot be exercised here.
   *
   * `abilitySlotOffset()` is what keeps fire slot 0 out of the ability HUD. Delete the three `+
   * abilitySlotOffset()` / `fireSlot` sites and every suite in this repo stays green while the HUD
   * silently draws the BASIC ATTACK as ability 1 — with ability 1's key pill over it, and a
   * fired-slot highlight one slot out. Nothing else pins them.
   */
  it("pins ArenaScene's fire-slot offsets so ability 1 can never become the basic attack (BA15/VS23 source guard)", () => {
    // The slot the ability bar READS: ability `i` is fire slot `i + abilitySlotOffset()`.
    expect(ARENA_SCENE_CODE).toMatch(
      /player\.weapons\.at\(\s*i\s*\+\s*abilitySlotOffset\(\)\s*\)/,
    );
    // `drawHudSlot` derives the fire slot once, from the ability index...
    expect(ARENA_SCENE_CODE).toMatch(/const fireSlot\s*=\s*index\s*\+\s*abilitySlotOffset\(\)\s*;/);
    // ...and both of its fire-slot-indexed readers go through that variable, never through `index`.
    expect(ARENA_SCENE_CODE).toMatch(/fireSlot\s*===\s*player\.lastFiredSlot/);
    expect(ARENA_SCENE_CODE).toMatch(/SLOT_KEYS\[fireSlot\]/);
    expect(ARENA_SCENE_CODE).not.toMatch(/SLOT_KEYS\[index\]/);
    expect(ARENA_SCENE_CODE).not.toMatch(/index\s*===\s*player\.lastFiredSlot/);
  });
});

describe("layout", () => {
  // Inset 0: the layout as it was before the roster panel existed.
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

  it("anchors the stack's top a fixed gap below the inset, not centred in the column (VS20)", () => {
    expect(boxes[0]!.y).toBe(SLOT_STACK_TOP_GAP_PX);
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

  it("draws exactly one box per slot passed in, uncapped (VS22)", () => {
    // The basic attack's exclusion (BA15) is the CALLER's job now — it passes the ability count,
    // never the fire-slot array's length — not an internal clamp that used to do it by accident.
    expect(slotBarLayout(4, 1280, 720, 200, 0)).toHaveLength(4);
  });
});

describe("layout with a roster panel above it", () => {
  const INSET = 100;
  const inset = slotBarLayout(3, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, INSET);
  const flush = slotBarLayout(3, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, 0);

  it("starts the stack below the panel", () => {
    expect(inset[0]!.y).toBeGreaterThanOrEqual(INSET);
  });

  it("starts the stack a fixed gap below the panel, not centred in what is left (VS20)", () => {
    expect(inset[0]!.y - INSET).toBe(SLOT_STACK_TOP_GAP_PX);
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
    WEAPON_SLOT_CONFIG.maxAbilitySlots,
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

  it("keeps the badge strip clear of the panel at four slots too", () => {
    const four = slotBarLayout(4, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, panel.height);
    const wide = statusStripLayout(
      STATUS_CONFIG.maxActive, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, four[0]!.y,
    );
    expect(wide[0]!.y - panel.height).toBe(11);
  });
});

describe("the slot stack's anchor", () => {
  const at = (count: number) =>
    slotBarLayout(count, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, 138);

  it("puts the stack's top in the same place at every count", () => {
    // VS20. Centring made the top move with the count, which pushed the badge strip into the
    // roster panel at four boxes and made ability 1 jump when the player switched chassis.
    expect(at(1)[0]!.y).toBe(at(2)[0]!.y);
    expect(at(2)[0]!.y).toBe(at(3)[0]!.y);
    expect(at(3)[0]!.y).toBe(at(4)[0]!.y);
  });

  it("lands exactly where the centred 3-slot layout used to", () => {
    // The anchor's VALUE is chosen for this: at N=3 the HUD is pixel-identical to the build before
    // this change, so nothing about the shipped game's appearance moves.
    expect(at(3)[0]!.y).toBe(305);
  });

  it("fits four slots inside the view and would not fit five", () => {
    // VS21. Four is the layout's limit as well as the config's. Writing the overflow down is what
    // makes raising ABILITY_SLOT_CEILING fail loudly instead of clipping a label off-screen.
    expect(at(4).at(-1)!.nameY + SLOT_NAME_FONT_PX).toBeLessThanOrEqual(VIEW_HEIGHT);
    const five = slotBarLayout(5, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, 138);
    expect(five.at(-1)!.nameY + SLOT_NAME_FONT_PX).toBeGreaterThan(VIEW_HEIGHT);
  });
});
