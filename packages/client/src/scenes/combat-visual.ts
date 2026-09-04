import {
  DEFAULT_PATCH_RATE_HZ,
  DEFAULT_CAR_ID,
  beamShapeAt,
  hpOf,
  instanceDefOf,
  isCarId,
  isWeaponId,
  msToTicks,
  projectileShapeAt,
  WeaponKind,
  weaponDefOf,
  weaponTicksOf,
  type BeamHitbox,
  type ProjectileHitbox,
  type WeaponDef,
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
  /** `WeaponInstanceState.isExplosion` — routes the def lookup through `drawDefOf`/`instanceDefOf`, since a burst carries its parent's `weaponId` rather than one of its own. */
  isExplosion: boolean;
  x: number;
  y: number;
  angle: number;
  extent: number;
}

/**
 * The def describing one drawable instance — the parent row, or its synthesized burst def. Mirrors
 * the sim's `instanceDefOf` (spec P24); a burst carries the parent's `weaponId`, so a bare
 * `weaponDefOf` would draw the shell's 12 u dart where a 60 u disc belongs.
 */
function drawDefOf(instance: DrawableInstance): WeaponDef | null {
  if (!isWeaponId(instance.weaponId)) return null;
  return instanceDefOf(instance.weaponId, instance.isExplosion);
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
 * Emptied by the 2026-09-01 roster cutover and repopulated on 2026-09-02 by `magmablast`, which is
 * the only circular projectile in the roster. Its two former rows were `fireball` (retired outright,
 * O17) and `pepperbox` — which moved OUT deliberately (O9) rather than being retired: its hitbox is
 * now an ellipse (the dart silhouette carried over from `needler`), and a round-glow table nested by
 * `radiusScale` cannot own a non-circular hitbox. The flat weapon-colour fill is `pepperbox`'s
 * correct, intentional look, not a placeholder.
 *
 * `magmablast`: its icon's own radial ramp, measured rather than guessed — the icon was sampled in
 * rings from the centre out, giving amber at the core, orange through the body, and a deep red at
 * the rim (the charcoal specks past that are the icon's outline, not a flame colour, so they are
 * not a band). No flicker: it is a single dart, not a burning volume, and a pulsing outline on a
 * 12-unit disc reads as a rendering fault rather than as fire.
 *
 * Bands are cheap -- one `fillCircle` per band per shot per frame, against a ceiling of roughly 60
 * live instances -- so author freely here when a weapon earns a look. What is NOT cheap, and is
 * worth raising before building: a per-instance `setBlendMode`, a faked gradient wanting 15-20
 * bands, or a `Graphics` object per shot instead of `ArenaScene`'s shared `shotGfx`. See
 * `docs/asset-pipeline.md#how-much-detail-a-shot-can-afford`.
 */
export const WEAPON_GLOW_STYLES: Partial<Record<WeaponId, GlowStyle>> = {
  magmablast: {
    bands: [
      { radiusScale: 1, color: "#C02000" },
      { radiusScale: 0.74, color: "#FF6000" },
      { radiusScale: 0.42, color: "#FFA800" },
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
  /**
   * CONE beams only. How deeply the travelling roughness cuts into the jet's half-width, as a
   * fraction of it. 0 draws a clean-edged ribbon.
   *
   * **This is the silhouette.** It is three octaves of noise summed (see `JET_COARSE_RATIO`), so
   * the edge carries big rounded billows, medium lumps and fine detail at once — which is what a
   * flame's edge is made of, and what no single wavelength can imitate. Shrink-only, so a rougher
   * flame is always a NARROWER one and containment is inherited rather than re-argued.
   */
  billow?: number;
  /**
   * CONE beams only. How hard the flame tears itself apart past `JET_ROD_FRACTION`, as a fraction
   * of its half-width there. 0 keeps one connected plume all the way to the tip.
   *
   * A flamethrower throws a coherent rod for about three quarters of its reach and disperses over
   * the last quarter, and that contrast — dense and smooth, then ragged and shedding — is most of
   * what tells a flamethrower apart from a bonfire. The pinch is sharpened toward its extremes so
   * the ribbon necks to nothing in places rather than thinning evenly, which is what sheds a mass
   * instead of tapering to a point.
   */
  breakUp?: number;
  /**
   * CONE beams only. How fast the whole noise field is carried out of the nozzle, in FLAME LENGTHS
   * per second — 1 sends a billow from the muzzle to the tip in a second. 0 leaves the flame
   * writhing in place.
   *
   * **This is the single thing that most makes fire read as fire, and no earlier cut of this had
   * it.** Structures in a real jet flame convect: a billow is born at the nozzle, grows, travels
   * out and burns off the tip. A shape that only changes amplitude where it stands is a curtain in
   * a draught, however fast it changes.
   */
  advect?: number;
  /**
   * CONE beams only. How fast this layer's flicker, sway and ripple re-roll, overriding the style's
   * `flameHz`. Same per-layer argument as `crackleHz` below, and the same interpolation between
   * rolls — an inner layer is smaller and cheaper to move, so it can afford to run hotter.
   */
  flameHz?: number;
  /**
   * CONE beams only. Which noise group this layer's motion is drawn from. Defaults to the layer's
   * own position, which gives every layer an independent flame.
   *
   * **Two layers sharing a `phase`, a `tongues` count and the rest of their shape knobs draw the
   * SAME flame at two sizes — which is the only way to get a rim.** The first cut of the dark
   * outer layer gave it its own group and its own lobe count, and it did not read as an outline at
   * all: it read as dark petals with orange petals lying on top of them, because the two shapes
   * agreed nowhere. A contour has to follow what it outlines. Layers meant to be independent
   * flames-within-flames leave this alone.
   */
  phase?: number;
  /**
   * RECT beams only. How hard this layer's two long edges tear, as a fraction of its own
   * half-width. 0 leaves them ruled straight.
   *
   * **Tear only, never bulge**: the jag is subtracted from `crossScale`, so a crackling layer is
   * always NARROWER than the clean one it would otherwise be, and containment is inherited rather
   * than re-checked — the same shrink-only rule `tongueDepth` follows on a cone.
   *
   * The gradient across layers is what makes the beam read as a laser rather than as a ribbon. An
   * early cut tore every layer equally and the whole beam undulated; a real beam holds a straight
   * hot line and tears at its edges, so `crackle` should fall to 0 as the layers go inward.
   */
  crackle?: number;
  /**
   * How far this layer's centreline drifts off its own axis, as a fraction of the room the width
   * leaves. Means the same thing for both shapes: a rect bolt's shaft wobbles, and a cone flame
   * gets the S-swoop that hand-drawn fire is built around instead of being symmetric about its
   * axis. On a cone it travels outward with everything else.
   */
  wander?: number;
  /**
   * RECT beams only. This layer's own re-roll rate, overriding the style's `crackleHz`.
   *
   * Exists because how fast a layer may re-roll is set by how WIDE it tears, not by taste. A vertex
   * moves, per rendered frame, in proportion to `crackle x rate` — so on `lance` the deep outer
   * envelope costs 4.96 units/frame at 14 Hz while the shallow yellow layer costs 0.55 at the same
   * rate. Forcing one rate on every layer therefore prices the whole beam at its widest tear, and
   * the only way to keep it smooth is to flatten every layer including the cheap ones.
   *
   * Splitting the rate buys the flicker back for free: the fine detail runs fast because it is
   * nearly weightless, the coarse silhouette drifts slowly because it is not. That is also how real
   * lightning and fire read — coarse structure drifts, fine detail flickers.
   */
  crackleHz?: number;
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
  /**
   * RECT beams only. A rounded cap on the beam's ORIGIN, as a multiple of the rect's half-width —
   * the shape a capsule's nose has, which is why `thumper`'s head is the reference for it.
   *
   * The cap is carved out of the beam's own length rather than added behind it: the whole beam
   * starts `domeScale` half-widths forward and the dome fills the gap back to `along = 0`. Adding
   * it behind the muzzle instead would put it outside the rect, on the shooter's own car. That
   * would have been defensible as a telegraph — `charge` above is exactly such an exception — but
   * it is not needed here, and a shape that stays inside the hitbox needs no exception at all.
   *
   * Costs the beam that much drawn length: at `lance`'s 1200 range a 1.565 dome is 45 units, 3.75%.
   */
  domeScale?: number;
  /**
   * RECT beams only. How many times a second the crackle re-rolls. 0 (or absent) freezes it.
   *
   * Free at render time — `renderShots` clears and rebuilds every polygon each frame regardless, so
   * animating costs an extra hash per vertex and no extra allocation, draw call or state change.
   *
   * The phase comes from the wall clock, so two beams alive at once crackle in step and different
   * clients see different frames of it. Both are deliberate: it is cosmetic, nothing in the sim
   * reads it, and `instanceGlowBands` already animates off the same clock for the same reason.
   */
  crackleHz?: number;
  /**
   * CONE beams only. How many times a second a flame's `flicker`, `sway` and `ripple` re-roll, for
   * a layer naming no `flameHz` of its own. 0 (or absent) freezes the fan, which is the static
   * tongued cone every beam drew before flames animated.
   *
   * Separate from `crackleHz` above because the two shapes animate different things at different
   * natural rates: a rect's tear is a per-station edge jag, a cone's flicker is a whole tongue
   * rising and falling. Sharing one field would make a bolt's rate and a flame's rate look like one
   * decision when nothing about them is comparable.
   */
  flameHz?: number;
  /** CONE beams only. Flecks thrown off the flame. Absent draws none. */
  embers?: EmberStyle;
}

/**
 * The flecks a flame sheds — the detached bits of fire in the reference art, which is the one part
 * of that look a single connected silhouette cannot produce however well it moves.
 *
 * Every fleck is placed in the beam's own polar frame and clamped to the cone, so D19 survives:
 * an ember is inside the thing that burns for exactly the reason a tongue is.
 */
export interface EmberStyle {
  /**
   * How many flecks per beam instance. **This is a fill budget, not a taste knob**: each ember is
   * one more `fillPoints` in `renderShots`, and `afterburner` fires TWO instances per press. At the
   * shipped 6 a press costs `2 x (layers + 6)` fills, and a room of six players all burning tops
   * out near 130 — inside the ~180 that `predator` already establishes as the ceiling, and the
   * number to re-check before raising this.
   */
  count: number;
  /** Fleck radius in world units at birth, shrinking to nothing as it drifts out. */
  size: number;
  /** How many times a second a fleck completes its outward run. */
  hz: number;
  /** `#RRGGBB` every fleck fills in. */
  color: string;
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
 * Polygon vertices spent per tongue on a STATIC fan. Six is where a lobe stops reading as a polygon
 * corner at the ~200px a beam draws at; the cost of raising it is vertices in one existing fill,
 * never an extra fill, so this is a legibility knob rather than a performance one.
 */
const SAMPLES_PER_TONGUE = 6;

/**
 * Axial stations down an animated flame. The jet is walked from the muzzle to its tip and back,
 * so this is half the vertex count of one layer.
 *
 * 96 is one station every 2.3 units at `afterburner`'s 220 reach — fine enough that the sharpest
 * bite the roughness takes is still a curve rather than a corner, and that the finest octave gets
 * four stations a wave instead of aliasing into noise. It costs a five-layer flame ~194 vertices a
 * fill, which is vertices in an existing fill and never an extra one.
 */
const JET_STATIONS = 96;

/**
 * Where the coherent ROD ends and the flame starts breaking up, as a fraction of its reach.
 *
 * From the thickened-fuel literature rather than from taste: a flamethrower firing gelled fuel
 * throws a coherent rod for roughly the first three quarters of its throw and disperses over the
 * last quarter (a rod of 35-40 yards inside a 40-54 yard deposit pattern). That is the single most
 * characteristic thing about a flamethrower as opposed to a bonfire, and it is what the lobed
 * version got most wrong — it broke up evenly along its whole length, which is what a fan does.
 */
const JET_ROD_FRACTION = 0.6;

/**
 * The frequency step between octaves — each is this many times faster than the one before it, and
 * `flameHz` names the SLOWEST.
 *
 * The whole octave ladder comes off measured flame behaviour rather than taste. Buoyant flames puff
 * at about `1.5 / sqrt(D)` Hz with D the flame's width in metres; at this game's scale (a 48-unit
 * car is about 4.5 m, so ~10.7 units per metre) `afterburner`'s roughly 2 m wide plume puffs near
 * 1 Hz. The small roll-up vortices inside the luminous flame of the same flames were measured at
 * 10-20 Hz. Three octaves a factor of three apart span exactly that: at `flameHz` 1.3 the ladder
 * runs 1.3 / 3.9 / 11.7 Hz.
 *
 * **A single rate in the middle of that range is the mistake**, and it is the one every earlier cut
 * of this made: 4-9 Hz is too fast to billow and too slow to crackle, so the flame boils. Amplitude
 * has to fall as the rate rises too — see `JET_OCTAVE_WEIGHTS` — or the fine detail dominates and
 * the same boil comes back at a smaller size.
 */
const JET_OCTAVE_RATE = 3;

/**
 * How much of a station's roughness comes from each octave, coarsest first. Sums to 1, so `billow`
 * stays a straight fraction of the layer's width whatever the mix.
 */
const JET_OCTAVE_WEIGHTS = [0.46, 0.34, 0.2];
/** See `JET_COARSE_WAVES`. */
const JET_OCTAVE_STEP = 2.6;

/**
 * The exponent that biases the roughness field toward 0 — see `jetFlow`. Above 1 the flame is
 * mostly at its full width with bites taken out of it; at 1 it is a shape that has lost half its
 * width on average to a field that happens to average one half.
 */
const JET_BITE = 1.9;

/**
 * How many billows fit down the flame at the coarse octave, and the step between octaves. Sets
 * the size of the big masses: at 4.2 the largest are about a fifth of the flame's length, which is
 * roughly what a jet flame's big vortices measure against the visible flame.
 */
const JET_COARSE_WAVES = 3.5;

/**
 * How wide the jet is at the nozzle and how fast it opens out, as a fraction of the cone's own
 * half-width, and where it has fully opened.
 *
 * A real jet leaves the nozzle narrow and spreads. The hitbox does not: it is a 55-degree cone from
 * the muzzle, and a flame drawn permanently narrower than that is fire nobody can see hitting them.
 * So the taper is spent where it is free — over the first third, where the cone is only a few units
 * wide anyway — and the flame fills its hitbox from there out.
 */
const JET_MOUTH = 0.34;
/** See `JET_MOUTH`. */
const JET_OPEN_AT = 0.3;

/**
 * How much of its opened width the plume keeps at the tip. Below 1 the flame stops widening with
 * the cone and runs near-parallel-sided over its outer half — see `mouth` in `conePoints`.
 */
const JET_TIP = 0.78;

/** Vertices per shed mass. Ten reads as a rounded billow rather than as a fleck or a gem. */
const EMBER_VERTICES = 10;
/**
 * Per-weapon beam looks. Absent means the flat hitbox polygon — see `BeamStyle`.
 *
 * `afterburner`: the three flame colours of its own HUD icon, in the order the icon ramps them —
 * orange at the edge, yellower inward, yellow at the nozzle. They were sampled from the icon by
 * distance from the flame's axis, which is why the order is not a guess. Each layer is shorter AND
 * slightly narrower than the one outside it, so they nest as tongues rather than stacking as
 * horizontal stripes — which is what a shared apex and a varying reach alone produced, and why the
 * first cut read as a striped triangle. Tongue counts differ per layer (7 / 5 / 3) so the lobes do
 * not line up and the edges stay busy.
 *
 * Its `WEAPON_TABLE.color` is the SECOND layer, not the outer one, because a weapon's table colour
 * is its body and on a flame the body is one layer in. Note what changed on 2026-09-02: the outer
 * layer used to be a dark maroon `#7A2018`, chosen so the darkest ring sat outside and the cone read
 * as a hard-edged object. All three layers are now warm and within one hue family, so adjacent
 * layers separate by ~48 in RGB rather than ~130 — the cone reads as a smoother gradient than it
 * did. The silhouette against the light floor is unaffected; this is internal layer separation only.
 *
 * **It became a jet on 2026-09-04**, after two cuts that animated a FAN and neither of which read as
 * fire. Both are worth remembering, because they were wrong in the same way: a fan is a radius per
 * angle, and lobes on a fan can only grow and shrink where they stand. The first made them flicker,
 * the second made them asymmetric darts. Fire does neither. It CONVECTS — a mass is born at the
 * nozzle, grows, travels out and burns off the tip — and no amount of shaping a stationary lobe
 * imitates that. `conePoints` is now a ribbon walked along the axis, so a bulge can travel; see its
 * comment for the model.
 *
 * What is authored on top of it, and where each number comes from:
 *
 * - `advect` is the one that matters most, and no earlier cut had any form of it. Structures leave
 *   the nozzle and cross the flame in about a second.
 * - `flameHz` names the SLOWEST octave, and the ladder is `JET_OCTAVE_RATE` apart: 1.2 Hz here runs
 *   1.2 / 3.6 / 10.8. That spans the measured range — buoyant flames puff near `1.5 / sqrt(D)` Hz,
 *   about 1 Hz at this flame's width, while the small roll-ups inside the luminous flame run
 *   10-20 Hz. Both earlier cuts picked one rate in the middle of that, which is why they boiled.
 * - `billow` falls steeply inward. The outer boundary of a turbulent flame is intermittent — torn
 *   and mostly gaps at its fringe — while the core is a solid running body of fire. Uniform
 *   roughness gives five equally lumpy nested blobs, which is a lava lamp.
 * - `breakUp` is the flamethrower's own signature. Thickened fuel throws a coherent rod for about
 *   three quarters of its reach and disperses over the last quarter, and that contrast is most of
 *   what separates a flamethrower from a bonfire. Breaking up evenly along the length is the latter.
 * - `wander` gives the plume the S-swoop hand-drawn fire is built around, rather than symmetry
 *   about its own axis.
 *
 * **The colour ramp runs along the LENGTH, and that is the other thing the fan versions had
 * backwards.** A jet diffusion flame is soot-free and pale at its base, becomes the yellow luminous
 * sooting region downstream, and cools through orange to deep red at the tip where it burns out and
 * sheds. So each layer inward is both shorter and narrower, stacking the pale core over the nozzle
 * end and leaving crimson alone out at the tip. Every earlier cut wrapped the dark colour around
 * the outside as a rim — including around the root, which is the hottest part of a real flame and
 * the last place its coolest colour belongs.
 *
 * The three icon-sampled colours are still in the ramp in their original order, with `#A3120B` and
 * `#FFE9A8` added at the ends, so the flame's provenance survives it getting deeper.
 * `WEAPON_TABLE.color` sits in the middle rather than second, which is where a body colour belongs
 * on a five-stop ramp.
 *
 * `embers` are the tip burning off: jet flames shed at the tip as a whole event, and thickened fuel
 * throws lumps of burning gel past where the rod tore apart. They are the only part of this that
 * costs fills per flame rather than per layer — see `EmberStyle.count`.
 *
 * **What this gives up, deliberately.** The drawn flame covers about two thirds of the cone's width
 * rather than all of it: `JET_TIP` stops it widening with the hitbox over its outer half, which is
 * what stops it reading as a wedge, and `breakUp` shreds the far corners. `JET_BITE` exists to keep
 * that number from being much worse. It is a real cost — a car at the cone's rim can be burned by
 * fire it cannot quite see — and it is the first thing to raise if that ever gets reported.
 *
 * `bulwark` (the roster's other gold-cream cone, retired outright O17) used to sit here and
 * `shockwave` used to be a disc-hitbox aura, drawn as a ring and a wash rather than nested layers —
 * `beamDrawLayers` still refuses a disc hitbox at source. A disc ships again as of the magmablast
 * explosion mechanic, but as a BURST instance rather than a weapon's own row: `isAuraInstance`
 * (routed through `instanceDefOf`) catches it before `beamDrawLayers` is ever called with one, so
 * this refusal stays defence in depth rather than the path a real burst takes. `afterburner` and
 * `lance` are the only two beams whose OWN row ships in the roster.
 */
export const WEAPON_BEAM_STYLES: Partial<Record<WeaponId, BeamStyle>> = {
  /**
   * `tremor`: the retired `bulwark`'s two-layer recipe, recoloured to tremor's own bronze — full
   * cone in the table colour with a cream inner wedge. Two layers rather than three for the reason
   * bulwark's comment gave: a 492-unit cone is the widest thing drawn in the game, and a third
   * layer would be a band of colour the size of a car.
   */
  tremor: {
    layers: [
      { extentScale: 1, crossScale: 1, tongues: 0, tongueDepth: 0, color: "#8A6D12" },
      { extentScale: 0.55, crossScale: 0.8, tongues: 0, tongueDepth: 0, color: "#FFF0C0" },
    ],
  },
  afterburner: {
    layers: [
      // `tongues` / `tongueDepth` are the frozen fan's knobs and are ignored while a layer jets;
      // they stay authored so a layer that ever loses its rate degrades to a sane static cone
      // rather than to a bare triangle.
      //
      // **The ramp runs along the LENGTH, not as concentric rings, and that is from the physics.**
      // A jet diffusion flame is soot-free and pale at its base, becomes the yellow luminous
      // sooting region downstream, and cools to orange and then deep red at the tip, where it
      // burns out and sheds. So each layer inward is BOTH shorter and narrower, which stacks the
      // pale core over the nozzle end and leaves the crimson alone out at the tip. Every earlier
      // cut had the dark colour wrapped around the outside as a rim — including around the root,
      // which is the hottest part of a real flame and the last place its coolest colour belongs.
      //
      // Width falls faster than length (1 / 0.72 / 0.5 / 0.34 / 0.2 against 1 / 0.88 / 0.72 / 0.55
      // / 0.36), so the hot colours still run as ribbons rather than pooling into a blob at the
      // muzzle. `extentScale` and `crossScale` are independent for a cone, and this is what that
      // independence is for.
      //
      // `advect` rises inward: the middle of a jet moves faster than its edges, so the pale core
      // runs its structures out quicker than the crimson envelope carries its own.
      // `billow` falls steeply as the layers go in, and that is the flame's radial structure: the
      // outer envelope of a turbulent flame is intermittent — torn, wispy, mostly gaps at its
      // fringe — while the core is a solid running body of fire. A uniform roughness across the
      // layers makes five equally-lumpy nested blobs, which is what a lava lamp looks like.
      { extentScale: 1, crossScale: 1, tongues: 7, tongueDepth: 0.4, color: "#A3120B",
        billow: 0.9, breakUp: 0.95, wander: 0.75, advect: 1.1, flameHz: 1.2, phase: 0 },
      { extentScale: 0.95, crossScale: 0.85, tongues: 6, tongueDepth: 0.4, color: "#FF3D0D",
        billow: 0.84, breakUp: 0.92, wander: 0.7, advect: 1.2, flameHz: 1.3, phase: 1 },
      { extentScale: 0.85, crossScale: 0.65, tongues: 5, tongueDepth: 0.42, color: "#FF6000",
        billow: 0.78, breakUp: 0.88, wander: 0.65, advect: 1.35, flameHz: 1.4, phase: 2 },
      { extentScale: 0.7, crossScale: 0.45, tongues: 4, tongueDepth: 0.44, color: "#FF9000",
        billow: 0.7, breakUp: 0.8, wander: 0.6, advect: 1.5, flameHz: 1.5, phase: 3 },
      { extentScale: 0.5, crossScale: 0.26, tongues: 3, tongueDepth: 0.46, color: "#FFE9A8",
        billow: 0.58, breakUp: 0.6, wander: 0.55, advect: 1.7, flameHz: 1.7, phase: 4 },
    ],
    // Masses torn off the tip, in the envelope's own red so they read as bits of THIS flame rather
    // than as sparks from somewhere else. `hz` is their whole outward life, not a flicker rate:
    // 1.1 a second is about how often a jet flame's tip burns off.
    embers: { count: 8, size: 12, hz: 1.1, color: "#FF3D0D" },
    // The fallback for a layer naming no rate of its own. Every afterburner layer does, so this only
    // covers a layer added later without one.
    flameHz: 1.2,
  },
  /**
   * `lance`: a rect beam, so its layers nest by WIDTH and every `extentScale` stays 1. Narrowing
   * the length instead would hide a shorter bar inside a longer one of the same width and show
   * nothing. `tongues` is 0 for the same reason — lobes cut into a rect's far edge would only
   * shorten a shape whose whole read is "a straight line of light" — and `rectPoints` ignores them
   * regardless.
   *
   * **It became a lightning bolt on 2026-09-04.** It shipped until then as two flat nested
   * rectangles, which read as a highlighter stroke rather than as energy — hard parallel edges,
   * uniform for all 1200 units, and using only two of the three colours its icon is built from. Four
   * things fixed that, and each is load-bearing:
   *
   * - The icon's **deep blue `#0356DC`** is back. It is 27% of the icon's opaque pixels and was
   *   missing entirely; it is what gives the beam an edge against the pale floor.
   * - `crackle` **falls to zero as the layers go inward**. An early cut tore every layer equally and
   *   the whole beam undulated like a ribbon. A laser holds a straight hot line and tears at its
   *   edges — hence a dead-straight `#FDFFE4` core inside a heavily-torn outer envelope.
   * - The crackle's amplitude is modulated by a slower noise (see `rectPoints`), so the bolt has
   *   calm stretches and torn ones. A constant-amplitude zigzag reads as decorative trim.
   * - `domeScale` rounds the ORIGIN, the shape `thumper`'s capsule head has. It is carved out of the
   *   beam's length rather than added behind the muzzle, so unlike the charge orb it needs no
   *   hitbox exception at all.
   *
   * Its charge orb is the wind-up made visible: 700 ms is the entire justification for 170 damage,
   * and an opponent could not previously see it happening. Colours match the beam exactly, so the
   * orb reads as the same thing gathering that is about to be fired — it grew from two bands to four
   * with the beam, and a test compares the two lists element for element.
   *
   * Its `WEAPON_TABLE.color` is the yellow layer, not the outer edge, which is the one place the
   * table breaks its own habit for a beam: `thunderclap` holds `#3ED1FA` already and weapon colours
   * must be unique. That is also why the yellow stays `#F0FF00` rather than taking the icon's
   * measured `#ECFC06` — the two are indistinguishable on screen, and changing it would move
   * `balanceStamp` and owe the players' guide a rebuild for no visible gain.
   */
  lance: {
    layers: [
      // Rates rise as the tears get shallower — see `BeamLayer.crackleHz`. Measured cost per
      // rendered frame at these settings: 1.72, 1.50 and 0.52 units. Flattening these to one rate
      // would price the whole beam at the outer layer's 4.96 and force a 60% cut in tear depth.
      //
      // Those three numbers were re-measured on 2026-09-04, after `noise` was found not to be
      // hashing (see its comment): until then a roll only slid every station by a constant −0.0151,
      // so the tear crept uniformly rather than re-rolling and the bolt was quietly much calmer
      // than these settings ask for. The rates are UNCHANGED by that fix — the budget they were
      // chosen against was computed as `crackle x rate`, not measured off the broken shape, and the
      // real motion lands just inside it.
      { extentScale: 1, crossScale: 1, tongues: 0, tongueDepth: 0, color: "#0356DC", crackle: 0.42, wander: 0.05, crackleHz: 5 },
      { extentScale: 1, crossScale: 0.7, tongues: 0, tongueDepth: 0, color: "#0AC6FD", crackle: 0.34, wander: 0.04, crackleHz: 8 },
      { extentScale: 1, crossScale: 0.34, tongues: 0, tongueDepth: 0, color: "#F0FF00", crackle: 0.14, crackleHz: 14 },
      // The core: no crackle, no wander. This straight line is what reads as a laser; everything
      // outside it is the field around it tearing.
      { extentScale: 1, crossScale: 0.12, tongues: 0, tongueDepth: 0, color: "#FDFFE4" },
    ],
    // 1.565 half-widths = 45 units at the shipped `width: 57.5`, which is 3.75% of its 1200 reach.
    domeScale: 1.565,
    // The fallback for a layer that names no rate of its own. Every one of lance's crackling layers
    // does, so this only covers a layer added later without one — deliberately the slowest rate, so
    // an unconsidered new layer is smooth by default rather than jumpy by default.
    crackleHz: 5,
    charge: {
      minRadius: 2,
      // Tracks the beam's own 15% widening (T13: `hitbox.width` 20 -> 23), so the telegraph keeps
      // matching what it warns about. A charge orb that stopped growing with the beam would
      // under-promise the thing about to be fired, which is the one failure mode a telegraph has.
      maxRadius: 18.9,
      // One band per beam layer, in the beam's own order: the orb is the beam gathering, so a band
      // the beam does not have would telegraph a shot that is not coming. `combat-visual.test.ts`
      // compares the two lists element for element, which is what keeps them moving together.
      bands: [
        { radiusScale: 1, color: "#0356DC" },
        { radiusScale: 0.7, color: "#0AC6FD" },
        { radiusScale: 0.4, color: "#F0FF00" },
        { radiusScale: 0.16, color: "#FDFFE4" },
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
 * and `beamDrawLayers` refuses anything whose `kind` is not `beam`. Before this existed, every
 * non-circular projectile drew one flat `weaponFillOf` polygon and had no way to say anything else.
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
  | { shape: "spikes"; baseScale: number; halfHeightScale: number; color: string }
  /**
   * A free polygon, as `[alongScale, acrossScale]` vertices — fractions of `radiusAlong` and
   * `radiusAcross`, exactly like every scale above.
   *
   * The escape hatch for a silhouette the four named shapes above cannot describe: a swept fin, an
   * ogive nose, an exhaust plume. It exists because `predator` is a MISSILE rather than a marked
   * slug, and no combination of tip/band/disc/spikes draws one.
   *
   * **Its containment is the one in this union that is not implied by its own parameters.** The
   * others multiply a scale INTO the hitbox and so cannot escape it; a poly is an arbitrary list of
   * points. Every vertex is therefore pushed through `clampToHull` at draw time, which pulls it
   * onto the hull rather than dropping the layer — so an authoring slip degrades the shape instead
   * of deleting it, and no poly can draw outside the thing that hits. `projectile-marks.test.ts`
   * checks the clamp directly rather than only through whatever the table authors today.
   */
  | { shape: "poly"; points: readonly (readonly [number, number])[]; color: string };

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
 * Per-weapon looks for the non-circular projectiles. Absent means the flat hitbox polygon.
 *
 * `thumper`: Bastion's yellow with a cream band across the middle, which is its icon. A band rather
 * than a nose is also the cheap shape here — 0.216 of `radiusAlong` keeps it inside the shell's
 * straight section, so it is a rectangle and needs none of the circular-segment maths a nose on a
 * capsule would.
 *
 * `predator`: a full missile — see `predatorMissileLayers`. It shipped as `thumper`'s two-shape
 * recipe (grey capsule, red band) until 2026-09-04, which read as a pill rather than as the missile
 * its icon draws; it is now 15 `poly` layers carrying the icon's nose cone, stripe, swept fins and
 * exhaust plume. Two things changed with it and are worth knowing before touching either:
 *
 * - Its greys are DARKER than the icon's. The floor is `#EBEBEB` and the icon is drawn for a white
 *   page, so the icon's own body greys wash out on it. Do not "correct" them back toward the icon.
 * - Its `radiusAlong` grew 14 -> 19 in the same change, to CONTAIN the plume rather than let it
 *   trail outside the hitbox. The art and that number are one decision, not two: shortening the
 *   plume without shortening the hitbox leaves reach that draws nothing.
 *
 * `needler` and `skewer` (a nosed dart and a disc-and-spikes spindle) were retired outright with
 * the 2026-09-01 roster cutover (O17); their comment history lives in git. One non-circular
 * projectile ships without a style today: `pepperbox` (an ellipse, carrying `needler`'s old dart
 * silhouette per O9), which draws the flat hitbox-colour fill until an owner arts it.
 * `roadblock`'s bar hitbox is a third, architecturally
 * distinct case: `projectileDrawLayers` refuses a bar at source regardless of this table, because
 * the hull/tip/band/disc/spikes vocabulary below assumes an along/across ellipse-ish geometry a bar
 * does not have — it always draws its raw hitbox polygon, the same as `beamDrawLayers`'s fallback.
 */
/**
 * `predator`'s colours, measured off its own HUD icon rather than guessed — then DARKENED.
 *
 * The icon is drawn to read on a white page; the arena floor is `#EBEBEB`, which is nearly the same
 * white. Transplanted literally, the icon's body greys (`#8A8A89` and up) washed out and the shot
 * read as SHORTER than the flat capsule it replaced, because the pale nose cone disappeared into the
 * floor. These are the icon's hues carried down roughly two stops, which is what buys the silhouette
 * back. `outline` is the one colour taken at full strength: 16.4% of the icon's opaque pixels are
 * near-black edge, and on a pale floor that edge is doing most of the work.
 */
const PREDATOR_PAINT = {
  outline: "#171717",
  noseLight: "#9A9A99",
  bodyLit: "#7E7E7D",
  body: "#5E5E5D",
  bodyShade: "#3C3C3B",
  fin: "#2E2E2D",
  stripe: "#B31517",
  stripeLit: "#E43C3D",
  nozzle: "#141414",
  flameOuter: "#C02000",
  flameMid: "#FF6000",
  flameCore: "#FFC000",
} as const;

/**
 * `predator` as a missile: nose cone, red stripe, barrel, swept fins and an exhaust plume.
 *
 * **Built rather than written out.** Fifteen polygons of hand-typed vertices would be unreadable and
 * impossible to re-tune; the proportions below are the icon's own measurements, taken along its
 * missile's axis (nose 0, nozzle 1): nose cone to 0.16, red stripe 0.24-0.41, barrel to 0.66, fins
 * flaring to 2.3x the body half-width by 0.93, dark nozzle to 1.
 *
 * Authored against the capsule the weapon ships with — `radiusAlong` 19, `radiusAcross` 6 — and
 * emitted as SCALES, so a re-tune carries the whole missile with it. A re-tune that moves the two
 * radii by different factors stretches the drawing; that is the documented behaviour of `band` and
 * `spikes` too, not a new caveat.
 *
 * **The plume is why `radiusAlong` is 19 and not 14.** It was drawn first as art trailing behind the
 * hitbox, which would have meant a shot whose most legible feature could not hurt anyone; the
 * hitbox was lengthened to contain it instead, so the exhaust genuinely burns. The plume therefore
 * has to reach the capsule's tail — if it ever stops short, the weapon reaches further than it
 * draws, which is the exact failure D19 exists to prevent. `projectile-marks.test.ts` pins that.
 *
 * Cost: 15 `fillPoints` per live predator. Predator's 2 s life against its 1000 ms cooldown allows
 * two in the air per player, so a full six-player room tops out near 180 fills a frame on the shared
 * `shotGfx` — comfortably inside the budget, since it is one Graphics with no blend-mode change.
 * See `docs/asset-pipeline.md#how-much-detail-a-shot-can-afford`.
 */
function predatorMissileLayers(): ProjectileLayer[] {
  // The hitbox this art was drawn against. Dividing out at the end is what turns it into scales.
  const RA = 19;
  const RC = 6;

  const NOSE = 18.7; // just inside the round cap, so the outline has somewhere to sit
  const NOZZLE = -9; // where the missile ends and the plume begins
  const BODY = NOSE - NOZZLE;
  const BW = RC * 0.56; // body half-width: narrow enough that the fins can flare to the hull edge
  /** Fraction of the MISSILE's own length, nose = 0, nozzle = 1. */
  const at = (f: number): number => NOSE - f * BODY;

  type P = [number, number];
  const halfAt = (along: number): number => hullHalfAcross({ shape: "capsule", radiusAlong: RA, radiusAcross: RC }, along);
  const clamp = ([a, c]: P): P => {
    const na = Math.max(-RA, Math.min(RA, a));
    const lim = halfAt(na);
    return [na, Math.max(-lim, Math.min(lim, c))];
  };
  const box = (a0: number, a1: number, c0: number, c1: number): P[] => [
    [a0, c0],
    [a1, c0],
    [a1, c1],
    [a0, c1],
  ];
  /** A cone that sharpens toward the tip, like the icon's nose. */
  const ogive = (from: number, tip: number, halfW: number, sign: number): P[] =>
    Array.from({ length: 7 }, (_, i) => {
      const t = i / 6;
      return [from + (tip - from) * t, halfW * Math.sqrt(Math.max(0, 1 - t)) * sign] as P;
    });

  const FIN_ROOT = at(0.62);
  const fins: P[][] = [-1, 1].map((s) => [
    [FIN_ROOT, BW * 0.95 * s],
    [NOZZLE, (RC - 0.15) * s],
    [NOZZLE, BW * 0.9 * s],
  ]);
  const shoulder = at(0.44);
  const barrel: P[] = [
    [NOZZLE, -BW],
    [shoulder, -BW],
    ...ogive(shoulder, NOSE, BW, -1),
    ...ogive(shoulder, NOSE, BW, 1).reverse(),
    [shoulder, BW],
    [NOZZLE, BW],
  ];

  /** Push a polygon out from its own centroid, so the dark edge sits under the whole silhouette. */
  const outline = (pts: P[]): P[] => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return pts.map(([a, c]) => {
      const dx = a - cx;
      const dy = c - cy;
      const len = Math.hypot(dx, dy) || 1;
      return clamp([a + (dx / len) * 1.15, c + (dy / len) * 1.15]);
    });
  };

  // Three nested tongues, widened at the root so the hitbox the re-tune bought is actually drawn.
  const root = NOZZLE + 0.4;
  const plume: [number, number, string][] = [
    [-RA, RC - 0.3, PREDATOR_PAINT.flameOuter],
    [-RA + 2.6, (RC - 0.3) * 0.68, PREDATOR_PAINT.flameMid],
    [-RA + 5.2, (RC - 0.3) * 0.38, PREDATOR_PAINT.flameCore],
  ];

  const layers: { pts: P[]; color: string }[] = [
    // Outline first, under everything.
    ...[...fins, barrel].map((p) => ({ pts: outline(p), color: PREDATOR_PAINT.outline })),
    ...plume.map(([tip, half, color]) => ({
      pts: [
        [root, -half],
        [root - (root - tip) * 0.42, -half * 0.74],
        [tip, 0],
        [root - (root - tip) * 0.42, half * 0.74],
        [root, half],
      ] as P[],
      color,
    })),
    ...fins.map((p) => ({ pts: p, color: PREDATOR_PAINT.fin })),
    { pts: barrel, color: PREDATOR_PAINT.body },
    // Cylinder shading: a lit strip down one flank, a shadow down the other.
    { pts: box(NOZZLE, shoulder, -BW, -BW * 0.32), color: PREDATOR_PAINT.bodyLit },
    { pts: box(NOZZLE, shoulder, BW * 0.42, BW), color: PREDATOR_PAINT.bodyShade },
    { pts: box(at(0.41), at(0.24), -BW, BW), color: PREDATOR_PAINT.stripe },
    { pts: box(at(0.41), at(0.24), -BW, -BW * 0.32), color: PREDATOR_PAINT.stripeLit },
    {
      pts: [
        [at(0.17), -BW * 0.86],
        ...ogive(at(0.17), NOSE, BW * 0.86, -1),
        ...ogive(at(0.17), NOSE, BW * 0.86, 1).reverse(),
        [at(0.17), BW * 0.86],
      ] as P[],
      color: PREDATOR_PAINT.noseLight,
    },
    { pts: box(NOZZLE, NOZZLE + 1.6, -BW * 0.8, BW * 0.8), color: PREDATOR_PAINT.nozzle },
  ];

  return layers.map(({ pts, color }) => ({
    shape: "poly",
    points: pts.map(clamp).map(([a, c]) => [a / RA, c / RC] as const),
    color,
  }));
}

export const WEAPON_PROJECTILE_STYLES: Partial<Record<WeaponId, ProjectileStyle>> = {
  thumper: {
    layers: [
      { shape: "hull", color: "#FFD800" },
      { shape: "band", halfWidthScale: 0.216, color: "#FFF6D8" },
    ],
  },
  predator: { layers: predatorMissileLayers() },
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
 *
 * A burst is spawned at full extent, and its synthesized `speed` (`instanceDefOf`) exists only to
 * make its expiry clock read one tick — extrapolating growth from it would creep the drawn disc
 * outward for no reason, so growth is skipped entirely for `instance.isExplosion`.
 */
export function beamGrownExtent(instance: DrawableInstance, elapsedMs: number): number {
  if (instance.isExplosion) return instance.extent;
  const def = drawDefOf(instance);
  if (!def || def.kind !== "beam") return Math.max(0, instance.extent);
  return Math.min(def.range, instance.extent + (def.speed * capMs(elapsedMs)) / 1000);
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
 * One point pulled onto the hitbox: `along` into `[-radiusAlong, radiusAlong]`, then `across` to
 * whatever half-width the hull actually has at that station.
 *
 * The order matters and is not interchangeable. Clamping `along` FIRST means the width limit is
 * read at the station the point ends up on, not the one it asked for — which is what keeps a vertex
 * out past the nose from being narrowed against the straight section's full `radiusAcross` and
 * landing outside the round cap.
 *
 * Exported for `projectile-marks.test.ts`: this function is the entire containment guarantee for a
 * `poly` layer, so it is checked directly rather than only through the polygons the table happens
 * to author today.
 */
export function clampToHull(
  hitbox: Extract<ProjectileHitbox, { shape: "ellipse" | "capsule" }>,
  along: number,
  across: number,
): { along: number; across: number } {
  const a = Math.max(-hitbox.radiusAlong, Math.min(hitbox.radiusAlong, along));
  const limit = hullHalfAcross(hitbox, a);
  return { along: a, across: Math.max(-limit, Math.min(limit, across)) };
}

/**
 * The polygons to fill for one non-circular projectile, in draw order, or `[]` for a weapon with no
 * style — whose caller falls back to the single flat `weaponFillOf` hull.
 *
 * Takes the instance and `elapsedMs` rather than a resolved position so it extrapolates through the
 * same `extrapolateShot` that `instanceDrawShape` uses. Handing it an already-extrapolated point
 * would let the markings and the hull drift apart by a frame's worth of travel — real distance for
 * a fast styled projectile, not a rounding error.
 */
export function projectileDrawLayers(
  instance: DrawableInstance,
  elapsedMs: number,
): DrawBeamLayer[] {
  const def = drawDefOf(instance);
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
    if (layer.shape === "poly") {
      // Every vertex through `clampToHull`, which is what makes an arbitrary polygon safe. A layer
      // with fewer than three surviving points is skipped rather than filled: Phaser draws nothing
      // useful for it, and letting it through would put a degenerate shape in the batch.
      if (layer.points.length < 3) continue;
      out.push({
        points: layer.points.map(([alongScale, acrossScale]) => {
          const p = clampToHull(hitbox, alongScale * hitbox.radiusAlong, acrossScale * hitbox.radiusAcross);
          return rotateBy(x, y, a, p.along, p.across);
        }),
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
  /**
   * A free-running clock (`performance.now()`), for a rect beam whose style asks to animate. Not
   * the patch-relative `elapsedMs` beside it: that one saws back to zero every patch, which would
   * tie the crackle to the network rather than to the shot. Defaulted so every existing caller and
   * test keeps drawing the frozen frame it drew before.
   */
  nowMs = 0,
): DrawBeamLayer[] {
  const def = isWeaponId(weaponId) ? weaponDefOf(weaponId) : null;
  // A projectile id reaching here would mean the caller branched on the wrong thing; drawing
  // nothing is the honest answer, and the caller's flat-fill fallback still puts a shape on screen.
  if (!def || def.kind !== "beam") return [];
  const style = WEAPON_BEAM_STYLES[def.id];
  if (!style) return [];

  // A disc has no cross-section to nest layers inside, and it is drawn as a ring rather than as a
  // filled solid — see `isAuraInstance`. Layered styles are a directional-beam idea. A burst instance
  // always carries a disc hitbox, so this refusal is also what keeps one from ever reaching the
  // `beamGrownExtent` call below — the `isExplosion: false` there is never actually load-bearing.
  if (def.hitbox.shape === "disc") return [];

  const grown = beamGrownExtent({ weaponId, isExplosion: false, x, y, angle, extent }, elapsedMs);
  const layers: DrawBeamLayer[] = [];
  for (const [index, layer] of style.layers.entries()) {
    const points =
      def.hitbox.shape === "cone"
        ? conePoints(def.hitbox.angleDeg, x, y, angle, grown, layer, style, nowMs, index)
        : rectPoints(def.hitbox.width, x, y, angle, grown, layer, style, nowMs, index);
    // Fewer than three vertices is a beam on its spawn tick, whose extent is still zero. Dropping
    // it here keeps `fillPoints` off a degenerate shape rather than making the render loop
    // re-check what this already knows.
    if (points.length < 3) continue;
    layers.push({ points, fill: hexToFill(layer.color) });
  }
  // Last, so they draw ON TOP of every layer: an ember is in front of the fire, not inside it.
  layers.push(...emberPolys(def.hitbox, x, y, angle, grown, style, nowMs));
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
 * A flame inside a cone hitbox, in world space.
 *
 * **Why this is walked along the AXIS rather than swept around the muzzle.** Every earlier cut of
 * this described the outline as a radius per ANGLE — a fan of lobes, however the lobes were shaped.
 * That model cannot express the one thing a flamethrower actually does: its structures TRAVEL.
 * Burning masses leave the nozzle, grow, and are carried out to the tip. Measured jet flames carry
 * large toroidal vortices outside the luminous flame and small roll-ups inside it, both convecting
 * downstream; a silhouette parameterised by angle can only make lobes taller and shorter in place,
 * which is a curtain twitching, not fire.
 *
 * So the flame is a RIBBON. At each of `JET_STATIONS` stations down the beam's axis it has a
 * half-width and a centreline offset, and the polygon is one edge out and the other edge back. The
 * noise those two read is sampled at `station - speed x time`, and that subtraction is what carries
 * a bulge from the muzzle to the tip. Three properties fall out of the model rather than being
 * arranged on top of it:
 *
 * - **It is always a simple polygon.** The near edge is never past the far edge, because both are
 *   the centreline plus or minus a non-negative width. Nothing to self-intersect, however violent
 *   the shape gets — which is what lets the flame tear itself almost in two safely.
 * - **The tip lands exactly on the hitbox's far edge, every frame.** The last station IS `reach`.
 *   The lobed version could only manage it on frames where some lobe happened to be fully out.
 * - **Containment is one inequality per station**: `|centre| + width <= tan(half) x along`. Both are
 *   authored as fractions of that limit, so it holds by construction, and `put` clamps anyway.
 *
 * What is drawn on that, all of it from how flames are observed rather than from taste:
 *
 * - **Three octaves of roughness**, an order of magnitude apart in rate — see `JET_COARSE_RATIO`.
 *   Buoyant flames puff at about `1.5 / sqrt(D)` Hz, which at this game's scale puts the big
 *   billowing near 1 Hz, while the small roll-up vortices inside the luminous flame were measured
 *   at 10-20 Hz. A flame carries both at once. One rate in between is what makes fire look like
 *   bunting.
 * - **A coherent rod, then break-up.** Thickened fuel holds together for roughly the first three
 *   quarters of its throw and disperses over the last quarter. Past `JET_ROD_FRACTION` the
 *   half-width is pinched hard by its own noise, so the flame necks, tears and sheds — and is dense
 *   and smooth before that. Breaking up evenly along the whole length is what a bonfire does.
 * - **Rounded billows, not spikes.** Summed octaves give lumps at several sizes with round
 *   shoulders, which is the shape hand-drawn fire uses too: C-shapes and hooks at varied sizes,
 *   never uniform clumps.
 * - **An S-swoop.** `wander` walks the centreline off the axis, advected like everything else, so
 *   the flame is bent rather than symmetric about its own centre.
 *
 * A style authoring none of it, or naming no `flameHz`, gets the frozen tongued fan every cone drew
 * before flames animated — which is what `tremor` still draws, vertex for vertex.
 */
function conePoints(
  angleDeg: number,
  x: number,
  y: number,
  heading: number,
  extent: number,
  layer: BeamLayer,
  style: BeamStyle,
  nowMs: number,
  index: number,
): { x: number; y: number }[] {
  const reach = Math.max(0, extent) * clamp01(layer.extentScale);
  const half = ((angleDeg * Math.PI) / 360) * clamp01(layer.crossScale);
  if (reach <= 0 || half <= 0) return [];

  const billow = clamp01(layer.billow ?? 0);
  const breakUp = clamp01(layer.breakUp ?? 0);
  const wander = clamp01(layer.wander ?? 0);
  const hz = Math.max(0, layer.flameHz ?? style.flameHz ?? 0);
  // A rate with nothing to move, or motion with no rate, is the frozen fan either way.
  const jet = hz > 0 && (billow > 0 || breakUp > 0 || wander > 0);

  if (!jet) {
    const lobes = Math.max(0, Math.floor(layer.tongues));
    const depth = clamp01(layer.tongueDepth);
    const samples = lobes === 0 ? 2 : Math.max(2, lobes * SAMPLES_PER_TONGUE);
    // The apex is the muzzle itself, so the fan is anchored to the car rather than floating.
    const fan: { x: number; y: number }[] = [rotateBy(x, y, heading, 0, 0)];
    for (let i = 0; i <= samples; i++) {
      const u = -1 + (2 * i) / samples;
      // 1 at a tongue tip, 0 in a valley. `lobes` full cycles across the fan.
      const wave = lobes === 0 ? 1 : 0.5 + 0.5 * Math.cos(lobes * Math.PI * u);
      const theta = u * half;
      // `/ cos(theta)` is what makes a tongue TIP land on the cone's flat far edge instead of on a
      // circle through its nose. Without it the tips trace an arc of radius `reach`, which touches
      // the hitbox only on the centreline and falls 11% short of it at the cone's rim.
      const r = (reach / Math.cos(theta)) * (1 - depth * (1 - wave));
      fan.push(rotateBy(x, y, heading, r * Math.cos(theta), r * Math.sin(theta)));
    }
    return fan;
  }

  const flow = jetFlow(layer, style, nowMs, index);
  const tan = Math.tan(half);

  /**
   * Place a station's vertex, clamped into the cone. Structural, not an argument.
   */
  const put = (along: number, across: number): { x: number; y: number } => {
    const a = Math.max(0, Math.min(reach, along));
    const lim = tan * a;
    return rotateBy(x, y, heading, a, Math.max(-lim, Math.min(lim, across)));
  };

  const near: { x: number; y: number }[] = [];
  const far: { x: number; y: number }[] = [];
  for (let i = 0; i <= JET_STATIONS; i++) {
    const s = i / JET_STATIONS;
    const along = s * reach;
    // The cone's own half-width here. Everything below is a fraction of it, which is the whole
    // containment argument.
    const limit = tan * along;

    // The plume's own profile, on top of the cone's linear widening: narrow at the nozzle, fully
    // open by `JET_OPEN_AT`, then closing back toward `JET_TIP` over the outer half.
    //
    // The closing half is what stops the flame reading as a wedge. A cone hitbox widens linearly
    // forever, so a shape that simply fills it has two dead-straight walls and no amount of edge
    // noise hides them — the eye reads the taper, not the wobble. Against that, `limit` growing and
    // `mouth` shrinking roughly cancel over the outer half, which gives the near-parallel sided
    // plume a flamethrower actually throws before it tears apart. The width given up is at the
    // hitbox's far corners, where `breakUp` has already shredded the flame anyway.
    const open = Math.min(1, s / JET_OPEN_AT);
    const opened = JET_MOUTH + (1 - JET_MOUTH) * (open * open * (3 - 2 * open));
    const close = clamp01((s - JET_OPEN_AT) / (1 - JET_OPEN_AT));
    const mouth = opened * (1 - (1 - JET_TIP) * (close * close * (3 - 2 * close)));

    // **The two edges are roughened INDEPENDENTLY**, and that is not a detail. One width either
    // side of a centreline makes every station mirror-symmetric, so the whole plume bulges and
    // pinches in lockstep and reads as a lava lamp however lumpy its profile is. Real fire's two
    // sides have nothing to do with each other. Two noise fields, one per edge, for one extra
    // sample a station.
    const base = limit * mouth;
    let wNear = base * (1 - billow * flow.rough(s, 0));
    let wFar = base * (1 - billow * flow.rough(s, 1));
    if (s > JET_ROD_FRACTION && breakUp > 0) {
      // Past the rod. Both edges are pinched by ONE shared term — a neck is a neck, and pinching
      // them independently would slide the flame sideways rather than tearing it. Sharpened toward
      // its extremes so the ribbon necks to nothing in places rather than thinning evenly, which is
      // what sheds a mass instead of tapering to a point.
      const past = (s - JET_ROD_FRACTION) / (1 - JET_ROD_FRACTION);
      const n = flow.rough(s + 0.37, 2);
      const pinch = 1 - breakUp * past * (n * n * (3 - 2 * n));
      wNear *= pinch;
      wFar *= pinch;
    }
    wNear = Math.max(0, wNear);
    wFar = Math.max(0, wFar);

    // Bounded by the room the widest edge leaves, so a swooping centreline can never push either
    // edge past the cone's wall.
    const centre = (flow.swoop(s) - 0.5) * 2 * wander * Math.max(0, limit - Math.max(wNear, wFar));
    near.push(put(along, centre - wNear));
    far.push(put(along, centre + wFar));
  }
  return [...near, ...far.reverse()];
}

/**
 * The travelling noise field one flame layer reads: `rough` for the silhouette, `swoop` for the
 * centreline. Both take an axial station in `[0, 1]` and return `[0, 1]`.
 *
 * Its own function because the field is the flame — the octave mix, the advection and the seeding
 * are one decision, and splitting them across the two callers is how a shed mass ends up drifting
 * at a different speed from the fire it left and reading as a decal stuck on top of it.
 */
function jetFlow(
  layer: BeamLayer,
  style: BeamStyle,
  nowMs: number,
  index: number,
): { rough: (s: number, edge: number) => number; swoop: (s: number) => number } {
  const hz = Math.max(0, layer.flameHz ?? style.flameHz ?? 0);
  const advect = Math.max(0, layer.advect ?? 0);
  // `phase` is what lets two layers share one flame — see `BeamLayer.phase`.
  const group = layer.phase ?? index;
  const octaves = [
    flowingNoise(nowMs, hz, group),
    flowingNoise(nowMs, hz * JET_OCTAVE_RATE, group + 131),
    flowingNoise(nowMs, hz * JET_OCTAVE_RATE * JET_OCTAVE_RATE, group + 263),
  ];
  const swoopNoise = flowingNoise(nowMs, hz, group + 397);

  // How far the pattern has been carried out of the nozzle, in flame lengths. This is the
  // convection, and it is the difference between fire and bunting.
  const carried = (Math.max(0, nowMs) / 1000) * advect;

  /** Smooth interpolation between whole stations, so a wave is a wave rather than a staircase. */
  const at = (
    gen: (i: number, offset: number) => number,
    p: number,
    offset: number,
  ): number => {
    const i0 = Math.floor(p);
    const f = p - i0;
    const w = f * f * (3 - 2 * f);
    const a = gen(i0, offset);
    return a + (gen(i0 + 1, offset) - a) * w;
  };

  return {
    rough: (s, edge) => {
      const p = (s - carried) * JET_COARSE_WAVES;
      // The two structural octaves, contrasted, then the fine one added ON TOP of the result.
      //
      // Order matters and this was worth getting wrong once. Summed octaves pile up around their
      // mean, so a raw sum is mostly mid-grey and the edge comes out as a gentle undulation — a
      // flame's boundary is mostly-full with sharp bites out of it, not a sine wave. Two
      // smoothsteps put the bites back. But running the FINE octave through the same curve flattens
      // it into the shoulders it is supposed to be roughening, which is how an edge ends up smooth
      // however many octaves you claim to have summed.
      let body = 0;
      for (let o = 0; o < 2; o++) {
        body +=
          JET_OCTAVE_WEIGHTS[o]! *
          at(octaves[o]!, p * Math.pow(JET_OCTAVE_STEP, o), 211 + o * 97 + edge * 6151);
      }
      const a = clamp01(body / (JET_OCTAVE_WEIGHTS[0]! + JET_OCTAVE_WEIGHTS[1]!));
      const b = a * a * (3 - 2 * a);
      const shaped = b * b * (3 - 2 * b);
      const fine = at(octaves[2]!, p * Math.pow(JET_OCTAVE_STEP, 2), 405 + edge * 6151);
      const w = JET_OCTAVE_WEIGHTS[2]!;
      // Biased toward 0, and this is a D19 fix as much as a look. `rough` SHRINKS the flame, so a
      // field averaging 0.5 costs half the authored `billow` at every station and the drawn flame
      // ends up permanently narrower than the cone that burns — measured at 49% of the hitbox's
      // width before this line existed, which is a player at the cone's edge being set on fire by
      // something they cannot see. A flame's boundary is mostly-full with bites taken out of it, so
      // the field should be mostly-0 with excursions, not centred. The deep bites still reach.
      return Math.pow(clamp01(shaped * (1 - w) + fine * w), JET_BITE);
    },
    swoop: (s) => at(swoopNoise, (s - carried) * JET_COARSE_WAVES * 0.45, 31),
  };
}

/**
 * The burning masses a flame sheds off its tip, `[]` for a style that asks for none.
 *
 * **These are not sparks.** Jet flames shed at the tip — the flame tip burns out and detaches as a
 * whole event — and a flamethrower firing thickened fuel throws lumps of burning gel that carry on
 * past where the rod has torn itself apart. So they are big, round, few, and they appear only PAST
 * `JET_ROD_FRACTION`, drifting outward and burning out rather than fading.
 *
 * They still obey D19: each is placed and clamped inside the cone, so a mass is in the thing that
 * burns for the same reason the ribbon is. They cost a fill each — see `EmberStyle.count`.
 */
function emberPolys(
  hitbox: BeamHitbox,
  x: number,
  y: number,
  heading: number,
  extent: number,
  style: BeamStyle,
  nowMs: number,
): DrawBeamLayer[] {
  const embers = style.embers;
  if (!embers || hitbox.shape !== "cone" || extent <= 0) return [];
  const count = Math.max(0, Math.floor(embers.count));
  if (count <= 0) return [];

  const half = (hitbox.angleDeg * Math.PI) / 360;
  const tan = Math.tan(half);
  const fill = hexToFill(embers.color);
  // Seeded clear of any layer group, so a mass's wander is its own rather than a copy of the
  // silhouette's.
  const wobble = flowingNoise(nowMs, Math.max(0, embers.hz), 4409);
  const out: DrawBeamLayer[] = [];

  for (let e = 0; e < count; e++) {
    // Each mass runs its own outward life, offset so they do not all leave together.
    const life = ((nowMs / 1000) * embers.hz + noise(e, 7717)) % 1;
    // Born at the tear and carried to the hitbox's own edge.
    const along = (JET_ROD_FRACTION + (1 - JET_ROD_FRACTION) * life) * extent;
    const limit = tan * along;
    // Off to a side rather than on the axis: a mass tears off the flame's flank, not out of its
    // middle, and the middle is where the ribbon is still solid anyway.
    const across = (wobble(e, 53) - 0.5) * 2 * limit * 0.8;
    // Grows briefly as it leaves, then burns out. A lump of fuel does not simply fade.
    const size = embers.size * Math.sin(Math.PI * Math.min(1, life * 1.15));
    if (size <= 0.4) continue;

    const points: { x: number; y: number }[] = [];
    for (let v = 0; v < EMBER_VERTICES; v++) {
      const a = (v / EMBER_VERTICES) * Math.PI * 2;
      // Lumpy rather than a clean disc, off the same hash: a burning mass is not a bead.
      const r = size * (0.72 + 0.28 * noise(e * 31 + v, 613));
      const ca = Math.max(0, Math.min(extent, along + Math.cos(a) * r));
      const cl = tan * ca;
      const pc = across + Math.sin(a) * r;
      points.push(rotateBy(x, y, heading, ca, Math.max(-cl, Math.min(cl, pc))));
    }
    out.push({ points, fill });
  }
  return out;
}

/**
 * Deterministic value noise in `[0, 1)`. A hash rather than `Math.random` so a beam's shape depends
 * only on its station index and seed — the same frame re-drawn twice is identical, which is what
 * stops the bolt fizzing between frames instead of crackling at the rate it was authored to.
 */
function noise(i: number, seed: number): number {
  // Both inputs are mixed SEPARATELY and then finalised, and that structure is the whole point.
  //
  // The first cut was `imul(i * A + seed * B, C)` with a single `h ^= h >>> 15` after it, and it
  // was not a hash: multiplication is linear, so changing `seed` by a fixed step changed the result
  // by a fixed amount — the SAME amount for every `i`, since `i` never interacted with `seed`. One
  // xor-shift is nowhere near enough avalanche to hide that. Consecutive rolls therefore differed
  // by a constant −0.0151 at every station, which is a ramp rather than a re-roll: `lance`'s tear
  // slid uniformly instead of crackling, and `afterburner`'s tongues took a full second to move
  // what should have been one roll of the flicker. Both looked "animated but slow" rather than
  // broken, which is why it survived being authored twice.
  //
  // Two multiplies with different constants, an xor between them, and a two-round xorshift-multiply
  // finaliser: every input bit reaches every output bit, so `seed + 1` is unrelated to `seed`.
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = (h ^ Math.imul(seed ^ 0xc2b2ae35, 0x27d4eb2f)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x3193f2b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * A sampler of `noise` that re-rolls `hz` times a second and FLOWS between one roll and the next.
 * Call it as `wave(i, offset)`; `i` is the station or tongue index and `offset` separates one use
 * from another within the same layer.
 *
 * The interpolation is the whole point, and stepping straight to `floor(t * hz)` was a real bug
 * rather than a rough edge: it made the shape piecewise-constant, so at 14 Hz the envelope sat
 * still for ~4 rendered frames and then moved 12 units in one. On a stationary beam that is a
 * twitch; on a sweeping one it lands on every fourth frame of a smooth rotation, and the whole beam
 * reads as snapping rather than sweeping. Blending between consecutive rolls makes every vertex's
 * motion continuous, which is what the eye is actually reading — `combat-visual.test.ts` pins the
 * per-frame movement that proves it. Smoothstep rather than linear, so there is no velocity
 * discontinuity at a roll boundary either: linear blending is continuous in position but visibly
 * kinks at each handover.
 *
 * `hz` of 0 freezes it on roll 0, which is the frozen frame a style authoring no rate asks for.
 */
function flowingNoise(
  nowMs: number,
  hz: number,
  index: number,
): (i: number, offset: number) => number {
  const phase = (Math.max(0, nowMs) / 1000) * Math.max(0, hz);
  const roll = Math.floor(phase);
  const u = phase - roll;
  const blend = u * u * (3 - 2 * u);
  const seedA = index * 7919 + roll * 104729;
  const seedB = index * 7919 + (roll + 1) * 104729;
  return (i, offset) => {
    const a = noise(i, seedA + offset);
    return a + (noise(i, seedB + offset) - a) * blend;
  };
}

/** Stations down a crackling rect beam. 200 is one station every 6 units at `lance`'s 1200 reach. */
const BOLT_STATIONS = 200;

/** Vertices spent on a rect beam's rounded origin cap. */
const DOME_SEGMENTS = 14;

/**
 * A rect beam's layer.
 *
 * Two shapes live here. With no `crackle`, no `wander` and no `domeScale` this is the plain nested
 * bar every rect beam drew before `lance` became a bolt — tongues are ignored, because cutting
 * lobes into a rect's far edge would only shorten a shape whose whole read is "a straight line of
 * light", and `lance` narrows with `crossScale` instead.
 *
 * With them, it is a lightning bolt: edges that tear, a centreline that drifts, and a rounded cap
 * on the origin. **Containment is inherited, not re-checked.** The jag is subtracted from the
 * layer's half-width and the wander is bounded by what the jag gives back, so a crackling edge is
 * always inside the clean one; the dome is carved out of the beam's own length rather than added
 * behind the muzzle. Every vertex is still clamped at the end, because that costs nothing and makes
 * the guarantee true by construction rather than by argument.
 */
function rectPoints(
  width: number,
  x: number,
  y: number,
  heading: number,
  extent: number,
  layer: BeamLayer,
  style: BeamStyle,
  nowMs: number,
  index: number,
): { x: number; y: number }[] {
  const reach = Math.max(0, extent) * clamp01(layer.extentScale);
  const halfWidth = width / 2;
  const half = halfWidth * clamp01(layer.crossScale);
  if (reach <= 0 || half <= 0) return [];

  const crackle = clamp01(layer.crackle ?? 0);
  const wander = clamp01(layer.wander ?? 0);
  const dome = Math.max(0, style.domeScale ?? 0) * halfWidth * clamp01(layer.crossScale);
  // The dome is carved out of the beam, so the shaft cannot start past the beam's own end.
  const start = Math.min(dome, reach);

  /** Clamp into the rect. Cheap, and it makes containment structural rather than an argument. */
  const put = (along: number, across: number): { x: number; y: number } =>
    rotateBy(
      x,
      y,
      heading,
      Math.max(0, Math.min(reach, along)),
      Math.max(-half, Math.min(half, across)),
    );

  if (crackle <= 0 && wander <= 0 && dome <= 0) {
    return [put(0, -half), put(reach, -half), put(reach, half), put(0, half)];
  }

  // Re-rolls `crackleHz` times a second, interpolated between one roll and the next — the layer's
  // own rate when it sets one, else the style's. See `BeamLayer.crackleHz` for why a single rate
  // across layers cannot work: the cost of a rate is set by how wide the layer tears.
  const wave = flowingNoise(nowMs, layer.crackleHz ?? style.crackleHz ?? 0, index);

  const near: { x: number; y: number }[] = [];
  const far: { x: number; y: number }[] = [];
  for (let i = 0; i <= BOLT_STATIONS; i++) {
    const t = i / BOLT_STATIONS;
    const along = start + (reach - start) * t;
    // Station 0 keeps the layer's nominal width so the shaft meets the dome exactly, with no notch.
    const tear = i === 0 ? 0 : crackle * wave(i, 0) * (0.25 + 0.75 * wave(i >> 2, 555));
    const h = half * (1 - tear);
    // Bounded by the width the tear just freed, so drifting can never push an edge past `half`.
    const drift = i === 0 ? 0 : (wave(i, 31) - 0.5) * 2 * wander * (half - h);
    near.push(put(along, drift - h));
    far.push(put(along, drift + h));
  }

  const points = [...near, ...far.reverse()];
  if (dome <= 0) return points;
  // Close the far edge back to the near edge around a rounded cap, apex at `start - dome`. Its
  // flanks land on +/-half at `start`, which is exactly where station 0 sits.
  for (let i = 1; i < DOME_SEGMENTS; i++) {
    const th = Math.PI / 2 - (Math.PI * i) / DOME_SEGMENTS;
    points.push(put(start - dome * Math.cos(th), half * Math.sin(th)));
  }
  return points;
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
  const def = drawDefOf(instance);
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
      beamGrownExtent(instance, elapsedMs),
    );
  }
  const at = extrapolateShot(instance.x, instance.y, instance.angle, def.speed, elapsedMs);
  return projectileShapeAt(def.hitbox, at.x, at.y, instance.angle);
}

/**
 * How long a beam takes to fade out, and the whole of the fade rule (D8).
 *
 * One number for every beam in the roster (`afterburner` and `lance` today): what already varies
 * between them is their lifetime, and nothing has yet asked for two beams to cut off at different
 * speeds — so this is a constant rather than a per-weapon column, and it becomes a table the day
 * one is needed, the way `WEAPON_BEAM_STYLES` did.
 *
 * It is the fade WINDOW, anchored to the death tick, not to the start of linger. The window used to
 * be the entire lifetime, which made `bulwark` (retired O17) a ghost for 2875 ms while it was still
 * dealing full damage — a zone lying about where it is safe to stand. Now the beam holds full
 * opacity until the last `BEAM_FADE_OUT_MS` and then snaps off.
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
 *
 * `isExplosion` defaults to `false` so every existing caller keeps resolving the shell's own
 * `WeaponTicks`. Pass it `true` for a burst: `weaponTicksOf(weaponId)` resolves by the SHELL's id
 * either way (a burst carries its parent's `weaponId`), and the shell's own `ticks.lifetime` is 0
 * because the shell itself is a projectile row — so without this flag a burst's `lifetime <= 0`
 * check would trip on the wrong table and the burst would never fade, only snap off. `isExplosion`
 * routes the death-tick and fade-window math through `ticks.explosion` instead, the same table
 * `instanceExpired` uses for a burst's own expiry.
 */
export function beamFadeAlpha(
  kind: number,
  weaponId: string,
  spawnTick: number,
  tick: number,
  isExplosion = false,
): number {
  if (kind !== WeaponKind.BEAM || !isWeaponId(weaponId)) return 1;
  const ticks = weaponTicksOf(weaponId);
  const burst = isExplosion ? ticks.explosion : null;
  const flight = burst ? burst.flight : ticks.flight;
  const lifetime = burst ? burst.lifetime : ticks.lifetime;
  if (lifetime <= 0) return 1;

  // The same boundary `instanceExpired` uses (`tick - spawnTick >= flight + lifetime`), so the
  // alpha reaches 0 on exactly the tick the sim stops the instance hitting anything.
  const deathTick = spawnTick + flight + lifetime;
  // Clamped to the linger: a window longer than the lifetime would otherwise start the fade while
  // the beam is still growing, which is the one thing the "full opacity until the end" rule exists
  // to prevent.
  const fadeTicks = Math.min(msToTicks(BEAM_FADE_OUT_MS), lifetime);
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
 * `afterburner`'s middle layer, one of `lance`'s three layers, and for `thumper` it is the hull
 * layer the cream band sits on. Anything showing a player or an author "the shot colour" — the
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
 * Is this instance drawn as an AURA — a ring around a car — rather than as a solid shape?
 *
 * An aura is the one instance in the game whose hitbox is too big to fill in. Every other shot is
 * drawn *as* its hitbox (D19), which works because a shot is small; a 60-unit disc filled opaquely
 * would hide the cars inside it, including the one being stunned, so the rule has to bend to keep
 * its own purpose. It bends as little as possible: the ring sits exactly ON the hitbox edge and the
 * wash inside it is the same colour, so what you see is still precisely what will hit you.
 *
 * Takes the INSTANCE, not a bare `weaponId`: a magmablast burst carries the shell's `weaponId` and
 * only its own hitbox is a disc, so the answer depends on `isExplosion` too, and `drawDefOf` is what
 * resolves that.
 */
export function isAuraInstance(instance: DrawableInstance): boolean {
  const def = drawDefOf(instance);
  return def?.kind === "beam" && def.hitbox.shape === "disc";
}

/** The aura ring's stroke width, in world units. */
export const AURA_RING_WIDTH = 3;
/** Alpha on the aura's own colour for the wash inside the ring. Low enough to read through. */
export const AURA_FILL_ALPHA = 0.14;
