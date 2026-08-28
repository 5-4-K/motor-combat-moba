import { describe, expect, it } from "vitest";
import { ArenaState, PlayerState, PlayerStatus } from "@motor-combat-moba/shared";
import { clearKnock, newRamMemory, ramTick } from "./ram-bridge.js";

function addPlayer(state: ArenaState, id: string, over: Partial<PlayerState> = {}): PlayerState {
  const p = new PlayerState();
  p.sessionId = id;
  p.carId = "rectangle";
  p.status = PlayerStatus.IN_MATCH;
  p.alive = true;
  Object.assign(p, over);
  state.players.set(id, p);
  return p;
}

function arena(): ArenaState {
  const state = new ArenaState();
  state.arenaId = "arena-01";
  return state;
}

describe("ramTick", () => {
  it("knocks a victim that was just rammed", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa");
    expect(victim.authority).toBeLessThan(1);
    expect(victim.shoveX).toBeGreaterThan(0);
  });

  it("leaves the attacker untouched", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa");
    expect(attacker.authority).toBe(1);
    expect(attacker.shoveX).toBe(0);
    expect(attacker.angVel).toBe(0);
  });

  it("never changes hp", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540, hp: 400 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0, hp: 400 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa");
    expect(victim.hp).toBe(400);
  });

  it("fires once per contact episode, not once per tick", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newRamMemory();
    ramTick(state, new Set(["a", "b"]), memory, "ffa");
    const afterFirst = victim.authority;
    victim.authority = 1;
    ramTick(state, new Set(["a", "b"]), memory, "ffa");
    expect(afterFirst).toBeLessThan(1);
    expect(victim.authority).toBe(1);
  });

  it("ignores players who are not in the roster", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const bystander = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    ramTick(state, new Set(["a"]), newRamMemory(), "ffa");
    expect(bystander.authority).toBe(1);
  });

  it("ignores players who are not on the field", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const lobbying = addPlayer(state, "b", { x: 47, y: 400, angle: 0, status: PlayerStatus.READY });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa");
    expect(lobbying.authority).toBe(1);
  });

  it("ignores wrecks", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const wreck = addPlayer(state, "b", { x: 47, y: 400, angle: 0, alive: false });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa");
    expect(wreck.authority).toBe(1);
  });

  it("spares teammates in team mode", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540, team: 0 });
    const mate = addPlayer(state, "b", { x: 47, y: 400, angle: 0, team: 0 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "team");
    expect(mate.authority).toBe(1);
  });
});

describe("clearKnock", () => {
  it("restores a knocked player to neutral", () => {
    const p = new PlayerState();
    p.angVel = 3;
    p.shoveX = 100;
    p.shoveY = -50;
    p.authority = 0.35;
    clearKnock(p);
    expect(p.angVel).toBe(0);
    expect(p.shoveX).toBe(0);
    expect(p.shoveY).toBe(0);
    expect(p.authority).toBe(1);
  });
});
