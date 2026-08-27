import { describe, expect, it } from "vitest";
import {
  ArenaState,
  PlayerState,
  hpOf,
  isCarId,
  newFireState,
  newLockState,
  type CombatResult,
  type WeaponInstance,
} from "@motor-combat-moba/shared";
import {
  applyCombatResult,
  clearInstances,
  newCombatMemory,
  toCombatPlayers,
  toInstances,
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
  player.level = 1;
  Object.assign(player, over);
  state.players.set(sessionId, player);
  return player;
}

function liveInstance(over: Partial<WeaponInstance> = {}): WeaponInstance {
  return {
    id: "aaa-1",
    ownerSessionId: "aaa",
    ownerTeam: 0,
    weaponId: "cannon",
    kind: "projectile",
    x: 100,
    y: 100,
    angle: 0,
    extent: 0,
    spawnTick: 90,
    distance: 0,
    pierceLeft: 0,
    attached: false,
    damageClock: new Map<string, number>(),
    alive: true,
    ...over,
  };
}

function result(over: Partial<CombatResult> = {}): CombatResult {
  return {
    players: [],
    instances: [],
    ramCooldowns: new Map(),
    instanceSeq: 0,
    ...over,
  };
}

describe("newCombatMemory", () => {
  it("starts empty: no cooldowns, no fire states, no instances, a zero id counter", () => {
    const memory = newCombatMemory();
    expect(memory.ramCooldowns.size).toBe(0);
    expect(memory.instanceSeq).toBe(0);
    expect(memory.fireStates.size).toBe(0);
    expect(memory.instances.size).toBe(0);
    expect(memory.locks.size).toBe(0);
  });
});

describe("toCombatPlayers", () => {
  it("marks only roster members as in the fight", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    playerIn(state, "b");
    const players = toCombatPlayers(state, new Set(["a"]), new Map(), newCombatMemory());
    expect(players.find((p) => p.sessionId === "a")!.inRoster).toBe(true);
    expect(players.find((p) => p.sessionId === "b")!.inRoster).toBe(false);
  });

  it("carries the validated fire mask from the masks map", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    playerIn(state, "b");
    const players = toCombatPlayers(state, new Set(["a", "b"]), new Map([["b", 0b010]]), newCombatMemory());
    expect(players.find((p) => p.sessionId === "a")!.fireMask).toBe(0);
    expect(players.find((p) => p.sessionId === "b")!.fireMask).toBe(0b010);
  });

  it("carries pose, chassis, and hp across", () => {
    const state = new ArenaState();
    playerIn(state, "a", { x: 12, y: 34, angle: 0.5, carId: "oval", hp: 7 });
    expect(toCombatPlayers(state, new Set(["a"]), new Map(), newCombatMemory())[0]).toMatchObject({
      x: 12,
      y: 34,
      angle: 0.5,
      carId: "oval",
      hp: 7,
    });
  });

  it("narrows a wire team byte to 0 or 1", () => {
    const state = new ArenaState();
    playerIn(state, "a", { team: 1 });
    playerIn(state, "b", { team: 9 });
    const players = toCombatPlayers(state, new Set(["a", "b"]), new Map(), newCombatMemory());
    expect(players.find((p) => p.sessionId === "a")!.team).toBe(1);
    expect(players.find((p) => p.sessionId === "b")!.team).toBe(0);
  });

  it("builds a fire state from the player's chassis on first sight", () => {
    const state = new ArenaState();
    const player = new PlayerState();
    player.carId = "rectangle";
    state.players.set("aaa", player);
    const memory = newCombatMemory();

    const players = toCombatPlayers(state, new Set(["aaa"]), new Map([["aaa", 0b001]]), memory);
    expect(players[0]!.fireState.slots.map((s) => s.weaponId)).toEqual(["cannon"]);
    expect(players[0]!.fireMask).toBe(0b001);
  });

  it("gives a chassis-less player (pre-reveal, carId \"\") an empty slot array", () => {
    const state = new ArenaState();
    playerIn(state, "aaa", { carId: "" });
    const players = toCombatPlayers(state, new Set(["aaa"]), new Map(), newCombatMemory());
    expect(players[0]!.fireState.slots).toEqual([]);
  });

  it("reuses the same fire state across calls when the chassis has not changed", () => {
    const state = new ArenaState();
    playerIn(state, "aaa");
    const memory = newCombatMemory();
    const first = toCombatPlayers(state, new Set(["aaa"]), new Map(), memory)[0]!.fireState;
    // Mutate memory the way applyCombatResult would, so reuse is genuinely observable: a rebuild
    // hands back a fresh single-stock slot with every clock at zero, and would lose all of this.
    memory.fireStates.set("aaa", {
      ...first,
      switchLockUntilTick: 77,
      lastFiredSlot: 0,
      slots: [{ ...first.slots[0]!, stocks: 0, rechargeEndsTick: 120 }],
    });
    const second = toCombatPlayers(state, new Set(["aaa"]), new Map(), memory)[0]!.fireState;
    expect(second.switchLockUntilTick).toBe(77);
    expect(second.lastFiredSlot).toBe(0);
    expect(second.slots[0]!.stocks).toBe(0);
    expect(second.slots[0]!.rechargeEndsTick).toBe(120);
  });

  it("re-reads level from the schema onto a reused fire state, so a level-up survives a tick", () => {
    // `applyCombatResult` writes `player.level = fireState.level` unconditionally. Reading the level
    // only on a rebuild would make a cached fire state overwrite the schema every tick, reverting
    // whatever a future level-up wrote (D14).
    const state = new ArenaState();
    const player = playerIn(state, "aaa");
    const memory = newCombatMemory();
    toCombatPlayers(state, new Set(["aaa"]), new Map(), memory);

    player.level = 2; // as levelling would write it, between two ticks
    const players = toCombatPlayers(state, new Set(["aaa"]), new Map(), memory);
    expect(players[0]!.fireState.level).toBe(2); // it reached the sim...
    applyCombatResult(state, result({ players }), memory);
    expect(player.level).toBe(2); // ...and the write-back did not revert it
  });

  it("rebuilds fire state when a player's chassis changes, including the reveal from \"\" to a real car", () => {
    const state = new ArenaState();
    const player = playerIn(state, "aaa", { carId: "" });
    const memory = newCombatMemory();
    const beforeReveal = toCombatPlayers(state, new Set(["aaa"]), new Map(), memory)[0]!.fireState;
    expect(beforeReveal.slots).toEqual([]);

    player.carId = "rectangle";
    const afterReveal = toCombatPlayers(state, new Set(["aaa"]), new Map(), memory)[0]!.fireState;
    expect(afterReveal.slots.map((s) => s.weaponId)).toEqual(["cannon"]);
  });
});

describe("toInstances", () => {
  it("projects the live instances out of memory, not the schema", () => {
    const memory = newCombatMemory();
    const live = liveInstance();
    memory.instances.set(live.id, live);
    expect(toInstances(memory)).toEqual([live]);
  });

  it("returns nothing when memory holds no instances", () => {
    expect(toInstances(newCombatMemory())).toEqual([]);
  });
});

describe("applyCombatResult", () => {
  function combatPlayerFor(player: PlayerState, over: Partial<CombatResult["players"][number]> = {}) {
    return {
      sessionId: player.sessionId,
      x: player.x,
      y: player.y,
      angle: player.angle,
      team: 0 as const,
      carId: player.carId,
      hp: player.hp,
      alive: player.alive,
      inRoster: true,
      fireMask: 0,
      fireState: newFireState(isCarId(player.carId) ? player.carId : "", 1),
      lock: newLockState(),
      ...over,
    };
  }

  it("writes hp and alive back onto the schema", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a");
    applyCombatResult(
      state,
      result({ players: [combatPlayerFor(player, { hp: 3, alive: false })] }),
      newCombatMemory(),
    );
    expect(player.hp).toBe(3);
    expect(player.alive).toBe(false);
  });

  it("leaves poses alone: driving owns them, combat never moves a car", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a", { x: 400, y: 150 });
    applyCombatResult(
      state,
      result({ players: [combatPlayerFor(player, { x: 999, y: 999 })] }),
      newCombatMemory(),
    );
    expect(player.x).toBe(400);
    expect(player.y).toBe(150);
  });

  it("ignores a player who left between the tick and the write-back", () => {
    const state = new ArenaState();
    const gone = new PlayerState();
    gone.sessionId = "gone";
    gone.carId = "rectangle";
    expect(() =>
      applyCombatResult(state, result({ players: [combatPlayerFor(gone)] }), newCombatMemory()),
    ).not.toThrow();
    expect(state.players.size).toBe(0);
  });

  it("writes slots back onto the player schema in order", () => {
    const state = new ArenaState();
    state.players.set("aaa", new PlayerState());
    const memory = newCombatMemory();
    applyCombatResult(
      state,
      {
        players: [
          {
            sessionId: "aaa",
            x: 0,
            y: 0,
            angle: 0,
            team: 0,
            carId: "rectangle",
            hp: 50,
            alive: true,
            inRoster: true,
            fireMask: 0,
            fireState: newFireState("rectangle", 1),
            lock: newLockState(),
          },
        ],
        instances: [],
        ramCooldowns: new Map(),
        instanceSeq: 0,
      },
      memory,
    );
    const player = state.players.get("aaa")!;
    expect(player.weapons.length).toBe(1);
    expect(player.weapons.at(0)!.weaponId).toBe("cannon");
    expect(player.weapons.at(0)!.stocks).toBe(1);
  });

  it("writes level and switchLockUntilTick from the fire state", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a");
    const fireState = { ...newFireState("rectangle", 1), level: 2, switchLockUntilTick: 42 };
    applyCombatResult(state, result({ players: [combatPlayerFor(player, { fireState })] }), newCombatMemory());
    expect(player.level).toBe(2);
    expect(player.switchLockUntilTick).toBe(42);
  });

  it("writes the two car-wide HUD fields: the pending's next shot tick and the last-fired slot", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a");
    const fireState = {
      ...newFireState("rectangle", 1),
      lastFiredSlot: 0,
      pending: { weaponId: "cannon" as const, slot: 0, shotsLeft: 2, nextShotTick: 205 },
    };
    applyCombatResult(state, result({ players: [combatPlayerFor(player, { fireState })] }), newCombatMemory());
    expect(player.pendingUntilTick).toBe(205);
    expect(player.lastFiredSlot).toBe(0);
  });

  it("zeroes pendingUntilTick when nothing is pending, so the HUD never sees a stale wind-up", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a", { pendingUntilTick: 205 });
    const fireState = { ...newFireState("rectangle", 1), lastFiredSlot: 0 };
    applyCombatResult(state, result({ players: [combatPlayerFor(player, { fireState })] }), newCombatMemory());
    expect(player.pendingUntilTick).toBe(0);
  });

  it("resizes the slot array down when a rebuilt fire state has fewer slots", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a");
    const memory = newCombatMemory();
    applyCombatResult(
      state,
      result({ players: [combatPlayerFor(player, { fireState: newFireState("rectangle", 1) })] }),
      memory,
    );
    expect(player.weapons.length).toBe(1);

    applyCombatResult(
      state,
      result({ players: [combatPlayerFor(player, { carId: "", fireState: newFireState("", 1) })] }),
      memory,
    );
    expect(player.weapons.length).toBe(0);
  });

  it("remembers the written-back fire state in memory, keyed by session id", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a");
    const fireState = newFireState("rectangle", 1);
    const memory = newCombatMemory();
    applyCombatResult(state, result({ players: [combatPlayerFor(player, { fireState })] }), memory);
    expect(memory.fireStates.get("a")).toBe(fireState);
  });

  it("adds a newly spawned instance to the schema", () => {
    const state = new ArenaState();
    applyCombatResult(state, result({ instances: [liveInstance({ id: "a-1" })] }), newCombatMemory());
    const added = state.weapons.get("a-1");
    expect(added).toBeDefined();
    expect(added!.ownerSessionId).toBe("aaa");
    expect(added!.x).toBe(100);
    expect(added!.spawnTick).toBe(90);
  });

  it("diffs instances by id rather than clearing and refilling", () => {
    const state = new ArenaState();
    const memory = newCombatMemory();
    const live = liveInstance();
    const combatResult = result({ instances: [live] });

    applyCombatResult(state, combatResult, memory);
    const first = state.weapons.get("aaa-1");
    applyCombatResult(state, { ...combatResult, instances: [{ ...live, x: 130 }] }, memory);

    expect(state.weapons.get("aaa-1")).toBe(first); // same object, patched — not replaced
    expect(state.weapons.get("aaa-1")!.x).toBe(130);
  });

  it("drops an instance the sim no longer reports", () => {
    const state = new ArenaState();
    const memory = newCombatMemory();
    const live = liveInstance();
    applyCombatResult(state, result({ instances: [live] }), memory);
    applyCombatResult(state, result({ instances: [] }), memory);
    expect(state.weapons.size).toBe(0);
    expect(memory.instances.size).toBe(0);
  });
});

describe("clearInstances", () => {
  it("empties the weapons map, and clears fire states and remembered instances", () => {
    const state = new ArenaState();
    const memory = newCombatMemory();
    applyCombatResult(state, result({ instances: [liveInstance({ id: "a-1" })] }), memory);
    memory.fireStates.set("a", newFireState("rectangle", 1));

    clearInstances(state, memory);

    expect(state.weapons.size).toBe(0);
    expect(memory.instances.size).toBe(0);
    expect(memory.fireStates.size).toBe(0);
  });

  it("is a no-op on an already empty state", () => {
    const state = new ArenaState();
    clearInstances(state, newCombatMemory());
    expect(state.weapons.size).toBe(0);
  });
});

describe("lock state across the bridge", () => {
  const aLock = {
    targetSessionId: "b",
    lockedAtTick: 7,
    losLostSinceTick: 3,
    lastPressTick: 9,
  };

  it("hands a player with no lock yet a fresh one", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    const memory = newCombatMemory();

    const players = toCombatPlayers(state, new Set(["a"]), new Map(), memory);

    expect(players[0]!.lock).toEqual(newLockState());
  });

  it("carries a lock forward between ticks instead of rebuilding it", () => {
    // Locks live in room memory, never on the schema. `lockedAtTick` and `losLostSinceTick` have no
    // wire representation, so rebuilding from `ArenaState` each tick would reset both timers and
    // neither the commit window nor the sight grace could ever elapse -- the lock would be
    // permanently stealable and permanently one tick from releasing on sight.
    const state = new ArenaState();
    playerIn(state, "a");
    const memory = newCombatMemory();
    memory.locks.set("a", { ...aLock });

    const players = toCombatPlayers(state, new Set(["a"]), new Map(), memory);

    expect(players[0]!.lock).toEqual(aLock);
  });

  it("writes only the target id onto the schema, keeping the machine in memory", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    const memory = newCombatMemory();
    const players = toCombatPlayers(state, new Set(["a"]), new Map(), memory);
    players[0]!.lock = { ...aLock };

    applyCombatResult(state, result({ players }), memory);

    expect(state.players.get("a")!.lockTargetSessionId).toBe("b");
    expect(memory.locks.get("a")).toEqual(aLock);
  });

  it("clears every lock when a match ends", () => {
    // The same rule that already stops a shot in flight carrying into the next match: nothing from
    // a previous match may survive into the next one.
    const state = new ArenaState();
    playerIn(state, "a");
    const memory = newCombatMemory();
    memory.locks.set("a", { ...aLock });

    clearInstances(state, memory);

    expect(memory.locks.size).toBe(0);
  });
});
