import { describe, expect, it } from "vitest";
import { ClientState, SchemaSerializer } from "@colyseus/core";
import { Reflection, type StateView } from "@colyseus/schema";
import {
  ArenaState,
  GameMode,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  StatusState,
  WeaponInstanceState,
  WeaponSlotState,
  withMode,
  type ModeConfig,
} from "@motor-combat-moba/shared";
import { fovOnBundle } from "../net/fov-bundle.js";
import { ensureView, viewersOf, visionExitTicks, type ViewManager } from "../net/view-manager.js";
import { ArenaRoom } from "./ArenaRoom.js";

/**
 * Phase G's review focus, end to end: a hidden enemy's car fields and shots are ABSENT from a client's
 * decoded state (NR43, NR44). Unlike `view-manager.test.ts`, which drives the schema `Encoder` by
 * hand, every byte here comes out of a real `ArenaRoom`: its own `ViewManager`, its own
 * `sendSnapshot` (`views.update` then `broadcastPatch`, the only patch path a room has), and Colyseus's
 * own `SchemaSerializer` — `sendFullState` for a joiner (`encodeAll` + `encodeAllView`) and
 * `applyPatches` for every patch after (`encode` + `encodeView`), each frame handed to the client's
 * `raw` exactly as a transport would send it. Each client decodes with a decoder built from the
 * room's own handshake, as the SDK does.
 *
 * White-box: standing up a real room (`onCreate`'s matchmaker query, a transport) is machinery this
 * test has no business running — same reasoning as `room-cadence.test.ts`. The room's FOV bundle is
 * assigned to its `modeConfig` and the match state is built by hand: no shipped mode turns FOV on.
 */
interface LeakHarness {
  state: ArenaState;
  clients: unknown[];
  modeConfig: ModeConfig;
  views: ViewManager;
  setSerializer(serializer: SchemaSerializer<ArenaState>): void;
  sendSnapshot(): void;
  sendFullState(client: unknown): void;
  _serializer: SchemaSerializer<ArenaState>;
}

interface FakeClient {
  sessionId: string;
  state: number;
  view?: StateView;
  frames: Uint8Array[];
  raw(bytes: Uint8Array): void;
  enqueueRaw(bytes: Uint8Array): void;
  decoded: ArenaState;
  dec: { decode(bytes: Uint8Array, it?: { offset: number }): unknown };
}

function arena(config: ModeConfig) {
  const room = new ArenaRoom() as unknown as LeakHarness;
  const state = new ArenaState();
  state.mode = config.id;
  state.arenaId = "arena-03";
  state.phase = RoomPhase.MATCH;
  // What the `state` setter does once the matchmaker has run `__init` (which also arms a patch
  // interval, so it is not run here): a schema state gets a `SchemaSerializer`, reset to it.
  room.setSerializer(new SchemaSerializer<ArenaState>());
  room._serializer.reset(state);
  room.state = state;
  room.modeConfig = config;
  const scoped = <T>(fn: () => T): T => withMode(config, fn);

  const deliver = (c: FakeClient) => {
    for (const frame of c.frames.splice(0)) c.dec.decode(frame, { offset: 1 });
  };

  return {
    room,
    state,
    car(id: string, x: number, y: number, angle: number, team = 0) {
      const p = new PlayerState();
      p.sessionId = id;
      p.name = `${id}-name`;
      p.status = PlayerStatus.IN_MATCH;
      p.alive = true;
      p.team = team;
      p.kills = 3;
      p.x = x;
      p.y = y;
      p.angle = angle;
      p.hp = 100;
      const slot = new WeaponSlotState();
      slot.weaponId = "predator";
      slot.stocks = 2;
      slot.rechargeEndsTick = 80;
      p.weapons.push(slot);
      const status = new StatusState();
      status.statusId = "reeling";
      status.endsTick = 500;
      p.statuses.push(status);
      state.players.set(id, p);
      return p;
    },
    shot(id: string, owner: string, x: number, y: number, alive = true) {
      const w = new WeaponInstanceState();
      w.id = id;
      w.ownerSessionId = owner;
      w.weaponId = "predator";
      w.x = x;
      w.y = y;
      w.alive = alive;
      state.weapons.set(id, w);
      return w;
    },
    /** `ArenaRoom.onJoin`'s view fill, then Colyseus's full-state send. */
    join(sessionId: string): FakeClient {
      const dec = Reflection.decode<ArenaState>(room._serializer.handshake());
      const client: FakeClient = {
        sessionId,
        state: ClientState.JOINED,
        frames: [],
        raw(bytes) {
          this.frames.push(bytes.slice());
        },
        enqueueRaw(bytes) {
          this.frames.push(bytes.slice());
        },
        decoded: dec.state,
        dec,
      };
      ensureView(client);
      scoped(() => room.views.update(state, viewersOf([client], (c) => c.sessionId), state.tick));
      room.clients.push(client);
      room.sendFullState(client);
      deliver(client);
      return client;
    },
    /** One room snapshot: `sendSnapshot` exactly as `tick()` calls it, then every client decodes. */
    patch() {
      state.tick += 1;
      scoped(() => room.sendSnapshot());
      for (const c of room.clients as FakeClient[]) deliver(c);
    },
    pick(client: FakeClient, target: string) {
      return scoped(() => room.views.pickSpectate(state, { sessionId: client.sessionId }, { target }));
    },
  };
}

/** Every `@view()` car field the viewer may not have of a car it cannot see (NR42). */
function expectHidden(viewer: FakeClient, id: string) {
  const p = viewer.decoded.players.get(id)!;
  const why = `${viewer.sessionId} decoded ${id}`;
  expect(p, why).toBeDefined();
  for (const field of ["x", "y", "angle", "vx", "vy", "angVel", "hp", "statuses", "inView", "turretAngle", "pendingUntilTick", "lastSteer", "lastThrottle", "maneuver"] as const) {
    expect(p[field], `${why}.${field}`).toBeUndefined();
  }
  // Owner-only slot timers too; the loadout itself is public.
  expect(p.weapons[0]!.stocks, `${why} slot stocks`).toBeUndefined();
  expect(p.weapons[0]!.rechargeEndsTick, `${why} slot recharge`).toBeUndefined();
  expect(p.weapons[0]!.weaponId).toBe("predator");
  // Scoreboard facts stay (NR42).
  expect(p.name).toBe(`${id}-name`);
  expect(p.kills).toBe(3);
  expect(p.alive).toBe(true);
  // None of its shots, live or ended.
  const owned = [...(viewer.decoded.weapons?.values() ?? [])].filter((w) => w.ownerSessionId === id);
  expect(owned.map((w) => w.id), `${why}'s shots`).toEqual([]);
}

const ids = (m: Map<string, unknown> | { keys(): Iterable<string> } | undefined) => [...(m?.keys() ?? [])].sort();
const posed = (c: FakeClient) =>
  [...c.decoded.players.entries()].filter(([, p]) => p.inView === true).map(([id]) => id).sort();

describe("a real ArenaRoom never sends a hidden enemy to a client (NR43, NR44)", () => {
  // arena-03's lane pillar (x 200–300, y 480–580) stands between the two, and each faces away.
  it("two viewers facing away behind a wall: neither decodes the other's car state or shots, on join or after", () => {
    const r = arena(fovOnBundle(GameMode.FFA_LAST_STANDING));
    r.car("a", 100, 530, Math.PI);
    r.car("b", 400, 530, 0);
    r.shot("a-1", "a", 40, 530);
    r.shot("a-2", "a", 60, 530, false);
    r.shot("b-1", "b", 460, 530);
    r.shot("b-2", "b", 480, 530, false);
    const a = r.join("a");
    const b = r.join("b");
    r.patch();
    for (const [viewer, other] of [[a, "b"], [b, "a"]] as const) {
      expectHidden(viewer, other);
      // Its own car and shots are whole.
      expect(viewer.decoded.players.get(viewer.sessionId)!.x).toBeDefined();
      expect(viewer.decoded.players.get(viewer.sessionId)!.weapons[0]!.stocks).toBe(2);
    }
    expect(ids(a.decoded.weapons)).toEqual(["a-1", "a-2"]);
    expect(ids(b.decoded.weapons)).toEqual(["b-1", "b-2"]);

    // Both move (still hidden), b is hit, gains a status, fires again, and its old shot ends: the
    // patch carries none of it to a.
    const pa = r.state.players.get("a")!;
    const pb = r.state.players.get("b")!;
    pa.x = 110;
    pa.y = 520;
    pb.x = 390;
    pb.y = 540;
    pb.hp = 80;
    const extra = new StatusState();
    extra.statusId = "spiked";
    extra.endsTick = 600;
    pb.statuses.push(extra);
    pb.weapons[0]!.stocks = 1;
    r.shot("b-3", "b", 450, 545);
    r.state.weapons.get("b-1")!.alive = false;
    r.patch();
    r.patch();
    for (const [viewer, other] of [[a, "b"], [b, "a"]] as const) expectHidden(viewer, other);
    expect(ids(a.decoded.weapons)).toEqual(["a-1", "a-2"]);
    expect(b.decoded.players.get("b")!.hp).toBe(80);

    // The control: b drives into a's open sight line (a turned to face up the lane) — and only now
    // does a decode it, so the absences above are the view at work, not a decoder that sees nothing.
    pa.angle = -Math.PI / 2;
    pb.x = 110;
    pb.y = 300;
    r.shot("b-4", "b", 110, 270);
    r.patch();
    const seen = a.decoded.players.get("b")!;
    expect(seen.inView).toBe(true);
    expect(seen.x).toBe(110);
    expect(seen.hp).toBe(80);
    expect(seen.statuses.map((s) => s.statusId)).toEqual(["reeling", "spiked"]);
    expect(seen.weapons[0]!.stocks).toBeUndefined(); // still not a's to read
    expect(a.decoded.weapons.has("b-4")).toBe(true);
  });

  it("a spectating wreck decodes exactly what its target decodes", () => {
    const r = arena(fovOnBundle(GameMode.FFA_LAST_STANDING));
    const wreck = r.car("w", 640, 1100, 0);
    wreck.alive = false;
    r.car("a", 100, 530, Math.PI); // behind the pillar from b
    r.car("b", 400, 530, 0);
    r.car("c", 700, 530, Math.PI); // in front of b
    r.car("d", 640, 1950, Math.PI / 2); // nobody's
    r.shot("c-1", "c", 650, 530);
    r.shot("d-1", "d", 640, 1990);
    r.shot("a-1", "a", 40, 530);
    const w = r.join("w");
    const b = r.join("b");
    // Until it names one the wreck watches the front of its cycle ("a"); switching to b drops what
    // only a could see once the exit hysteresis (NR47) has run out.
    expect(r.pick(w, "b")).toBe(true);
    const exit = withMode(fovOnBundle(GameMode.FFA_LAST_STANDING), () => visionExitTicks());
    for (let i = 0; i < exit; i++) r.patch();
    expect(posed(b)).toEqual(["b", "c"]);
    expect(posed(w)).toEqual(["b", "c", "w"]);
    expect(ids(w.decoded.weapons)).toEqual(ids(b.decoded.weapons));
    expect(ids(w.decoded.weapons)).toEqual(["c-1"]);
    expectHidden(w, "a");
    expectHidden(w, "d");
    // Its target's slot HUD, which the watched car's owner-only fields feed (NR45).
    expect(w.decoded.players.get("b")!.weapons[0]!.stocks).toBe(2);
  });

  it("in a respawning mode, a wreck watching an enemy decodes its pose but never its slot timers; a teammate's it does", () => {
    // FFA Deathmatch: every other car is an enemy.
    const dm = fovOnBundle(GameMode.FFA_DEATHMATCH, { target: "anyone", noTargetVision: "pov" });
    const r = arena(dm);
    const wreck = r.car("w", 640, 1100, 0);
    wreck.alive = false;
    r.car("b", 400, 530, 0);
    const w = r.join("w");
    r.patch();
    const b = w.decoded.players.get("b")!;
    expect(b.inView).toBe(true);
    expect(b.x).toBe(400);
    expect(b.hp).toBe(100);
    expect(b.weapons[0]!.weaponId).toBe("predator");
    expect(b.weapons[0]!.stocks).toBeUndefined();
    expect(b.weapons[0]!.rechargeEndsTick).toBeUndefined();
    r.state.players.get("b")!.weapons[0]!.rechargeEndsTick = 140;
    r.patch();
    expect(w.decoded.players.get("b")!.weapons[0]!.rechargeEndsTick).toBeUndefined();
    expect(w.decoded.players.get("w")!.weapons[0]!.stocks).toBe(2);

    // Conquer: watching a teammate keeps the timers (the side rule), an enemy's stay out.
    const cq = fovOnBundle(GameMode.CONQUER, { target: "anyone", noTargetVision: "pov" });
    const t = arena(cq);
    const own = t.car("w", 640, 1100, 0, 0);
    own.alive = false;
    t.car("mate", 400, 530, 0, 0);
    t.car("zenemy", 700, 530, Math.PI, 1);
    const tw = t.join("w");
    expect(t.pick(tw, "mate")).toBe(true);
    t.patch();
    expect(tw.decoded.players.get("mate")!.weapons[0]!.stocks).toBe(2);
    expect(t.pick(tw, "zenemy")).toBe(true);
    t.patch();
    expect(tw.decoded.players.get("zenemy")!.inView).toBe(true);
    expect(tw.decoded.players.get("zenemy")!.weapons[0]!.stocks).toBeUndefined();
    expect(tw.decoded.players.get("mate")!.weapons[0]!.stocks).toBe(2);
  });

  it("a teammate behind a wall is whole — pose, hp, statuses, slot timers and shots — and the enemy is not", () => {
    const r = arena(fovOnBundle(GameMode.TEAM));
    r.car("a", 100, 530, Math.PI, 0);
    r.car("mate", 400, 530, 0, 0);
    r.car("enemy", 1100, 1900, 0, 1);
    r.shot("mate-1", "mate", 460, 530);
    r.shot("enemy-1", "enemy", 1100, 1850);
    const a = r.join("a");
    r.patch();
    const mate = a.decoded.players.get("mate")!;
    expect(mate.inView).toBe(true);
    expect(mate.x).toBe(400);
    expect(mate.hp).toBe(100);
    expect(mate.statuses.map((s) => s.statusId)).toEqual(["reeling"]);
    expect(mate.weapons[0]!.stocks).toBe(2);
    expect(mate.weapons[0]!.rechargeEndsTick).toBe(80);
    expect(ids(a.decoded.weapons)).toEqual(["mate-1"]);
    expectHidden(a, "enemy");
    // Later timer changes keep arriving.
    r.state.players.get("mate")!.weapons[0]!.rechargeEndsTick = 140;
    r.patch();
    expect(a.decoded.players.get("mate")!.weapons[0]!.rechargeEndsTick).toBe(140);
  });
  // I1: `ArenaRoom` seats a mid-match joiner READY at a placeholder pose with a lobby team. It is no
  // one's teammate in the running match and has no vision of it.
  it("a READY late joiner during a FFA match decodes no in-match car or shot, even inside its placeholder cone", () => {
    const r = arena(fovOnBundle(GameMode.FFA_LAST_STANDING));
    r.car("e", 700, 300, Math.PI);
    r.shot("e-1", "e", 650, 300);
    const late = r.car("late", 400, 300, 0);
    late.status = PlayerStatus.READY;
    const l = r.join("late");
    r.patch();
    r.patch();
    expectHidden(l, "e");
    expect(l.decoded.players.get("late")!.x).toBe(400); // its own car is whole
  });

  it("a READY late joiner during a TEAM match decodes nothing of its lobby team's in-match cars", () => {
    const r = arena(fovOnBundle(GameMode.TEAM));
    r.car("mate", 400, 530, 0, 0);
    r.car("enemy", 700, 300, Math.PI, 1);
    r.shot("mate-1", "mate", 460, 530);
    const late = r.car("late", 400, 300, 0, 0);
    late.status = PlayerStatus.READY;
    const l = r.join("late");
    r.patch();
    r.patch();
    expectHidden(l, "mate");
    expectHidden(l, "enemy");
    expect(ids(l.decoded.weapons)).toEqual([]);
  });
});
