import { describe, expect, it } from "vitest";
import {
  ArenaState,
  PlayerState,
  hpOf,
  isCarId,
  newFireState,
  slotsOf,
  weaponDamageOf,
  TICK_RATE_HZ,
  type CombatPlayer,
  type CombatResult,
  type WeaponId,
  type WeaponInstance,
} from "@motor-combat-moba/shared";
import { respawnPlayer } from "../rooms/tick-pipeline.js";
import {
  applyCombatResult,
  clearInstances,
  forgetCombatPlayer,
  loadoutFor,
  newCombatMemory,
  toCombatPlayers,
  toInstances,
} from "./combat-bridge.js";
import { newContactMemory } from "./ram-bridge.js";

function playerIn(state: ArenaState, sessionId: string, over: Partial<PlayerState> = {}): PlayerState {
  const player = new PlayerState();
  player.sessionId = sessionId;
  player.x = 400;
  player.y = 150;
  player.angle = 0;
  player.carId = "mirage";
  player.hp = hpOf("mirage");
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
    finalWave: true,
    damage: weaponDamageOf("mirage", "magmablast"),
    weaponId: "magmablast",
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
    muzzleDir: 0,
    homingTargetId: "",
    homingUntilTick: 0,
    expiresAtTick: 0,
    ...over,
  };
}

function result(over: Partial<CombatResult> = {}): CombatResult {
  return {
    players: [],
    instances: [],
    instanceSeq: 0,
    ...over,
  };
}

describe("newCombatMemory", () => {
  it("starts empty: no fire states, no instances, a zero id counter", () => {
    const memory = newCombatMemory();
    expect(memory.instanceSeq).toBe(0);
    expect(memory.fireStates.size).toBe(0);
    expect(memory.instances.size).toBe(0);
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

  it("puts the aims map's value on aimBearing, and null when absent (TR24)", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    playerIn(state, "b");
    const players = toCombatPlayers(
      state,
      new Set(["a", "b"]),
      new Map(),
      newCombatMemory(),
      new Map([["b", 0.75]]),
    );
    expect(players.find((p) => p.sessionId === "a")!.aimBearing).toBeNull();
    expect(players.find((p) => p.sessionId === "b")!.aimBearing).toBe(0.75);
  });

  it("carries pose, chassis, and hp across", () => {
    const state = new ArenaState();
    playerIn(state, "a", { x: 12, y: 34, angle: 0.5, carId: "bullseye", hp: 7 });
    expect(toCombatPlayers(state, new Set(["a"]), new Map(), newCombatMemory())[0]).toMatchObject({
      x: 12,
      y: 34,
      angle: 0.5,
      carId: "bullseye",
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
    player.carId = "mirage";
    state.players.set("aaa", player);
    const memory = newCombatMemory();

    const players = toCombatPlayers(state, new Set(["aaa"]), new Map([["aaa", 0b001]]), memory);
    expect(players[0]!.fireState.slots.map((s) => s.weaponId)).toEqual([
      "basic-attack-mirage",
      "magmablast",
      "thunderclap",
      "afterburner",
    ]);
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
    // hands back fresh single-stock slots with every clock at zero, and would lose all of this.
    // The weapon-id sequence is left intact (still the mirage's three-slot kit) so the staleness
    // check in `toCombatPlayers` -- which compares slot weapon ids against the chassis's current
    // kit -- keeps calling this "unchanged" and reuses it instead of rebuilding it.
    memory.fireStates.set("aaa", {
      ...first,
      switchLockUntilTick: 77,
      lastFiredSlot: 0,
      slots: first.slots.map((slot, i) => (i === 0 ? { ...slot, stocks: 0, rechargeEndsTick: 120 } : slot)),
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

    player.carId = "mirage";
    const afterReveal = toCombatPlayers(state, new Set(["aaa"]), new Map(), memory)[0]!.fireState;
    expect(afterReveal.slots.map((s) => s.weaponId)).toEqual([
      "basic-attack-mirage",
      "magmablast",
      "thunderclap",
      "afterburner",
    ]);
  });
});

/**
 * `CombatMemory.loadouts` — the explicit per-player slot list the dev-only playground writes (PG17).
 * Empty in every real match, which is what keeps `ArenaRoom` on the chassis kit unchanged.
 */
describe("explicit loadouts", () => {
  const CUSTOM: readonly WeaponId[] = ["lance", "thumper", "magmablast"];

  it("loadoutFor prefers the explicit list and falls back to the chassis kit", () => {
    expect(loadoutFor("mirage", CUSTOM)).toEqual(["basic-attack-mirage", "lance", "thumper", "magmablast"]);
    expect(loadoutFor("mirage", undefined)).toEqual(["basic-attack-mirage", ...slotsOf("mirage")]);
    // The empty-carId fallback the pre-reveal path relies on is unchanged.
    expect(loadoutFor("", undefined)).toEqual([]);
  });

  it("resolves a loadout as the chassis's basic attack plus the kit (BA14, VS6)", () => {
    expect(loadoutFor("bastion", undefined)).toEqual([
      "basic-attack-bastion",
      "thumper",
      "roadblock",
      "wildcharge",
    ]);
    expect(loadoutFor("mirage", ["predator", "lance", "thumper"])).toEqual([
      "basic-attack-mirage",
      "predator",
      "lance",
      "thumper",
    ]);
  });

  it("builds a fire state from the explicit loadout rather than the chassis kit", () => {
    const state = new ArenaState();
    playerIn(state, "aaa");
    const memory = newCombatMemory();
    memory.loadouts.set("aaa", CUSTOM);

    const fireState = toCombatPlayers(state, new Set(["aaa"]), new Map(), memory)[0]!.fireState;
    expect(fireState.slots.map((s) => s.weaponId)).toEqual([
      "basic-attack-mirage",
      "lance",
      "thumper",
      "magmablast",
    ]);
  });

  it("does not call a fire state stale while it matches the explicit loadout, so it survives a tick", () => {
    // The staleness test compares the running slots against what the car is SUPPOSED to carry. Ask
    // the chassis kit instead of this map and a custom loadout is rebuilt away on the very next tick,
    // which is a silent revert rather than a failure.
    const state = new ArenaState();
    playerIn(state, "aaa");
    const memory = newCombatMemory();
    memory.loadouts.set("aaa", CUSTOM);

    const first = toCombatPlayers(state, new Set(["aaa"]), new Map(), memory)[0]!.fireState;
    memory.fireStates.set("aaa", { ...first, switchLockUntilTick: 77 });

    const second = toCombatPlayers(state, new Set(["aaa"]), new Map(), memory)[0]!.fireState;
    expect(second.slots.map((s) => s.weaponId)).toEqual([
      "basic-attack-mirage",
      "lance",
      "thumper",
      "magmablast",
    ]);
    expect(second.switchLockUntilTick).toBe(77); // reused, not rebuilt
  });

  it("a playground loadout survives death: respawn restores it, not the chassis kit", () => {
    const state = new ArenaState();
    const player = playerIn(state, "aaa", { alive: false, hp: 0 });
    const memory = newCombatMemory();
    memory.loadouts.set("aaa", CUSTOM);

    respawnPlayer(
      {
        state,
        inputQueues: new Map(),
        prevFireMasks: new Map(),
        silentTicks: new Map(),
        matchRoster: new Set(["aaa"]),
        phaseCaps: new Map(),
        combat: memory,
        ram: newContactMemory(),
        hz: TICK_RATE_HZ,
        runPhaseSweep: true,
      },
      player,
    );

    expect(memory.fireStates.get("aaa")!.slots.map((s) => s.weaponId)).toEqual([
      "basic-attack-mirage",
      "lance",
      "thumper",
      "magmablast",
    ]);
    // And the rest of the respawn is unchanged: full hp for the chassis, back on the field.
    expect(player.hp).toBe(hpOf("mirage"));
    expect(player.alive).toBe(true);
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
      statuses: [],
      maneuver: 0,
      maneuverTicksLeft: 0,
      maneuverAngle: 0,
      maneuverSpeed: 0,
      maneuverWeaponId: "" as const,
      maneuverPressId: "",
      lastDamagerSessionId: "",
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
    gone.carId = "mirage";
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
            carId: "mirage",
            hp: 50,
            alive: true,
            inRoster: true,
            fireMask: 0,
            fireState: newFireState("mirage", 1),
            statuses: [],
            maneuver: 0,
            maneuverTicksLeft: 0,
            maneuverAngle: 0,
            maneuverSpeed: 0,
            maneuverWeaponId: "" as const,
            maneuverPressId: "",
            lastDamagerSessionId: "",
          },
        ],
        instances: [],
        instanceSeq: 0,
      },
      memory,
    );
    const player = state.players.get("aaa")!;
    expect(player.weapons.length).toBe(4);
    expect(player.weapons.at(0)!.weaponId).toBe("basic-attack-mirage");
    expect(player.weapons.at(1)!.weaponId).toBe("magmablast");
    expect(player.weapons.at(2)!.weaponId).toBe("thunderclap");
    expect(player.weapons.at(3)!.weaponId).toBe("afterburner");
    expect(player.weapons.at(0)!.stocks).toBe(1);
  });

  it("writes level and switchLockUntilTick from the fire state", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a");
    const fireState = { ...newFireState("mirage", 1), level: 2, switchLockUntilTick: 42 };
    applyCombatResult(state, result({ players: [combatPlayerFor(player, { fireState })] }), newCombatMemory());
    expect(player.level).toBe(2);
    expect(player.switchLockUntilTick).toBe(42);
  });

  it("writes the two car-wide HUD fields: the pending's next shot tick and the last-fired slot", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a");
    const fireState = {
      ...newFireState("mirage", 1),
      lastFiredSlot: 0,
      pending: { weaponId: "predator" as const, slot: 0, shotsLeft: 2, nextShotTick: 205, pressId: "a#205#0" },
    };
    applyCombatResult(state, result({ players: [combatPlayerFor(player, { fireState })] }), newCombatMemory());
    expect(player.pendingUntilTick).toBe(205);
    expect(player.lastFiredSlot).toBe(0);
  });

  it("zeroes pendingUntilTick when nothing is pending, so the HUD never sees a stale wind-up", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a", { pendingUntilTick: 205 });
    const fireState = { ...newFireState("mirage", 1), lastFiredSlot: 0 };
    applyCombatResult(state, result({ players: [combatPlayerFor(player, { fireState })] }), newCombatMemory());
    expect(player.pendingUntilTick).toBe(0);
  });

  it("mirrors the fire state's turretAngle onto the schema (TR10)", () => {
    const state = new ArenaState();
    const player = playerIn(state, "a");
    const fireState = { ...newFireState("mirage", 1), turretAngle: 0.4 };
    applyCombatResult(state, result({ players: [combatPlayerFor(player, { fireState })] }), newCombatMemory());
    expect(player.turretAngle).toBe(0.4);
  });

  it("holds pendingUntilTick at tick + 1 while the turret is still turning, since +Infinity cannot ride a uint32 (TR17)", () => {
    const state = new ArenaState();
    state.tick = 500;
    const player = playerIn(state, "a");
    const fireState = {
      ...newFireState("mirage", 1),
      pending: {
        weaponId: "magmablast" as const,
        slot: 1,
        shotsLeft: 1,
        pressId: "a#500#1",
        bearing: 0.2,
        aligned: false,
        nextShotTick: Number.POSITIVE_INFINITY,
      },
    };
    applyCombatResult(state, result({ players: [combatPlayerFor(player, { fireState })] }), newCombatMemory());
    expect(player.pendingUntilTick).toBe(state.tick + 1);
  });

  it("resizes the slot array down when a rebuilt fire state has fewer slots", () => {
    // Every chassis now carries the same three-slot kit plus its basic attack, so no pair of real
    // chassis differs in slot count -- the only real transition that shrinks the array is the reveal
    // in reverse (a real chassis losing its car, i.e. `carId` going back to ""), which is what this
    // drives. That still exercises the exact mechanism under test: `writeSlots`'s `while
    // (weapons.length > fireState.slots.length) weapons.pop()` loop does not special-case a zero
    // target, it just pops until the lengths match, so shrinking 4 -> 0 pops four times and proves
    // the loop actually loops, which the old single-pop 1 -> 0 case did not.
    const state = new ArenaState();
    const player = playerIn(state, "a");
    const memory = newCombatMemory();
    applyCombatResult(
      state,
      result({ players: [combatPlayerFor(player, { fireState: newFireState("mirage", 1) })] }),
      memory,
    );
    expect(player.weapons.length).toBe(4);

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
    const fireState = newFireState("mirage", 1);
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

describe("maneuver fields across the bridge", () => {
  it("round-trips maneuver fields through toCombatPlayers/applyCombatResult", () => {
    const state = new ArenaState();
    playerIn(state, "p1");
    const memory = newCombatMemory();
    const roster = new Set(["p1"]);
    const player = state.players.get("p1")!;

    player.maneuver = 3;
    player.maneuverTicksLeft = 250;
    memory.maneuverWeapons.set("p1", "thunderclap");
    memory.maneuverPressIds.set("p1", "p1#7#2");
    const combat = toCombatPlayers(state, roster, new Map(), memory);
    const p = combat.find((c) => c.sessionId === "p1")!;
    expect(p.maneuver).toBe(3);
    expect(p.maneuverWeaponId).toBe("thunderclap");
    expect(p.maneuverPressId).toBe("p1#7#2");

    p.maneuver = 0;
    p.maneuverTicksLeft = 0;
    p.maneuverWeaponId = "";
    p.maneuverPressId = "";
    applyCombatResult(state, { players: combat, instances: [], instanceSeq: 0 }, memory);
    expect(player.maneuver).toBe(0);
    expect(memory.maneuverWeapons.get("p1")).toBe("");
    expect(memory.maneuverPressIds.get("p1")).toBe("");
  });
});

describe("clearInstances", () => {
  it("empties the weapons map, and clears fire states and remembered instances", () => {
    const state = new ArenaState();
    const memory = newCombatMemory();
    applyCombatResult(state, result({ instances: [liveInstance({ id: "a-1" })] }), memory);
    memory.fireStates.set("a", newFireState("mirage", 1));

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

describe("kill booking", () => {
  /** One entry of a `CombatResult`, matching the schema player `playerIn` created. */
  const combatant = (sessionId: string, over: Partial<CombatPlayer> = {}): CombatPlayer => ({
    sessionId,
    x: 400, y: 150, angle: 0,
    team: 0,
    carId: "mirage",
    hp: hpOf("mirage"),
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState: newFireState("mirage", 1),
    statuses: [],
    lastDamagerSessionId: "",
    ...over,
  });

  it("credits the killer and charges the victim on the death transition only", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    playerIn(state, "b");
    const memory = newCombatMemory();
    const wreck: CombatResult = {
      players: [
        combatant("a"),
        combatant("b", { hp: 0, alive: false, lastDamagerSessionId: "a" }),
      ],
      instances: [],
      instanceSeq: 0,
    };

    applyCombatResult(state, wreck, memory);
    expect(state.players.get("a")!.kills).toBe(1);
    expect(state.players.get("b")!.deaths).toBe(1);
    expect(state.players.get("b")!.killedBySessionId).toBe("a");

    // Still dead on the next tick. The score must not tick up for every tick spent as a wreck.
    applyCombatResult(state, wreck, memory);
    expect(state.players.get("a")!.kills).toBe(1);
    expect(state.players.get("b")!.deaths).toBe(1);
  });

  it("still records the killer's id when the killer has left the room", () => {
    const state = new ArenaState();
    playerIn(state, "b");
    applyCombatResult(
      state,
      {
        players: [combatant("b", { hp: 0, alive: false, lastDamagerSessionId: "gone" })],
        instances: [],
        instanceSeq: 0,
      },
      newCombatMemory(),
    );
    expect(state.players.get("b")!.deaths).toBe(1);
    expect(state.players.get("b")!.killedBySessionId).toBe("gone");
  });

  it("never credits a car for killing itself", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    applyCombatResult(
      state,
      {
        players: [combatant("a", { hp: 0, alive: false, lastDamagerSessionId: "a" })],
        instances: [],
        instanceSeq: 0,
      },
      newCombatMemory(),
    );
    expect(state.players.get("a")!.kills).toBe(0);
    expect(state.players.get("a")!.deaths).toBe(1);
  });
});

describe("forgetCombatPlayer (PG67)", () => {
  it("drops every session-keyed map entry for one player and leaves the others", () => {
    const memory = newCombatMemory();
    for (const id of ["pg-0", "pg-1"]) {
      memory.fireStates.set(id, newFireState("mirage", 3));
      memory.maneuverWeapons.set(id, "thunderclap");
      memory.maneuverPressIds.set(id, `${id}-press`);
      memory.lastDamagers.set(id, "someone");
      memory.loadouts.set(id, ["magmablast", "thunderclap", "afterburner"]);
    }

    forgetCombatPlayer(memory, "pg-0");

    expect(memory.fireStates.has("pg-0")).toBe(false);
    expect(memory.maneuverWeapons.has("pg-0")).toBe(false);
    expect(memory.maneuverPressIds.has("pg-0")).toBe(false);
    expect(memory.lastDamagers.has("pg-0")).toBe(false);
    expect(memory.loadouts.has("pg-0")).toBe(false);

    // The other seat is untouched: removing one car must not reset the rest of the field.
    expect(memory.fireStates.has("pg-1")).toBe(true);
    expect(memory.loadouts.get("pg-1")).toEqual(["magmablast", "thunderclap", "afterburner"]);
  });

  it("is a no-op for a session it has never seen", () => {
    const memory = newCombatMemory();
    memory.loadouts.set("pg-1", ["predator", "pepperbox", "lance"]);
    expect(() => forgetCombatPlayer(memory, "pg-4")).not.toThrow();
    expect(memory.loadouts.size).toBe(1);
  });
});
