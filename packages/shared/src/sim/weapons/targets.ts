/**
 * May the owner's shot damage this target? Friendly fire is off in team mode and there is no
 * self-damage in either mode — a shot spawns at the muzzle, which sits on the shooter's own hull,
 * so without the self check every shot would kill its own shooter on the tick it was fired.
 */
export function canDamage(
  ownerId: string,
  ownerTeam: 0 | 1,
  targetId: string,
  targetTeam: 0 | 1,
  mode: "ffa" | "team",
): boolean {
  if (ownerId === targetId) return false;
  if (mode === "ffa") return true;
  return ownerTeam !== targetTeam;
}
