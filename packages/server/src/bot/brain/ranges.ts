import {
  cars, cfg, fireSlotsOf, slots, weaponDefOf, type CarId, type WeaponId,
} from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS, resolveBrainConstants, type BotProfile } from "../../config/bot-profiles.js";
import type { BotArenaView, BotCarView, BotSlotView } from "../types.js";
import { kitReachOf, weaponReachOf } from "./reach.js";
import { constantVelocityPredictor, readyInTicksOf, solve, type SolverShooter } from "./solution.js";

/** A slot with a stock in hand and no refire lock running. */
export function slotIsReady(slot: BotSlotView, tick: number): boolean {
  return slot.stocks >= 1 && tick >= slot.refireLockUntilTick;
}

export interface UsableSlot { slot: BotSlotView; index: number }

/** The fire slots the bot may press: every slot except a disabled basic attack. */
export function usableSlots(list: readonly BotSlotView[]): UsableSlot[] {
  const cfg = slots();
  const out: UsableSlot[] = [];
  for (let index = 0; index < list.length; index++) {
    if (index === cfg.basicAttackSlotIndex && !cfg.basicAttackEnabled) continue;
    out.push({ slot: list[index]!, index });
  }
  return out;
}

/** Weapon exclusivity (L1): one carrier per weapon, so its fire slot is unambiguous. */
export function carrierOf(weaponId: WeaponId): { carId: CarId; slotIndex: number } {
  for (const carId of Object.keys(cars()) as CarId[]) {
    const slotIndex = fireSlotsOf(carId).indexOf(weaponId);
    if (slotIndex !== -1) return { carId, slotIndex };
  }
  throw new Error(`carrierOf: no chassis carries ${weaponId}`);
}

/**
 * Keyed on the active bundle object: the playground tunes through a sibling bundle and a mode may
 * override weapon rows, so a bare (weapon, sigma, bar) key would serve one bundle's reach to another.
 * Server-side twin of the client's `memoOnBundle`.
 */
const reachCache = new WeakMap<object, Map<string, number>>();
const OPEN_ARENA: BotArenaView = { width: 1_000_000, height: 1_000_000, obstacles: [] };
/**
 * The sweep stands mid-arena: a beam's wall clip treats a point on the bounds edge as outside, so a
 * shooter at (0, 0) clips every beam aimed along the edge to nothing.
 */
const ORIGIN = 500_000;

/**
 * The farthest distance at which `solve()` against a stationary target straight ahead still clears
 * `bar` (BB42). Memoised per (weapon, sigma, bar); a kit is fixed for a match.
 */
export function effectiveReachOf(weaponId: WeaponId, aimSigmaRad: number, bar: number): number {
  const bundle = cfg();
  let memo = reachCache.get(bundle);
  if (!memo) reachCache.set(bundle, (memo = new Map()));
  const key = `${weaponId}|${aimSigmaRad}|${bar}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const { carId, slotIndex } = carrierOf(weaponId);
  const reach = weaponReachOf(weaponId);
  const min = BRAIN_CONSTANTS.minEngageUnits;
  const shooter: SolverShooter = { sessionId: "reach-shooter", carId, team: 0, x: ORIGIN, y: ORIGIN, angle: 0, vx: 0, vy: 0 };
  const slot: BotSlotView = { weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0, range: weaponDefOf(weaponId).range };
  let best: number = min;
  const n = BRAIN_CONSTANTS.effectiveReachSamples;
  for (let i = 0; i <= n; i++) {
    const distance = Math.min(reach, min + ((reach - min) * i) / n);
    const target: BotCarView = {
      sessionId: "reach-target", carId, team: 1, x: ORIGIN + distance, y: ORIGIN, angle: Math.PI, vx: 0, vy: 0,
      hp: Number.POSITIVE_INFINITY, maxHp: Number.POSITIVE_INFINITY, alive: true, phased: false, statuses: [], maneuver: 0,
    };
    const solution = solve({
      shooter, slot, slotIndex, target, targetAt: constantVelocityPredictor(target),
      aimSigmaRad, tick: 0, arena: OPEN_ARENA,
    });
    if (solution.hitChance >= bar) best = distance;
  }
  memo.set(key, best);
  return best;
}

/** Where this kit wants to stand (BB43). */
export function ownComfortOf(list: readonly BotSlotView[], profile: BotProfile, tick: number): number {
  const usable = usableSlots(list);
  if (usable.length === 0) return BRAIN_CONSTANTS.minEngageUnits;
  const reachOf = (s: BotSlotView) => effectiveReachOf(s.weaponId, profile.aimErrorSigmaRad, profile.hitChanceBar);
  const soon = usable.filter(({ slot }) => readyInTicksOf(slot, tick) <= resolveBrainConstants().soonReadyTicks);
  const base = soon.length > 0
    ? Math.min(...soon.map(({ slot }) => reachOf(slot)))
    : Math.max(...usable.map(({ slot }) => reachOf(slot)));
  return Math.max(BRAIN_CONSTANTS.minEngageUnits, base * BRAIN_CONSTANTS.comfortFraction);
}

/** Own comfort, floored by the opponent's keep-out (BB44). */
export function fightRangeOf(
  ownComfort: number, target: BotCarView | undefined, seenWeaponIds: readonly WeaponId[], profile: BotProfile,
): number {
  const theirKeepOut = target ? kitReachOf(target.carId, seenWeaponIds).shortest * profile.opponentRangeRespect : 0;
  return Math.max(ownComfort, theirKeepOut);
}
