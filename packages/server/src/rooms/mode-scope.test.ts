import { describe, expect, it } from "vitest";
import { GameMode, modeConfigOf } from "@motor-combat-moba/shared";
import { scoped } from "./mode-scope.js";

describe("scoped", () => {
  it("is synchronous and refuses a promise-returning callback", () => {
    expect(() =>
      scoped(modeConfigOf(GameMode.FFA_LAST_STANDING), (() => Promise.resolve(1)) as never),
    ).toThrow(/synchronous/);
  });

  it("installs the given bundle and returns the callback's value", () => {
    const config = modeConfigOf(GameMode.FFA_DEATHMATCH);
    expect(scoped(config, () => 42)).toBe(42);
  });
});
