import { describe, expect, it } from "vitest";
import { GameMode, cfg, drive, hasMode, modeConfigOf } from "@motor-combat-moba/shared";
import { installRoomMode, runInRoomMode, watchRoomMode } from "./mode-scope.js";

// This block must run FIRST and must be the only place in this file that reads config before an
// `installRoomMode` call — vitest isolates each test file into its own module graph (default
// `isolate: true`), so `@motor-combat-moba/shared`'s module-level bundle starts uninstalled for
// this file specifically, and every later `it` in this file runs after one of the blocks below has
// already installed something.
describe("runInRoomMode (nothing installed yet)", () => {
  it("throws a client-specific message pointing at installRoomMode, not shared's generic one", () => {
    expect(hasMode()).toBe(false);
    expect(() => runInRoomMode(() => cfg())).toThrow(/installRoomMode/);
  });
});

describe("installRoomMode / runInRoomMode", () => {
  it("re-installs when the host changes mode in the lobby (task-5-brief Step 1)", () => {
    installRoomMode(GameMode.FFA_LAST_STANDING);
    const before = runInRoomMode(() => drive().baseMaxSpeed);
    installRoomMode(GameMode.FFA_DEATHMATCH);
    const after = runInRoomMode(() => drive().baseMaxSpeed);
    expect(after).toBe(modeConfigOf(GameMode.FFA_DEATHMATCH).drive.baseMaxSpeed);
    expect(before).toBe(modeConfigOf(GameMode.FFA_LAST_STANDING).drive.baseMaxSpeed);
  });

  /**
   * The test above, taken alone, proves nothing: Brawl and Deathmatch ship IDENTICAL balance tables
   * today (only their `ModeDef.name`/`GameMode` id differ — see `packages/shared/src/modes/brawl/`
   * vs `deathmatch/`, which diff to nothing but a renamed export). A completely broken
   * `installRoomMode` that ignored its argument and always installed `DEFAULT_GAME_MODE`'s bundle
   * would still pass the test above, because `DEFAULT_GAME_MODE` (`FFA_LAST_STANDING`) and
   * `FFA_DEATHMATCH` read the same `baseMaxSpeed`. Two tests below close that gap without needing a
   * hand-built synthetic bundle (the `combat-visual.test.ts` pattern the brief points at) — each
   * mode's bundle is a genuinely distinct, frozen object (`registry.ts`'s `MODE_TABLE`, assembled
   * once at module load), and `ModeConfig.id` is a real value that differs between them (0 vs 2)
   * even while every balance number is equal, so both checks are non-vacuous on today's numbers.
   */
  it("installs the RIGHT mode's object, not just A mode's (non-vacuous: reference identity)", () => {
    installRoomMode(GameMode.FFA_LAST_STANDING);
    expect(cfg()).toBe(modeConfigOf(GameMode.FFA_LAST_STANDING));

    installRoomMode(GameMode.FFA_DEATHMATCH);
    expect(cfg()).toBe(modeConfigOf(GameMode.FFA_DEATHMATCH));
    // Provably not the same object as the first install — this is the assertion a "toBe" check on
    // a value-equal field could never make.
    expect(cfg()).not.toBe(modeConfigOf(GameMode.FFA_LAST_STANDING));
  });

  it("installs the RIGHT mode's object (non-vacuous: a value that visibly differs, ModeConfig.id)", () => {
    installRoomMode(GameMode.FFA_LAST_STANDING);
    expect(runInRoomMode(() => cfg().id)).toBe(GameMode.FFA_LAST_STANDING);

    installRoomMode(GameMode.FFA_DEATHMATCH);
    expect(runInRoomMode(() => cfg().id)).toBe(GameMode.FFA_DEATHMATCH);
  });

});

describe("watchRoomMode", () => {
  /** A minimal stand-in for `@colyseus/schema`'s `Schema.listen`, matching its real contract: fires
   * once immediately when `immediate` is true, then again whenever `set()` below changes the value. */
  function fakeRoom(initial: GameMode): {
    room: { state: { mode: GameMode; listen: RoomStateSource["listen"] } };
    set(mode: GameMode): void;
  } {
    let mode = initial;
    let subscriber: ((value: GameMode, previousValue: GameMode) => void) | undefined;
    const state = {
      get mode(): GameMode {
        return mode;
      },
      listen(
        prop: "mode",
        callback: (value: GameMode, previousValue: GameMode) => void,
        immediate?: boolean,
      ): () => boolean {
        subscriber = callback;
        if (immediate) callback(mode, mode);
        return () => {
          subscriber = undefined;
          return true;
        };
      },
    };
    return {
      room: { state },
      set(next: GameMode): void {
        const previous = mode;
        mode = next;
        subscriber?.(next, previous);
      },
    };
  }

  it("installs on join (immediate) and re-installs on a later state.mode change (MC16)", () => {
    const { room, set } = fakeRoom(GameMode.FFA_LAST_STANDING);

    watchRoomMode(room);
    expect(cfg()).toBe(modeConfigOf(GameMode.FFA_LAST_STANDING));

    // The host changes mode in the lobby before car select (MSG_SET_MODE) — the server patches
    // ArenaState.mode, which colyseus.js turns into exactly this kind of listen() callback.
    set(GameMode.FFA_DEATHMATCH);
    expect(cfg()).toBe(modeConfigOf(GameMode.FFA_DEATHMATCH));
    expect(cfg().id).toBe(GameMode.FFA_DEATHMATCH);

    // And back, in case a host flips it twice before starting — this must not get stuck on
    // whichever mode happened to be installed first.
    set(GameMode.FFA_LAST_STANDING);
    expect(cfg()).toBe(modeConfigOf(GameMode.FFA_LAST_STANDING));
  });
});

type RoomStateSource = {
  listen(
    prop: "mode",
    callback: (value: GameMode, previousValue: GameMode) => void,
    immediate?: boolean,
  ): () => boolean;
};
