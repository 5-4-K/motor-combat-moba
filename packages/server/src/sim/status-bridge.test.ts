import { describe, expect, it } from "vitest";
import {
  ArenaState,
  NEUTRAL_MODIFIERS,
  PlayerState,
  PlayerStatus,
  StatusState,
  applyStatus,
  newStatusState,
} from "@motor-combat-moba/shared";
import {
  clearPlayerStatuses,
  modifiersFor,
  readStatuses,
  statusTick,
  writeStatuses,
} from "./status-bridge.js";

function arena(): ArenaState {
  return new ArenaState();
}

function addPlayer(state: ArenaState, id: string): PlayerState {
  const p = new PlayerState();
  p.sessionId = id;
  p.carId = "rectangle";
  p.status = PlayerStatus.IN_MATCH;
  p.alive = true;
  state.players.set(id, p);
  return p;
}

function row(statusId: string, startTick: number, endsTick: number): StatusState {
  const s = new StatusState();
  s.statusId = statusId;
  s.startTick = startTick;
  s.endsTick = endsTick;
  return s;
}

describe("readStatuses / writeStatuses", () => {
  it("round-trips a list through the schema", () => {
    const player = addPlayer(arena(), "a");
    const statuses = applyStatus(newStatusState(), "spiked", 10, 90, "b");
    writeStatuses(player, statuses);

    expect(player.statuses.length).toBe(1);
    expect(player.statuses.at(0)!.statusId).toBe("spiked");
    expect(player.statuses.at(0)!.startTick).toBe(10);
    expect(player.statuses.at(0)!.endsTick).toBe(100);
    expect(player.statuses.at(0)!.sourceSessionId).toBe("b");
    expect(readStatuses(player)).toEqual(statuses);
  });

  it("resizes rows positionally rather than rebuilding them", () => {
    const player = addPlayer(arena(), "a");
    let statuses = applyStatus(newStatusState(), "spiked", 0, 90);
    statuses = applyStatus(statuses, "corroded", 0, 90);
    writeStatuses(player, statuses);
    const firstRow = player.statuses.at(0);

    writeStatuses(player, statuses.slice(0, 1));
    expect(player.statuses.length).toBe(1);
    // The surviving row is the SAME object, so a shrink patches a length rather than every field.
    expect(player.statuses.at(0)).toBe(firstRow);
  });

  it("drops an unrecognised id on the way back in", () => {
    const player = addPlayer(arena(), "a");
    player.statuses.push(row("not-a-status", 0, 500));
    player.statuses.push(row("spiked", 0, 500));
    expect(readStatuses(player).map((s) => s.statusId)).toEqual(["spiked"]);
  });

  it("clearPlayerStatuses leaves nothing", () => {
    const player = addPlayer(arena(), "a");
    writeStatuses(player, applyStatus(newStatusState(), "spiked", 0, 90));
    clearPlayerStatuses(player);
    expect(player.statuses.length).toBe(0);
  });
});

describe("statusTick", () => {
  it("gives a car in no status no entry at all", () => {
    const state = arena();
    addPlayer(state, "a");
    expect(statusTick(state, 0).size).toBe(0);
  });

  it("returns the modifiers a live status produces", () => {
    const state = arena();
    const player = addPlayer(state, "a");
    writeStatuses(player, applyStatus(newStatusState(), "spiked", 0, 90));
    expect(statusTick(state, 1).get("a")!.topSpeed).toBeLessThan(1);
  });

  it("sweeps a status ON its endsTick, and drops the car from the map with it", () => {
    const state = arena();
    const player = addPlayer(state, "a");
    writeStatuses(player, applyStatus(newStatusState(), "spiked", 0, 90));

    expect(statusTick(state, 89).has("a")).toBe(true);
    expect(player.statuses.length).toBe(1);

    expect(statusTick(state, 90).has("a")).toBe(false);
    expect(player.statuses.length).toBe(0);
  });

  it("does not touch the schema when nothing lapsed", () => {
    const state = arena();
    const player = addPlayer(state, "a");
    writeStatuses(player, applyStatus(newStatusState(), "spiked", 0, 90));
    const existingRow = player.statuses.at(0);

    statusTick(state, 1);
    // The same row object, untouched: rewriting an ArraySchema patches it whether or not it changed.
    expect(player.statuses.at(0)).toBe(existingRow);
  });

  it("keeps the surviving statuses when only some lapse", () => {
    const state = arena();
    const player = addPlayer(state, "a");
    let statuses = applyStatus(newStatusState(), "spiked", 0, 20);
    statuses = applyStatus(statuses, "corroded", 0, 200);
    writeStatuses(player, statuses);

    statusTick(state, 20);
    expect(readStatuses(player).map((s) => s.statusId)).toEqual(["corroded"]);
  });
});

describe("modifiersFor", () => {
  it("falls back to the shared neutral set for a car with no entry", () => {
    expect(modifiersFor(new Map(), "nobody")).toBe(NEUTRAL_MODIFIERS);
  });
});
