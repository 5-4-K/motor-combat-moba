import {
  GameMode,
  hasMode,
  installMode,
  modeConfigOrDefault,
} from "@motor-combat-moba/shared";

/**
 * The client's half of the per-mode config scope (docs/superpowers/plans/2026-09-22-per-mode-
 * config/interfaces.md's `packages/client/src/net/mode-scope.ts` entry). Mirrors the server's
 * `rooms/mode-scope.ts`, which wraps every `ArenaRoom`/`PracticeRoom` entry point in
 * `scoped(this.modeConfig, fn)` so a handler can never run unscoped — but the client is not that
 * shape, and copying it verbatim would be copying the wrong thing.
 *
 * **Design decision: persisting `installMode`, not a `withMode` push/pop around every read.**
 * `ArenaRoom` juggles N rooms' worth of config in one process and MUST restore the previous bundle
 * on the way out of every handler, or one room's tick could read another's numbers (MC11, MC15,
 * MC21). A browser tab runs exactly one room at a time — arena, practice or playground, never two,
 * never interleaved — so there is no "previous bundle" a client entry point could ever need to
 * restore back to. Given that, `installRoomMode` below calls shared's `installMode` (the
 * boot-time-install-no-restore primitive `active.ts` keeps around for exactly this shape) and lets
 * it persist: install once when the room's mode becomes known, reinstall whenever it changes, and
 * every one of the client's ~150 leaf config reads (HUD draws, car select, the FX tables, the
 * prediction step) just calls `drive()`/`cars()`/etc. directly, the same as they always have.
 * Wrapping each of those in `runInRoomMode(() => ...)` was the other option on the table; it was
 * rejected because it buys nothing here — there is only ever one bundle installed, so a push/pop
 * scope around a leaf read would always push the same object that was already current and pop back
 * to it a statement later. `runInRoomMode` still exists (the interfaces ledger names it, and the
 * task-5 brief's own acceptance test calls it directly) but it is deliberately thin: it asserts a
 * bundle is actually installed — with a client-specific error pointing at `installRoomMode` — and
 * then just calls `fn()`. It is for the handful of call sites where "this code assumes a room's
 * config is live" is worth stating explicitly (the prediction step, the per-frame render root),
 * not a device to route the other ~150 reads through.
 *
 * **What happens on leaving a room and returning to the join screen: the bundle stays installed.**
 * Nothing clears it, and that is correct, not an oversight. `JoinScene`'s join screen and its
 * "Practice" button read no config at all, so a stale bundle sitting there between rooms is inert —
 * there is nobody home to read it. The moment the player joins again (an arena, a practice room, or
 * the dev playground), `watchRoomMode` below reinstalls fresh from that new room's own `state.mode`
 * before the next scene (`LobbyScene`, or `ArenaScene` directly for practice/playground) ever
 * renders, so the stale value is never actually observed. The alternative — clearing it on leave —
 * would only reintroduce the exact bug this file exists to fix: a window between "no room" and "a
 * bundle for the new room" during which a stray config read throws.
 */

/**
 * Installs the bundle for `mode` and lets it persist — see the design note above. Resolved through
 * `modeConfigOrDefault`, never the throwing `modeConfigOf`: `mode` ultimately comes off a Colyseus
 * `uint8` (`ArenaState.mode`/`PracticeState.mode`/`PlaygroundState.mode`), which an old client or a
 * since-deleted mode can set to anything, and a throw here would take the whole page down instead of
 * one room.
 */
export function installRoomMode(mode: GameMode): void {
  installMode(modeConfigOrDefault(mode));
}

/**
 * Asserts a room's bundle is actually installed, then just runs `fn`. There is nothing to push or
 * pop — see the design note above — so this is not `withMode` under another name; it exists to give
 * a call site an explicit, named assumption ("this only runs once a room is live") and a client-
 * specific error message if that assumption is ever wrong, instead of leaking shared's generic
 * "config read outside a mode scope" message (which names `withMode`, a function this file
 * deliberately does not use) out of a leaf render call.
 */
export function runInRoomMode<T>(fn: () => T): T {
  if (!hasMode()) {
    throw new Error(
      "runInRoomMode: no room's config bundle is installed yet. Call installRoomMode(mode) — " +
        "normally via watchRoomMode(room) right after a room is joined — before reading config.",
    );
  }
  return fn();
}

/** Just enough of a joined room to install and track its mode. */
export interface RoomModeSource {
  readonly state: {
    readonly mode: GameMode;
    listen(
      prop: "mode",
      callback: (value: GameMode, previousValue: GameMode) => void,
      immediate?: boolean,
    ): () => boolean;
  };
}

/**
 * Installs `room`'s current mode immediately and reinstalls on every later change — the one call
 * that satisfies both halves of MC16 ("install on join" and "re-install when the host changes
 * mode"). `@colyseus/schema`'s `Schema.listen` does both in one subscription when passed
 * `immediate: true`: it fires once right away with the field's current value, then again on every
 * patch that changes it.
 *
 * A host can change `ArenaState.mode` in the lobby, before car select (`MSG_SET_MODE`, guarded to
 * `RoomPhase.LOBBY` server-side) — a client holding the previous mode's bundle at that point would
 * offer the wrong roster in car select and, worse, predict through the wrong drive/ram numbers once
 * the match starts, which reads as rubber-banding rather than as a config bug. `PracticeState` and
 * `PlaygroundState` both extend `ArenaState` and carry the same field, pinned by their rooms
 * (`FFA_DEATHMATCH`, `DEFAULT_GAME_MODE`) for the room's whole life — `listen` still fires once,
 * immediately, on those, so calling this uniformly for all three room kinds costs nothing and keeps
 * one code path rather than three.
 *
 * Never unsubscribed: the returned function exists for a caller that wants it, but a client holds
 * exactly one room for its whole life (invariant: one room at a time, never interleaved — see the
 * design note above), so there is no second room whose patches this listener could wrongly answer
 * for. The room's connection closing is what actually stops it from firing again.
 */
export function watchRoomMode(room: RoomModeSource): () => boolean {
  return room.state.listen("mode", (mode) => installRoomMode(mode), true);
}
