import { WORLD_FACES, type WorldFace } from "../faces.js";

/**
 * The tile definitions arenas are built from (spec tile arenas TA1–TA13, reshaped by tile cells
 * TC1–TC14).
 *
 * A definition carries BEHAVIOUR only — collision, shape, hazard — and a default look. No definition
 * carries a character (TC11): an arena's legend maps characters to cells (`legend.ts`), and a cell
 * picks its own art (TC1). Two cells with the same definition and different art behave identically.
 *
 * GLOBAL, not per mode: a definition is a piece of level geometry, like an arena. Reading
 * `TILE_SIZE`/`TILE_DEFS` at module scope is fine — they are constants, not mode accessors.
 *
 * `surface` (grip, drag, accel — TA1's movement behaviour) is declared so the shape is ready, and is
 * refused by `tile-config.test.ts` until the sim reads it (TA12).
 */

/** World units per tile side (TA3). The shipped 1600 x 880 default arenas are a 40 x 22 grid. */
export const TILE_SIZE = 40;

/** Clockwise degrees (TC3). At 0 a definition's `front` faces north (−y). */
export type TileRotation = 0 | 90 | 180 | 270;
/** A side in the definition's own frame (TC4); the cell's orientation turns it into a world face. */
export type TileSide = "front" | "right" | "back" | "left";

/** Damage numbers stay in the active mode's `spike()` table; the tile only says WHICH hazard, and where. */
export interface TileHazard {
  readonly kind: "spike";
  readonly sides: "all" | readonly TileSide[];
}

/** An overlay drawn on each damaging side that borders a non-solid cell (TC6). */
export interface TileOverlayRule {
  /** Authored for the TOP edge; rotated per side. */
  readonly art: string;
}

/** Reserved for movement behaviour (TA1 "C"). Multipliers, 1 = neutral, like `Modifiers`. */
export interface TileSurface {
  readonly grip?: number;
  readonly drag?: number;
  readonly accel?: number;
}

export interface TileDef {
  readonly collision: "none" | "solid";
  /** TA2: diagonal half-tiles arrive here later. */
  readonly shape: "full";
  readonly hazard?: TileHazard;
  /** Reserved; refused by test until the sim reads it (TA12). */
  readonly surface?: TileSurface;
  /** Void: no art, the backdrop shows. Mutually exclusive with `defaultArt` (TC12). */
  readonly draw?: "none";
  /** The art a cell draws when it names none (TC14). */
  readonly defaultArt?: string;
  readonly overlay?: TileOverlayRule;
}

export const TILE_DEFS = {
  floor: { collision: "none", shape: "full", defaultArt: "metal-plate" },
  wall: { collision: "solid", shape: "full", defaultArt: "checker-plate" },
  spike: {
    collision: "solid",
    shape: "full",
    defaultArt: "checker-plate",
    hazard: { kind: "spike", sides: "all" },
    overlay: { art: "spike-teeth" },
  },
  void: { collision: "solid", shape: "full", draw: "none" },
} as const satisfies Record<string, TileDef>;

export type TileDefId = keyof typeof TILE_DEFS;

const SIDES: readonly TileSide[] = ["front", "right", "back", "left"];

/** A definition's hazard sides as world faces for a cell at `orientation` (TC3, TC4), in n-e-s-w order. */
export function rotateSides(sides: "all" | readonly TileSide[], orientation: TileRotation): WorldFace[] {
  if (sides === "all") return [...WORLD_FACES];
  const steps = orientation / 90;
  const hit = new Set(
    sides.map((s) => {
      const i = SIDES.indexOf(s);
      if (i < 0) throw new Error(`Unknown tile side ${JSON.stringify(s)}; expected front, right, back or left`);
      return (i + steps) % 4;
    }),
  );
  return WORLD_FACES.filter((_, i) => hit.has(i));
}
