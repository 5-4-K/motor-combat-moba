import { beforeEach, describe, expect, it } from "vitest";
import { hpOf } from "../config/car-config.js";
import { NET_CONFIG } from "../config/net-config.js";
import type { CarId } from "../config/types.js";
import { msToTicks, weaponTicksOf } from "../config/weapon-ticks.js";
import { MS_PER_TICK } from "../constants.js";
import { installMode, slots } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import type { Bounds } from "../sim/collide.js";
import { runCombat, type CombatPlayer } from "../sim/combat.js";
import { ManeuverKind } from "../sim/maneuver.js";
import { newFireState, type FireState } from "../sim/weapons/fire.js";
import { modifiersOf } from "../sim/status/modifiers.js";
import { assembleModeConfig } from "../modes/build.js";
import type { ModeTables } from "../modes/types.js";
import type { StatusDef } from "../config/status-types.js";
import { spawnInstances, type WeaponInstance } from "../sim/weapons/instances.js";
import {
  LocalFire,
  ProvisionalShots,
  clientCompTicks,
  fireStateOf,
  provisionalOf,
  provisionalViewMaxTicks,
  type FireFrame,
  type FireView,
  type Provisional,
} from "./provisional-shots.js";
import { ShotView, shotFromWire, shotViewMaxTicks, type WireShot } from "./shot-view.js";

installMode(modeConfigOf(DEFAULT_GAME_MODE));
beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const DT = MS_PER_TICK / 1000;
const OPEN: Bounds = { width: 5000, height: 5000 };
const WORLD = { obstacles: [], bounds: OPEN };
const T = 300;

function provisional(o: Partial<Provisional> & { key: string; weaponId?: WeaponInstance["weaponId"]; angle?: number }): Provisional {
  const { instances } = spawnInstances(
    { weaponId: o.weaponId ?? "predator", slot: 1, finalVolley: true, pressId: "" },
    { sessionId: o.ownerId ?? "me", team: 0, carId: "bullseye", x: 1000, y: 1000, angle: o.angle ?? 0 },
    o.spawnTick ?? T,
    0,
  );
  return {
    key: o.key,
    ownerId: o.ownerId ?? "me",
    slot: o.slot ?? 1,
    spawnTick: o.spawnTick ?? T,
    instance: { ...instances[0]!, lifeOffsetTicks: 0 },
    bornAtMs: o.bornAtMs ?? 0,
  };
}

describe("ProvisionalShots", () => {
  it("confirms a provisional with the server instance of the same owner and weapon within ±2 ticks", () => {
    for (const dt of [-2, -1, 0, 1, 2]) {
      const shots = new ProvisionalShots();
      shots.add(provisional({ key: "p" }));
      const pairs = shots.confirm([{ id: "s", ownerSessionId: "me", weaponId: "predator", spawnTick: T + dt }]);
      expect(pairs.map((p) => [p.provisionalKey, p.serverId])).toEqual([["p", "s"]]);
      expect(shots.list()).toHaveLength(0);
    }
  });

  it("does not confirm outside the window, on another weapon, another owner, or a burst", () => {
    const shots = new ProvisionalShots();
    shots.add(provisional({ key: "p" }));
    expect(shots.confirm([{ id: "a", ownerSessionId: "me", weaponId: "predator", spawnTick: T + 3 }])).toEqual([]);
    expect(shots.confirm([{ id: "b", ownerSessionId: "me", weaponId: "pepperbox", spawnTick: T }])).toEqual([]);
    expect(shots.confirm([{ id: "c", ownerSessionId: "them", weaponId: "predator", spawnTick: T }])).toEqual([]);
    expect(shots.confirm([{ id: "d", ownerSessionId: "me", weaponId: "predator", spawnTick: T, isExplosion: true }])).toEqual([]);
    expect(shots.list()).toHaveLength(1);
  });

  it("lets one server instance confirm one provisional, once, and pairs pellets by tick then heading", () => {
    const shots = new ProvisionalShots();
    shots.add(provisional({ key: "left", angle: -0.2 }));
    shots.add(provisional({ key: "right", angle: 0.2 }));
    shots.add(provisional({ key: "later", angle: 0, spawnTick: T + 2 }));
    // The same instance listed again on the next frame confirms nothing more.
    const first = shots.confirm([{ id: "r", ownerSessionId: "me", weaponId: "predator", spawnTick: T, angle: 0.2 }]);
    expect(first.map((p) => p.provisionalKey)).toEqual(["right"]);
    expect(shots.confirm([{ id: "r", ownerSessionId: "me", weaponId: "predator", spawnTick: T, angle: 0.2 }])).toEqual([]);
    // Nearest tick beats nearest heading.
    const next = shots.confirm([{ id: "x", ownerSessionId: "me", weaponId: "predator", spawnTick: T + 2, angle: -0.2 }]);
    expect(next.map((p) => p.provisionalKey)).toEqual(["later"]);
  });

  it("drops an unconfirmed provisional at the first snapshot at or past spawnTick + provisionalShotMatchTicks", () => {
    const shots = new ProvisionalShots();
    shots.add(provisional({ key: "p" }), WORLD);
    const W = NET_CONFIG.provisionalShotMatchTicks;
    for (let snap = T - 3; snap < T + W; snap++) {
      shots.confirm([]);
      expect(shots.expireBySnapshot(snap)).toEqual([]);
    }
    expect(shots.expireBySnapshot(T + W)).toEqual(["p"]);
    expect(shots.list()).toHaveLength(0);
    expect(shots.at("p", T + 5)).toBeUndefined();
    // A snapshot that skipped ahead (several patches applied in one frame) drops it just the same.
    shots.add(provisional({ key: "q" }), WORLD);
    expect(shots.expireBySnapshot(T + W + 7)).toEqual(["q"]);
  });

  it("confirms on the very snapshot that would expire it: confirm runs first, so no confirm is ever late", () => {
    const shots = new ProvisionalShots();
    shots.add(provisional({ key: "p" }), WORLD);
    const W = NET_CONFIG.provisionalShotMatchTicks;
    const pairs = shots.confirm([{ id: "s", ownerSessionId: "me", weaponId: "predator", spawnTick: T + W }]);
    expect(pairs.map((x) => x.provisionalKey)).toEqual(["p"]);
    expect(shots.expireBySnapshot(T + W)).toEqual([]);
  });

  it("an ENDED row (a shot that ended inside its fast-forward) confirms and ends its provisional, with no hand-over", () => {
    const shots = new ProvisionalShots();
    shots.add(provisional({ key: "p" }), WORLD);
    const pairs = shots.confirm(
      [{ id: "s", ownerSessionId: "me", weaponId: "predator", spawnTick: T, alive: false }],
      T + 4,
    );
    expect(pairs).toEqual([{ provisionalKey: "p", serverId: "s", ended: true }]);
    expect(shots.list()).toHaveLength(0);
    expect(shots.at("p", T + 4)).toBeUndefined();
  });

  it("I2: a press the server moved past the window (its pressing frame repeated over) is never drawn twice", () => {
    // The client predicted the release on T; the server simulated T..T+3 on a repeated frame and
    // took the press edge from the next real frame, T+4. Snapshots T..T+3 carry no instance for it.
    const shots = new ProvisionalShots();
    shots.add(provisional({ key: "p" }), WORLD);
    const W = NET_CONFIG.provisionalShotMatchTicks;
    let dropped: readonly string[] = [];
    for (let snap = T; snap <= T + W; snap++) {
      shots.confirm([]);
      dropped = shots.expireBySnapshot(snap);
      if (dropped.length > 0) expect(snap).toBe(T + W);
    }
    expect(dropped).toEqual(["p"]);
    // The server's instance arrives two snapshots later: there is nothing left for it to stand beside.
    const late = { id: "s", ownerSessionId: "me", weaponId: "predator", spawnTick: T + W + 2 };
    expect(shots.confirm([late])).toEqual([]);
    expect(shots.list()).toHaveLength(0);
  });

  it("eases a confirmed instance from where its provisional was drawn, closing linearly over provisionalShotEaseMs", () => {
    const shots = new ProvisionalShots();
    shots.beginHandover("s", { x: 110, y: 50 }, { x: 100, y: 50 }, 0);
    const at = (ms: number) => {
      const pose = { x: 100, y: 50 };
      shots.applyHandover("s", pose, ms);
      return pose.x;
    };
    expect(at(0)).toBeCloseTo(110, 9);
    expect(at(NET_CONFIG.provisionalShotEaseMs / 2)).toBeCloseTo(105, 9);
    expect(at(NET_CONFIG.provisionalShotEaseMs)).toBe(100);
    expect(at(0)).toBe(100); // spent: forgotten
  });

  it("draws a press on the frame it is made: at a draw tick a fraction behind its spawn tick it sits at the muzzle", () => {
    const shots = new ProvisionalShots();
    const p = provisional({ key: "p" });
    shots.add(p, WORLD);
    // The local car is drawn at `newestPredictedTick − 1 + phase`: on the frame of the press, T − 0.6.
    const drawn = shots.at("p", T - 0.6)!;
    expect(drawn.x).toBeCloseTo(p.instance.x, 9);
    expect(drawn.y).toBeCloseTo(p.instance.y, 9);
  });
});

describe("clientCompTicks", () => {
  it("is P − viewTick clamped to [0, capTicks], and 0 with no viewTick", () => {
    const cap = msToTicks(NET_CONFIG.shotCompCapMs);
    expect(clientCompTicks(100, 95)).toBe(5);
    expect(clientCompTicks(100, 100 - cap - 20)).toBe(cap);
    expect(clientCompTicks(100, 104)).toBe(0);
    expect(clientCompTicks(100, undefined)).toBe(0);
  });
});

// --- against the server's own combat loop -------------------------------------------------------

function viewOf(state: FireState, tick: number, pendingUntilTick = 0): FireView {
  return {
    tick,
    weapons: state.slots,
    switchLockUntilTick: state.switchLockUntilTick,
    pendingUntilTick,
    lastFiredSlot: state.lastFiredSlot,
    level: state.level,
    turretAngle: state.turretAngle,
  };
}

function frame(tick: number, mask: number, angle: number, viewTick?: number): FireFrame {
  return { tick, mask, carAngle: angle, viewTick, disarmed: false, weaponCooldown: 1, maneuvering: false };
}

function shooter(carId: CarId, pose: { x: number; y: number; angle: number }): CombatPlayer {
  return {
    sessionId: "me", ...pose, team: 0, carId, hp: hpOf(carId), alive: true, inRoster: true, fireMask: 0,
    fireState: newFireState(carId, 1), statuses: [], maneuver: ManeuverKind.NONE, maneuverTicksLeft: 0,
    maneuverAngle: 0, maneuverSpeed: 0, maneuverWeaponId: "", maneuverPressId: "", lastDamagerSessionId: "",
  };
}

const wireOf = (i: WeaponInstance): WireShot => ({
  id: i.id, ownerSessionId: i.ownerSessionId, weaponId: i.weaponId, x: i.x, y: i.y, angle: i.angle,
  extent: i.extent, spawnTick: i.spawnTick, isExplosion: i.isExplosion, lifeOffsetTicks: i.lifeOffsetTicks ?? 0,
});

/**
 * The same held-key timeline run twice: through `runCombat` on the server (press edges found the way
 * `serverTick` finds them, compensation `kServer`), and through `LocalFire` + `provisionalOf` on the
 * client (compensation from `viewTick`, i.e. `kClient`). The shooter drives a fixed curve.
 */
function race(o: {
  carId: CarId; held: (t: number) => number; kServer: number; kClient: number; until: number;
  /** Statuses the shooter carries the whole run, and the `weaponCooldown` the client reads off them. */
  statuses?: CombatPlayer["statuses"]; weaponCooldown?: number;
  /** Called each tick with the server's and the client's fire state after it. */
  onTick?: (tick: number, server: FireState, client: Readonly<FireState> | undefined) => void;
  poseAt?: (t: number) => { x: number; y: number; angle: number };
}) {
  const poseAt = o.poseAt ?? ((t: number) => ({ x: 2000 + 3 * (t - T), y: 2500 + 0.02 * (t - T) ** 2, angle: 0.01 * (t - T) }));
  let players = [{ ...shooter(o.carId, poseAt(T - 1)), statuses: o.statuses ?? [] }];
  let instances: readonly WeaponInstance[] = [];
  let seq = 0;
  let prev = 0;
  const server = new Map<number, Map<string, WeaponInstance>>();
  const fire = new LocalFire("me");
  fire.resync(viewOf(newFireState(o.carId, 1), T - 1));
  const provisionals: Provisional[] = [];
  for (let tick = T; tick <= o.until; tick++) {
    const held = o.held(tick);
    const pressed = held & ~prev;
    prev = held;
    players = players.map((p) => ({ ...p, ...poseAt(tick), fireMask: pressed }));
    const r = runCombat({
      world: { tick, dt: DT, mode: "ffa", obstacles: [], bounds: OPEN },
      players,
      instances,
      instanceSeq: seq,
      fastForward: new Map([["me", o.kServer]]),
    });
    players = r.players;
    instances = r.instances;
    seq = r.instanceSeq;
    server.set(tick, new Map(r.instances.map((i) => [i.id, i])));
    const step = fire.step({ ...frame(tick, held, poseAt(tick).angle, tick - o.kClient), weaponCooldown: o.weaponCooldown ?? 1 });
    o.onTick?.(tick, players[0]!.fireState, fire.current);
    for (const order of step.orders) {
      provisionals.push(
        ...provisionalOf(order, { sessionId: "me", team: 0, carId: o.carId, ...poseAt(tick) }, tick, step.compTicks, `p${tick}`, 0, WORLD),
      );
    }
  }
  return { server, provisionals, poseAt };
}

describe("LocalFire + provisionalOf against runCombat", () => {
  const SLOT = (s: number) => 1 << s;

  it("predicts the press the server fires, on its tick, at its pose, and none for a held key", () => {
    // Bullseye: predator on fire slot 1, pepperbox (3 pellets) on slot 2. Hold slot 1 for 20 ticks,
    // then press slot 2 while slot 1 is still held.
    const held = (t: number) => (t < T + 20 ? SLOT(1) : 0) | (t >= T + 10 && t < T + 12 ? SLOT(2) : 0);
    const { server, provisionals } = race({ carId: "bullseye", held, kServer: 0, kClient: 0, until: T + 40 });
    const spawned = [...new Map([...server.values()].flatMap((m) => [...m.values()]).map((i) => [i.id, i])).values()];
    expect(spawned.length).toBeGreaterThan(0);
    // Every server shot has exactly one provisional at the same tick, pose and heading — and no more.
    expect(provisionals.length).toBe(spawned.length);
    const shots = new ProvisionalShots();
    for (const p of provisionals) shots.add(p);
    const pairs = shots.confirm(spawned.map((i) => ({ ...i })));
    expect(pairs).toHaveLength(spawned.length);
    for (const pair of pairs) {
      const p = provisionals.find((q) => q.key === pair.provisionalKey)!;
      const s = spawned.find((i) => i.id === pair.serverId)!;
      expect(p.spawnTick).toBe(s.spawnTick);
      const born = server.get(s.spawnTick)!.get(s.id)!;
      expect(p.instance.x).toBeCloseTo(born.x, 9);
      expect(p.instance.y).toBeCloseTo(born.y, 9);
      expect(p.instance.angle).toBeCloseTo(born.angle, 12);
    }
  });

  it("fires a key held past its cooldown once, as the server does: a press is an edge, not a held bit", () => {
    const until = T + weaponTicksOf("predator").cooldown + weaponTicksOf("predator").refireDelay + 30;
    const { server, provisionals } = race({ carId: "bullseye", held: () => SLOT(1), kServer: 0, kClient: 0, until });
    expect(new Set([...server.values()].flatMap((m) => [...m.keys()])).size).toBe(1);
    expect(provisionals).toHaveLength(1);
  });

  it("tracks the server's fire state tick for tick under a weaponCooldown status, across held and re-pressed fire", () => {
    // No shipped status scales `weaponCooldown`, so this run's bundle gives `overheated` one (and no burn).
    const base = modeConfigOf(DEFAULT_GAME_MODE);
    const tables = structuredClone(base) as ModeTables;
    (tables.statusTable as Record<string, StatusDef>).overheated = {
      ...base.statusTable.overheated, modifiers: { weaponCooldown: 0.5 }, pulse: undefined,
    };
    installMode(assembleModeConfig(base.id, tables));
    const statuses = [{ statusId: "overheated" as const, startTick: 0, endsTick: 1e9, sourceSessionId: "" }];
    expect(modifiersOf(statuses, T).weaponCooldown).toBe(0.5);
    // Held for 60 ticks at a time, released for 7: pepperbox, then predator, then both.
    const held = (t: number) => {
      const phase = (t - T) % 67;
      const round = Math.floor((t - T) / 67) % 3;
      return phase < 60 ? (round === 0 ? SLOT(2) : round === 1 ? SLOT(1) : SLOT(1) | SLOT(2)) : 0;
    };
    let compared = 0;
    let fired = 0;
    const { provisionals } = race({
      carId: "bullseye", held, kServer: 4, kClient: 4, until: T + 600, statuses, weaponCooldown: 0.5,
      onTick: (tick, server, client) => {
        expect(client, `tick ${tick}`).toEqual(server);
        compared++;
      },
    });
    fired = provisionals.length;
    expect(compared).toBe(601);
    expect(fired).toBeGreaterThan(10);
  });

  it("refuses what the server refuses: a press inside the refire lock, a slot with no stock, the disabled basic attack", () => {
    // Predator re-pressed every 4 ticks: only the presses past its lock fire, on both sides.
    const held = (t: number) => ((t - T) % 8 < 4 ? SLOT(1) : 0);
    const { server, provisionals } = race({ carId: "bullseye", held, kServer: 0, kClient: 0, until: T + 200 });
    const ids = new Set([...server.values()].flatMap((m) => [...m.keys()]));
    expect(provisionals.length).toBe(ids.size);
    expect(ids.size).toBeGreaterThan(1);

    expect(slots().basicAttackEnabled).toBe(false);
    const basic = race({ carId: "bullseye", held: () => SLOT(0), kServer: 0, kClient: 0, until: T + 5 });
    expect(basic.provisionals).toEqual([]);

    const empty = new LocalFire("me");
    const state = newFireState("bullseye", 1);
    state.slots[1] = { ...state.slots[1]!, stocks: 0 };
    empty.resync(viewOf(state, T - 1));
    expect(empty.step(frame(T, SLOT(1), 0)).orders).toEqual([]);
  });

  it("releases a wind-up weapon (lance) on the server's release tick, not the press", () => {
    const { server, provisionals } = race({ carId: "bullseye", held: (t) => (t === T ? SLOT(3) : 0), kServer: 0, kClient: 0, until: T + 60 });
    const startUp = weaponTicksOf("lance").startUp;
    expect(startUp).toBeGreaterThan(0);
    expect(provisionals).toHaveLength(1);
    expect(provisionals[0]!.spawnTick).toBe(T + startUp);
    const born = [...server.get(T + startUp)!.values()].find((i) => i.weaponId === "lance")!;
    expect(born.spawnTick).toBe(T + startUp);
  });

  it("a snapshot mid-press does not reseed; a quiet one after it does", () => {
    const fire = new LocalFire("me");
    const fresh = newFireState("bullseye", 1);
    fire.resync(viewOf(fresh, T - 1));
    expect(fire.step(frame(T, SLOT(1), 0)).orders).toHaveLength(1);
    // A snapshot from BEFORE the press arrives, still showing the stock: it must not hand it back.
    fire.resync(viewOf(fresh, T - 1));
    expect(fire.step(frame(T + 1, 0, 0)).orders).toEqual([]);
    expect(fire.step(frame(T + 2, SLOT(1), 0)).orders).toEqual([]);
    // Once a snapshot past the press says the slot is ready again, it is believed.
    fire.resync(viewOf(fresh, T + 2));
    expect(fire.step(frame(T + 3, 0, 0)).orders).toEqual([]);
    expect(fire.step(frame(T + 4, SLOT(1), 0)).orders).toHaveLength(1);
  });

  it("fireStateOf refuses a snapshot mid-press (volleys left and compensation are server-only)", () => {
    expect(fireStateOf(viewOf(newFireState("bullseye", 1), T, T + 5))).toBeUndefined();
    expect(fireStateOf(viewOf(newFireState("bullseye", 1), T, T))).toBeDefined();
  });

  it("hands over without a jump when the client's compensation is the server's, and by one step when it is not", () => {
    // The shot is drawn at the local present: the server's instance from its snapshot through
    // `ShotView`, the provisional through its own view. Snapshot arrives `lag` ticks after the press.
    const measure = (kServer: number, kClient: number, lag: number) => {
      const held = (t: number) => (t === T ? SLOT(2) : 0); // pepperbox: 3 pellets from each muzzle
      const { server, provisionals } = race({ carId: "bullseye", held, kServer, kClient, until: T + lag });
      const shots = new ProvisionalShots();
      for (const p of provisionals) shots.add(p, WORLD);
      const snap = T + lag;
      const view = new ShotView(shotViewMaxTicks());
      const drawTick = snap + lag + 0.4; // the local car runs ~ one more lag ahead of the snapshot
      const pairs = shots.confirm([...server.get(snap)!.values()], drawTick);
      expect(pairs.length).toBe(provisionals.length);
      expect(pairs.length).toBeGreaterThan(1);
      let worst = 0;
      for (const pair of pairs) {
        const row = server.get(snap)!.get(pair.serverId)!;
        view.update(row.id, snap, shotFromWire(wireOf(row), snap)!, { dt: DT, tick: snap, ...WORLD, ownerPose: null, homingTarget: null });
        const to = view.at(row.id, drawTick)!;
        worst = Math.max(worst, Math.hypot(pair.from!.x - to.x, pair.from!.y - to.y));
      }
      return worst;
    };
    // LAN-like (k 5, snapshot 3 ticks later) and net80clean-like (k 9, snapshot 8 ticks later).
    expect(measure(5, 5, 3)).toBeLessThan(1e-6);
    expect(measure(9, 9, 8)).toBeLessThan(1e-6);
    // The server clamped one tick lower than the client: one step of pepperbox's flight.
    expect(measure(8, 9, 8)).toBeCloseTo(800 * DT, 6);
  });

  it("hands an attached beam over welded to the DRAWN car: no car motion in the gap, at top speed and turning", () => {
    // Mirage's afterburner (fire slot 3) and Bullseye's lance (slot 3, a wind-up): the shooter drives
    // at Mirage's top speed and turns. The server's instance arrives `lag` ticks after the release and
    // is drawn `lag` more ticks on, welded to the drawn car — and so is the provisional it replaces.
    const speed = 283.5 / 60; // u per tick
    const poseAt = (t: number) => ({ x: 2000 + speed * (t - T) * Math.cos(0.02 * (t - T)), y: 2500 + speed * (t - T) * Math.sin(0.02 * (t - T)), angle: 0.02 * (t - T) });
    for (const [carId, weaponId] of [["mirage", "afterburner"], ["bullseye", "lance"]] as const) {
      const lag = 8;
      const k = 5;
      const { server, provisionals } = race({ carId, held: (t) => (t === T ? SLOT(3) : 0), kServer: k, kClient: k, until: T + 80, poseAt });
      expect(provisionals.length).toBeGreaterThan(0);
      const p = provisionals[0]!; // the first muzzle (afterburner has two)
      expect(p.instance.weaponId).toBe(weaponId);
      expect(p.instance.attached).toBe(true);
      const snap = p.spawnTick + lag;
      const drawTick = snap + lag + 0.4;
      const turn = (i: WeaponInstance) => Math.abs(Math.atan2(Math.sin(i.angle - p.instance.angle), Math.cos(i.angle - p.instance.angle)));
      const row = [...server.get(snap)!.values()].filter((i) => i.weaponId === weaponId).sort((a, b) => turn(a) - turn(b))[0]!;
      const drawnOwner = poseAt(drawTick);
      // Without the drawn owner, the provisional would hand over from its release-tick muzzle: tens of units off.
      const loose = new ProvisionalShots();
      loose.add(p, WORLD);
      const unwelded = loose.confirm([row], drawTick)[0]!.from!;
      const shots = new ProvisionalShots();
      shots.add(p, WORLD);
      const pair = shots.confirm([row], drawTick, drawnOwner)[0]!;
      const view = new ShotView(shotViewMaxTicks());
      view.update(row.id, snap, shotFromWire(wireOf(row), snap)!, { dt: DT, tick: snap, ...WORLD, ownerPose: poseAt(snap), homingTarget: null });
      const to = { ...view.at(row.id, drawTick, drawnOwner)! };
      expect(Math.hypot(unwelded.x - to.x, unwelded.y - to.y)).toBeGreaterThan(20);
      expect(Math.hypot(pair.from!.x - to.x, pair.from!.y - to.y)).toBeLessThan(1e-6);
      // Every frame of the ease: the confirmed beam's origin stays on the drawn car's beam origin.
      shots.beginHandover(row.id, pair.from!, to, 0);
      for (let ms = 0; ms <= NET_CONFIG.provisionalShotEaseMs; ms += 16) {
        const frameTick = drawTick + ms / MS_PER_TICK;
        const owner = poseAt(frameTick);
        const drawn = { ...view.at(row.id, frameTick, owner)! };
        const welded = { x: drawn.x, y: drawn.y };
        shots.applyHandover(row.id, drawn, ms);
        expect(Math.hypot(drawn.x - welded.x, drawn.y - welded.y), `${weaponId} at ${ms} ms`).toBeLessThan(1e-6);
      }
    }
  });

  it("sizes the provisional view to fly a shot past the enemy cap by the most compensation", () => {
    expect(provisionalViewMaxTicks()).toBe(shotViewMaxTicks() + msToTicks(NET_CONFIG.shotCompCapMs));
  });
});

describe("I1: a point-blank shot that ends inside its fast-forward (k > 0)", () => {
  // Mirage's fire slot 1, magmablast: a 10 u/tick shell, aimed at a car about two ticks of travel off
  // its muzzle, pressed with k = 6 — the server ends it on its birth tick, inside its fast-forward.
  const MAGMA = 0b0010;
  const K = 6;
  const pose = { x: 1000, y: 1000, angle: 0 };
  function fire(target: boolean) {
    const victim: CombatPlayer = { ...shooter("bastion", { x: 1100, y: 1000, angle: Math.PI / 2 }), sessionId: "them" };
    return runCombat({
      world: { tick: T, dt: DT, mode: "ffa", obstacles: [], bounds: OPEN },
      players: [{ ...shooter("mirage", pose), fireMask: MAGMA }, ...(target ? [victim] : [])],
      instances: [],
      instanceSeq: 0,
      fastForward: new Map([["me", K]]),
    });
  }

  it("is sent as an ended row the shooter's provisional confirms against, ending it at the server's end point", () => {
    const r = fire(true);
    expect(r.instances.filter((i) => !i.isExplosion)).toHaveLength(0);
    const end = r.ended.find((i) => !i.isExplosion)!;
    expect(end.alive).toBe(false);
    // The shooter's provisional for the same press, born the same k ticks old.
    const order = { weaponId: "magmablast" as const, slot: 1, finalVolley: true, pressId: "" };
    const provs = provisionalOf(order, { sessionId: "me", team: 0, carId: "mirage", ...pose }, T, K, "p", 0, WORLD);
    const shots = new ProvisionalShots();
    for (const p of provs) shots.add(p, WORLD);
    // Two ticks later (the confirm cannot arrive sooner) the provisional — which knows no cars — is
    // drawn past the server's end point, through the car it hit…
    const drawTick = T + 2;
    expect(shots.at(provs[0]!.key, drawTick)!.x).toBeGreaterThan(end.x);
    // …until the ended row confirms it, which ends it: nothing is drawn after, and nothing lingers.
    const pairs = shots.confirm([{ ...wireOf(end), alive: end.alive }], drawTick);
    expect(pairs).toEqual([{ provisionalKey: provs[0]!.key, serverId: end.id, ended: true }]);
    expect(shots.list()).toHaveLength(0);
    expect(shots.at(provs[0]!.key, drawTick)).toBeUndefined();
    expect(shots.expireBySnapshot(T + 100)).toEqual([]);
  });

  it("with no ended row (the pre-fix wire) the provisional still goes at spawnTick + provisionalShotMatchTicks", () => {
    const r = fire(true);
    const order = { weaponId: "magmablast" as const, slot: 1, finalVolley: true, pressId: "" };
    const shots = new ProvisionalShots();
    for (const p of provisionalOf(order, { sessionId: "me", team: 0, carId: "mirage", ...pose }, T, K, "p", 0, WORLD)) shots.add(p, WORLD);
    const live = r.instances.map(wireOf);
    for (let snap = T; snap < T + NET_CONFIG.provisionalShotMatchTicks; snap++) {
      shots.confirm(live);
      expect(shots.expireBySnapshot(snap)).toEqual([]);
    }
    expect(shots.expireBySnapshot(T + NET_CONFIG.provisionalShotMatchTicks)).toHaveLength(1);
  });
});
