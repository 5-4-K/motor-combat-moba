import { isCarId } from "@motor-combat-moba/shared";
import { CROSSHAIR_CONFIG } from "../config/crosshair.js";
import { TURRET_VISUAL } from "../config/turret-visual.js";

/**
 * The playground's client-only turret knobs (spec TR60): how far the crosshair may sit from the car,
 * how long the turret is drawn, and a per-car multiplier on that length.
 *
 * Nothing here reaches the sim or the wire. The two SIM turret knobs (turn rate, swing arc) and the
 * mounts ride the shared tuning store instead, because the server turns and spawns from them.
 *
 * The map is FLAT, keyed `crosshairMaxDistance`, `lengthUnits` and `carScale.<carId>` — the shape
 * `env-tuning.ts` uses, so one lenient per-entry sanitizer covers a stored blob and the resolver alike.
 *
 * A module-level singleton for the reason `fx/env-store.ts` is one: the thing that sets it is a DOM
 * overlay with no handle on the scene. Being global does not decide its reach — only a playground
 * room builds a resolver over it (`ArenaScene`), so an arena or practice room draws the shipped
 * crosshair and turret whatever this browser has saved (TR60, EV34's rule).
 */
export type TurretViewOverrides = Record<string, number>;

/** The resolved knobs one frame draws with. `carScale` holds only cars that were given one. */
export interface TurretView {
  readonly crosshairMaxDistance: number;
  readonly lengthUnits: number;
  readonly carScale: Readonly<Record<string, number>>;
}

export type TurretViewResolver = () => TurretView;

/**
 * The panel's slider bounds, and what the sanitizer and resolver accept. Every shipped value sits
 * on its grid (the test holds that), so an untouched panel never shows an off-grid readout. The
 * crosshair floor is above zero: at 0 the crosshair sits on the car's centre and the aim falls back
 * to the turret's own heading (TR33), which reads as "the mouse does nothing".
 */
export const TURRET_VIEW_BOUNDS = {
  crosshairMaxDistance: { min: 10, max: 400, step: 5 },
  lengthUnits: { min: 8, max: 108, step: 1 },
  carScale: { min: 0.25, max: 3, step: 0.05 },
} as const;

export const CROSSHAIR_DISTANCE_KEY = "crosshairMaxDistance";
export const TURRET_LENGTH_KEY = "lengthUnits";
const CAR_SCALE_PREFIX = "carScale.";

export function carScaleKey(carId: string): string {
  return `${CAR_SCALE_PREFIX}${carId}`;
}

/** The bounds a key is held to, or `undefined` for a key this panel does not own. */
function boundsOf(key: string): { readonly min: number; readonly max: number } | undefined {
  if (key === CROSSHAIR_DISTANCE_KEY) return TURRET_VIEW_BOUNDS.crosshairMaxDistance;
  if (key === TURRET_LENGTH_KEY) return TURRET_VIEW_BOUNDS.lengthUnits;
  if (key.startsWith(CAR_SCALE_PREFIX) && isCarId(key.slice(CAR_SCALE_PREFIX.length))) {
    return TURRET_VIEW_BOUNDS.carScale;
  }
  return undefined;
}

function isAcceptable(key: string, value: unknown): value is number {
  const bounds = boundsOf(key);
  return (
    bounds !== undefined &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= bounds.min &&
    value <= bounds.max
  );
}

/**
 * A stored blob, entry by entry (TR62): an unknown key, an unknown car or an out-of-range number
 * costs that one entry, never the section — the rule every other playground section follows. Dropped
 * rather than clamped, as `sanitizeStoredEnv` drops: a silent repair would hide what wrote it.
 */
export function sanitizeTurretView(value: unknown): TurretViewOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: TurretViewOverrides = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isAcceptable(key, raw)) out[key] = raw;
  }
  return out;
}

/**
 * The overrides merged over the shipped client config. Shipped values are read at CALL time, so a
 * resolver built before some later edit to `CROSSHAIR_CONFIG` still agrees with it. An entry the
 * sanitizer would drop is ignored here too: the map is mutated in place by the panel, and the
 * resolver must never draw a value the panel could not have produced.
 */
export function resolveTurretView(overrides: TurretViewOverrides): TurretView {
  const pick = (key: string, shipped: number): number => {
    const value = overrides[key];
    return isAcceptable(key, value) ? value : shipped;
  };
  const carScale: Record<string, number> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key.startsWith(CAR_SCALE_PREFIX) && isAcceptable(key, value)) {
      carScale[key.slice(CAR_SCALE_PREFIX.length)] = value;
    }
  }
  return {
    crosshairMaxDistance: pick(CROSSHAIR_DISTANCE_KEY, CROSSHAIR_CONFIG.maxDistance),
    lengthUnits: pick(TURRET_LENGTH_KEY, TURRET_VISUAL.lengthUnits),
    carScale,
  };
}

/** One car's drawn turret length before its manifest row's own `scale`: the global length times its multiplier. */
export function turretLengthOf(view: TurretView, carId: string): number {
  return view.lengthUnits * (view.carScale[carId] ?? 1);
}

/** What every room but a playground draws with. Reads no store. */
export function shippedTurretView(): TurretView {
  return resolveTurretView({});
}

let current: TurretViewOverrides = {};

/** The live map, by reference: the panel mutates it in place, as the other panels mutate theirs. */
export function turretViewOverrides(): TurretViewOverrides {
  return current;
}

/** Replace the map. `null` clears it — what `PlaygroundScene.onShutdown` calls. */
export function setTurretViewOverrides(next: TurretViewOverrides | null): void {
  current = next ?? {};
}

/**
 * The playground's resolver, re-resolving on every call. Not cached behind a version counter the way
 * `env-store.ts` is: this is three reads and a loop over at most eleven keys, called a handful of
 * times a frame, so a counter would cost as much as it saves.
 */
export function liveTurretViewResolver(): TurretViewResolver {
  return () => resolveTurretView(current);
}
