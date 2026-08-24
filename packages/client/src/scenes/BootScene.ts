// packages/client/src/scenes/BootScene.ts
import Phaser from "phaser";
import { devToolId } from "../config/client-mode.js";
import { loadManifest } from "../assets/load-manifest.js";
import { EMPTY_MANIFEST, type AssetManifest } from "../assets/manifest-schema.js";

/**
 * The parsed manifest, and a promise that settles when every texture it names has finished loading.
 * Module-level because textures live in Phaser's global `TextureManager` anyway: whichever scene
 * loads them, every scene can draw them.
 */
let manifest: AssetManifest = EMPTY_MANIFEST;
let ready: Promise<void> = Promise.resolve();

export function assetManifest(): AssetManifest {
  return manifest;
}

/** Awaited by `ArenaScene` before the first frame of a match, so no texture uploads mid-match. */
export function assetsReady(): Promise<void> {
  return ready;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "boot" });
  }

  create(): void {
    // Everything dev-only lives inside this block, imports included. Vite replaces
    // `import.meta.env.DEV` with the literal `false` in a production build, so Rollup drops the
    // whole branch and never emits a chunk for anything it names.
    if (import.meta.env.DEV) {
      const id = devToolId();
      if (id) {
        void (async () => {
          const { DEV_TOOLS, isDevToolId } = await import("../dev/registry.js");
          if (!isDevToolId(id)) {
            const known = Object.keys(DEV_TOOLS).join(", ") || "(none registered)";
            console.warn(`[dev] unknown tool "${id}". Known tools: ${known}`);
            this.scene.launch("join");
            ready = this.loadArt();
            return;
          }
          // Tools read the manifest directly, so the art must be in the TextureManager before the
          // scene's create() runs — unlike normal play, there is no lobby to hide the wait behind.
          ready = this.loadArt();
          await ready;
          const Scene = await DEV_TOOLS[id]!();
          this.scene.add(`dev.${id}`, Scene, true);
        })();
        return;
      }
    }

    // Launch, not start: Boot stays alive as the loader while Join renders immediately. Starting
    // Join would shut Boot down and take its in-flight loader with it.
    this.scene.launch("join");
    ready = this.loadArt();
  }

  private async loadArt(): Promise<void> {
    const { manifest: parsed, problems } = await loadManifest();
    manifest = parsed;
    for (const problem of problems) console.warn(`[art] ${problem}`);

    const entries = Object.entries(parsed.sprites);
    if (entries.length === 0) return;

    for (const [key, entry] of entries) {
      this.load.image(key, `art/${entry.file}`);
    }
    // A file named in the manifest but missing on disk must not stall boot: warn and carry on, and
    // the missing texture key then falls through to the procedural silhouette at draw time.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[art] failed to load "${file.key}" from ${file.url}`);
    });

    await new Promise<void>((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.start();
    });
  }
}
