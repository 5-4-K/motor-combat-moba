import Phaser from "phaser";
import type { Room } from "@colyseus/sdk";
import { ArenaState, MSG_ARENA_HIGHLIGHT, MSG_ARENA_PICK, modeConfigOrDefault } from "@motor-combat-moba/shared";
import { bindViewRouter } from "../net/view.js";
import { arenaCards, type ArenaCard } from "../ui/arena-cards.js";
import { arenaSelectView, inRouletteWindow, type ArenaSelectStage } from "../ui/arena-select-view.js";
import { secondsLeft } from "../ui/reveal-view.js";
import { modeLabel } from "../ui/lobby-view.js";
import { rouletteFrames } from "../ui/roulette.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderArenaSelect } from "../ui/screens/arena-select.js";
import { assetManifest } from "./BootScene.js";

/**
 * Arena select (spec AR25-AR36). The host's highlight and pick are server state; this scene draws
 * them and sends intents. The roulette is local theatre scripted to land on the arena the server
 * already chose, and plays only when this client first sees a random pick inside its window.
 */
export class ArenaSelectScene extends Phaser.Scene {
  private room: Room<ArenaState> | undefined;
  private overlay: ScreenOverlay | undefined;
  private unbind: Array<() => void> = [];
  private cards: ArenaCard[] = [];
  private stage: ArenaSelectStage = "choosing";
  /** During the roulette, the card the spin is on; otherwise null and the server's highlight shows. */
  private spinIndex: number | null = null;
  /** The highlight just before the pick landed — where the roulette starts spinning from. */
  private lastChoosingHighlight = "";
  private lastKey = "";
  private rouletteTimer: Phaser.Time.TimerEvent | undefined;

  constructor() {
    super({ key: "arena_select" });
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
    this.cards = arenaCards(this.room.state.mode, assetManifest());
    this.stage = "choosing";
    this.spinIndex = null;
    this.lastChoosingHighlight = this.room.state.arenaHighlightId;
    this.lastKey = "";
    this.bindRoom(this.room);
    this.sync();
  }

  private onShutdown(): void {
    this.unbindAll();
    this.rouletteTimer?.remove();
    this.rouletteTimer = undefined;
    this.overlay?.destroy();
    this.overlay = undefined;
    this.room = undefined;
  }

  private unbindAll(): void {
    for (const fn of this.unbind) fn();
    this.unbind = [];
  }

  private bindRoom(room: Room<ArenaState>): void {
    this.unbind.push(bindViewRouter(this, room));
    const onState = (): void => this.sync();
    room.onStateChange(onState);
    this.unbind.push(() => room.onStateChange.remove(onState));
    const onLeave = (): void => {
      this.registry.remove("room");
      this.scene.start("join");
    };
    room.onLeave(onLeave);
    this.unbind.push(() => room.onLeave.remove(onLeave));
  }

  /** Moves the local stage forward from server state, starting the roulette when it is owed. */
  private sync(): void {
    const s = this.room?.state;
    if (!s) return;
    if (this.stage === "choosing") {
      if (s.arenaRevealEndsTick === 0) {
        this.lastChoosingHighlight = s.arenaHighlightId;
      } else {
        const flowTable = modeConfigOrDefault(s.mode).flow;
        const target = this.cards.findIndex((c) => c.id === s.arenaId);
        const playRoulette =
          s.arenaPickRandom && this.cards.length > 1 && target >= 0 &&
          inRouletteWindow(s.tick, s.arenaRevealEndsTick, flowTable.arenaRevealSeconds);
        if (playRoulette) this.startRoulette(target, flowTable.arenaRouletteSeconds * 1000);
        else this.stage = "revealed";
      }
    }
    this.render();
  }

  private startRoulette(target: number, budgetMs: number): void {
    this.stage = "roulette";
    const from = Math.max(0, this.cards.findIndex((c) => c.id === this.lastChoosingHighlight));
    const frames = rouletteFrames(this.cards.length, from, target, budgetMs);
    const step = (i: number): void => {
      if (!this.room) return;
      if (i >= frames.length) {
        this.spinIndex = null;
        this.stage = "revealed";
        this.render();
        return;
      }
      this.spinIndex = frames[i].index;
      this.render();
      this.rouletteTimer = this.time.delayedCall(frames[i].holdMs, () => step(i + 1));
    };
    step(0);
  }

  private render(): void {
    const room = this.room;
    if (!room || !this.overlay) return;
    const s = room.state;
    const highlightId = this.spinIndex !== null ? this.cards[this.spinIndex]?.id ?? "" : s.arenaHighlightId;
    const view = arenaSelectView({
      cards: this.cards,
      modeLabel: modeLabel(s.mode),
      highlightId,
      chosenId: s.arenaRevealEndsTick > 0 ? s.arenaId : null,
      isHost: s.hostSessionId === room.sessionId,
      stage: this.stage,
      secondsLeft: secondsLeft(s.arenaSelectDeadlineTick, s.tick),
      revealSecondsLeft: secondsLeft(s.arenaRevealEndsTick, s.tick),
    });
    // AR35: the revealed stage mounts once (its CSS animations must not restart); afterwards only the
    // count text changes. Every other stage re-renders when something it shows changes.
    const key = view.stage === "revealed" ? "revealed" : `${view.stage}|${highlightId}|${view.clock}|${view.canAct}`;
    if (key === this.lastKey) {
      if (view.stage === "revealed") {
        const count = this.overlay.mount().querySelector<HTMLElement>("[data-reveal-count]");
        if (count && count.textContent !== view.revealLabel) count.textContent = view.revealLabel;
      }
      return;
    }
    this.lastKey = key;
    this.overlay.render(
      renderArenaSelect(view, {
        onHighlight: (arenaId) => room.send(MSG_ARENA_HIGHLIGHT, { arenaId }),
        onSelect: () => room.send(MSG_ARENA_PICK, { arenaId: room.state.arenaHighlightId }),
        onRandom: () => room.send(MSG_ARENA_PICK, { random: true }),
      }),
    );
  }
}
