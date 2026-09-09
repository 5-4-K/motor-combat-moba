import type { EnvironmentFx } from "../fx/environment.js";

/**
 * The arena's one light, turned into the four things that stop a car reading as a sticker.
 *
 * **Why this exists.** A car was a flat `setTint` on flat asphalt: one uniform colour over the whole
 * body, no shadow of any kind, and no edge separating it from a floor of a similar value. Nothing in
 * the renderer said which way was up, so nothing gave a car volume or sat it on the ground.
 *
 * Everything here derives from `ENVIRONMENT_FX.carLook`, so the whole look is tunable live in the
 * playground rather than being numbers compiled into the scene. Two rules the derivations keep, and
 * that their tests hold them to:
 *
 * - **The light is WORLD-fixed.** Every function below takes the car's rotation and undoes it. Tint
 *   the four corners with fixed constants instead and the highlight spins with the bodywork, which
 *   reads as a car lit by itself; six cars at six headings then look like six separately-lit
 *   stickers rather than one scene.
 * - **Zeroing the strengths restores the old flat drawing exactly.** Every effect is a layer over
 *   what was already drawn, never a replacement for it, so the panel can switch the whole thing off.
 *
 * Nothing here touches Phaser, so it is all unit-tested in the node environment — `ArenaScene` is
 * only the hand that makes the draw calls.
 */

type CarLook = EnvironmentFx["carLook"];

export interface Vec2 {
  x: number;
  y: number;
}

/** The four corner colours Phaser's `setTint(tl, tr, bl, br)` wants, in that order. */
export interface TintCorners {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

/** One nested ring of a soft shadow: how big, and how dark. */
export interface ShadowBand {
  /** Multiplier on the hull's own size. */
  scale: number;
  alpha: number;
}

/** The light's direction as a unit vector: FROM a car TOWARD the light. */
function lightDirOf(look: CarLook): Vec2 {
  const radians = (look.lightAngle * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/** Channel-wise lerp toward white by `t`, then toward black by `s`. Both clamp at the endpoints. */
function shade(rgb: number, lit: number, dark: number): number {
  let out = 0;
  for (let shift = 16; shift >= 0; shift -= 8) {
    const c = (rgb >> shift) & 0xff;
    const brightened = c + (255 - c) * lit;
    const value = Math.round(brightened * (1 - dark));
    out |= Math.min(255, Math.max(0, value)) << shift;
  }
  // `|=` on a value with bit 23 set can yield a negative int32; `>>> 0` puts it back in 0..0xffffff.
  return out >>> 0;
}

/**
 * How lit a local direction is, from -1 (facing straight away from the light) to +1 (straight at it).
 *
 * `rotation` is the car's total world rotation, so the local direction is turned into world space
 * before it meets the light. This one line is what keeps the light world-fixed.
 */
function facing(localX: number, localY: number, rotation: number, light: Vec2): number {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const worldX = localX * cos - localY * sin;
  const worldY = localX * sin + localY * cos;
  const length = Math.hypot(worldX, worldY);
  if (length === 0) return 0;
  return (worldX * light.x + worldY * light.y) / length;
}

/** The player colour, split into four corner colours by which way each corner faces the light. */
export function tintCornersFor(fill: number, rotation: number, look: CarLook): TintCorners {
  const light = lightDirOf(look);
  const corner = (localX: number, localY: number): number => {
    const dot = facing(localX, localY, rotation, light);
    return shade(
      fill,
      dot > 0 ? dot * look.litStrength : 0,
      dot < 0 ? -dot * look.shadeStrength : 0,
    );
  };
  // The corners of the sprite's own quad, in Phaser's order. +y is down, so "top" is -y.
  return {
    topLeft: corner(-1, -1),
    topRight: corner(1, -1),
    bottomLeft: corner(-1, 1),
    bottomRight: corner(1, 1),
  };
}

/**
 * Where a car's drop shadow sits relative to the car, in world units.
 *
 * Away from the light, and deliberately taking NO heading: a shadow that swung round as its car
 * turned would announce that the light is fake. This is the whole reason the offset is applied in
 * world space by the caller rather than as a local offset inside the car's rotated container.
 */
export function shadowOffsetFor(look: CarLook): Vec2 {
  const light = lightDirOf(look);
  return { x: -light.x * look.shadowOffset, y: -light.y * look.shadowOffset };
}

/**
 * The drop shadow as nested rings, widest first so each fill stacks toward the centre.
 *
 * Softness is faked by stacking rather than blurred, because a `Graphics` cannot blur and a blurred
 * texture per car would cost a texture per car. The same technique `instanceGlowBands` already uses
 * for shots.
 *
 * Returns `[]` when the shadow is off, so the caller draws nothing at all rather than a stack of
 * fully transparent fills.
 */
export function shadowBandsFor(look: CarLook): ShadowBand[] {
  const count = Math.max(1, Math.round(look.shadowBands));
  if (look.shadowAlpha <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    // Index 0 is the widest ring; the last sits on the footprint itself, so a single band
    // degenerates to a hard shadow at exactly the footprint's size.
    //
    // **Every band carries the SAME alpha, and that is the whole trick.** They stack, so the centre
    // — covered by all of them — lands near `shadowAlpha`, while the outer edge is covered by one
    // and comes out at a fraction of it. That gradient IS the softness, and the alphas do not need
    // to ramp as well. Ramping them too was the first cut's bug: five bands running up to
    // `shadowAlpha` each accumulated to about 0.75 under the car, and it read as a hole in the road
    // rather than a shadow on it.
    const t = count === 1 ? 1 : i / (count - 1);
    return {
      scale: 1 + look.shadowSpread * (1 - t),
      alpha: look.shadowAlpha / count,
    };
  });
}

/**
 * The tight occlusion directly under the hull — the part that actually sits a car on the floor.
 *
 * One band, not a stack: it is small, dark and hidden under the car, so softening it buys nothing
 * and costs fills. Kept separate from the drop shadow because it does NOT move with the light —
 * contact is contact wherever the sun is.
 */
export function contactBandsFor(look: CarLook): ShadowBand[] {
  if (look.contactAlpha <= 0) return [];
  return [{ scale: look.contactScale, alpha: look.contactAlpha }];
}

/**
 * Where a car's rim-light copy sits relative to the car, in the CAR'S OWN local frame.
 *
 * The rim is a copy of the car's own artwork, tinted and nudged toward the light behind the body, so
 * a lit sliver shows along whatever edge the art actually has. That is the whole reason it is not a
 * stroked outline: the hull is a 48x32 box, the sprites do not fill it, and stroking the box drew a
 * picture frame around the car rather than an edge on it.
 *
 * Local, not world, because the copy lives INSIDE the car's rotated container — so the world offset
 * is turned backwards by the car's own heading here, which is what keeps the lit edge on the same
 * side of the screen while the car spins.
 */
export function rimOffsetFor(rotation: number, look: CarLook): Vec2 {
  const light = lightDirOf(look);
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const x = light.x * look.rimWidth;
  const y = light.y * look.rimWidth;
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * One chassis outline placed in the world: scaled about its own centre, turned to the car's heading,
 * then moved to a centre point.
 *
 * Used for the shadows, which are drawn on a shared layer in WORLD space rather than inside the
 * car's own rotated container — see `CAR_SHADOW_DEPTH` for why they cannot live in the container.
 * That means the rotation the container would have applied for free has to be applied here instead.
 */
export function placeOutline(
  points: readonly Vec2[],
  scale: number,
  rotation: number,
  centreX: number,
  centreY: number,
): Vec2[] {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return points.map((p) => {
    const x = p.x * scale;
    const y = p.y * scale;
    return { x: centreX + (x * cos - y * sin), y: centreY + (x * sin + y * cos) };
  });
}

/** Channel-wise lerp between two packed colours. */
function mixColor(from: number, to: number, t: number): number {
  let out = 0;
  for (let shift = 16; shift >= 0; shift -= 8) {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    out |= Math.min(255, Math.max(0, Math.round(a + (b - a) * t))) << shift;
  }
  return out >>> 0;
}
