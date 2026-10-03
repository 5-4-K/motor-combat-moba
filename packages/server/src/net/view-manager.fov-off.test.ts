import { describe, expect, it } from "vitest";
import { Encoder, Reflection, type StateView } from "@colyseus/schema";
import {
  ArenaState,
  GameMode,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  StatusState,
  WeaponInstanceState,
  WeaponSlotState,
  assembleModeConfig,
  modeConfigOf,
  withMode,
  type ModeConfig,
  type SpectateTarget,
} from "@motor-combat-moba/shared";
import { ViewManager, ensureView, viewersOf, type ViewClient } from "./view-manager.js";

/** A shipped (FOV-off) bundle with its spectate target replaced. */
function bundle(spectate: SpectateTarget): ModeConfig {
  const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
  expect(base.camera.fov.enabled).toBe(false);
  return assembleModeConfig(GameMode.FFA_LAST_STANDING, {
    ...base,
    camera: { ...base.camera, spectate: { ...base.camera.spectate, target: spectate } },
  });
}

/**
 * The G2 full-visibility rules, now run through `ViewManager` with FOV off (every shipped mode):
 * every car and instance in every view, owner-only fields to the owner, nested rows delivered.
 *
 * A two-client room over the real encoder, shaped like Colyseus's `SchemaSerializer`: a joiner
 * decodes `encodeAll` + `encodeAllView(view)`, then every patch is the shared `encode` plus
 * `encodeView(view)`. `sync` runs where the rooms run it — at join and before each patch.
 */
function room(
  owned: (c: ViewClient) => string | undefined = (c) => c.sessionId,
  spectate: SpectateTarget = "anyone",
) {
  const state = new ArenaState();
  const enc = new Encoder(state);
  const clients: (ViewClient & { decoded: ArenaState })[] = [];
  const vm = new ViewManager();
  const config = bundle(spectate);
  const sync = () => withMode(config, () => vm.update(state, viewersOf(clients, owned), state.tick));
  return {
    state,
    clients,
    sync,
    join(sessionId: string, car = true) {
      if (car) {
        const p = new PlayerState();
        p.sessionId = sessionId;
        p.name = sessionId;
        p.x = 10;
        p.hp = 100;
        p.inputSlack = 1.5;
        state.players.set(sessionId, p);
      }
      const dec = Reflection.decode<ArenaState>(Reflection.encode(enc));
      const client = { sessionId, decoded: dec.state, dec };
      ensureView(client);
      clients.push(client);
      sync();
      const it = { offset: 0 };
      const shared = enc.encodeAll(it);
      const buf = new Uint8Array(64 * 1024);
      buf.set(shared.slice(0, it.offset));
      dec.decode(enc.encodeAllView(client.view as StateView, it.offset, { ...it }, buf));
      return client;
    },
    patch() {
      sync();
      const it = { offset: 0 };
      enc.encode(it);
      const sharedOffset = it.offset;
      for (const c of clients) {
        const local = { offset: sharedOffset };
        (c as unknown as { dec: { decode(b: Uint8Array): void } }).dec.decode(
          enc.encodeView(c.view as StateView, sharedOffset, local),
        );
      }
      enc.discardChanges();
    },
  };
}

function shot(id: string, owner: string, alive = true): WeaponInstanceState {
  const w = new WeaponInstanceState();
  w.id = id;
  w.ownerSessionId = owner;
  w.weaponId = "predator";
  w.x = 7;
  w.alive = alive;
  return w;
}

describe("ViewManager with FOV off (G2's full views)", () => {
  it("gives every client every car, and the owner-only fields of its own car alone", () => {
    const r = room();
    const a = r.join("a");
    r.patch();
    const b = r.join("b");
    r.patch();
    for (const c of [a, b]) {
      for (const id of ["a", "b"]) {
        const p = c.decoded.players.get(id)!;
        expect(p.x, `${c.sessionId} sees ${id}.x`).toBe(10);
        expect(p.hp).toBe(100);
        expect(p.inView).toBe(true);
        expect(p.inputSlack).toBe(id === c.sessionId ? 1.5 : undefined);
      }
    }
  });

  it("gives a client an empty instance map before any shot exists", () => {
    const r = room();
    const a = r.join("a");
    expect(a.decoded.weapons.size).toBe(0);
  });

  it("delivers instances created after join, ended rows included, and drops deleted ones", () => {
    const r = room();
    const a = r.join("a");
    const b = r.join("b");
    r.state.weapons.set("1", shot("1", "a"));
    r.state.weapons.set("2", shot("2", "b", false));
    r.patch();
    for (const c of [a, b]) {
      expect([...c.decoded.weapons.keys()].sort()).toEqual(["1", "2"]);
      expect(c.decoded.weapons.get("1")!.x).toBe(7);
      expect(c.decoded.weapons.get("2")!.alive).toBe(false);
    }
    r.state.weapons.delete("1");
    r.patch();
    for (const c of [a, b]) expect([...c.decoded.weapons.keys()]).toEqual(["2"]);
  });

  it("delivers a status row pushed after join to every client", () => {
    const r = room();
    const a = r.join("a");
    const b = r.join("b");
    const row = new StatusState();
    row.statusId = "reeling";
    row.endsTick = 40;
    r.state.players.get("b")!.statuses.push(row);
    r.patch();
    for (const c of [a, b]) {
      const statuses = c.decoded.players.get("b")!.statuses;
      expect(statuses.length).toBe(1);
      expect(statuses[0]!.statusId).toBe("reeling");
      expect(statuses[0]!.endsTick).toBe(40);
    }
  });

  it("carries a slot pushed after join to everyone, and its timers to its owner alone", () => {
    const r = room();
    const a = r.join("a");
    const b = r.join("b");
    const slot = new WeaponSlotState();
    slot.weaponId = "predator";
    slot.stocks = 3;
    slot.rechargeEndsTick = 50;
    r.state.players.get("a")!.weapons.push(slot);
    r.patch();
    expect(a.decoded.players.get("a")!.weapons[0]!.stocks).toBe(3);
    expect(a.decoded.players.get("a")!.weapons[0]!.rechargeEndsTick).toBe(50);
    expect(b.decoded.players.get("a")!.weapons[0]!.weaponId).toBe("predator");
    expect(b.decoded.players.get("a")!.weapons[0]!.stocks).toBeUndefined();
    slot.stocks = 2;
    r.patch();
    expect(a.decoded.players.get("a")!.weapons[0]!.stocks).toBe(2);
    expect(b.decoded.players.get("a")!.weapons[0]!.stocks).toBeUndefined();
  });

  it("moves the owner tag with the driven seat (the playground's human client)", () => {
    let driven = "pg-0";
    const r = room(() => driven);
    for (const id of ["pg-0", "pg-1"]) {
      const p = new PlayerState();
      p.sessionId = id;
      p.inputSlack = 2;
      const slot = new WeaponSlotState();
      slot.weaponId = "predator";
      slot.stocks = 3;
      p.weapons.push(slot);
      r.state.players.set(id, p);
    }
    const human = r.join("human", false);
    expect(human.decoded.players.get("pg-0")!.inputSlack).toBe(2);
    expect(human.decoded.players.get("pg-1")!.inputSlack).toBeUndefined();
    driven = "pg-1";
    r.patch();
    expect(human.decoded.players.get("pg-1")!.inputSlack).toBe(2);
    expect(human.decoded.players.get("pg-1")!.weapons[0]!.stocks).toBe(3);
    expect(human.decoded.players.get("pg-0")!.inputSlack).toBeUndefined();
    expect(human.decoded.players.get("pg-0")!.weapons[0]!.stocks).toBeUndefined();
    expect(human.decoded.players.get("pg-0")!.x).toBe(0); // still a visible car
  });

  it("re-syncing an unchanged state sends nothing new", () => {
    const r = room();
    const a = r.join("a");
    r.patch();
    r.sync();
    expect((a.view as StateView).changes.size).toBe(0);
  });

  describe("a spectating wreck (G2 fix round 1, I2; narrowed to the exact target in G3)", () => {
    /** A live match: `a` the viewer, `x` and `y` two other cars, each with one slot and timers. */
    function match(spectate: SpectateTarget = "anyone") {
      const r = room((c) => c.sessionId, spectate);
      r.state.phase = RoomPhase.MATCH;
      for (const id of ["x", "y"]) {
        const p = new PlayerState();
        p.sessionId = id;
        p.name = id;
        p.status = PlayerStatus.IN_MATCH;
        p.x = 300;
        p.switchLockUntilTick = 70;
        const slot = new WeaponSlotState();
        slot.weaponId = "predator";
        slot.stocks = 2;
        slot.rechargeEndsTick = 80;
        p.weapons.push(slot);
        r.state.players.set(id, p);
      }
      const a = r.join("a");
      r.state.players.get("a")!.status = PlayerStatus.IN_MATCH;
      r.patch();
      return { r, a };
    }
    const timers = (c: { decoded: ArenaState }, id: string) => {
      const p = c.decoded.players.get(id)!;
      return {
        stocks: p.weapons[0]!.stocks,
        rechargeEndsTick: p.weapons[0]!.rechargeEndsTick,
        switchLockUntilTick: p.switchLockUntilTick,
      };
    };
    const SET = { stocks: 2, rechargeEndsTick: 80, switchLockUntilTick: 70 };
    const UNSET = { stocks: undefined, rechargeEndsTick: undefined, switchLockUntilTick: undefined };

    it("a living player reads no other car's timers", () => {
      const { a } = match();
      expect(timers(a, "x")).toEqual(UNSET);
      expect(timers(a, "y")).toEqual(UNSET);
    });

    it("reads the watched car's timers, and follows the target from X to Y", () => {
      const { r, a } = match();
      r.state.players.get("y")!.alive = false; // only X is watchable
      r.state.players.get("a")!.alive = false; // a is wrecked: spectating X
      r.patch();
      expect(timers(a, "x")).toEqual(SET);
      expect(timers(a, "y")).toEqual(UNSET);

      // X dies and Y comes back: `resolveSpectateTarget` falls to Y.
      r.state.players.get("x")!.alive = false;
      r.state.players.get("y")!.alive = true;
      r.patch();
      expect(timers(a, "y")).toEqual(SET);
      expect(timers(a, "x")).toEqual(UNSET);
      // Dropping the owner tag leaves X's public and `@view()` fields where they were: no flicker.
      const x = a.decoded.players.get("x")!;
      expect(x.name).toBe("x");
      expect(x.x).toBe(300);
      expect(x.inView).toBe(true);
      expect(x.weapons[0]!.weaponId).toBe("predator");

      // Later timer changes reach the wreck for the car it watches, never for the one it left.
      r.state.players.get("y")!.weapons[0]!.stocks = 1;
      r.state.players.get("x")!.weapons[0]!.stocks = 0;
      r.patch();
      expect(timers(a, "y").stocks).toBe(1);
      expect(timers(a, "x").stocks).toBeUndefined();
    });

    it("loses the watched car's timers on respawn, and keeps its own throughout", () => {
      const { r, a } = match();
      const own = r.state.players.get("a")!;
      own.alive = false;
      r.patch();
      // Only the car it is showing: x, the front of the sorted cycle, until the client names another.
      expect(timers(a, "x")).toEqual(SET);
      expect(timers(a, "y")).toEqual(UNSET);
      expect(a.decoded.players.get("a")!.inputSlack).toBe(1.5);
      own.alive = true;
      r.patch();
      expect(timers(a, "x")).toEqual(UNSET);
      expect(timers(a, "y")).toEqual(UNSET);
      expect(a.decoded.players.get("a")!.inputSlack).toBe(1.5);
    });

    it("a mode that does not spectate gives a wreck nobody's timers", () => {
      const { r, a } = match("none");
      r.state.players.get("a")!.alive = false;
      r.patch();
      expect(timers(a, "x")).toEqual(UNSET);
      expect(timers(a, "y")).toEqual(UNSET);
    });
  });
});
