import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene.js";
import { JoinScene } from "./scenes/JoinScene.js";
import { LobbyScene } from "./scenes/LobbyScene.js";
import { CarSelectScene } from "./scenes/CarSelectScene.js";
import { ArenaScene } from "./scenes/ArenaScene.js";
import { ResultsScene } from "./scenes/ResultsScene.js";

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
  dom: { createContainer: true },
  scene: [BootScene, JoinScene, LobbyScene, CarSelectScene, ArenaScene, ResultsScene],
});

window.game = game;
