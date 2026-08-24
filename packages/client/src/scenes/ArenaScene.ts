import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { ArenaState, SimBody } from "@motor-arena/shared";
import {
  INPUT_MESSAGE,
  MSG_STUB_END_MATCH,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
} from "@motor-arena/shared";
import { InterpolationBuffer } from "../net/interpolation.js";
import { PredictionBuffer } from "../net/prediction.js";
import { bindViewRouter } from "../net/view.js";

const LOCAL_FILL = 0x2ecc71;
const REMOTE_FILL = 0xe74c3c;
const CAR_SIZE = 32;

export class ArenaScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private readonly prediction = new PredictionBuffer();
  private readonly interps = new Map<string, InterpolationBuffer>();
  private readonly rects = new Map<string, Phaser.GameObjects.Rectangle>();
  private following = false;
  private inputSeq = 0;
  private unbind: Array<() => void> = [];
  private countdownText: Phaser.GameObjects.Text | undefined;
  private stubButton: Phaser.GameObjects.Text | undefined;

  constructor() {
    super({ key: "arena" });
  }

  create(): void {
    this.clearCars();
    this.following = false;
    this.inputSeq = 0;
    this.unbindAll();
    this.countdownText?.destroy();
    this.stubButton?.destroy();
    this.countdownText = undefined;
    this.stubButton = undefined;
    this.room = this.registry.get("room") as Room<ArenaState> | undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    if (!this.room) {
      this.scene.start("join");
      return;
    }

    this.countdownText = this.add
      .text(640, 280, "", { fontSize: "96px", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);

    this.bindRoom(this.room);
    this.syncMatchHud();
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));

    const onState = (): void => {
      this.syncMatchHud();
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
    this.unbindAll();
    this.clearCars();
    this.following = false;
    this.countdownText = undefined;
    this.stubButton = undefined;
    this.room = undefined;
  }

  private clearCars(): void {
    for (const rect of this.rects.values()) {
      rect.destroy();
    }
    this.rects.clear();
    this.interps.clear();
  }

  update(): void {
    const room = this.room;
    if (!room) return;

    this.syncMatchHud();
    if (room.state.phase === RoomPhase.MATCH) {
      this.inputSeq += 1;
      room.send(INPUT_MESSAGE, {
        seq: this.inputSeq,
        steer: 0,
        throttle: 0,
        fire: false,
      });
    }

    const seen = new Set<string>();
    room.state.players.forEach((player, sessionId) => {
      if (player.status !== PlayerStatus.IN_MATCH) return;
      seen.add(sessionId);
      const serverPose: SimBody = { x: player.x, y: player.y, angle: player.angle };
      const isLocal = sessionId === room.sessionId;
      const pose = isLocal ? this.localPose(serverPose) : this.remotePose(sessionId, serverPose);
      this.syncRect(sessionId, pose, isLocal);
    });

    for (const [sessionId, rect] of this.rects) {
      if (seen.has(sessionId)) continue;
      rect.destroy();
      this.rects.delete(sessionId);
      this.interps.delete(sessionId);
    }
  }

  private localPose(authoritative: SimBody): SimBody {
    return this.prediction.reconcile(authoritative, authoritative);
  }

  private remotePose(sessionId: string, pose: SimBody): SimBody {
    let buf = this.interps.get(sessionId);
    if (!buf) {
      buf = new InterpolationBuffer();
      this.interps.set(sessionId, buf);
    }
    buf.push(this.time.now, pose);
    return buf.sample(this.time.now) ?? pose;
  }

  private syncRect(sessionId: string, pose: SimBody, isLocal: boolean): void {
    let rect = this.rects.get(sessionId);
    if (!rect) {
      rect = this.add.rectangle(
        pose.x,
        pose.y,
        CAR_SIZE,
        CAR_SIZE,
        isLocal ? LOCAL_FILL : REMOTE_FILL,
      );
      this.rects.set(sessionId, rect);
    } else {
      rect.setPosition(pose.x, pose.y);
    }

    if (isLocal && !this.following) {
      this.cameras.main.startFollow(rect);
      this.following = true;
    }
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

    const showStub =
      room.state.phase === RoomPhase.MATCH && room.sessionId === room.state.hostSessionId;
    if (showStub && !this.stubButton) {
      this.stubButton = this.add
        .text(640, 640, "End match (stub)", { fontSize: "24px", color: "#ffffff" })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1000)
        .setInteractive({ useHandCursor: true });
      this.stubButton.on("pointerup", () => {
        this.room?.send(MSG_STUB_END_MATCH);
      });
    } else if (!showStub && this.stubButton) {
      this.stubButton.destroy();
      this.stubButton = undefined;
    }
  }
}
