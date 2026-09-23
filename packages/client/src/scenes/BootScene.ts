import Phaser from "phaser";
import { ACTIVE_ARENA_ID, DEFAULT_GAME_MODE } from "@motor-combat-moba/shared";
import { devToolId } from "../config/client-mode.js";
import { loadManifest } from "../assets/load-manifest.js";
import { loadsEveryArena, shouldLoadAssetKey } from "../assets/asset-keys.js";
import { EMPTY_MANIFEST, type AssetManifest } from "../assets/manifest-schema.js";
import { installRoomMode } from "../net/mode-scope.js";

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

/**
 * Settles when every texture named by the manifest has finished loading. `ArenaScene` does not block
 * on it — it swaps sprites in when it resolves, drawing procedural silhouettes until then.
 *
 * The guarantee that does hold is narrower and is about `this.load.image` being called in exactly
 * one place, at boot: nothing loads mid-match, so there is no texture upload to spike a frame.
 */
export function assetsReady(): Promise<void> {
  return ready;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "boot" });
  }

  create(): void {
    // The client's TRUE entry point for config (C1/C2, 2026-09-22 final review). This must run
    // before anything else in this method, and before any scene this one launches — `JoinScene`
    // reads `flow()` directly (join.ts's name-field `maxLength`), and modules statically imported
    // by `main.ts` (e.g. `ArenaScene.js` -> `maneuver-visual.js`) can read config at module scope
    // via `memoOnBundle`-backed lazy derivations that still need a bundle installed before their
    // first real call. Without this, the whole page was blank: `cfg()` threw "config read outside
    // a mode scope" before `BootScene` ever got this far, with no room ever having been joined.
    // Every real room (arena, practice, playground) reinstalls its OWN mode the moment it is
    // joined, via `watchRoomMode` — this is only the bridge value for the stretch of time before
    // that happens (the join screen, the lobby, and — for `?dev=` tools that never join a room at
    // all — for their entire life).
    installRoomMode(DEFAULT_GAME_MODE);

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
          // A dev tool's `create()` can read config synchronously (car/weapon stat lists, turret
          // numbers) with no room ever joined — `?dev=assets` and `?dev=fx` never connect to a
          // server at all. The unconditional `installRoomMode` above already covers that; nothing
          // further to install here. `PlaygroundScene` is the one dev tool that DOES join a room
          // (`PlaygroundRoom`, always pinned to `DEFAULT_GAME_MODE` — see its own CLAUDE.md note);
          // its later `watchRoomMode(room)` call re-affirms the same bundle from the room's own
          // `state.mode` rather than depending on the default staying correct forever.
          // Tools read the manifest directly, so the art must be in the TextureManager before the
          // scene's create() runs — unlike normal play, there is no lobby to hide the wait behind.
          ready = this.loadArt(loadsEveryArena(id));
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

  private async loadArt(everyArena = false): Promise<void> {
    const { manifest: parsed, problems } = await loadManifest();
    manifest = parsed;
    for (const problem of problems) console.warn(`[art] ${problem}`);

    // Filtered before anything is queued, so `entries` stays the one list the loader, the
    // FILE_LOAD_ERROR handler, and the missing-texture sweep below all agree on. A key skipped here
    // is not "failed to load" — it was never asked for, and must not be warned about.
    const entries = Object.entries(parsed.sprites).filter(([key]) =>
      shouldLoadAssetKey(key, ACTIVE_ARENA_ID, everyArena),
    );
    if (entries.length === 0) return;

    for (const [key, entry] of entries) {
      this.load.image(key, `art/${entry.file}`);
    }
    // A file named in the manifest but missing on disk must not stall boot: warn and carry on, and
    // the missing texture key then falls through to the procedural silhouette at draw time. This
    // handler covers a genuine transport failure and is the only one that knows the resolved URL.
    const reported = new Set<string>();
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      reported.add(file.key);
      console.warn(`[art] failed to load "${file.key}" from ${file.url}`);
    });

    await new Promise<void>((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.start();
    });

    // Warn on the condition the renderer actually checks — the texture missing — rather than on
    // FILE_LOAD_ERROR alone. Vite's dev server answers a missing file under `public/` with its SPA
    // fallback (200, text/html), so the *load* succeeds and Phaser fails at the decode stage, which
    // does not emit FILE_LOAD_ERROR. Only a real 404, as the release server returns, does — and
    // that path has already warned above with the URL, so `reported` keeps it from warning twice.
    for (const [key, entry] of entries) {
      if (!reported.has(key) && !this.textures.exists(key)) {
        console.warn(`[art] failed to load "${key}" from art/${entry.file}`);
      }
    }
  }
}
