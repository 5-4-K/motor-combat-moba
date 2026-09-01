import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { PlaygroundState, TuningOverrides } from "@motor-combat-moba/shared";
import { MSG_PLAYGROUND_SETUP, defaultPlaygroundSetup, setTuning } from "@motor-combat-moba/shared";
import { joinPlayground } from "../net/connection.js";
import { DEV_TOOL_MARKER } from "./registry.js";
import { mountPlaygroundOverlay } from "./playground/overlay.js";

/**
 * `?dev=playground` (spec PG2). Thin on purpose: this scene's whole job is joining the dev-only
 * `playground` room, handing the real `ArenaScene` its room the same way `JoinScene` does for
 * ordinary play, and mounting `playground/overlay.ts` (Task 10 — pause menu, setup selections; Task
 * 11 adds the tuning sliders and the stored-setup replay). This scene sends only the placeholder
 * default setup the room's own `onJoin` already applied, so the send is idempotent.
 *
 * `BootScene`'s dev branch adds this under the key `dev.<id>` (`dev.playground` here) and starts it
 * immediately — the `key` passed to `super()` below is overridden at that `scene.add` call and only
 * has to be stable and non-colliding, exactly as `AssetTuningScene` notes for itself.
 */
export class PlaygroundScene extends Phaser.Scene {
  private room: Room<PlaygroundState> | undefined;
  /** Last `tuningJson` this scene has already reacted to, so a state patch that did not touch it
   * (e.g. a car respawn) is not re-parsed on every tick. */
  private lastTuningJson: string | undefined;
  private unbind: Array<() => void> = [];
  /** Unmount for the DOM overlay (Task 10) -- `undefined` until `connect()` has mounted it. */
  private unmountOverlay: (() => void) | undefined;

  constructor() {
    super({ key: "dev.playground" });
  }

  create(): void {
    this.room = undefined;
    this.lastTuningJson = undefined;
    this.unbindAll();
    this.unmountOverlay?.();
    this.unmountOverlay = undefined;

    this.cameras.main.setBackgroundColor(0x1d1f21);
    this.add.text(16, 12, DEV_TOOL_MARKER, { fontSize: "20px", color: "#ffffff" });
    this.add.text(16, 38, "joining the playground room...", {
      fontSize: "13px",
      color: "#9aa0a6",
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    void this.connect();
  }

  private onShutdown(): void {
    this.unbindAll();
    this.unmountOverlay?.();
    this.unmountOverlay = undefined;
    // Never leave a dev override active for whatever runs next in this process (the arena this scene
    // itself just launched, or a retried join) — the same rule `PlaygroundRoom.onLeave` enforces
    // server-side, mirrored here for the client-side tuning store.
    setTuning(null);
    this.room = undefined;
    this.lastTuningJson = undefined;
  }

  private unbindAll(): void {
    for (const fn of this.unbind) fn();
    this.unbind = [];
  }

  private async connect(): Promise<void> {
    let room: Room<PlaygroundState>;
    try {
      room = await joinPlayground();
    } catch (err) {
      // Covers a server running without DEV_TOOLS=1 (room not found) and PlaygroundRoom's own
      // ARENA_BUSY_ERROR (a live arena is already open) alike: whatever the server said, in text,
      // rather than a blank canvas.
      this.renderError(err instanceof Error ? err.message : String(err));
      return;
    }

    // The scene can already be gone by the time the join resolves (page nav, a second `?dev=` fired
    // mid-flight) -- leave the room instead of wiring a dead scene up to it.
    if (!this.scene.isActive()) {
      void room.leave();
      return;
    }

    this.room = room;
    this.lastTuningJson = room.state.tuningJson;
    // Task 11 replaces this with the client's stored replay. Sending the same default the room's own
    // `onJoin` already applied is harmless -- `applySetup` no-ops when nothing actually changed.
    room.send(MSG_PLAYGROUND_SETUP, defaultPlaygroundSetup());

    const onState = (): void => this.syncTuning();
    room.onStateChange(onState);
    this.unbind.push(() => room.onStateChange.remove(onState));

    // How `ArenaScene` finds its room (`this.registry.get("room")`), same as `JoinScene` does for
    // ordinary play.
    this.registry.set("room", room);
    this.scene.launch("arena");
    this.unmountOverlay = mountPlaygroundOverlay(room, () => this.onArenaChanged());
  }

  /**
   * An arena change respawns both cars into new geometry (Task 7's `applySetup`), so the running
   * `ArenaScene` has to restart to draw it -- it reads the arena purely from `room.state.arenaId` at
   * `create()` time and never re-reads it mid-match. Stopping and relaunching re-triggers `create()`,
   * which runs `resetMatchState()` and rebuilds everything (prediction buffer, interpolation, HUD)
   * from the room's current state -- the same clean slate a fresh join gets.
   */
  private onArenaChanged(): void {
    this.scene.stop("arena");
    this.scene.launch("arena");
  }

  /**
   * SESSION RULING: `tuningJson === ""` means an explicit `setTuning(null)` (a reset-all write from
   * the room), and a non-empty string is `JSON.parse`d in a try/catch that ignores only an
   * unparseable value -- a value that parses is always handed to `setTuning`, because the server
   * validated it (`validateTuning`) before ever broadcasting it.
   */
  private syncTuning(): void {
    const room = this.room;
    if (!room) return;
    const json = room.state.tuningJson;
    if (json === this.lastTuningJson) return;
    this.lastTuningJson = json;

    if (json === "") {
      setTuning(null);
      return;
    }
    let parsed: TuningOverrides;
    try {
      parsed = JSON.parse(json) as TuningOverrides;
    } catch {
      return;
    }
    setTuning(parsed);
  }

  private renderError(message: string): void {
    this.add.text(16, 60, `[playground] failed to join: ${message}`, {
      fontSize: "14px",
      color: "#d94040",
      wordWrap: { width: this.scale.width - 32 },
    });
  }
}
