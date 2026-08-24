import { COLOR_TABLE } from "../config/color-config.js";

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
