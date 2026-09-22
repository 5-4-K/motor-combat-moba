// `modeConfigOrDefault`'s "log once" guarantee had no test: only the non-throwing fallback was
// asserted (see `registry.test.ts`). The module-level `warnedOnUnknownMode` flag exists to stop a
// persistent bad mode byte spamming a 30 Hz tick loop — a regression to per-call logging would be
// invisible to the rest of the suite and would only surface as a flooded production log.
//
// The flag lives at module scope in `registry.ts` and is never exported for reset, so this file
// gets its OWN fresh module instance per test via `vi.resetModules()` + a dynamic `import()`
// inside each `it`. Without that isolation, `registry.test.ts`'s own call to
// `modeConfigOrDefault(99)` (in the same vitest module graph, since vitest caches ES modules per
// test FILE, not per `it`) would already have flipped the flag before this file's assertions ran —
// exactly the leak the brief warns about.
import { afterEach, describe, expect, it, vi } from "vitest";

describe("modeConfigOrDefault logs an unrecognised mode byte exactly once", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs once across many calls with the same bad byte, not once per call", async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { modeConfigOrDefault, MODE_TABLE, DEFAULT_GAME_MODE } = await import("./registry.js");

    modeConfigOrDefault(99);
    modeConfigOrDefault(99);
    modeConfigOrDefault(99);
    modeConfigOrDefault(99);

    expect(warn).toHaveBeenCalledTimes(1);
    // Every call still falls back correctly, logged or not.
    expect(modeConfigOrDefault(99)).toBe(MODE_TABLE[DEFAULT_GAME_MODE].config);
  });

  it("logs once even across DIFFERENT unrecognised bytes (the flag, not the byte, is what's tracked)", async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { modeConfigOrDefault } = await import("./registry.js");

    modeConfigOrDefault(97);
    modeConfigOrDefault(98);
    modeConfigOrDefault(99);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a fresh module instance (as a fresh server process would start) logs again", async () => {
    vi.resetModules();
    const warnFirst = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await import("./registry.js");
    first.modeConfigOrDefault(99);
    expect(warnFirst).toHaveBeenCalledTimes(1);
    warnFirst.mockRestore();

    vi.resetModules();
    const warnSecond = vi.spyOn(console, "warn").mockImplementation(() => {});
    const second = await import("./registry.js");
    second.modeConfigOrDefault(99);
    expect(warnSecond).toHaveBeenCalledTimes(1);
  });
});
