import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { CarId } from "@motor-combat-moba/shared";
import {
  ArenaState,
  CAR_TABLE,
  MSG_SELECT_CAR,
  PlayerStatus,
  TICK_RATE_HZ,
} from "@motor-combat-moba/shared";
import { bindViewRouter } from "../net/view.js";

const CARD_DEFS = Object.values(CAR_TABLE);
const CARD_Y = 300;
const CARD_XS = [280, 640, 1000];
const CARD_W = 300;
const CARD_H = 280;

export class CarSelectScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private ui: Phaser.GameObjects.GameObject[] = [];
  private timerText: Phaser.GameObjects.Text | undefined;
  private lastSignature = "";
  private pickSent = false;
  private unbind: Array<() => void> = [];

  constructor() {
    super({ key: "car_select" });
  }

  create(): void {
    this.clearUi();
    this.lastSignature = "";
    this.pickSent = false;
    this.unbindAll();
    this.timerText?.destroy();
    this.timerText = undefined;
    this.room = this.registry.get("room") as Room<ArenaState> | undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    if (!this.room) {
      this.scene.start("join");
      return;
    }

    const local = this.room.state.players.get(this.room.sessionId);
    this.pickSent = Boolean(local?.selectLocked);

    this.timerText = this.add
      .text(640, 72, "", { fontSize: "28px", color: "#ffffff" })
      .setOrigin(0.5);

    this.bindRoom(this.room);
    this.render();
    this.syncTimer();
  }

  update(): void {
    this.syncTimer();
  }

  private onShutdown(): void {
    this.unbindAll();
    this.clearUi();
    this.timerText?.destroy();
    this.timerText = undefined;
    this.lastSignature = "";
    this.pickSent = false;
    this.room = undefined;
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));

    const onState = (): void => {
      this.renderIfChanged();
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

  private clearUi(): void {
    for (const obj of this.ui) obj.destroy();
    this.ui = [];
  }

  private syncTimer(): void {
    const room = this.room;
    const timer = this.timerText;
    if (!room || !timer) return;
    timer.setText(String(remainingSeconds(room.state.carSelectDeadlineTick, room.state.tick)));
  }

  private renderIfChanged(): void {
    const room = this.room;
    if (!room) return;
    const signature = carSelectRenderSignature(room.state);
    if (signature === this.lastSignature) return;
    this.render();
  }

  private render(): void {
    const room = this.room;
    if (!room) return;

    this.lastSignature = carSelectRenderSignature(room.state);
    this.clearUi();

    const local = room.state.players.get(room.sessionId);
    const locked = this.pickSent || Boolean(local?.selectLocked);

    this.addUi(this.add.text(640, 28, "Choose your car", { fontSize: "32px", color: "#ffffff" }).setOrigin(0.5));

    CARD_DEFS.forEach((def, index) => {
      const x = CARD_XS[index] ?? 640;
      const fill = locked ? 0x333333 : 0x2a4a6a;
      const card = this.add.rectangle(x, CARD_Y, CARD_W, CARD_H, fill).setStrokeStyle(2, 0xffffff);
      this.addUi(card);
      if (!locked) {
        card.setInteractive({ useHandCursor: true });
        card.on("pointerup", () => this.onPick(def.id));
      }
      this.addUi(
        this.add.text(x, CARD_Y - 90, def.name, { fontSize: "26px", color: "#ffffff" }).setOrigin(0.5),
      );
      this.addUi(
        this.add
          .text(x, CARD_Y - 20, `Speed ${def.speed}`, { fontSize: "20px", color: "#dddddd" })
          .setOrigin(0.5),
      );
      this.addUi(
        this.add
          .text(x, CARD_Y + 16, `Strength ${def.strength}`, { fontSize: "20px", color: "#dddddd" })
          .setOrigin(0.5),
      );
      this.addUi(
        this.add.text(x, CARD_Y + 52, `HP ${def.hp}`, { fontSize: "20px", color: "#dddddd" }).setOrigin(0.5),
      );
    });

    let row = 0;
    room.state.players.forEach((player, sessionId) => {
      if (sessionId === room.sessionId) return;
      if (player.status !== PlayerStatus.IN_MATCH) return;
      const label = player.carId !== "" ? carLabel(player.carId) : "choosing…";
      this.addUi(
        this.add
          .text(640, 500 + row * 28, `${player.name || sessionId}  ${label}`, {
            fontSize: "18px",
            color: "#bbbbbb",
          })
          .setOrigin(0.5),
      );
      row += 1;
    });
  }

  private onPick(carId: CarId): void {
    const room = this.room;
    if (!room || this.pickSent) return;
    const local = room.state.players.get(room.sessionId);
    if (local?.selectLocked) return;
    this.pickSent = true;
    room.send(MSG_SELECT_CAR, { carId });
    this.render();
  }

  private addUi(obj: Phaser.GameObjects.GameObject): void {
    this.ui.push(obj);
  }
}

function remainingSeconds(deadlineTick: number, tick: number): number {
  return Math.max(0, Math.ceil((deadlineTick - tick) / TICK_RATE_HZ));
}

function carLabel(carId: string): string {
  if (Object.prototype.hasOwnProperty.call(CAR_TABLE, carId)) {
    return CAR_TABLE[carId as CarId].name;
  }
  return carId;
}

function carSelectRenderSignature(state: {
  players: {
    forEach(callback: (player: { name: string; status: number; carId: string; selectLocked: boolean }, sessionId: string) => void): void;
  };
}): string {
  const rows: string[] = [];
  state.players.forEach((player, sessionId) => {
    rows.push(
      `${sessionId}:${player.name}:${player.status}:${player.carId}:${player.selectLocked ? 1 : 0}`,
    );
  });
  rows.sort();
  return rows.join(";");
}
