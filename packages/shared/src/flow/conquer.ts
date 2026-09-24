import type { ArenaZone } from "../arena/types.js";

/**
 * Conquer's zone rules (spec CQ18–CQ23), pure and tick-counted. The room calls these; nothing here
 * reads config, so the caller passes `derived().conquerTicks` values in.
 */
export interface ZoneState {
  readonly controlTicks: readonly [number, number];
  /** The team whose uninterrupted, unopposed streak is running, or -1. */
  readonly holder: -1 | 0 | 1;
  /** Consecutive holder ticks, saturating at the capture delay. */
  readonly streak: number;
  /** Both teams present this tick. */
  readonly contested: boolean;
}

export const INITIAL_ZONE: ZoneState = Object.freeze({
  controlTicks: Object.freeze([0, 0] as const),
  holder: -1,
  streak: 0,
  contested: false,
}) as ZoneState;

export interface ZonePresenceCar {
  readonly x: number;
  readonly y: number;
  readonly team: number;
  readonly alive: boolean;
  readonly inRoster: boolean;
}

/** Per-team count of living roster cars whose centre is inside the zone. Phased cars count (CQ10). */
export function zonePresence(zone: ArenaZone, cars: readonly ZonePresenceCar[]): readonly [number, number] {
  const r2 = zone.radius * zone.radius;
  let a = 0;
  let b = 0;
  for (const car of cars) {
    if (!car.alive || !car.inRoster) continue;
    const dx = car.x - zone.x;
    const dy = car.y - zone.y;
    if (dx * dx + dy * dy > r2) continue;
    if (car.team === 1) b += 1;
    else a += 1;
  }
  return [a, b];
}

/** CQ19. A streak broken for one tick restarts the countdown from zero. */
export function stepZone(
  prev: ZoneState,
  present: readonly [number, number],
  delayTicks: number,
  targetTicks: number,
): ZoneState {
  const [a, b] = present;
  if ((a > 0) === (b > 0)) {
    return { controlTicks: prev.controlTicks, holder: -1, streak: 0, contested: a > 0 && b > 0 };
  }
  const holder: 0 | 1 = a > 0 ? 0 : 1;
  const continuing = prev.holder === holder;
  const streak = continuing ? Math.min(prev.streak + 1, delayTicks) : 1;
  let controlTicks = prev.controlTicks;
  if (continuing && prev.streak >= delayTicks) {
    const next: [number, number] = [controlTicks[0], controlTicks[1]];
    next[holder] = Math.min(next[holder] + 1, targetTicks);
    controlTicks = next;
  }
  return { controlTicks, holder, streak, contested: false };
}

/** The team that has taken control, or -1. */
export function inControl(zone: ZoneState, delayTicks: number): -1 | 0 | 1 {
  return zone.holder >= 0 && zone.streak >= delayTicks ? zone.holder : -1;
}

export type ConquerOutcome =
  | { readonly ended: false; readonly overtime: boolean }
  | { readonly ended: true; readonly winnerTeam: -1 | 0 | 1 };

/**
 * CQ21, evaluated after `stepZone` on the same tick: full bar, then the clock, then overtime.
 * `matchEndsTick <= 0` means no clock, matching `deathmatchEnded`.
 */
export function conquerOutcome(
  zone: ZoneState,
  tick: number,
  matchEndsTick: number,
  overtime: boolean,
  delayTicks: number,
  targetTicks: number,
): ConquerOutcome {
  const [a, b] = zone.controlTicks;
  if (a >= targetTicks) return { ended: true, winnerTeam: 0 };
  if (b >= targetTicks) return { ended: true, winnerTeam: 1 };
  if (!overtime) {
    if (matchEndsTick <= 0 || tick < matchEndsTick) return { ended: false, overtime: false };
    if (a !== b) return { ended: true, winnerTeam: a > b ? 0 : 1 };
    return { ended: false, overtime: true };
  }
  const controller = inControl(zone, delayTicks);
  if (controller >= 0) return { ended: true, winnerTeam: controller };
  return { ended: false, overtime: true };
}

/** CQ23: a team with nobody left loses; nobody left at all is a draw. */
export function conquerLeaveOutcome(
  rosterCounts: readonly [number, number],
): { readonly ended: false } | { readonly ended: true; readonly winnerTeam: -1 | 0 | 1 } {
  const [a, b] = rosterCounts;
  if (a === 0 && b === 0) return { ended: true, winnerTeam: -1 };
  if (a === 0) return { ended: true, winnerTeam: 1 };
  if (b === 0) return { ended: true, winnerTeam: 0 };
  return { ended: false };
}

/** CQ3: floored to two decimals, so a bar never reads 100.00% before it is full. */
export function controlPercentText(controlTicks: number, targetTicks: number): string {
  if (targetTicks <= 0) return "0.00%";
  const hundredths = Math.floor((controlTicks * 10000) / targetTicks);
  return `${(hundredths / 100).toFixed(2)}%`;
}

/** CQ55: whole seconds left on a capture countdown (5..1), 0 once in control. */
export function captureCountdownSeconds(streak: number, delayTicks: number, hz: number): number {
  const left = delayTicks - streak;
  return left <= 0 ? 0 : Math.ceil(left / hz);
}
