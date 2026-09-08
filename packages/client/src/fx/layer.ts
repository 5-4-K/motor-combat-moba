import { CAR_TABLE, DEFAULT_CAR_ID, isCarId, speedOf } from "@motor-combat-moba/shared";
import Phaser from "phaser";
import { carSpriteKey } from "../assets/asset-keys.js";
import {
  decalFadeAlpha,
  decalStampsFor,
  MAX_DECALS,
  tyreMarkSteps,
  tyreMarksFor,
} from "./decals.js";
import { AIR_FX_DEPTH, DECAL_DEPTH, GROUND_FX_DEPTH, SMOKE_DEPTH } from "./depths.js";
import { deriveFxEvents, type FxEvent, type FxWorldView } from "./events.js";
import { emitterSpecsForAll, type EmitterSpec } from "./emitters.js";
import {
  ERASER_HALO,
  ERASER_STAMP_HEIGHT,
  ERASER_STAMP_WIDTH,
  eraserStampsFor,
} from "./occlusion.js";
import { weaponFxOf, type FxChannel } from "./table.js";
import { fxResolverFor, type WeaponFxResolver } from "./tuning.js";
import {
  asphaltTexture,
  DUST_A,
  DUST_B,
  fireTexture,
  puffTexture,
  scorchTexture,
  SOOT_A,
  SOOT_B,
  sparkTexture,
  type TexturePixels,
} from "./textures.js";

/** Phaser texture keys for the generated set. Namespaced so nothing collides with the manifest. */
export const FX_TEXTURE_KEYS = {
  dustA: "fx.dust.a",
  dustB: "fx.dust.b",
  sootA: "fx.soot.a",
  sootB: "fx.soot.b",
  fireA: "fx.fire.a",
  fireB: "fx.fire.b",
  spark: "fx.spark",
  scorch: "fx.scorch",
  asphalt: "fx.asphalt",
} as const;

/**
 * A chassis silhouette stamp's WIDTH in pixels. Its height follows `ERASER_STAMP_HEIGHT`.
 *
 * A resolution knob and nothing else: how big the hole is, is `ERASER_HALO`'s decision alone.
 */
const ERASER_TEXTURE_PX = 128;

/**
 * The decal budget, split by class so one can never starve the other out of the ring buffer.
 *
 * Rubber is produced at two marks per `TYRE_MARK_SPACING` of travel — 119/s for a car at top
 * speed, and past 700/s with a full room skidding. Sharing one FIFO with scorch meant the buffer
 * turned over in seconds under load, so a `magmablast` scorch was evicted before its half-life
 * and `decals.ts`'s promise that "a fight leaves a readable history" was unreachable in exactly the
 * fights worth reading. The two caps sum to `MAX_DECALS`, which is still the bound on the per-frame
 * redraw cost — the split changes who spends the budget, never how large it is.
 */
const MAX_SCORCH_DECALS = 120;
const MAX_TYRE_DECALS = MAX_DECALS - MAX_SCORCH_DECALS;

/**
 * The blurred silhouette key for a chassis.
 *
 * Falls back to `DEFAULT_CAR_ID` for an id off the roster, the same fallback `carSpriteKey` and
 * `carShapeOf` take — a stale or hostile id should punch the default chassis's hole rather than
 * leave the car buried in its own smoke.
 */
function eraserKeyOf(carId: string): string {
  return `fx.eraser.${isCarId(carId) ? carId : DEFAULT_CAR_ID}`;
}

/**
 * What `toggleChannel` can switch off: the four particle channels, plus the two passes that are not
 * particle channels at all but are the other half of what a person judging the look has to be able
 * to isolate.
 */
export type FxToggle = FxChannel | "decals" | "mask";

/** One decal, alive until it fades out or is pushed out of the ring buffer. */
interface LiveDecal {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly baseAlpha: number;
  readonly rotation: number;
  readonly tint: number;
  bornAtMs: number;
}

/**
 * The Phaser half of the FX system, and the only part of `fx/` that touches the renderer.
 *
 * What to spawn, where, how big and for how long are answered by the pure modules beside it,
 * which are unit-tested in vitest's node environment. This file is the Phaser wiring, kept thin
 * enough to review by eye because no test can load it.
 *
 * It is not decision-free, and pretending otherwise has misled people: it holds a small set of
 * RENDER-ONLY constants — the 120/480 decal split, the 0.25 launch-speed floor, the
 * `growPerSec` integration and its clamp, "a burst always fades to zero", the channel-to-texture
 * map, the tyre tint, the per-stamp scorch rotation, the 7px eraser blur and `ERASER_TEXTURE_PX`.
 * The line to hold is that anything deciding WHAT HAPPENS — when a mark goes down, how far a
 * puff travels, which event produces which burst — belongs in a pure module, and anything
 * deciding only HOW IT IS DRAWN may live here.
 */
export class FxLayer {
  private readonly scene: Phaser.Scene;
  private prevView: FxWorldView | undefined;
  /**
   * One emitter per channel, each with its blend mode set ONCE here.
   *
   * `packages/client/CLAUDE.md`: *"Stop and warn before a per-instance `setBlendMode` (flushes the
   * batch — one draw call becomes one per shot)."* Grouping by channel is what keeps this to four
   * batches however many particles are alive.
   */
  private readonly emitters: Record<FxChannel, Phaser.GameObjects.Particles.ParticleEmitter>;
  /**
   * Each generated texture's edge length in pixels, by key.
   *
   * `FxBurst.size` is a diameter in WORLD units, so turning it into a particle scale needs the
   * source texture's own size — the set is not uniform (puffs and fire are 128, a spark is 32), and
   * dividing everything by one constant shrinks every spark and every piece of debris to about one
   * pixel.
   */
  private readonly texelSize = new Map<string, number>();
  /** Rubber and scorch, redrawn from the two buffers below every frame. See `redrawDecals`. */
  private readonly decals: Phaser.GameObjects.RenderTexture;
  /** Every smoke particle, redrawn and re-masked every frame. See `maskSmoke`. */
  private readonly smoke: Phaser.GameObjects.RenderTexture;
  /** One reusable image, moved and re-erased per car. See `maskSmoke`. */
  private readonly eraser: Phaser.GameObjects.Image;
  /** Blast and death marks. Its own buffer, so 240 tyre marks a second cannot evict it. */
  private scorchDecals: LiveDecal[] = [];
  /** Rubber. Its own buffer, and the one that actually turns over during a fight. */
  private tyreDecals: LiveDecal[] = [];
  private clockMs = 0;
  /**
   * Where each car was last frame, and how far past its last mark it got, so rubber is spaced by
   * distance travelled rather than by a clock. See `layTyreMarks`.
   */
  private readonly tyreTrails = new Map<string, { x: number; y: number; carry: number }>();
  /** The events this layer derived on the last `update`, for `ArenaScene`'s camera work below. */
  private frameEvents: FxEvent[] = [];
  /**
   * Channels switched off by `toggleChannel`. Empty in a match — nothing but `?dev=fx` writes it,
   * and the three reads below all cost one `Set.has` on an empty set.
   */
  private readonly disabled = new Set<FxToggle>();
  /**
   * Bursts spawned per channel, which is what `textureFor` alternates the A/B variants off.
   * Counting per channel rather than globally — see the note there.
   */
  private readonly burstsSpawned: Record<FxChannel, number> = {
    smoke: 0,
    fire: 0,
    spark: 0,
    debris: 0,
  };
  /**
   * How this layer turns a weapon id into a row (spec PG46).
   *
   * Defaults to the shipped table, and every shipped scene leaves it at that default. Only the
   * playground passes one, which is what confines VFX overrides to that room by construction rather
   * than by discipline.
   */
  private readonly resolveFx: WeaponFxResolver;

  constructor(
    scene: Phaser.Scene,
    seed: number,
    arenaWidth: number,
    arenaHeight: number,
    resolveFx: WeaponFxResolver = weaponFxOf,
  ) {
    this.scene = scene;
    this.resolveFx = resolveFx;
    this.uploadTextures(seed);

    const emitter = (
      key: string,
      depth: number,
      blend: Phaser.BlendModes,
    ): Phaser.GameObjects.Particles.ParticleEmitter =>
      scene.add.particles(0, 0, key, { emitting: false }).setDepth(depth).setBlendMode(blend);

    this.emitters = {
      smoke: emitter(FX_TEXTURE_KEYS.dustA, AIR_FX_DEPTH, Phaser.BlendModes.NORMAL),
      fire: emitter(FX_TEXTURE_KEYS.fireA, AIR_FX_DEPTH, Phaser.BlendModes.ADD),
      spark: emitter(FX_TEXTURE_KEYS.spark, GROUND_FX_DEPTH, Phaser.BlendModes.ADD),
      debris: emitter(FX_TEXTURE_KEYS.spark, GROUND_FX_DEPTH, Phaser.BlendModes.NORMAL),
    };

    // Origin (0, 0) at world (0, 0): arena world space starts at the origin, so a stamp's world
    // coordinates are its texture-local coordinates too and no conversion is needed anywhere.
    this.decals = scene.add
      .renderTexture(0, 0, arenaWidth, arenaHeight)
      .setOrigin(0, 0)
      .setDepth(DECAL_DEPTH);
    // 'render' mode: the texture displays itself, and `render()` is called by hand once the frame's
    // stamps are queued. Deliberately NOT `setRenderMode(mode, preserve)` — `preserve` keeps the
    // COMMAND BUFFER so the same commands repeat, which is not how pixels accumulate and is not
    // what this layer wants.
    this.decals.setRenderMode("render");

    this.smoke = scene.add
      .renderTexture(0, 0, arenaWidth, arenaHeight)
      .setOrigin(0, 0)
      // Its OWN depth, one rung below the emitters. See `SMOKE_DEPTH` — tying it to AIR_FX_DEPTH
      // leaves fire-over-smoke decided by which of these two constructor blocks runs last.
      .setDepth(SMOKE_DEPTH);
    this.smoke.setRenderMode("render");
    // The smoke emitter draws into `this.smoke`, never straight to the scene, so `maskSmoke` has
    // something to erase from. Invisible for that reason — and `draw` is handed an ARRAY, which
    // renders it anyway.
    this.emitters.smoke.setVisible(false);

    // Exists only to be handed to `RenderTexture.erase`, so it is invisible. It is still a display
    // object on the scene's list, so `displayObjects()` keeps it too — see the note there.
    this.eraser = scene.add.image(0, 0, FX_TEXTURE_KEYS.spark).setVisible(false);

    this.buildEraserTextures();
  }

  /**
   * Rebuild every chassis silhouette, now that the art has actually loaded.
   *
   * `buildEraserTextures` reads `textures.exists` at the instant it runs, and art loads
   * asynchronously (`BootScene`, `loadArt`) — so on a cold cache or a slow client the constructor's
   * pass sees no car sprites at all and every chassis takes the hull-rectangle fallback for the
   * whole match, silently. `ArenaScene` already re-runs its car visuals from the `assetsReady()`
   * handler for exactly this race; this rides beside it.
   */
  rebuildEraserTextures(): void {
    this.buildEraserTextures();
  }

  /**
   * A soft, solid stamp of each chassis's silhouette, built once per art load.
   *
   * Derived from the car sprite's own ALPHA channel, so it needs no new art and is automatically
   * right for any chassis added later — the roster itself is the loop, not a hand-written list.
   * Blurred here rather than per frame because it is static: blurring it every frame was pure waste
   * in the spike (VFX21).
   *
   * The texture is sized to the STAMP's aspect rather than square, and the sprite is CONTAINED
   * inside it rather than stretched to fill. Both halves matter, and getting either wrong produces
   * the same symptom: `maskSmoke` displays this at exactly `ERASER_STAMP_WIDTH` x
   * `ERASER_STAMP_HEIGHT` (76 x 60), so a square texture there is a non-uniform scale, and a 96x51
   * sprite squashed into a square is already a 1.9x distortion before that. Together they turned
   * every chassis — bastion's hex, bullseye's ellipse — into the same oversized round blob, which
   * is precisely the promise this whole method makes and was not keeping.
   */
  private buildEraserTextures(): void {
    // Pixels per world unit. Everything below is in world units scaled by this, so the texture and
    // the display box are the same shape and the scale that lands them on screen is uniform.
    const ppu = ERASER_TEXTURE_PX / ERASER_STAMP_WIDTH;
    const texWidth = ERASER_TEXTURE_PX;
    const texHeight = Math.round(ERASER_STAMP_HEIGHT * ppu);
    // The hull box, centred, with the halo as its margin — in the same world units `ERASER_HALO` is
    // written in, which is what makes that constant's doc comment true.
    const inset = ERASER_HALO * ppu;
    const hullWidth = texWidth - inset * 2;
    const hullHeight = texHeight - inset * 2;

    for (const carId of Object.keys(CAR_TABLE)) {
      const key = eraserKeyOf(carId);
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      const spriteKey = carSpriteKey(carId);
      const source = this.scene.textures.exists(spriteKey)
        ? this.scene.textures.get(spriteKey).getSourceImage()
        : undefined;
      const canvasTexture = this.scene.textures.createCanvas(key, texWidth, texHeight);
      if (!canvasTexture) continue;
      const ctx = canvasTexture.getContext();
      ctx.clearRect(0, 0, texWidth, texHeight);
      // A generous blur: the hole has to read as the car displacing the cloud, not as its outline
      // traced in smoke. It softens the edge INSIDE the halo, never past it — the margin above is
      // several times the blur radius.
      ctx.filter = "blur(7px)";
      if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
        // CONTAIN, the same fit `assets/sprite-fit.ts` gives the car itself, so the silhouette is
        // the shape of the car the player is looking at rather than a shape of its own.
        const fit = Math.min(hullWidth / source.width, hullHeight / source.height);
        const drawWidth = source.width * fit;
        const drawHeight = source.height * fit;
        ctx.drawImage(
          source,
          (texWidth - drawWidth) / 2,
          (texHeight - drawHeight) / 2,
          drawWidth,
          drawHeight,
        );
        // Filter off BEFORE the fill: the blur belongs to the silhouette that is already on the
        // canvas, and `source-in` only needs a flat white to take that alpha.
        ctx.filter = "none";
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, texWidth, texHeight);
      } else {
        // No sprite for this chassis: fall back to the hull rectangle, the same fallback `drawCar`
        // takes when a manifest entry is missing. Blurred, so it still reads as a soft hole.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(inset, inset, hullWidth, hullHeight);
      }
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      canvasTexture.refresh();
    }
  }

  /** Turn generated pixel data into Phaser textures. The one place `fx/` needs a DOM canvas. */
  private uploadTextures(seed: number): void {
    const add = (key: string, tex: TexturePixels): void => {
      // Removed first rather than reused: a scene restart re-runs this with a fresh seed, and
      // `createCanvas` on a key that already exists returns null instead of replacing it.
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      const canvasTexture = this.scene.textures.createCanvas(key, tex.width, tex.height);
      if (!canvasTexture) return;
      const ctx = canvasTexture.getContext();
      const image = ctx.createImageData(tex.width, tex.height);
      image.data.set(tex.data);
      ctx.putImageData(image, 0, 0);
      canvasTexture.refresh();
      this.texelSize.set(key, tex.width);
    };

    add(FX_TEXTURE_KEYS.dustA, puffTexture(seed, DUST_A));
    add(FX_TEXTURE_KEYS.dustB, puffTexture(seed + 404, DUST_B));
    add(FX_TEXTURE_KEYS.sootA, puffTexture(seed + 808, SOOT_A));
    add(FX_TEXTURE_KEYS.sootB, puffTexture(seed + 912, SOOT_B));
    add(FX_TEXTURE_KEYS.fireA, fireTexture(seed));
    add(FX_TEXTURE_KEYS.fireB, fireTexture(seed + 77));
    add(FX_TEXTURE_KEYS.spark, sparkTexture());
    add(FX_TEXTURE_KEYS.scorch, scorchTexture(seed));
    add(FX_TEXTURE_KEYS.asphalt, asphaltTexture(seed));
  }

  /**
   * Every object this layer puts in the scene.
   *
   * One accessor rather than one registration per emitter, because `splitCameras` requires every
   * display object to be ignored by exactly one camera — ignored by neither and it draws twice,
   * ignored by both and it vanishes (VFX25). One list is one place to get that right.
   *
   * The invisible pair — the smoke emitter and `eraser` — are listed too. Neither draws to the
   * scene today, so neither could double across the gutter; but the invariant is about display
   * objects, and both are on the scene's display list. Leaning on `visible === false` instead of
   * registering them is the exact fragility VFX25 warns about: flipping one visible to debug it
   * would silently reintroduce the double-draw.
   */
  displayObjects(): Phaser.GameObjects.GameObject[] {
    return [...Object.values(this.emitters), this.decals, this.smoke, this.eraser];
  }

  /**
   * Which generated texture a burst on this channel draws with, alternating the A and B variants
   * so successive bursts are not the same shape (VFX6).
   *
   * Per BURST, not per particle, and that is a constraint rather than a preference: there is one
   * emitter per channel and the texture is set on the emitter, so a single `emitParticleAt` call
   * cannot mix two. Phaser assigns a particle its frame at emit time (`Particle.fire` reads
   * `emitter.getFrame()`), so a later switch leaves particles already in flight alone — which is
   * what makes alternating between bursts show up at all rather than repainting the whole cloud.
   * What it buys is that a detonation's several bursts, and one shot's flash against the next,
   * are drawn from different noise; two puffs WITHIN one burst still share a silhouette.
   *
   * `variant` is a per-channel counter, not a global one: a death emits fire, smoke, spark and
   * debris together, so one shared counter would advance by four per death and hand every death
   * the same parity. Deterministic rather than `Math.random()` for the reason every other roll in
   * `fx/` is — a look that differs run to run cannot be judged in `?dev=fx`.
   */
  private textureFor(spec: EmitterSpec, variant: number): string {
    const useB = variant % 2 === 1;
    switch (spec.channel) {
      case "smoke":
        return spec.burst.soot
          ? useB
            ? FX_TEXTURE_KEYS.sootB
            : FX_TEXTURE_KEYS.sootA
          : useB
            ? FX_TEXTURE_KEYS.dustB
            : FX_TEXTURE_KEYS.dustA;
      case "fire":
        return useB ? FX_TEXTURE_KEYS.fireB : FX_TEXTURE_KEYS.fireA;
      // One texture each, and no second variant generated for them: a spark is noise-free by
      // design (`sparkTexture`), so a B would be the identical image.
      case "spark":
      case "debris":
        return FX_TEXTURE_KEYS.spark;
    }
  }

  /**
   * Turn one channel on or off, and report whether it is now enabled. **Dev-tool only — nothing in
   * a match calls this**, and the set it writes is empty for the whole of every match.
   *
   * `"decals"` and `"mask"` are here alongside the four particle channels because the question
   * VFX33 leaves open — is a six-car fight's screen tiring to look at? — is partly a question about
   * how much each pass is contributing, and the only way to answer that for a pass is to switch it
   * off and compare. For the mask in particular that comparison is the *evidence* VFX18 is earning
   * its place: with it off, a car inside a smoke column disappears.
   */
  toggleChannel(channel: FxToggle): boolean {
    if (this.disabled.delete(channel)) return true;
    this.disabled.add(channel);
    return false;
  }

  /** Whether a channel is currently drawing. Read by `?dev=fx` to label its own toggles. */
  isChannelEnabled(channel: FxToggle): boolean {
    return !this.disabled.has(channel);
  }

  /** Fire one frame's worth of bursts. */
  spawn(specs: readonly EmitterSpec[]): void {
    for (const spec of specs) {
      // Prospective only: particles already in flight live out their lifespan. `maskSmoke` is where
      // switching smoke off takes effect immediately, because it is the one channel that draws
      // through a RenderTexture this layer redraws every frame.
      if (this.disabled.has(spec.channel)) continue;
      const emitter = this.emitters[spec.channel];
      if (!emitter) continue;
      const { burst } = spec;

      const variant = (this.burstsSpawned[spec.channel] += 1);
      const key = this.textureFor(spec, variant);
      // Guarded because `setTexture` re-resolves through the texture manager. Smoke and fire both
      // switch now — dust/soot and the A/B variants above; spark and debris are set once at birth
      // and never move off this line.
      if (emitter.texture.key !== key) emitter.setTexture(key);
      const texels = this.texelSize.get(key) ?? burst.size;

      const endSize = Math.max(0, burst.size + (burst.growPerSec * burst.lifeMs) / 1000);
      // `setConfig` rather than the individual `setParticle*` setters: those route through
      // `EmitterOp.onChange`, which only nudges a value inside the op's EXISTING method, so handing
      // one a `{ min, max }` or `{ start, end }` object silently produces a broken op. `setConfig`
      // goes through `loadConfig`, which re-derives the method — and it leaves `blendMode`, `depth`
      // and `emitting` alone, because it only writes the fast-map keys a config actually names.
      emitter.setConfig({
        lifespan: burst.lifeMs,
        speed: { min: burst.speed * 0.25, max: burst.speed },
        angle: {
          min: Phaser.Math.RadToDeg(spec.angle - burst.coneRad / 2),
          max: Phaser.Math.RadToDeg(spec.angle + burst.coneRad / 2),
        },
        scale: { start: burst.size / texels, end: endSize / texels },
        alpha: { start: burst.alpha, end: 0 },
      });
      emitter.emitParticleAt(spec.x, spec.y, burst.count);
    }
  }

  /** The events this layer derived on the last `update`. Read by `ArenaScene` for camera work. */
  lastEvents(): readonly FxEvent[] {
    return this.frameEvents;
  }

  /** One frame: derive events from the view delta, spawn what they ask for, and lay decals. */
  update(view: FxWorldView, dtMs: number): void {
    this.clockMs += dtMs;
    const events = deriveFxEvents(this.prevView, view);
    this.frameEvents = events;
    this.spawn(emitterSpecsForAll(events, this.resolveFx));

    for (const event of events) {
      for (const stamp of decalStampsFor(event)) {
        this.pushDecal(this.scorchDecals, MAX_SCORCH_DECALS, {
          key: FX_TEXTURE_KEYS.scorch,
          x: stamp.x,
          y: stamp.y,
          scale: stamp.scale,
          baseAlpha: stamp.alpha,
          // Rolled per stamp so two scorches near each other do not read as one stencil reused.
          // Cosmetic only: nothing in `fx/` or the sim ever reads it back.
          rotation: Math.random() * Math.PI * 2,
          tint: 0xffffff,
          bornAtMs: this.clockMs,
        });
      }
    }

    this.layTyreMarks(view);
    this.redrawDecals();
    this.maskSmoke(view);
    this.prevView = view;
  }

  /**
   * Draw the smoke, then punch a soft hole around every living car (VFX18–VFX22).
   *
   * Smoke must never hide a car: losing sight of an opponent to your own weapon effect costs
   * information the player needs, and gets reported as a bug rather than admired as atmosphere.
   * Only smoke is masked — fire and sparks are additive and live a few hundred milliseconds, so
   * they brighten a car rather than hiding it and a mask on them would buy nothing.
   */
  private maskSmoke(view: FxWorldView): void {
    this.smoke.clear();
    // `?dev=fx` only: an empty smoke texture, so switching the channel off clears the cloud already
    // on screen instead of waiting out a 3-second lifespan. The emitter keeps ticking its live
    // particles; they simply have nowhere to land while this is off.
    if (this.disabled.has("smoke")) {
      this.smoke.render();
      return;
    }
    // An ARRAY, which `draw` renders regardless of visibility — the emitter is invisible precisely
    // so it does not also draw straight to the scene. Passing it bare would depend on its `visible`
    // flag and render nothing.
    this.smoke.draw([this.emitters.smoke]);

    // The mask is the one pass with its own switch (`?dev=fx` only): drawing the smoke and skipping
    // the erase is exactly the "before" half of VFX18's before/after, and it must leave the smoke
    // itself untouched or the comparison shows nothing.
    if (!this.disabled.has("mask")) {
      for (const stamp of eraserStampsFor(view.cars)) {
        const key = eraserKeyOf(stamp.carId);
        if (!this.scene.textures.exists(key)) continue;
        // One reusable image, moved and re-erased per car. Creating a Game Object per car per frame
        // would allocate six objects a frame for the life of the match.
        this.eraser
          .setTexture(key)
          // The stamp's own size, with NO multiplier: `EraserStamp.width`/`height` are the final
          // world size of the hole and `ERASER_HALO` is the one number that decides it. A pair of
          // fudge factors lived here and made that constant's doc comment false — untestably, since
          // this file has no test.
          .setDisplaySize(stamp.width, stamp.height)
          .setRotation(stamp.angle)
          .setPosition(stamp.x, stamp.y);
        this.smoke.erase([this.eraser]);
      }
    }

    // Buffered until here, same as the decal layer.
    this.smoke.render();
  }

  /**
   * Add a decal to ONE class's buffer, dropping that class's oldest once it is full.
   *
   * The buffer is a parameter rather than a field because the two classes must not share a cap —
   * see `MAX_SCORCH_DECALS`. Oldest-first eviction within each class is unchanged.
   */
  private pushDecal(buffer: LiveDecal[], cap: number, decal: LiveDecal): void {
    buffer.push(decal);
    if (buffer.length > cap) buffer.splice(0, buffer.length - cap);
  }

  /**
   * Rubber under every moving car, spaced by DISTANCE TRAVELLED rather than by elapsed time.
   *
   * `decals.ts`'s `tyreMarkSteps` holds the rule and the reasoning; this half is the bookkeeping it
   * needs — the car's pose last frame and the fraction of a spacing left over from it. A frame may
   * lay several stampings, interpolated along the segment, which is what makes the trail one shape
   * per unit of road at any frame rate.
   */
  private layTyreMarks(view: FxWorldView): void {
    const key = FX_TEXTURE_KEYS.spark;
    // The spark texture's OWN edge length, for the same reason `spawn` looks it up rather than
    // dividing by a constant: the generated set is not one size.
    const texels = this.texelSize.get(key) ?? 32;
    for (const car of view.cars) {
      // A wreck drops its trail entirely rather than keeping a stale anchor: a respawn elsewhere
      // would otherwise arrive as one enormous segment, and `TYRE_MARK_MAX_STEP` should not be the
      // only thing standing between a respawn and a rubber line drawn across the arena.
      if (!car.alive) {
        this.tyreTrails.delete(car.sessionId);
        continue;
      }
      const previous = this.tyreTrails.get(car.sessionId);
      if (!previous) {
        this.tyreTrails.set(car.sessionId, { x: car.x, y: car.y, carry: 0 });
        continue;
      }
      const dx = car.x - previous.x;
      const dy = car.y - previous.y;
      const { fractions, carry } = tyreMarkSteps(previous.carry, Math.hypot(dx, dy));
      this.tyreTrails.set(car.sessionId, { x: car.x, y: car.y, carry });
      if (fractions.length === 0) continue;
      // Shared's `speedOf` on the networked world velocity, never a pose delta: `sim/velocity.ts`
      // is the only place the world-frame conversion may be written, and a delta would also misread
      // a remote car while it is being interpolated. The pose delta above decides HOW MANY marks;
      // this decides whether the car is skidding hard enough to leave any.
      const speed = speedOf(car.vx, car.vy);
      for (const fraction of fractions) {
        const marks = tyreMarksFor(
          { x: previous.x + dx * fraction, y: previous.y + dy * fraction, angle: car.angle },
          speed,
        );
        for (const mark of marks) {
          this.pushDecal(this.tyreDecals, MAX_TYRE_DECALS, {
            key,
            x: mark.x,
            y: mark.y,
            scale: (mark.radius * 2) / texels,
            baseAlpha: mark.alpha,
            rotation: 0,
            tint: 0x141210,
            bornAtMs: this.clockMs,
          });
        }
      }
    }
    // A car that left keeps no anchor, or the map grows for the life of the room.
    const present = new Set(view.cars.map((c) => c.sessionId));
    for (const id of [...this.tyreTrails.keys()]) if (!present.has(id)) this.tyreTrails.delete(id);
  }

  /**
   * Redraw the whole decal layer from the buffer.
   *
   * `clear()` then stamp then `render()`, every call deliberate. The layer is NOT faded in place,
   * because Phaser 4's `erase()` takes no alpha and cannot express a partial fade; redrawing also
   * makes the curve exact rather than an accumulation of per-frame rounding, and bounds the cost by
   * `MAX_DECALS` instead of by match length.
   */
  private redrawDecals(): void {
    this.decals.clear();
    // `?dev=fx` only. Both buffers keep filling and keep their birth stamps, so re-enabling shows
    // the ground as it would have been — anything that aged out while the layer was off is dropped
    // by `stampSurvivors` on the first frame back, because `decalFadeAlpha` reads the same running
    // clock either way.
    if (this.disabled.has("decals")) {
      this.decals.render();
      return;
    }
    // Scorch FIRST, so rubber lies over it: a car driving through a blast mark leaves tracks in it,
    // not under it. The draw order is the only thing the two buffers still share.
    this.scorchDecals = this.stampSurvivors(this.scorchDecals);
    this.tyreDecals = this.stampSurvivors(this.tyreDecals);
    // Buffered until this call — without it nothing appears, which is the Phaser 4 change most
    // likely to be missed when porting any Phaser 3 RenderTexture snippet.
    this.decals.render();
  }

  /** Stamp everything in one buffer that still has alpha, and hand back what is worth keeping. */
  private stampSurvivors(buffer: readonly LiveDecal[]): LiveDecal[] {
    const survivors: LiveDecal[] = [];
    for (const decal of buffer) {
      const alpha = decal.baseAlpha * decalFadeAlpha(this.clockMs - decal.bornAtMs);
      if (alpha <= 0) continue;
      survivors.push(decal);
      this.decals.stamp(decal.key, undefined, decal.x, decal.y, {
        alpha,
        tint: decal.tint,
        rotation: decal.rotation,
        scale: decal.scale,
      });
    }
    return survivors;
  }

  destroy(): void {
    for (const emitter of Object.values(this.emitters)) emitter.destroy();
    this.decals.destroy();
    this.smoke.destroy();
    this.eraser.destroy();
  }
}
