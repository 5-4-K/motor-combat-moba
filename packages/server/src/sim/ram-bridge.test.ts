import { describe, expect, it } from "vitest";
import {
  ArenaState,
  PlayerState,
  PlayerStatus,
  RAM_CONFIG,
  type Modifiers,
} from "@motor-combat-moba/shared";
import { clearKnock, newRamMemory, ramTick } from "./ram-bridge.js";

/**
 * No buffs or debuffs in play. Every expectation in this file is the unbuffed sim, and a
 * `NEUTRAL_MODIFIERS` lookup is what an empty map yields through `modifiersFor`.
 */
const NO_EFFECTS = new Map<string, Modifiers>();

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

/**
 * The approach speeds `serverTick` would have reported for this state: each car's speed as it
 * entered the tick. These tests set `speed` on `PlayerState` directly and never run `serverTick`,
 * so the two are the same number here — which is the point. `ramTick` requires the map because in
 * the live tick collision resolution has already reflected `player.speed` by the time ram runs.
 */
function approachSpeeds(state: ArenaState): Map<string, number> {
  const speeds = new Map<string, number>();
  state.players.forEach((p, id) => speeds.set(id, p.speed));
  return speeds;
}

describe("ramTick", () => {
  it("knocks a victim that was just rammed", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa", NO_EFFECTS, approachSpeeds(state));
    expect(victim.authority).toBeLessThan(1);
    expect(victim.shoveX).toBeGreaterThan(0);
  });

  it("leaves the attacker untouched", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa", NO_EFFECTS, approachSpeeds(state));
    expect(attacker.authority).toBe(1);
    expect(attacker.shoveX).toBe(0);
    expect(attacker.angVel).toBe(0);
  });

  it("never changes hp", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540, hp: 400 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0, hp: 400 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa", NO_EFFECTS, approachSpeeds(state));
    expect(victim.hp).toBe(400);
  });

  it("fires once per contact episode, not once per tick", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newRamMemory();
    ramTick(state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state));
    const afterFirst = victim.authority;
    victim.authority = 1;
    ramTick(state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state));
    expect(afterFirst).toBeLessThan(1);
    expect(victim.authority).toBe(1);
  });

  it("ignores players who are not in the roster", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const bystander = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    ramTick(state, new Set(["a"]), newRamMemory(), "ffa", NO_EFFECTS, approachSpeeds(state));
    expect(bystander.authority).toBe(1);
  });

  it("ignores players who are not on the field", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const lobbying = addPlayer(state, "b", { x: 47, y: 400, angle: 0, status: PlayerStatus.READY });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa", NO_EFFECTS, approachSpeeds(state));
    expect(lobbying.authority).toBe(1);
  });

  it("ignores wrecks", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const wreck = addPlayer(state, "b", { x: 47, y: 400, angle: 0, alive: false });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "ffa", NO_EFFECTS, approachSpeeds(state));
    expect(wreck.authority).toBe(1);
  });

  it("spares teammates in team mode", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540, team: 0 });
    const mate = addPlayer(state, "b", { x: 47, y: 400, angle: 0, team: 0 });
    ramTick(state, new Set(["a", "b"]), newRamMemory(), "team", NO_EFFECTS, approachSpeeds(state));
    expect(mate.authority).toBe(1);
  });

  it("does not let a later, weaker ram overwrite a standing stronger knock (no rescue)", () => {
    const state = arena();
    // A full-severity rear ram: a top-speed rectangle into the back of "b". Lands well below the
    // authority floor's midpoint.
    addPlayer(state, "strong", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newRamMemory();
    ramTick(state, new Set(["strong", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state));
    const afterHardRam = victim.authority;
    expect(afterHardRam).toBeLessThan(0.5);

    // A separate attacker taps the same victim on a later tick, from the exact same geometry but
    // barely above minApproachSpeed — the weakest contact that still counts as a ram at all. Its own
    // knock would land authority near 1.0 (almost no control loss), which must NOT overwrite the
    // still-standing hard knock above.
    addPlayer(state, "weak", { x: 0, y: 400, angle: 0, speed: RAM_CONFIG.minApproachSpeed + 5 });
    ramTick(state, new Set(["strong", "b", "weak"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state));

    expect(victim.authority).toBe(afterHardRam);
  });

  it("lets a later, STRONGER ram overwrite a standing knock", () => {
    const state = arena();
    addPlayer(state, "medium", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newRamMemory();
    ramTick(state, new Set(["medium", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state));
    const afterMediumRam = victim.authority;

    // A heavier attacker (hexagon) rear-ends the same victim at its own top speed on a later tick —
    // strictly harder than the first ram, so its lower authority must win.
    addPlayer(state, "hexy", { x: 0, y: 400, angle: 0, speed: 315, carId: "hexagon" });
    ramTick(state, new Set(["medium", "b", "hexy"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state));

    expect(victim.authority).toBeLessThan(afterMediumRam);
    expect(victim.authority).toBeCloseTo(RAM_CONFIG.authorityFloor, 2);
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
