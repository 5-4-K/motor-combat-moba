import {
  DEFAULT_PATCH_RATE_HZ,
  DEFAULT_CAR_ID,
  beamShapeAt,
  hpOf,
  isCarId,
  isWeaponId,
  msToTicks,
  projectileShapeAt,
  WeaponKind,
  weaponDefOf,
  weaponTicksOf,
  type BeamHitbox,
  type ProjectileHitbox,
  type WeaponId,
  type WorldShape,
} from "@motor-combat-moba/shared";

/**
 * How full a car's hp bar is, in `[0, 1]`.
 *
 * The denominator comes from the car's own `CAR_TABLE` hp, not from a shared maximum: a bastion at
 * half hp and a mirage at half hp must both read as half a bar, or the bar tells you about the
 * chassis instead of about the fight. An unrecognised `carId` falls back to the default chassis,
 * the same fallback the sim uses, rather than dividing by an undefined maximum and rendering NaN.
 */
export function hpFraction(hp: number, carId: string): number {
  const max = hpOf(isCarId(carId) ? carId : DEFAULT_CAR_ID);
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, hp / max));
}

/** Which side of the fight a car is on, from the point of view of one particular player. */
export type Allegiance = "ally" | "enemy";

/**
 * Whose side `subject` is on, as far as `viewer` is concerned.
 *
 * The viewer is passed in rather than read off the room, for two reasons. It keeps this testable
 * without a room, and — the one that matters in play — it makes D2 a property of the signature
 * instead of a comment somebody has to obey: a wreck becomes a spectator and can cycle through
 * living cars, and allegiance must NOT follow that camera. Green stays your team's green while you
 * watch an enemy fill the screen, because the question the bars answer is "who is on my side", and
 * dying does not change the answer. Pass the local player here, never the spectate target.
 *
 * Yourself is `"ally"` in both modes. In `"team"` a matching `team` is an ally; in `"ffa"` everyone
 * else is an enemy, which is what makes the rule degrade to "green is me, red is everyone else"
 * with no special case to teach.
 */
export function allegianceOf(
  viewer: { sessionId: string; team: number },
  subject: { sessionId: string; team: number },
  mode: "ffa" | "team",
): Allegiance {
  if (viewer.sessionId === subject.sessionId) return "ally";
  if (mode === "team" && viewer.team === subject.team) return "ally";
  return "enemy";
}

/** Your car and your teammates. The existing healthy green, kept so the palette does not move. */
const HP_BAR_ALLY = 0x49c46a;
/** Everyone else. The existing critical red, for the same reason. */
const HP_BAR_ENEMY = 0xd94040;

/**
 * Bar colour by allegiance, and by nothing else (D1).
 *
 * The bar has one colour channel and two things it could say — "how hurt" and "whose side". It used
 * to spend that channel on health, which is the sentence the bar's LENGTH already says; length
 * stays the only health channel, and colour now answers the question a 3v3 actually asks.
 *
 * What that gives up is the amber/red low-health warning, and that was a real cue. It was a cue
 * about a car whose bar you can already read, though, and what replaces it is a cue about a car you
 * might otherwise shoot by mistake.
 *
 * There is deliberately no exception for your own car, not even a gradient kept "just for you": a
 * rule with one exception is a rule players have to be taught, and a rule with none is one they read
 * off the screen. The old `fraction` parameter is gone rather than ignored, so there is no trap left
 * for the next person to author a gradient back into.
 */
export function hpBarColor(allegiance: Allegiance): number {
  return allegiance === "ally" ? HP_BAR_ALLY : HP_BAR_ENEMY;
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
 * `fireball`: a maroon ember rim, the weapon's own `#D63A14` body, a hot orange inner, and a gold
 * core, every band inside the 12-unit hitbox. The rim is the darkest ring rather than the
 * brightest so the shot still reads as a hard-edged object against a light arena floor, and the
 * core is what carries at the ~24px this draws at.
 *
 * `pepperbox`: Bullseye's navy with an orange core at half the radius — a quarter of the pellet's
 * area, since area goes as the square. Two bands rather than a ramp because a pellet is 12px across
 * at zoom 1 and a third band would have nowhere to land.
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
      { radiusScale: 1, color: "#601818" },
      { radiusScale: 0.75, color: "#D63A14" },
      { radiusScale: 0.5, color: "#F58A20" },
      { radiusScale: 0.29, color: "#FFC030" },
    ],
    flickerDepth: 1 / 12,
    flickerHz: 8,
  },
  pepperbox: {
    bands: [
      { radiusScale: 1, color: "#184890" },
      { radiusScale: 0.5, color: "#FF4800" },
    ],
    flickerDepth: 0,
    flickerHz: 0,
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
 * `lance` is built around being telegraphed — a 700 ms wind-up is what pays for 170 damage — but
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
 * `afterburner`: a maroon outer flame licking the hitbox, the weapon's own orange body inside it,
 * and a gold core at the nozzle. Each layer is shorter AND slightly narrower than the one outside
 * it, so they nest as tongues rather than stacking as horizontal stripes — which is what a shared
 * apex and a varying reach alone produced, and why the first cut read as a striped triangle. Tongue
 * counts differ per layer (5 / 4 / 3) so the lobes do not line up and the edges stay busy.
 *
 * Its `WEAPON_TABLE.color` is the SECOND layer, not the outer one — the same convention `fireball`
 * follows. Both are Mirage flame weapons, and both want the darkest ring on the outside so the shot
 * reads as a hard-edged object against a light floor; a weapon's table colour is its body, which on
 * a flame is one layer in. `lance` and `bulwark` are the other way round, with the table colour on
 * the outer edge, because their outer edge IS the body.
 *
 * There is deliberately no flicker or glow here: the beam already grows over its first 200 ms,
 * which is motion enough, and a pulsing two-second flame reads as a strobe.
 *
 * `shockwave` is a disc, which has no cross-section to nest layers inside — it draws as a ring and
 * a wash, and `beamDrawLayers` refuses it at source.
 */
export const WEAPON_BEAM_STYLES: Partial<Record<WeaponId, BeamStyle>> = {
  afterburner: {
    layers: [
      { extentScale: 1, crossScale: 1, tongues: 5, tongueDepth: 0.3, color: "#7A2018" },
      { extentScale: 0.74, crossScale: 0.82, tongues: 4, tongueDepth: 0.34, color: "#F05818" },
      { extentScale: 0.42, crossScale: 0.6, tongues: 3, tongueDepth: 0.38, color: "#FFC030" },
    ],
  },
  /**
   * `bulwark`: Bastion's gold with a cream inner, matching the wall of stripes on its icon. Two
   * layers rather than three because it is a 492-unit cone — the widest thing drawn in the game —
   * and a third would be a band of colour the size of a car.
   */
  bulwark: {
    layers: [
      { extentScale: 1, crossScale: 1, tongues: 0, tongueDepth: 0, color: "#D9A814" },
      { extentScale: 0.55, crossScale: 0.8, tongues: 0, tongueDepth: 0, color: "#FFF0C0" },
    ],
  },
  /**
   * `lance`: a rect beam, so its layers nest by WIDTH and every `extentScale` stays 1. Narrowing
   * the length instead would hide a shorter bar inside a longer one of the same width and show
   * nothing. `tongues` is 0 for the same reason — lobes cut into a rect's far edge would only
   * shorten a shape whose whole read is "a straight line of light" — and `rectPoints` ignores them
   * regardless.
   *
   * Its charge orb is the wind-up made visible: 700 ms is the entire justification for 170 damage,
   * and an opponent could not previously see it happening. Colours match the beam exactly, so the
   * orb reads as the same thing gathering that is about to be fired.
   *
   * Navy body and an orange stripe are its icon exactly. The white core is a deliberate departure
   * from Bullseye's two colours: white otherwise reads as Bastion here, but a 1200-unit beam is the
   * one shot big enough to carry a third layer, and the hot centre is what makes it look fired
   * rather than painted.
   */
  lance: {
    layers: [
      { extentScale: 1, crossScale: 1, tongues: 0, tongueDepth: 0, color: "#0F3268" },
      { extentScale: 1, crossScale: 0.55, tongues: 0, tongueDepth: 0, color: "#F04800" },
      { extentScale: 1, crossScale: 0.22, tongues: 0, tongueDepth: 0, color: "#FFFFFF" },
    ],
    charge: {
      minRadius: 2,
      // Tracks the beam's own 15% widening (T13: `hitbox.width` 20 -> 23), so the telegraph keeps
      // matching what it warns about. A charge orb that stopped growing with the beam would
      // under-promise the thing about to be fired, which is the one failure mode a telegraph has.
      maxRadius: 18.9,
      bands: [
        { radiusScale: 1, color: "#0F3268" },
        { radiusScale: 0.6, color: "#F04800" },
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
 * One shape drawn inside a NON-CIRCULAR projectile's hitbox — the ellipse and capsule counterpart to
 * `GlowBand` and `BeamLayer`.
 *
 * It exists because those two tables cannot reach these weapons: `GlowStyle` nests circles by radius,
 * and `beamDrawLayers` refuses anything whose `kind` is not `beam`. Until this, `needler`, `skewer`
 * and `thumper` drew one flat `weaponFillOf` polygon and had no way to say anything else.
 *
 * Every scale is a FRACTION of the hitbox's own `radiusAlong` or `radiusAcross`, never a world
 * distance, for the reason `GlowBand.radiusScale` is: a re-tune that resizes the hitbox carries the
 * whole marking with it, and no layer can drift outside the shape that actually hits.
 * `projectile-marks.test.ts` holds every authored layer to that.
 */
export type ProjectileLayer =
  /** The whole hitbox, as the base fill. Omit it to draw a silhouette SMALLER than the hitbox. */
  | { shape: "hull"; color: string }
  /** The leading end, ahead of a chord at `chordScale` of `radiusAlong`. */
  | { shape: "tip"; chordScale: number; color: string }
  /** A band across the middle, `halfWidthScale` of `radiusAlong` to either side of centre. */
  | { shape: "band"; halfWidthScale: number; color: string }
  /** A circle at the centre, `radiusScale` of `radiusAcross`. */
  | { shape: "disc"; radiusScale: number; color: string }
  /**
   * Two triangles running from the disc's flanks out to the nose and tail.
   *
   * `baseScale` and `halfHeightScale` are fractions of `radiusAcross` — they describe where the spike
   * meets the DISC, so the pair stays coherent if the hitbox is re-tuned — while the tips always land
   * on `+/-radiusAlong`, which is what keeps the silhouette as long as the hitbox.
   */
  | { shape: "spikes"; baseScale: number; halfHeightScale: number; color: string };

/** How one non-circular projectile draws. Absent means the flat hitbox polygon. */
export interface ProjectileStyle {
  /** Outermost first. Each layer is filled over the one before it, so later layers are on top. */
  layers: ProjectileLayer[];
}

/**
 * Vertices spent on a curved edge — a `tip`'s arc or a `disc`'s outline.
 *
 * Matches shared's `ELLIPSE_SEGMENTS`, so a marking's curve is faceted exactly as coarsely as the
 * hull it sits inside and cannot read as a smoother shape than the thing it is part of.
 */
const MARK_SEGMENTS = 12;

/**
 * Per-weapon looks for the three non-circular projectiles. Absent means the flat hitbox polygon.
 *
 * `needler`: Bullseye's navy with an orange nose. The chord at 0.404 puts exactly a quarter of the
 * ellipse's area ahead of it — the fraction is scale-free, so the same number would hold for any
 * ellipse. It is not a quarter of the LENGTH: an ellipse tapers, so the tip runs the leading 30%.
 *
 * `thumper`: Bastion's yellow with a cream band across the middle, which is its icon. A band rather
 * than a nose is also the cheap shape here — 0.216 of `radiusAlong` keeps it inside the shell's
 * straight section, so it is a rectangle and needs none of the circular-segment maths a nose on a
 * capsule would.
 *
 * `skewer`: the one weapon that does NOT draw its hull. A disc with two spikes reads as the spiked
 * shaft on its icon, and it fills 43% of the ellipse — what is left bare is the shoulders above and
 * below the spikes, under 3 units of slack against a car hull 32 units tall. Nothing is drawn
 * OUTSIDE the hitbox, which is the half of D19 that protects a player: no shot can hurt you from
 * somewhere you cannot see it. This is the documented exception to the other half.
 */
export const WEAPON_PROJECTILE_STYLES: Partial<Record<WeaponId, ProjectileStyle>> = {
  needler: {
    layers: [
      { shape: "hull", color: "#22579E" },
      { shape: "tip", chordScale: 0.404, color: "#FF4800" },
    ],
  },
  thumper: {
    layers: [
      { shape: "hull", color: "#F0C808" },
      { shape: "band", halfWidthScale: 0.216, color: "#FFF6D8" },
    ],
  },
  skewer: {
    layers: [
      { shape: "spikes", baseScale: 0.908, halfHeightScale: 0.42, color: "#C89A14" },
      { shape: "disc", radiusScale: 1, color: "#C89A14" },
      { shape: "disc", radiusScale: 0.55, color: "#FFF6D8" },
    ],
  },
};

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
/**
 * Half the hull's width, across the heading, at `along` units from its centre.
 *
 * The one place the two projectile hull shapes differ, so every marking below is written once against
 * this rather than branching per shape. Returns 0 past either end, which makes a marking that reaches
 * too far degenerate rather than escape the hull.
 *
 * `along` is SIGNED, and for a capsule that matters: it is a slug, rounded at the nose and cut flat
 * across the tail, so only the leading end narrows. Treating it as symmetric puts the tail's corners
 * outside the hull — which is exactly what `projectile-marks.test.ts` catches.
 */
function hullHalfAcross(
  hitbox: Extract<ProjectileHitbox, { shape: "ellipse" | "capsule" }>,
  along: number,
): number {
  const { radiusAlong, radiusAcross } = hitbox;
  if (along < -radiusAlong || along > radiusAlong) return 0;
  if (hitbox.shape === "ellipse") {
    return radiusAcross * Math.sqrt(Math.max(0, 1 - (along / radiusAlong) ** 2));
  }
  const noseCentre = radiusAlong - radiusAcross;
  if (along <= noseCentre) return radiusAcross;
  return Math.sqrt(Math.max(0, radiusAcross ** 2 - (along - noseCentre) ** 2));
}

/**
 * The polygons to fill for one non-circular projectile, in draw order, or `[]` for a weapon with no
 * style — whose caller falls back to the single flat `weaponFillOf` hull.
 *
 * Takes the instance and `elapsedMs` rather than a resolved position so it extrapolates through the
 * same `extrapolateShot` that `instanceDrawShape` uses. Handing it an already-extrapolated point
 * would let the markings and the hull drift apart by a frame's worth of travel, which on a
 * 1300 u/s needler is most of its own length.
 */
export function projectileDrawLayers(
  instance: DrawableInstance,
  elapsedMs: number,
): DrawBeamLayer[] {
  const def = isWeaponId(instance.weaponId) ? weaponDefOf(instance.weaponId) : null;
  if (!def || def.kind !== "projectile") return [];
  const style = WEAPON_PROJECTILE_STYLES[def.id];
  if (!style) return [];
  // A circle has no heading to arrange markings along, and `GlowStyle` is where a round projectile
  // says what it looks like. Reaching here with one would mean two tables owning the same weapon.
  // A bar is drawn by the generic fallback: the raw hitbox polygon from `projectileShapeAt`.
  if (def.hitbox.shape === "circle" || def.hitbox.shape === "bar") return [];
  const hitbox = def.hitbox;

  const { x, y } = extrapolateShot(instance.x, instance.y, instance.angle, def.speed, elapsedMs);
  const a = instance.angle;
  const out: DrawBeamLayer[] = [];
  for (const layer of style.layers) {
    const fill = hexToFill(layer.color);
    if (layer.shape === "hull") {
      const shape = projectileShapeAt(hitbox, x, y, a);
      if (shape.kind === "polygon") out.push({ points: shape.points, fill });
      continue;
    }
    if (layer.shape === "tip") {
      const from = clamp01(layer.chordScale) * hitbox.radiusAlong;
      const forward: { x: number; y: number }[] = [];
      const back: { x: number; y: number }[] = [];
      for (let i = 0; i <= MARK_SEGMENTS; i += 1) {
        const along = from + ((hitbox.radiusAlong - from) * i) / MARK_SEGMENTS;
        const across = hullHalfAcross(hitbox, along);
        forward.push(rotateBy(x, y, a, along, -across));
        back.push(rotateBy(x, y, a, along, across));
      }
      out.push({ points: [...forward, ...back.reverse()], fill });
      continue;
    }
    if (layer.shape === "band") {
      const half = clamp01(layer.halfWidthScale) * hitbox.radiusAlong;
      // Measured at the band's own edge, not at the centre, so a band on a curved flank stays inside
      // the hull instead of poking through it at the corners.
      const across = hullHalfAcross(hitbox, half);
      if (half <= 0 || across <= 0) continue;
      out.push({
        points: [
          rotateBy(x, y, a, -half, -across),
          rotateBy(x, y, a, half, -across),
          rotateBy(x, y, a, half, across),
          rotateBy(x, y, a, -half, across),
        ],
        fill,
      });
      continue;
    }
    if (layer.shape === "disc") {
      // Scaled by `radiusAcross`, the SHORT axis, so a centred circle is inside both hull shapes for
      // any scale up to 1 without needing to know which one it is.
      const r = clamp01(layer.radiusScale) * hitbox.radiusAcross;
      if (r <= 0) continue;
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < MARK_SEGMENTS * 2; i += 1) {
        const t = (i / (MARK_SEGMENTS * 2)) * Math.PI * 2;
        points.push(rotateBy(x, y, a, Math.cos(t) * r, Math.sin(t) * r));
      }
      out.push({ points, fill });
      continue;
    }
    const base = clamp01(layer.baseScale) * hitbox.radiusAcross;
    const halfHeight = clamp01(layer.halfHeightScale) * hitbox.radiusAcross;
    if (base >= hitbox.radiusAlong || halfHeight <= 0) continue;
    for (const sign of [1, -1]) {
      out.push({
        points: [
          rotateBy(x, y, a, sign * base, -halfHeight),
          rotateBy(x, y, a, sign * hitbox.radiusAlong, 0),
          rotateBy(x, y, a, sign * base, halfHeight),
        ],
        fill,
      });
    }
  }
  return out;
}

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

  // A disc has no cross-section to nest layers inside, and it is drawn as a ring rather than as a
  // filled solid — see `isAuraWeapon`. Layered styles are a directional-beam idea.
  if (def.hitbox.shape === "disc") return [];

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
  // A maneuver moves the car instead of spawning an instance (Task 10's real branch), so
  // `state.weapons` never carries one — same fallback as an unrecognised id, since neither should
  // ever reach a draw call and both must draw *something* rather than throw.
  if (!def || def.kind === "maneuver") {
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
 * How long a beam takes to fade out, and the whole of the fade rule (D8).
 *
 * One number for all four beams: what already varies between them is their lifetime, and nothing
 * has yet asked for two beams to cut off at different speeds — so this is a constant rather than a
 * per-weapon column, and it becomes a table the day one is needed, the way `WEAPON_BEAM_STYLES`
 * did.
 *
 * It is the fade WINDOW, anchored to the death tick, not to the start of linger. The window used to
 * be the entire lifetime, which made `bulwark` a ghost for 2875 ms while it was still dealing full
 * damage — a zone lying about where it is safe to stand. Now the beam holds full opacity until the
 * last `BEAM_FADE_OUT_MS` and then snaps off.
 *
 * `lifetimeMs` is deliberately untouched by all of this: the damage window does not move, so no TTK
 * number changes and the manual's balance fingerprint never sees it. 100 ms is three ticks at 30 Hz
 * — enough to read as a snap rather than a dropped frame; 0 would give a hard cut with no ramp at
 * all, which is a legal value here and is what the clamp below degrades to.
 */
export const BEAM_FADE_OUT_MS = 100;

/**
 * How opaque a beam instance should draw: fully opaque through its growth and its linger, then
 * ramping to nothing across a fixed `BEAM_FADE_OUT_MS` window that ends exactly at the instance's
 * death tick, so the visual and the hitbox vanish together.
 *
 * Plain numbers and strings rather than the schema row, so this is testable in Node without a
 * canvas or a room — the same reason every other decision in this module takes primitives.
 *
 * A projectile, or an instance whose `weaponId` is not in `WEAPON_TABLE`, always draws fully
 * opaque: neither has a linger to fade through, and a stale or forward-incompatible id must not
 * turn a shot invisible.
 */
export function beamFadeAlpha(
  kind: number,
  weaponId: string,
  spawnTick: number,
  tick: number,
): number {
  if (kind !== WeaponKind.BEAM || !isWeaponId(weaponId)) return 1;
  const ticks = weaponTicksOf(weaponId);
  if (ticks.lifetime <= 0) return 1;

  // The same boundary `instanceExpired` uses (`tick - spawnTick >= flight + lifetime`), so the
  // alpha reaches 0 on exactly the tick the sim stops the instance hitting anything.
  const deathTick = spawnTick + ticks.flight + ticks.lifetime;
  // Clamped to the linger: a window longer than the lifetime would otherwise start the fade while
  // the beam is still growing, which is the one thing the "full opacity until the end" rule exists
  // to prevent.
  const fadeTicks = Math.min(msToTicks(BEAM_FADE_OUT_MS), ticks.lifetime);
  if (fadeTicks <= 0) return 1;

  const remaining = deathTick - tick;
  if (remaining >= fadeTicks) return 1;
  return Math.max(0, remaining / fadeTicks);
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

/**
 * Every colour this weapon's shots actually draw in, outermost first, with duplicates removed.
 *
 * `WEAPON_TABLE.color` alone stopped being the answer once weapons grew ramps and markings: it is
 * `fireball`'s middle band, one of `lance`'s three layers, and for `skewer` it is a colour the
 * spindle shares with its own spikes. Anything showing a player or an author "the shot colour" — the
 * `?dev=assets` swatch today — has to ask for the whole set, or it shows a third of the truth.
 *
 * Falls back to the single table colour, which is exactly right for a weapon with no authored style,
 * since that is the one flat fill `weaponFillOf` gives it.
 */
export function shotPaletteOf(weaponId: string): string[] {
  if (!isWeaponId(weaponId)) return [];
  const def = weaponDefOf(weaponId);
  const authored =
    WEAPON_GLOW_STYLES[def.id]?.bands.map((b) => b.color) ??
    WEAPON_BEAM_STYLES[def.id]?.layers.map((l) => l.color) ??
    WEAPON_PROJECTILE_STYLES[def.id]?.layers.map((l) => l.color);
  return [...new Set((authored ?? [def.color]).map((c) => c.toUpperCase()))];
}

/**
 * Is this weapon a projectile? The renderer's fork between the two polygon-layer tables.
 *
 * An unrecognised id answers `false`, which routes it to `beamDrawLayers` — and that returns `[]` for
 * the same reason, so an unknown weapon lands on the flat-fill fallback either way.
 */
export function isProjectileWeapon(weaponId: string): boolean {
  return isWeaponId(weaponId) && weaponDefOf(weaponId).kind === "projectile";
}

/**
 * Is this weapon drawn as an AURA — a ring around a car — rather than as a solid shape?
 *
 * An aura is the one instance in the game whose hitbox is too big to fill in. Every other shot is
 * drawn *as* its hitbox (D19), which works because a shot is small; a 150-unit disc filled opaquely
 * would hide the cars inside it, including the one being stunned, so the rule has to bend to keep
 * its own purpose. It bends as little as possible: the ring sits exactly ON the hitbox edge and the
 * wash inside it is the same colour, so what you see is still precisely what will hit you.
 */
export function isAuraWeapon(weaponId: string): boolean {
  if (!isWeaponId(weaponId)) return false;
  const def = weaponDefOf(weaponId);
  return def.kind === "beam" && def.hitbox.shape === "disc";
}

/** The aura ring's stroke width, in world units. */
export const AURA_RING_WIDTH = 3;
/** Alpha on the aura's own colour for the wash inside the ring. Low enough to read through. */
export const AURA_FILL_ALPHA = 0.14;
