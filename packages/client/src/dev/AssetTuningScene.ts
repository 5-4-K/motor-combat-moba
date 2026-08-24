import Phaser from "phaser";
import { CAR_TABLE, COLOR_TABLE, DRIVE_CONFIG } from "@motor-combat-moba/shared";
import { CAR_KEY_PREFIX, carSpriteKey } from "../assets/asset-keys.js";
import { applyCarSprite, phaserTextures, resolveCarSprite } from "../assets/car-sprite.js";
import { assetManifest } from "../scenes/BootScene.js";
import { carFillOf } from "../scenes/car-visual.js";

/**
 * Grepped by scripts/build-release.mjs to prove this scene is absent from a release build. A local
 * literal rather than an import of `DEV_TOOL_MARKER`, deliberately: the string must be physically
 * present in *this* module, so the check still fires if the scene ever reaches a bundle by a route
 * that bypasses the registry.
 */
const MARKER = "MOTOR DEV TOOL";

const CELL_W = 220;
const CELL_H = 190;
const COLUMNS = 3;
const HULL_STROKE = 0xffffff;

/**
 * Every chassis in `CAR_TABLE` parked on its own hull, with no server connection. Chassis, not every
 * manifest entry: `power.*` and `projectile.*` rows are out of scope here until something in the sim
 * draws them.
 *
 * It exists because `rotationOffset`, `scale`, and `origin` have to be tuned by eye per sprite, and
 * the alternative loop is a full rejoin per attempt: the client has no reconnect or session
 * persistence, so a reload drops you back to the name prompt, the lobby, and car select before you
 * can look at one car again.
 *
 * Dev-only. `BootScene` gates the dynamic import behind `import.meta.env.DEV`, which Vite replaces
 * with the literal `false` in a production build, so this module is never emitted into `dist`.
 */
export class AssetTuningScene extends Phaser.Scene {
  constructor() {
    // `BootScene` registers this under `dev.assets`; the key here is overridden at `scene.add` time,
    // so it only matters that it is stable and does not collide with a game scene.
    super({ key: "dev.assets" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x1d1f21);
    this.add.text(16, 12, MARKER, { fontSize: "20px", color: "#ffffff" });

    const manifest = assetManifest();
    // Counted car-scoped, because the cells below are car-scoped. Counting every manifest key would
    // let the header claim "4 entries" over three cells the moment a `power.*` row exists.
    const carKeys = Object.keys(manifest.sprites).filter((key) => key.startsWith(CAR_KEY_PREFIX));
    this.add.text(16, 38, this.summary(carKeys.length), {
      fontSize: "13px",
      color: "#9aa0a6",
    });

    const cars = Object.keys(CAR_TABLE);
    cars.forEach((carId, index) => this.drawCell(carId, index));
  }

  private summary(entryCount: number): string {
    const chassis = Object.keys(CAR_TABLE).length;
    return `${entryCount} car entr${entryCount === 1 ? "y" : "ies"} - ${chassis} chassis - white box is the OBB hitbox - reload after editing art`;
  }

  /** One chassis: its hull, its art (or the fact that it has none), and its manifest key. */
  private drawCell(carId: string, index: number): void {
    const x = 130 + (index % COLUMNS) * CELL_W;
    const y = 140 + Math.floor(index / COLUMNS) * CELL_H;
    const { carWidth: w, carHeight: h } = DRIVE_CONFIG;
    const key = carSpriteKey(carId);
    const entry = assetManifest().sprites[key];
    const fill = carFillOf(COLOR_TABLE[index % COLOR_TABLE.length].colorId);

    // Resolved by the same function `ArenaScene.spriteFor` calls, so "no art" here means exactly
    // what the silhouette fallback means in a match, and the composition cannot drift between them.
    const resolved = resolveCarSprite(
      assetManifest(),
      phaserTextures(this.textures),
      carId,
      { width: w, height: h },
    );
    if (resolved) {
      applyCarSprite(this.add.image(x, y, resolved.key), resolved, fill);
    } else {
      this.add.text(x, y - 8, "no art", { fontSize: "13px", color: "#d94040" }).setOrigin(0.5);
    }

    // Drawn on top of the art, so a sprite that overflows its collision box is obvious rather than
    // hidden underneath it.
    const box = this.add.graphics();
    box.lineStyle(1, HULL_STROKE, 1);
    box.strokeRect(x - w / 2, y - h / 2, w, h);

    // The sim's forward is +x. A sprite whose nose does not point along this needs a rotationOffset.
    box.lineStyle(1, HULL_STROKE, 0.5);
    box.lineBetween(x, y, x + w, y);

    this.add.text(x, y + 46, key, { fontSize: "12px", color: "#ffffff" }).setOrigin(0.5);
    this.add
      .text(x, y + 64, entry ? `scale ${String(entry.scale)} rot ${entry.rotationOffset}` : "-", {
        fontSize: "11px",
        color: "#9aa0a6",
      })
      .setOrigin(0.5);
  }
}
