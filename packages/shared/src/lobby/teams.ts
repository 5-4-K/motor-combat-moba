import { COLOR_TABLE } from "../config/color-config.js";
import { MAX_TEAM_SIZE } from "../constants.js";

/** The slice of a player a team switch reads. Mirrors `StartRulePlayer` so callers can share a shape. */
export interface SwitchTeamPlayer {
  status: "ready" | "in_match" | "post_match";
  team: number;
}

/**
 * Whether `player` may flip to the other team. Two rules, both enforced server-side and mirrored by
 * the client so the button can disable itself rather than sending a message the server drops:
 * switching is a lobby action (ready players only), and the destination must be under
 * `MAX_TEAM_SIZE`. `existingTeams` is every player's team *including* the switcher's — their own
 * seat sits on the team they are leaving, so it never counts against the destination.
 */
export function canSwitchTeam(
  player: SwitchTeamPlayer,
  existingTeams: readonly number[],
): boolean {
  if (player.status !== "ready") return false;
  const destination = player.team === 0 ? 1 : 0;
  let occupied = 0;
  for (const team of existingTeams) {
    if (team === destination) occupied += 1;
  }
  return occupied < MAX_TEAM_SIZE;
}

export function pickTeam(existingTeams: readonly number[], random: () => number): 0 | 1 {
  let team0 = 0;
  let team1 = 0;
  for (const team of existingTeams) {
    if (team === 0) team0 += 1;
    else if (team === 1) team1 += 1;
  }
  if (team0 < team1) return 0;
  if (team1 < team0) return 1;
  return random() < 0.5 ? 0 : 1;
}

export function pickColor(usedColorIds: readonly number[], random: () => number): number {
  const used = new Set(usedColorIds);
  const unused = COLOR_TABLE.map((c) => c.colorId).filter((id) => !used.has(id));
  if (unused.length === 0) {
    throw new Error("All colors are used");
  }
  return unused[Math.floor(random() * unused.length)]!;
}
