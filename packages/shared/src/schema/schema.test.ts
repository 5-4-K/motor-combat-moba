import { describe, expect, it } from "vitest";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { WeaponKind } from "../constants.js";
import { ArenaState } from "./ArenaState.js";
import { PlayerState } from "./PlayerState.js";
import { WeaponInstanceState } from "./WeaponInstanceState.js";
import { WeaponSlotState } from "./WeaponSlotState.js";

describe("PlayerState", () => {
  it("constructs with P0 fields and v1 defaults", () => {
    const p = new PlayerState();
    expect(p.sessionId).toBe("");
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.angle).toBe(0);
    expect(p.status).toBe(0);
    expect(p.lastProcessedInputSeq).toBe(0);
    expect(p.name).toBe("");
    expect(p.colorId).toBe(0);
    expect(p.team).toBe(0);
    expect(p.joinedAtTick).toBe(0);
    expect(p.carId).toBe("");
    expect(p.speed).toBe(0);
    expect(p.reverseHold).toBe(0);
    expect(p.hp).toBe(0);
    expect(p.alive).toBe(true);
    expect(p.selectLocked).toBe(false);
    expect(p.weapons.length).toBe(0);
    expect(p.switchLockUntilTick).toBe(0);
    expect(p.level).toBe(1);
    expect(p.pendingUntilTick).toBe(0);
    expect(p.lastFiredSlot).toBe(-1); // int8: -1 is "has never fired", not a slot index
    expect(p).not.toHaveProperty("pendingCarId");
    expect(p).not.toHaveProperty("weaponCooldown");
  });

  it("sets every new v1 field", () => {
    const p = new PlayerState();
    p.name = "Ada";
    p.colorId = 3;
    p.team = 1;
    p.joinedAtTick = 42;
    p.carId = "oval";
    p.speed = 180;
    p.reverseHold = 6;
    p.hp = 50;
    p.alive = false;
    p.selectLocked = true;
    expect(p.name).toBe("Ada");
    expect(p.colorId).toBe(3);
    expect(p.team).toBe(1);
    expect(p.joinedAtTick).toBe(42);
    expect(p.carId).toBe("oval");
    expect(p.speed).toBe(180);
    expect(p.reverseHold).toBe(6);
    expect(p.hp).toBe(50);
    expect(p.alive).toBe(false);
    expect(p.selectLocked).toBe(true);
  });
});

describe("ArenaState", () => {
  it("constructs with tick 0 and empty players", () => {
    const s = new ArenaState();
    expect(s.tick).toBe(0);
    expect(s.hostSessionId).toBe("");
    expect(s.players.size).toBe(0);
  });

  it("stores a PlayerState in the map", () => {
    const s = new ArenaState();
    const p = new PlayerState();
    p.sessionId = "abc";
    p.x = 100;
    p.y = 80;
    s.players.set("abc", p);
    expect(s.players.get("abc")?.x).toBe(100);
  });

  it("constructs with v1 defaults", () => {
    const s = new ArenaState();
    expect(s.arenaId).toBe(ACTIVE_ARENA_ID);
    expect(s.carSelectDeadlineTick).toBe(0);
    expect(s.countdownEndsTick).toBe(0);
    expect(s.winnerTeam).toBe(-1);
    expect(s.winnerSessionId).toBe("");
    expect(s.weapons.size).toBe(0);
  });

  it("sets every new v1 field and stores a weapon instance", () => {
    const s = new ArenaState();
    s.arenaId = ACTIVE_ARENA_ID;
    s.carSelectDeadlineTick = 1800;
    s.countdownEndsTick = 1890;
    s.winnerTeam = 0;
    s.winnerSessionId = "abc";
    const instance = new WeaponInstanceState();
    instance.id = "p1";
    instance.ownerSessionId = "abc";
    instance.x = 400;
    instance.y = 200;
    s.weapons.set("p1", instance);
    expect(s.arenaId).toBe(ACTIVE_ARENA_ID);
    expect(s.carSelectDeadlineTick).toBe(1800);
    expect(s.countdownEndsTick).toBe(1890);
    expect(s.winnerTeam).toBe(0);
    expect(s.winnerSessionId).toBe("abc");
    expect(s.weapons.size).toBe(1);
    expect(s.weapons.get("p1")?.x).toBe(400);
  });
});

describe("weapon schema", () => {
  it("numbers weapon kinds explicitly and stably", () => {
    expect(WeaponKind.PROJECTILE).toBe(0);
    expect(WeaponKind.BEAM).toBe(1);
  });

  it("defaults an instance to a live projectile at the origin", () => {
    const instance = new WeaponInstanceState();
    expect(instance.kind).toBe(WeaponKind.PROJECTILE);
    expect(instance.extent).toBe(0);
    expect(instance.alive).toBe(true);
  });

  it("carries instances on the arena keyed by id", () => {
    const state = new ArenaState();
    const instance = new WeaponInstanceState();
    instance.id = "aaa-1";
    state.weapons.set(instance.id, instance);
    expect(state.weapons.get("aaa-1")).toBe(instance);
  });

  it("gives a player an ordered slot array and a level", () => {
    const player = new PlayerState();
    const slot = new WeaponSlotState();
    slot.weaponId = "cannon";
    slot.stocks = 1;
    player.weapons.push(slot);
    expect(player.weapons.at(0)!.weaponId).toBe("cannon");
    expect(player.level).toBe(1);
    expect(player.switchLockUntilTick).toBe(0);
  });

  it("no longer carries the single-weapon cooldown", () => {
    expect("weaponCooldown" in new PlayerState()).toBe(false);
  });
});
