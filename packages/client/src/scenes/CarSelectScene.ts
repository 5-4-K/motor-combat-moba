import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  ArenaState,
  DEFAULT_CAR_ID,
  MSG_PREVIEW_CAR,
  MSG_SELECT_CAR,
  type CarId,
} from "@motor-combat-moba/shared";
import { bindViewRouter } from "../net/view.js";
import { carSelectView } from "../ui/car-select-view.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderCarSelect } from "../ui/screens/car-select.js";

/**
 * Car select. Picking a card is not a commitment — it sends `MSG_PREVIEW_CAR`, which records the
 * choice without locking it; "Lock in" sends `MSG_SELECT_CAR` and closes it. The split exists so the
 * deadline can be kind: whoever the clock catches keeps the car they were sitting on, chosen or
 * defaulted. Nothing about it is a gamble.
 *
 * The screen opens on `DEFAULT_CAR_ID`, and the server's deadline fallback is that same constant, so
 * a player who never touches the screen is handed exactly the car it had selected for them all
 * along. Nothing about the pick is random, which is why the screen carries no warning about running
 * out of time — there is no penalty to warn about.
 */
export class CarSelectScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private overlay: ScreenOverlay | undefined;
  private selected: CarId = DEFAULT_CAR_ID;
  private locked = false;
  private lastSecond = -1;
  private unbind: Array<() => void> = [];

  constructor() {
    super({ key: "car_select" });
  }

  create(): void {
    this.unbindAll();
    this.selected = DEFAULT_CAR_ID;
    this.lastSecond = -1;
    this.overlay = new ScreenOverlay(this);
    this.room = this.registry.get("room") as Room<ArenaState> | undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    if (!this.room) {
      this.scene.start("join");
      return;
    }

    this.locked = Boolean(this.room.state.players.get(this.room.sessionId)?.selectLocked);
    this.bindRoom(this.room);
    this.render();
  }

  private onShutdown(): void {
    this.unbindAll();
    this.overlay?.destroy();
    this.overlay = undefined;
    this.locked = false;
    this.lastSecond = -1;
    this.room = undefined;
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));

    const onState = (): void => {
      const wasLocked = this.locked;
      this.locked = Boolean(room.state.players.get(room.sessionId)?.selectLocked);
      this.render(wasLocked !== this.locked);
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

  private pick(carId: CarId): void {
    if (this.locked || carId === this.selected) return;
    this.selected = carId;
    // Tell the server immediately, without locking. If the deadline arrives before this player
    // presses Lock in, they still get this car — which only works if the server was told, so the
    // preview goes out on the pick rather than waiting for the commit.
    this.room?.send(MSG_PREVIEW_CAR, { carId });
    this.render(true);
  }

  private lockIn(): void {
    if (this.locked || !this.room) return;
    this.room.send(MSG_SELECT_CAR, { carId: this.selected });
  }

  /** Redraws on a changed second, or when `force` marks a selection or lock the clock cannot see. */
  private render(force = true): void {
    const room = this.room;
    if (!room || !this.overlay) return;

    const view = carSelectView(
      {
        mode: room.state.mode,
        tick: room.state.tick,
        carSelectDeadlineTick: room.state.carSelectDeadlineTick,
      },
      this.selected,
      this.locked,
    );

    if (!force && view.secondsLeft === this.lastSecond) return;
    this.lastSecond = view.secondsLeft;
    this.overlay.render(
      renderCarSelect(view, {
        onPick: (carId) => this.pick(carId),
        onLockIn: () => this.lockIn(),
      }),
    );
  }
}
