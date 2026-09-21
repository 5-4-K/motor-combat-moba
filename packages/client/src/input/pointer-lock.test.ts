import { describe, expect, it } from "vitest";
import { fireButtons, initialLock, reduceLock, shouldReleaseLock, shouldRequestLock } from "./pointer-lock.js";

describe("pointer lock reducer (TR31)", () => {
  it("starts unlocked, cursor at the canvas centre, and fires no mouse button", () => {
    const s = initialLock(800, 600);
    expect(s.cursor).toEqual({ x: 400, y: 300 });
    expect(fireButtons(s, 1)).toBe(0);
  });

  it("swallows the click that acquired the lock until it is released", () => {
    let s = reduceLock(initialLock(800, 600), { type: "acquired", buttons: 1 }).state;
    expect(fireButtons(s, 1)).toBe(0);
    s = reduceLock(s, { type: "buttons", buttons: 0 }).state;
    expect(fireButtons(s, 1)).toBe(1);
    expect(fireButtons(s, 2)).toBe(2);
  });

  it("integrates movement, clamped to the canvas", () => {
    let s = reduceLock(initialLock(800, 600), { type: "acquired", buttons: 0 }).state;
    s = reduceLock(s, { type: "move", dx: 50, dy: -20, w: 800, h: 600 }).state;
    expect(s.cursor).toEqual({ x: 450, y: 280 });
    s = reduceLock(s, { type: "move", dx: 9999, dy: 9999, w: 800, h: 600 }).state;
    expect(s.cursor).toEqual({ x: 800, y: 600 });
  });

  it("ignores movement while unlocked", () => {
    const s = reduceLock(initialLock(800, 600), { type: "move", dx: 50, dy: 0, w: 800, h: 600 }).state;
    expect(s.cursor.x).toBe(400);
  });

  it("opens the menu when the lock is lost unasked (Esc, alt-tab)", () => {
    const locked = reduceLock(initialLock(800, 600), { type: "acquired", buttons: 0 }).state;
    const lost = reduceLock(locked, { type: "lost" });
    expect(lost.openMenu).toBe(true);
    expect(lost.state.locked).toBe(false);
  });

  it("does not open the menu for a release the game asked for", () => {
    let s = reduceLock(initialLock(800, 600), { type: "acquired", buttons: 0 }).state;
    s = reduceLock(s, { type: "release" }).state;
    const lost = reduceLock(s, { type: "lost" });
    expect(lost.openMenu).toBe(false);
    expect(lost.state.releasing).toBe(false);
  });

  it("keeps the cursor across an unlock", () => {
    let s = reduceLock(initialLock(800, 600), { type: "acquired", buttons: 0 }).state;
    s = reduceLock(s, { type: "move", dx: 10, dy: 10, w: 800, h: 600 }).state;
    s = reduceLock(s, { type: "lost" }).state;
    expect(s.cursor).toEqual({ x: 410, y: 310 });
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
