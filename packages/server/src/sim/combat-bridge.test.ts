import { describe, expect, it } from "vitest";
import {
  ArenaState,
  PlayerState,
  ProjectileState,
  WEAPON_CONFIG,
  hpOf,
  type CombatResult,
  type Proj,
} from "@motor-arena/shared";
import {
  applyCombatResult,
  clearProjectiles,
  newCombatMemory,
  toCombatPlayers,
  toProjectiles,
} from "./combat-bridge.js";

function playerIn(state: ArenaState, sessionId: string, over: Partial<PlayerState> = {}): PlayerState {
  const player = new PlayerState();
  player.sessionId = sessionId;
  player.x = 400;
  player.y = 150;
  player.angle = 0;
  player.carId = "rectangle";
  player.hp = hpOf("rectangle");
  player.alive = true;
  Object.assign(player, over);
  state.players.set(sessionId, player);
  return player;
}

function shotIn(state: ArenaState, id: string, over: Partial<ProjectileState> = {}): ProjectileState {
  const projectile = new ProjectileState();
  projectile.id = id;
  projectile.ownerSessionId = "a";
  projectile.x = 100;
  projectile.y = 100;
  projectile.angle = 0;
  projectile.speed = WEAPON_CONFIG.projectileSpeed;
  projectile.spawnTick = 10;
  Object.assign(projectile, over);
  state.projectiles.set(id, projectile);
  return projectile;
}

function proj(id: string, over: Partial<Proj> = {}): Proj {
  return {
    id,
    ownerSessionId: "a",
    x: 200,
    y: 100,
    angle: 0,
    speed: WEAPON_CONFIG.projectileSpeed,
    spawnTick: 10,
    alive: true,
    ...over,
  };
}

function result(over: Partial<CombatResult> = {}): CombatResult {
  return {
    players: [],
    projectiles: [],
    ramCooldowns: new Map(),
    projectileSeq: 0,
    ...over,
  };
}

describe("newCombatMemory", () => {
  it("starts with no cooldowns and a zero id counter", () => {
    const memory = newCombatMemory();
    expect(memory.ramCooldowns.size).toBe(0);
    expect(memory.projectileSeq).toBe(0);
  });
});

describe("toCombatPlayers", () => {
  it("marks only roster members as in the fight", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    playerIn(state, "b");
    const players = toCombatPlayers(state, new Set(["a"]), new Set());
    expect(players.find((p) => p.sessionId === "a")!.inRoster).toBe(true);
    expect(players.find((p) => p.sessionId === "b")!.inRoster).toBe(false);
  });

  it("marks only the session ids that fired", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    playerIn(state, "b");
    const players = toCombatPlayers(state, new Set(["a", "b"]), new Set(["b"]));
    expect(players.find((p) => p.sessionId === "a")!.fired).toBe(false);
    expect(players.find((p) => p.sessionId === "b")!.fired).toBe(true);
  });

  it("carries pose, chassis, hp, and cooldown across", () => {
    const state = new ArenaState();
    playerIn(state, "a", { x: 12, y: 34, angle: 0.5, carId: "oval", hp: 7, weaponCooldown: 4 });
    expect(toCombatPlayers(state, new Set(["a"]), new Set())[0]).toMatchObject({
      x: 12,
      y: 34,
      angle: 0.5,
      carId: "oval",
      hp: 7,
      weaponCooldown: 4,
    });
  });

  it("narrows a wire team byte to 0 or 1", () => {
    const state = new ArenaState();
    playerIn(state, "a", { team: 1 });
    playerIn(state, "b", { team: 9 });
    const players = toCombatPlayers(state, new Set(["a", "b"]), new Set());
    expect(players.find((p) => p.sessionId === "a")!.team).toBe(1);
    expect(players.find((p) => p.sessionId === "b")!.team).toBe(0);
  });
});

describe("toProjectiles", () => {
  it("copies every field the sim needs", () => {
    const state = new ArenaState();
    shotIn(state, "p1", { x: 5, y: 6, angle: 1.5, spawnTick: 22 });
    expect(toProjectiles(state)).toEqual([
      {
        id: "p1",
        ownerSessionId: "a",
        x: 5,
        y: 6,
        angle: 1.5,
        speed: WEAPON_CONFIG.projectileSpeed,
        spawnTick: 22,
        alive: true,
      },
    ]);
  });
});

describe("applyCombatResult", () => {
  it("writes hp, alive, and cooldown back onto the schema", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a");
    applyCombatResult(
      state,
      result({
        players: toCombatPlayers(state, new Set(["a"]), new Set()).map((p) => ({
          ...p,
          hp: 3,
          alive: false,
          weaponCooldown: 9,
        })),
      }),
    );
    expect(player.hp).toBe(3);
    expect(player.alive).toBe(false);
    expect(player.weaponCooldown).toBe(9);
  });

  it("leaves poses alone: driving owns them, combat never moves a car", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a", { x: 400, y: 150 });
    applyCombatResult(
      state,
      result({
        players: toCombatPlayers(state, new Set(["a"]), new Set()).map((p) => ({
          ...p,
          x: 999,
          y: 999,
        })),
      }),
    );
    expect(player.x).toBe(400);
    expect(player.y).toBe(150);
  });

  it("ignores a player who left between the tick and the write-back", () => {
    const state = new ArenaState();
    const players = toCombatPlayers(stateWithPlayer(), new Set(["gone"]), new Set());
    expect(() => applyCombatResult(state, result({ players }))).not.toThrow();
    expect(state.players.size).toBe(0);
  });

  it("adds a newly spawned shot to the schema", () => {
    const state = new ArenaState();
    applyCombatResult(state, result({ projectiles: [proj("a-1")] }));
    const added = state.projectiles.get("a-1");
    expect(added).toBeDefined();
    expect(added!.ownerSessionId).toBe("a");
    expect(added!.x).toBe(200);
    expect(added!.spawnTick).toBe(10);
  });

  it("moves an existing shot in place rather than replacing it", () => {
    const state = new ArenaState();
    const existing = shotIn(state, "a-1");
    applyCombatResult(state, result({ projectiles: [proj("a-1", { x: 777 })] }));
    expect(state.projectiles.get("a-1")).toBe(existing);
    expect(existing.x).toBe(777);
  });

  it("deletes shots the combat step dropped", () => {
    const state = new ArenaState();
    shotIn(state, "a-1");
    shotIn(state, "a-2");
    applyCombatResult(state, result({ projectiles: [proj("a-2")] }));
    expect([...state.projectiles.keys()]).toEqual(["a-2"]);
  });
});

describe("clearProjectiles", () => {
  it("empties the map", () => {
    const state = new ArenaState();
    shotIn(state, "a-1");
    shotIn(state, "a-2");
    clearProjectiles(state);
    expect(state.projectiles.size).toBe(0);
  });

  it("is a no-op on an already empty map", () => {
    const state = new ArenaState();
    clearProjectiles(state);
    expect(state.projectiles.size).toBe(0);
  });
});

/** A throwaway state used only to mint a `CombatPlayer` for an id the target state does not have. */
function stateWithPlayer(): ArenaState {
  const state = new ArenaState();
  playerIn(state, "gone");
  return state;
}
