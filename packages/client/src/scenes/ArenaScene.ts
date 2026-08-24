import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { ArenaDef, ArenaState, InputMessage, SimBody, StepContext } from "@motor-arena/shared";
import {
  CAMERA_CONFIG,
  DRIVE_CONFIG,
  INPUT_MESSAGE,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  getArena,
} from "@motor-arena/shared";
import { isDebugEnabled } from "../config/client-mode.js";
import { InterpolationBuffer } from "../net/interpolation.js";
import { PredictionBuffer } from "../net/prediction.js";
import { buildStepContext } from "../net/step-context.js";
import { bindViewRouter } from "../net/view.js";
import { axisOf, drainTicks } from "./arena-input.js";
import { carFillOf, carShapeOf, hexagonPoints } from "./car-visual.js";

const ARENA_DEPTH = -10;
const OBSTACLE_FILL = 0x6b6b6b;
const ARENA_BORDER = 0x4a4a4a;
const ARENA_BORDER_PX = 4;
const HITBOX_STROKE = 0xffffff;
const HITBOX_PX = 1;

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

/** A car is redrawn from scratch only when its chassis or colour changes, not every frame. */
function visualKeyOf(player: ArenaPlayer): string {
  return `${player.carId}:${player.colorId}`;
}

export class ArenaScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private prediction = new PredictionBuffer();
  private readonly interps = new Map<string, InterpolationBuffer>();
  private readonly cars = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly visualKeys = new Map<string, string>();
  private arenaGfx: Phaser.GameObjects.Graphics | undefined;
  private arena: ArenaDef | undefined;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  private predicted: SimBody | undefined;
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
  private unbind: Array<() => void> = [];
  private countdownText: Phaser.GameObjects.Text | undefined;

  constructor() {
    super({ key: "arena" });
  }

  create(): void {
    this.resetMatchState();
    this.debug = isDebugEnabled();
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
    // Space is reserved now so the browser does not scroll on it and P5 has the binding; its state
    // is deliberately not read — `fire` stays false until projectiles exist.
    this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Hoisted out of the 30 Hz prediction path: `getArena` is a lookup that throws, and the arena
    // cannot change while the scene is alive.
    this.arena = getArena(this.room.state.arenaId);
    this.drawArena(this.arena);

    this.countdownText = this.add
      .text(640, 280, "", { fontSize: "96px", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);

    this.bindRoom(this.room);
    this.syncMatchHud();
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
    cam.setZoom(CAMERA_CONFIG.zoom);
    // Stops the soft follow from panning past the arena edge into empty space.
    cam.setBounds(0, 0, arena.width, arena.height);
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));

    const onState = (): void => {
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
    this.cursors = undefined;
    this.prediction = new PredictionBuffer();
    this.predicted = undefined;
    this.camFocus = undefined;
    this.inputAccumulatorMs = 0;
  }

  update(_time: number, delta: number): void {
    const room = this.room;
    if (!room) return;

    this.syncMatchHud();
    this.pumpInput(room, delta);
    this.renderCars(room);
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

  /** The same gate `serverTick` uses to decide whether this player's inputs move anything. */
  private canDrive(room: Room<ArenaState>): boolean {
    if (room.state.phase !== RoomPhase.MATCH) return false;
    return room.state.players.get(room.sessionId)?.status === PlayerStatus.IN_MATCH;
  }

  private sendInputTick(room: Room<ArenaState>): void {
    const local = room.state.players.get(room.sessionId);
    if (!local) return;

    this.inputSeq += 1;
    const input: InputMessage = {
      seq: this.inputSeq,
      steer: axisOf(this.cursors?.left.isDown ?? false, this.cursors?.right.isDown ?? false),
      throttle: axisOf(this.cursors?.down.isDown ?? false, this.cursors?.up.isDown ?? false),
      fire: false,
    };
    room.send(INPUT_MESSAGE, input);

    // Predict immediately: the local car has to answer on this frame, not a round-trip later.
    const from = this.predicted ?? bodyOf(local);
    this.predicted = this.prediction.predict(from, { seq: input.seq, input }, this.stepContext(room));
  }

  private stepContext(room: Room<ArenaState>): StepContext {
    return buildStepContext(this.arena ?? getArena(room.state.arenaId), room.state, room.sessionId);
  }

  private reconcileLocal(room: Room<ArenaState>): void {
    const local = room.state.players.get(room.sessionId);
    if (!local || local.status !== PlayerStatus.IN_MATCH) {
      this.predicted = undefined;
      return;
    }

    const authoritative = bodyOf(local);
    if (!this.predicted) {
      this.predicted = authoritative;
      return;
    }
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
    room.state.players.forEach((player, sessionId) => {
      if (player.status !== PlayerStatus.IN_MATCH) return;
      seen.add(sessionId);

      const serverPose = bodyOf(player);
      const isLocal = sessionId === room.sessionId;
      // The local car draws its predicted pose; remotes draw an interpolated one, so they glide
      // between patches instead of stepping once per packet.
      const pose = isLocal
        ? (this.predicted ?? serverPose)
        : this.remotePose(sessionId, serverPose);

      this.syncCar(sessionId, player, pose);
      if (isLocal) this.followCamera(pose);
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

  private remotePose(sessionId: string, pose: SimBody): SimBody {
    return this.interps.get(sessionId)?.sample(this.time.now) ?? pose;
  }

  private syncCar(sessionId: string, player: ArenaPlayer, pose: SimBody): void {
    const key = visualKeyOf(player);
    let gfx = this.cars.get(sessionId);
    if (!gfx || this.visualKeys.get(sessionId) !== key) {
      gfx?.destroy();
      gfx = this.drawCar(player.carId, player.colorId);
      this.cars.set(sessionId, gfx);
      this.visualKeys.set(sessionId, key);
    }
    gfx.setPosition(pose.x, pose.y);
    gfx.setRotation(pose.angle);
  }

  /**
   * The car's silhouette in its own local frame, centred on the origin with +x forward, so the whole
   * drawing follows `angle` with a single `setRotation`.
   */
  private drawCar(carId: string, colorId: number): Phaser.GameObjects.Graphics {
    const { carWidth: w, carHeight: h } = DRIVE_CONFIG;
    const gfx = this.add.graphics();

    gfx.fillStyle(carFillOf(colorId), 1);
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

    // The hitbox is the OBB the sim actually collides with, which is not the drawn silhouette for
    // the oval or the hexagon. Only shown behind `?debug=1` so ordinary play sees the shape, not the box.
    if (this.debug) {
      gfx.lineStyle(HITBOX_PX, HITBOX_STROKE, 1);
      gfx.strokeRect(-w / 2, -h / 2, w, h);
    }
    return gfx;
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

  }
}
