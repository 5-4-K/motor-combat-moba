// Conquer's room glue, kept out of `ArenaRoom` so it can be tested: nothing in the repo
// instantiates the room itself. `ArenaState` satisfies `ZoneFields & { tick; matchEndsTick }`
// structurally, so the room passes its own state straight in.
import {
  conquerOutcome, stepZone, zonePresence,
  type ArenaZone, type ZonePresenceCar, type ZoneState,
} from "@motor-combat-moba/shared";

export interface ZoneFields {
  controlTicksA: number;
  controlTicksB: number;
  zoneHolder: number;
  zoneStreakTicks: number;
  zoneContested: boolean;
  overtime: boolean;
}

export function readZone(f: ZoneFields): ZoneState {
  const holder = f.zoneHolder === 0 || f.zoneHolder === 1 ? f.zoneHolder : -1;
  return {
    controlTicks: [f.controlTicksA, f.controlTicksB],
    holder,
    streak: f.zoneStreakTicks,
    contested: f.zoneContested,
  };
}

export function writeZone(f: ZoneFields, z: ZoneState): void {
  f.controlTicksA = z.controlTicks[0];
  f.controlTicksB = z.controlTicks[1];
  f.zoneHolder = z.holder;
  f.zoneStreakTicks = z.streak;
  f.zoneContested = z.contested;
}

/** CQ43: on the edge into MATCH. */
export function resetZone(f: ZoneFields): void {
  f.controlTicksA = 0;
  f.controlTicksB = 0;
  f.zoneHolder = -1;
  f.zoneStreakTicks = 0;
  f.zoneContested = false;
  f.overtime = false;
}

/** One Conquer tick: step the zone from the roster, write it, and say whether the match ended. */
export function advanceConquer(
  f: ZoneFields & { tick: number; matchEndsTick: number },
  zone: ArenaZone,
  cars: readonly ZonePresenceCar[],
  delayTicks: number,
  targetTicks: number,
): { ended: false } | { ended: true; winnerTeam: -1 | 0 | 1 } {
  const next = stepZone(readZone(f), zonePresence(zone, cars), delayTicks, targetTicks);
  writeZone(f, next);
  const outcome = conquerOutcome(next, f.tick, f.matchEndsTick, f.overtime, delayTicks, targetTicks);
  if (outcome.ended) return outcome;
  f.overtime = outcome.overtime;
  return { ended: false };
}
