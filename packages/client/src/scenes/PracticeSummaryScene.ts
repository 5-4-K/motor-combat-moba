import Phaser from "phaser";
import { ScreenOverlay } from "../ui/overlay.js";
import {
  practiceSummaryRows,
  renderPracticeSummary,
  type PracticeSummaryPlayer,
} from "../ui/screens/practice-summary.js";

const SUMMARY_KEY = "practiceSummary";

interface PracticeSummarySnapshot {
  players: PracticeSummaryPlayer[];
  humanSessionId: string;
}

/**
 * The practice session summary (spec PR24). Modeled on `JoinScene`'s lifecycle: an overlay mounted
 * in `create`, torn down on `SHUTDOWN`.
 *
 * The room is already gone by the time this scene runs — `exitPractice` snapshots kills/deaths
 * BEFORE leaving and hands them over through the registry, because Colyseus state disappears the
 * moment the room is left (the same discipline `ResultsScene.snapshot()` follows). This scene only
 * ever reads that snapshot; it never touches a `Room`.
 */
export class PracticeSummaryScene extends Phaser.Scene {
  private overlay: ScreenOverlay | undefined;

  constructor() {
    super({ key: "practice-summary" });
  }

  create(): void {
    this.overlay = new ScreenOverlay(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    const snapshot = this.registry.get(SUMMARY_KEY) as PracticeSummarySnapshot | undefined;
    // A missing snapshot means this scene was started out of order (never via `exitPractice`) — an
    // empty table would just confuse the player, so send them back to where a session actually starts.
    if (!snapshot) {
      this.scene.start("practice-setup");
      return;
    }

    this.registry.remove(SUMMARY_KEY);
    const rows = practiceSummaryRows(snapshot.players, snapshot.humanSessionId);
    const screen = renderPracticeSummary(rows, { onBack: () => this.scene.start("practice-setup") });
    this.overlay.render(screen.root);
  }

  private onShutdown(): void {
    this.overlay?.destroy();
    this.overlay = undefined;
  }
}
