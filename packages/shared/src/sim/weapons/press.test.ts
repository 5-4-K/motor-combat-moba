import { beforeEach, describe, expect, it } from "vitest";
import { ARENA_01 } from "../../arena/arena-01.js";
import { boundsOf } from "../../arena/bounds.js";
import { hpOf } from "../../config/car-config.js";
import { installMode } from "../../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../../modes/registry.js";
import { runCombat, type CombatPlayer } from "../combat.js";
import { ManeuverKind } from "../maneuver.js";
import { modifiersOf } from "../status/modifiers.js";
import { newFireState, tickRecharge, type FireState } from "./fire.js";
import type { WeaponInstance } from "./instances.js";
import { pressPhase } from "./press.js";

installMode(modeConfigOf(DEFAULT_GAME_MODE));
beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const CARS = ["bullseye", "mirage", "bastion"] as const;
const STATUSES = ["stunned", "spiked", "reeling", "corroded"] as const;

describe("pressPhase is runCombat's press phase", () => {
  // Every car's fire state out of `runCombat`, tick by tick over random presses, statuses, maneuvers
  // and shot compensation (k = 0 on half the ticks), equals `tickRecharge` then `pressPhase` run on
  // the state it went in with — the sequence the client's `LocalFire` runs (NR39).
  it("matches it tick for tick over random play, k = 0 and k > 0", () => {
    const bounds = boundsOf(ARENA_01);
    let presses = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed);
      let players: CombatPlayer[] = CARS.map((carId, i) => ({
        sessionId: `p${i}`, x: 300 + 300 * i, y: 200 + 150 * i, angle: r() * 6.28, team: (i % 2) as 0 | 1, carId,
        hp: hpOf(carId), alive: true, inRoster: true, fireMask: 0, fireState: newFireState(carId, 1), statuses: [],
        maneuver: ManeuverKind.NONE, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0, maneuverWeaponId: "",
        maneuverPressId: "", lastDamagerSessionId: "",
      }));
      let instances: readonly WeaponInstance[] = [];
      let seq = 0;
      for (let tick = 1; tick <= 300; tick++) {
        players = players.map((p) => ({
          ...p,
          angle: p.angle + (r() - 0.5) * 0.2,
          fireMask: r() < 0.2 ? 1 << Math.floor(r() * 4) : 0,
          statuses:
            r() < 0.01
              ? [...p.statuses, { statusId: STATUSES[Math.floor(r() * STATUSES.length)]!, startTick: tick, endsTick: tick + 30, sourceSessionId: "" }]
              : p.statuses.filter((s) => s.endsTick > tick),
        }));
        const k = r() < 0.5 ? 0 : 1 + Math.floor(r() * 9);
        const expected = new Map<string, FireState>();
        for (const p of players) {
          const mods = modifiersOf(p.statuses, tick);
          const phase = pressPhase(p.sessionId, tickRecharge(p.fireState, tick, mods.weaponCooldown), tick, {
            pressed: p.fireMask, maneuvering: p.maneuver !== ManeuverKind.NONE, disarmed: mods.disarmed,
            weaponCooldown: mods.weaponCooldown, aimBearing: null, carAngle: p.angle, fastForward: k,
          });
          if (phase.began) presses++;
          expected.set(p.sessionId, phase.state);
        }
        const out = runCombat({
          world: { tick, dt: 1 / 60, mode: "ffa", obstacles: ARENA_01.obstacles, bounds },
          players, instances, instanceSeq: seq,
          fastForward: k > 0 ? new Map(players.map((p) => [p.sessionId, k])) : undefined,
        });
        for (const p of out.players) {
          // A car stunned THIS tick has its press cancelled at the end of the tick (O8), after the phase.
          if (p.alive && !p.statuses.some((s) => s.statusId === "stunned" && s.startTick === tick)) {
            expect(p.fireState, `seed ${seed} tick ${tick} ${p.sessionId}`).toEqual(expected.get(p.sessionId));
          }
        }
        players = out.players.map((p) => (p.alive ? p : { ...p, alive: true, hp: hpOf(p.carId as (typeof CARS)[number]) }));
        instances = out.instances;
        seq = out.instanceSeq;
      }
    }
    expect(presses).toBeGreaterThan(100);
  });
});
