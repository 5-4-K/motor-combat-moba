import type { ArenaDef, Spawn } from "../arena/types.js";
import { GameMode } from "../constants.js";

export function assignSpawns(
  arena: ArenaDef,
  mode: GameMode,
  roster: readonly { sessionId: string; team: 0 | 1 }[],
  random: () => number,
): Record<string, Spawn> {
  if (mode === GameMode.TEAM) {
    return assignTeamSpawns(arena, roster);
  }
  return assignFfaSpawns(arena, roster, random);
}

function assignFfaSpawns(
  arena: ArenaDef,
  roster: readonly { sessionId: string; team: 0 | 1 }[],
  random: () => number,
): Record<string, Spawn> {
  if (roster.length > arena.ffaSpawns.length) {
    throw new Error("Not enough FFA spawns for roster");
  }
  const shuffled = fisherYates([...arena.ffaSpawns], random);
  const assigned: Record<string, Spawn> = {};
  for (let i = 0; i < roster.length; i++) {
    assigned[roster[i]!.sessionId] = shuffled[i]!;
  }
  return assigned;
}

function assignTeamSpawns(
  arena: ArenaDef,
  roster: readonly { sessionId: string; team: 0 | 1 }[],
): Record<string, Spawn> {
  const teamA = [...arena.teamASpawns];
  const teamB = [...arena.teamBSpawns];
  let aIndex = 0;
  let bIndex = 0;
  const assigned: Record<string, Spawn> = {};

  for (const player of roster) {
    if (player.team === 0) {
      if (aIndex >= teamA.length) {
        throw new Error("Not enough team A spawns for roster");
      }
      assigned[player.sessionId] = teamA[aIndex]!;
      aIndex += 1;
    } else {
      if (bIndex >= teamB.length) {
        throw new Error("Not enough team B spawns for roster");
      }
      assigned[player.sessionId] = teamB[bIndex]!;
      bIndex += 1;
    }
  }

  return assigned;
}

function fisherYates<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = items[i]!;
    items[i] = items[j]!;
    items[j] = swap;
  }
  return items;
}
