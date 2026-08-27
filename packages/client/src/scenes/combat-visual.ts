import {
  DEFAULT_PATCH_RATE_HZ,
  DEFAULT_CAR_ID,
  beamShapeAt,
  hpOf,
  isCarId,
  isWeaponId,
  projectileShapeAt,
  weaponDefOf,
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
    const grown = Math.min(def.range, instance.extent + (def.speed * capMs(elapsedMs)) / 1000);
    return beamShapeAt(def.hitbox, instance.x, instance.y, instance.angle, grown);
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
