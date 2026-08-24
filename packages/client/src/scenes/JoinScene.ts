import Phaser from "phaser";
import { joinArena } from "../net/connection.js";

export class JoinScene extends Phaser.Scene {
  private joining = false;
  private errorText: Phaser.GameObjects.Text | undefined;

  constructor() {
    super({ key: "join" });
  }

  create(): void {
    this.joining = false;
    this.errorText?.destroy();
    this.errorText = undefined;

    const joinText = this.add
      .text(640, 360, "Join", { fontSize: "32px", color: "#ffffff" })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    joinText.on("pointerup", () => {
      void this.onJoin();
    });
  }

  private async onJoin(): Promise<void> {
    if (this.joining) return;
    this.joining = true;
    try {
      const room = await joinArena();
      this.registry.set("room", room);
      this.scene.start("arena");
    } catch (err) {
      this.joining = false;
      const message = err instanceof Error ? err.message : String(err);
      this.showError(message);
    }
  }

  private showError(message: string): void {
    if (this.errorText) {
      this.errorText.setText(message);
      return;
    }
    this.errorText = this.add
      .text(640, 430, message, {
        fontSize: "16px",
        color: "#e74c3c",
        wordWrap: { width: 1100 },
        align: "center",
      })
      .setOrigin(0.5);
  }
}
