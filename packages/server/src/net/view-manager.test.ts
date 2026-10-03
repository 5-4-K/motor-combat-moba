import { describe, expect, it } from "vitest";
import { Encoder, Reflection, StateView } from "@colyseus/schema";
import {
  ArenaState,
  GameMode,
  NET_CONFIG,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  StatusState,
  WeaponInstanceState,
  WeaponSlotState,
  activeCarIds,
  assembleModeConfig,
  driveOf,
  modeConfigOf,
  msToTicks,
  withMode,
  type ModeConfig,
} from "@motor-combat-moba/shared";
import { ViewManager, visionExitTicks, visionMarginUnits, type Viewer } from "./view-manager.js";

/**
 * A mode's shipped bundle with `camera.fov.enabled` turned on (and, optionally, its spectate rule
 * replaced). No shipped mode turns FOV on, so this is the only way to reach the filtering path.
 * (`applyOverrides` cannot reach `camera.*` — its tuning roots stop at the drive/weapon tables —
 * so the bundle is assembled from the shipped tables with the camera edited, which is the same
 * thing a mode folder's override would produce.)
 */
function fovOn(mode: GameMode, spectate?: ModeConfig["camera"]["spectate"]): ModeConfig {
  const base = modeConfigOf(mode);
  return assembleModeConfig(mode, {
    ...base,
    camera: {
      ...base.camera,
      fov: { ...base.camera.fov, enabled: true },
      spectate: spectate ?? base.camera.spectate,
    },
  });
}

const EXIT = msToTicks(NET_CONFIG.visionExitMs);
const MARGIN = 71;

/**
 * A room over the real encoder, shaped like Colyseus's `SchemaSerializer` (as in `view-manager.fov-off.test.ts`):
 * a joiner decodes `encodeAll` + `encodeAllView(view)`, then each patch is the shared `encode` plus
 * `encodeView(view)`. `patch()` runs `ViewManager.update` where the rooms run it — just before.
 */
function room(config: ModeConfig, opts: { mode?: GameMode } = {}) {
  const state = new ArenaState();
  state.mode = opts.mode ?? config.id;
  state.arenaId = "arena-03";
  state.phase = RoomPhase.MATCH;
  const enc = new Encoder(state);
  const vm = new ViewManager({ exitTicks: EXIT, marginUnits: MARGIN });
  type Client = Viewer & { decoded: ArenaState; dec: { decode(b: Uint8Array): void } };
  const clients: Client[] = [];
  const sync = () => withMode(config, () => vm.update(state, clients, state.tick));
  return {
    state,
    vm,
    clients,
    car(id: string, x: number, y: number, angle = 0, team = 0) {
      const p = new PlayerState();
      p.sessionId = id;
      p.name = id;
      p.status = PlayerStatus.IN_MATCH;
      p.alive = true;
      p.team = team;
      p.x = x;
      p.y = y;
      p.angle = angle;
      p.hp = 100;
      const slot = new WeaponSlotState();
      slot.weaponId = "predator";
      slot.stocks = 2;
      slot.rechargeEndsTick = 80;
      p.weapons.push(slot);
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
    join(sessionId: string): Client {
      const dec = Reflection.decode<ArenaState>(Reflection.encode(enc));
      const client: Client = { sessionId, view: new StateView(), decoded: dec.state, dec };
      clients.push(client);
      sync();
      const it = { offset: 0 };
      const shared = enc.encodeAll(it);
      const buf = new Uint8Array(64 * 1024);
      buf.set(shared.slice(0, it.offset));
      dec.decode(enc.encodeAllView(client.view, it.offset, { ...it }, buf));
      return client;
    },
    patch(ticks = 1) {
      for (let i = 0; i < ticks; i++) {
        state.tick += 1;
        sync();
        const it = { offset: 0 };
        enc.encode(it);
        const sharedOffset = it.offset;
        for (const c of clients) c.dec.decode(enc.encodeView(c.view, sharedOffset, { offset: sharedOffset }));
        enc.discardChanges();
      }
    },
    pick(viewer: Client, target: unknown) {
      return withMode(config, () => vm.pickSpectate(state, viewer, { target }));
    },
  };
}

const sorted = (s: ReadonlySet<string>) => [...s].sort();
/** What a client decoded of car `id`: undefined pose means the car is out of its view. */
const seen = (c: { decoded: ArenaState }, id: string) => c.decoded.players.get(id)?.inView === true;
const stocksOf = (c: { decoded: ArenaState }, id: string) => c.decoded.players.get(id)!.weapons[0]!.stocks;

// Geometry on arena-03, default FOV (600 × 450 ellipse, 120° cone, blocked by obstacles):
// the lane pillar at x 200–300, y 480–580 stands between (100, 530) and (400, 530).
const OPEN_FRONT = { x: 400, y: 300 };
const BEHIND = { x: -300, y: 300 };

describe("visionMarginUnits / visionExitTicks (NR46, NR47)", () => {
  it("derives the margin from the fastest active chassis's top speed, and the exit from 250 ms", () => {
    withMode(modeConfigOf(GameMode.FFA_LAST_STANDING), () => {
      const fastest = Math.max(...activeCarIds().map((id) => driveOf(id).maxSpeed));
      expect(visionMarginUnits()).toBe(Math.ceil(fastest * 0.25));
      expect(visionExitTicks()).toBe(15);
    });
  });
});

describe("ViewManager — FFA with FOV on", () => {
  const config = fovOn(GameMode.FFA_LAST_STANDING);

  it("has an enemy in front in view and an enemy behind a wall out of it", () => {
    const r = room(config);
    r.car("a", 100, 530);
    r.car("front", OPEN_FRONT.x, OPEN_FRONT.y);
    r.car("walled", 400, 530);
    const a = r.join("a");
    expect(sorted(r.vm.carsIn("a"))).toEqual(["a", "front"]);
    expect(seen(a, "front")).toBe(true);
    expect(a.decoded.players.get("front")!.x).toBe(OPEN_FRONT.x);
    // Hidden: scoreboard facts only.
    const walled = a.decoded.players.get("walled")!;
    expect(walled.name).toBe("walled");
    expect(walled.alive).toBe(true);
    expect(walled.x).toBeUndefined();
    expect(walled.hp).toBeUndefined();
    expect(walled.inView).toBeUndefined();
    expect(walled.weapons[0]!.weaponId).toBe("predator");
  });

  it("drops an enemy only when its centre AND every hull corner are blocked", () => {
    const r = room(config);
    r.car("a", 100, 530);
    // The line to its centre crosses the pillar (at x 200 it is at y 573, above the pillar's 580
    // bottom edge); the line to its rear-lower corner (370, 680) passes under it: in.
    r.car("peek", 400, 660);
    r.join("a");
    expect(r.vm.carsIn("a").has("peek")).toBe(true);
  });

  it("does not flicker an enemy crossing the edge every other tick, and drops it after exitTicks", () => {
    const r = room(config);
    r.car("a", 100, 300);
    const b = r.car("b", OPEN_FRONT.x, OPEN_FRONT.y);
    const a = r.join("a");
    expect(seen(a, "b")).toBe(true);
    for (let i = 0; i < 40; i++) {
      const out = i % 2 === 0;
      b.x = out ? BEHIND.x : OPEN_FRONT.x;
      r.patch();
      expect(seen(a, "b"), `tick ${r.state.tick}`).toBe(true);
    }
    // Now out for good: still in for EXIT - 1 more ticks, gone on the EXIT-th.
    b.x = BEHIND.x;
    r.patch(EXIT - 1);
    expect(seen(a, "b")).toBe(true);
    // While held it is IN the view: its pose keeps streaming, out-of-vision or not.
    expect(a.decoded.players.get("b")!.x).toBe(BEHIND.x);
    r.patch();
    expect(seen(a, "b")).toBe(false);
    expect(a.decoded.players.get("b")!.x).toBeUndefined();
    // Back in front: in on the very next patch, pose and statuses whole.
    const row = new StatusState();
    row.statusId = "reeling";
    row.endsTick = 99;
    b.statuses.push(row);
    b.x = OPEN_FRONT.x;
    r.patch();
    expect(seen(a, "b")).toBe(true);
    expect(a.decoded.players.get("b")!.x).toBe(OPEN_FRONT.x);
    expect(a.decoded.players.get("b")!.statuses.length).toBe(1);
    expect(a.decoded.players.get("b")!.statuses[0]!.statusId).toBe("reeling");
  });

  it("sends an enemy's shot only in vision, and the viewer's own shots — ended rows too — always", () => {
    const r = room(config);
    r.car("a", 100, 530);
    r.car("b", 400, 530); // behind the pillar
    r.shot("own-ended", "a", BEHIND.x, BEHIND.y, false);
    r.shot("own-live", "a", BEHIND.x, BEHIND.y + 50);
    r.shot("enemy-front", "b", OPEN_FRONT.x, OPEN_FRONT.y);
    r.shot("enemy-ended-front", "b", OPEN_FRONT.x, OPEN_FRONT.y + 40, false);
    r.shot("enemy-ended-hidden", "b", 450, 530, false);
    r.shot("enemy-hidden", "b", 450, 540);
    const a = r.join("a");
    const expected = ["enemy-ended-front", "enemy-front", "own-ended", "own-live"];
    expect(sorted(r.vm.shotsIn("a"))).toEqual(expected);
    expect([...a.decoded.weapons.keys()].sort()).toEqual(expected);
    expect(a.decoded.weapons.get("own-ended")!.alive).toBe(false);
    // Created after join: the same rule on the next update.
    r.shot("enemy-late-hidden", "b", 460, 530);
    r.shot("own-late-ended", "a", BEHIND.x, BEHIND.y, false);
    r.patch();
    expect([...a.decoded.weapons.keys()].sort()).toEqual([...expected, "own-late-ended"].sort());
    // A hidden shot that flies into view arrives; one that leaves goes after exitTicks.
    r.state.weapons.get("enemy-hidden")!.x = OPEN_FRONT.x;
    r.state.weapons.get("enemy-hidden")!.y = OPEN_FRONT.y - 40;
    r.state.weapons.get("enemy-front")!.x = 450;
    r.state.weapons.get("enemy-front")!.y = 530;
    r.patch();
    expect(a.decoded.weapons.has("enemy-hidden")).toBe(true);
    expect(a.decoded.weapons.has("enemy-front")).toBe(true);
    r.patch(EXIT);
    expect(a.decoded.weapons.has("enemy-front")).toBe(false);
    expect(a.decoded.weapons.get("enemy-hidden")!.x).toBe(OPEN_FRONT.x);
  });

  it("puts everything in every view outside MATCH, even with FOV on (rule 2)", () => {
    const r = room(config);
    r.state.phase = RoomPhase.COUNTDOWN;
    r.car("a", 100, 530);
    r.car("walled", 400, 530);
    r.shot("s", "walled", 450, 530);
    const a = r.join("a");
    expect(seen(a, "walled")).toBe(true);
    expect(a.decoded.weapons.has("s")).toBe(true);
  });
});

describe("ViewManager — FOV off (every shipped mode)", () => {
  it("puts every car and every instance in every view, through the same path", () => {
    const config = modeConfigOf(GameMode.FFA_LAST_STANDING);
    expect(config.camera.fov.enabled).toBe(false);
    const r = room(config);
    r.car("a", 100, 530);
    r.car("walled", 400, 530);
    r.car("behind", BEHIND.x, BEHIND.y);
    r.shot("s", "walled", 450, 530, false);
    const a = r.join("a");
    const b = r.join("walled");
    r.patch();
    for (const c of [a, b]) {
      for (const id of ["a", "walled", "behind"]) expect(seen(c, id), `${c.sessionId} sees ${id}`).toBe(true);
      expect(c.decoded.weapons.has("s")).toBe(true);
    }
    // Owner-only fields stay owner-only.
    expect(stocksOf(a, "a")).toBe(2);
    expect(stocksOf(a, "walled")).toBeUndefined();
  });
});

describe("ViewManager — team mode with FOV on", () => {
  const config = fovOn(GameMode.TEAM);

  it("keeps a teammate fully visible behind a wall — slot timers included — and its shots", () => {
    const r = room(config);
    r.car("a", 100, 530, 0, 0);
    r.car("mate", 400, 530, Math.PI, 0); // behind the pillar, looking back into it
    r.car("enemy", 1100, 1900, 0, 1); // far from both
    r.shot("mate-shot", "mate", 1100, 1800);
    const a = r.join("a");
    expect(sorted(r.vm.carsIn("a"))).toEqual(["a", "mate"]);
    expect(seen(a, "mate")).toBe(true);
    expect(stocksOf(a, "mate")).toBe(2);
    expect(a.decoded.players.get("mate")!.weapons[0]!.rechargeEndsTick).toBe(80);
    expect(seen(a, "enemy")).toBe(false);
    expect(stocksOf(a, "enemy")).toBeUndefined();
    expect(a.decoded.weapons.has("mate-shot")).toBe(true);
    r.state.players.get("mate")!.weapons[0]!.stocks = 1;
    r.patch();
    expect(stocksOf(a, "mate")).toBe(1);
  });

  it("shares a living teammate's vision (sharedVision)", () => {
    const r = room(config);
    r.car("a", 100, 530, 0, 0);
    r.car("mate", 600, 1700, 0, 0);
    r.car("enemy", 900, 1700, 0, 1); // in front of the mate, nowhere near a
    r.join("a");
    expect(r.vm.carsIn("a").has("enemy")).toBe(true);
  });
});

describe("ViewManager — a spectating wreck with FOV on (NR45)", () => {
  const config = fovOn(GameMode.FFA_LAST_STANDING);

  /** `a` is the wreck; `b` sees `c`; `d` sees nobody, and nobody sees `d`. */
  function wreck() {
    const r = room(config);
    const own = r.car("a", 640, 1100);
    own.alive = false;
    r.car("b", 100, 300);
    r.car("c", OPEN_FRONT.x, OPEN_FRONT.y);
    r.car("d", 1150, 1950, Math.PI / 2);
    const a = r.join("a");
    return { r, a };
  }

  it("sees exactly its default target's view until it names one", () => {
    const { r, a } = wreck();
    // b is first in the sorted cycle — the client's own starting pick.
    expect(sorted(r.vm.carsIn("a"))).toEqual(["a", "b", "c"]);
    expect(stocksOf(a, "b")).toBe(2);
    expect(stocksOf(a, "c")).toBeUndefined();
    expect(seen(a, "d")).toBe(false);
  });

  it("switches to the named target's view, timers and all", () => {
    const { r, a } = wreck();
    expect(r.pick(a, "d")).toBe(true);
    r.patch();
    expect(seen(a, "d")).toBe(true);
    expect(stocksOf(a, "d")).toBe(2);
    expect(stocksOf(a, "b")).toBeUndefined();
    // b and c are d's enemies out of its vision: gone once the hysteresis runs out.
    r.patch(EXIT);
    expect(sorted(r.vm.carsIn("a"))).toEqual(["a", "d"]);
    expect(seen(a, "b")).toBe(false);
    expect(seen(a, "c")).toBe(false);
    // The watched car dies: the server falls to the front of the cycle, as the client does.
    r.state.players.get("d")!.alive = false;
    r.patch();
    expect(r.vm.carsIn("a").has("b")).toBe(true);
    expect(stocksOf(a, "b")).toBe(2);
  });

  it("ignores a target it may not watch, a malformed message, and any pick from a living car", () => {
    const { r, a } = wreck();
    expect(r.pick(a, "nobody")).toBe(false);
    expect(r.pick(a, "a")).toBe(false); // its own wreck is not in the cycle
    expect(withMode(config, () => r.vm.pickSpectate(r.state, a, { target: 5 }))).toBe(false);
    expect(withMode(config, () => r.vm.pickSpectate(r.state, a, "d"))).toBe(false);
    r.patch();
    expect(sorted(r.vm.carsIn("a"))).toEqual(["a", "b", "c"]);
    r.state.players.get("a")!.alive = true;
    expect(r.pick(a, "d")).toBe(false);
  });

  it("with no target, sees its own frozen death vision (\"pov\") or nothing (\"blind\")", () => {
    for (const noTargetVision of ["pov", "blind"] as const) {
      const cfg = fovOn(GameMode.FFA_DEATHMATCH, { target: "none", noTargetVision });
      const r = room(cfg);
      const own = r.car("a", 100, 300);
      own.alive = false;
      r.car("c", OPEN_FRONT.x, OPEN_FRONT.y);
      r.join("a");
      expect(r.vm.carsIn("a").has("c"), noTargetVision).toBe(noTargetVision === "pov");
    }
  });
});

describe("ViewManager bookkeeping", () => {
  it("forgets a viewer, and re-syncing an unchanged state sends nothing new", () => {
    const config = fovOn(GameMode.FFA_LAST_STANDING);
    const r = room(config);
    r.car("a", 100, 300);
    r.car("b", OPEN_FRONT.x, OPEN_FRONT.y);
    const a = r.join("a");
    r.patch();
    withMode(config, () => r.vm.update(r.state, r.clients, r.state.tick));
    expect(a.view.changes.size).toBe(0);
    r.vm.forget("a");
    expect(r.vm.carsIn("a").size).toBe(0);
  });
});
