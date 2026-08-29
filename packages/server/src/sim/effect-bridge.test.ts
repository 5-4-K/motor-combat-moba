import { describe, expect, it } from "vitest";
import {
  ArenaState,
  EffectState,
  NEUTRAL_MODIFIERS,
  PlayerState,
  PlayerStatus,
  applyEffect,
  effectTicksOf,
  newEffectState,
} from "@motor-combat-moba/shared";
import {
  clearPlayerEffects,
  effectTick,
  modifiersFor,
  readEffects,
  writeEffects,
} from "./effect-bridge.js";

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

function row(effectId: string, endsTick: number, stacks = 1, source = ""): EffectState {
  const e = new EffectState();
  e.effectId = effectId;
  e.endsTick = endsTick;
  e.stacks = stacks;
  e.sourceSessionId = source;
  return e;
}

describe("readEffects / writeEffects", () => {
  it("round-trips a list through the schema", () => {
    const player = addPlayer(arena(), "a");
    const effects = applyEffect(newEffectState(), "overdrive", 10, "b");
    writeEffects(player, effects);

    expect(player.effects.length).toBe(1);
    expect(player.effects.at(0)!.effectId).toBe("overdrive");
    expect(player.effects.at(0)!.endsTick).toBe(10 + effectTicksOf("overdrive"));
    expect(player.effects.at(0)!.sourceSessionId).toBe("b");
    expect(readEffects(player)).toEqual(effects);
  });

  it("resizes rows positionally rather than rebuilding them", () => {
    const player = addPlayer(arena(), "a");
    let effects = applyEffect(newEffectState(), "overdrive", 0);
    effects = applyEffect(effects, "primed", 0);
    writeEffects(player, effects);
    const firstRow = player.effects.at(0);

    writeEffects(player, effects.slice(0, 1));
    expect(player.effects.length).toBe(1);
    // The surviving row is the SAME object, so a shrink patches a length rather than every field.
    expect(player.effects.at(0)).toBe(firstRow);
  });

  it("drops an unrecognised id on the way back in", () => {
    const player = addPlayer(arena(), "a");
    player.effects.push(row("not-an-effect", 500));
    player.effects.push(row("overdrive", 500));
    expect(readEffects(player).map((e) => e.effectId)).toEqual(["overdrive"]);
  });

  it("clearPlayerEffects leaves nothing", () => {
    const player = addPlayer(arena(), "a");
    writeEffects(player, applyEffect(newEffectState(), "overdrive", 0));
    clearPlayerEffects(player);
    expect(player.effects.length).toBe(0);
  });
});

describe("effectTick", () => {
  it("gives a car with nothing on it no entry at all", () => {
    const state = arena();
    addPlayer(state, "a");
    expect(effectTick(state, 0).size).toBe(0);
  });

  it("returns the modifiers a live effect produces", () => {
    const state = arena();
    const player = addPlayer(state, "a");
    writeEffects(player, applyEffect(newEffectState(), "overdrive", 0));

    const mods = effectTick(state, 1);
    expect(mods.get("a")!.topSpeed).toBeGreaterThan(1);
  });

  it("sweeps an effect ON its endsTick, and drops the car from the map with it", () => {
    const state = arena();
    const player = addPlayer(state, "a");
    const effects = applyEffect(newEffectState(), "overdrive", 0);
    writeEffects(player, effects);
    const end = effects[0]!.endsTick;

    expect(effectTick(state, end - 1).has("a")).toBe(true);
    expect(player.effects.length).toBe(1);

    expect(effectTick(state, end).has("a")).toBe(false);
    expect(player.effects.length).toBe(0);
  });

  it("does not touch the schema when nothing lapsed", () => {
    const state = arena();
    const player = addPlayer(state, "a");
    writeEffects(player, applyEffect(newEffectState(), "overdrive", 0));
    const existingRow = player.effects.at(0);

    effectTick(state, 1);
    // The same row object, untouched: rewriting an ArraySchema patches it whether or not it changed.
    expect(player.effects.at(0)).toBe(existingRow);
  });

  it("keeps the surviving effects when only some lapse", () => {
    const state = arena();
    const player = addPlayer(state, "a");
    // `jammed` is the shortest row; `primed` the longest.
    let effects = applyEffect(newEffectState(), "jammed", 0);
    effects = applyEffect(effects, "primed", 0);
    writeEffects(player, effects);

    const jamEnd = effects.find((e) => e.effectId === "jammed")!.endsTick;
    effectTick(state, jamEnd);
    expect(readEffects(player).map((e) => e.effectId)).toEqual(["primed"]);
  });
});

describe("modifiersFor", () => {
  it("falls back to the shared neutral set for a car with no entry", () => {
    expect(modifiersFor(new Map(), "nobody")).toBe(NEUTRAL_MODIFIERS);
  });
});
