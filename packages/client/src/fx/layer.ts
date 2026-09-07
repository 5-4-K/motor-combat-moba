import { CAR_TABLE, DEFAULT_CAR_ID, isCarId, speedOf } from "@motor-combat-moba/shared";
import Phaser from "phaser";
import { carSpriteKey } from "../assets/asset-keys.js";
import {
  decalFadeAlpha,
  decalStampsFor,
  MAX_DECALS,
  TYRE_MARK_INTERVAL_MS,
  tyreMarksFor,
} from "./decals.js";
import { AIR_FX_DEPTH, DECAL_DEPTH, GROUND_FX_DEPTH } from "./depths.js";
import { deriveFxEvents, type FxWorldView } from "./events.js";
import { emitterSpecsForAll, type EmitterSpec } from "./emitters.js";
import { eraserStampsFor } from "./occlusion.js";
import type { FxChannel } from "./table.js";
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

/** Edge length of a chassis silhouette stamp, in pixels. */
const ERASER_TEXTURE_PX = 128;

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
 * It holds **no decisions** — what to spawn, where, how big and for how long are all answered by
 * the pure modules beside it, which are unit-tested in vitest's node environment. This file is
 * wiring, and is kept thin enough to review by eye because no test can load it.
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
  /** Rubber and scorch, redrawn from `liveDecals` every frame. See `redrawDecals`. */
  private readonly decals: Phaser.GameObjects.RenderTexture;
  /** Every smoke particle, redrawn and re-masked every frame. See `maskSmoke`. */
  private readonly smoke: Phaser.GameObjects.RenderTexture;
  /** One reusable image, moved and re-erased per car. See `maskSmoke`. */
  private readonly eraser: Phaser.GameObjects.Image;
  private liveDecals: LiveDecal[] = [];
  private clockMs = 0;
  /** When each car last laid rubber, so marks go down on a clock rather than per frame. */
  private readonly lastTyreMs = new Map<string, number>();

  constructor(scene: Phaser.Scene, seed: number, arenaWidth: number, arenaHeight: number) {
    this.scene = scene;
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
      .setDepth(AIR_FX_DEPTH);
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
   * A soft, solid stamp of each chassis's silhouette, built once.
   *
   * Derived from the car sprite's own ALPHA channel, so it needs no new art and is automatically
   * right for any chassis added later — the roster itself is the loop, not a hand-written list.
   * Blurred here rather than per frame because it is static: blurring it every frame was pure waste
   * in the spike (VFX21).
   */
  private buildEraserTextures(): void {
    const size = ERASER_TEXTURE_PX;
    for (const carId of Object.keys(CAR_TABLE)) {
      const key = eraserKeyOf(carId);
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      const spriteKey = carSpriteKey(carId);
      const source = this.scene.textures.exists(spriteKey)
        ? this.scene.textures.get(spriteKey).getSourceImage()
        : undefined;
      const canvasTexture = this.scene.textures.createCanvas(key, size, size);
      if (!canvasTexture) continue;
      const ctx = canvasTexture.getContext();
      ctx.clearRect(0, 0, size, size);
      // A generous blur: the hole has to read as the car displacing the cloud, not as its outline
      // traced in smoke.
      ctx.filter = "blur(7px)";
      if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
        ctx.drawImage(source, 12, 12, size - 24, size - 24);
        // Filter off BEFORE the fill: the blur belongs to the silhouette that is already on the
        // canvas, and `source-in` only needs a flat white to take that alpha.
        ctx.filter = "none";
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, size, size);
      } else {
        // No sprite for this chassis: fall back to the hull rectangle, the same fallback `drawCar`
        // takes when a manifest entry is missing. Blurred, so it still reads as a soft hole.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(20, 34, size - 40, size - 68);
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

  /** Which generated texture a burst on this channel draws with. */
  private textureFor(spec: EmitterSpec): string {
    switch (spec.channel) {
      case "smoke":
        return spec.burst.soot ? FX_TEXTURE_KEYS.sootA : FX_TEXTURE_KEYS.dustA;
      case "fire":
        return FX_TEXTURE_KEYS.fireA;
      case "spark":
      case "debris":
        return FX_TEXTURE_KEYS.spark;
    }
  }

  /** Fire one frame's worth of bursts. */
  spawn(specs: readonly EmitterSpec[]): void {
    for (const spec of specs) {
      const emitter = this.emitters[spec.channel];
      if (!emitter) continue;
      const { burst } = spec;

      const key = this.textureFor(spec);
      // Guarded because `setTexture` re-resolves through the texture manager. Only the smoke
      // emitter ever actually switches (dust vs soot); the other three are set once at birth.
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

  /** One frame: derive events from the view delta, spawn what they ask for, and lay decals. */
  update(view: FxWorldView, dtMs: number): void {
    this.clockMs += dtMs;
    const events = deriveFxEvents(this.prevView, view);
    this.spawn(emitterSpecsForAll(events));

    for (const event of events) {
      for (const stamp of decalStampsFor(event)) {
        this.pushDecal({
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
    // An ARRAY, which `draw` renders regardless of visibility — the emitter is invisible precisely
    // so it does not also draw straight to the scene. Passing it bare would depend on its `visible`
    // flag and render nothing.
    this.smoke.draw([this.emitters.smoke]);

    for (const stamp of eraserStampsFor(view.cars)) {
      const key = eraserKeyOf(stamp.carId);
      if (!this.scene.textures.exists(key)) continue;
      // One reusable image, moved and re-erased per car. Creating a Game Object per car per frame
      // would allocate six objects a frame for the life of the match.
      this.eraser
        .setTexture(key)
        .setDisplaySize(stamp.width * 2.2, stamp.height * 2.6)
        .setRotation(stamp.angle)
        .setPosition(stamp.x, stamp.y);
      this.smoke.erase([this.eraser]);
    }

    // Buffered until here, same as the decal layer.
    this.smoke.render();
  }

  /** Add a decal, dropping the oldest once the buffer is full. */
  private pushDecal(decal: LiveDecal): void {
    this.liveDecals.push(decal);
    if (this.liveDecals.length > MAX_DECALS) {
      this.liveDecals.splice(0, this.liveDecals.length - MAX_DECALS);
    }
  }

  /** Rubber under every moving car, laid on a clock so the trail is frame-rate independent. */
  private layTyreMarks(view: FxWorldView): void {
    const key = FX_TEXTURE_KEYS.spark;
    // The spark texture's OWN edge length, for the same reason `spawn` looks it up rather than
    // dividing by a constant: the generated set is not one size.
    const texels = this.texelSize.get(key) ?? 32;
    for (const car of view.cars) {
      if (!car.alive) continue;
      const since = this.clockMs - (this.lastTyreMs.get(car.sessionId) ?? -Infinity);
      if (since < TYRE_MARK_INTERVAL_MS) continue;
      // Shared's `speedOf` on the networked world velocity, never a pose delta: `sim/velocity.ts`
      // is the only place the world-frame conversion may be written, and a delta would also misread
      // a remote car while it is being interpolated.
      const marks = tyreMarksFor(car, speedOf(car.vx, car.vy));
      if (marks.length === 0) continue;
      this.lastTyreMs.set(car.sessionId, this.clockMs);
      for (const mark of marks) {
        this.pushDecal({
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
    // A car that left keeps no timer, or the map grows for the life of the room.
    const present = new Set(view.cars.map((c) => c.sessionId));
    for (const id of [...this.lastTyreMs.keys()]) if (!present.has(id)) this.lastTyreMs.delete(id);
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
    const survivors: LiveDecal[] = [];
    for (const decal of this.liveDecals) {
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
    this.liveDecals = survivors;
    // Buffered until this call — without it nothing appears, which is the Phaser 4 change most
    // likely to be missed when porting any Phaser 3 RenderTexture snippet.
    this.decals.render();
  }

  destroy(): void {
    for (const emitter of Object.values(this.emitters)) emitter.destroy();
    this.decals.destroy();
    this.smoke.destroy();
    this.eraser.destroy();
  }
}
