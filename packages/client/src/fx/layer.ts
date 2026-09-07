import Phaser from "phaser";
import { AIR_FX_DEPTH, GROUND_FX_DEPTH } from "./depths.js";
import { deriveFxEvents, type FxWorldView } from "./events.js";
import { emitterSpecsForAll, type EmitterSpec } from "./emitters.js";
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

  constructor(scene: Phaser.Scene, seed: number) {
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
   */
  displayObjects(): Phaser.GameObjects.GameObject[] {
    return Object.values(this.emitters);
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

  /** One frame: derive events from the view delta and spawn what they ask for. */
  update(view: FxWorldView, _dtMs: number): void {
    this.spawn(emitterSpecsForAll(deriveFxEvents(this.prevView, view)));
    this.prevView = view;
  }

  destroy(): void {
    for (const emitter of Object.values(this.emitters)) emitter.destroy();
  }
}
