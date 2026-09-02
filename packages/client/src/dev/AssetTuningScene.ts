import Phaser from "phaser";
import {
  CAR_TABLE,
  type CarId,
  DRIVE_CONFIG,
  WEAPON_TABLE,
  type WeaponId,
  weaponDefOf,
} from "@motor-combat-moba/shared";
import { CAR_KEY_PREFIX, weaponIconKey, WEAPON_ICON_KEY_PREFIX } from "../assets/asset-keys.js";
import { carSpriteKey } from "../assets/asset-keys.js";
import {
  applyCarSprite,
  phaserTextures,
  type ResolvedSprite,
  resolveCarSprite,
} from "../assets/car-sprite.js";
import { assetManifest } from "../scenes/BootScene.js";
import { HUD_ICON_FIT_SCALE, resolveWeaponIcon, SLOT_BOX_PX } from "../scenes/weapon-hud.js";
import { shotPaletteOf } from "../scenes/combat-visual.js";
import {
  NO_TINT,
  orphanWeaponIds,
  SWATCH_PX,
  swatchIndexAt,
  swatchRect,
  type TintOption,
  tintOptions,
  unassignedCellPosition,
  weaponCellCenter,
  weaponGridContentBottom,
} from "./tuning-layout.js";

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

/** Divider between the car section and the weapon section. */
const DIVIDER_Y = 252;

/** How far the weapon's colour swatch sits right of its slot circle's centre. */
const WEAPON_SWATCH_DX = 68;
const WEAPON_SWATCH_PX = 34;

/** Below the swatch strip, clearing the row of number labels under it. */
const TINT_LABEL_GAP_PX = 30;

/**
 * Every chassis in `CAR_TABLE` parked on its own hull, and every weapon's HUD icon in a real slot,
 * with no server connection.
 *
 * It exists because `rotationOffset`, `scale`, and `origin` have to be tuned by eye per sprite, and
 * the alternative loop is a full rejoin per attempt: the client has no reconnect or session
 * persistence, so a reload drops you back to the name prompt, the lobby, and car select before you
 * can look at one car again.
 *
 * Both sections resolve their art through the same functions the game does — `resolveCarSprite` for
 * a chassis, `resolveWeaponIcon` for an icon — so what this tool shows cannot drift from what a
 * match draws. `power.*` and `projectile.*` rows stay out of scope until something in the sim draws
 * them; weapon shots never take a sprite at all (they are drawn from their hitbox), so the icon is
 * the only weapon art there is.
 *
 * Dev-only. `BootScene` gates the dynamic import behind `import.meta.env.DEV`, which Vite replaces
 * with the literal `false` in a production build, so this module is never emitted into `dist`.
 */
export class AssetTuningScene extends Phaser.Scene {
  /** Car art, kept so the tint picker can re-apply without rebuilding the scene. */
  private cars: Array<{ image: Phaser.GameObjects.Image; resolved: ResolvedSprite }> = [];
  private tints: TintOption[] = [];
  private tintHighlight?: Phaser.GameObjects.Graphics;
  private tintLabel?: Phaser.GameObjects.Text;
  /** Bottom edge of the laid-out content, set once `drawWeaponGrid` knows the roster's row count. */
  private contentBottom = 0;

  constructor() {
    // `BootScene` registers this under `dev.assets`; the key here is overridden at `scene.add` time,
    // so it only matters that it is stable and does not collide with a game scene.
    super({ key: "dev.assets" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x1d1f21);
    this.add.text(16, 12, MARKER, { fontSize: "20px", color: "#ffffff" });

    const manifest = assetManifest();
    // Counted per namespace, because the cells below are per namespace. Counting every manifest key
    // would let the header claim "12 entries" over three car cells.
    const carKeys = Object.keys(manifest.sprites).filter((key) => key.startsWith(CAR_KEY_PREFIX));
    const iconKeys = Object.keys(manifest.sprites).filter((key) =>
      key.startsWith(WEAPON_ICON_KEY_PREFIX),
    );
    this.add.text(16, 38, this.summary(carKeys.length, iconKeys.length), {
      fontSize: "13px",
      color: "#9aa0a6",
    });

    Object.keys(CAR_TABLE).forEach((carId, index) => this.drawCell(carId, index));
    this.drawTintPicker();

    const divider = this.add.graphics();
    divider.lineStyle(1, 0x3a3d42, 1);
    divider.lineBetween(16, DIVIDER_Y, this.scale.width - 16, DIVIDER_Y);
    this.add.text(
      16,
      DIVIDER_Y + 14,
      "weapon icons - fitted as the HUD fits them - scroll for rows below the fold",
      {
        fontSize: "13px",
        color: "#9aa0a6",
      },
    );
    this.add
      .text(this.scale.width - 16, DIVIDER_Y + 14, "swatch = every colour this weapon shoots in", {
        fontSize: "12px",
        color: "#6f757c",
      })
      .setOrigin(1, 0);

    this.drawWeaponGrid();
    this.bindScroll();
  }

  /**
   * Mouse-wheel vertical scroll (PG38): the weapon grid can run past the bottom of the fixed
   * 1424x720 canvas once PG37's unassigned row is in play, and this scene never zooms or resizes,
   * so a scrolling camera is the only way the row reaches the screen at all. Clamped to
   * `contentBottom` (set by `drawWeaponGrid`, once the roster's actual row count is known) rather
   * than a guessed constant, so a chassis or an orphan added later stays reachable without a second
   * edit here.
   *
   * The tint picker's hit test already reads `pointer.worldX`/`worldY` (camera-scroll-aware), so
   * scrolling this camera does not need to touch it.
   */
  private bindScroll(): void {
    this.input.on(
      "wheel",
      (
        _pointer: Phaser.Input.Pointer,
        _gameObjects: unknown,
        _deltaX: number,
        deltaY: number,
      ) => {
        const maxScroll = Math.max(0, this.contentBottom - this.scale.height);
        this.cameras.main.scrollY = Phaser.Math.Clamp(
          this.cameras.main.scrollY + deltaY,
          0,
          maxScroll,
        );
      },
    );
  }

  private summary(carCount: number, iconCount: number): string {
    const chassis = Object.keys(CAR_TABLE).length;
    const weapons = Object.keys(WEAPON_TABLE).length;
    // The grid draws kits, so a weapon on no chassis gets no cell. That is the same case
    // `import-weapon-icon.mjs` warns about, and it has to be said rather than silently missing:
    // "9 weapon icons" over eight cells is exactly the lie the per-namespace counting avoids above.
    const orphans = orphanWeaponIds(
      Object.keys(WEAPON_TABLE),
      Object.values(CAR_TABLE).map((car) => car.weapons),
    );
    const orphanNote = orphans.length > 0 ? ` (${orphans.join(", ")} on no kit)` : "";
    return (
      `${carCount} car entr${carCount === 1 ? "y" : "ies"} - ${chassis} chassis - ` +
      `${iconCount}/${weapons} weapon icons${orphanNote} - white box is the OBB hitbox, ` +
      `circle is the ${SLOT_BOX_PX}px HUD slot - reload after editing art`
    );
  }

  /** One chassis: its hull, its art (or the fact that it has none), and its manifest key. */
  private drawCell(carId: string, index: number): void {
    const x = 130 + (index % COLUMNS) * CELL_W;
    const y = 140 + Math.floor(index / COLUMNS) * CELL_H;
    const { carWidth: w, carHeight: h } = DRIVE_CONFIG;
    const key = carSpriteKey(carId);
    const entry = assetManifest().sprites[key];

    // Resolved by the same function `ArenaScene.spriteFor` calls, so "no art" here means exactly
    // what the silhouette fallback means in a match, and the composition cannot drift between them.
    const resolved = resolveCarSprite(
      assetManifest(),
      phaserTextures(this.textures),
      carId,
      { width: w, height: h },
    );
    if (resolved) {
      // Untinted by default. The player's colour is a lobby assignment, not a property of the art,
      // so drawing one particular colour here would assert something that is not true of the
      // sprite; the picker puts a real colour on when the question is "does this tint well".
      const image = applyCarSprite(this.add.image(x, y, resolved.key), resolved, NO_TINT);
      this.cars.push({ image, resolved });
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

    if (!CAR_TABLE[carId as CarId].isActive) {
      this.add
        .text(x, y + 80, "inactive", { fontSize: "11px", color: "#d99a40" })
        .setOrigin(0.5);
    }
  }

  /**
   * The car tint picker: `none` plus every player colour, click or number key.
   *
   * Restores what the grey default gives up. A car sprite is desaturated on import precisely so a
   * player colour can multiply through it (`scripts/import-art.mjs`), and residual colour under
   * that tint is the failure that produces mud — but that is a question you ask occasionally, not
   * the state the page should rest in.
   */
  private drawTintPicker(): void {
    this.tints = tintOptions();
    const strip = this.add.graphics();
    const heading = this.add.text(swatchRect(0).x, 108, "car tint", {
      fontSize: "13px",
      color: "#ffffff",
      fontStyle: "bold",
    });
    // Placed off the heading's MEASURED width rather than a reserved budget: a scene has a canvas,
    // so unlike the pure HUD layout there is no reason to guess how wide bold 13px text runs.
    this.add.text(
      heading.x + heading.width + 12,
      110,
      "click a swatch, or press 0-6   -   weapon icons are never tinted",
      { fontSize: "11px", color: "#6f757c" },
    );

    this.tints.forEach((option, i) => {
      const r = swatchRect(i);
      strip.fillStyle(option.fill === NO_TINT ? 0x3a3d42 : option.fill, 1);
      strip.fillRect(r.x, r.y, r.width, r.height);
      strip.lineStyle(1, 0x000000, 0.5);
      strip.strokeRect(r.x, r.y, r.width, r.height);
      if (option.fill === NO_TINT) {
        // A slash, so "none" cannot be mistaken for a dark grey player colour.
        strip.lineStyle(2, 0x7f868d, 1);
        strip.lineBetween(r.x + 8, r.y + r.height - 8, r.x + r.width - 8, r.y + 8);
      }
      this.add
        .text(r.x + r.width / 2, r.y + r.height + 6, String(i), {
          fontSize: "11px",
          color: "#6f757c",
        })
        .setOrigin(0.5, 0);
    });

    this.tintHighlight = this.add.graphics();
    // Below the strip and its number labels, not beside the header — anchored off the swatch's own
    // box so it stays clear of them if the strip moves.
    this.tintLabel = this.add.text(
      swatchRect(0).x,
      swatchRect(0).y + SWATCH_PX + TINT_LABEL_GAP_PX,
      "",
      { fontSize: "12px", color: "#9aa0a6" },
    );

    // One scene-level handler over `swatchIndexAt` rather than an interactive rect per swatch: the
    // miss cases (the gaps, past the last swatch) are then covered by a unit test instead of by
    // clicking around the page.
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      const hit = swatchIndexAt({ x: pointer.worldX, y: pointer.worldY }, this.tints.length);
      if (hit !== undefined) this.setTint(hit);
    });
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      const n = Number.parseInt(event.key, 10);
      if (Number.isInteger(n) && n >= 0 && n < this.tints.length) this.setTint(n);
    });

    this.setTint(0);
  }

  /** Re-apply a tint to every car, and move the highlight to the active swatch. */
  private setTint(index: number): void {
    const option = this.tints[index];
    if (!option) return;

    // Re-calls the shared applier rather than `setTint` directly, so the origin/scale/rotation/tint
    // order stays the arena's — and so a `colorMode: "none"` sprite keeps refusing the tint, which
    // is what stops this picker from claiming a pre-coloured sprite responds to player colour.
    for (const car of this.cars) applyCarSprite(car.image, car.resolved, option.fill);

    const r = swatchRect(index);
    this.tintHighlight?.clear();
    this.tintHighlight?.lineStyle(2, 0xffffff, 1);
    this.tintHighlight?.strokeRect(r.x - 4, r.y - 4, r.width + 8, r.height + 8);
    this.tintLabel?.setText(
      option.fill === NO_TINT
        ? "active: none - art as authored"
        : `active: ${option.label} - 0x${option.fill.toString(16).padStart(6, "0")}`,
    );
  }

  /** Every weapon's icon: one row per chassis in kit-slot order, then a row for anything on no kit
   * at all (PG37) — an orphan is usually a weapon being brought up, and it needs looking at more
   * than a shipped one does. */
  private drawWeaponGrid(): void {
    const cars = Object.values(CAR_TABLE);
    cars.forEach((car, row) => {
      this.drawGridRowLabel(
        row,
        car.id,
        `slots 1-${car.weapons.length}`,
        car.isActive ? undefined : "inactive",
      );
      car.weapons.forEach((weaponId, col) => this.drawWeaponCell(weaponId, row, col));
    });

    const orphans = orphanWeaponIds(
      Object.keys(WEAPON_TABLE),
      cars.map((car) => car.weapons),
    );
    orphans.forEach((weaponId, index) => {
      const { row, col } = unassignedCellPosition(index, cars.length);
      if (col === 0) this.drawGridRowLabel(row, "unassigned", "on no kit");
      this.drawWeaponCell(weaponId as WeaponId, row, col);
    });

    this.contentBottom = weaponGridContentBottom(cars.length, orphans.length);
  }

  /** The label pair to the left of one weapon-grid row, plus an optional amber tag beneath. */
  private drawGridRowLabel(row: number, title: string, subtitle: string, tag?: string): void {
    const rowY = weaponCellCenter(row, 0).y;
    this.add
      .text(150, rowY, title, { fontSize: "15px", color: "#ffffff", fontStyle: "bold" })
      .setOrigin(1, 0.5);
    this.add
      .text(150, rowY + 20, subtitle, { fontSize: "11px", color: "#6f757c" })
      .setOrigin(1, 0.5);
    if (tag) {
      this.add.text(150, rowY + 36, tag, { fontSize: "11px", color: "#d99a40" }).setOrigin(1, 0.5);
    }
  }

  /** One weapon: its icon in a real slot circle, its shot colour, and its manifest row. */
  private drawWeaponCell(weaponId: WeaponId, row: number, col: number): void {
    const { x: cx, y: cy } = weaponCellCenter(row, col);
    const def = weaponDefOf(weaponId);
    const key = weaponIconKey(weaponId);
    const entry = assetManifest().sprites[key];
    const iconX = cx - 46;

    const gfx = this.add.graphics();
    gfx.lineStyle(1, HULL_STROKE, 0.55);
    gfx.strokeCircle(iconX, cy, SLOT_BOX_PX / 2);

    // Fitted through the HUD's own resolver at the HUD's own box, so an icon that reads badly here
    // reads badly in a match — and one that is missing falls through exactly where the HUD falls
    // through to its procedural glyph.
    const icon = resolveWeaponIcon(
      assetManifest(),
      phaserTextures(this.textures),
      weaponId,
      SLOT_BOX_PX * HUD_ICON_FIT_SCALE,
    );
    if (icon) {
      this.add
        .image(iconX, cy, icon.key)
        .setOrigin(icon.fit.originX, icon.fit.originY)
        .setScale(icon.fit.scale)
        .setRotation(icon.fit.rotation);
    } else {
      this.add
        .text(iconX, cy, "no icon", { fontSize: "12px", color: "#d94040" })
        .setOrigin(0.5);
    }

    // Every colour the weapon's SHOTS draw in, stacked outermost-first. Nothing typed ties these to
    // the icon, so putting the two side by side is the only place the pair can be judged as one
    // weapon -- and since weapons grew ramps and markings, a single swatch of `WEAPON_TABLE.color`
    // would be a third of the answer for six of the nine.
    const palette = shotPaletteOf(weaponId);
    const swatchX = cx + WEAPON_SWATCH_DX - WEAPON_SWATCH_PX / 2;
    const swatchTop = cy - WEAPON_SWATCH_PX / 2;
    const bandPx = WEAPON_SWATCH_PX / Math.max(1, palette.length);
    const shot = this.add.graphics();
    palette.forEach((hex, i) => {
      shot.fillStyle(Number.parseInt(hex.slice(1), 16), 1);
      shot.fillRect(swatchX, swatchTop + i * bandPx, WEAPON_SWATCH_PX, bandPx);
    });
    shot.lineStyle(1, 0x000000, 0.5);
    shot.strokeRect(swatchX, swatchTop, WEAPON_SWATCH_PX, WEAPON_SWATCH_PX);
    const swatchLabel =
      palette.length > 1 ? `${def.color} +${String(palette.length - 1)}` : def.color;
    this.add
      .text(swatchX + WEAPON_SWATCH_PX / 2, cy + WEAPON_SWATCH_PX / 2 + 6, swatchLabel, {
        fontSize: "10px",
        color: "#9aa0a6",
      })
      .setOrigin(0.5, 0);

    this.add.text(cx, cy + 54, def.name, { fontSize: "13px", color: "#ffffff" }).setOrigin(0.5);
    this.add.text(cx, cy + 70, key, { fontSize: "11px", color: "#9aa0a6" }).setOrigin(0.5);
    this.add
      .text(
        cx,
        cy + 84,
        entry ? `scale ${String(entry.scale)} origin ${entry.origin.join(",")}` : "-",
        { fontSize: "10px", color: "#6f757c" },
      )
      .setOrigin(0.5);
  }
}
