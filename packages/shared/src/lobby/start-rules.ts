import { GameMode } from "../constants.js";

export type StartRuleStatus = "ready" | "in_match" | "post_match";

export interface StartRulePlayer {
  status: StartRuleStatus;
  team: number;
}

export type CanStartResult = { ok: true } | { ok: false; error: string };

export function canStart(mode: GameMode, players: readonly StartRulePlayer[]): CanStartResult {
  const ready = players.filter((p) => p.status === "ready");

  if (mode !== GameMode.TEAM) {
    if (ready.length < 2) {
      return { ok: false, error: "Need at least 2 ready players" };
    }
    return { ok: true };
  }

  let team0 = 0;
  let team1 = 0;
  for (const player of ready) {
    if (player.team === 0) team0 += 1;
    else if (player.team === 1) team1 += 1;
  }

  if (team0 === 0 || team1 === 0) {
    return { ok: false, error: "Need at least 1 ready player per team" };
  }
  if (team0 !== team1) {
    return { ok: false, error: "Teams must be equal to start" };
  }
  return { ok: true };
}
