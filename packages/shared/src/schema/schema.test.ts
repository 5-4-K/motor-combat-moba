import { describe, expect, it } from "vitest";
import { Encoder, Reflection, StateView } from "@colyseus/schema";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { DEFAULT_GAME_MODE } from "../modes/registry.js";
import { WeaponKind } from "../constants.js";
import { ArenaState } from "./ArenaState.js";
import { StatusState } from "./StatusState.js";
import { PlayerState } from "./PlayerState.js";
import { WeaponInstanceState } from "./WeaponInstanceState.js";
import { WeaponSlotState } from "./WeaponSlotState.js";
import { ChatMessageState } from "./ChatMessageState.js";
import { VIEW_OWNER } from "./view-tags.js";

describe("PlayerState", () => {
  it("constructs with P0 fields and v1 defaults", () => {
    const p = new PlayerState();
    expect(p.sessionId).toBe("");
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.angle).toBe(0);
    expect(p.status).toBe(0);
    expect(p.ackRepeated).toBe(false);
    expect(p.inputSlack).toBe(0);
    expect(p.inputSlackStd).toBe(0);
    expect(p.name).toBe("");
    expect(p.colorId).toBe(0);
    expect(p.team).toBe(0);
    expect(p.joinedAtTick).toBe(0);
    expect(p.carId).toBe("");
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
    expect(p.angVel).toBe(0);
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
    p.vx = 180;
    p.vy = -40;
    p.hp = 50;
    p.alive = false;
    p.selectLocked = true;
    expect(p.name).toBe("Ada");
    expect(p.colorId).toBe(3);
    expect(p.team).toBe(1);
    expect(p.joinedAtTick).toBe(42);
    expect(p.carId).toBe("bullseye");
    expect(p.vx).toBe(180);
    expect(p.vy).toBe(-40);
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
    expect(s.mode).toBe(DEFAULT_GAME_MODE);
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

  it("defaults isExplosion to false", () => {
    expect(new WeaponInstanceState().isExplosion).toBe(false);
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

describe("chat schema (LC11)", () => {
  it("constructs a message row with empty defaults", () => {
    const m = new ChatMessageState();
    expect(m.seq).toBe(0);
    expect(m.sessionId).toBe("");
    expect(m.name).toBe("");
    expect(m.colorId).toBe(0);
    expect(m.text).toBe("");
    expect(m.at).toBe("");
  });

  it("ArenaState opens with an empty chat buffer", () => {
    const state = new ArenaState();
    expect(state.chat.length).toBe(0);
  });

  it("ArenaState.chat accepts message rows", () => {
    const state = new ArenaState();
    const m = new ChatMessageState();
    m.text = "gl hf";
    state.chat.push(m);
    expect(state.chat.length).toBe(1);
    expect(state.chat[0].text).toBe("gl hf");
  });
});

describe("view tags (NR42, NR43)", () => {
  /**
   * Encodes `state` the way the Colyseus serializer does for one client with a `StateView` (shared
   * pass, then that view's pass) and decodes it into a fresh reflected state — the client's copy.
   */
  function decodeFor(state: ArenaState, build: (v: StateView) => void): ArenaState {
    const enc = new Encoder(state);
    const dec = Reflection.decode<ArenaState>(Reflection.encode(enc));
    const view = new StateView();
    build(view);
    const it = { offset: 0 };
    const shared = enc.encodeAll(it);
    const buf = new Uint8Array(64 * 1024);
    buf.set(shared.slice(0, it.offset));
    dec.decode(enc.encodeAllView(view, it.offset, { ...it }, buf));
    return dec.state;
  }

  function player(id: string): PlayerState {
    const p = new PlayerState();
    p.sessionId = id;
    p.name = id;
    p.colorId = 2;
    p.team = 1;
    p.status = 3;
    p.joinedAtTick = 7;
    p.carId = "mirage";
    p.selectLocked = true;
    p.lockedCarId = "mirage";
    p.alive = true;
    p.diedAtTick = 11;
    p.kills = 4;
    p.deaths = 5;
    p.killedBySessionId = "z";
    p.level = 2;
    p.x = 100;
    p.y = 200;
    p.angle = 1;
    p.vx = 3;
    p.vy = 4;
    p.angVel = 0.5;
    p.maneuver = 1;
    p.maneuverTicksLeft = 9;
    p.maneuverAngle = 0.25;
    p.maneuverSpeed = 300;
    p.hp = 90;
    p.turretAngle = 0.75;
    p.lastFiredSlot = 1;
    p.lastSteer = -1;
    p.lastThrottle = 1;
    p.switchLockUntilTick = 21;
    p.pendingUntilTick = 22;
    p.ackRepeated = true;
    p.inputSlack = 1.5;
    p.inputSlackStd = 0.5;
    const slot = new WeaponSlotState();
    slot.weaponId = "predator";
    slot.stocks = 3;
    slot.rechargeEndsTick = 31;
    slot.refireLockUntilTick = 32;
    p.weapons.push(slot);
    const status = new StatusState();
    status.statusId = "reeling";
    status.startTick = 1;
    status.endsTick = 2;
    p.statuses.push(status);
    return p;
  }

  function shot(id: string, owner: string): WeaponInstanceState {
    const w = new WeaponInstanceState();
    w.id = id;
    w.ownerSessionId = owner;
    w.weaponId = "predator";
    w.x = 5;
    return w;
  }

  /** NR42's public list: what every client reads for every player, in or out of its view. */
  const PUBLIC: Record<string, unknown> = {
    sessionId: "b",
    name: "b",
    colorId: 2,
    team: 1,
    status: 3,
    joinedAtTick: 7,
    carId: "mirage",
    selectLocked: true,
    lockedCarId: "mirage",
    alive: true,
    diedAtTick: 11,
    kills: 4,
    deaths: 5,
    killedBySessionId: "z",
    level: 2,
  };
  /** NR42's `@view()` list, scalar fields (`statuses` is checked separately). */
  const VISIBLE: Record<string, unknown> = {
    x: 100,
    y: 200,
    angle: 1,
    vx: 3,
    vy: 4,
    angVel: 0.5,
    maneuver: 1,
    maneuverTicksLeft: 9,
    maneuverAngle: 0.25,
    maneuverSpeed: 300,
    hp: 90,
    turretAngle: 0.75,
    pendingUntilTick: 22,
    lastFiredSlot: 1,
    lastSteer: -1,
    lastThrottle: 1,
    inView: true,
  };
  /**
   * NR42's `@view(VIEW_OWNER)` list on the player itself (plus `inputSlackStd`, Phase D; minus
   * `pendingUntilTick`, which the charge-orb telegraph needs on every visible car).
   */
  const OWNER: Record<string, unknown> = {
    switchLockUntilTick: 21,
    ackRepeated: true,
    inputSlack: 1.5,
    inputSlackStd: 0.5,
  };

  function stateOfThree(): { s: ArenaState; a: PlayerState; b: PlayerState; c: PlayerState } {
    const s = new ArenaState();
    const a = player("a");
    const b = player("b");
    const c = player("c");
    s.players.set("a", a);
    s.players.set("b", b);
    s.players.set("c", c);
    s.weapons.set("w1", shot("w1", "a"));
    s.weapons.set("w2", shot("w2", "b"));
    s.weapons.set("w3", shot("w3", "c"));
    return { s, a, b, c };
  }

  it("a player outside the view shows scoreboard facts only", () => {
    const { s, a, b } = stateOfThree();
    const seen = decodeFor(s, (v) => {
      v.add(a, VIEW_OWNER);
      v.add(b);
    });
    const c = seen.players.get("c")!;
    for (const [key, value] of Object.entries(PUBLIC)) {
      expect(c[key as keyof PlayerState], key).toEqual(key === "sessionId" || key === "name" ? "c" : value);
    }
    for (const key of [...Object.keys(VISIBLE), ...Object.keys(OWNER)]) {
      expect(c[key as keyof PlayerState], key).toBeUndefined();
    }
    expect(c.statuses).toBeUndefined();
    // The loadout is public (car select shows it); the slot timers are not.
    expect(c.weapons.length).toBe(1);
    expect(c.weapons[0]!.weaponId).toBe("predator");
    expect(c.weapons[0]!.stocks).toBeUndefined();
    expect(c.weapons[0]!.rechargeEndsTick).toBeUndefined();
    expect(c.weapons[0]!.refireLockUntilTick).toBeUndefined();
  });

  it("a player in the view shows its car but not its owner-only fields", () => {
    const { s, a, b } = stateOfThree();
    const seen = decodeFor(s, (v) => {
      v.add(a, VIEW_OWNER);
      v.add(b);
    });
    const p = seen.players.get("b")!;
    for (const [key, value] of Object.entries(PUBLIC)) expect(p[key as keyof PlayerState], key).toEqual(value);
    for (const [key, value] of Object.entries(VISIBLE)) expect(p[key as keyof PlayerState], key).toEqual(value);
    for (const key of Object.keys(OWNER)) expect(p[key as keyof PlayerState], key).toBeUndefined();
    expect(p.statuses.length).toBe(1);
    expect(p.statuses[0]!.statusId).toBe("reeling");
    expect(p.statuses[0]!.endsTick).toBe(2);
    expect(p.weapons[0]!.weaponId).toBe("predator");
    expect(p.weapons[0]!.stocks).toBeUndefined();
    expect(p.weapons[0]!.rechargeEndsTick).toBeUndefined();
    expect(p.weapons[0]!.refireLockUntilTick).toBeUndefined();
  });

  it("the owner tag reaches the owner-only fields and the slot timers", () => {
    const { s, a, b } = stateOfThree();
    const seen = decodeFor(s, (v) => {
      v.add(a, VIEW_OWNER);
      v.add(b);
    });
    const p = seen.players.get("a")!;
    for (const [key, value] of Object.entries(VISIBLE)) expect(p[key as keyof PlayerState], key).toEqual(value);
    for (const [key, value] of Object.entries(OWNER)) expect(p[key as keyof PlayerState], key).toEqual(value);
    expect(p.weapons[0]!.weaponId).toBe("predator");
    expect(p.weapons[0]!.stocks).toBe(3);
    expect(p.weapons[0]!.rechargeEndsTick).toBe(31);
    expect(p.weapons[0]!.refireLockUntilTick).toBe(32);
  });

  it("delivers only the weapon instances added to the view", () => {
    const { s, a, b } = stateOfThree();
    const seen = decodeFor(s, (v) => {
      v.add(a, VIEW_OWNER);
      v.add(b);
      v.add(s.weapons.get("w1")!);
      v.add(s.weapons.get("w2")!);
    });
    expect([...seen.weapons.keys()].sort()).toEqual(["w1", "w2"]);
    expect(seen.weapons.get("w1")!.ownerSessionId).toBe("a");
    expect(seen.weapons.get("w1")!.x).toBe(5);
  });

  it("a client with an empty view receives no tagged field and no instance", () => {
    const { s } = stateOfThree();
    const seen = decodeFor(s, () => {});
    // The map itself is a `@view()` field: a client whose view never added it has no map at all.
    expect(seen.weapons).toBeUndefined();
    seen.players.forEach((p) => {
      expect(p.name).toBe(p.sessionId);
      expect(p.x).toBeUndefined();
      expect(p.hp).toBeUndefined();
      expect(p.inView).toBeUndefined();
      expect(p.inputSlack).toBeUndefined();
    });
    // ArenaState's own fields are all public.
    expect(seen.tick).toBe(0);
    expect(seen.chat.length).toBe(0);
  });

  it("a view holding the map but none of its rows shows an empty map", () => {
    const s = new ArenaState();
    const a = player("a");
    s.players.set("a", a);
    const seen = decodeFor(s, (v) => {
      v.add(a, VIEW_OWNER);
      v.add(s.weapons);
    });
    expect(seen.weapons.size).toBe(0);
  });

  it("inView is always true on the server", () => {
    expect(new PlayerState().inView).toBe(true);
  });

  it("narrows pose, velocity, maneuver and turret to float32 on the wire only (NR52)", () => {
    const s = new ArenaState();
    const a = new PlayerState();
    a.sessionId = "a";
    const third = 1 / 3;
    const keys = ["x", "y", "angle", "vx", "vy", "angVel", "maneuverAngle", "maneuverSpeed", "turretAngle"] as const;
    for (const key of keys) a[key] = third + 100;
    s.players.set("a", a);
    const seen = decodeFor(s, (v) => v.add(a, VIEW_OWNER));
    for (const key of keys) {
      expect(seen.players.get("a")![key], key).toBe(Math.fround(third + 100));
      expect(a[key], key).toBe(third + 100); // the server keeps full precision
    }
  });
});
