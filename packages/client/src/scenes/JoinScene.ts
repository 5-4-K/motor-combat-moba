import Phaser from "phaser";
import { FLOW_CONFIG } from "@motor-combat-moba/shared";
import { joinArena } from "../net/connection.js";
import { FULLSCREEN_KEY } from "../config/display.js";

const INPUT_STYLE =
  "width: 320px; font-size: 20px; padding: 8px; text-align: center; background: #222; color: #fff; border: 2px solid #555; border-radius: 4px;";

export class JoinScene extends Phaser.Scene {
  private joining = false;
  private errorText: Phaser.GameObjects.Text | undefined;
  private nameInput: Phaser.GameObjects.DOMElement | undefined;
  private joinButton: Phaser.GameObjects.Text | undefined;

  constructor() {
    super({ key: "join" });
  }

  create(): void {
    this.joining = false;
    this.errorText?.destroy();
    this.errorText = undefined;
    this.nameInput?.destroy();
    this.nameInput = undefined;
    this.joinButton?.destroy();
    this.joinButton = undefined;

    this.add
      .text(640, 220, "Enter your name", { fontSize: "28px", color: "#ffffff" })
      .setOrigin(0.5);

    this.nameInput = this.add.dom(640, 290, "input", INPUT_STYLE);
    const el = this.nameInput.node as HTMLInputElement;
    el.type = "text";
    el.placeholder = "Name";
    el.maxLength = FLOW_CONFIG.nameMax;
    el.autocomplete = "off";
    el.spellcheck = false;
    el.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") void this.onJoin();
    });
    el.focus();

    this.joinButton = this.add
      .text(640, 380, "Join", { fontSize: "32px", color: "#ffffff" })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.joinButton.on("pointerup", () => {
      void this.onJoin();
    });

    this.add
      .text(640, 690, `${FULLSCREEN_KEY.toUpperCase()} — fullscreen`, { fontSize: "16px", color: "#777777" })
      .setOrigin(0.5);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  private onShutdown(): void {
    this.nameInput?.destroy();
    this.nameInput = undefined;
    this.errorText = undefined;
    this.joinButton = undefined;
    this.joining = false;
  }

  private async onJoin(): Promise<void> {
    if (this.joining) return;
    this.joining = true;
    this.errorText?.setText("");
    try {
      const name = this.readName();
      const room = await joinArena(name);
      this.registry.set("room", room);
      this.scene.start("lobby");
    } catch (err) {
      this.joining = false;
      const message = err instanceof Error ? err.message : String(err);
      this.showError(message);
    }
  }

  private readName(): string {
    const el = this.nameInput?.node as HTMLInputElement | undefined;
    return (el?.value ?? "").trim();
  }

  private showError(message: string): void {
    if (this.errorText) {
      this.errorText.setText(message);
      return;
    }
    this.errorText = this.add
      .text(640, 450, message, {
        fontSize: "16px",
        color: "#e74c3c",
        wordWrap: { width: 1100 },
        align: "center",
      })
      .setOrigin(0.5);
  }
}
