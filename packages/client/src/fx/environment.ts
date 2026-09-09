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
   * A lingering lava field (spec LZ28-LZ38). Two stamps per live field: a dark crust of plates at
   * `LAVA_DEPTH`, and the hot cracks between them additively at `GLOW_DEPTH`.
   *
   * **`cells`, `octaves`, `seamWidth` and `featherStart` are baked into the texture** and need the
   * panel's Regenerate button, exactly as `floor.*` does (EV27). Every other field here is live:
   * both textures are generated greyscale and coloured by tint at draw time, which is what keeps
   * the colours tunable without a rebuild.
   */
  readonly lava: {
    /** Plates across the texture. Baked. Higher is a finer crackle. */
    readonly cells: number;
    /** Octaves of grain within a plate. Baked. */
    readonly octaves: number;
    /** How wide a seam is, in cell units, before it falls to nothing. Baked. */
    readonly seamWidth: number;
    /** Fraction of the radius the crust holds full before feathering to 0 at the edge. Baked. */
    readonly featherStart: number;
    readonly crustTint: number;
    readonly crustAlpha: number;
    readonly seamTint: number;
    readonly seamAlpha: number;
    /** Seam brightness cycles per second. 0 freezes it. */
    readonly pulseHz: number;
    /** How much of `seamAlpha` the pulse takes off at its trough, 0-1. */
    readonly pulseDepth: number;
  };
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
  /**
   * How a car is lit and grounded (EV35). The arena's one light, and everything derived from it.
   *
   * There was no light anywhere in the renderer before this: a car was a flat tint on flat asphalt,
   * with nothing to say which way is up and nothing tying it to the floor.
   * `scenes/car-lighting.ts` turns this section into corner tints, a rim, and two shadows, and every
   * strength is authored so that ZEROING THEM ALL restores the flat look exactly — the effect is a
   * layer over the old drawing, never a replacement for it.
   */
  readonly carLook: {
    /**
     * Where the light is, in degrees, as the direction FROM a car TOWARD it. The lit side of every
     * car faces this way and every shadow is thrown opposite it, which is what makes six cars at six
     * headings read as one scene rather than six separately-lit stickers.
     */
    readonly lightAngle: number;
    /** How far the drop shadow is thrown, in world units. 0 puts it straight under the car. */
    readonly shadowOffset: number;
    /** Alpha of the drop shadow's innermost band. */
    readonly shadowAlpha: number;
    /** How much wider the outermost band is than the hull, as a fraction — the softness. */
    readonly shadowSpread: number;
    /** How many nested bands fake that softness. MUST be a whole number; 1 is a hard-edged shadow. */
    readonly shadowBands: number;
    readonly shadowColor: number;
    /**
     * The shadow's size against the hull. Below 1 because the hull is a box drawn around art that
     * does not fill it, and a shadow the size of the box reads as a crate rather than a car.
     */
    readonly footprint: number;
    /** The tight occlusion directly under the hull, which is what actually sits a car on the floor. */
    readonly contactAlpha: number;
    /** The contact shadow's size as a fraction of the hull — below 1, since it darkens the gap. */
    readonly contactScale: number;
    /** How far a lit corner brightens toward white, 0..1. */
    readonly litStrength: number;
    /** How far a shaded corner darkens toward black, 0..1. */
    readonly shadeStrength: number;
    /**
     * The rim light: a copy of the car's OWN ART, tinted and nudged toward the light behind the
     * body, so a lit sliver shows along whatever edge the artwork actually has.
     *
     * It has to be the art and not a stroked outline of the hitbox. The hull is a 48x32 box and the
     * sprites do not fill it, so stroking the box drew a picture frame around the car — which is
     * what the first cut of this shipped and what looking at it on screen immediately killed.
     */
    readonly rimAlpha: number;
    readonly rimColor: number;
    /** How far that copy is nudged, in world units. Effectively the rim's thickness. */
    readonly rimWidth: number;
  };
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
  lava: Object.freeze({
    cells: 7,
    octaves: 3,
    seamWidth: 0.16,
    featherStart: 0.72,
    crustTint: 0x3a2018,
    crustAlpha: 0.92,
    seamTint: 0xff7a10,
    seamAlpha: 0.85,
    pulseHz: 0.9,
    pulseDepth: 0.25,
  }),
  floor: Object.freeze({
    grainCells: 256,
    patchCells: 1,
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
  // Light from up-and-left (-120 degrees, remembering +y is down), which is where overhead lighting
  // is read from in almost every top-down game — a shadow falling down-and-right is what a player
  // expects without being able to say why. The strengths are deliberately restrained: the job is to
  // make a car look MADE of something, not to turn the arena into a diorama.
  carLook: Object.freeze({
    lightAngle: -120,
    shadowOffset: 5,
    shadowAlpha: 0.34,
    shadowSpread: 0.5,
    shadowBands: 5,
    shadowColor: 0x0a0908,
    footprint: 0.86,
    contactAlpha: 0.16,
    contactScale: 0.7,
    litStrength: 0.26,
    shadeStrength: 0.2,
    rimAlpha: 0.55,
    rimColor: 0xfff1d6,
    rimWidth: 1.5,
  }),
};
