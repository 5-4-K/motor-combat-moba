import { turret, clampToSwing, wrapAngle } from "@motor-combat-moba/shared";
import { CROSSHAIR_CONFIG } from "../config/crosshair.js";

/**
 * The crosshair as a WORLD-SPACE offset from the driven car's centre (spec TR56). It rides with the
 * car, keeps its world direction when the car turns, and is held to two limits: a length of at most
 * `CROSSHAIR_CONFIG.maxDistance`, and a direction inside the turret's swing arc about the car's
 * current heading (`turret().maxSwingDeg`, TR55 — no angular limit at 360). Both are read at
 * call time, as defaults, so a live retune reaches the next frame.
 */
export interface AimOffset {
  x: number;
  y: number;
}

/** Where the crosshair starts: straight ahead of the car, at the max distance. */
export function initialAimOffset(carAngle: number, maxDistance: number = CROSSHAIR_CONFIG.maxDistance): AimOffset {
  return { x: Math.cos(carAngle) * maxDistance, y: Math.sin(carAngle) * maxDistance };
}

/**
 * Hold an offset to both limits. Run every frame, not only on mouse movement: the car may have
 * turned the offset's (unchanged) world direction out of the arc, which pushes it to the nearer arc
 * edge at the same length. An offset already inside both limits comes back unchanged.
 */
export function clampAimOffset(
  offset: AimOffset,
  carAngle: number,
  maxDistance: number = CROSSHAIR_CONFIG.maxDistance,
  maxSwingDeg: number = turret().maxSwingDeg,
): AimOffset {
  const length = Math.hypot(offset.x, offset.y);
  if (length === 0) return offset;
  const clamped = Math.min(length, Math.max(0, maxDistance));
  const direction = Math.atan2(offset.y, offset.x);
  const rel = wrapAngle(direction - carAngle);
  const swung = clampToSwing(rel, maxSwingDeg);
  if (clamped === length && swung === rel) return offset;
  if (swung === rel) return { x: (offset.x / length) * clamped, y: (offset.y / length) * clamped };
  const angle = carAngle + swung;
  return { x: Math.cos(angle) * clamped, y: Math.sin(angle) * clamped };
}

/** Add a world-unit mouse delta, then hold the result to both limits. */
export function moveAimOffset(
  offset: AimOffset,
  dx: number,
  dy: number,
  carAngle: number,
  maxDistance: number = CROSSHAIR_CONFIG.maxDistance,
  maxSwingDeg: number = turret().maxSwingDeg,
): AimOffset {
  return clampAimOffset({ x: offset.x + dx, y: offset.y + dy }, carAngle, maxDistance, maxSwingDeg);
}

/**
 * A pointer-lock `movementX/Y` delta, in CSS pixels, as world units: CSS pixels to game pixels
 * through the canvas's fitted size (they differ whenever the Scale Manager has fitted the canvas to
 * a window of another size), then game pixels to world units through the camera zoom, then turned
 * out of the camera's rotation. A canvas not yet laid out (zero client size) is treated as unscaled.
 *
 * `viewRotation` is the world camera's rotation — 0, or π for team B on a flip arena (CQ46). Phaser
 * turns world into screen by `+rotation`, so a screen step is turned back by `-rotation` here: the
 * mouse moving right moves the crosshair right on screen, whichever way the world is drawn (CQ48).
 */
export function cssDeltaToWorld(
  dxCss: number,
  dyCss: number,
  game: { width: number; height: number },
  css: { width: number; height: number },
  zoom: number,
  viewRotation = 0,
): AimOffset {
  const sx = css.width > 0 ? game.width / css.width : 1;
  const sy = css.height > 0 ? game.height / css.height : 1;
  const x = (dxCss * sx) / zoom;
  const y = (dyCss * sy) / zoom;
  if (viewRotation === 0) return { x, y };
  const cos = Math.cos(viewRotation);
  const sin = Math.sin(viewRotation);
  return { x: x * cos + y * sin, y: -x * sin + y * cos };
}

/** The parts of a Phaser camera `projectToScreen` needs, with the scroll ALREADY bounds-clamped. */
export interface CameraView {
  x: number;
  y: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  zoomX: number;
  zoomY: number;
  scrollX: number;
  scrollY: number;
}

/**
 * A world point in canvas pixels, through the same transform Phaser's camera builds in its
 * `preRender` (translate to the origin, rotate, zoom, translate back by the scroll), minus shake —
 * the crosshair is the player's hand, not the world, so it does not shake with it. The arena camera
 * rotates by 0, or by π for team B on a flip arena (CQ46); `viewRotation` is that angle, applied as
 * Phaser's `applyITRS` applies it (`+rotation`, about the view's origin). Computed from the camera's
 * CURRENT scroll rather than read off `matrixCombined`, which is last frame's until the camera
 * renders: reading that would leave the crosshair a frame behind a camera that follows the car.
 */
export function projectToScreen(
  view: CameraView,
  world: { x: number; y: number },
  viewRotation = 0,
): AimOffset {
  const ox = view.width * view.originX;
  const oy = view.height * view.originY;
  const dx = world.x - view.scrollX - ox;
  const dy = world.y - view.scrollY - oy;
  if (viewRotation === 0) {
    return { x: view.x + ox + dx * view.zoomX, y: view.y + oy + dy * view.zoomY };
  }
  const cos = Math.cos(viewRotation);
  const sin = Math.sin(viewRotation);
  // ITRS: zoom first, then rotate — the same order Phaser composes them in.
  const zx = dx * view.zoomX;
  const zy = dy * view.zoomY;
  return { x: view.x + ox + zx * cos - zy * sin, y: view.y + oy + zx * sin + zy * cos };
}
