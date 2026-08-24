// packages/client/src/assets/asset-keys.ts
import { DEFAULT_CAR_ID, isCarId } from "@motor-combat-moba/shared";

/**
 * The manifest key for a wire `carId`. Namespaced so that powers, projectiles, and effects can land
 * as new rows in the same flat map rather than as a new section of the schema.
 *
 * Unrecognised ids resolve to `DEFAULT_CAR_ID` — the same fallback `carShapeOf` and the sim take —
 * so a stale or hostile id draws the default chassis instead of silently drawing nothing.
 */
export function carSpriteKey(carId: string): string {
  return `car.${isCarId(carId) ? carId : DEFAULT_CAR_ID}`;
}
