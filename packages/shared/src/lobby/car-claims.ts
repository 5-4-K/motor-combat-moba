import type { GameMode } from "../constants.js";
import type { CarId } from "../config/types.js";
import { modeConfigOf } from "../modes/registry.js";
import { rulesOf } from "../modes/rules-registry.js";

type Claimant = { readonly sessionId: string; readonly team: number; readonly lockedCarId: string };

/** Whether a team may not field two of one chassis in this mode (CQ4, CQ26). */
export function uniqueChassisApplies(mode: GameMode): boolean {
  return rulesOf(mode).claimsChassis(modeConfigOf(mode));
}

/** A TEAMMATE (never yourself, never the enemy) has already locked this chassis (CQ30). */
export function chassisTakenByTeammate(
  carId: string,
  team: number,
  selfId: string,
  players: readonly Claimant[],
): boolean {
  return players.some((p) => p.sessionId !== selfId && p.team === team && p.lockedCarId === carId);
}

/**
 * The car-select deadline's pick for a player who never locked (CQ31): the preview if no teammate
 * has it, else the fallback if free, else the first free active chassis. `teamSize <= active
 * roster` (CQ27) guarantees one is free.
 */
export function pickDeadlineCar(
  previewed: CarId | undefined,
  team: number,
  selfId: string,
  players: readonly Claimant[],
  activeIds: readonly CarId[],
  fallback: CarId,
): CarId {
  const free = (id: CarId) => !chassisTakenByTeammate(id, team, selfId, players);
  if (previewed !== undefined && free(previewed)) return previewed;
  if (free(fallback)) return fallback;
  return activeIds.find(free) ?? fallback;
}
