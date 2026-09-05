import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene.js";
import { JoinScene } from "./scenes/JoinScene.js";
import { PracticeSetupScene } from "./scenes/PracticeSetupScene.js";
import { LobbyScene } from "./scenes/LobbyScene.js";
import { CarSelectScene } from "./scenes/CarSelectScene.js";
import { RevealScene } from "./scenes/RevealScene.js";
import { ArenaScene } from "./scenes/ArenaScene.js";
import { ResultsScene } from "./scenes/ResultsScene.js";
import { PracticeSummaryScene } from "./scenes/PracticeSummaryScene.js";
import { VIEW_HEIGHT, VIEW_WIDTH, bindFullscreenToggle } from "./config/display.js";

declare global {
  interface Window {
    game: Phaser.Game;
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  parent: "game",
  // The dark ground the menu design system now sits its screens on. Only ever visible as the
  // letterbox bars FIT leaves on a non-16:9 window: every scene paints its own ground over it, and
  // the menus (the redesign's scope) are dark now, so a dark bar frames them correctly. The arena's
  // own floor is unchanged and still light — that's a live-gameplay visual, out of this redesign's
  // scope — so a non-16:9 window's letterbox will read as a dark bezel around a bright arena, which
  // is the one place this pick is a trade-off rather than a clean match.
  backgroundColor: "#15120f",
  // FIT keeps the logical 1280x720 and scales it uniformly into the window with letterbox bars:
  // every player sees the same world window, so no monitor shape sees more arena than another.
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  pixelArt: false,
  dom: { createContainer: true },
  scene: [
    BootScene,
    JoinScene,
    PracticeSetupScene,
    LobbyScene,
    CarSelectScene,
    RevealScene,
    ArenaScene,
    ResultsScene,
    PracticeSummaryScene,
  ],
});

window.game = game;
bindFullscreenToggle(window, game.scale);
