import { CAR_TABLE, COLOR_TABLE, WEAPON_TABLE } from "@motor-combat-moba/shared";
import { describe, expect, it } from "vitest";
import {
  NO_TINT,
  orphanWeaponIds,
  SWATCH_PX,
  swatchIndexAt,
  swatchRect,
  tintOptions,
  weaponCellCenter,
  WEAPON_COL_PITCH,
  WEAPON_ROW_PITCH,
} from "./tuning-layout.js";

/** Wide enough that a 64px slot circle plus its colour swatch never touches the next cell. */
const MIN_CELL_CLEARANCE = 120;

describe("weaponCellCenter", () => {
  it("advances by the column pitch across a kit", () => {
    const a = weaponCellCenter(0, 0);
    const b = weaponCellCenter(0, 1);
    expect(WEAPON_COL_PITCH).toBeGreaterThanOrEqual(MIN_CELL_CLEARANCE);
    expect(b.x - a.x).toBe(WEAPON_COL_PITCH);
    expect(b.y).toBe(a.y);
  });

  it("advances by the row pitch down the chassis rows", () => {
    const a = weaponCellCenter(0, 0);
    const b = weaponCellCenter(1, 0);
    expect(WEAPON_ROW_PITCH).toBeGreaterThanOrEqual(MIN_CELL_CLEARANCE);
    expect(b.y - a.y).toBe(WEAPON_ROW_PITCH);
    expect(b.x).toBe(a.x);
  });

  /**
   * The columns read as "slot 1, slot 2, slot 3" across every chassis, so a short kit must leave its
   * missing slots empty on the right rather than centring what it has. A chassis carrying two
   * weapons still puts its slot 1 under everyone else's slot 1.
   */
  it("puts a given slot in the same column regardless of which row it is in", () => {
    expect(weaponCellCenter(2, 0).x).toBe(weaponCellCenter(0, 0).x);
    expect(weaponCellCenter(2, 1).x).toBe(weaponCellCenter(0, 1).x);
    // Columns must actually be distinct, or the assertions above hold for a degenerate grid.
    expect(weaponCellCenter(0, 1).x).toBeGreaterThan(weaponCellCenter(0, 0).x);
  });

  it("keeps the whole grid on the canvas, below the car section", () => {
    const first = weaponCellCenter(0, 0);
    const last = weaponCellCenter(2, 2);
    // Clear of the car cells, which are drawn centred on y 140 with labels to y ~210.
    expect(first.y).toBeGreaterThan(260);
    expect(first.x).toBeGreaterThan(0);
    expect(last.x).toBeLessThan(1424);
    expect(last.y).toBeLessThan(720);
  });
});

describe("tintOptions", () => {
  it("offers every player colour plus an untinted default", () => {
    expect(tintOptions()).toHaveLength(COLOR_TABLE.length + 1);
  });

  /**
   * White is an identity multiply, so "none" is the same draw path as every other swatch rather
   * than a second, untinted branch that could drift from it.
   */
  it("leads with an untinted option whose fill is a no-op multiply", () => {
    const [first] = tintOptions();
    expect(first?.label).toBe("none");
    expect(first?.fill).toBe(NO_TINT);
    expect(NO_TINT).toBe(0xffffff);
  });

  it("carries the real player colours, in table order", () => {
    const [, ...colors] = tintOptions();
    expect(colors.map((c) => c.label)).toEqual(COLOR_TABLE.map((c) => c.name));
    expect(colors[0]?.fill).toBe(0xe74c3c);
  });
});

describe("orphanWeaponIds", () => {
  it("finds a weapon no kit carries", () => {
    expect(orphanWeaponIds(["a", "b", "c"], [["a"], ["b"]])).toEqual(["c"]);
  });

  it("is empty when every weapon is on some kit", () => {
    expect(orphanWeaponIds(["a", "b"], [["a"], ["b"]])).toEqual([]);
  });

  it("counts a weapon carried by two kits once, and as carried", () => {
    expect(orphanWeaponIds(["a", "b"], [["a", "b"], ["a"]])).toEqual([]);
  });

  it("treats an empty roster of kits as leaving everything orphaned", () => {
    expect(orphanWeaponIds(["a", "b"], [])).toEqual(["a", "b"]);
  });

  /**
   * The grid draws one cell per kit slot, so an orphan would have an icon and no cell. The shipped
   * roster is exclusive but complete; this pins that, so adding a weapon without a carrier is
   * noticed here rather than as a silently absent cell.
   */
  it("reports exactly the sanctioned orphan set on the shipped roster", () => {
    // `tremor` is deliberately authored-but-uncarried (loadout decision pending), and the overlay
    // caption names it rather than hiding it. Pinning the exact set keeps the original guarantee:
    // a weapon accidentally dropped from a kit still shows up here as an unexpected orphan.
    expect(
      orphanWeaponIds(
        Object.keys(WEAPON_TABLE),
        Object.values(CAR_TABLE).map((car) => car.weapons),
      ),
    ).toEqual(["tremor"]);
  });
});

describe("swatchRect", () => {
  it("lays the swatches out left to right without overlapping", () => {
    const a = swatchRect(0);
    const b = swatchRect(1);
    expect(SWATCH_PX).toBeGreaterThan(0);
    expect(a.width).toBe(SWATCH_PX);
    expect(a.height).toBe(SWATCH_PX);
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
    expect(b.y).toBe(a.y);
  });

  /** The strip sits beside the cars, in the space the car row leaves empty on the right. */
  it("sits clear of the car cells and stays on the canvas", () => {
    const first = swatchRect(0);
    const last = swatchRect(COLOR_TABLE.length);
    expect(first.x).toBeGreaterThan(700);
    expect(last.x + last.width).toBeLessThan(1424);
  });
});

describe("swatchIndexAt", () => {
  it("finds the swatch under a point inside it", () => {
    const r = swatchRect(2);
    expect(swatchIndexAt({ x: r.x + 1, y: r.y + 1 }, 7)).toBe(2);
    expect(swatchIndexAt({ x: r.x + r.width - 1, y: r.y + r.height - 1 }, 7)).toBe(2);
  });

  it("returns undefined for a point in the gap between two swatches", () => {
    const r = swatchRect(0);
    const gapX = r.x + r.width + 1;
    expect(swatchIndexAt({ x: gapX, y: r.y + 1 }, 7)).toBeUndefined();
  });

  it("returns undefined above and below the strip", () => {
    const r = swatchRect(0);
    expect(swatchIndexAt({ x: r.x + 1, y: r.y - 1 }, 7)).toBeUndefined();
    expect(swatchIndexAt({ x: r.x + 1, y: r.y + r.height + 1 }, 7)).toBeUndefined();
  });

  /** A click past the last drawn swatch must not select a swatch the page never drew. */
  it("ignores a point beyond the count actually drawn", () => {
    const r = swatchRect(5);
    expect(swatchIndexAt({ x: r.x + 1, y: r.y + 1 }, 7)).toBe(5);
    expect(swatchIndexAt({ x: r.x + 1, y: r.y + 1 }, 3)).toBeUndefined();
  });

  it("ignores a point left of the strip", () => {
    const r = swatchRect(0);
    expect(swatchIndexAt({ x: r.x - 1, y: r.y + 1 }, 7)).toBeUndefined();
  });
});
