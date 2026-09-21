import { describe, expect, it } from "vitest";
import {
  fireButtons,
  initialLock,
  reduceLock,
  shouldAutoLockOnKey,
  shouldReleaseLock,
  shouldRequestLock,
} from "./pointer-lock.js";

describe("pointer lock reducer (TR31)", () => {
  it("starts unlocked and fires no mouse button", () => {
    const s = initialLock();
    expect(s.locked).toBe(false);
    expect(fireButtons(s, 1)).toBe(0);
  });

  it("swallows the click that acquired the lock until it is released", () => {
    let s = reduceLock(initialLock(), { type: "acquired", buttons: 1 }).state;
    expect(fireButtons(s, 1)).toBe(0);
    s = reduceLock(s, { type: "buttons", buttons: 0 }).state;
    expect(fireButtons(s, 1)).toBe(1);
    expect(fireButtons(s, 2)).toBe(2);
  });

  it("opens the menu when the lock is lost unasked (Esc, alt-tab)", () => {
    const locked = reduceLock(initialLock(), { type: "acquired", buttons: 0 }).state;
    const lost = reduceLock(locked, { type: "lost" });
    expect(lost.openMenu).toBe(true);
    expect(lost.state.locked).toBe(false);
  });

  it("does not open the menu for a release the game asked for", () => {
    let s = reduceLock(initialLock(), { type: "acquired", buttons: 0 }).state;
    s = reduceLock(s, { type: "release" }).state;
    const lost = reduceLock(s, { type: "lost" });
    expect(lost.openMenu).toBe(false);
    expect(lost.state.releasing).toBe(false);
  });
});

describe("relock race guards (final-fixes item 1)", () => {
  it("requests the lock only when unlocked, no menu is up, and no pause is in flight", () => {
    expect(shouldRequestLock(false, false, false)).toBe(true);
  });

  it("refuses to (re)lock while already locked", () => {
    expect(shouldRequestLock(true, false, false)).toBe(false);
  });

  it("refuses to lock while the menu is open", () => {
    expect(shouldRequestLock(false, true, false)).toBe(false);
  });

  it("refuses to lock while a pause was requested but its patch has not landed yet", () => {
    // This is the race: state.paused is still false (so menuOpen() reads false) but a pause
    // message is already in flight, so a canvas click here must not re-acquire the lock.
    expect(shouldRequestLock(false, false, true)).toBe(false);
  });

  it("releases a held lock the moment a menu is considered open", () => {
    expect(shouldReleaseLock(true, true)).toBe(true);
  });

  it("leaves an unlocked cursor or an open lock with no menu alone", () => {
    expect(shouldReleaseLock(false, true)).toBe(false);
    expect(shouldReleaseLock(true, false)).toBe(false);
  });
});

describe("auto-lock on first keydown (TR31a)", () => {
  it("accepts a driving key when unlocked, no menu, no pause pending", () => {
    expect(shouldAutoLockOnKey(false, false, false, "w")).toBe(true);
  });

  it("refuses Escape even when every other gate is open", () => {
    expect(shouldAutoLockOnKey(false, false, false, "Escape")).toBe(false);
  });

  it("refuses P (both cases) even when every other gate is open", () => {
    expect(shouldAutoLockOnKey(false, false, false, "p")).toBe(false);
    expect(shouldAutoLockOnKey(false, false, false, "P")).toBe(false);
  });

  it("refuses a driving key while already locked", () => {
    expect(shouldAutoLockOnKey(true, false, false, "w")).toBe(false);
  });

  it("refuses a driving key while the menu is open", () => {
    expect(shouldAutoLockOnKey(false, true, false, "w")).toBe(false);
  });

  it("refuses a driving key while a pause is in flight", () => {
    expect(shouldAutoLockOnKey(false, false, true, "w")).toBe(false);
  });
});
