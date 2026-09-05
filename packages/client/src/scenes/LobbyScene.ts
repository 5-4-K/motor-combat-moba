import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  ArenaState,
  DEFAULT_GAME_MODE,
  MSG_KICK,
  MSG_SET_MODE,
  MSG_START_ERROR,
  MSG_START_MATCH,
  MSG_SWITCH_TEAM,
} from "@motor-combat-moba/shared";
import { bindViewRouter } from "../net/view.js";
import { lobbyRenderSignature } from "./lobby-signature.js";
import { lobbyView, type LobbyViewPlayer } from "../ui/lobby-view.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderLobby, type LobbyMenus } from "../ui/screens/lobby.js";

type StartErrorPayload = { error: string };

/**
 * Every menu shut and nothing pending. The field initialiser and `create` both need this, and they
 * have to agree: a flag reset in only one of them leaves a modal standing over a lobby the player
 * has just re-entered.
 */
function freshMenus(): LobbyMenus {
  return {
    menuOpen: false,
    modesOpen: false,
    pendingMode: DEFAULT_GAME_MODE,
    kickTarget: null,
    confirmStartOpen: false,
    confirmExitOpen: false,
  };
}

export class LobbyScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private overlay: ScreenOverlay | undefined;
  private startError = "";
  private lastSignature = "";
  private unbind: Array<() => void> = [];
  private menus: LobbyMenus = freshMenus();

  constructor() {
    super({ key: "lobby" });
  }

  create(): void {
    this.startError = "";
    this.lastSignature = "";
    this.menus = freshMenus();
    this.unbindAll();
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
    this.startError = "";
    this.lastSignature = "";
    this.room = undefined;
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));

    const onState = (): void => this.renderIfLobbyChanged();
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

  private renderIfLobbyChanged(): void {
    const room = this.room;
    if (!room) return;
    if (lobbyRenderSignature(room.state) === this.lastSignature) return;
    this.render();
  }

  /** Menu flags live on the scene, so a menu interaction re-renders through the same path as a patch. */
  private setMenus(patch: Partial<LobbyMenus>): void {
    this.menus = { ...this.menus, ...patch };
    this.render();
  }

  private render(): void {
    const room = this.room;
    if (!room || !this.overlay) return;

    this.lastSignature = lobbyRenderSignature(room.state);

    const players: LobbyViewPlayer[] = [];
    room.state.players.forEach((player, sessionId) => {
      players.push({
        sessionId,
        name: player.name,
        colorId: player.colorId,
        team: player.team,
        status: player.status,
      });
    });

    const view = lobbyView(
      { mode: room.state.mode, hostSessionId: room.state.hostSessionId, players },
      room.sessionId,
      this.startError,
    );

    this.overlay.render(
      renderLobby(view, this.menus, {
        onToggleMenu: () => this.setMenus({ menuOpen: !this.menus.menuOpen }),
        onOpenModes: () =>
          this.setMenus({ menuOpen: false, modesOpen: true, pendingMode: room.state.mode }),
        onCloseModes: () => this.setMenus({ modesOpen: false }),
        onPickMode: (mode) => this.setMenus({ pendingMode: mode }),
        onApplyMode: () => {
          room.send(MSG_SET_MODE, { mode: this.menus.pendingMode });
          this.setMenus({ modesOpen: false });
        },
        onSwitchTeam: () => room.send(MSG_SWITCH_TEAM),
        onStart: () => {
          this.startError = "";
          room.send(MSG_START_MATCH);
          this.render();
        },
        onRequestStartConfirm: () => this.setMenus({ confirmStartOpen: true }),
        onCancelStartConfirm: () => this.setMenus({ confirmStartOpen: false }),
        onConfirmStart: () => {
          this.startError = "";
          room.send(MSG_START_MATCH);
          this.setMenus({ confirmStartOpen: false });
        },
        onRequestExit: () => this.setMenus({ menuOpen: false, confirmExitOpen: true }),
        onCancelExit: () => this.setMenus({ confirmExitOpen: false }),
        // Leaving is all this does. `bindRoom`'s `onLeave` is what sends the player home, so Exit
        // and a kick take the identical route out and there is only one `scene.start("join")` to
        // keep honest.
        onConfirmExit: () => void room.leave(),
        onRequestKick: (sessionId, name) => this.setMenus({ kickTarget: { sessionId, name } }),
        onCancelKick: () => this.setMenus({ kickTarget: null }),
        onConfirmKick: () => {
          const target = this.menus.kickTarget;
          if (target) room.send(MSG_KICK, { sessionId: target.sessionId });
          this.setMenus({ kickTarget: null });
        },
      }),
    );
  }
}
