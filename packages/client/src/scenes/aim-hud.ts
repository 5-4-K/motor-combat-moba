import type Phaser from "phaser";
import { muzzleOffset } from "@motor-combat-moba/shared";
import { AIM_HUD_STYLE as S } from "../config/aim-hud.js";
import { HP_BAR_GEOMETRY } from "./combat-visual.js";
import { pts } from "./graphics-points.js";

/**
 * The aim HUD's geometry, in the CAR's own frame with the car's centre at the origin and its nose
 * along +x — the same frame `hpBarPoints` and `drawCar` work in.
 *
 * Pure numbers here, the fill in {@link drawAimHud}, the placement in `ArenaScene`: the shape
 * `countdown-arrow.ts` and `combat-visual.ts` already use, so every rule about where a mark sits is
 * reachable from a Node test with no canvas.
 *
 * Two GROUPS live here rather than three indicators: the TURRET group (the ring and the swing
 * limits) and the MUZZLE group (the arrows), each switched by its own field on `AimHudSpec`. The
 * crosshair belongs to the turret group too, but it is screen-space and `ArenaScene` draws it —
 * `config/aim-hud.ts` carries the whole split.
 *
 * **Why the car's frame and not the world's.** The whole HUD turns with the chassis — the swing
 * limits are relative to the nose and the muzzle directions are car-relative by definition — so the
 * scene draws it ONCE at the origin and then moves a `Graphics` to the car's pose each frame. That
 * is not only cheaper than re-tessellating two dozen dashes every frame (the reason `hud-bake.ts`
 * exists); it is what makes the ring's dash pattern ride the car instead of crawling around it.
 */

/** The four fixed muzzle directions, degrees off the car's nose (`WeaponDef.muzzles`' full set). */
export const MUZZLE_DIRS_DEG: readonly number[] = [0, 90, 180, 270];

/**
 * How far out the two LATERAL arrows (±90°) sit: the muzzle's own standoff, which is where the sim
 * really spawns a shot fired on that bearing.
 *
 * `muzzleOffset()` is `carWidth / 2` for every direction, so the side arrows stand 30 u out against
 * a hull that is only 20 u to each side — they float clear of the bodywork, and that is the honest
 * picture rather than a drawing error.
 */
export const LATERAL_STANDOFF = muzzleOffset();

/**
 * How far out the two AXIAL arrows (nose and tail) sit: past the hp bar, not at the muzzle.
 *
 * At `LATERAL_STANDOFF` the tail arrow would be drawn underneath the hp bar — the HUD is below the
 * car but the bar is far above it, so the bar would simply cover the arrow. Both axial arrows move
 * out together rather than only the tail one, because a nose arrow and a tail arrow at different
 * radii read as a mistake. Derived from the bar rather than typed, so moving the bar moves these
 * (`aim-hud.test.ts` holds the clearance).
 */
export const AXIAL_STANDOFF = HP_BAR_GEOMETRY.offset + HP_BAR_GEOMETRY.thickness + S.hpBarClearance;

/** Nose and tail stand past the hp bar; the sides stand at the muzzle. */
export function standoffOf(dirDeg: number): number {
  return dirDeg % 180 === 0 ? AXIAL_STANDOFF : LATERAL_STANDOFF;
}

/**
 * What one frame of the aim HUD is drawn from. Everything in it can move at runtime, including which
 * of the two GROUPS are drawn at all — see `config/aim-hud.ts` for what the split means.
 */
export interface AimHudSpec {
  /**
   * Draw the TURRET group: the ring and the swing limits. False for a car with no turret weapon
   * (`carHasTurretWeapon`, TR53) — a ring marking the reach of a crosshair that car does not have is
   * a measurement of nothing — and false when `AIM_HUD_CONFIG.turretHud` is off.
   *
   * The crosshair itself is not drawn here (it is screen-space, and `ArenaScene` owns it), but it
   * belongs to this group and is hidden by the same loadout gate.
   */
  showTurret: boolean;
  /**
   * Draw the MUZZLE group: the four arrows. Independent of the turret group, because the fixed
   * muzzles are a fact about the car's heading and every chassis has one.
   */
  showMuzzle: boolean;
  /** The ring's radius: this room's crosshair reach, world units from the car's CENTRE. */
  ringRadius: number;
  /** The turret's swing arc in degrees, centred on the nose. 360 or more draws no limit lines. */
  maxSwingDeg: number;
  /** The turret mount in the car's own frame — where the swing lines start. `{0, 0}` on every
   *  shipped chassis, but a playground tuning key can move it, so it is never assumed. */
  pivot: { x: number; y: number };
}

/**
 * What the drawn picture depends on, as a string.
 *
 * The scene re-draws only when this changes, for the reason `sameCommands` exists in `hud-bake.ts`:
 * between a playground edit and the next one it is the same two dozen dashes every frame, and
 * Phaser re-tessellates a `Graphics` whether or not its commands moved. The arrows are left out
 * because nothing about them can move without a rebuild of the client.
 */
export function aimHudSignature(spec: AimHudSpec): string {
  const groups = `${spec.showTurret ? "t" : ""}${spec.showMuzzle ? "m" : ""}`;
  return `${groups}|${spec.ringRadius}|${spec.maxSwingDeg}|${spec.pivot.x}|${spec.pivot.y}`;
}

/** One dash on the ring, as the angle span Phaser's `arc` takes. */
export interface ArcSpan {
  start: number;
  end: number;
}

/**
 * The ring's dashes, evenly spaced so the pattern closes on itself.
 *
 * The dash count is rounded to fit the circumference and the dash/gap RATIO is then preserved
 * against the spacing that count implies, rather than laying dashes at their authored length and
 * leaving a short one at the seam. A ring with a visible join reads as a broken circle, which is
 * the one thing this mark must not say.
 */
export function dashedRingSpans(
  radius: number,
  dashLength = S.dashLength,
  dashGap = S.dashGap,
): ArcSpan[] {
  if (!(radius > 0)) return [];
  const period = dashLength + dashGap;
  if (!(period > 0)) return [];
  const count = Math.max(1, Math.round((Math.PI * 2 * radius) / period));
  const step = (Math.PI * 2) / count;
  const arc = step * (dashLength / period);
  const spans: ArcSpan[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = i * step;
    spans.push({ start, end: start + arc });
  }
  return spans;
}

/** One dash on a straight run. */
export interface DashSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * A straight run broken into dashes that START and END on a dash, so a swing line visibly touches
 * both the pivot it leaves and the ring it stops at. `n` dashes and `n - 1` gaps, the authored
 * ratio scaled to fit exactly — the same fitting rule {@link dashedRingSpans} uses.
 */
export function dashedLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashLength = S.dashLength,
  dashGap = S.dashGap,
): DashSegment[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return [];
  const period = dashLength + dashGap;
  if (!(period > 0)) return [{ x1, y1, x2, y2 }];
  const count = Math.max(1, Math.round((length + dashGap) / period));
  // n dashes + (n - 1) gaps == length, holding dash : gap where it was authored.
  const unit = length / (count * dashLength + (count - 1) * dashGap);
  const dash = dashLength * unit;
  const gap = dashGap * unit;
  const ux = dx / length;
  const uy = dy / length;
  const out: DashSegment[] = [];
  for (let i = 0; i < count; i += 1) {
    const from = i * (dash + gap);
    out.push({
      x1: x1 + ux * from,
      y1: y1 + uy * from,
      x2: x1 + ux * (from + dash),
      y2: y1 + uy * (from + dash),
    });
  }
  return out;
}

/**
 * How far along `angle` from `origin` the ring is crossed, or 0 when that ray never reaches it.
 *
 * A plain `ringRadius` would be right only while the turret mount sits at the car's centre, which
 * is where every shipped chassis puts it — and a playground tuning key (`car.<id>.turretMount.x`)
 * can move it live. Solving the intersection is six lines and cannot go stale.
 */
export function ringCrossing(
  origin: { x: number; y: number },
  radius: number,
  angle: number,
): number {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const along = origin.x * ux + origin.y * uy;
  const disc = along * along - (origin.x * origin.x + origin.y * origin.y) + radius * radius;
  if (disc < 0) return 0;
  return Math.max(0, -along + Math.sqrt(disc));
}

/**
 * The two swing-limit runs, pivot out to the ring — or NOTHING at an unrestricted turret.
 *
 * `maxSwingDeg >= 360` is the shipped value and means the turret may point anywhere, which is
 * exactly `clampBearingToSwing`'s own early return. Both lines would land on the car's tail, one on
 * top of the other, and a mark that says "the limit is here" pointing at a place that is not a limit
 * is worse than no mark: the lines are simply not drawn, rather than drawn and then explained.
 */
export function swingLimitLines(spec: AimHudSpec): DashSegment[] {
  if (!spec.showTurret) return [];
  if (spec.maxSwingDeg >= 360) return [];
  const half = (Math.max(0, spec.maxSwingDeg) * Math.PI) / 360;
  const out: DashSegment[] = [];
  for (const angle of [-half, half]) {
    const reach = ringCrossing(spec.pivot, spec.ringRadius, angle);
    if (reach <= 0) continue;
    out.push(
      ...dashedLine(
        spec.pivot.x,
        spec.pivot.y,
        spec.pivot.x + Math.cos(angle) * reach,
        spec.pivot.y + Math.sin(angle) * reach,
      ),
    );
  }
  return out;
}

/**
 * One muzzle arrow's four corners in the car's frame: tip first, then the two base corners with the
 * notch between them, so the polygon winds tip -> left -> notch -> right.
 *
 * Concave on purpose — `fillPoints` triangulates it — because at arena zoom a 10-unit triangle
 * reads as a dot while the same shape with a notch still reads as pointing somewhere.
 */
export function muzzleArrowPoints(dirDeg: number): Array<{ x: number; y: number }> {
  const angle = (dirDeg * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const base = standoffOf(dirDeg);
  // Local to the arrow: +x along the direction it points, +y across it.
  const local: Array<[number, number]> = [
    [base + S.arrowLength, 0],
    [base, -S.arrowHalfWidth],
    [base + S.arrowNotch, 0],
    [base, S.arrowHalfWidth],
  ];
  return local.map(([ax, ay]) => ({ x: ax * c - ay * s, y: ax * s + ay * c }));
}

/** All four arrows, in `MUZZLE_DIRS_DEG` order. */
export function muzzleArrows(): Array<Array<{ x: number; y: number }>> {
  return MUZZLE_DIRS_DEG.map(muzzleArrowPoints);
}

/**
 * Fill one aim HUD into a `Graphics`, at the origin and in the car's frame.
 *
 * The caller owns the placement (`setPosition` / `setRotation` to the car's render pose) and owns
 * the decision to call at all — this never asks whose car it is, whether the HUD is switched on, or
 * whether the car is alive.
 */
export function drawAimHud(gfx: Phaser.GameObjects.Graphics, spec: AimHudSpec): void {
  gfx.clear();
  if (spec.showTurret) {
    gfx.lineStyle(S.lineWidth, S.color, S.lineAlpha);
    for (const span of dashedRingSpans(spec.ringRadius)) {
      gfx.beginPath();
      gfx.arc(0, 0, spec.ringRadius, span.start, span.end, false);
      gfx.strokePath();
    }
    for (const seg of swingLimitLines(spec)) gfx.lineBetween(seg.x1, seg.y1, seg.x2, seg.y2);
  }
  if (spec.showMuzzle) {
    gfx.fillStyle(S.color, S.arrowAlpha);
    for (const points of muzzleArrows()) gfx.fillPoints(pts(points), true);
  }
}

/** Is there anything at all to draw? Both groups off means the scene hides the layer outright. */
export function aimHudIsEmpty(spec: AimHudSpec): boolean {
  return !spec.showTurret && !spec.showMuzzle;
}
