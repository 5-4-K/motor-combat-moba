/**
 * Constants every contact-applied weapon impulse reads. Named `SLAM_CONFIG` until 2026-09-19, when
 * both members turned out never to have been slam-specific:
 *
 * - `wallContactPad` — how close a hull counts as touching level geometry. It already had a non-slam
 *   consumer before the rename (`contact.ts`'s wall-blocked dash), and it is what every
 *   `ImpulseDef.onWallImpact` sweep measures against.
 * - `spinScale` — how much an authored push rotates its target. Inert until the same date, because
 *   the contact point handed to `applyImpulse` was the victim's own centre and the lever arm was
 *   therefore always exactly zero; Task 2 passes a real point and this became live.
 */
export type ImpulseConfig = typeof IMPULSE_CONFIG;

export const IMPULSE_CONFIG = {
  wallContactPad: 1,

  /**
   * Calibration multiplier on the spin a slam's impulse imparts (`applyImpulse`'s `nextSpin`).
   *
   * **This is `RAM_CONFIG.spinScale`'s shipped value, 12.5, moved here rather than copied — the ram
   * no longer has a knob this could point at.** The Unity ram port (spec §7) changed that constant's
   * meaning AND the shape of the formula reading it: a ram's spin now divides by
   * `inertiaRadiusSquared()` alone, while a slam's still divides by `ramDefence * inertiaRadiusSquared`
   * — a denominator 30-90x larger — and `RAM_CONFIG.spinScale` was re-pitched 12.5 -> 0.3 for the
   * ram's shape only (spec §9: a typical flank ram landing ~4 rad/s against the 6 rad/s clamp).
   * Leaving the slam pointed at it would have cut `wildcharge`'s slam spin to 1/41.7 of what it
   * shipped at, silently, and stage 4's "wildcharge still clearly harder than the best ordinary ram"
   * exit criterion would then have been measuring that nerf and blaming the wrong thing. A constant
   * surviving in name while its value drops 41x is not surviving.
   *
   * So: the slam's spin is bit-identical in every SHIPPED build before and after the port, and the
   * two knobs are now free to move independently.
   *
   * **What the move did change is what the playground can reach**, since `RAM_CONFIG` is a
   * `tuning.ts` root and `SLAM_CONFIG` is not. Three differences, none of which affect a release
   * build: the `ram.spinScale` slider no longer moves slam spin (it moves ram spin alone, which is
   * what its name says); `ram.inertiaCoefficient` is gone as a slider, deleted with the constant; and
   * the slam's inertia term now tracks a live `drive.carWidth`/`carHeight` override, because
   * `inertiaRadiusSquared()` computes from the hull on every call where the frozen
   * `inertiaCoefficient` did not. Making THIS one tunable would mean adding `SLAM_CONFIG` to
   * `tuning.ts` — a decision for whoever wants the slider, not a side effect of this move.
   *
   * `RAM_CONFIG.spinMaxRate` still clamps the result, shared by both paths.
   */
  spinScale: 12.5,
} as const;
