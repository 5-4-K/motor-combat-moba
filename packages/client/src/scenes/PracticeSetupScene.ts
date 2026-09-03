import Phaser from "phaser";
import { PRACTICE_FULL_ERROR, type PracticeSetup } from "@motor-combat-moba/shared";
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
      this.scene.start("arena");
    } catch (err) {
      this.starting = false;
      this.screen?.setBusy(false);
      this.screen?.setError(err instanceof Error ? err.message : PRACTICE_FULL_ERROR);
    }
  }

  private onShutdown(): void {
    this.overlay?.destroy();
    this.overlay = undefined;
    this.screen = undefined;
    this.starting = false;
  }
}
