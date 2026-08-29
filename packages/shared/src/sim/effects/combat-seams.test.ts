import { describe, expect, it } from "vitest";
import { ARENA_01 } from "../../arena/arena-01.js";
import { hpOf } from "../../config/car-config.js";
import { EFFECT_TABLE } from "../../config/effect-config.js";
import { effectTicksOf } from "../../config/effect-ticks.js";
import { WEAPON_TABLE } from "../../config/weapon-config.js";
import type { WeaponDef, WeaponId } from "../../config/weapon-types.js";
import { MS_PER_TICK } from "../../constants.js";
import {
  runCombat,
  type CombatPlayer,
  type CombatWorld,
  type EffectRequest,
} from "../combat.js";
import { scaleDamage } from "../damage.js";
import { newFireState } from "../weapons/fire.js";
import { newLockState } from "../weapons/lock.js";
import { hasEffect, type ActiveEffect } from "./effects.js";

/**
 * The two ways an effect gets onto a car: a weapon's `onHit`, and the room's request queue.
 *
 * Nothing in the shipped tables uses either — no weapon carries an `onHit` list and no pickup system
 * exists — so these tests are what keep both seams honest until something does. Without them the
 * first weapon to want a debuff would be discovering the mechanism rather than using it.
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
  return {
    sessionId,
    x: 300,
    y: OPEN_Y,
    angle: 0,
    team: 0,
    carId: "rectangle",
    hp: hpOf("rectangle"),
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState: newFireState("rectangle", 1),
    lock: newLockState(),
    effects: [],
    ...over,
  };
}

function find(players: CombatPlayer[], sessionId: string): CombatPlayer {
  const found = players.find((p) => p.sessionId === sessionId);
  if (!found) throw new Error(`no player ${sessionId}`);
  return found;
}

function live(effectId: keyof typeof EFFECT_TABLE, endsTick = 100_000): ActiveEffect[] {
  return [{ effectId, endsTick, stacks: 1, sourceSessionId: "" }];
}

describe("the room's effect request queue", () => {
  it("puts the requested effect on the named car", () => {
    const result = runCombat({
      world: world(),
      players: [player("aaa")],
      instances: [],
      instanceSeq: 0,
      effectRequests: [{ targetSessionId: "aaa", effectId: "overdrive", sourceSessionId: "" }],
    });
    const target = find(result.players, "aaa");
    expect(hasEffect(target.effects, "overdrive", 100)).toBe(true);
    expect(target.effects[0]!.endsTick).toBe(100 + effectTicksOf("overdrive"));
  });

  it("records the source when one is given, and the world when it is not", () => {
    const result = runCombat({
      world: world(),
      players: [player("aaa"), player("bbb", { x: 500 })],
      instances: [],
      instanceSeq: 0,
      effectRequests: [
        { targetSessionId: "aaa", effectId: "overdrive", sourceSessionId: "bbb" },
        { targetSessionId: "bbb", effectId: "primed" },
      ],
    });
    expect(find(result.players, "aaa").effects[0]!.sourceSessionId).toBe("bbb");
    expect(find(result.players, "bbb").effects[0]!.sourceSessionId).toBe("");
  });

  it("ignores a request for a car that is not in the fight", () => {
    const result = runCombat({
      world: world(),
      players: [player("aaa", { alive: false }), player("bbb", { inRoster: false, x: 500 })],
      instances: [],
      instanceSeq: 0,
      effectRequests: [
        { targetSessionId: "aaa", effectId: "overdrive" },
        { targetSessionId: "bbb", effectId: "overdrive" },
        { targetSessionId: "nobody", effectId: "overdrive" },
      ],
    });
    for (const p of result.players) expect(p.effects).toHaveLength(0);
  });

  it("validates the id, because this is the one combat input that is not a table", () => {
    const result = runCombat({
      world: world(),
      players: [player("aaa")],
      instances: [],
      instanceSeq: 0,
      // A pickup system reading ids out of arena config could hand over anything.
      effectRequests: [{ targetSessionId: "aaa", effectId: "nonsense" as never }] as EffectRequest[],
    });
    expect(find(result.players, "aaa").effects).toHaveLength(0);
  });

  it("does not bite on the tick it lands — a crate and a shot cannot race", () => {
    // `overdrive` raises `damageDealt`? No — it raises speed. `primed` is the damage one, so a
    // request for it must NOT change what a shot fired on the same tick costs.
    const withRequest = runCombat({
      world: world(),
      players: [player("aaa", { fireMask: 0b001 })],
      instances: [],
      instanceSeq: 0,
      effectRequests: [{ targetSessionId: "aaa", effectId: "primed" }],
    });
    const without = runCombat({
      world: world(),
      players: [player("aaa", { fireMask: 0b001 })],
      instances: [],
      instanceSeq: 0,
    });
    expect(withRequest.instances[0]!.damage).toBe(without.instances[0]!.damage);
  });
});

describe("a weapon's onHit list", () => {
  /**
   * No shipped weapon carries an `onHit` list, so the seam has to be exercised against a table row
   * patched for the length of one test. Restored in a `finally` so a failure cannot leak into
   * another file — `WEAPON_TABLE` is module state shared by the whole suite.
   */
  function withOnHit<T>(weaponId: WeaponId, onHit: readonly (keyof typeof EFFECT_TABLE)[], run: () => T): T {
    const def = WEAPON_TABLE[weaponId] as WeaponDef;
    const original = def.onHit;
    (def as { onHit?: readonly string[] }).onHit = onHit;
    try {
      return run();
    } finally {
      (def as { onHit?: readonly string[] }).onHit = original;
    }
  }

  /** A shooter at point-blank range behind a target, so one press lands on the same tick. */
  function duel(over: Partial<CombatPlayer> = {}): CombatPlayer[] {
    return [
      player("aaa", { fireMask: 0b001, x: 300, angle: 0 }),
      player("bbb", { x: 340, team: 1, ...over }),
    ];
  }

  it("puts the weapon's effects on every car it damages", () => {
    withOnHit("fireball", ["tarred"], () => {
      const first = runCombat({
        world: world(),
        players: duel(),
        instances: [],
        instanceSeq: 0,
      });
      // The shot spawns at the muzzle on tick 100 and travels; step until it lands.
      let state = first;
      for (let tick = 101; tick < 110 && find(state.players, "bbb").hp === hpOf("rectangle"); tick++) {
        state = runCombat({
          world: world({ tick }),
          players: state.players.map((p) => ({ ...p, fireMask: 0 })),
          instances: state.instances,
          instanceSeq: state.instanceSeq,
        });
      }
      const hit = find(state.players, "bbb");
      expect(hit.hp).toBeLessThan(hpOf("rectangle"));
      expect(hasEffect(hit.effects, "tarred", 110)).toBe(true);
      // It rides the damage, so the shooter is the source.
      expect(hit.effects[0]!.sourceSessionId).toBe("aaa");
      // And never lands on the shooter.
      expect(find(state.players, "aaa").effects).toHaveLength(0);
    });
  });

  it("lands on nobody when the shot damages nobody", () => {
    withOnHit("fireball", ["tarred"], () => {
      // Same team in team mode: `canDamage` refuses, so there is no hit to ride.
      let state = runCombat({
        world: world({ mode: "team" }),
        players: [
          player("aaa", { fireMask: 0b001, x: 300 }),
          player("bbb", { x: 340, team: 0 }),
        ],
        instances: [],
        instanceSeq: 0,
      });
      for (let tick = 101; tick < 110; tick++) {
        state = runCombat({
          world: world({ tick, mode: "team" }),
          players: state.players.map((p) => ({ ...p, fireMask: 0 })),
          instances: state.instances,
          instanceSeq: state.instanceSeq,
        });
      }
      for (const p of state.players) expect(p.effects).toHaveLength(0);
    });
  });

  it("changes nothing while every weapon's list is absent, which is the shipped table", () => {
    for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
      expect(WEAPON_TABLE[id].onHit).toBeUndefined();
    }
  });
});

describe("channels reaching combat", () => {
  it("`damageDealt` powers a shot the shooter fires while buffed", () => {
    const buffed = runCombat({
      world: world(),
      players: [player("aaa", { fireMask: 0b001, effects: live("primed") })],
      instances: [],
      instanceSeq: 0,
    });
    const plain = runCombat({
      world: world(),
      players: [player("aaa", { fireMask: 0b001 })],
      instances: [],
      instanceSeq: 0,
    });
    expect(buffed.instances[0]!.damage).toBe(
      scaleDamage(plain.instances[0]!.damage, EFFECT_TABLE.primed.modifiers.damageDealt),
    );
  });

  it("`disarmed` blocks a new press", () => {
    const jammed = runCombat({
      world: world(),
      players: [player("aaa", { fireMask: 0b001, effects: live("jammed") })],
      instances: [],
      instanceSeq: 0,
    });
    expect(jammed.instances).toHaveLength(0);
    // And it spends no stock: a jam that ate the shot would punish good timing hardest.
    expect(find(jammed.players, "aaa").fireState.slots[0]!.stocks).toBe(1);
  });

  it("`disarmed` lets a press already committed finish", () => {
    // `skewer` has a wind-up, so a press on tick 100 is still pending on 101.
    const pressed = runCombat({
      world: world(),
      players: [player("aaa", { carId: "oval", fireState: newFireState("oval", 1), fireMask: 0b010 })],
      instances: [],
      instanceSeq: 0,
    });
    expect(pressed.instances).toHaveLength(0);
    expect(find(pressed.players, "aaa").fireState.pending).not.toBeNull();

    let state = pressed;
    for (let tick = 101; tick < 130 && state.instances.length === 0; tick++) {
      state = runCombat({
        world: world({ tick }),
        players: state.players.map((p) => ({ ...p, fireMask: 0, effects: live("jammed") })),
        instances: state.instances,
        instanceSeq: state.instanceSeq,
      });
    }
    expect(state.instances).toHaveLength(1);
  });

  it("`weaponCooldown` shortens the recharge combat starts", () => {
    const spend = (effects: ActiveEffect[]) => {
      const first = runCombat({
        world: world(),
        players: [player("aaa", { fireMask: 0b001, effects })],
        instances: [],
        instanceSeq: 0,
      });
      return find(first.players, "aaa").fireState.slots[0]!.rechargeEndsTick;
    };
    expect(spend(live("stoked"))).toBeLessThan(spend([]));
  });

  it("`damageTaken` scales what a landing shot costs the target", () => {
    const land = (effects: ActiveEffect[]) => {
      let state = runCombat({
        world: world(),
        players: [
          player("aaa", { fireMask: 0b001, x: 300 }),
          player("bbb", { x: 340, team: 1, effects }),
        ],
        instances: [],
        instanceSeq: 0,
      });
      for (let tick = 101; tick < 110; tick++) {
        state = runCombat({
          world: world({ tick }),
          players: state.players.map((p) => ({ ...p, fireMask: 0 })),
          instances: state.instances,
          instanceSeq: state.instanceSeq,
        });
      }
      return hpOf("rectangle") - find(state.players, "bbb").hp;
    };
    const plain = land([]);
    expect(plain).toBeGreaterThan(0);
    expect(land(live("exposed"))).toBeGreaterThan(plain);
    expect(land(live("hardened"))).toBeLessThan(plain);
  });

  it("reads a car's modifiers once, from the list it was handed", () => {
    // An effect that lapses on this very tick must not act on it — combat filters by tick just as
    // `expireEffects` does, so a patch-stale list and a swept one agree.
    const lapsed = runCombat({
      world: world({ tick: 100 }),
      players: [player("aaa", { fireMask: 0b001, effects: live("jammed", 100) })],
      instances: [],
      instanceSeq: 0,
    });
    expect(lapsed.instances).toHaveLength(1);
  });
});
