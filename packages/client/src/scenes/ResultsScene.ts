import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { CarId } from "@motor-combat-moba/shared";
import { ArenaState, CAR_TABLE, MSG_RETURN_TO_LOBBY, PlayerStatus } from "@motor-combat-moba/shared";
import { bindViewRouter } from "../net/view.js";

const STANDINGS_KEY = "resultsStandings";

type ResultsStandings = {
  title: string;
  roster: { name: string; carId: string }[];
};

export class ResultsScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private standings: ResultsStandings | undefined;
  private unbind: Array<() => void> = [];

  constructor() {
    super({ key: "results" });
  }

  create(): void {
    this.unbindAll();
    this.room = this.registry.get("room") as Room<ArenaState> | undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    if (!this.room) {
      this.scene.start("join");
      return;
    }

    this.standings = captureStandings(this.room.state);
    this.registry.set(STANDINGS_KEY, this.standings);
    this.bindRoom(this.room);
    this.render();
  }

  private onShutdown(): void {
    this.unbindAll();
    this.registry.remove(STANDINGS_KEY);
    this.standings = undefined;
    this.room = undefined;
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));

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

  private render(): void {
    const room = this.room;
    const standings = this.standings;
    if (!room || !standings) return;

    this.add.text(640, 48, standings.title, { fontSize: "40px", color: "#ffffff" }).setOrigin(0.5);

    standings.roster.forEach((row, index) => {
      const car = row.carId ? carLabel(row.carId) : "";
      const line = car ? `${row.name}  ${car}` : row.name;
      this.add
        .text(640, 140 + index * 36, line, { fontSize: "22px", color: "#dddddd" })
        .setOrigin(0.5);
    });

    const back = this.add
      .text(640, 620, "Back to lobby", { fontSize: "28px", color: "#ffffff" })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    back.on("pointerup", () => {
      room.send(MSG_RETURN_TO_LOBBY);
    });
  }
}

function captureStandings(state: {
  winnerSessionId: string;
  winnerTeam: number;
  players: {
    get(sessionId: string): { name: string } | undefined;
    forEach(callback: (player: { name: string; status: number; carId: string }, sessionId: string) => void): void;
  };
}): ResultsStandings {
  return {
    title: resultsTitle(state),
    roster: snapshotRoster(state),
  };
}

function resultsTitle(state: {
  winnerSessionId: string;
  winnerTeam: number;
  players: { get(sessionId: string): { name: string } | undefined };
}): string {
  if (state.winnerSessionId) {
    const name = state.players.get(state.winnerSessionId)?.name;
    return name || state.winnerSessionId;
  }
  if (state.winnerTeam === 0) return "Team A";
  if (state.winnerTeam === 1) return "Team B";
  return "Draw";
}

function snapshotRoster(state: {
  players: {
    forEach(callback: (player: { name: string; status: number; carId: string }, sessionId: string) => void): void;
  };
}): { name: string; carId: string }[] {
  const roster: { name: string; carId: string }[] = [];
  state.players.forEach((player, sessionId) => {
    if (player.status !== PlayerStatus.POST_MATCH && player.status !== PlayerStatus.IN_MATCH) return;
    roster.push({ name: player.name || sessionId, carId: player.carId });
  });
  roster.sort((a, b) => a.name.localeCompare(b.name));
  return roster;
}

function carLabel(carId: string): string {
  if (Object.prototype.hasOwnProperty.call(CAR_TABLE, carId)) {
    return CAR_TABLE[carId as CarId].name;
  }
  return carId;
}
