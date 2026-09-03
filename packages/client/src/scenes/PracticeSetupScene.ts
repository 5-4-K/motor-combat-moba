import Phaser from "phaser";
import { PRACTICE_INVALID_SETUP_ERROR, isArenaId, type PracticeSetup } from "@motor-combat-moba/shared";
import { joinPractice } from "../net/connection.js";
import { loadPracticeSetup, savePracticeSetup } from "../practice/storage.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderPracticeSetup, type PracticeSetupScreen } from "../ui/screens/practice-setup.js";

/**
 * The practice settings page (spec PR21). Settings are chosen here and fixed for the session — there
 * is no mid-session reconfiguration (PR2), which is why they ride as join options rather than as a
 * message the room could accept later.
 *
 * A capacity refusal (PR25, code 4007) is an inline error on THIS screen: the player never left it,
 * and routing them somewhere else to read the reason would be a worse answer than re-enabling Start.
 */
export class PracticeSetupScene extends Phaser.Scene {
  private starting = false;
  private overlay: ScreenOverlay | undefined;
  private screen: PracticeSetupScreen | undefined;

  constructor() {
    super({ key: "practice-setup" });
  }

  create(): void {
    this.starting = false;
    this.overlay = new ScreenOverlay(this);
    this.screen = renderPracticeSetup(
      {
        onStart: (partial) => void this.onStart(partial),
        onBack: () => this.scene.start("join"),
      },
      loadPracticeSetup(),
    );
    this.overlay.render(this.screen.root);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    // Set by `ArenaScene` just before routing here off close code 4006 (spec PR25) — an idle
    // session ended somewhere the player never chose to leave, so this screen is where they land
    // and where they read why. Cleared on read so it cannot resurface on a later, unrelated visit.
    const notice = this.registry.get("practiceNotice") as string | undefined;
    if (notice) {
      this.registry.remove("practiceNotice");
      this.screen.setError(notice);
    }
  }

  private async onStart(partial: Omit<PracticeSetup, "name">): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.screen?.setError("");
    this.screen?.setBusy(true);
    // The name was captured on the join screen and falls back to "Player" when blank (PR20).
    const name = (this.registry.get("playerName") as string | undefined) ?? "Player";
    const setup: PracticeSetup = { ...partial, name };
    savePracticeSetup(setup);
    try {
      const room = await joinPractice(setup);
      this.registry.set("room", room);
      // `joinPractice` resolves on the JOIN_ROOM handshake, which lands before the room's first
      // full state patch — everywhere else that gap is invisible (Lobby renders an empty roster for
      // one frame), but this is the one path that jumps straight from a settings screen into
      // `ArenaScene`, whose `create()` reads `state.arenaId` synchronously and treats an unsynced
      // state exactly like a real client/server mismatch (found by hand-testing this task's walk;
      // see task-14-report.md). Waiting one state patch when that race is actually hit costs nothing
      // once state has already arrived, which is the common case.
      if (!isArenaId(room.state.arenaId)) {
        await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
      }
      this.scene.start("arena");
    } catch (err) {
      this.starting = false;
      this.screen?.setBusy(false);
      // `ServerError` (what every real refusal — 4006-4009 alike — rejects with) extends `Error`, so
      // `err.message` already carries the server's own text; this fallback only guards a rejection
      // shaped by something other than the room, which reads closer to a malformed request than to
      // any of the room's own reasons.
      this.screen?.setError(err instanceof Error ? err.message : PRACTICE_INVALID_SETUP_ERROR);
    }
  }

  private onShutdown(): void {
    this.overlay?.destroy();
    this.overlay = undefined;
    this.screen = undefined;
    this.starting = false;
  }
}
