/**
 * Handing the keyboard back to the DOM when the scene that captured it goes away.
 *
 * A Phaser `Key` is scene-scoped but its *capture* is not: `addKey(code)` defaults to
 * `enableCapture: true`, which pushes the code onto the game-wide `KeyboardManager.captures` and
 * flips that manager's `preventDefault` on. From then on it calls `preventDefault()` on every
 * unmodified keydown carrying one of those codes — whatever the event target, a focused `<input>`
 * included. `KeyboardPlugin.shutdown()` destroys the `Key` objects (`removeAllKeys(true)`) but
 * leaves `removeCapture` at its `false` default, so the captures outlive the scene for the rest of
 * the page's life.
 *
 * That is what left the join screen's Callsign field unable to accept W, A, S, D, P, V, J, K, L,
 * Space, the brackets or the arrows once anyone had been in the arena — the field had focus and the
 * caret blinked, but the dead arena bindings were still eating the keystrokes. The quickest way in
 * is Practice (no second player needed), but every route out of a match lands on the same screen.
 *
 * Captures are released rather than keys because **Phaser's own teardown runs first**: `InputPlugin`
 * registers its `SHUTDOWN` listener from `SceneEvents.START`, before `create()` ever runs, so by the
 * time a scene's own `SHUTDOWN` handler is called the plugin's key list is already empty and
 * `removeAllKeys(true, true)` has nothing left to remove the captures of. `clearCaptures()` goes
 * straight to the manager's array, so it does not care which teardown ran first.
 *
 * Clearing *all* captures is correct as long as the arena is the only screen that binds a Phaser
 * key, which it is — grep `addKey` before adding a second one, or this will disarm it too.
 *
 * Typed against the one method rather than `Phaser.Input.Keyboard.KeyboardPlugin` so the rule stays
 * testable in this package's node test environment, where importing `phaser` runs its browser
 * device detection and crashes — the same trick `isFullscreenToggle` plays with `KeyPress`.
 */
export interface KeyboardCaptureOwner {
  clearCaptures(): unknown;
}

/**
 * Stop the page swallowing the keys a scene claimed. Safe on a scene with no keyboard at all, and
 * on one that never bound a key — which is what lets it sit on a teardown path that also runs
 * before `create` binds any.
 */
export function releaseKeyboardCaptures(keyboard: KeyboardCaptureOwner | null | undefined): void {
  keyboard?.clearCaptures();
}
