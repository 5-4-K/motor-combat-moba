import { afterEach, describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { assembleModeConfig } from "./build.js";
import { BRAWL_TABLES } from "./brawl/index.js";
import { cfg, drive, installMode, withMode } from "./active.js";

const A = assembleModeConfig(GameMode.FFA_LAST_STANDING, BRAWL_TABLES);
const B = assembleModeConfig(GameMode.FFA_DEATHMATCH, {
  ...BRAWL_TABLES,
  drive: { ...BRAWL_TABLES.drive, baseMaxSpeed: 999 },
});

afterEach(() => installMode(A));

describe("withMode", () => {
  it("serves the installed bundle", () => {
    withMode(B, () => expect(drive().baseMaxSpeed).toBe(999));
  });

  it("restores the previous bundle after the scope, including on throw", () => {
    installMode(A);
    const before = drive().baseMaxSpeed;
    expect(() => withMode(B, () => { throw new Error("boom"); })).toThrow("boom");
    expect(drive().baseMaxSpeed).toBe(before);
  });

  it("nests, so an inner scope cannot strand the outer one", () => {
    withMode(A, () => {
      withMode(B, () => expect(cfg().id).toBe(GameMode.FFA_DEATHMATCH));
      expect(cfg().id).toBe(GameMode.FFA_LAST_STANDING);
    });
  });

  it("returns the callback's value", () => {
    expect(withMode(B, () => 42)).toBe(42);
  });
});
