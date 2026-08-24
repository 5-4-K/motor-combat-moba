import Phaser from "phaser";
import { CAR_TABLE, COLOR_TABLE, DRIVE_CONFIG } from "@motor-combat-moba/shared";
import { carSpriteKey } from "../assets/asset-keys.js";
import { fitSprite } from "../assets/sprite-fit.js";
import { assetManifest } from "../scenes/BootScene.js";

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
 * Every manifest entry parked on its own hull, with no server connection.
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
    const keys = Object.keys(manifest.sprites);
    this.add.text(16, 38, this.summary(keys.length), {
      fontSize: "13px",
      color: "#9aa0a6",
    });

    const cars = Object.keys(CAR_TABLE);
    cars.forEach((carId, index) => this.drawCell(carId, index));
  }

  private summary(entryCount: number): string {
    const chassis = Object.keys(CAR_TABLE).length;
    return `${entryCount} manifest entr${entryCount === 1 ? "y" : "ies"} - ${chassis} chassis - white box is the OBB hitbox - reload after editing art`;
  }

  /** One chassis: its hull, its art (or the fact that it has none), and its manifest key. */
  private drawCell(carId: string, index: number): void {
    const x = 130 + (index % COLUMNS) * CELL_W;
    const y = 140 + Math.floor(index / COLUMNS) * CELL_H;
    const { carWidth: w, carHeight: h } = DRIVE_CONFIG;
    const key = carSpriteKey(carId);
    const entry = assetManifest().sprites[key];
    const fill = Number.parseInt(COLOR_TABLE[index % COLOR_TABLE.length].hex.slice(1), 16);

    if (entry && this.textures.exists(key)) {
      const source = this.textures.get(key).getSourceImage();
      const fit = fitSprite(
        entry,
        { width: source.width, height: source.height },
        { width: w, height: h },
      );
      const image = this.add.image(x, y, key);
      image.setOrigin(fit.originX, fit.originY);
      image.setScale(fit.scale);
      image.setRotation(fit.rotation);
      if (entry.colorMode === "tint") image.setTint(fill);
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
