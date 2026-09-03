import Phaser from "phaser";
import type { Room } from "colyseus.js";
import {
  PRACTICE_INVALID_SETUP_ERROR,
  isArenaId,
  type PracticeSetup,
  type PracticeState,
} from "@motor-combat-moba/shared";
import { joinPractice } from "../net/connection.js";
import { loadPracticeSetup, savePracticeSetup } from "../practice/storage.js";
import { ScreenOverlay } from "../ui/overlay.js";
import { renderPracticeSetup, type PracticeSetupScreen } from "../ui/screens/practice-setup.js";

/**
 * How long to wait for the room's first full state patch before giving up on it outright. Generous
 * relative to a LAN round trip — this only ever fires on a genuine stall (see `waitForArenaReady`),
 * never on a healthy join.
 */
const ARENA_STATE_SYNC_TIMEOUT_MS = 5000;

/**
 * Resolves once `room.state` has decoded far enough to know its arena — immediately if it already
 * does. `joinPractice` resolves on the JOIN_ROOM handshake alone, which lands before the room's first
 * full state patch (colyseus.js's `Room.onMessageCallback` sets `hasJoined` and invokes `onJoin` off
 * the handshake byte, with no wait on a patch); everywhere else in the game that gap is invisible
 * (Lobby just renders an empty roster for one frame), but this is the one path that jumps straight
 * from a settings screen into `ArenaScene`, whose `create()` reads `state.arenaId` synchronously and
 * would otherwise show a false "arena mismatch" screen for what is really just an unsynced state.
 *
 * Also races the room's own `onError` and `onLeave` and a timeout, and rejects on whichever comes
 * first. `joinOrCreate`'s own `onError` listener is torn down the instant `onJoin` fires — i.e. the
 * instant `joinPractice` resolves (`colyseus.js`'s `Client.js`) — so nothing else is watching for a
 * server crash or dropped connection between the handshake and the first patch; without this, that
 * gap would await forever with Start stuck disabled and no way out but a reload.
 *
 * The `onLeave` rejection is tagged with `ROOM_ALREADY_GONE` rather than left as a plain `Error`:
 * `onStart`'s `catch` needs to tell "the room rejected me and is already gone" apart from "the room
 * is still sitting there, joined but never ready" — only the second case owes the server a
 * `room.leave()` call.
 */
export const ROOM_ALREADY_GONE = "Practice room closed before it was ready";

function waitForArenaReady(room: Room<PracticeState>): Promise<void> {
  if (isArenaId(room.state.arenaId)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      room.onStateChange.remove(onState);
      room.onError.remove(onError);
      room.onLeave.remove(onLeave);
      clearTimeout(timer);
    };
    const settle = (run: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      run();
    };
    const onState = (): void => settle(resolve);
    const onError = (_code: number, message?: string): void =>
      settle(() => reject(new Error(message || "Practice room connection failed")));
    const onLeave = (): void => settle(() => reject(new Error(ROOM_ALREADY_GONE)));
    room.onStateChange(onState);
    room.onError(onError);
    room.onLeave(onLeave);
    const timer = setTimeout(
      () => settle(() => reject(new Error("Timed out connecting to the practice room"))),
      ARENA_STATE_SYNC_TIMEOUT_MS,
    );
  });
}

/**
 * The practice settings page (spec PR21). Settings are chosen here and fixed for the session — there
 * is no mid-session reconfiguration (PR2), which is why they ride as join options rather than as a
 * message the room could accept later.
 *
 * A capacity refusal (PR25, code 4007) is an inline error on THIS screen: the player never left it,
 * and routing them somewhere else to read the reason would be a worse answer than re-enabling Start.
 */
export class PracticeSetupScene extends Phaser.Scene {
  private starting = false;
  private overlay: ScreenOverlay | undefined;
  private screen: PracticeSetupScreen | undefined;

  constructor() {
    super({ key: "practice-setup" });
  }

  create(): void {
    this.starting = false;
    this.overlay = new ScreenOverlay(this);
    this.screen = renderPracticeSetup(
      {
        onStart: (partial) => void this.onStart(partial),
        onBack: () => this.scene.start("join"),
      },
      loadPracticeSetup(),
    );
    this.overlay.render(this.screen.root);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    // Set by `ArenaScene` just before routing here off close code 4006 (spec PR25) — an idle
    // session ended somewhere the player never chose to leave, so this screen is where they land
    // and where they read why. Cleared on read so it cannot resurface on a later, unrelated visit.
    const notice = this.registry.get("practiceNotice") as string | undefined;
    if (notice) {
      this.registry.remove("practiceNotice");
      this.screen.setError(notice);
    }
  }

  private async onStart(partial: Omit<PracticeSetup, "name">): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.screen?.setError("");
    this.screen?.setBusy(true);
    // The name was captured on the join screen and falls back to "Player" when blank (PR20).
    const name = (this.registry.get("playerName") as string | undefined) ?? "Player";
    const setup: PracticeSetup = { ...partial, name };
    savePracticeSetup(setup);
    // Hoisted out of the `try` so the `catch` can still reach a room that joined but never became
    // ready — that room is real on the server (a cap slot, an open socket) even though this method
    // is about to fail.
    let room: Room<PracticeState> | undefined;
    try {
      room = await joinPractice(setup);
      // See `waitForArenaReady` above — costs nothing once state has already arrived, which is the
      // common case; only pays the wait (and can only fail) on the actual race. Held off the registry
      // until this resolves, so a room that never became ready never lingers there for a later read.
      await waitForArenaReady(room);
      this.registry.set("room", room);
      this.scene.start("arena");
    } catch (err) {
      this.starting = false;
      this.screen?.setBusy(false);
      // A room that joined but never became ready still holds a cap slot and an open socket until
      // the server's own idle timeout eventually reaps it — closing it here is immediate instead.
      // Skipped when the rejection is `ROOM_ALREADY_GONE`: that came from the room's own `onLeave`,
      // so there is nothing left to leave, and skipped when `joinPractice` itself never resolved
      // (`room` still undefined) — a rejected `joinOrCreate` never made a room to leave in the first
      // place.
      const alreadyGone = err instanceof Error && err.message === ROOM_ALREADY_GONE;
      if (room && !alreadyGone) void room.leave();
      // `ServerError` (what every real refusal — 4006-4009 alike — rejects with) extends `Error`, so
      // `err.message` already carries the server's own text; this fallback only guards a rejection
      // shaped by something other than the room, which reads closer to a malformed request than to
      // any of the room's own reasons.
      this.screen?.setError(err instanceof Error ? err.message : PRACTICE_INVALID_SETUP_ERROR);
    }
  }

  private onShutdown(): void {
    this.overlay?.destroy();
    this.overlay = undefined;
    this.screen = undefined;
    this.starting = false;
  }
}
