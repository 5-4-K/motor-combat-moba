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
  /** The hole's FINAL size in world units. The renderer draws it at exactly this — see `ERASER_HALO`. */
  readonly width: number;
  /** The hole's FINAL size in world units. The renderer draws it at exactly this — see `ERASER_HALO`. */
  readonly height: number;
  /** Which chassis's silhouette to erase with. */
  readonly carId: string;
}

/**
 * How far past the hull the erased halo reaches, in world units — the FULL halo, on every side.
 *
 * Bigger than the hull on purpose: a stamp exactly the car's size traces its outline in smoke and
 * reads as a sticker. The halo has to clear the car for the hole to look like the car is displacing
 * the cloud.
 *
 * **This is the only number that decides how big the hole is.** `EraserStamp.width`/`height` are the
 * *final world size* of the hole, and nothing downstream may scale them again — `fx/layer.ts` hands
 * them straight to `setDisplaySize`. The stamp is blurred once at boot, so the visible edge softens
 * *inside* this halo rather than spilling past it; that blur is what makes the hole read as the car
 * displacing the cloud rather than as its outline traced in smoke, and it is why the halo can be
 * this generous without the hole reading as a hard-edged sticker.
 *
 * A second multiplier in the renderer would make every sentence above a lie that no test could
 * catch — `layer.ts` has no test, by design. A pair of them lived at that call site until fix round
 * 1 and put the hole at roughly 107 x 93 units against a 48 x 32 hull.
 */
export const ERASER_HALO = 14;

/**
 * The final world size of one hole: the hull plus the halo on every side.
 *
 * Identical for every chassis — only the silhouette inside it differs. Exported because `layer.ts`
 * sizes its silhouette textures to this box's aspect, and a second copy of the formula there is
 * exactly how the two would drift apart.
 */
export const ERASER_STAMP_WIDTH = DRIVE_CONFIG.carWidth + ERASER_HALO * 2;
export const ERASER_STAMP_HEIGHT = DRIVE_CONFIG.carHeight + ERASER_HALO * 2;

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
      width: ERASER_STAMP_WIDTH,
      height: ERASER_STAMP_HEIGHT,
      carId: car.carId,
    });
  }
  return stamps;
}
