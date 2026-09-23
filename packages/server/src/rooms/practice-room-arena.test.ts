// `newPracticeState().arenaId` is meant to come from Deathmatch's OWN mode bundle
// (`modeConfigOrDefault(GameMode.FFA_DEATHMATCH).arenas[0]`, MC23) rather than from
// `ArenaState.arenaId`'s field-initializer default (`ACTIVE_ARENA_ID`, MC26). Today those two
// happen to be the SAME string ("arena-01"), because Deathmatch's shipped arena set is
// `["arena-01", "arena-02"]` — so `expect(newPracticeState().arenaId).toBe(modeConfigOf(...).arenas[0])`
// in `practice-room.test.ts` passes whether or not `newPracticeState` ever writes `arenaId` at all:
// delete that write and the field initializer alone already produces the same value. That test is
// still worth having (it pins the INTENDED source), but it cannot distinguish "read from the
// bundle" from "coincidentally equal to the default", which is exactly the trap this task's brief
// warned about for a bare `toBe("arena-01")`.
//
// This file proves causation instead of coincidence, the same way `modes/registry-arenas.test.ts`
// proves `activeArenaIds()`'s union/order/de-dup against data the real tables don't distinguish:
// it mocks `@motor-combat-moba/shared`'s `modeConfigOrDefault` so Deathmatch's `arenas[0]` differs
// from `ACTIVE_ARENA_ID`, then re-imports `PracticeRoom.js` under that mock. If `newPracticeState`
// genuinely reads the bundle, the mocked arena comes out; if it silently fell back to the field
// initializer, `ACTIVE_ARENA_ID` ("arena-01") would come out instead and the assertion below fails.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@motor-combat-moba/shared");
  vi.resetModules();
});

describe("newPracticeState arena wiring — causation, not coincidence (MC23, MC26)", () => {
  it("comes out as the MOCKED Deathmatch arena, not ACTIVE_ARENA_ID's default, when the two are forced to differ", async () => {
    vi.doMock("@motor-combat-moba/shared", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@motor-combat-moba/shared")>();
      return {
        ...actual,
        modeConfigOrDefault: (mode: number) => {
          const real = actual.modeConfigOrDefault(mode);
          if (mode !== actual.GameMode.FFA_DEATHMATCH) return real;
          // Deliberately NOT "arena-01" (== the real ACTIVE_ARENA_ID) or "arena-02" (Deathmatch's
          // real second arena) — a value that cannot arise from any path except reading THIS
          // mocked bundle's `arenas[0]`.
          return { ...real, arenas: ["arena-mocked-only"] };
        },
      };
    });
    vi.resetModules();

    const { newPracticeState } = await import("./PracticeRoom.js");
    const { ACTIVE_ARENA_ID, DEFAULT_GAME_MODE, installMode, modeConfigOf } = await import(
      "@motor-combat-moba/shared"
    );
    // `countdownTicks` (called from `newPracticeState` via `beginCountdown`) reads `flow()`, a
    // scoped config accessor that throws outside an installed mode (see the package's "cfg() throws
    // outside a mode scope" invariant) — unrelated to the arena wiring this test is proving, so it
    // is installed the same way `practice-room.test.ts`'s own `beforeEach` does.
    installMode(modeConfigOf(DEFAULT_GAME_MODE));

    const state = newPracticeState();
    expect(state.arenaId).toBe("arena-mocked-only");
    expect(state.arenaId).not.toBe(ACTIVE_ARENA_ID);
  });
});
