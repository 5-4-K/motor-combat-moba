/**
 * Every environment visual constant, in one place (spec EV6).
 *
 * **Client-side for the same reason `WEAPON_FX` is (VFX30, EV2).** `balanceStamp` hashes the shared
 * tables whole, including purely visual fields, so a table like this one living in shared would make
 * every look tweak owe a `npm run build:manual` and a stamp update. Here it owes nothing.
 *
 * Every value below was lifted verbatim from where it used to live — `ArenaScene.drawArena`,
 * `fx/camera.ts`, `fx/decals.ts`, `fx/occlusion.ts`, `fx/textures.ts`, `fx/layer.ts`,
 * `fx/emitters.ts`. `environment.test.ts` pins each one against the literal that shipped, so the
 * move cannot change a pixel (EV7).
 *
 * **The asphalt seed is deliberately absent (EV9).** It is `arena.width * 31 + arena.height` so that
 * every client in a room generates the same floor; a tunable, persisted or exported seed would break
 * that agreement. The panel offers a preview-only reroll instead.
 */
export interface EnvironmentFx {
  /** The warm-desaturated `ColorMatrix` grade (VFX27). `warmG` is held at 1 and is not a field. */
  readonly grade: {
    readonly saturate: number;
    readonly warmR: number;
    readonly warmB: number;
    readonly brightness: number;
  };
  readonly vignette: {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly strength: number;
  };
  /**
   * Camera shake (VFX26). The `*Cap` values are FRACTIONS OF `max`, not absolute intensities, which
   * is how the shipped code expresses them and what keeps the documented ordering — ram ties
   * `damaged`, both below an explosion, all below a kill — true under a retune of `max` alone.
   */
  readonly shake: {
    readonly max: number;
    readonly diedMs: number;
    readonly damagedMs: number;
    readonly damagedBase: number;
    readonly damagedPerHp: number;
    readonly damagedCap: number;
    readonly explosionMs: number;
    readonly explosionCap: number;
    readonly ramMs: number;
    readonly ramFloor: number;
    readonly ramPerSpeed: number;
    readonly ramCap: number;
  };
  readonly hitStop: { readonly ms: number; readonly scale: number };
  /**
   * The persistent ground layer (VFX23). `tyreTrackRatio` is a FRACTION OF `DRIVE_CONFIG.carHeight`
   * rather than a pixel number (EV8), so a chassis retune still moves the track width.
   */
  readonly decals: {
    readonly halfLifeMs: number;
    readonly maxTotal: number;
    readonly maxScorch: number;
    readonly fadeCutoff: number;
    readonly tyreSpacing: number;
    readonly tyreMaxStep: number;
    readonly tyreSpeedFloor: number;
    readonly tyreTrackRatio: number;
    readonly tyreRadius: number;
    readonly tyreAlpha: number;
    readonly tyreTint: number;
    readonly scorchAlphaShot: number;
    readonly scorchAlphaDeath: number;
    readonly scorchScaleDeath: number;
    /** The fallback for a weapon whose row authors no `scorchScale` (EV10). */
    readonly scorchScaleDefault: number;
  };
  readonly occlusion: { readonly halo: number };
  /**
   * The generated asphalt (VFX36). `grainCells`, `patchCells` and both octave counts MUST stay whole
   * numbers — `tileableFbm`'s period is in cells and has to be an integer for the lattice to close,
   * which is the seam `textures.test.ts`'s tiling case pins (EV15).
   */
  readonly floor: {
    readonly grainCells: number;
    readonly patchCells: number;
    readonly grainOctaves: number;
    readonly patchOctaves: number;
    readonly grainWeight: number;
    readonly patchWeight: number;
    readonly baseGrey: number;
    readonly greySpan: number;
    readonly warmR: number;
    readonly warmG: number;
    readonly warmB: number;
  };
  readonly markings: {
    readonly laneColor: number;
    readonly laneAlpha: number;
    readonly laneWidth: number;
    readonly laneSpacing: number;
    readonly laneDash: number;
    readonly laneMargin: number;
    readonly circleAlpha: number;
    readonly circleWidth: number;
    readonly circleRadius: number;
  };
  /** How a damage burst's spark count follows the hp lost (EV22). */
  readonly carBursts: { readonly sparkPerHp: number; readonly countFloor: number };
}

// Each section is `Object.freeze`d individually — not the top-level object, since freezing that
// alone leaves every nested section object still writable — so a bug that tries to write through
// `resolveEnvironment`'s spread (see its own comment in `env-tuning.ts`) throws in every environment
// (a plain assignment is silently a no-op in non-strict mode, which is worse: the mutation would look
// like it worked) instead of quietly corrupting the shipped table for every later reader.
export const ENVIRONMENT_FX: EnvironmentFx = {
  grade: Object.freeze({ saturate: -0.22, warmR: 1.07, warmB: 0.92, brightness: 0.96 }),
  vignette: Object.freeze({ x: 0.5, y: 0.5, radius: 0.78, strength: 0 }),
  shake: Object.freeze({
    max: 0.02,
    diedMs: 260,
    damagedMs: 120,
    damagedBase: 0.0015,
    damagedPerHp: 0.00018,
    damagedCap: 0.6,
    explosionMs: 200,
    explosionCap: 0.75,
    ramMs: 120,
    ramFloor: 0.006,
    ramPerSpeed: 0.00002,
    ramCap: 0.6,
  }),
  hitStop: Object.freeze({ ms: 90, scale: 0.25 }),
  decals: Object.freeze({
    halfLifeMs: 40_000,
    maxTotal: 600,
    maxScorch: 0,
    fadeCutoff: 0.02,
    tyreSpacing: 4.5,
    tyreMaxStep: 80,
    tyreSpeedFloor: 40,
    tyreTrackRatio: 1 / 3,
    tyreRadius: 2.7,
    tyreAlpha: 0.18,
    tyreTint: 0x141210,
    scorchAlphaShot: 0.55,
    scorchAlphaDeath: 0.7,
    scorchScaleDeath: 1.4,
    scorchScaleDefault: 0.35,
  }),
  occlusion: Object.freeze({ halo: 14 }),
  floor: Object.freeze({
    grainCells: 64,
    patchCells: 8,
    grainOctaves: 3,
    patchOctaves: 2,
    grainWeight: 0.62,
    patchWeight: 0.38,
    baseGrey: 50,
    greySpan: 46,
    warmR: 20,
    warmG: 0,
    warmB: -20,
  }),
  markings: Object.freeze({
    laneColor: 0xdccd96,
    laneAlpha: 0.13,
    laneWidth: 6,
    laneSpacing: 46,
    laneDash: 26,
    laneMargin: 40,
    circleAlpha: 0.1,
    circleWidth: 4,
    circleRadius: 130,
  }),
  carBursts: Object.freeze({ sparkPerHp: 0.5, countFloor: 1 }),
};
