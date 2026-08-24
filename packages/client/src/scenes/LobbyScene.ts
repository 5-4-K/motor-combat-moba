import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { PlayerState } from "@motor-combat-moba/shared";
import {
  ArenaState,
  COLOR_TABLE,
  GameMode,
  MSG_KICK,
  MSG_SET_MODE,
  MSG_START_ERROR,
  MSG_START_MATCH,
  MSG_SWITCH_TEAM,
  PlayerStatus,
  badgeColor,
} from "@motor-combat-moba/shared";
import { bindViewRouter } from "../net/view.js";
import { lobbyRenderSignature } from "./lobby-signature.js";

const FALLBACK_HEX = "#888888";
const COL_A_X = 80;
const COL_B_X = 680;
const COL_WIDTH = 520;
const ROW_START_Y = 140;
const ROW_HEIGHT = 56;

type StartErrorPayload = { error: string };

export class LobbyScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private ui: Phaser.GameObjects.GameObject[] = [];
  private startError = "";
  private lastSignature = "";
  private unbind: Array<() => void> = [];

  constructor() {
    super({ key: "lobby" });
  }

  create(): void {
    this.clearUi();
    this.startError = "";
    this.lastSignature = "";
    this.unbindAll();
    this.room = this.registry.get("room") as Room<ArenaState> | undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    if (!this.room) {
      this.scene.start("join");
      return;
    }

    this.bindRoom(this.room);
    this.render();
  }

  private onShutdown(): void {
    this.unbindAll();
    this.clearUi();
    this.startError = "";
    this.lastSignature = "";
    this.room = undefined;
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));

    const onState = (): void => {
      this.renderIfLobbyChanged();
    };
    room.onStateChange(onState);
    this.unbind.push(() => room.onStateChange.remove(onState));

    const onStartError = (payload: StartErrorPayload): void => {
      this.startError = payload?.error ?? "";
      this.render();
    };
    this.unbind.push(room.onMessage(MSG_START_ERROR, onStartError));

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

  private renderIfLobbyChanged(): void {
    const room = this.room;
    if (!room) return;
    const signature = lobbyRenderSignature(room.state);
    if (signature === this.lastSignature) return;
    this.render();
  }

  private render(): void {
    const room = this.room;
    if (!room) return;

    this.lastSignature = lobbyRenderSignature(room.state);
    this.clearUi();

    const teamA: { sessionId: string; player: PlayerState }[] = [];
    const teamB: { sessionId: string; player: PlayerState }[] = [];
    room.state.players.forEach((player, sessionId) => {
      const row = { sessionId, player };
      if (player.team === 1) teamB.push(row);
      else teamA.push(row);
    });

    const local = room.state.players.get(room.sessionId);
    const isHost = room.sessionId === room.state.hostSessionId;

    this.addUi(this.add.text(640, 28, "Lobby", { fontSize: "32px", color: "#ffffff" }).setOrigin(0.5));
    this.addUi(
      this.add
        .text(640, 68, modeLabel(room.state.mode), { fontSize: "18px", color: "#bbbbbb" })
        .setOrigin(0.5),
    );

    this.addUi(this.add.text(COL_A_X, 100, "Team A", { fontSize: "24px", color: "#ffffff" }));
    this.addUi(this.add.text(COL_B_X, 100, "Team B", { fontSize: "24px", color: "#ffffff" }));

    this.drawColumn(COL_A_X, teamA, isHost, room.sessionId);
    this.drawColumn(COL_B_X, teamB, isHost, room.sessionId);

    if (local?.status === PlayerStatus.READY) {
      this.addButton(200, 620, "Switch team", () => {
        room.send(MSG_SWITCH_TEAM);
      });
    }

    if (isHost) {
      const other = room.state.mode === GameMode.FFA ? GameMode.TEAM : GameMode.FFA;
      this.addButton(640, 620, `Switch to ${modeLabel(other)}`, () => {
        room.send(MSG_SET_MODE, { mode: other });
      });
      this.addButton(1080, 620, "Start", () => {
        this.startError = "";
        room.send(MSG_START_MATCH);
        this.render();
      });
    }

    if (this.startError) {
      this.addUi(
        this.add
          .text(640, 680, this.startError, {
            fontSize: "16px",
            color: "#e74c3c",
            wordWrap: { width: 1100 },
            align: "center",
          })
          .setOrigin(0.5),
      );
    }
  }

  private drawColumn(
    x: number,
    rows: { sessionId: string; player: PlayerState }[],
    isHost: boolean,
    localSessionId: string,
  ): void {
    rows.forEach((row, index) => {
      const y = ROW_START_Y + index * ROW_HEIGHT;
      const hex = COLOR_TABLE[row.player.colorId]?.hex ?? FALLBACK_HEX;
      const fill = parseHex(hex);
      const badge = badgeColor(row.player.status);

      this.addUi(this.add.rectangle(x + 16, y + 16, 24, 24, fill).setOrigin(0, 0.5));
      this.addUi(
        this.add.text(x + 52, y, row.player.name || row.sessionId, {
          fontSize: "20px",
          color: "#ffffff",
        }),
      );
      this.addUi(
        this.add.text(x + 52, y + 24, statusLabel(row.player.status), {
          fontSize: "14px",
          color: badge,
        }),
      );

      const canKick =
        isHost &&
        row.sessionId !== localSessionId &&
        (row.player.status === PlayerStatus.READY || row.player.status === PlayerStatus.POST_MATCH);
      if (canKick) {
        this.addButton(x + COL_WIDTH - 40, y + 8, "Kick", () => {
          this.room?.send(MSG_KICK, { sessionId: row.sessionId });
        });
      }
    });
  }

  private addButton(x: number, y: number, label: string, onClick: () => void): void {
    const text = this.add
      .text(x, y, label, { fontSize: "22px", color: "#ffffff" })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    text.on("pointerup", onClick);
    this.addUi(text);
  }

  private addUi(obj: Phaser.GameObjects.GameObject): void {
    this.ui.push(obj);
  }
}

function modeLabel(mode: GameMode): string {
  return mode === GameMode.TEAM ? "Team" : "FFA";
}

function statusLabel(status: PlayerStatus): string {
  if (status === PlayerStatus.IN_MATCH) return "In match";
  if (status === PlayerStatus.POST_MATCH) return "Post-match";
  return "Ready";
}

function parseHex(hex: string): number {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(n) ? n : 0x888888;
}
