import { describe, expect, it } from "vitest";
import { CAR_TABLE, DEFAULT_CAR_ID } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { PlayerStatus } from "../constants.js";
import {
  carHullOf,
  carIdOf,
  isOnField,
  isSolid,
  otherCarHulls,
  type ContextEntry,
  type ContextPlayer,
} from "./context.js";

function player(over: Partial<ContextPlayer> = {}): ContextPlayer {
  return {
    x: 0,
    y: 0,
    angle: 0,
    status: PlayerStatus.IN_MATCH,
    carId: "mirage",
    alive: true,
    statuses: [],
    ...over,
  };
}

function entry(sessionId: string, over: Partial<ContextPlayer> = {}): ContextEntry {
  return { sessionId, player: player(over) };
}

describe("isOnField", () => {
  it("is true only for a LIVING player in the match", () => {
    expect(isOnField({ status: PlayerStatus.IN_MATCH, alive: true })).toBe(true);
    expect(isOnField({ status: PlayerStatus.READY, alive: true })).toBe(false);
    expect(isOnField({ status: PlayerStatus.POST_MATCH, alive: true })).toBe(false);
  });

  it("takes a dead car off the field immediately — there is no wreck", () => {
    // Before 2026-08-30 a dead car stayed IN_MATCH and so stayed a collision hull: solid to
    // driving, transparent to combat. It is now intangible from the tick it dies, and the client
    // fades it out over DEATH_FADE_MS. This predicate is the whole mechanism.
    expect(isOnField({ status: PlayerStatus.IN_MATCH, alive: false })).toBe(false);
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
      0,
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
    const hulls = otherCarHulls([entry("a", { x: 1 }), entry("b", { x: 2 })], "a", 0);
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
      0,
    );
    expect(hulls.map((hull) => hull.x)).toEqual([4]);
  });

  it("preserves the caller's entry order, which decides sequential contact resolution", () => {
    const entries = [entry("a"), entry("z", { x: 1 }), entry("m", { x: 2 })];
    expect(otherCarHulls(entries, "a", 0).map((hull) => hull.x)).toEqual([1, 2]);
  });

  it("sizes every hull from DRIVE_CONFIG and carries the player's angle", () => {
    expect(otherCarHulls([entry("a"), entry("b", { x: 5, y: 6, angle: 1.25 })], "a", 0)).toEqual([
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
    expect(otherCarHulls([entry("a"), entry("b", { x: 7, y: 8, angle: 0.5 })], "a", 0)).toEqual([
      carHullOf(7, 8, 0.5),
    ]);
  });
});

describe("isSolid", () => {
  const base = { status: PlayerStatus.IN_MATCH, alive: true, statuses: [] };
  const phasedRow = { statusId: "phased", startTick: 0, endsTick: 10, sourceSessionId: "" };

  it("agrees with isOnField for a car in no status", () => {
    expect(isSolid(base, 0)).toBe(true);
    expect(isSolid({ ...base, alive: false }, 0)).toBe(false);
    expect(isSolid({ ...base, status: PlayerStatus.READY }, 0)).toBe(false);
  });

  it("is false while phasing and true again once it lapses", () => {
    expect(isSolid({ ...base, statuses: [phasedRow] }, 5)).toBe(false);
    expect(isSolid({ ...base, statuses: [phasedRow] }, 10)).toBe(true);
  });

  it("ignores a status that is not phased", () => {
    const slowed = { statusId: "overheated", startTick: 0, endsTick: 10, sourceSessionId: "" };
    expect(isSolid({ ...base, statuses: [slowed] }, 5)).toBe(true);
  });
});

describe("otherCarHulls with a phasing car", () => {
  const player = (over: Partial<ContextPlayer> = {}): ContextPlayer => ({
    x: 0, y: 0, angle: 0, status: PlayerStatus.IN_MATCH, carId: "mirage", alive: true,
    statuses: [], ...over,
  });

  it("is MUTUAL: drops a phasing car from every other car's list, and gives the phasing car an empty list back", () => {
    // `resolveWorld` separates a single body against a list, so one-sided filtering would leave the
    // phasing car still handed everyone else's hull and still bounced by it. Real intangibility
    // needs BOTH halves: the ghost is invisible to others, and others are invisible to the ghost.
    const entries = [
      { sessionId: "a", player: player({ x: 100 }) },
      {
        sessionId: "b",
        player: player({
          x: 200,
          statuses: [{ statusId: "phased", startTick: 0, endsTick: 10, sourceSessionId: "" }],
        }),
      },
    ];
    // The solid car cannot see the ghost...
    expect(otherCarHulls(entries, "a", 5)).toHaveLength(0);
    // ...and the ghost cannot see the solid car it is passing through either, so neither shoves.
    expect(otherCarHulls(entries, "b", 5)).toHaveLength(0);
  });

  it("falls back to solid for a caller absent from entries — a not-yet-loaded local player must not ghost", () => {
    // `buildStepContext` looks up the local player by session id and can come up empty (the client's
    // "local player hasn't arrived on the schema yet" path). That absence must never read as
    // phased, or prediction would silently see an empty world for a car nobody put into spawn
    // protection.
    const entries = [
      { sessionId: "a", player: player({ x: 100 }) },
      { sessionId: "b", player: player({ x: 200 }) },
    ];
    expect(otherCarHulls(entries, "missing", 5)).toHaveLength(2);
  });

  it("phases through CARS only — a wall is not a car (M17)", () => {
    // The whole guarantee, pinned as a fact about this function's inputs: `otherCarHulls` is handed
    // nothing but car entries, so there is no code path by which phasing could drop an obstacle.
    // Obstacles and bounds reach `resolveWorld` straight off the arena rather than through here —
    // mutual intangibility only ever removes CAR hulls, and every hull that survives is still a real
    // car hull, never an arena box.
    const ghost = player({
      statuses: [{ statusId: "phased", startTick: 0, endsTick: 10, sourceSessionId: "" }],
    });
    const solidA = player({ x: 100 });
    const solidB = player({ x: 200 });
    const entries = [
      { sessionId: "ghost", player: ghost },
      { sessionId: "a", player: solidA },
      { sessionId: "b", player: solidB },
    ];
    // From a solid car's point of view: the ghost is filtered out, another solid car is not, and
    // what comes back is a car hull at a car's pose.
    const hulls = otherCarHulls(entries, "a", 5);
    expect(hulls).toEqual([carHullOf(solidB.x, solidB.y, solidB.angle)]);
  });
});
