import { DRIVE_CONFIG } from "@motor-combat-moba/shared";
import type { FxCarView } from "./events.js";

/**
 * Where to punch a hole in the smoke layer so a car stays visible inside a cloud (VFX18–VFX22).
 *
 * Smoke must never hide a car. In a last-player-standing game, losing sight of an opponent to your
 * own weapon effect costs information the player needs to play, and it is reported as a bug — so
 * this is a gameplay constraint wearing an art costume.
 *
 * The stamp is the car's **sprite-alpha silhouette**, blurred once at boot per chassis by
 * `fx/layer.ts` and erased from the smoke `RenderTexture` each frame. That keeps the smoke at full
 * thickness everywhere except a soft halo around each car, rather than fading whole puffs (which
 * reads as timid smoke) or ordering cars above smoke (which removes every interaction between the
 * two).
 */
export interface EraserStamp {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly width: number;
  readonly height: number;
  /** Which chassis's silhouette to erase with. */
  readonly carId: string;
}

/**
 * How far past the hull the erased halo reaches, in world units.
 *
 * Bigger than the hull on purpose: a stamp exactly the car's size traces its outline in smoke and
 * reads as a sticker. The halo has to clear the car for the hole to look like the car is displacing
 * the cloud.
 */
export const ERASER_HALO = 6;

/**
 * One stamp per living car.
 *
 * Dead cars are skipped: a wreck is intangible from the tick it dies and fades out entirely, so the
 * smoke should close over where it was rather than hold a hole open around a car that is gone.
 */
export function eraserStampsFor(cars: readonly FxCarView[]): EraserStamp[] {
  const stamps: EraserStamp[] = [];
  for (const car of cars) {
    if (!car.alive) continue;
    stamps.push({
      x: car.x,
      y: car.y,
      angle: car.angle,
      width: DRIVE_CONFIG.carWidth + ERASER_HALO * 2,
      height: DRIVE_CONFIG.carHeight + ERASER_HALO * 2,
      carId: car.carId,
    });
  }
  return stamps;
}
