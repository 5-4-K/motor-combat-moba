import { beforeEach, describe, expect, it } from "vitest";
import { ENVIRONMENT_FX } from "./environment.js";
import { envKey } from "./env-tuning.js";
import { bumpEnvVersion, envOverrides, liveEnvResolver, setEnvOverrides } from "./env-store.js";

describe("env store", () => {
  beforeEach(() => setEnvOverrides(null));

  it("starts empty and resolves to the shipped table", () => {
    expect(envOverrides()).toEqual({});
    expect(liveEnvResolver()()).toEqual(ENVIRONMENT_FX);
  });

  it("reads the store at CALL time, not at construction", () => {
    const resolve = liveEnvResolver();
    setEnvOverrides({ [envKey("grade", "saturate")]: -0.5 });
    expect(resolve().grade.saturate).toBe(-0.5);
  });

  it("returns the same object twice while nothing has changed (EV19)", () => {
    const resolve = liveEnvResolver();
    expect(resolve()).toBe(resolve());
  });

  it("re-resolves after an in-place mutation is announced", () => {
    const map = { [envKey("grade", "saturate")]: -0.5 };
    setEnvOverrides(map);
    const resolve = liveEnvResolver();
    expect(resolve().grade.saturate).toBe(-0.5);
    map[envKey("grade", "saturate")] = -0.9;
    bumpEnvVersion();
    expect(resolve().grade.saturate).toBe(-0.9);
  });

  it("clears back to the shipped table on null", () => {
    setEnvOverrides({ [envKey("grade", "saturate")]: -0.5 });
    setEnvOverrides(null);
    expect(liveEnvResolver()()).toEqual(ENVIRONMENT_FX);
  });
});
