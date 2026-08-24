import { describe, expect, it } from "vitest";
import { ArenaState } from "./ArenaState.js";
import { PlayerState } from "./PlayerState.js";
import { ProjectileState } from "./ProjectileState.js";

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
    expect(p.weaponCooldown).toBe(0);
    expect(p.selectLocked).toBe(false);
    expect(p).not.toHaveProperty("pendingCarId");
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
    p.weaponCooldown = 12;
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
    expect(p.weaponCooldown).toBe(12);
    expect(p.selectLocked).toBe(true);
  });
});

describe("ProjectileState", () => {
  it("constructs with v1 defaults", () => {
    const shot = new ProjectileState();
    expect(shot.id).toBe("");
    expect(shot.ownerSessionId).toBe("");
    expect(shot.x).toBe(0);
    expect(shot.y).toBe(0);
    expect(shot.angle).toBe(0);
    expect(shot.speed).toBe(0);
    expect(shot.spawnTick).toBe(0);
    expect(shot.alive).toBe(true);
  });

  it("sets every field", () => {
    const shot = new ProjectileState();
    shot.id = "p1";
    shot.ownerSessionId = "abc";
    shot.x = 10;
    shot.y = 20;
    shot.angle = 1.5;
    shot.speed = 900;
    shot.spawnTick = 7;
    shot.alive = false;
    expect(shot.id).toBe("p1");
    expect(shot.ownerSessionId).toBe("abc");
    expect(shot.x).toBe(10);
    expect(shot.y).toBe(20);
    expect(shot.angle).toBe(1.5);
    expect(shot.speed).toBe(900);
    expect(shot.spawnTick).toBe(7);
    expect(shot.alive).toBe(false);
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
    expect(s.arenaId).toBe("arena-01");
    expect(s.carSelectDeadlineTick).toBe(0);
    expect(s.countdownEndsTick).toBe(0);
    expect(s.winnerTeam).toBe(-1);
    expect(s.winnerSessionId).toBe("");
    expect(s.projectiles.size).toBe(0);
  });

  it("sets every new v1 field and stores a projectile", () => {
    const s = new ArenaState();
    s.arenaId = "arena-01";
    s.carSelectDeadlineTick = 1800;
    s.countdownEndsTick = 1890;
    s.winnerTeam = 0;
    s.winnerSessionId = "abc";
    const shot = new ProjectileState();
    shot.id = "p1";
    shot.ownerSessionId = "abc";
    shot.x = 400;
    shot.y = 200;
    s.projectiles.set("p1", shot);
    expect(s.arenaId).toBe("arena-01");
    expect(s.carSelectDeadlineTick).toBe(1800);
    expect(s.countdownEndsTick).toBe(1890);
    expect(s.winnerTeam).toBe(0);
    expect(s.winnerSessionId).toBe("abc");
    expect(s.projectiles.size).toBe(1);
    expect(s.projectiles.get("p1")?.x).toBe(400);
  });
});
