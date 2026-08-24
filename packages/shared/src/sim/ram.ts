/** Who deals damage in one car-vs-car contact. */
export type RamOutcome = "both" | "a_hits_b" | "b_hits_a" | "none";

/**
 * Whether the car at `(ax, ay)` facing `angle` is driving *into* the car at `(bx, by)`.
 *
 * The test is `dot(forward, normalize(b - a)) >= threshold`: how closely the attacker's nose points
 * at the target, independent of distance or speed. That is the whole locked rule — rear-ends and
 * head-ons deal damage, sideswipes do not — and it is deliberately not a velocity test. A car
 * shunted backwards into someone is still facing away and still deals nothing, which is what makes
 * "get behind them" a strategy rather than "be moving fastest".
 *
 * Coincident centres return false: there is no direction to face, and normalising a zero vector
 * would NaN the dot product into a silent "no ram" anyway. Making that explicit keeps the answer a
 * decision rather than an accident of arithmetic.
 */
export function isRamming(
  ax: number,
  ay: number,
  angle: number,
  bx: number,
  by: number,
  threshold: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return false;

  const dot = (Math.cos(angle) * dx + Math.sin(angle) * dy) / distance;
  return dot >= threshold;
}

/**
 * Both facing tests folded into who actually takes damage. Head-on hurts both cars — there is no
 * "winner" of a head-on in v1, the stronger chassis simply trades better — and a contact neither
 * car was driving into costs nobody hp.
 */
export function ramOutcome(aRams: boolean, bRams: boolean): RamOutcome {
  if (aRams && bRams) return "both";
  if (aRams) return "a_hits_b";
  if (bRams) return "b_hits_a";
  return "none";
}

/**
 * Damage one ram deals, from the *attacker's* `CAR_TABLE` strength. Speed is not a factor in v1:
 * the ram cooldown, not impact energy, is what bounds how fast hp drains.
 */
export function ramDamage(strength: number, per: number): number {
  return strength * per;
}
