import { lastStandingHud } from "../last-standing/hud.js";

/** `TEAM`'s HUD. Shared behaviour lives in `lastStandingHud` (`modes/last-standing/hud.ts`); only the card copy is Team brawl's own. */
export const TEAM_HUD = lastStandingHud(() => ({
  kicker: "Team",
  body: "Two teams, shared victory. Last team with a car standing wins.",
  meta: ["2v2 – 3v3", "Last team standing"],
}));
