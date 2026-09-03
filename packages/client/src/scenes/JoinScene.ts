import Phaser from "phaser";
import { joinArena } from "../net/connection.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderJoin, type JoinScreen } from "../ui/screens/join.js";

export class JoinScene extends Phaser.Scene {
  private joining = false;
  private overlay: ScreenOverlay | undefined;
  private screen: JoinScreen | undefined;

  constructor() {
    super({ key: "join" });
  }

  create(): void {
    this.joining = false;
    this.overlay = new ScreenOverlay(this);
    this.screen = renderJoin({
      onSubmit: (name) => void this.onJoin(name),
      onPractice: (name) => {
        // Stashed for PracticeSetupScene, which supplies it as the join option (PR20). No connection
        // is opened here: nothing validates a practice name, so there is nothing to fail.
        this.registry.set("playerName", name);
        this.scene.start("practice-setup");
      },
    });
    this.overlay.render(this.screen.root);
    this.screen.focus();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  private onShutdown(): void {
    this.overlay?.destroy();
    this.overlay = undefined;
    this.screen = undefined;
    this.joining = false;
  }

  private async onJoin(name: string): Promise<void> {
    if (this.joining) return;
    this.joining = true;
    this.screen?.setError("");
    this.screen?.setBusy(true);
    try {
      const room = await joinArena(name);
      this.registry.set("room", room);
      this.scene.start("lobby");
    } catch (err) {
      this.joining = false;
      this.screen?.setBusy(false);
      this.screen?.setError(err instanceof Error ? err.message : String(err));
    }
  }
}
