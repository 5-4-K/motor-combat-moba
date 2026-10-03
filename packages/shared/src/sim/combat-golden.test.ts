import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { withMode } from "../modes/active.js";
import { assembleModeConfig } from "../modes/build.js";
import type { ModeConfig, ModeTables } from "../modes/types.js";
import type { CarId } from "../config/types.js";
import { hpOf } from "../config/car-config.js";
import type { Aabb } from "./collide.js";
import { runCombat, type CombatPlayer, type CombatWorld } from "./combat.js";
import { newCombatEvents } from "./combat-events.js";
import { ManeuverKind } from "./maneuver.js";
import { expireStatuses } from "./status/statuses.js";
import { newFireState } from "./weapons/fire.js";
import type { WeaponInstance } from "./weapons/instances.js";

/**
 * Golden regression guard for `runCombat`'s press phase and shot fast-forward (Phase F, F4 re-review
 * N1). A seeded six-car scenario — three chassis twice, circling the arena so their shots cross and
 * land, pressing random slots with a random shot-compensation budget `k` in [0, 9] on every tick —
 * is run for `TICKS` ticks, and every tick's `fired` events, every car's full fire state, hp and
 * maneuver, and every live instance (id, pose, clocks) is folded into a hash. The hashes below were
 * captured at `0e602b6e`, whose press phase (`sim/weapons/press.ts`) and fast-forward (`runAhead`)
 * had been reviewed. A reordered or dropped gate in `pressPhase`, a fast-forward that steps once too
 * often or resolves out of order, a backdated clock that moved — any of them moves a hash. No shell
 * in THIS scenario detonates inside its fast-forward, so the burst-ageing path (`settleBurst`) is the
 * second scenario's, below (M3).
 *
 * Pinned against a FROZEN bundle, `__fixtures__/combat-golden.tables.json`, not the live tables —
 * the same rule `golden.test.ts` follows for drive: a balance edit to a weapon, a car or a status can
 * never move these numbers, so one that moves did not come from balance. It is the Deathmatch
 * bundle's resolved tables at `0e602b6e` with one deliberate change, `slots.basicAttackEnabled:
 * true`, so fire slot 0 fires and the turret branch of the press phase (`turnTurret`, a frozen aim
 * bearing) is exercised too. Three things still reach it from outside the fixture: the OBB hull
 * (`DRIVE_CONFIG.carWidth`/`carHeight`, global by type), `TICK_RATE_HZ` (through `msToTicks`), and
 * `NET_CONFIG.shotCompCapMs` (`pressPhase`'s defensive clamp — the scenario never exceeds 9).
 *
 * If a hash moves, find the first checkpoint that differs: the failure names its tick window. Do
 * not re-record unless the change to combat's per-tick behaviour is deliberate and understood.
 */

const TICKS = 1200;
const CHECKPOINT_TICKS = 100;
const CARS: readonly CarId[] = ["mirage", "bullseye", "bastion", "mirage", "bullseye", "bastion"];
/** A press on some slot on roughly one tick in ten per car. */
const PRESS_CHANCE = 0.1;
/** The most shot compensation a press is handed (`shotCompCapMs` 150 ms = 9 ticks). */
const MAX_K = 9;
/** Ticks a wreck waits before the scenario puts it back on the field at full hp. */
const REVIVE_TICKS = 45;
const CENTRE = { x: 640, y: 360 };
const BOUNDS = { width: 1280, height: 720 };
/** One box in the middle of the ring, so shots stop on walls as well as cars and the boundary. */
const OBSTACLES: readonly Aabb[] = [{ x: 600, y: 330, w: 80, h: 60 }];
const DT = 1 / 60;

function fixtureBundle(): ModeConfig {
  const url = new URL("./__fixtures__/combat-golden.tables.json", import.meta.url);
  const tables = JSON.parse(readFileSync(url, "utf8")) as ModeTables;
  return assembleModeConfig(GameMode.FFA_DEATHMATCH, tables);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Canonical text of anything the trace records: sorted keys, Maps as sorted entries, 12 significant digits. */
function canon(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toPrecision(12)) : String(value);
  if (value instanceof Map) return [...value.entries()].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)).map(([k, v]) => [k, canon(v)]);
  if (Array.isArray(value)) return value.map(canon);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner !== undefined) out[key] = canon(inner);
    }
    return out;
  }
  return value;
}

/** Where car `i` stands on `tick`: a ring around the box, each car its own speed and phase, nose along its path with a wobble. */
function poseOf(i: number, tick: number): { x: number; y: number; angle: number } {
  const radius = 180 + 40 * i;
  const w = (0.006 + 0.0015 * i) * (i % 2 === 0 ? 1 : -1);
  const phase = (i * Math.PI) / 3 + w * tick;
  const x = CENTRE.x + radius * Math.cos(phase) * 1.4;
  const y = CENTRE.y + Math.min(radius, 300) * Math.sin(phase);
  const tangent = phase + (w > 0 ? Math.PI / 2 : -Math.PI / 2);
  return { x, y, angle: tangent + 0.6 * Math.sin(tick * 0.05 + i) };
}

interface Trace {
  checkpoints: string[];
  whole: string;
  fired: number;
  firedWithK: number;
  spawned: number;
  hpLost: number;
  deaths: number;
}

function runScenario(seed: number): Trace {
  const rng = mulberry32(seed);
  const players: CombatPlayer[] = CARS.map((carId, i) => ({
    sessionId: `car${i}`,
    ...poseOf(i, 0),
    team: 0,
    carId,
    hp: hpOf(carId),
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState: newFireState(carId, 1),
    statuses: [],
    maneuver: 0,
    maneuverTicksLeft: 0,
    maneuverAngle: 0,
    maneuverSpeed: 0,
    maneuverWeaponId: "",
    maneuverPressId: "",
    lastDamagerSessionId: "",
  }));
  const deadSince = new Map<string, number>();
  let instances: WeaponInstance[] = [];
  let instanceSeq = 0;
  const whole = createHash("sha256");
  let window = createHash("sha256");
  const checkpoints: string[] = [];
  const seenIds = new Set<string>();
  let fired = 0;
  let firedWithK = 0;
  let hpLost = 0;
  let deaths = 0;

  for (let tick = 1; tick <= TICKS; tick++) {
    const fastForward = new Map<string, number>();
    let current = players.map((p, i) => {
      const next: CombatPlayer = { ...p, ...poseOf(i, tick), statuses: expireStatuses([...p.statuses], tick) };
      // A maneuver the scenario does not drive runs out on its own count, as `stepSim` would end it.
      if (next.maneuver !== ManeuverKind.NONE) {
        next.maneuverTicksLeft -= 1;
        if (next.maneuverTicksLeft <= 0) {
          next.maneuver = ManeuverKind.NONE;
          next.maneuverTicksLeft = 0;
          next.maneuverAngle = 0;
          next.maneuverSpeed = 0;
          next.maneuverWeaponId = "";
          next.maneuverPressId = "";
        }
      }
      if (!next.alive && tick - (deadSince.get(next.sessionId) ?? tick) >= REVIVE_TICKS) {
        deadSince.delete(next.sessionId);
        next.alive = true;
        next.hp = hpOf(next.carId as CarId);
        next.statuses = [];
        next.fireState = newFireState(next.carId as CarId, 1);
      }
      // Every draw is taken every tick, whatever the car's state, so the stream never shifts.
      const press = rng() < PRESS_CHANCE;
      const bits = 1 << Math.floor(rng() * 4);
      const extra = rng() < 0.2 ? 1 << Math.floor(rng() * 4) : 0;
      const k = Math.floor(rng() * (MAX_K + 1));
      const aim = rng() * 2 * Math.PI - Math.PI;
      next.fireMask = press ? bits | extra : 0;
      next.aimBearing = press ? aim : null;
      if (k > 0) fastForward.set(next.sessionId, k);
      return next;
    });
    const events = newCombatEvents();
    const world: CombatWorld = { tick, dt: DT, mode: "ffa", obstacles: OBSTACLES, bounds: BOUNDS };
    const hpBefore = new Map(current.map((p) => [p.sessionId, p.hp]));
    const result = runCombat({ world, players: current, instances, instanceSeq, events, fastForward });
    instances = result.instances;
    instanceSeq = result.instanceSeq;
    current = result.players;
    for (const e of events.fired) {
      fired++;
      if ((fastForward.get(e.shooterSessionId) ?? 0) > 0) firedWithK++;
    }
    for (const inst of instances) seenIds.add(inst.id);
    for (const p of current) {
      hpLost += Math.max(0, (hpBefore.get(p.sessionId) ?? p.hp) - p.hp);
      if (!p.alive && !deadSince.has(p.sessionId)) {
        deadSince.set(p.sessionId, tick);
        deaths++;
      }
    }
    // Back into the scenario's own order (runCombat sorts by session id; same ids, same order here).
    const byId = new Map(current.map((p) => [p.sessionId, p]));
    for (let i = 0; i < players.length; i++) players[i] = byId.get(players[i]!.sessionId)!;

    const line = JSON.stringify(
      canon({
        tick,
        fired: events.fired,
        players: current.map((p) => ({
          id: p.sessionId,
          hp: p.hp,
          alive: p.alive,
          fireState: p.fireState,
          maneuver: p.maneuver,
          maneuverTicksLeft: p.maneuverTicksLeft,
          statuses: p.statuses,
        })),
        instances,
        instanceSeq,
      }),
    );
    whole.update(line);
    window.update(line);
    if (tick % CHECKPOINT_TICKS === 0) {
      checkpoints.push(window.digest("hex").slice(0, 16));
      window = createHash("sha256");
    }
  }
  return { checkpoints, whole: whole.digest("hex"), fired, firedWithK, spawned: seenIds.size, hpLost, deaths };
}

describe("golden: runCombat press phase and shot fast-forward", () => {
  const trace = withMode(fixtureBundle(), () => runScenario(20261003));

  it("exercises what it pins: presses with and without k, shots in flight, hits and deaths", () => {
    expect({
      fired: trace.fired,
      firedWithK: trace.firedWithK,
      spawned: trace.spawned,
      hpLost: Number(trace.hpLost.toPrecision(12)),
      deaths: trace.deaths,
    }).toEqual(GOLDEN_COUNTS);
    expect(trace.firedWithK).toBeGreaterThan(0);
    expect(trace.fired - trace.firedWithK).toBeGreaterThan(0);
    expect(trace.deaths).toBeGreaterThan(0);
  });

  it("matches the recorded trace, checkpoint by checkpoint", () => {
    trace.checkpoints.forEach((hash, i) => {
      expect(hash, `ticks ${i * CHECKPOINT_TICKS + 1}–${(i + 1) * CHECKPOINT_TICKS}`).toBe(GOLDEN_CHECKPOINTS[i]);
    });
    expect(trace.whole).toBe(GOLDEN_WHOLE);
  });

  it("is a pure function of its seed", () => {
    const again = withMode(fixtureBundle(), () => runScenario(20261003));
    expect(again.whole).toBe(trace.whole);
  });
});

/**
 * M3 (Phase F final review): the six-car scenario above never detonates a shell INSIDE a fast-forward
 * (a planted `settleBurst(burst, 0)` left it green), so this second scenario aims an explosive shell
 * (`magmablast`, Mirage's fire slot 1) point-blank: three targets 100–180 u off the muzzle, one
 * pressed at a time with a random `k` in [1, 9], so most shells hit inside their own fast-forward and
 * their bursts are born mid-loop and aged the ticks that remain. It hashes the instances AND the
 * shots `runCombat` reports as ended on their birth tick (`CombatResult.ended`, I1), and counts the
 * bursts born mid-fast-forward (first seen with a `spawnTick` before the tick), so an un-advanced
 * burst — or an ended list that lost its dead shells — moves it.
 */
const BLAST_TICKS = 1800;
const BLAST_SLOT_BIT = 0b0010;
const BLAST_TARGETS: readonly { distance: number; bearing: number }[] = [
  { distance: 100, bearing: 0 },
  { distance: 140, bearing: (2 * Math.PI) / 3 },
  { distance: 180, bearing: (4 * Math.PI) / 3 },
];
const BLAST_ORIGIN = { x: 640, y: 360 };

interface BlastTrace {
  whole: string;
  fired: number;
  ended: number;
  midLoopBursts: number;
}

function runBlastScenario(seed: number): BlastTrace {
  const rng = mulberry32(seed);
  const base = (sessionId: string, carId: CarId, x: number, y: number, angle: number): CombatPlayer => ({
    sessionId, x, y, angle, team: 0, carId, hp: hpOf(carId), alive: true, inRoster: true, fireMask: 0,
    fireState: newFireState(carId, 1), statuses: [], maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0,
    maneuverSpeed: 0, maneuverWeaponId: "", maneuverPressId: "", lastDamagerSessionId: "",
  });
  let players: CombatPlayer[] = [
    base("shooter", "mirage", BLAST_ORIGIN.x, BLAST_ORIGIN.y, 0),
    ...BLAST_TARGETS.map((t, i) =>
      base(`target${i}`, "bastion", BLAST_ORIGIN.x + t.distance * Math.cos(t.bearing), BLAST_ORIGIN.y + t.distance * Math.sin(t.bearing), t.bearing + Math.PI / 2),
    ),
  ];
  let instances: WeaponInstance[] = [];
  let instanceSeq = 0;
  const seen = new Set<string>();
  const whole = createHash("sha256");
  let fired = 0;
  let ended = 0;
  let midLoopBursts = 0;
  for (let tick = 1; tick <= BLAST_TICKS; tick++) {
    const aimAt = BLAST_TARGETS[Math.floor(tick / 40) % BLAST_TARGETS.length]!;
    const k = 1 + Math.floor(rng() * 9);
    players = players.map((p) => {
      if (p.sessionId === "shooter") return { ...p, angle: aimAt.bearing, fireMask: BLAST_SLOT_BIT, statuses: expireStatuses([...p.statuses], tick) };
      // A target the scenario keeps on the field: a wreck comes straight back at full hp.
      return p.alive ? { ...p, statuses: expireStatuses([...p.statuses], tick) } : { ...p, alive: true, hp: hpOf(p.carId as CarId), statuses: [] };
    });
    const events = newCombatEvents();
    const world: CombatWorld = { tick, dt: DT, mode: "ffa", obstacles: [], bounds: BOUNDS };
    const result = runCombat({ world, players, instances, instanceSeq, events, fastForward: new Map([["shooter", k]]) });
    players = result.players;
    instances = result.instances;
    instanceSeq = result.instanceSeq;
    fired += events.fired.length;
    ended += result.ended.length;
    for (const inst of instances) {
      if (seen.has(inst.id)) continue;
      seen.add(inst.id);
      if (inst.isExplosion && inst.spawnTick < tick) midLoopBursts++;
    }
    whole.update(
      JSON.stringify(
        canon({ tick, instances, ended: result.ended, hp: players.map((p) => [p.sessionId, p.hp, p.alive]), instanceSeq }),
      ),
    );
  }
  return { whole: whole.digest("hex"), fired, ended, midLoopBursts };
}

describe("golden: an explosive shell detonating inside its own fast-forward (M3)", () => {
  const trace = withMode(fixtureBundle(), () => runBlastScenario(20261003));

  it("exercises what it pins: bursts born mid-fast-forward and shots ended on their birth tick", () => {
    expect({ fired: trace.fired, ended: trace.ended, midLoopBursts: trace.midLoopBursts }).toEqual(BLAST_COUNTS);
    expect(trace.midLoopBursts).toBeGreaterThan(0);
    expect(trace.ended).toBeGreaterThan(0);
  });

  it("matches the recorded trace", () => {
    expect(trace.whole).toBe(BLAST_WHOLE);
  });
});

const BLAST_COUNTS = { fired: 19, ended: 5, midLoopBursts: 4 };
const BLAST_WHOLE = "3797440333549a6452d5dbcc7e57278e02ee5d59ce2e1945a52ae6480d3ee156";

const GOLDEN_COUNTS = { fired: 168, firedWithK: 154, spawned: 319, hpLost: 4163, deaths: 2 };
const GOLDEN_CHECKPOINTS: readonly string[] = [
  "2d500bdbaeee20e9",
  "e3d07a2a8add4bf2",
  "d028d7713362e791",
  "7424d8ca38d4e9c9",
  "c962dcddad09c43c",
  "35bc84b473d45334",
  "ae7b902579011bdc",
  "b7cd43eaffda97ee",
  "0d6e342c774175e0",
  "1a20b69ab51e9a16",
  "e460d6493265e2d9",
  "fd2c16ca0f7f0c35",
];
const GOLDEN_WHOLE = "ef6809ee13e8d649e22a30d2790d53b601a33aaeb6a0d2be3af091d953e225e0";
