import { COLOR_TABLE } from "@motor-combat-moba/shared";
import { carFillOf } from "../scenes/car-visual.js";

/**
 * Pure layout arithmetic for the `?dev=assets` tuning tool.
 *
 * Split out of `AssetTuningScene` because a Phaser scene cannot be imported in the node test
 * environment, the same reason `slotBarLayout` (`scenes/weapon-hud.ts`) and `fitSprite`
 * (`assets/sprite-fit.ts`) are pure while their scenes stay thin drawing shells. Everything here is
 * a function of numbers only; nothing in this module touches Phaser.
 */

/** Horizontal distance between two weapon cells — one kit slot to the next. */
export const WEAPON_COL_PITCH = 312;
/** Vertical distance between two chassis rows. */
export const WEAPON_ROW_PITCH = 130;
/** Centre of the first cell: slot 1 of the first chassis. */
export const WEAPON_GRID_ORIGIN = { x: 400, y: 342 } as const;

/** Side of one tint swatch. */
export const SWATCH_PX = 34;
/** Left-to-right distance between swatches; the difference from `SWATCH_PX` is the gap. */
export const SWATCH_PITCH = 46;
/** Top-left of the first swatch, in the space the car row leaves empty to its right. */
export const SWATCH_ORIGIN = { x: 790, y: 126 } as const;

/**
 * The fill that means "no tint". White is an identity multiply, so the untinted look is the same
 * draw path as every player colour rather than a second branch that could drift from it —
 * `applyCarSprite` is called the same way whichever swatch is active.
 */
export const NO_TINT = 0xffffff;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One entry in the tint picker: what to label it, and the fill to hand `applyCarSprite`. */
export interface TintOption {
  readonly label: string;
  readonly fill: number;
}

/**
 * Centre of the weapon cell at `row` (chassis) and `col` (kit slot).
 *
 * Deliberately a plain grid rather than a per-row centring: the columns have to read as "slot 1,
 * slot 2, slot 3" across every chassis, so a kit with fewer weapons leaves its right-hand columns
 * empty instead of sliding what it has toward the middle.
 */
export function weaponCellCenter(row: number, col: number): Point {
  return {
    x: WEAPON_GRID_ORIGIN.x + col * WEAPON_COL_PITCH,
    y: WEAPON_GRID_ORIGIN.y + row * WEAPON_ROW_PITCH,
  };
}

/**
 * The tint picker's options: an untinted default, then every player colour in `COLOR_TABLE` order.
 *
 * Read from the table rather than listed here, so a colour added to the roster shows up in the
 * picker without a second edit.
 */
export function tintOptions(): TintOption[] {
  return [
    { label: "none", fill: NO_TINT },
    ...COLOR_TABLE.map((color) => ({ label: color.name, fill: carFillOf(color.colorId) })),
  ];
}

/**
 * Weapons that no kit carries, in roster order.
 *
 * The grid draws one cell per kit slot, so an orphan has an icon and nowhere to show it. Takes the
 * tables as arguments rather than reading them, so the empty and duplicate cases are covered by
 * fixtures instead of by whatever the roster happens to be today.
 */
export function orphanWeaponIds(
  weaponIds: readonly string[],
  kits: readonly (readonly string[])[],
): string[] {
  const carried = new Set(kits.flat());
  return weaponIds.filter((id) => !carried.has(id));
}

/** The box for the swatch at `index`, counting from the left of the strip. */
export function swatchRect(index: number): Rect {
  return {
    x: SWATCH_ORIGIN.x + index * SWATCH_PITCH,
    y: SWATCH_ORIGIN.y,
    width: SWATCH_PX,
    height: SWATCH_PX,
  };
}

/**
 * Which swatch a pointer is over, or `undefined` for a miss.
 *
 * `count` is how many swatches were actually drawn: a click to the right of the last one must not
 * select a swatch that is not on screen, which is what the gaps and the bound below rule out. Hit
 * testing lives here rather than on Phaser's own interactive rectangles so the miss cases are
 * covered by a test instead of by clicking around the page.
 */
export function swatchIndexAt(point: Point, count: number): number | undefined {
  for (let i = 0; i < count; i++) {
    const r = swatchRect(i);
    if (
      point.x >= r.x &&
      point.x <= r.x + r.width &&
      point.y >= r.y &&
      point.y <= r.y + r.height
    ) {
      return i;
    }
  }
  return undefined;
}
