import { lastStandingHud } from "../last-standing/hud.js";

/** `FFA_LAST_STANDING`'s HUD. Shared behaviour lives in `lastStandingHud` (`modes/last-standing/hud.ts`); only the card copy is Brawl's own. */
export const BRAWL_HUD = lastStandingHud(() => ({
  kicker: "Free-for-all",
  body: "Everyone fights everyone. Last car driving takes the round.",
  meta: ["2-6 players", "Last one standing"],
}));
