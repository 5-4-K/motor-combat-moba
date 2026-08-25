import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { ArenaDef, ArenaState, InputMessage, SimBody, StepContext } from "@motor-combat-moba/shared";
import {
  CAMERA_CONFIG,
  DRIVE_CONFIG,
  INPUT_MESSAGE,
  MS_PER_TICK,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  getArena,
} from "@motor-combat-moba/shared";
import { applyCarSprite, phaserTextures, resolveCarSprite } from "../assets/car-sprite.js";
import { isDebugEnabled } from "../config/client-mode.js";
import { InterpolationBuffer } from "../net/interpolation.js";
import { PredictionBuffer } from "../net/prediction.js";
import { blendPose } from "../net/interpolation.js";
import { buildStepContext } from "../net/step-context.js";
import { bindViewRouter } from "../net/view.js";
import { axisOf, drainTicks } from "./arena-input.js";
import { assetManifest, assetsReady } from "./BootScene.js";
import { carFillOf, carShapeOf, hexagonPoints } from "./car-visual.js";
import { extrapolateShot, hpBarColor, hpFraction } from "./combat-visual.js";
import {
  cycleSpectate,
  isSpectating,
  panFreeCam,
  resolveSpectateTarget,
  spectatableIds,
  type SpectateCandidate,
} from "./spectate.js";

const ARENA_DEPTH = -10;
/** Light floor. Obstacles, border, HUD text, and shots are all picked to read against this, and
 * against the six saturated player colours in `COLOR_TABLE` — hence desaturated, dark tones. */
const ARENA_FLOOR = 0xebebeb;
const OBSTACLE_FILL = 0x4a5568;
const ARENA_BORDER = 0x2d3436;
const ARENA_BORDER_PX = 4;
const HUD_TEXT = "#1d1f21";
const HITBOX_STROKE = 0x1d1f21;
const HITBOX_PX = 1;

const SHOT_DEPTH = 50;
const SHOT_FILL = 0xc77800;
const SHOT_RADIUS = 4;
/** Drawn behind each shot so the eye reads which way it is going, not just where it is. */
const SHOT_TRAIL_PX = 14;

const HP_BAR_DEPTH = 60;
const HP_BAR_W = 44;
const HP_BAR_H = 5;
/** Clear of the car's own silhouette, which is `DRIVE_CONFIG.carHeight` tall. */
const HP_BAR_OFFSET_Y = 30;
const HP_BAR_BACK = 0x22252b;

/** A wreck stays on the field as an obstacle-shaped memento; it just stops looking alive. */
const WRECK_ALPHA = 0.3;

const HUD_DEPTH = 1000;

/** The subset of `PlayerState` the arena renders and predicts from. */
interface ArenaPlayer {
  x: number;
  y: number;
  angle: number;
  speed: number;
  reverseHold: number;
  status: number;
  carId: string;
  colorId: number;
  lastProcessedInputSeq: number;
  hp: number;
  alive: boolean;
  name: string;
}

/** The keys this scene binds beyond Phaser's cursor keys: firing, and the spectator controls. */
interface SpectateKeys {
  fire: Phaser.Input.Keyboard.Key;
  prev: Phaser.Input.Keyboard.Key;
  next: Phaser.Input.Keyboard.Key;
  freeRoam: Phaser.Input.Keyboard.Key;
  panLeft: Phaser.Input.Keyboard.Key;
  panRight: Phaser.Input.Keyboard.Key;
  panUp: Phaser.Input.Keyboard.Key;
  panDown: Phaser.Input.Keyboard.Key;
}

function bodyOf(player: ArenaPlayer): SimBody {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    speed: player.speed,
    reverseHold: player.reverseHold,
  };
}

/**
 * A car is redrawn from scratch only when its chassis, colour, or living state changes, not every
 * frame. `alive` is part of the key because a wreck is drawn differently, and without it a car that
 * died would keep its living silhouette until something else happened to change the key.
 */
function visualKeyOf(player: ArenaPlayer): string {
  return `${player.carId}:${player.colorId}:${player.alive}`;
}

export class ArenaScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private prediction = new PredictionBuffer();
  private readonly interps = new Map<string, InterpolationBuffer>();
  private readonly cars = new Map<string, Phaser.GameObjects.Container>();
  private readonly visualKeys = new Map<string, string>();
  private arenaGfx: Phaser.GameObjects.Graphics | undefined;
  private arena: ArenaDef | undefined;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  private predicted: SimBody | undefined;
  /** The predicted pose before the newest tick; `renderCars` blends from it toward `predicted`. */
  private predictedPrev: SimBody | undefined;
  private camFocus: { x: number; y: number } | undefined;
  private inputAccumulatorMs = 0;
  /**
   * Monotonic for the lifetime of the page, deliberately *not* reset in `create`. The server never
   * resets `PlayerState.lastProcessedInputSeq`, so a seq that restarted at 1 for a second match
   * would sit below the standing ack and reconciliation would discard every pending input — the car
   * would fall back to pure server-follow. It is only ever nudged forward, never back.
   */
  private inputSeq = 0;
  private debug = false;
  /**
   * Whether the boot loader is still running. Inspectable state only — the rebuild that swaps
   * silhouettes for sprites is caused by the `visualKeys.clear()` beside where this is cleared,
   * not by this flag, which nothing reads on the draw path.
   */
  private artPending = true;
  private unbind: Array<() => void> = [];
  private countdownText: Phaser.GameObjects.Text | undefined;
  private shotGfx: Phaser.GameObjects.Graphics | undefined;
  private hpGfx: Phaser.GameObjects.Graphics | undefined;
  private spectateText: Phaser.GameObjects.Text | undefined;
  private keys: SpectateKeys | undefined;
  /** Session id of the car the spectate camera is watching. `""` means "nobody left to watch". */
  private spectateTarget = "";
  private freeRoam = false;
  /**
   * When the last state patch landed, for drawing shots between patches. `performance.now()` rather
   * than Phaser's clock, for the reason spelled out in `pushRemoteSnapshots`.
   */
  private lastPatchMs = 0;

  constructor() {
    super({ key: "arena" });
  }

  create(): void {
    this.resetMatchState();
    this.debug = isDebugEnabled();
    // Reuses the existing rebuild path rather than adding a second one: dropping the cached visual
    // keys makes `syncCar` treat every car as changed, so each is redrawn once, now with its sprite.
    void assetsReady()
      .then(() => {
        this.artPending = false;
        this.visualKeys.clear();
      })
      // Nothing in `loadArt` rejects today, but an unhandled rejection here would be silent and the
      // match would simply never swap in its sprites. Warn instead.
      .catch((error: unknown) => console.warn(`[art] asset load rejected: ${String(error)}`));
    this.room = this.registry.get("room") as Room<ArenaState> | undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    if (!this.room) {
      this.scene.start("join");
      return;
    }

    this.inputSeq = Math.max(
      this.inputSeq,
      this.room.state.players.get(this.room.sessionId)?.lastProcessedInputSeq ?? 0,
    );

    this.cursors = this.input.keyboard?.createCursorKeys();
    this.keys = this.bindKeys();

    // Hoisted out of the 30 Hz prediction path: `getArena` is a lookup that throws, and the arena
    // cannot change while the scene is alive.
    this.arena = getArena(this.room.state.arenaId);
    this.drawArena(this.arena);

    // One Graphics for every shot and one for every hp bar, cleared and redrawn each frame. Both
    // are drawn in *world* space but must not rotate with any car, so neither can live inside a
    // car's own Graphics; a per-shot object would also mean creating and destroying objects at the
    // fire rate for no gain.
    this.shotGfx = this.add.graphics().setDepth(SHOT_DEPTH);
    this.hpGfx = this.add.graphics().setDepth(HP_BAR_DEPTH);

    this.countdownText = this.add
      .text(640, 280, "", { fontSize: "96px", color: HUD_TEXT })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH)
      .setVisible(false);

    this.spectateText = this.add
      .text(640, 660, "", { fontSize: "22px", color: HUD_TEXT })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH)
      .setVisible(false);

    this.bindRoom(this.room);
    this.syncMatchHud();
  }

  /**
   * Space fires; `[` / `]` and, once you are a wreck, Left / Right cycle who you are watching; `V`
   * toggles free roam. Space is bound rather than merely read so the browser does not scroll the
   * page under the canvas every time you shoot.
   *
   * The arrows do double duty on purpose, and the modes are what keep that unambiguous: while you
   * are alive they steer, and only a spectator can cycle with them. In free roam they pan instead,
   * so cycling is on the bracket keys there.
   */
  private bindKeys(): SpectateKeys | undefined {
    const keyboard = this.input.keyboard;
    if (!keyboard) return undefined;
    const Codes = Phaser.Input.Keyboard.KeyCodes;
    return {
      fire: keyboard.addKey(Codes.SPACE),
      prev: keyboard.addKey(Codes.OPEN_BRACKET),
      next: keyboard.addKey(Codes.CLOSED_BRACKET),
      freeRoam: keyboard.addKey(Codes.V),
      panLeft: keyboard.addKey(Codes.A),
      panRight: keyboard.addKey(Codes.D),
      panUp: keyboard.addKey(Codes.W),
      panDown: keyboard.addKey(Codes.S),
    };
  }

  private drawArena(arena: ArenaDef): void {
    const gfx = this.add.graphics().setDepth(ARENA_DEPTH);
    gfx.fillStyle(OBSTACLE_FILL, 1);
    for (const obstacle of arena.obstacles) {
      gfx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    }
    gfx.lineStyle(ARENA_BORDER_PX, ARENA_BORDER, 1);
    gfx.strokeRect(0, 0, arena.width, arena.height);
    this.arenaGfx = gfx;

    const cam = this.cameras.main;
    // Scene-scoped: the global game background stays dark for the lobby and results screens.
    cam.setBackgroundColor(ARENA_FLOOR);
    cam.setZoom(CAMERA_CONFIG.zoom);
    // Stops the soft follow from panning past the arena edge into empty space.
    cam.setBounds(0, 0, arena.width, arena.height);
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));

    const onState = (): void => {
      this.lastPatchMs = performance.now();
      this.syncMatchHud();
      this.reconcileLocal(room);
      this.pushRemoteSnapshots(room);
    };
    room.onStateChange(onState);
    this.unbind.push(() => room.onStateChange.remove(onState));

    const onLeave = (): void => {
      this.registry.remove("room");
      this.scene.start("join");
    };
    room.onLeave(onLeave);
    this.unbind.push(() => room.onLeave.remove(onLeave));
  }

  private unbindAll(): void {
    for (const fn of this.unbind) fn();
    this.unbind = [];
  }

  private onShutdown(): void {
    this.resetMatchState();
    this.room = undefined;
  }

  /**
   * The single teardown path, called from both `create` and `onShutdown`.
   *
   * Phaser guarantees shutdown-before-create, so one of these is always redundant — but only as long
   * as both reset the *same* fields. Two partial reset paths is exactly the shape that let a
   * `PredictionBuffer` survive across matches and replay a previous match's pending inputs. Adding a
   * field here covers both entry points at once; adding it to only one covers neither reliably.
   */
  private resetMatchState(): void {
    this.unbindAll();
    for (const gfx of this.cars.values()) gfx.destroy();
    this.cars.clear();
    this.visualKeys.clear();
    this.interps.clear();
    this.arenaGfx?.destroy();
    this.arenaGfx = undefined;
    this.arena = undefined;
    this.countdownText?.destroy();
    this.countdownText = undefined;
    this.spectateText?.destroy();
    this.spectateText = undefined;
    this.shotGfx?.destroy();
    this.shotGfx = undefined;
    this.hpGfx?.destroy();
    this.hpGfx = undefined;
    this.cursors = undefined;
    this.keys = undefined;
    this.prediction = new PredictionBuffer();
    this.predicted = undefined;
    this.predictedPrev = undefined;
    this.camFocus = undefined;
    this.inputAccumulatorMs = 0;
    this.spectateTarget = "";
    this.freeRoam = false;
    this.lastPatchMs = 0;
  }

  update(_time: number, delta: number): void {
    const room = this.room;
    if (!room) return;

    this.syncMatchHud();
    this.pumpInput(room, delta);
    this.updateSpectate(room, delta);
    this.renderCars(room);
    this.renderShots(room);
  }

  // --- input -------------------------------------------------------------------------------

  /** Inputs go out on the sim clock, not the render clock. See `drainTicks` for the arithmetic. */
  private pumpInput(room: Room<ArenaState>, delta: number): void {
    if (!this.canDrive(room)) {
      this.inputAccumulatorMs = 0;
      return;
    }

    const { accMs, ticks } = drainTicks(this.inputAccumulatorMs, delta);
    this.inputAccumulatorMs = accMs;
    for (let i = 0; i < ticks; i++) this.sendInputTick(room);
  }

  /**
   * The same gate `serverTick` and `runCombat` use, so a client never predicts a step the server
   * would not have run. `alive` is part of it: a wreck's inputs are drained and acked but move
   * nothing and fire nothing, so continuing to send them would only spend bandwidth predicting a
   * car that cannot move.
   */
  private canDrive(room: Room<ArenaState>): boolean {
    if (room.state.phase !== RoomPhase.MATCH) return false;
    const local = room.state.players.get(room.sessionId);
    return local?.status === PlayerStatus.IN_MATCH && local.alive;
  }

  private sendInputTick(room: Room<ArenaState>): void {
    const local = room.state.players.get(room.sessionId);
    if (!local) return;

    this.inputSeq += 1;
    const input: InputMessage = {
      seq: this.inputSeq,
      steer: axisOf(this.cursors?.left.isDown ?? false, this.cursors?.right.isDown ?? false),
      throttle: axisOf(this.cursors?.down.isDown ?? false, this.cursors?.up.isDown ?? false),
      // Held, not tapped: the server's weapon cooldown decides the rate, so holding Space fires as
      // fast as the weapon allows and no faster. Sampling `JustDown` here instead would drop shots
      // whenever a frame straddled two input ticks.
      fire: this.keys?.fire.isDown ?? false,
    };
    room.send(INPUT_MESSAGE, input);

    // Predict immediately: the local car has to answer on this frame, not a round-trip later.
    const from = this.predicted ?? bodyOf(local);
    this.predictedPrev = from;
    this.predicted = this.prediction.predict(from, { seq: input.seq, input }, this.stepContext(room));
  }

  private stepContext(room: Room<ArenaState>): StepContext {
    return buildStepContext(this.arena ?? getArena(room.state.arenaId), room.state, room.sessionId);
  }

  private reconcileLocal(room: Room<ArenaState>): void {
    const local = room.state.players.get(room.sessionId);
    // Same gate as `canDrive`. A wreck stops predicting: the server has stopped stepping it, so a
    // prediction buffer left running would replay pending inputs against a car that cannot move and
    // then be snapped back every patch.
    if (!local || local.status !== PlayerStatus.IN_MATCH || !local.alive) {
      this.predicted = undefined;
      this.predictedPrev = undefined;
      return;
    }

    const authoritative = bodyOf(local);
    if (!this.predicted) {
      this.predicted = authoritative;
      this.predictedPrev = undefined;
      return;
    }
    // `predictedPrev` is left alone: reconcile eases `predicted`, so the blend simply carries the
    // correction across the rest of the tick window instead of landing it on one frame.
    this.predicted = this.prediction.reconcile(
      authoritative,
      local.lastProcessedInputSeq,
      this.predicted,
      this.stepContext(room),
    );
  }

  // --- rendering ---------------------------------------------------------------------------

  private renderCars(room: Room<ArenaState>): void {
    const seen = new Set<string>();
    const hp = this.hpGfx;
    hp?.clear();

    room.state.players.forEach((player, sessionId) => {
      if (player.status !== PlayerStatus.IN_MATCH) return;
      seen.add(sessionId);

      const serverPose = bodyOf(player);
      const isLocal = sessionId === room.sessionId;
      // The local car draws its predicted pose; remotes draw an interpolated one, so they glide
      // between patches instead of stepping once per packet. A wreck draws the raw server pose:
      // it is not moving, so there is nothing to smooth and nothing to predict.
      const pose = !player.alive
        ? serverPose
        : isLocal
          ? this.localRenderPose(serverPose)
          : this.remotePose(sessionId, serverPose);

      this.syncCar(sessionId, player, pose);
      if (hp && player.alive) this.drawHpBar(hp, player, pose);
      if (sessionId === this.cameraTarget(room)) this.followCamera(pose);
    });

    for (const [sessionId, gfx] of this.cars) {
      if (seen.has(sessionId)) continue;
      gfx.destroy();
      this.cars.delete(sessionId);
      this.visualKeys.delete(sessionId);
      this.interps.delete(sessionId);
    }
  }

  /**
   * One snapshot per state patch, taken on patch arrival rather than per frame. Pushing every frame
   * would fill the window with copies of the same unchanged pose, and the buffer would then
   * "interpolate" between identical entries and jump a whole patch in one frame — a delayed snap
   * wearing interpolation's clothes.
   */
  private pushRemoteSnapshots(room: Room<ArenaState>): void {
    // Arrival time, not `this.time.now`. Phaser's clock only advances once per frame in `preUpdate`,
    // while this fires from the websocket callback *between* frames, so two patches landing in the
    // same frame would share a timestamp and the earlier pose would be silently shadowed. Phaser's
    // own clock is driven from `performance.now()`, so `sample` reads the same epoch.
    const now = performance.now();
    room.state.players.forEach((player, sessionId) => {
      if (sessionId === room.sessionId) return;
      if (player.status !== PlayerStatus.IN_MATCH) return;
      let buf = this.interps.get(sessionId);
      if (!buf) {
        buf = new InterpolationBuffer();
        this.interps.set(sessionId, buf);
      }
      buf.push(now, bodyOf(player));
    });
  }

  /**
   * The local car between ticks. Prediction steps on the sim clock, frames come faster, so the
   * drawn pose is the previous tick blended toward the newest by how far the input accumulator has
   * got through the current tick. Render-only: `predicted` itself is what the next step reads.
   */
  private localRenderPose(serverPose: SimBody): SimBody {
    if (!this.predicted) return serverPose;
    if (!this.predictedPrev) return this.predicted;
    return blendPose(this.predictedPrev, this.predicted, this.inputAccumulatorMs / MS_PER_TICK);
  }

  private remotePose(sessionId: string, pose: SimBody): SimBody {
    return this.interps.get(sessionId)?.sample(this.time.now) ?? pose;
  }

  private syncCar(sessionId: string, player: ArenaPlayer, pose: SimBody): void {
    const key = visualKeyOf(player);
    let gfx = this.cars.get(sessionId);
    if (!gfx || this.visualKeys.get(sessionId) !== key) {
      gfx?.destroy();
      gfx = this.drawCar(player.carId, player.colorId, player.alive);
      this.cars.set(sessionId, gfx);
      this.visualKeys.set(sessionId, key);
    }
    gfx.setPosition(pose.x, pose.y);
    gfx.setRotation(pose.angle);
  }

  /**
   * The car's visual in its own local frame, centred on the origin with +x forward, so the whole
   * thing follows `angle` with a single `setRotation` on the container.
   *
   * A manifest sprite is drawn when one exists and its texture actually loaded; otherwise this falls
   * through to the silhouette the game has always drawn. The fallback is permanent, not legacy: it
   * is what lets art be added one file at a time and what keeps a missing or malformed entry from
   * costing the game its render.
   */
  private drawCar(carId: string, colorId: number, alive: boolean): Phaser.GameObjects.Container {
    const { carWidth: w, carHeight: h } = DRIVE_CONFIG;
    const fill = carFillOf(colorId);
    const container = this.add.container(0, 0);

    const body = this.spriteFor(carId, fill) ?? this.silhouette(carId, fill, w, h);
    container.add(body);

    // The hitbox is the OBB the sim actually collides with, which is not the drawn silhouette for
    // the oval or the hexagon. Only shown behind `?debug=1` so ordinary play sees the shape, not the box.
    if (this.debug) {
      const box = this.add.graphics();
      box.lineStyle(HITBOX_PX, HITBOX_STROKE, 1);
      box.strokeRect(-w / 2, -h / 2, w, h);
      container.add(box);
    }
    // A wreck keeps its silhouette and its collision box — it is still solid to everyone — and just
    // fades out, so the field still reads as "someone died here" rather than "someone left".
    if (!alive) container.setAlpha(WRECK_ALPHA);
    return container;
  }

  /**
   * The manifest sprite for a chassis, or `undefined` when there is no entry or the texture never
   * loaded — both of which fall through to `silhouette`. The decision itself is `resolveCarSprite`,
   * shared with the `?dev=assets` tuning tool so the tool cannot drift from what the arena draws.
   */
  private spriteFor(carId: string, fill: number): Phaser.GameObjects.Image | undefined {
    const resolved = resolveCarSprite(assetManifest(), phaserTextures(this.textures), carId, {
      width: DRIVE_CONFIG.carWidth,
      height: DRIVE_CONFIG.carHeight,
    });
    if (!resolved) return undefined;
    return applyCarSprite(this.add.image(0, 0, resolved.key), resolved, fill);
  }

  /** The procedural chassis. Unchanged from what the game drew before any art existed. */
  private silhouette(
    carId: string,
    fill: number,
    w: number,
    h: number,
  ): Phaser.GameObjects.Graphics {
    const gfx = this.add.graphics();
    gfx.fillStyle(fill, 1);
    switch (carShapeOf(carId)) {
      case "rect":
        gfx.fillRect(-w / 2, -h / 2, w, h);
        break;
      case "ellipse":
        gfx.fillEllipse(0, 0, w, h);
        break;
      case "hex":
        gfx.fillPoints(hexagonPoints(w, h), true);
        break;
    }
    return gfx;
  }

  /**
   * The hp bar above one car. Drawn unrotated in world space and sized from the car's own maximum,
   * so a full bar means full hp for that chassis rather than a fixed number of points.
   */
  private drawHpBar(
    gfx: Phaser.GameObjects.Graphics,
    player: ArenaPlayer,
    pose: SimBody,
  ): void {
    const fraction = hpFraction(player.hp, player.carId);
    const left = pose.x - HP_BAR_W / 2;
    const top = pose.y - HP_BAR_OFFSET_Y;

    gfx.fillStyle(HP_BAR_BACK, 0.85);
    gfx.fillRect(left, top, HP_BAR_W, HP_BAR_H);
    if (fraction <= 0) return;
    gfx.fillStyle(hpBarColor(fraction), 1);
    gfx.fillRect(left, top, HP_BAR_W * fraction, HP_BAR_H);
  }

  /**
   * Every shot in flight, drawn from `state.projectiles` and nothing else.
   *
   * The client deliberately does not spawn a local shot on the keypress. A predicted bullet that the
   * server never fired — because the cooldown had not actually expired, or the input arrived a tick
   * late — is a phantom that either vanishes or, worse, reads as a hit that never happened. Shots
   * are cheap to draw late and expensive to draw wrongly.
   */
  private renderShots(room: Room<ArenaState>): void {
    const gfx = this.shotGfx;
    if (!gfx) return;
    gfx.clear();

    const elapsedMs = this.lastPatchMs === 0 ? 0 : performance.now() - this.lastPatchMs;
    room.state.projectiles.forEach((shot) => {
      const at = extrapolateShot(shot.x, shot.y, shot.angle, shot.speed, elapsedMs);
      gfx.lineStyle(2, SHOT_FILL, 0.5);
      gfx.lineBetween(
        at.x,
        at.y,
        at.x - Math.cos(shot.angle) * SHOT_TRAIL_PX,
        at.y - Math.sin(shot.angle) * SHOT_TRAIL_PX,
      );
      gfx.fillStyle(SHOT_FILL, 1);
      gfx.fillCircle(at.x, at.y, SHOT_RADIUS);
    });
  }

  // --- spectating --------------------------------------------------------------------------

  /** Are you watching rather than playing? The rule itself lives in `spectate.ts`. */
  private isSpectating(room: Room<ArenaState>): boolean {
    const local = room.state.players.get(room.sessionId);
    if (!local) return false;
    return isSpectating(room.state.phase, local.status, local.alive);
  }

  /**
   * Whose car the camera follows: your own until you are wrecked, then the spectate target.
   * Returning a session id rather than a pose keeps the decision in one place — `renderCars`
   * already has every pose in hand, including the predicted one for the local car.
   */
  private cameraTarget(room: Room<ArenaState>): string {
    return this.isSpectating(room) ? this.spectateTarget : room.sessionId;
  }

  /**
   * Spectator controls, once you are a wreck: cycle who you are watching, or pan freely.
   *
   * Nothing here sends anything. A dead player is a viewer, and giving the camera its own local
   * state is what keeps that true — the server has no notion of who anyone is watching.
   */
  private updateSpectate(room: Room<ArenaState>, delta: number): void {
    if (!this.isSpectating(room)) {
      // Still alive, or not in a live match. Clearing the state means the next death starts a fresh
      // cycle rather than resuming one from a previous match.
      this.spectateTarget = "";
      this.freeRoam = false;
      return;
    }

    const keys = this.keys;
    const ids = spectatableIds(this.spectateCandidates(room));
    this.spectateTarget = resolveSpectateTarget(ids, this.spectateTarget);
    if (!keys) return;

    if (Phaser.Input.Keyboard.JustDown(keys.freeRoam)) {
      this.freeRoam = !this.freeRoam;
      // Free roam starts wherever the camera already is, so toggling it does not teleport the view.
      if (!this.freeRoam) this.camFocus = undefined;
    }

    const back = Phaser.Input.Keyboard.JustDown(keys.prev);
    const forward = Phaser.Input.Keyboard.JustDown(keys.next);
    // Arrows cycle only while following. In free roam they pan, so the bracket keys carry cycling.
    const arrowBack = !this.freeRoam && this.justDown(this.cursors?.left);
    const arrowForward = !this.freeRoam && this.justDown(this.cursors?.right);

    if (back || arrowBack) this.spectateTarget = cycleSpectate(ids, this.spectateTarget, -1);
    else if (forward || arrowForward) this.spectateTarget = cycleSpectate(ids, this.spectateTarget, 1);

    if (this.freeRoam) this.panCamera(keys, delta);
  }

  /** WASD or the arrows, panning the free-look camera. */
  private panCamera(keys: SpectateKeys, delta: number): void {
    const axisX = axisOf(
      keys.panLeft.isDown || (this.cursors?.left.isDown ?? false),
      keys.panRight.isDown || (this.cursors?.right.isDown ?? false),
    );
    const axisY = axisOf(
      keys.panUp.isDown || (this.cursors?.up.isDown ?? false),
      keys.panDown.isDown || (this.cursors?.down.isDown ?? false),
    );

    const from = this.camFocus ?? { x: this.cameras.main.midPoint.x, y: this.cameras.main.midPoint.y };
    this.camFocus = panFreeCam(from, axisX, axisY, delta, CAMERA_CONFIG.freeRoamSpeed);
    this.cameras.main.centerOn(this.camFocus.x, this.camFocus.y);
  }

  private spectateCandidates(room: Room<ArenaState>): SpectateCandidate[] {
    const candidates: SpectateCandidate[] = [];
    room.state.players.forEach((player, sessionId) => {
      candidates.push({ sessionId, status: player.status, alive: player.alive });
    });
    return candidates;
  }

  private justDown(key: Phaser.Input.Keyboard.Key | undefined): boolean {
    return key ? Phaser.Input.Keyboard.JustDown(key) : false;
  }

  /**
   * Soft follow. `centerOn` each frame with the focus eased by `CAMERA_CONFIG.camLerp` keeps a
   * reconciliation snap from throwing the whole view; the first frame seeds the focus outright so
   * the match does not open with the camera flying in from the arena origin.
   */
  private followCamera(pose: SimBody): void {
    if (!this.camFocus) {
      this.camFocus = { x: pose.x, y: pose.y };
    } else {
      this.camFocus.x = Phaser.Math.Linear(this.camFocus.x, pose.x, CAMERA_CONFIG.camLerp);
      this.camFocus.y = Phaser.Math.Linear(this.camFocus.y, pose.y, CAMERA_CONFIG.camLerp);
    }
    this.cameras.main.centerOn(this.camFocus.x, this.camFocus.y);
  }

  private syncMatchHud(): void {
    const room = this.room;
    if (!room) return;

    const counting = room.state.phase === RoomPhase.COUNTDOWN;
    if (this.countdownText) {
      if (counting) {
        const seconds = Math.max(
          0,
          Math.ceil((room.state.countdownEndsTick - room.state.tick) / TICK_RATE_HZ),
        );
        this.countdownText.setText(String(seconds)).setVisible(true);
      } else {
        this.countdownText.setVisible(false);
      }
    }

    this.syncSpectateHud(room);
  }

  /**
   * The spectator banner. Shown only to a wreck during a live match — while you are driving there
   * is nothing to say, and once the match ends the results view takes over.
   */
  private syncSpectateHud(room: Room<ArenaState>): void {
    const text = this.spectateText;
    if (!text) return;

    if (!this.isSpectating(room)) {
      text.setVisible(false);
      return;
    }

    if (this.freeRoam) {
      text.setText("Free roam — WASD/arrows to pan, V to follow, [ ] to switch car");
    } else {
      const name = room.state.players.get(this.spectateTarget)?.name ?? "";
      text.setText(
        name === ""
          ? "Wrecked — no one left to watch"
          : `Spectating ${name} — [ ] or Left/Right to switch, V for free roam`,
      );
    }
    text.setVisible(true);
  }
}
