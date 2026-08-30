import { describe, expect, it } from "vitest";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { WeaponKind } from "../constants.js";
import { ArenaState } from "./ArenaState.js";
import { StatusState } from "./StatusState.js";
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
    p.carId = "bullseye";
    p.speed = 180;
    p.reverseHold = 6;
    p.hp = 50;
    p.alive = false;
    p.selectLocked = true;
    expect(p.name).toBe("Ada");
    expect(p.colorId).toBe(3);
    expect(p.team).toBe(1);
    expect(p.joinedAtTick).toBe(42);
    expect(p.carId).toBe("bullseye");
    expect(p.speed).toBe(180);
    expect(p.reverseHold).toBe(6);
    expect(p.hp).toBe(50);
    expect(p.alive).toBe(false);
    expect(p.selectLocked).toBe(true);
  });

  it("defaults authority to 1, not 0 — a 0 default would mean an undriveable car", () => {
    const p = new PlayerState();
    expect(p.authority).toBe(1);
    expect(p.angVel).toBe(0);
    expect(p.shoveX).toBe(0);
    expect(p.shoveY).toBe(0);
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
    slot.weaponId = "fireball";
    slot.stocks = 1;
    player.weapons.push(slot);
    expect(player.weapons.at(0)!.weaponId).toBe("fireball");
    expect(player.level).toBe(1);
    expect(player.switchLockUntilTick).toBe(0);
  });

  it("no longer carries the single-weapon cooldown", () => {
    expect("weaponCooldown" in new PlayerState()).toBe(false);
  });
});

describe("status schema", () => {
  it("gives a player an empty status list by default", () => {
    const player = new PlayerState();
    expect(player.statuses.length).toBe(0);
  });

  it("defaults a row to an unnamed status from nobody", () => {
    const row = new StatusState();
    expect(row.statusId).toBe("");
    expect(row.startTick).toBe(0);
    expect(row.endsTick).toBe(0);
    expect(row.sourceSessionId).toBe("");
  });

  it("carries status rows on a player, in order", () => {
    const player = new PlayerState();
    const slow = new StatusState();
    slow.statusId = "spiked";
    slow.startTick = 300;
    slow.endsTick = 420;
    slow.sourceSessionId = "shooter";
    player.statuses.push(slow);

    expect(player.statuses.length).toBe(1);
    expect(player.statuses.at(0)!.statusId).toBe("spiked");
    expect(player.statuses.at(0)!.startTick).toBe(300);
    expect(player.statuses.at(0)!.endsTick).toBe(420);
    expect(player.statuses.at(0)!.sourceSessionId).toBe("shooter");
  });

  it("networks the whole status, unlike the fire machine behind the slot rows", () => {
    // Every field the sim reads is here: a status has no server-only half, because the client
    // predicts the local car through the modifiers derived from exactly these rows.
    const row = new StatusState();
    for (const field of ["statusId", "startTick", "endsTick", "sourceSessionId"]) {
      expect(row).toHaveProperty(field);
    }
  });

  it("carries both ticks, because the duration is not recoverable from the status table", () => {
    // A status does not own its duration -- the applier chose it -- so `startTick` is the only way
    // a reader can know the total, which the HUD's drain bar needs.
    const row = new StatusState();
    row.startTick = 100;
    row.endsTick = 190;
    expect(row.endsTick - row.startTick).toBe(90);
  });
});
