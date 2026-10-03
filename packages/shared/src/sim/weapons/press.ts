import { NET_CONFIG } from "../../config/net-config.js";
import { weaponDefOf } from "../../config/weapon-config.js";
import { msToTicks } from "../../config/weapon-ticks.js";
import { beginFire, releaseShots, type FireState, type PendingFire } from "./fire.js";
import type { ShotOrder } from "./instances.js";
import { turnTurret } from "./turret.js";

/**
 * Bitmask of slots whose weapon starts a maneuver or a hold — the presses masked out mid-maneuver.
 */
export function maneuverSlotMask(fireState: FireState): number {
  let mask = 0;
  fireState.slots.forEach((slot, index) => {
    const def = weaponDefOf(slot.weaponId);
    if (def.kind === "maneuver" || (def.kind === "beam" && def.holdsDuringFire)) mask |= 1 << index;
  });
  return mask;
}

/** What one car brings to its press phase on one tick. */
export interface PressPhaseInput {
  /** This tick's press edges (`serverTick`'s `clean & ~prev`). */
  pressed: number;
  /** Is the car mid-maneuver? Then maneuver and hold presses are masked out before the stock is spent. */
  maneuvering: boolean;
  /** The `disarmed` flag: blocks a NEW press only; what is already committed still releases. */
  disarmed: boolean;
  /** The `weaponCooldown` multiplier `releaseShots` scales its clocks by. */
  weaponCooldown: number;
  aimBearing: number | null;
  carAngle: number;
  /** The shot-compensation budget a press begun this tick freezes onto itself (NR37); 0 for none. */
  fastForward: number;
}

export interface PressPhaseResult {
  state: FireState;
  /** The press begun THIS tick (with its frozen `compTicks`), or null. */
  began: PendingFire | null;
  /** The orders released this tick. */
  orders: ShotOrder[];
  /** The shot compensation those orders' press carries (`PendingFire.compTicks`, 0 for none). */
  compTicks: number;
}

/**
 * One car's press phase for one tick, in `runCombat`'s order: `beginFire` (unless disarmed, with the
 * mid-maneuver mask), the shot-compensation budget frozen onto a press begun this tick, `turnTurret`,
 * then `releaseShots`. The ONE spelling of that sequence: `runCombat` runs it on the server, and the
 * shooter's client runs it to predict its own provisional shots (NR39, `LocalFire`), so a gate added
 * here reaches both. Pure. Recharge (`tickRecharge`) is the caller's, earlier in the tick.
 *
 * `disarmed` blocks a NEW press only; `releaseShots` still runs. A press is a commitment (`beginFire`
 * spends the stock at press time because a wind-up cannot be cancelled), so a jam landing mid-wind-up
 * would otherwise eat a stock and produce nothing. A press that would start a maneuver (or a hold
 * weapon) while one runs is ignored BEFORE the stock is spent — masked out, not swallowed.
 */
export function pressPhase(sessionId: string, fireState: FireState, tick: number, input: PressPhaseInput): PressPhaseResult {
  let state = fireState;
  let began: PendingFire | null = null;
  const blocked = input.maneuvering ? maneuverSlotMask(state) : 0;
  if (!input.disarmed) {
    const prevPending = state.pending;
    state = beginFire(sessionId, state, input.pressed & ~blocked, tick, input.aimBearing, input.carAngle);
    const pending = state.pending;
    if (pending !== null && prevPending === null) {
      // A press begun this tick freezes its shot-compensation budget onto itself (NR37), so a
      // wind-up row's instance is advanced by it on whichever tick it is finally released.
      // Written only when positive, so an uncompensated press's state is exactly what it was.
      // Clamped to the cap defensively: the server prices it already clamped (NR36), but a caller
      // bug must never turn into an unbounded loop or a shot from further back than the cap.
      const comp = Math.min(input.fastForward, msToTicks(NET_CONFIG.shotCompCapMs));
      if (Number.isInteger(comp) && comp > 0) {
        state = { ...state, pending: { ...pending, compTicks: comp } };
      }
      began = state.pending;
    }
  }
  // TR11/TR15: the turret turns every tick a turret press is pending, disarmed or not — a turn in
  // progress finishes like a wind-up does.
  state = turnTurret(state, input.carAngle, tick);
  // Read before `releaseShots`, which clears `pending` once its last volley goes out. One press is
  // pending at a time, so every order released below belongs to it.
  const compTicks = state.pending?.compTicks ?? 0;
  const released = releaseShots(state, tick, input.weaponCooldown);
  return { state: released.state, began, orders: released.orders, compTicks };
}
