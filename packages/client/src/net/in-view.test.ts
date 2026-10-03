import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_MODE,
  MS_PER_TICK,
  NET_CONFIG,
  NEUTRAL_MODIFIERS,
  PlayerStatus,
  RemoteTimeline,
  buildStepContext,
  drive,
  getArena,
  installMode,
  modeConfigOf,
  type RemoteSnapshot,
  type SimBody,
} from "@motor-combat-moba/shared";
import { carInView, feedRemoteTimeline, inViewRoster, ownerWirePose, type Roster } from "./in-view.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const arena = getArena("arena-01");

/** A roster row as the client decodes it: a hidden car keeps its public fields and loses the rest. */
interface Row {
  status: number;
  carId: string;
  alive: boolean;
  inView?: boolean;
  x: number;
  y: number;
  angle: number;
  statuses: Iterable<{ statusId: string; startTick: number; endsTick: number }>;
}

const visible = (x: number, y: number): Row => ({
  status: PlayerStatus.IN_MATCH,
  carId: "mirage",
  alive: true,
  inView: true,
  x,
  y,
  angle: 0,
  statuses: [],
});

/** What a decoded hidden enemy looks like: `@view()` fields absent, `inView` among them (NR42). */
const hidden = (): Row =>
  ({ status: PlayerStatus.IN_MATCH, carId: "mirage", alive: true }) as unknown as Row;

const rosterOf = (rows: Record<string, Row>): Roster<Row> => ({
  forEach(callback) {
    for (const [id, row] of Object.entries(rows)) callback(row, id);
  },
});

describe("carInView (NR48)", () => {
  it("is true for the driven car, and for any other only while its inView is true", () => {
    expect(carInView("a", hidden(), "a")).toBe(true);
    expect(carInView("b", visible(0, 0), "a")).toBe(true);
    expect(carInView("b", hidden(), "a")).toBe(false);
    expect(carInView("b", { inView: false }, "a")).toBe(false);
  });
});

describe("a hidden enemy is not in the prediction context", () => {
  it("buildStepContext over inViewRoster collides against visible cars only", () => {
    const rows = { a: visible(300, 300), b: visible(500, 300), c: hidden() };
    const ctx = buildStepContext(arena, { players: inViewRoster(rosterOf(rows), "a") }, "a", 10, NEUTRAL_MODIFIERS);
    expect(ctx.others).toHaveLength(1);
    // b's hull, never a stale or NaN one for c.
    expect(ctx.others[0]!.hull).toMatchObject({ x: 500, y: 300 });
  });

  it("keeps the driven car even before its own inView decodes", () => {
    const rows = { a: { ...visible(300, 300), inView: undefined }, b: visible(500, 300) };
    const ids: string[] = [];
    inViewRoster(rosterOf(rows), "a").forEach((_, id) => ids.push(id));
    expect(ids).toEqual(["a", "b"]);
  });
});

const body = (x: number): SimBody => ({
  x,
  y: 300,
  angle: 0,
  vx: 0,
  vy: 0,
  angVel: 0,
  maneuver: 0,
  maneuverTicksLeft: 0,
  maneuverAngle: 0,
  maneuverSpeed: 0,
});

function snapshotOf(row: Row, id: string, tick: number): RemoteSnapshot {
  return {
    body: body(row.x),
    keys: { steer: 0, throttle: 0, fireSlots: 0 },
    ctx: { ...buildStepContext(arena, { players: rosterOf({}) }, id, tick, NEUTRAL_MODIFIERS), others: [] },
    alive: row.alive,
  };
}

/** The server tick that puts the timeline's render tick at `R` (no lateness sampled: min delay). */
const serverNowFor = (R: number): number => R + NET_CONFIG.minDelayMs / MS_PER_TICK;

describe("feedRemoteTimeline: a car that comes back into view does not slide (NR48)", () => {
  it("forgets a hidden car and starts it fresh from its first visible snapshot", () => {
    // Inside the timeline's own teleport reset, so only the forget can stop the slide.
    const back = 100;
    expect(back).toBeLessThan(NET_CONFIG.remoteTeleportCars * drive().carWidth);

    const timeline = new RemoteTimeline();
    const feed = (tick: number, b: Row): void =>
      feedRemoteTimeline(timeline, rosterOf({ a: visible(0, 0), b }), "a", tick, (row, id) => snapshotOf(row, id, tick));
    for (let t = 1; t <= 5; t++) feed(t, visible(0, 300));
    for (let t = 6; t <= 9; t++) feed(t, hidden());
    // While hidden there is nothing to collide against or draw.
    expect(timeline.reckonedPose("b", 8)).toBeUndefined();
    expect(timeline.pose("b")).toBeUndefined();
    feed(10, visible(back, 300));

    timeline.beginFrame(serverNowFor(8), 16);
    // Render tick 8 is between the last seen (tick 5, x 0) and the return (tick 10, x 100). A
    // timeline that remembered tick 5 would draw the car 60 % of the way across the gap it never
    // drove on screen; a fresh one holds its first visible snapshot.
    expect(timeline.pose("b")!.x).toBe(back);
  });

  it("(control) without the forget the same snapshots slide across the gap", () => {
    const timeline = new RemoteTimeline();
    for (let t = 1; t <= 5; t++) timeline.push("b", t, snapshotOf(visible(0, 300), "b", t));
    timeline.push("b", 10, snapshotOf(visible(100, 300), "b", 10));
    timeline.beginFrame(serverNowFor(8), 16);
    expect(timeline.pose("b")!.x).toBeCloseTo(60, 5);
  });

  it("never pushes the driven car or a car off the field", () => {
    const pushed: string[] = [];
    const forgot: string[] = [];
    feedRemoteTimeline(
      { push: (id) => pushed.push(id), forget: (id) => forgot.push(id) },
      rosterOf({ a: visible(0, 0), b: visible(10, 0), c: hidden(), d: { ...visible(0, 0), status: PlayerStatus.READY } }),
      "a",
      1,
      (row, id) => snapshotOf(row, id, 1),
    );
    expect(pushed).toEqual(["b"]);
    expect(forgot).toEqual(["c"]);
  });
});

describe("ownerWirePose", () => {
  it("gives an attached beam no owner pose while its owner is out of view", () => {
    expect(ownerWirePose(undefined)).toBeNull();
    expect(ownerWirePose(hidden())).toBeNull();
    expect(ownerWirePose(visible(7, 8))).toEqual({ x: 7, y: 8, angle: 0 });
  });
});
