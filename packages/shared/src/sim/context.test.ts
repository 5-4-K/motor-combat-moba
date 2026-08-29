import { describe, expect, it } from "vitest";
import { CAR_TABLE, DEFAULT_CAR_ID } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { PlayerStatus } from "../constants.js";
import { carHullOf, carIdOf, isOnField, otherCarHulls, type ContextEntry, type ContextPlayer } from "./context.js";

function player(over: Partial<ContextPlayer> = {}): ContextPlayer {
  return { x: 0, y: 0, angle: 0, status: PlayerStatus.IN_MATCH, carId: "mirage", ...over };
}

function entry(sessionId: string, over: Partial<ContextPlayer> = {}): ContextEntry {
  return { sessionId, player: player(over) };
}

describe("isOnField", () => {
  it("is true only for IN_MATCH", () => {
    expect(isOnField({ status: PlayerStatus.IN_MATCH })).toBe(true);
    expect(isOnField({ status: PlayerStatus.READY })).toBe(false);
    expect(isOnField({ status: PlayerStatus.POST_MATCH })).toBe(false);
  });
});

describe("carIdOf", () => {
  it("passes through a real car id", () => {
    expect(carIdOf({ carId: "bastion" })).toBe("bastion");
    expect(carIdOf({ carId: "bullseye" })).toBe("bullseye");
  });

  it("falls back to the default chassis for unset and unrecognised ids", () => {
    expect(carIdOf({ carId: "" })).toBe(DEFAULT_CAR_ID);
    expect(carIdOf({ carId: "triangle" })).toBe(DEFAULT_CAR_ID);
    // `"constructor" in CAR_TABLE` is true; the own-property check is what keeps it out.
    expect(carIdOf({ carId: "constructor" })).toBe(DEFAULT_CAR_ID);
  });
});

describe("hull fairness", () => {
  it("gives every car in CAR_TABLE the identical hitbox, regardless of stats", () => {
    const ids = Object.keys(CAR_TABLE) as CarId[];
    const hulls = otherCarHulls(
      [entry("viewer"), ...ids.map((carId) => entry(carId, { carId }))],
      "viewer",
    );
    expect(hulls).toHaveLength(ids.length);
    for (const hull of hulls) {
      expect(hull.w).toBe(DRIVE_CONFIG.carWidth);
      expect(hull.h).toBe(DRIVE_CONFIG.carHeight);
    }
    expect(new Set(hulls.map((hull) => `${hull.w}x${hull.h}`)).size).toBe(1);
  });
});

describe("otherCarHulls", () => {
  it("excludes the caller", () => {
    const hulls = otherCarHulls([entry("a", { x: 1 }), entry("b", { x: 2 })], "a");
    expect(hulls.map((hull) => hull.x)).toEqual([2]);
  });

  it("excludes players who are not on the field", () => {
    const hulls = otherCarHulls(
      [
        entry("a"),
        entry("b", { x: 2, status: PlayerStatus.READY }),
        entry("c", { x: 3, status: PlayerStatus.POST_MATCH }),
        entry("d", { x: 4 }),
      ],
      "a",
    );
    expect(hulls.map((hull) => hull.x)).toEqual([4]);
  });

  it("preserves the caller's entry order, which decides sequential contact resolution", () => {
    const entries = [entry("a"), entry("z", { x: 1 }), entry("m", { x: 2 })];
    expect(otherCarHulls(entries, "a").map((hull) => hull.x)).toEqual([1, 2]);
  });

  it("sizes every hull from DRIVE_CONFIG and carries the player's angle", () => {
    expect(otherCarHulls([entry("a"), entry("b", { x: 5, y: 6, angle: 1.25 })], "a")).toEqual([
      { x: 5, y: 6, angle: 1.25, w: DRIVE_CONFIG.carWidth, h: DRIVE_CONFIG.carHeight },
    ]);
  });
});

describe("carHullOf", () => {
  it("sizes the hull from DRIVE_CONFIG at the given pose", () => {
    expect(carHullOf(5, 6, 1.25)).toEqual({
      x: 5,
      y: 6,
      angle: 1.25,
      w: DRIVE_CONFIG.carWidth,
      h: DRIVE_CONFIG.carHeight,
    });
  });

  it("is the same hull otherCarHulls builds, so shots and driving collide with one box", () => {
    expect(otherCarHulls([entry("a"), entry("b", { x: 7, y: 8, angle: 0.5 })], "a")).toEqual([
      carHullOf(7, 8, 0.5),
    ]);
  });
});
