import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "boot" });
  }

  create(): void {
    this.scene.start("join");
  }
}
