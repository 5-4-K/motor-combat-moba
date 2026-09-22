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
 * a window of another size), then game pixels to world units through the camera zoom. A canvas not
 * yet laid out (zero client size) is treated as unscaled.
 */
export function cssDeltaToWorld(
  dxCss: number,
  dyCss: number,
  game: { width: number; height: number },
  css: { width: number; height: number },
  zoom: number,
): AimOffset {
  const sx = css.width > 0 ? game.width / css.width : 1;
  const sy = css.height > 0 ? game.height / css.height : 1;
  return { x: (dxCss * sx) / zoom, y: (dyCss * sy) / zoom };
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
 * `preRender` (translate to the origin, zoom, translate back by the scroll), minus rotation and
 * shake — the arena camera never rotates, and the crosshair is the player's hand, not the world, so
 * it does not shake with it. Computed from the camera's CURRENT scroll rather than read off
 * `matrixCombined`, which is last frame's until the camera renders: reading that would leave the
 * crosshair a frame behind a camera that follows the car.
 */
export function projectToScreen(view: CameraView, world: { x: number; y: number }): AimOffset {
  const ox = view.width * view.originX;
  const oy = view.height * view.originY;
  return {
    x: view.x + ox + (world.x - view.scrollX - ox) * view.zoomX,
    y: view.y + oy + (world.y - view.scrollY - oy) * view.zoomY,
  };
}
