import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { ArenaState, SimBody } from "@motor-arena/shared";
import { InterpolationBuffer } from "../net/interpolation.js";
import { PredictionBuffer } from "../net/prediction.js";

const LOCAL_FILL = 0x2ecc71;
const REMOTE_FILL = 0xe74c3c;
const CAR_SIZE = 32;

export class ArenaScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private readonly prediction = new PredictionBuffer();
  private readonly interps = new Map<string, InterpolationBuffer>();
  private readonly rects = new Map<string, Phaser.GameObjects.Rectangle>();
  private following = false;

  constructor() {
    super({ key: "arena" });
  }

  create(): void {
    this.clearCars();
    this.following = false;
    this.room = this.registry.get("room") as Room<ArenaState> | undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  private onShutdown(): void {
    this.clearCars();
    this.following = false;
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

    const seen = new Set<string>();
    room.state.players.forEach((player, sessionId) => {
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
}
