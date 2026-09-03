import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../../arena/arena-01.js";
import { hpOf } from "../../config/car-config.js";
import { STATUS_TABLE, statusDefOf } from "../../config/status-config.js";
import { statusPulseTicksOf } from "../../config/status-ticks.js";
import { weaponTicksOf } from "../../config/weapon-ticks.js";
import { MS_PER_TICK } from "../../constants.js";
import {
  runCombat,
  type CombatPlayer,
  type CombatResult,
  type CombatWorld,
} from "../combat.js";
import { newFireState } from "../weapons/fire.js";
import { newLockState } from "../weapons/lock.js";
import { applyStatus, hasStatus, type ActiveStatus } from "./statuses.js";

/**
 * Statuses as `runCombat` sees them: pulses, the two application seams, and the aura.
 *
 * Everything here runs against the SHIPPED weapon table rather than a patched one. That is the
 * point — the mechanism is wired to real weapons now, so these tests fail if a re-tune quietly
 * unhooks one.
 */

const DT = MS_PER_TICK / 1000;
const OPEN_Y = 360;

function world(over: Partial<CombatWorld> = {}): CombatWorld {
  return {
    tick: 100,
    dt: DT,
    mode: "ffa",
    obstacles: ARENA_01.obstacles,
    bounds: { width: ARENA_01.width, height: ARENA_01.height },
    ...over,
  };
}

function player(sessionId: string, over: Partial<CombatPlayer> = {}): CombatPlayer {
  const carId = over.carId ?? "mirage";
  return {
    sessionId,
    x: 300,
    y: OPEN_Y,
    angle: 0,
    team: 0,
    carId,
    hp: hpOf(carId as "mirage"),
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState: newFireState(carId as "mirage", 1),
    lock: newLockState(),
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

function find(players: CombatPlayer[], sessionId: string): CombatPlayer {
  const found = players.find((p) => p.sessionId === sessionId);
  if (!found) throw new Error(`no player ${sessionId}`);
  return found;
}

function live(statusId: keyof typeof STATUS_TABLE, startTick: number, endsTick: number): ActiveStatus[] {
  return [{ statusId, startTick, endsTick, sourceSessionId: "" }];
}

/** Run `ticks` ticks forward from a result, firing nothing further. */
function advance(from: CombatResult, startTick: number, ticks: number): CombatResult {
  let state = from;
  for (let i = 1; i <= ticks; i++) {
    state = runCombat({
      world: world({ tick: startTick + i }),
      players: state.players.map((p) => ({ ...p, fireMask: 0 })),
      instances: state.instances,
      instanceSeq: state.instanceSeq,
    });
  }
  return state;
}

describe("status pulses", () => {
  it("removes hp on the pulse tick and not before", () => {
    // `overheated` carries the pulse since the 2026-09-01 overhaul (O4: pure burn) — `spiked` lost
    // its bleed to it.
    const interval = statusPulseTicksOf("overheated");
    const damage = statusDefOf("overheated").pulse!.damage!;
    const full = hpOf("mirage");

    const before = runCombat({
      world: world({ tick: 100 + interval - 1 }),
      players: [player("aaa", { statuses: live("overheated", 100, 400) })],
      instances: [],
      instanceSeq: 0,
    });
    expect(find(before.players, "aaa").hp).toBe(full);

    const on = runCombat({
      world: world({ tick: 100 + interval }),
      players: [player("aaa", { statuses: live("overheated", 100, 400) })],
      instances: [],
      instanceSeq: 0,
    });
    expect(find(on.players, "aaa").hp).toBe(full - damage);
  });

  it("wrecks a car whose burn takes it to 0, by the same path a bullet does", () => {
    const interval = statusPulseTicksOf("overheated");
    const result = runCombat({
      world: world({ tick: 100 + interval }),
      players: [player("aaa", { hp: 5, statuses: live("overheated", 100, 400) })],
      instances: [],
      instanceSeq: 0,
    });
    const dead = find(result.players, "aaa");
    expect(dead.hp).toBe(0);
    expect(dead.alive).toBe(false);
  });

  it("denies the last shot to a car its own burn killed this tick", () => {
    // Pulses run before firing precisely so this is true: you died to the burn already on you.
    const interval = statusPulseTicksOf("overheated");
    const result = runCombat({
      world: world({ tick: 100 + interval }),
      players: [player("aaa", { hp: 5, fireMask: 0b001, statuses: live("overheated", 100, 400) })],
      instances: [],
      instanceSeq: 0,
    });
    expect(find(result.players, "aaa").alive).toBe(false);
    expect(result.instances).toHaveLength(0);
  });

  it("does not burn a wreck", () => {
    const interval = statusPulseTicksOf("overheated");
    const result = runCombat({
      world: world({ tick: 100 + interval }),
      players: [player("aaa", { hp: 0, alive: false, statuses: live("overheated", 100, 400) })],
      instances: [],
      instanceSeq: 0,
    });
    expect(find(result.players, "aaa").hp).toBe(0);
    expect(find(result.players, "aaa").alive).toBe(false);
  });
});

describe("the room's status request queue", () => {
  it("puts the requested status on the named car for the duration the room asked for", () => {
    const result = runCombat({
      world: world(),
      players: [player("aaa")],
      instances: [],
      instanceSeq: 0,
      statusRequests: [{ targetSessionId: "aaa", statusId: "overhauled", durationTicks: 40 }],
    });
    const target = find(result.players, "aaa");
    expect(hasStatus(target.statuses, "overhauled", 100)).toBe(true);
    expect(target.statuses[0]!.startTick).toBe(100);
    expect(target.statuses[0]!.endsTick).toBe(140);
  });

  it("delivers the repair a pickup will want: strips debuffs, restores no hp", () => {
    const hurt = 200;
    const result = runCombat({
      world: world(),
      players: [player("aaa", { hp: hurt, statuses: live("spiked", 90, 400) })],
      instances: [],
      instanceSeq: 0,
      statusRequests: [{ targetSessionId: "aaa", statusId: "overhauled", durationTicks: 30 }],
    });
    const target = find(result.players, "aaa");
    expect(hasStatus(target.statuses, "spiked", 100)).toBe(false);
    expect(target.hp).toBe(hurt);
  });

  it("ignores a request for a car that is not in the fight, and an unknown id", () => {
    const result = runCombat({
      world: world(),
      players: [player("aaa", { alive: false }), player("bbb", { inRoster: false, x: 900 })],
      instances: [],
      instanceSeq: 0,
      statusRequests: [
        { targetSessionId: "aaa", statusId: "corroded", durationTicks: 40 },
        { targetSessionId: "bbb", statusId: "corroded", durationTicks: 40 },
        { targetSessionId: "nobody", statusId: "corroded", durationTicks: 40 },
        { targetSessionId: "aaa", statusId: "nonsense" as never, durationTicks: 40 },
      ],
    });
    for (const p of result.players) expect(p.statuses).toHaveLength(0);
  });

  it("does not bite on the tick it lands", () => {
    const withRequest = runCombat({
      world: world(),
      players: [player("aaa", { hp: 100, statuses: live("spiked", 99, 400) })],
      instances: [],
      instanceSeq: 0,
      statusRequests: [{ targetSessionId: "aaa", statusId: "overhauled", durationTicks: 30 }],
    });
    // The cleanse landed, but the modifiers this tick were read before it: a request cannot
    // retroactively change what already happened on the tick it arrived.
    expect(hasStatus(find(withRequest.players, "aaa").statuses, "spiked", 100)).toBe(false);
  });
});

describe("weapons apply statuses", () => {
  /** A shooter facing a target close enough for one press to land within a few ticks. */
  function duel(shooterOver: Partial<CombatPlayer> = {}): CombatPlayer[] {
    return [
      player("aaa", { fireMask: 0b001, x: 300, angle: 0, ...shooterOver }),
      player("bbb", { x: 360, team: 1 }),
    ];
  }

  it("thumper spikes what it hits, for its own authored duration", () => {
    // The 2026-09-01 overhaul moved hard CC off this row entirely: `thumper` now spikes
    // (`spiked`, a pure slow) rather than stunning — hard CC is `roadblock`'s job now. `thumper` is
    // slow (450 u/s), so this needs a few ticks of flight to connect.
    const shooter = { carId: "bastion" as const, fireState: newFireState("bastion", 1) };
    let state = runCombat({
      world: world(),
      players: duel(shooter),
      instances: [],
      instanceSeq: 0,
    });
    state = advance(state, 100, 10);

    const hit = find(state.players, "bbb");
    expect(hit.hp).toBeLessThan(hpOf("mirage"));
    expect(hasStatus(hit.statuses, "spiked", 110)).toBe(true);
    // The shooter is the source, and never a target of its own opponent-facing application.
    expect(hit.statuses[0]!.sourceSessionId).toBe("aaa");
    expect(find(state.players, "aaa").statuses).toHaveLength(0);

    const applied = hit.statuses[0]!;
    expect(applied.endsTick - applied.startTick).toBe(weaponTicksOf("thumper").applyDurations[0]);
  });

  it("an armored car takes 0 from a landed shot but still receives its riders", () => {
    // O7: armour stops hp loss, not consequences — the rider still lands. Applied with startTick 99
    // so it is already live by tick 100, where `world()` starts: statuses take hold the tick AFTER
    // they land, so applying it on the tick under test would be too late to gate that tick's hit.
    const shooter = { carId: "bastion" as const, fireState: newFireState("bastion", 1) };
    const target = { statuses: applyStatus([], "armored", 99, 300, "") };
    let state = runCombat({
      world: world(),
      players: duel(shooter).map((p) => (p.sessionId === "bbb" ? { ...p, ...target } : p)),
      instances: [],
      instanceSeq: 0,
    });
    state = advance(state, 100, 10);

    const hit = find(state.players, "bbb");
    expect(hit.hp).toBe(hpOf("mirage"));
    // The rider still rides — `thumper` still applies `spiked` (a pure slow, not the hard CC that
    // lives on `roadblock` now, per the 2026-09-01 redistribution).
    expect(hasStatus(hit.statuses, "spiked", 110)).toBe(true);
  });

  it("wildcharge fortifies the car that deployed it, whether or not it catches anyone", () => {
    // The roster's only `self` application, and the only one that needs no hit at all. A maneuver
    // press (`startManeuver`) applies self statuses exactly like a weapon press does (combat.ts).
    const result = runCombat({
      world: world(),
      players: [
        player("aaa", { carId: "bastion", fireState: newFireState("bastion", 1), fireMask: 0b100 }),
      ],
      instances: [],
      instanceSeq: 0,
    });
    const owner = find(result.players, "aaa");
    expect(hasStatus(owner.statuses, "fortified", 100)).toBe(true);
    expect(owner.statuses[0]!.sourceSessionId).toBe("aaa");
  });

  it("applies a `self` status only when a shot actually goes out", () => {
    // A press the cooldown rejects buys nothing: the first press fires and fortifies, the second is
    // refused and must not top the buff up.
    const first = runCombat({
      world: world(),
      players: [
        player("aaa", { carId: "bastion", fireState: newFireState("bastion", 1), fireMask: 0b100 }),
      ],
      instances: [],
      instanceSeq: 0,
    });
    const applied = find(first.players, "aaa").statuses[0]!;

    const second = runCombat({
      world: world({ tick: 101 }),
      players: first.players.map((p) => ({ ...p, fireMask: 0b100 })),
      instances: first.instances,
      instanceSeq: first.instanceSeq,
    });
    const after = find(second.players, "aaa").statuses[0]!;
    expect(after.endsTick).toBe(applied.endsTick);
  });

  it("carries no status onto a car the shot never damaged", () => {
    // Same team in team mode: `canDamage` refuses, so there is no hit for a status to ride.
    let state = runCombat({
      world: world({ mode: "team" }),
      players: [
        player("aaa", { carId: "bullseye", fireState: newFireState("bullseye", 1), fireMask: 0b001, x: 300 }),
        player("bbb", { x: 360, team: 0 }),
      ],
      instances: [],
      instanceSeq: 0,
    });
    for (let i = 1; i <= 10; i++) {
      state = runCombat({
        world: world({ tick: 100 + i, mode: "team" }),
        players: state.players.map((p) => ({ ...p, fireMask: 0 })),
        instances: state.instances,
        instanceSeq: state.instanceSeq,
      });
    }
    expect(find(state.players, "bbb").statuses).toHaveLength(0);
  });

  it("`disarmed` blocks a new press and spends no stock", () => {
    const jammed = runCombat({
      world: world(),
      players: [player("aaa", { fireMask: 0b001, statuses: live("stunned", 99, 400) })],
      instances: [],
      instanceSeq: 0,
    });
    expect(jammed.instances).toHaveLength(0);
    expect(find(jammed.players, "aaa").fireState.slots[0]!.stocks).toBe(1);
  });

  it("`disarmed` lets a press already committed finish", () => {
    // `lance` has a 700ms wind-up, so a press on tick 100 is still pending on 101. It is
    // Bullseye's slot 3 as of the 2026-09-01 overhaul, and now the only weapon in the table with a
    // wind-up at all — every row that used to carry one (`skewer`) is retired.
    const pressed = runCombat({
      world: world(),
      players: [player("aaa", { carId: "bullseye", fireState: newFireState("bullseye", 1), fireMask: 0b100 })],
      instances: [],
      instanceSeq: 0,
    });
    expect(pressed.instances).toHaveLength(0);
    expect(find(pressed.players, "aaa").fireState.pending).not.toBeNull();

    let state = pressed;
    for (let tick = 101; tick < 130 && state.instances.length === 0; tick++) {
      state = runCombat({
        world: world({ tick }),
        players: state.players.map((p) => ({ ...p, fireMask: 0, statuses: live("stunned", 99, 400) })),
        instances: state.instances,
        instanceSeq: state.instanceSeq,
      });
    }
    expect(state.instances).toHaveLength(1);
  });

  it("`damageTaken` scales what a landing shot costs the target", () => {
    const land = (statuses: ActiveStatus[]) => {
      let state = runCombat({
        world: world(),
        players: [
          player("aaa", { carId: "bullseye", fireState: newFireState("bullseye", 1), fireMask: 0b001, x: 300 }),
          player("bbb", { x: 360, team: 1, statuses }),
        ],
        instances: [],
        instanceSeq: 0,
      });
      state = advance(state, 100, 10);
      return hpOf("mirage") - find(state.players, "bbb").hp;
    };
    const plain = land([]);
    expect(plain).toBeGreaterThan(0);
    expect(land(live("corroded", 99, 400))).toBeGreaterThan(plain);
    expect(land(live("fortified", 99, 400))).toBeLessThan(plain);
  });

  it("reads a car's modifiers once, from the list it was handed", () => {
    // A status lapsing on this very tick must not act on it.
    const lapsed = runCombat({
      world: world({ tick: 100 }),
      players: [player("aaa", { fireMask: 0b001, statuses: live("stunned", 60, 100) })],
      instances: [],
      instanceSeq: 0,
    });
    expect(lapsed.instances).toHaveLength(1);
  });
});

// "the aura" describe block drove the OLD `shockwave` — Mirage's slot 2, a car-centred `disc`
// hitbox at `origin: "center"`, three waves 500ms apart, `onWave: "final"` carrying `corroded` —
// through this same real-row `runCombat` pipeline. As of the 2026-09-01 overhaul that row became a
// single-volley projectile dart (`magmablast`, née `shockwave`) — which the 2026-09-02 loadout swap
// then moved onto Mirage's own slot 1, and which is no longer a plain dart either, having since
// gained an on-death explosion. mirage's old slot 2 is now `thunderclap`, a dash maneuver, so
// nothing on this roster carries multi-wave volleys or `onWave` any more — those two stay dormant
// machinery. The `disc`/`origin: "center"` aura itself is NOT dormant: `magmablast`'s explosion is a
// real detached, centre-origin `disc` instance, synthesized by `instanceDefOf` and driven through
// this same `runCombat` pipeline by `combat.test.ts`'s "magma blast detonation" describe block.
