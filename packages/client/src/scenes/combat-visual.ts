import {
  DEFAULT_PATCH_RATE_HZ,
  DEFAULT_CAR_ID,
  beamShapeAt,
  hpOf,
  isCarId,
  isWeaponId,
  projectileShapeAt,
  weaponDefOf,
  weaponTicksOf,
  type BeamHitbox,
  type WeaponId,
  type WorldShape,
} from "@motor-combat-moba/shared";

/**
 * How full a car's hp bar is, in `[0, 1]`.
 *
 * The denominator comes from the car's own `CAR_TABLE` hp, not from a shared maximum: a hexagon at
 * half hp and a rectangle at half hp must both read as half a bar, or the bar tells you about the
 * chassis instead of about the fight. An unrecognised `carId` falls back to the default chassis,
 * the same fallback the sim uses, rather than dividing by an undefined maximum and rendering NaN.
 */
export function hpFraction(hp: number, carId: string): number {
  const max = hpOf(isCarId(carId) ? carId : DEFAULT_CAR_ID);
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, hp / max));
}

/** Bar colour by remaining hp: green, amber under a third, red under a sixth. */
export function hpBarColor(fraction: number): number {
  if (fraction <= 1 / 6) return 0xd94040;
  if (fraction <= 1 / 3) return 0xd9a03a;
  return 0x49c46a;
}

/** How an hp bar sits relative to its car, in world units. */
export interface HpBarGeometry {
  /** The bar's long axis, across the car — perpendicular to where it is pointing. */
  length: number;
  /** The bar's short axis, along the car's facing direction. */
  thickness: number;
  /** Centre of the car to the near edge of the bar, measured backwards along the facing direction. */
  offset: number;
}

/**
 * The four world-space corners of one hp bar, or of the filled part of one.
 *
 * The bar rides in the car's own frame — laid across its tail, perpendicular to where it points,
 * turning with it — rather than hovering axis-aligned above it. In a top-down arena the car's
 * heading is the thing a player reads first, and a bar that turns with the chassis says whose it is
 * and which way that car is facing in the same glance; an unrotated bar above a car pointing "up"
 * and one above a car pointing "left" look identical.
 *
 * `fraction` clamps to `[0, 1]` and drains toward the car's left, so a bar always empties from the
 * same end of the same chassis no matter which way it happens to be pointing. Pass `1` for the
 * backing plate.
 */
export function hpBarPoints(
  pose: { x: number; y: number; angle: number },
  fraction: number,
  bar: HpBarGeometry,
): Array<{ x: number; y: number }> {
  // Forward is +x in the car's local frame (see `drawCar`), so perpendicular is its +y.
  const fx = Math.cos(pose.angle);
  const fy = Math.sin(pose.angle);
  const px = -fy;
  const py = fx;
  const filled = Math.min(Math.max(fraction, 0), 1) * bar.length;
  const near = -bar.offset;
  const far = -(bar.offset + bar.thickness);
  const left = -bar.length / 2;
  const right = left + filled;
  const at = (along: number, across: number) => ({
    x: pose.x + fx * along + px * across,
    y: pose.y + fy * along + py * across,
  });
  return [at(near, left), at(near, right), at(far, right), at(far, left)];
}

/**
 * How far a shot has travelled since the patch that reported it, for drawing only.
 *
 * Shots arrive at the patch rate (20 Hz) but move at 900 u/s, so a raw draw steps them 45 units at
 * a time. Advancing along the shot's own constant velocity is exact rather than a guess — the
 * server integrates the identical straight line — so this smooths the picture without inventing
 * motion. It is still *only* the picture: hits are decided on the server against the server's
 * positions, and nothing here feeds back into state.
 *
 * Capped at one patch interval so a stalled connection cannot fling a stale shot across the arena
 * while the client waits for the delete that already happened.
 */
export function extrapolateShot(
  x: number,
  y: number,
  angle: number,
  speed: number,
  elapsedMs: number,
): { x: number; y: number } {
  const maxMs = 1000 / DEFAULT_PATCH_RATE_HZ;
  const dt = Math.min(Math.max(elapsedMs, 0), maxMs) / 1000;
  return { x: x + Math.cos(angle) * speed * dt, y: y + Math.sin(angle) * speed * dt };
}

/**
 * A live instance, as it arrives on the wire (`WeaponInstanceState`) — the fields drawing needs.
 * The row's `kind` byte is not among them: the weapon's own definition decides which lifecycle it
 * is, and `spawnInstances` copies that byte from the same definition anyway.
 */
export interface DrawableInstance {
  weaponId: string;
  x: number;
  y: number;
  angle: number;
  extent: number;
}

/**
 * The colour drawn for an instance whose `weaponId` is not in `WEAPON_TABLE` — a neutral grey, so
 * an unknown shot reads as "something is there" without borrowing a shipped weapon's identity.
 */
const UNKNOWN_WEAPON_COLOR = 0x555555;

/**
 * The colour every live instance of a weapon draws in: the weapon's own `color`, never its owner's.
 *
 * Player colour identifies the car; weapon colour identifies the shot. Two cars carrying the same
 * weapon fire the same colour on purpose — an instance is drawn as its own hitbox, so its colour's
 * job is to say what is about to hit you, and the car that fired it is already on screen wearing
 * the player paint. An unrecognised id falls back to grey rather than producing `NaN`, which Phaser
 * renders as an invisible shot.
 */
export function weaponFillOf(weaponId: string): number {
  if (!isWeaponId(weaponId)) return UNKNOWN_WEAPON_COLOR;
  const parsed = Number.parseInt(weaponDefOf(weaponId).color.slice(1), 16);
  return Number.isNaN(parsed) ? UNKNOWN_WEAPON_COLOR : parsed;
}

/** The hitbox radius drawn for an instance whose `weaponId` is not in `WEAPON_TABLE`. */
const UNKNOWN_WEAPON_RADIUS = 3;

/**
 * One concentric band of a glowing instance: how far out it reaches, and what it fills with.
 *
 * `radiusScale` is a FRACTION of the instance's own hitbox radius rather than a world distance, so a
 * style is independent of the weapon it decorates — a re-tune that widens the hitbox rescales the
 * whole glow with it, and no band can silently drift outside the shape that can actually hit you.
 */
export interface GlowBand {
  /** Fraction of the hitbox radius this band reaches, in `(0, 1]`. 1 is the hitbox edge itself. */
  radiusScale: number;
  /** `#RRGGBB` this band fills in. */
  color: string;
}

/**
 * How one weapon's projectiles draw, when a flat disc is not enough.
 *
 * A weapon with no entry in `WEAPON_GLOW_STYLES` keeps drawing as a single fill of its `color`,
 * which is what every weapon did before this existed and what every future weapon gets for free
 * until someone authors a look for it. The styles are deliberately per weapon and NOT derived from
 * `color` by a shared formula: each weapon is meant to have its own silhouette in flight, so a
 * shared ramp would make every weapon a differently-tinted version of the same object.
 */
export interface GlowStyle {
  /** Outermost first. Each band is filled over the one before it, so later bands are the core. */
  bands: GlowBand[];
  /**
   * How far the outline may shrink at the bottom of a flicker, as a fraction of the hitbox radius.
   *
   * Shrink only, never grow: the outermost band sits exactly ON the hitbox edge, and a flicker that
   * could push past it would make the drawn shape larger than the thing that hits — breaking the
   * "what you see is the hitbox" rule the whole draw path is built on. 0 disables the flicker.
   */
  flickerDepth: number;
  /** Flicker cycles per second. */
  flickerHz: number;
}

/**
 * Multiplied into a row's spawn tick to spread the flicker phase across instances. Deliberately not
 * a whole number of cycles: consecutive spawn ticks must not land in phase, or a stream of shots
 * pulses in lockstep and reads as one blinking object rather than several burning ones.
 */
const FLICKER_PHASE_PER_TICK = 0.7;

/**
 * Per-weapon looks. Absent means the flat hitbox disc — see `GlowStyle`.
 *
 * `fireball`: a dark ember rim, the weapon's own `#E8590C` body, a hot orange inner, and a
 * near-white core, every band inside the 12-unit hitbox. The rim is the darkest ring rather than the
 * brightest so the shot still reads as a hard-edged object against a light arena floor, and the
 * white core is what carries at the ~24px this draws at.
 *
 * Bands are cheap -- one `fillCircle` per band per shot per frame, against a ceiling of roughly 60
 * live instances -- so author freely here. What is NOT cheap, and is worth raising before building:
 * a per-instance `setBlendMode`, a faked gradient wanting 15-20 bands, or a `Graphics` object per
 * shot instead of `ArenaScene`'s shared `shotGfx`. See
 * `docs/asset-pipeline.md#how-much-detail-a-shot-can-afford`.
 */
export const WEAPON_GLOW_STYLES: Partial<Record<WeaponId, GlowStyle>> = {
  fireball: {
    bands: [
      { radiusScale: 1, color: "#8C2A06" },
      { radiusScale: 0.75, color: "#E8590C" },
      { radiusScale: 0.5, color: "#FFA53C" },
      { radiusScale: 0.29, color: "#FFF3D6" },
    ],
    flickerDepth: 1 / 12,
    flickerHz: 8,
  },
};

/** A band resolved to world units and a Phaser fill, ready to stroke. */
export interface DrawBand {
  radius: number;
  fill: number;
}

/**
 * One nested layer of a beam's look. The projectile equivalent is `GlowBand`; a beam needs two
 * scales rather than one because its two shapes shrink along different axes.
 *
 * **Both scales are clamped to `(0, 1]` by `beam-style.test.ts`, and that is what keeps the drawn
 * flame inside the hitbox** — not a runtime clamp. A cone is a triangle with its apex AT the muzzle
 * (`beamShapeAt`), so scaling its reach scales its spread by the same factor and yields a *similar
 * triangle sharing the apex*, which is inside the outer one for any factor at or below 1. A rect
 * shrinks the same way on each axis independently. Containment is therefore geometric, and no layer
 * can ever draw past the thing that actually hits.
 */
export interface BeamLayer {
  /**
   * Fraction of the beam's current extent this layer's tongue TIPS reach, measured ALONG the
   * beam's axis. 1 lands the tips exactly on the hitbox's far edge at every angle across the fan,
   * not merely on the centreline — see `conePoints`.
   */
  extentScale: number;
  /**
   * Fraction of the hitbox's CROSS-SECTION this layer spans — a cone's half-angle, a rect's
   * `width`. 1 is the hitbox's own edge.
   */
  crossScale: number;
  /**
   * How many flame tongues to cut across the fan. 0 draws the plain hitbox outline, which is what
   * every beam looked like before tongues existed.
   *
   * An odd count puts a valley at each outer edge, so the flame narrows at its sides instead of
   * ending on a tooth — which is most of what stops a cone reading as a triangle.
   */
  tongues: number;
  /**
   * How far the valleys between tongues pull back from the tips, as a fraction of this layer's
   * reach. 0 is a smooth arc; toward 1 the tongues become spikes. Pull-back only, never push-out.
   */
  tongueDepth: number;
  /** `#RRGGBB` this layer fills in. */
  color: string;
}

/**
 * How one weapon's beams draw, when a single flat polygon is not enough. The beam counterpart to
 * `GlowStyle`, and absent means exactly what it means there: the one flat `weaponFillOf` fill that
 * every beam drew before this existed.
 *
 * Kept a separate table from `WEAPON_GLOW_STYLES` rather than folded into it as a union, because a
 * weapon is a projectile or a beam and never both — a merged type would make every author answer
 * for the half that cannot apply to their row.
 */
export interface BeamStyle {
  /** Outermost first. Each layer is filled over the one before it, so later layers are the core. */
  layers: BeamLayer[];
  /** A charge orb drawn at the muzzle through this weapon's wind-up. Absent draws nothing. */
  charge?: ChargeStyle;
}

/**
 * The orb a wind-up weapon gathers at its muzzle before firing, growing from `minRadius` to
 * `maxRadius` across `startUpMs` and vanishing on the tick the shot exits.
 *
 * **This is the one thing the game draws in the world that is not a hitbox**, and the exception is
 * deliberate rather than an erosion of the rule. Every shot draws as its own hitbox (D19) so that
 * what you see is what can hurt you; an orb hurts nobody and is a *telegraph*, a second category.
 * `lance` is built around being telegraphed — a 700 ms wind-up is what pays for 180 damage — but
 * until this existed an opponent saw nothing at all during it, so the tell lived in the design and
 * not on the screen. Anything drawn here must stay a warning: it may never imply a hitbox that is
 * not there, which is why it sits at the muzzle rather than out where the beam will land.
 */
export interface ChargeStyle {
  /** Radius on the press tick. Small but non-zero, so the orb appears rather than fades in. */
  minRadius: number;
  /** Radius on the last tick before the shot exits. */
  maxRadius: number;
  /** Outermost first, as fractions of the orb's CURRENT radius. */
  bands: GlowBand[];
}

/** A charge orb band resolved to world units and a Phaser fill. */
export interface ChargeOrbBand {
  radius: number;
  fill: number;
}

/**
 * Polygon vertices spent per tongue. Six is where a lobe stops reading as a polygon corner at the
 * ~200px a beam draws at; the cost of raising it is vertices in one existing fill, never an extra
 * fill, so this is a legibility knob rather than a performance one.
 */
const SAMPLES_PER_TONGUE = 6;

/**
 * Per-weapon beam looks. Absent means the flat hitbox polygon — see `BeamStyle`.
 *
 * `afterburner`: an amber outer flame licking the hitbox, a yellow body inside it, and a pale core
 * at the nozzle. Each layer is shorter AND slightly narrower than the one outside it, so they nest
 * as tongues rather than stacking as horizontal stripes — which is what a shared apex and a varying
 * reach alone produced, and why the first cut read as a striped triangle. Tongue counts differ per
 * layer (5 / 4 / 3) so the lobes do not line up and the edges stay busy. The outer amber is the
 * weapon's own `WEAPON_TABLE.color`, the same convention `fireball`'s middle band follows.
 *
 * There is deliberately no flicker or glow here: the beam already grows over its first 200 ms,
 * which is motion enough, and a pulsing two-second flame reads as a strobe.
 *
 * `shockwave` and `bulwark` are cones too and can take layers whenever someone authors them; they
 * are deliberately absent rather than guessed at, and draw flat until then.
 */
export const WEAPON_BEAM_STYLES: Partial<Record<WeaponId, BeamStyle>> = {
  afterburner: {
    layers: [
      { extentScale: 1, crossScale: 1, tongues: 5, tongueDepth: 0.3, color: "#F59F00" },
      { extentScale: 0.74, crossScale: 0.82, tongues: 4, tongueDepth: 0.34, color: "#FFD43B" },
      { extentScale: 0.42, crossScale: 0.6, tongues: 3, tongueDepth: 0.38, color: "#FFF3BF" },
    ],
  },
  /**
   * `lance`: a rect beam, so its layers nest by WIDTH and every `extentScale` stays 1. Narrowing
   * the length instead would hide a shorter bar inside a longer one of the same width and show
   * nothing. `tongues` is 0 for the same reason — lobes cut into a rect's far edge would only
   * shorten a shape whose whole read is "a straight line of light" — and `rectPoints` ignores them
   * regardless.
   *
   * Its charge orb is the wind-up made visible: 700 ms is the entire justification for 180 damage,
   * and an opponent could not previously see it happening. Colours match the beam exactly, so the
   * orb reads as the same thing gathering that is about to be fired.
   */
  lance: {
    layers: [
      { extentScale: 1, crossScale: 1, tongues: 0, tongueDepth: 0, color: "#6741D9" },
      { extentScale: 1, crossScale: 0.55, tongues: 0, tongueDepth: 0, color: "#FFD43B" },
      { extentScale: 1, crossScale: 0.22, tongues: 0, tongueDepth: 0, color: "#FFFFFF" },
    ],
    charge: {
      minRadius: 2,
      maxRadius: 18,
      bands: [
        { radiusScale: 1, color: "#6741D9" },
        { radiusScale: 0.6, color: "#FFD43B" },
        { radiusScale: 0.28, color: "#FFFFFF" },
      ],
    },
  },
};

/** A beam layer resolved to world-space vertices and a Phaser fill, ready to fill. */
export interface DrawBeamLayer {
  points: { x: number; y: number }[];
  fill: number;
}

/**
 * The concentric bands to fill for one instance, outermost first, or `[]` for a weapon with no
 * style — whose caller falls back to the single flat `weaponFillOf` disc.
 *
 * `nowMs` is a free-running clock (`performance.now()`), not the patch-relative `elapsedMs` the
 * position extrapolation uses: that one saws back to zero every patch, which would turn a smooth
 * flicker into a 20 Hz stutter locked to the network rather than to the fire.
 *
 * Pure, and pure on purpose — `ArenaScene` cannot be unit tested without a browser, so everything
 * that decides what a shot looks like has to be decidable here.
 */
export function instanceGlowBands(
  weaponId: string,
  radius: number,
  spawnTick: number,
  nowMs: number,
): DrawBand[] {
  const style = isWeaponId(weaponId) ? WEAPON_GLOW_STYLES[weaponId] : undefined;
  if (!style) return [];

  // [0, 1] rather than [-1, 1], so the scale below only ever subtracts. See `flickerDepth`.
  const wave =
    0.5 +
    0.5 *
      Math.sin(
        2 * Math.PI * style.flickerHz * (nowMs / 1000) + spawnTick * FLICKER_PHASE_PER_TICK,
      );
  const scale = 1 - style.flickerDepth * wave;

  return style.bands.map((band) => ({
    radius: radius * band.radiusScale * scale,
    fill: hexToFill(band.color),
  }));
}

/**
 * How far a beam has grown by draw time: its last reported extent, advanced along its own expansion
 * speed and clamped to the weapon's `range`.
 *
 * Shared by `instanceDrawShape` and `beamDrawLayers` rather than written out in both, because the
 * outer silhouette and the layers inside it must agree on the beam's length exactly — two copies of
 * this would let a flame creep past its own hitbox the moment one of them was tuned.
 */
export function beamGrownExtent(weaponId: string, extent: number, elapsedMs: number): number {
  const def = isWeaponId(weaponId) ? weaponDefOf(weaponId) : null;
  if (!def || def.kind !== "beam") return Math.max(0, extent);
  return Math.min(def.range, extent + (def.speed * capMs(elapsedMs)) / 1000);
}

/**
 * The nested polygons to fill for one beam instance, outermost first, or `[]` for a beam with no
 * style — whose caller falls back to the single flat `weaponFillOf` polygon.
 *
 * The beam counterpart to `instanceGlowBands`, and pure for the same reason: `ArenaScene` cannot be
 * unit tested without a browser, so what a beam looks like has to be decidable here. `nowMs` is the
 * same free-running clock, so a flame's flicker is tied to the fire rather than to the patch rate.
 *
 * Every layer is built by calling the SHIPPED `beamShapeAt` with a scaled hitbox and a scaled
 * extent, rather than by scaling the outer polygon's vertices. That is what makes containment a
 * property of the geometry instead of a promise: the layers are the same shape the sim would test
 * with, just smaller, so there is no second implementation to drift.
 */
export function beamDrawLayers(
  weaponId: string,
  x: number,
  y: number,
  angle: number,
  extent: number,
  elapsedMs: number,
): DrawBeamLayer[] {
  const def = isWeaponId(weaponId) ? weaponDefOf(weaponId) : null;
  // A projectile id reaching here would mean the caller branched on the wrong thing; drawing
  // nothing is the honest answer, and the caller's flat-fill fallback still puts a shape on screen.
  if (!def || def.kind !== "beam") return [];
  const style = WEAPON_BEAM_STYLES[def.id];
  if (!style) return [];

  const grown = beamGrownExtent(def.id, extent, elapsedMs);
  const layers: DrawBeamLayer[] = [];
  for (const layer of style.layers) {
    const points =
      def.hitbox.shape === "cone"
        ? conePoints(def.hitbox.angleDeg, x, y, angle, grown, layer)
        : rectPoints(def.hitbox.width, x, y, angle, grown, layer);
    // Fewer than three vertices is a beam on its spawn tick, whose extent is still zero. Dropping
    // it here keeps `fillPoints` off a degenerate shape rather than making the render loop
    // re-check what this already knows.
    if (points.length < 3) continue;
    layers.push({ points, fill: hexToFill(layer.color) });
  }
  return layers;
}

/**
 * The charge orb's bands for a car mid wind-up, outermost first, or `[]` when nothing should draw.
 *
 * Derived entirely from state already on the wire — `PlayerState.pendingUntilTick` and the weapon
 * in `lastFiredSlot` — so a telegraph that opponents can act on costs no schema field and no extra
 * traffic. `pendingUntilTick` also covers a multi-volley burst, so the `remaining > total` guard
 * stops a burst weapon drawing an orb across its whole volley sequence; only a weapon with an
 * authored `charge` reaches that far anyway.
 *
 * Returns `[]` on the tick the shot exits, which is what makes the orb vanish exactly as the beam
 * appears rather than overlapping it for a frame.
 */
export function chargeOrbBands(
  weaponId: string,
  pendingUntilTick: number,
  tick: number,
): ChargeOrbBand[] {
  const def = isWeaponId(weaponId) ? weaponDefOf(weaponId) : null;
  if (!def || def.kind !== "beam") return [];
  const charge = WEAPON_BEAM_STYLES[def.id]?.charge;
  if (!charge) return [];

  const total = weaponTicksOf(def.id).startUp;
  if (total <= 0) return [];
  const remaining = pendingUntilTick - tick;
  // Nothing pending, already fired, or a pending longer than this weapon's own wind-up.
  if (remaining <= 0 || remaining > total) return [];

  // 0 on the press tick, approaching 1 on the last tick before the shot exits. Linear on purpose:
  // the orb's job is telling an opponent how long they have, and easing would lie about that.
  const progress = clamp01(1 - remaining / total);
  const radius = charge.minRadius + (charge.maxRadius - charge.minRadius) * progress;
  return charge.bands.map((band) => ({
    radius: radius * band.radiusScale,
    fill: hexToFill(band.color),
  }));
}

/**
 * A tongued flame inside a cone hitbox, in world space.
 *
 * **Why this is built in POLAR coordinates off the muzzle, and why that is the whole containment
 * argument.** A cone hitbox is the triangle `x <= reach, |y| <= tan(half) * x`. Every vertex here
 * is placed at an angle within `+/-half` and a radius within `reach`, and any such point satisfies
 * both constraints — `|y| / x = |tan(theta)| <= tan(half)`, and `x = r * cos(theta) <= reach`. So a
 * flame of *any* silhouette is inside the hitbox as long as its angles and radii stay in range,
 * which is exactly what `crossScale`, `extentScale` and a pull-back-only `tongueDepth` guarantee.
 * Cartesian wobble would need a containment test per vertex; this needs none.
 *
 * The tongue wave is a raised cosine over the fan, so `tongues` lobes reach the full radius and the
 * valleys between them pull back by `tongueDepth`. An odd `tongues` lands a valley on each outer
 * edge, which is what keeps the silhouette from ending on a tooth.
 */
function conePoints(
  angleDeg: number,
  x: number,
  y: number,
  heading: number,
  extent: number,
  layer: BeamLayer,
): { x: number; y: number }[] {
  const reach = Math.max(0, extent) * clamp01(layer.extentScale);
  const half = ((angleDeg * Math.PI) / 360) * clamp01(layer.crossScale);
  if (reach <= 0 || half <= 0) return [];

  const lobes = Math.max(0, Math.floor(layer.tongues));
  const depth = clamp01(layer.tongueDepth);
  const samples = lobes === 0 ? 2 : Math.max(2, lobes * SAMPLES_PER_TONGUE);

  // The apex is the muzzle itself, so the flame is anchored to the car rather than floating.
  const points: { x: number; y: number }[] = [rotateBy(x, y, heading, 0, 0)];
  for (let i = 0; i <= samples; i++) {
    const u = -1 + (2 * i) / samples;
    // 1 at a tongue tip, 0 in a valley. `lobes` full cycles across the fan.
    const wave = lobes === 0 ? 1 : 0.5 + 0.5 * Math.cos(lobes * Math.PI * u);
    const theta = u * half;
    // `/ cos(theta)` is what makes a tongue TIP land on the cone's flat far edge instead of on a
    // circle through its nose. Without it the tips trace an arc of radius `reach`, which touches
    // the hitbox only on the centreline and falls 11% short of it at the cone's rim -- a flame
    // visibly smaller than the thing that burns. Containment survives it: a tip is then at axial
    // `reach` exactly and lateral `reach * tan(theta)`, and `|tan(theta)| <= tan(half)` still puts
    // it inside `|y| <= tan(half) * x`.
    const r = (reach / Math.cos(theta)) * (1 - depth * (1 - wave));
    points.push(rotateBy(x, y, heading, r * Math.cos(theta), r * Math.sin(theta)));
  }
  return points;
}

/**
 * A rect beam's layer. Tongues are ignored: a rect's reach is its length, so cutting lobes into its
 * far edge would shorten a bar whose whole read is "a straight line of light". `lance` narrows with
 * `crossScale` instead, which nests a bright core down its full length.
 */
function rectPoints(
  width: number,
  x: number,
  y: number,
  heading: number,
  extent: number,
  layer: BeamLayer,
): { x: number; y: number }[] {
  const reach = Math.max(0, extent) * clamp01(layer.extentScale);
  const half = (width / 2) * clamp01(layer.crossScale);
  if (reach <= 0 || half <= 0) return [];
  return [
    rotateBy(x, y, heading, 0, -half),
    rotateBy(x, y, heading, reach, -half),
    rotateBy(x, y, heading, reach, half),
    rotateBy(x, y, heading, 0, half),
  ];
}

/**
 * Local rather than shared's `rotateInto`, which is not exported. Duplicating a rotation is safe in
 * a way duplicating `beamGrownExtent` would not be: there is no tuning knob in it to drift, and it
 * is draw-only — the sim never sees these vertices.
 */
function rotateBy(
  x: number,
  y: number,
  heading: number,
  along: number,
  across: number,
): { x: number; y: number } {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return { x: x + along * cos - across * sin, y: y + along * sin + across * cos };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** `#RRGGBB` to a Phaser fill, falling back to grey rather than rendering an invisible `NaN`. */
function hexToFill(hex: string): number {
  const parsed = Number.parseInt(hex.slice(1), 16);
  return Number.isNaN(parsed) ? UNKNOWN_WEAPON_COLOR : parsed;
}


/**
 * Extrapolation is capped at one patch interval, so a stalled connection cannot fling a stale
 * instance across the arena while the client waits for the delete that already happened.
 */
function capMs(elapsedMs: number): number {
  return Math.min(Math.max(elapsedMs, 0), 1000 / DEFAULT_PATCH_RATE_HZ);
}

/**
 * What to draw for one live instance, in world space. The silhouette is the weapon's own hitbox
 * (D19), so what a player sees is exactly what can hurt them — and a new weapon needs no art.
 *
 * The branch is the weapon DEFINITION's `kind`, which is what makes `WeaponDef` a discriminated
 * union worth having (D1): narrowing on it hands each shape function the hitbox its own type
 * guarantees, with no casts. Branching on the row's `kind` byte instead needed two `as` casts, and a
 * row whose byte disagreed with its weapon (only ever a hand-built test object — `spawnInstances`
 * copies the byte from this same definition) would have fed a circle to `beamShapeAt` and produced
 * NaN vertices rather than a wrong-but-drawable shape.
 *
 * An unrecognised `weaponId` still draws something (a small dot) rather than throwing, since a stale
 * or forward-incompatible id must never blank the whole shot layer.
 */
export function instanceDrawShape(instance: DrawableInstance, elapsedMs: number): WorldShape {
  const def = isWeaponId(instance.weaponId) ? weaponDefOf(instance.weaponId) : null;
  if (!def) {
    return { kind: "circle", x: instance.x, y: instance.y, radius: UNKNOWN_WEAPON_RADIUS };
  }

  if (def.kind === "beam") {
    return beamShapeAt(
      def.hitbox,
      instance.x,
      instance.y,
      instance.angle,
      beamGrownExtent(instance.weaponId, instance.extent, elapsedMs),
    );
  }
  const at = extrapolateShot(instance.x, instance.y, instance.angle, def.speed, elapsedMs);
  return projectileShapeAt(def.hitbox, at.x, at.y, instance.angle);
}

/**
 * Whether the lock bracket is drawn at all.
 *
 * A source switch, not a player setting: the client has no options surface, and the bracket is the
 * only thing on screen that says the server has picked a target for you (A13), so playing with it
 * off is a deliberate choice — recording clean footage, or reading the arena while working on
 * something the bracket sits on top of — rather than a preference a match should carry.
 *
 * Hiding it changes nothing but the picture. The lock is server-only and the client never computes
 * it: with this `false` the server still acquires, holds, steals, and fires at exactly the same
 * target, and `PlayerState.lockTargetSessionId` still arrives on every patch. Aim assist is not
 * disabled here — the per-weapon opt-out is `usesAimAssist` in `WEAPON_TABLE`.
 *
 * Annotated `boolean` rather than left to infer the literal `true`, so `ArenaScene`'s guard stays
 * live code both ways and flipping this line is the whole edit.
 */
export const SHOW_LOCK_BRACKET: boolean = true;

/**
 * Half the bracket's side, world units. Larger than a car hull's half-diagonal (29 units for the
 * 48 x 32 hull) so the bracket frames the car instead of being drawn across it.
 */
export const LOCK_BRACKET_HALF = 34;

/** How far each arm runs from its corner. Kept well under the side, so the corners never join. */
export const LOCK_BRACKET_ARM = 11;

/**
 * The eight line segments of a corner bracket centred on a car, in world space.
 *
 * Corners rather than a closed box: a full rectangle reads as a selection marquee and competes with
 * the car it is meant to point at. Unrotated, like the hp bar above it -- the bracket says "this is
 * your lock", not "this is how the car is facing".
 *
 * Pure geometry so it can be tested without a Phaser scene; `ArenaScene` only strokes the result.
 */
export function lockBracketArms(
  x: number,
  y: number,
): { x1: number; y1: number; x2: number; y2: number }[] {
  const h = LOCK_BRACKET_HALF;
  const a = LOCK_BRACKET_ARM;
  const left = x - h;
  const right = x + h;
  const top = y - h;
  const bottom = y + h;

  return [
    { x1: left, y1: top, x2: left + a, y2: top },
    { x1: left, y1: top, x2: left, y2: top + a },
    { x1: right, y1: top, x2: right - a, y2: top },
    { x1: right, y1: top, x2: right, y2: top + a },
    { x1: left, y1: bottom, x2: left + a, y2: bottom },
    { x1: left, y1: bottom, x2: left, y2: bottom - a },
    { x1: right, y1: bottom, x2: right - a, y2: bottom },
    { x1: right, y1: bottom, x2: right, y2: bottom - a },
  ];
}
