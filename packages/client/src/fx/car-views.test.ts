import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, PlayerStatus, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { fxCarViews, type FxCarSource } from "./car-views.js";
import { deriveFxEvents, type FxWorldView } from "./events.js";
import type { Roster } from "../net/in-view.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

type Row = FxCarSource & { x: number; y: number; angle: number };

const seen = (hp: number, alive = true): Row => ({
  status: PlayerStatus.IN_MATCH,
  inView: true,
  hp,
  alive,
  carId: "mirage",
  vx: 0,
  vy: 0,
  x: 100,
  y: 100,
  angle: 0,
});

/** A hidden enemy as decoded (NR42): public `alive`/`carId`/`status` only. */
const unseen = (alive = true): Row =>
  ({ status: PlayerStatus.IN_MATCH, alive, carId: "mirage" }) as unknown as Row;

const world = (rows: Record<string, Row>): FxWorldView => {
  const roster: Roster<Row> = {
    forEach(callback) {
      for (const [id, row] of Object.entries(rows)) callback(row, id);
    },
  };
  return { cars: fxCarViews(roster, "me", (row) => row), instances: [] };
};

describe("fxCarViews: a hidden car yields no fx event (NR48)", () => {
  it("leaves a car out of the fx world while it is not in view", () => {
    expect(world({ me: seen(100), b: unseen() }).cars.map((c) => c.sessionId)).toEqual(["me"]);
  });

  it("a car turning hidden emits nothing, even with its hp and pose gone", () => {
    expect(deriveFxEvents(world({ me: seen(100), b: seen(100) }), world({ me: seen(100), b: unseen() }))).toEqual([]);
  });

  it("a car that dies while hidden emits no died (the kill feed, not fx, carries a hidden death)", () => {
    const before = world({ me: seen(100), b: unseen() });
    expect(deriveFxEvents(before, world({ me: seen(100), b: unseen(false) }))).toEqual([]);
    // Nor on the frame it turns hidden and dead at once.
    expect(deriveFxEvents(world({ me: seen(100), b: seen(10) }), world({ me: seen(100), b: unseen(false) }))).toEqual([]);
  });

  it("a car that comes back with less hp than it left with emits no damaged", () => {
    const hiddenFrame = world({ me: seen(100), b: unseen() });
    expect(deriveFxEvents(hiddenFrame, world({ me: seen(100), b: seen(40) }))).toEqual([]);
  });

  it("(control) a visible car's damage and death still emit", () => {
    const kinds = (a: FxWorldView, b: FxWorldView): string[] => deriveFxEvents(a, b).map((e) => e.kind);
    expect(kinds(world({ me: seen(100), b: seen(100) }), world({ me: seen(100), b: seen(60) }))).toEqual(["damaged"]);
    expect(kinds(world({ me: seen(100), b: seen(60) }), world({ me: seen(100), b: seen(0, false) }))).toEqual(["died"]);
  });

  it("always carries the driven car, and never a car off the field", () => {
    const rows = { me: { ...seen(100), inView: undefined }, c: { ...seen(100), status: PlayerStatus.READY } };
    expect(world(rows).cars.map((c) => c.sessionId)).toEqual(["me"]);
  });
});
