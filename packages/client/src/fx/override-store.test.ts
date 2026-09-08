import { afterEach, describe, expect, it } from "vitest";
import { weaponFxOf } from "./table.js";
import { fxOverrides, liveFxResolver, setFxOverrides } from "./override-store.js";

afterEach(() => setFxOverrides(null));

describe("the VFX override store", () => {
  it("starts empty", () => {
    expect(fxOverrides()).toEqual({});
  });

  it("holds what was set, and clears on null", () => {
    setFxOverrides({ "lance.muzzle.fire.count": 40 });
    expect(fxOverrides()["lance.muzzle.fire.count"]).toBe(40);
    setFxOverrides(null);
    expect(fxOverrides()).toEqual({});
  });

  it("gives a resolver that reads the store LIVE, not at construction", () => {
    const resolve = liveFxResolver();
    expect(resolve("lance")).toEqual(weaponFxOf("lance"));
    setFxOverrides({ "lance.muzzle.fire.count": 40 });
    expect(resolve("lance").muzzle.find((b) => b.channel === "fire")!.count).toBe(40);
  });
});
