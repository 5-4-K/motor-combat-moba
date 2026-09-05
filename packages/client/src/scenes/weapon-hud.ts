import { WEAPON_SLOT_CONFIG } from "@motor-combat-moba/shared";
import { weaponIconKey } from "../assets/asset-keys.js";
import type { TextureLookup } from "../assets/car-sprite.js";
import type { AssetManifest, SpriteEntry } from "../assets/manifest-schema.js";
import { fitSprite, type SpriteFit } from "../assets/sprite-fit.js";

/**
 * Which of the three looks a slot wears. Deliberately NOT a list of every reason a slot might be
 * unpressable: "you cannot fire this instant" left this union and became `isSlotBlocked`, drawn as
 * a prohibition sign rather than an alpha. What survives are the two facts about the slot itself —
 * its own cooldown, and whether the player owns it yet.
 */
export type SlotVisual = "ready" | "recharging" | "locked";

/**
 * Icon alpha per state. The locked dim is heavier AND static, so it cannot read as a cooldown.
 *
 * There is deliberately no entry for a blocked slot. Dimming used to carry two unrelated meanings —
 * "not yours yet" at 0.25 and "not this instant" at 0.7 — and a reader had to know which was which.
 * Blocked is its own channel now (`isSlotBlocked` -> the sign), so every value left in this table
 * means exactly one thing and a blocked slot keeps full icon brightness.
 */
export const HUD_DIM = { ready: 1, recharging: 0.4, locked: 0.25 } as const;

/**
 * The slot's diameter. Still square in the arithmetic — a circle's bounding box is its diameter.
 *
 * Exported so the `?dev=assets` tuning tool can draw an icon against the real slot rather than a
 * number of its own, for the same reason `resolveWeaponIcon` is shared with it: a preview fitted to
 * a different box than the HUD uses is a preview that can lie.
 */
export const SLOT_BOX_PX = 64;

/**
 * How much of the slot the icon is fitted into. Between the inscribed square of the circle (0.707)
 * and the full bounding box: imported icons are trimmed and centred (`scripts/import-weapon-icon.mjs`),
 * so their extreme corners are usually empty and a strict inscription would waste visible area.
 *
 * Lives here rather than in `ArenaScene` so the tuning tool fits icons exactly as the HUD does.
 */
export const HUD_ICON_FIT_SCALE = 0.8;

/**
 * The prohibition sign's stroke, and its clearance from the cooldown ring.
 *
 * Geometry rather than palette, which is why it lives here beside the other slot measurements and
 * not with the HUD colours in `ArenaScene`: `SLOT_RING_BOX_PX` is derived from it, and
 * `AssetTuningScene` needs that number to preview an icon against the box the HUD really uses.
 */
export const SLOT_BLOCKED_RING_WIDTH_PX = 3;
export const SLOT_BLOCKED_RING_GAP_PX = 2;

/**
 * The diameter the COOLDOWN ring is drawn at, inset inside `SLOT_BOX_PX` to leave an annulus the
 * prohibition sign can occupy without touching it.
 *
 * The sign has to sit OUTSIDE the ring rather than over it, and there is no free space around a slot
 * to grow into: `slotBarLayout` puts the key pill `SLOT_KEY_GAP_PX` (8) to the right and the name
 * band `SLOT_NAME_GAP_PX` (6) below. Reserving the band on the inside is what keeps the sign clear
 * of the ring while leaving every other anchor in the layout exactly where it was — the alternative,
 * growing the box, would have moved the pill, the name and the slot spacing for a decoration that is
 * absent most of the time.
 *
 * Reserved on EVERY slot in every state, not only while blocked, so the ring never changes size
 * under the player.
 */
export const SLOT_RING_BOX_PX = SLOT_BOX_PX - 2 * (SLOT_BLOCKED_RING_WIDTH_PX + SLOT_BLOCKED_RING_GAP_PX);

/**
 * The key label, drawn to the RIGHT of the slot and vertically centred on it. D18 wants the key
 * outside the frame, never over the icon; beside is what keeps that true once the band under the
 * slot belongs to the weapon's name.
 *
 * `SLOT_KEY_COLUMN_PX` is a budget the layout reserves rather than a width it measures — text needs
 * a canvas to measure and this stays pure. 44 is "space" rendered at `SLOT_KEY_FONT_PX`, read off
 * the live HUD and rounded up; the remaining 16 is the pill's padding either side
 * (`HUD_KEY_PILL_PAD_X` in `ArenaScene`). A longer label than "space" overflows the gutter's right
 * edge, so a new binding wants re-measuring rather than trusting this number.
 *
 * The pill itself is drawn from the text's MEASURED width, so it is always the right size on screen
 * — this budget only decides where the slot-plus-key group gets centred, and how wide the gutter
 * has to be to hold it.
 */
export const SLOT_KEY_GAP_PX = 8;
export const SLOT_KEY_FONT_PX = 14;
export const SLOT_KEY_COLUMN_PX = 60;

/** The weapon's name, left-aligned under the slot's own left edge and dimmed with it — centring it
 * used to let a long name grow toward the arena camera's clip edge, which sits closer to the icon
 * than the canvas edge does. */
export const SLOT_NAME_GAP_PX = 6;
export const SLOT_NAME_FONT_PX = 12;

/** The name band, plus enough air that the column reads as separate slots rather than one strip. */
const GAP_PX = SLOT_NAME_GAP_PX + SLOT_NAME_FONT_PX + 10;

/**
 * How much of the ring the cooldown has REFILLED: 0 the tick it starts, 1 the tick it ends.
 *
 * The ring fills rather than drains. The draining version this replaced shrank a bright arc to
 * nothing and then snapped to a full bright ready ring in one frame — the timer never stopped, but
 * the slot popped. Filling arrives at a complete circle ON the last tick, so the handover to the
 * ready state is continuous and there is nothing to animate.
 *
 * Note what this is NOT: an "is anything running" flag. It reads 0 both for an idle slot and on the
 * first tick of a cooldown, so callers must gate the arc on `isRechargeDisplayed` and never on
 * `fraction > 0` — an overload the old draining fraction quietly allowed.
 */
export function cooldownFillFraction(rechargeEndsTick: number, cooldownTicks: number, tick: number): number {
  if (rechargeEndsTick === 0 || cooldownTicks <= 0) return 0;
  const remaining = rechargeEndsTick - tick;
  return Math.min(1, Math.max(0, 1 - remaining / cooldownTicks));
}

/**
 * Which of the three looks this slot wears — a question about the SLOT, not about the car.
 *
 * Precedence still matters between the two that remain: a locked weapon reads as locked even while
 * a timer runs underneath it, because "you do not have this yet" outranks "this is cooling down".
 *
 * The car-wide half of the old answer — wind-up, volley, another slot's recovery — left this
 * function entirely and became `isSlotBlocked`. That is what shrank the signature from seven
 * arguments to three: none of `switchLockUntilTick`, `pending`, `isLastFired` or `tick` says
 * anything about this slot's own condition, and they were only ever there to pick a dim level.
 *
 * One consequence to keep in view: a mid-volley slot (`beginFire` zeroes `stocks` at press time,
 * `releaseShots` does not write `rechargeEndsTick` until the volley's last shot) now falls through
 * to "ready" rather than being masked as car-locked. That is correct and deliberate — it is not
 * cooling down and the player does own it — but it means the SIGN is the only thing telling the
 * player they cannot press it, so `drawHudSlot` must pass a real `pending` to `isSlotBlocked`.
 */
export function slotVisualState(
  slot: { stocks: number; rechargeEndsTick: number },
  weapon: { unlocksAt: number },
  level: number,
): SlotVisual {
  if (weapon.unlocksAt > level) return "locked";
  if (slot.stocks === 0 && slot.rechargeEndsTick !== 0) return "recharging";
  return "ready";
}

/**
 * Whether the player is barred from pressing this slot RIGHT NOW — the channel that used to be two
 * rungs of the dim ladder and is now a prohibition sign drawn outside the ring.
 *
 * Three sources, all car-wide rather than slot-owned:
 *  - `pending` — a live wind-up or volley (`tick < PlayerState.pendingUntilTick`). Blocks EVERY slot,
 *    not just the firing one (D3); the slot it carries is kept for a future look that singles it out.
 *  - `switchLockUntilTick` — the recovery after a press, which blocks only the OTHER slots, so the
 *    one that fired (`isLastFired`) is exempt.
 *  - `disarmed` — `stunned`'s flag, read off the car's own status rows. New information on screen:
 *    before the split the HUD showed nothing at all for a stunned car and every slot looked pressable
 *    while `combat.ts` was silently refusing the press.
 *
 * `locked` short-circuits to false on purpose. A weapon the player has not unlocked is not "blocked
 * this instant" — it is not theirs yet, which is what its heavier static dim already says, and a
 * sign hanging on it for whole stretches of a match would say something different and wrong.
 */
export function isSlotBlocked(
  state: SlotVisual,
  pending: { slot: number } | null,
  switchLockUntilTick: number,
  isLastFired: boolean,
  disarmed: boolean,
  tick: number,
): boolean {
  if (state === "locked") return false;
  if (disarmed) return true;
  if (pending !== null) return true;
  return !isLastFired && tick < switchLockUntilTick;
}

/**
 * Whether this slot has a live cooldown to draw at all — the gate for the ring's track-and-arc look.
 *
 * This is the boolean the arc must be driven from, NOT `cooldownFillFraction(...) > 0`. Now that the
 * ring fills instead of draining, a fraction of 0 means "the cooldown just started", so the old
 * `fraction > 0` test would read a fresh cooldown as no cooldown and a finished one as still running
 * — precisely inverted. One expression used to answer three questions (is the ring a track, draw the
 * arc, may the slot glow); this answers the first two and `state === "ready" && !recharging` the third.
 *
 * Deliberately NOT gated to `state === "recharging"`: a stock weapon banking another charge while one
 * is still in hand reads "ready" (you can fire) with a timer genuinely running underneath, and that
 * timer is exactly the in-progress recharge D18 asks a stock weapon to show.
 *
 * `locked` is the one state that suppresses it outright: a weapon the player has not unlocked has no
 * cooldown worth showing, whatever `rechargeEndsTick` holds.
 *
 * Blocking no longer reaches this decision at all. It used to have to be reasoned about here — a slot
 * could be genuinely recharging while ALSO car-locked by a window it did not cause, and gating on the
 * narrower state hid the cooldown for that whole window, reading as "just finished" and then
 * un-finishing itself when the lock lifted. With blocking split onto its own channel that class of
 * bug cannot recur: the two never share a variable.
 */
export function isRechargeDisplayed(state: SlotVisual, rechargeEndsTick: number): boolean {
  return state !== "locked" && rechargeEndsTick !== 0;
}

/** A slot's manifest icon, resolved and ready to draw. */
export interface ResolvedWeaponIcon {
  readonly key: string;
  readonly entry: SpriteEntry;
  readonly fit: SpriteFit;
}

/**
 * The manifest icon for a slot's weapon, or `undefined` when there is no entry or its texture never
 * loaded — the same two cases `resolveCarSprite` (`assets/car-sprite.ts`) falls through for a car,
 * and here they must both fall through to the procedural glyph `ArenaScene.drawWeaponGlyph` still
 * draws, which is what keeps a missing icon PNG from ever being a bug rather than a cosmetic gap.
 *
 * Fit against the square slot box, not the 48x32 car hull — an icon is not a chassis. Icons keep
 * their colour (`colorMode: "none"`, written by `scripts/import-weapon-icon.mjs`), so unlike a car
 * sprite this is never tinted by the player's colour.
 */
export function resolveWeaponIcon(
  manifest: AssetManifest,
  textures: TextureLookup,
  weaponId: string,
  boxSize: number,
): ResolvedWeaponIcon | undefined {
  const key = weaponIconKey(weaponId);
  const entry = manifest.sprites[key];
  if (!entry || !textures.exists(key)) return undefined;
  const hull = { width: boxSize, height: boxSize };
  return { key, entry, fit: fitSprite(entry, textures.sizeOf(key), hull) };
}

/** One slot's anchors: the circle's bounding box, plus where its key and name hang off it. */
export interface SlotBox {
  /** Left edge of the circle's bounding box; the circle's centre is `x + size / 2`. */
  readonly x: number;
  readonly y: number;
  /** Diameter. */
  readonly size: number;
  /** Left edge of the key label, which is drawn left-aligned and centred on the circle's y. */
  readonly keyX: number;
  /** Top of the weapon name, drawn centred on the circle's x. */
  readonly nameY: number;
}

/**
 * Camera-fixed slots, stacked down the HUD gutter and centred in it.
 *
 * The bar used to be a row centred over the floor, pinned above the view's bottom edge, which put
 * it squarely inside the play area — a car could park under the slots and both were hard to read.
 * The gutter (`HUD_GUTTER_WIDTH`, the strip the arena camera's viewport deliberately does not
 * cover) has no world under it at all.
 *
 * What is centred is the whole slot-plus-key group, not the circle: centring the circle alone would
 * push the key label against the canvas edge, since the key only ever hangs off the right.
 *
 * `gutterWidth` is a parameter rather than an import so this stays a pure function of the layout it
 * is given, the same way `viewWidth`/`viewHeight` already were.
 *
 * `topInset` is the height of the roster panel above the slots (`rosterPanelLayout`), and the stack
 * is centred in what is left **below** it rather than in the whole column (D12). Insetting rather
 * than hard-coding a new slot top is what keeps the third thing in the gutter working for free:
 * `statusStripLayout` derives its position from `slotBarLayout(...)[0].y`, so the badge strip
 * follows the slots down with no signature change of its own. It also means the strip's headroom
 * grows with the panel, and the strip grows UPWARD — which is why the worst case (six rows, six
 * badges, three slots) is asserted in the tests rather than assumed. `topInset` 0 is exactly the
 * layout this had before the panel existed.
 */
export function slotBarLayout(
  count: number,
  viewWidth: number,
  viewHeight: number,
  gutterWidth: number,
  topInset: number,
): SlotBox[] {
  const shown = Math.min(count, WEAPON_SLOT_CONFIG.maxWeaponSlots);
  if (shown <= 0) return [];
  const totalHeight = shown * SLOT_BOX_PX + (shown - 1) * GAP_PX;
  const top = topInset + (viewHeight - topInset - totalHeight) / 2;
  const groupWidth = SLOT_BOX_PX + SLOT_KEY_GAP_PX + SLOT_KEY_COLUMN_PX;
  const x = viewWidth - gutterWidth + (gutterWidth - groupWidth) / 2;
  return Array.from({ length: shown }, (_, i) => {
    const y = top + i * (SLOT_BOX_PX + GAP_PX);
    return {
      x,
      y,
      size: SLOT_BOX_PX,
      keyX: x + SLOT_BOX_PX + SLOT_KEY_GAP_PX,
      nameY: y + SLOT_BOX_PX + SLOT_NAME_GAP_PX,
    };
  });
}
