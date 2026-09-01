import Phaser from "phaser";
import type { Room } from "colyseus.js";
import { ArenaState, MSG_RETURN_TO_LOBBY } from "@motor-combat-moba/shared";
import { bindViewRouter } from "../net/view.js";
import { resultsView, type ResultsView, type ResultsViewPlayer } from "../ui/results-view.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderResults } from "../ui/screens/results.js";

const STANDINGS_KEY = "resultsStandings";

export class ResultsScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private overlay: ScreenOverlay | undefined;
  private view: ResultsView | undefined;
  private unbind: Array<() => void> = [];

  constructor() {
    super({ key: "results" });
  }

  create(): void {
    this.unbindAll();
    this.overlay = new ScreenOverlay(this);
    this.room = this.registry.get("room") as Room<ArenaState> | undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    if (!this.room) {
      this.scene.start("join");
      return;
    }

    // Snapshotted once on entry: statuses flip to READY as players head back to the lobby, and a
    // scoreboard that empties itself while you are reading it is worse than a stale one.
    this.view = this.snapshot(this.room);
    this.registry.set(STANDINGS_KEY, this.view);
    this.bindRoom(this.room);
    this.render();
  }

  private snapshot(room: Room<ArenaState>): ResultsView {
    const players: ResultsViewPlayer[] = [];
    room.state.players.forEach((player, sessionId) => {
      players.push({
        sessionId,
        name: player.name,
        colorId: player.colorId,
        team: player.team,
        carId: player.carId,
        status: player.status,
        kills: player.kills,
        deaths: player.deaths,
      });
    });

    return resultsView(
      {
        mode: room.state.mode,
        winnerSessionId: room.state.winnerSessionId,
        winnerTeam: room.state.winnerTeam,
        tick: room.state.tick,
        matchStartedAtTick: room.state.matchStartedAtTick,
        players,
      },
      room.sessionId,
    );
  }

  private onShutdown(): void {
    this.unbindAll();
    this.registry.remove(STANDINGS_KEY);
    this.overlay?.destroy();
    this.overlay = undefined;
    this.view = undefined;
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
    const view = this.view;
    if (!room || !view || !this.overlay) return;

    this.overlay.render(
      renderResults(view, { onBackToLobby: () => room.send(MSG_RETURN_TO_LOBBY) }),
    );
  }
}
