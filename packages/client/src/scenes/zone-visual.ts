/**
 * How the capture zone's ring is tinted for one viewer (CQ52). Viewer-relative like the hp bars:
 * the local player's own team holding it reads as "ally", the other team as "enemy". Contested or
 * unheld is "neutral": the ring shows no owner while either is true.
 */
export type ZoneTint = "ally" | "enemy" | "neutral";

export function zoneTint(viewerTeam: number, holder: number, contested: boolean): ZoneTint {
  if (contested || holder < 0) return "neutral";
  return holder === viewerTeam ? "ally" : "enemy";
}
