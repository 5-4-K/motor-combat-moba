import Phaser from "phaser";
import type { Room } from "colyseus.js";
import { ArenaState } from "@motor-combat-moba/shared";
import { bindViewRouter } from "../net/view.js";
import { revealView, type RevealViewPlayer } from "../ui/reveal-view.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderReveal } from "../ui/screens/reveal.js";

/**
 * The "cars locked in" grid. Re-renders only when the displayed second changes rather than on every
 * patch, so the countdown ticks once a second instead of rebuilding the grid twenty times a second.
 *
 * Nothing advances the screen from here: `bindViewRouter` moves everyone on when the server flips
 * the phase to COUNTDOWN.
 */
export class RevealScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private overlay: ScreenOverlay | undefined;
  private lastSecond = -1;
  private unbind: Array<() => void> = [];

  constructor() {
    super({ key: "reveal" });
  }

  create(): void {
    this.unbindAll();
    this.lastSecond = -1;
    this.overlay = new ScreenOverlay(this);
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
    this.overlay?.destroy();
    this.overlay = undefined;
    this.lastSecond = -1;
    this.room = undefined;
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));

    const onState = (): void => this.render();
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

  private render(): void {
    const room = this.room;
    if (!room || !this.overlay) return;

    const players: RevealViewPlayer[] = [];
    room.state.players.forEach((player, sessionId) => {
      players.push({
        sessionId,
        name: player.name,
        colorId: player.colorId,
        team: player.team,
        carId: player.carId,
        status: player.status,
      });
    });

    const view = revealView(
      {
        mode: room.state.mode,
        hostSessionId: room.state.hostSessionId,
        tick: room.state.tick,
        revealEndsTick: room.state.revealEndsTick,
        players,
      },
      room.sessionId,
    );

    if (view.secondsLeft === this.lastSecond) return;
    this.lastSecond = view.secondsLeft;
    this.overlay.render(renderReveal(view));
  }
}
