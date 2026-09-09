import Phaser from "phaser";
import { ARENA_01, DRIVE_CONFIG } from "@motor-combat-moba/shared";
import { applyCarSprite, phaserTextures, resolveCarSprite } from "../assets/car-sprite.js";
import type { FxCarView, FxWorldView } from "../fx/events.js";
import { FX_TEXTURE_KEYS, FxLayer, type FxToggle } from "../fx/layer.js";
import { FLOOR_DEPTH } from "../fx/depths.js";
import { assetManifest } from "../scenes/BootScene.js";

/**
 * Grepped by `scripts/build-release.mjs` to prove this scene is absent from a release build. A
 * local literal rather than an import of `DEV_TOOL_MARKER`, deliberately, and for the same reason
 * `AssetTuningScene` keeps one: the string must be physically present in *this* module, so the
 * check still fires if the scene ever reaches a bundle by a route that bypasses the registry.
 */
const MARKER = "MOTOR DEV TOOL";

/**
 * The rung `ArenaScene` draws cars on. A local copy of a module-private constant there, matched to
 * `fx/depths.ts`'s own note that the ladder's existing rungs include `CAR 0` — what matters here is
 * that the cars sit below `SMOKE_DEPTH`, or the mask would have nothing to reveal.
 */
const CAR_DEPTH = 0;

/** The scripted loop's period. Long enough for a 3-second smoke column to thin out before it repeats. */
const LOOP_MS = 6000;

/** When in the loop the shell detonates — the instant it stops existing, which the seam reads as an impact. */
const DETONATION_S = 1.25;

/** The arc the driving car follows, so the rubber it lays is a readable curve rather than a smear. */
const ARC = { cx: 470, cy: 400, radius: 190, ratePerSec: 0.62, startRad: -1.2 } as const;

/** Every toggle, in key order: `1`-`6`. */
const CHANNELS: readonly FxToggle[] = ["smoke", "fire", "spark", "debris", "decals", "mask"];
const CHANNEL_KEYS = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"] as const;

/** A car that is not moving. `speedOf(0, 0)` is under `decals.tyreSpeedFloor`, so it lays no rubber. */
function parked(
  sessionId: string,
  x: number,
  y: number,
  angle: number,
  carId: string,
  hp: number,
): FxCarView {
  return { sessionId, x, y, angle, hp, alive: true, carId, vx: 0, vy: 0 };
}

/**
 * `?dev=fx` — the FX system driven by a scripted loop instead of a match.
 *
 * Built on the shipped `FxLayer` and the real `fx/` modules rather than a parallel mockup (VFX32),
 * so what is approved here is what ships. It draws the real asphalt floor and resolves car art
 * through `resolveCarSprite`, the same function `ArenaScene` and `?dev=assets` use, so it is judged
 * at true 1:1 on the ground the game actually renders — the standard the art work in this repo is
 * held to.
 *
 * Every channel is independently switchable, which is the mitigation VFX33 names for the one
 * residual risk: whether a screen busy enough for a six-car fight is tiring to look at is a question
 * only a person looking at it can answer, and answering it means being able to turn each layer off.
 * `6` is the one that matters most — it disables the smoke occlusion mask, and the car that then
 * vanishes into the smoke column is the evidence VFX18 is doing real work.
 *
 * Dev-only. `BootScene` gates the dynamic import behind `import.meta.env.DEV`, which Vite replaces
 * with the literal `false` in a production build, so this module is never emitted into `dist`.
 */
export class FxPreviewScene extends Phaser.Scene {
  private fx: FxLayer | undefined;
  private elapsed = 0;
  /** One container per scripted car, built once and moved each frame. Keyed by `sessionId`. */
  private readonly bodies = new Map<string, Phaser.GameObjects.Container>();
  private statusText: Phaser.GameObjects.Text | undefined;

  constructor() {
    super("FxPreview");
  }

  private onShutdown(): void {
    this.teardown();
  }

  /** The single teardown path, called from both `create` and `onShutdown` — see the note in `create`. */
  private teardown(): void {
    this.fx?.destroy();
    this.fx = undefined;
  }

  create(): void {
    // Mirrors ArenaScene's `resetMatchState` convention (ArenaScene.ts, around line 1252): call the
    // single teardown from both `create` and `onShutdown` rather than shutdown-only, so a restart of
    // this scene can never leave the previous FxLayer's emitters and render textures alive.
    this.teardown();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.cameras.main.setBackgroundColor(ARENA_01.palette.floor);

    // BEFORE the floor, for the same reason `ArenaScene.create` builds it before `drawArena`: the
    // constructor is what uploads `FX_TEXTURE_KEYS.asphalt`, and the floor tile is about to ask for
    // it by name. Art has already loaded — `BootScene` awaits it before starting a dev tool — so
    // the eraser silhouettes built in here are the real chassis shapes, not the rectangle fallback.
    this.fx = new FxLayer(this, 1337, ARENA_01.width, ARENA_01.height);

    this.add
      .tileSprite(0, 0, ARENA_01.width, ARENA_01.height, FX_TEXTURE_KEYS.asphalt)
      .setOrigin(0, 0)
      .setDepth(FLOOR_DEPTH);

    for (const car of this.carsAt(0)) this.bodies.set(car.sessionId, this.buildCar(car));

    this.add.text(12, 10, `${MARKER} — FX PREVIEW`, {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#e6e4e1",
    });
    this.statusText = this.add.text(12, 30, "", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#9a9aa3",
    });
    this.refreshStatus();

    CHANNEL_KEYS.forEach((key, i) => {
      this.input.keyboard?.on(`keydown-${key}`, () => {
        this.fx?.toggleChannel(CHANNELS[i]!);
        this.refreshStatus();
      });
    });
  }

  /** The toggle line, so which channels are live is on screen rather than in the presser's memory. */
  private refreshStatus(): void {
    const fx = this.fx;
    const line = CHANNELS.map(
      (channel, i) => `${i + 1} ${channel}${fx && !fx.isChannelEnabled(channel) ? " OFF" : ""}`,
    ).join("   ");
    this.statusText?.setText(line);
  }

  /**
   * The world at one point in the loop. A pure function of `t`, so `create` can place the cars at
   * their t=0 poses and `update` can move them with no state between the two.
   */
  private carsAt(t: number): FxCarView[] {
    const angle = ARC.startRad + t * ARC.ratePerSec;
    // The exact derivative of the arc, so `speedOf(vx, vy)` is the car's real tangential speed and
    // `tyreMarksFor` sees what it would see in a match. A hand-picked pair here would make the
    // rubber lie about the speed that produced it — the one thing this preview must not do.
    const tangential = ARC.radius * ARC.ratePerSec;
    return [
      {
        sessionId: "drive",
        x: ARC.cx + Math.cos(angle) * ARC.radius,
        y: ARC.cy + Math.sin(angle) * ARC.radius,
        // Heading along the tangent, which is where the velocity below points.
        angle: angle + Math.PI / 2,
        hp: 85,
        alive: true,
        carId: "mirage",
        vx: -Math.sin(angle) * tangential,
        vy: Math.cos(angle) * tangential,
      },
      // Parked, so the eraser mask has something to hold a hole open around while the smoke rolls
      // over it. `blast` is the one the shell lands on.
      parked("park", 742, 452, 2.55, "bullseye", 40),
      parked("blast", 966, 214, 3.55, "bastion", 62),
    ];
  }

  /** One car, drawn through the same resolution chain the arena uses so this is a true 1:1 view. */
  private buildCar(car: FxCarView): Phaser.GameObjects.Container {
    const container = this.add.container(car.x, car.y).setDepth(CAR_DEPTH);
    const resolved = resolveCarSprite(assetManifest(), phaserTextures(this.textures), car.carId, {
      width: DRIVE_CONFIG.carWidth,
      height: DRIVE_CONFIG.carHeight,
    });
    if (resolved) {
      container.add(applyCarSprite(this.add.image(0, 0, resolved.key), resolved, 0xffffff));
    } else {
      // The same fallback `ArenaScene` takes with no art: a hull-sized block, so the mask still has
      // a car-shaped thing to be judged against on a checkout with no art imported.
      const gfx = this.add.graphics();
      gfx.fillStyle(0xb9b2a6, 1);
      gfx.fillRect(
        -DRIVE_CONFIG.carWidth / 2,
        -DRIVE_CONFIG.carHeight / 2,
        DRIVE_CONFIG.carWidth,
        DRIVE_CONFIG.carHeight,
      );
      container.add(gfx);
    }
    container.setRotation(car.angle);
    return container;
  }

  update(_time: number, delta: number): void {
    const fx = this.fx;
    if (!fx) return;
    this.elapsed = (this.elapsed + delta) % LOOP_MS;
    const t = this.elapsed / 1000;

    const cars = this.carsAt(t);
    for (const car of cars) {
      this.bodies.get(car.sessionId)?.setPosition(car.x, car.y).setRotation(car.angle);
    }

    // A shell that exists for the first `DETONATION_S` of the loop and then is gone. The event seam
    // reads its arrival as a `shotFired` and its disappearance as a `shotEnded` — a real detonation
    // through the shipped path, not a hand-called burst.
    const instances =
      t < DETONATION_S
        ? [
            {
              id: "shell",
              weaponId: "magmablast",
              x: 952,
              y: 222,
              angle: 0,
              alive: true,
              extent: 0,
              isExplosion: false,
            },
          ]
        : [];

    const view: FxWorldView = { cars, instances };
    fx.update(view, delta);
  }
}
