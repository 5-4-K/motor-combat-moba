import { describe, expect, it } from "vitest";
import {
  ArenaState,
  ManeuverKind,
  PlayerState,
  PlayerStatus,
  RAM_CONFIG,
  SLAM_CONFIG,
  SLAM_TICKS,
  applyStatus,
  type Modifiers,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { clearKnock, newContactMemory, contactTick } from "./ram-bridge.js";
import { readStatuses, writeStatuses } from "./status-bridge.js";

/**
 * No buffs or debuffs in play. Every expectation in this file is the unbuffed sim, and a
 * `NEUTRAL_MODIFIERS` lookup is what an empty map yields through `modifiersFor`.
 */
const NO_EFFECTS = new Map<string, Modifiers>();

/** No running maneuver for anyone — the neutral value for `contactTick`'s `maneuverWeapons` map. */
const NO_MANEUVER_WEAPONS = new Map<string, WeaponId | "">();

function addPlayer(state: ArenaState, id: string, over: Partial<PlayerState> = {}): PlayerState {
  const p = new PlayerState();
  p.sessionId = id;
  p.carId = "mirage";
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
 * so the two are the same number here — which is the point. `contactTick` requires the map because
 * in the live tick collision resolution has already reflected `player.speed` by the time contact
 * runs.
 */
function approachSpeeds(state: ArenaState): Map<string, number> {
  const speeds = new Map<string, number>();
  state.players.forEach((p, id) => speeds.set(id, p.speed));
  return speeds;
}

describe("contactTick (ordinary ram, unchanged behaviour)", () => {
  it("knocks a victim that was just rammed", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(victim.authority).toBeLessThan(1);
    expect(victim.shoveX).toBeGreaterThan(0);
  });

  it("leaves the attacker untouched", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(attacker.authority).toBe(1);
    expect(attacker.shoveX).toBe(0);
    expect(attacker.angVel).toBe(0);
  });

  it("never changes hp", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540, hp: 400 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0, hp: 400 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(victim.hp).toBe(400);
  });

  it("fires once per contact episode, not once per tick", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newContactMemory();
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    const afterFirst = victim.authority;
    victim.authority = 1;
    contactTick(
      state, new Set(["a", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 11,
    );
    expect(afterFirst).toBeLessThan(1);
    expect(victim.authority).toBe(1);
  });

  it("ignores players who are not in the roster", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const bystander = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    contactTick(
      state, new Set(["a"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(bystander.authority).toBe(1);
  });

  it("ignores players who are not on the field", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const lobbying = addPlayer(state, "b", { x: 47, y: 400, angle: 0, status: PlayerStatus.READY });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(lobbying.authority).toBe(1);
  });

  it("ignores wrecks", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540 });
    const wreck = addPlayer(state, "b", { x: 47, y: 400, angle: 0, alive: false });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(wreck.authority).toBe(1);
  });

  it("spares teammates in team mode", () => {
    const state = arena();
    addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 540, team: 0 });
    const mate = addPlayer(state, "b", { x: 47, y: 400, angle: 0, team: 0 });
    contactTick(
      state, new Set(["a", "b"]), newContactMemory(), "team", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    expect(mate.authority).toBe(1);
  });

  it("does not let a later, weaker ram overwrite a standing stronger knock (no rescue)", () => {
    const state = arena();
    // A full-severity rear ram: a top-speed mirage into the back of "b". Lands well below the
    // authority floor's midpoint.
    addPlayer(state, "strong", { x: 0, y: 400, angle: 0, speed: 540 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newContactMemory();
    contactTick(
      state, new Set(["strong", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    const afterHardRam = victim.authority;
    expect(afterHardRam).toBeLessThan(0.5);

    // A separate attacker taps the same victim on a later tick, from the exact same geometry but
    // barely above minApproachSpeed — the weakest contact that still counts as a ram at all. Its own
    // knock would land authority near 1.0 (almost no control loss), which must NOT overwrite the
    // still-standing hard knock above.
    addPlayer(state, "weak", { x: 0, y: 400, angle: 0, speed: RAM_CONFIG.minApproachSpeed + 5 });
    contactTick(
      state, new Set(["strong", "b", "weak"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 11,
    );

    expect(victim.authority).toBe(afterHardRam);
  });

  it("lets a later, STRONGER ram overwrite a standing knock", () => {
    const state = arena();
    // A sub-top-speed mirage: T4 raised both mirage's mass and RAM_REFERENCE, and at mirage's own
    // top speed (576) the ram now saturates severity same as bastion's does below, leaving no gap
    // for a "stronger" ram to widen. 300 u/s keeps this a genuine partial-severity ram.
    addPlayer(state, "medium", { x: 0, y: 400, angle: 0, speed: 300 });
    const victim = addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    const memory = newContactMemory();
    contactTick(
      state, new Set(["medium", "b"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 10,
    );
    const afterMediumRam = victim.authority;

    // A heavier attacker (bastion) rear-ends the same victim at its own top speed on a later tick —
    // strictly harder than the first ram, so its lower authority must win.
    addPlayer(state, "hexy", { x: 0, y: 400, angle: 0, speed: 315, carId: "bastion" });
    contactTick(
      state, new Set(["medium", "b", "hexy"]), memory, "ffa", NO_EFFECTS, approachSpeeds(state),
      NO_MANEUVER_WEAPONS, 11,
    );

    expect(victim.authority).toBeLessThan(afterMediumRam);
    expect(victim.authority).toBeCloseTo(RAM_CONFIG.authorityFloor, 2);
  });
});

describe("contactTick (hard slam, O2/O3/O18)", () => {
  it("ends a charge on its first slam: fields cleared, self statuses expired, speed partly restored", () => {
    const state = arena();
    const attacker = addPlayer(state, "a", { x: 0, y: 400, angle: 0, speed: 300 });
    addPlayer(state, "b", { x: 47, y: 400, angle: 0 });
    attacker.maneuver = ManeuverKind.CHARGE;
    attacker.maneuverTicksLeft = 200;
    writeStatuses(attacker, applyStatus([], "fortified", 5, 300, "a"));
    const memory = newContactMemory();
    const result = contactTick(
      state,
      new Set(["a", "b"]),
      memory,
      "ffa",
      NO_EFFECTS,
      new Map([["a", 300], ["b", 0]]),
      new Map<string, WeaponId | "">([["a", "thumper"]]),
      10,
    );
    expect(result.contactHits).toEqual([{ attackerSessionId: "a", targetSessionId: "b", weaponId: "thumper" }]);
    expect(attacker.maneuver).toBe(0);
    expect(readStatuses(attacker)).toHaveLength(0); // fortified expired with the charge (O2)
    expect(attacker.speed).toBeCloseTo(300 * SLAM_CONFIG.selfKeepFactor);
    expect(memory.slammed.get("b")).toBeDefined();
  });

  it("stuns a slammed victim shoved into a wall inside the window, once", () => {
    const state = arena();
    const victim = addPlayer(state, "b", { x: 24, y: 500, angle: 0 });
    const roster = new Set(["b"]);
    const memory = newContactMemory();
    memory.slammed.set("b", { bySessionId: "a", wallStunUntilTick: 25, immuneUntilTick: 28 });
    const speeds = approachSpeeds(state);

    const first = contactTick(state, roster, memory, "ffa", NO_EFFECTS, speeds, NO_MANEUVER_WEAPONS, 12);
    expect(first.statusRequests).toEqual([
      { targetSessionId: "b", statusId: "stunned", durationTicks: SLAM_TICKS.wallStunDuration, sourceSessionId: "a" },
    ]);
    const second = contactTick(state, roster, memory, "ffa", NO_EFFECTS, speeds, NO_MANEUVER_WEAPONS, 13);
    expect(second.statusRequests).toHaveLength(0); // one stun per slam
    expect(victim.x).toBe(24);
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

  it("zeroes a running maneuver too, so a fresh match never inherits a dash or charge", () => {
    const p = new PlayerState();
    p.maneuver = 3;
    p.maneuverTicksLeft = 250;
    p.maneuverAngle = 1.2;
    p.maneuverSpeed = 1600;
    clearKnock(p);
    expect(p.maneuver).toBe(0);
    expect(p.maneuverTicksLeft).toBe(0);
    expect(p.maneuverAngle).toBe(0);
    expect(p.maneuverSpeed).toBe(0);
  });
});
