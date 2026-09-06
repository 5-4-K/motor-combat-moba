import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  ArenaState,
  CHAT_CONFIG,
  DEFAULT_GAME_MODE,
  MSG_CHAT,
  MSG_KICK,
  MSG_SET_MODE,
  MSG_START_ERROR,
  MSG_START_MATCH,
  MSG_SWITCH_TEAM,
  validateChatText,
} from "@motor-combat-moba/shared";
import { bindViewRouter } from "../net/view.js";
import { lobbyRenderSignature } from "./lobby-signature.js";
import { lobbyView, type LobbyViewPlayer } from "../ui/lobby-view.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderLobby, type LobbyMenus } from "../ui/screens/lobby.js";
import { shouldPinToBottom } from "../ui/screens/chat.js";
import type { ChatViewRow } from "../ui/chat-view.js";

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
    chatDraft: "",
  };
}

/** What has to survive the lobby's wholesale re-render (LC21, LC22). */
type ChatUiSnapshot = {
  focused: boolean;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  pinToBottom: boolean;
};

export class LobbyScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private overlay: ScreenOverlay | undefined;
  private startError = "";
  private lastSignature = "";
  private unbind: Array<() => void> = [];
  private menus: LobbyMenus = freshMenus();
  /**
   * Wall-clock time of the last chat send this scene made, mirroring the server's own
   * `chatLastSentAt` (LC20) so a cooldown refusal can keep the player's draft instead of silently
   * eating it. This is advisory only: it is a local echo of the server's clock, not the gate itself
   * — network jitter can still land two sends inside the server's window, in which case the server
   * remains the authority and drops the second one silently, same as always.
   */
  private chatLastSentAt = 0;

  constructor() {
    super({ key: "lobby" });
  }

  create(): void {
    this.startError = "";
    this.lastSignature = "";
    this.menus = freshMenus();
    this.chatLastSentAt = 0;
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
    this.chatLastSentAt = 0;
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

    const chat: ChatViewRow[] = [];
    room.state.chat.forEach((message) => {
      chat.push({
        seq: message.seq,
        sessionId: message.sessionId,
        name: message.name,
        colorId: message.colorId,
        text: message.text,
        at: message.at,
      });
    });

    const view = lobbyView(
      { mode: room.state.mode, hostSessionId: room.state.hostSessionId, players, chat },
      room.sessionId,
      this.startError,
    );

    const chatUi = this.captureChatUi();
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
        // Deliberately does not re-render: the character is already on screen, and rebuilding the
        // whole lobby on every keystroke would be absurd.
        onChatInput: (text) => {
          this.menus = { ...this.menus, chatDraft: text };
        },
        onChatSend: () => this.sendChat(),
      }),
    );
    this.restoreChatUi(chatUi);
  }

  /**
   * Send if the draft is sendable, then clear it. The server re-validates (invariant 3); this call
   * only avoids sending something we already know it will refuse.
   *
   * The cooldown check below is different from the text validation above: `validateChatText` runs
   * the identical rule on both ends, so a server-side refusal on that gate can only mean a stale or
   * hostile client and the message is fine to discard silently. The cooldown is not that — an honest
   * player can easily hit it (send "gg", immediately send "wp") — and the client has no way to learn
   * the server refused, since a cooldown drop earns no reply. So this mirrors the server's own
   * `chatLastSentAt` gate locally and, when it would trip, bails out **before** sending and **without
   * clearing the draft**, so the player keeps their text and can just press Enter again. This is
   * advisory only: it is a local echo of the server's clock, not the gate itself, so network jitter
   * can still let two sends land inside the server's real window — in which case the server remains
   * the authority and drops the second one the same way it always has.
   */
  private sendChat(): void {
    const room = this.room;
    if (!room) return;
    const result = validateChatText(this.menus.chatDraft);
    if (!result.ok) return;
    if (Date.now() - this.chatLastSentAt < CHAT_CONFIG.sendCooldownMs) return;
    room.send(MSG_CHAT, { text: result.text });
    this.chatLastSentAt = Date.now();
    this.menus = { ...this.menus, chatDraft: "" };
    this.render();
  }

  private captureChatUi(): ChatUiSnapshot | null {
    const input = document.querySelector<HTMLInputElement>("[data-chat-input]");
    const list = document.querySelector<HTMLElement>("[data-chat-list]");
    if (!input || !list) return null;
    return {
      focused: document.activeElement === input,
      selectionStart: input.selectionStart ?? input.value.length,
      selectionEnd: input.selectionEnd ?? input.value.length,
      scrollTop: list.scrollTop,
      pinToBottom: shouldPinToBottom(list.scrollTop, list.scrollHeight, list.clientHeight),
    };
  }

  /**
   * A null snapshot means this is the first render of the panel, which should open at the newest
   * message — so it pins. Selection is restored as a range, not a caret at the end: being teleported
   * out of the middle of a half-typed sentence is the same bug in a milder form.
   */
  private restoreChatUi(snapshot: ChatUiSnapshot | null): void {
    const input = document.querySelector<HTMLInputElement>("[data-chat-input]");
    const list = document.querySelector<HTMLElement>("[data-chat-list]");
    if (list) {
      list.scrollTop = snapshot === null || snapshot.pinToBottom ? list.scrollHeight : snapshot.scrollTop;
    }
    if (!input || snapshot === null || !snapshot.focused) return;
    // Inside a Phaser DOM container under a scale transform, a bare `focus()` can nudge the
    // container's own scroll position; `preventScroll` keeps this to just the input.
    input.focus({ preventScroll: true });
    // After a send, the captured offsets were measured against the pre-clear draft and are now
    // applied to a freshly emptied input. `setSelectionRange` is specified to clamp out-of-range
    // offsets to the value's length, so this lands the caret at 0 rather than throwing.
    input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}
