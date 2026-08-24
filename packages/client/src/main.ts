import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene.js";
import { JoinScene } from "./scenes/JoinScene.js";
import { ArenaScene } from "./scenes/ArenaScene.js";

declare global {
  interface Window {
    game: Phaser.Game;
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: "game",
  backgroundColor: "#111111",
  pixelArt: false,
  scene: [BootScene, JoinScene, ArenaScene],
});

window.game = game;
