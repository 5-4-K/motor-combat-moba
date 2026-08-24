// packages/client/src/assets/asset-keys.test.ts
import { describe, expect, it } from "vitest";
import { carSpriteKey } from "./asset-keys.js";

describe("carSpriteKey", () => {
  it("namespaces a known car id", () => {
    expect(carSpriteKey("hexagon")).toBe("car.hexagon");
    expect(carSpriteKey("oval")).toBe("car.oval");
  });

  it("falls back to the default chassis for anything unrecognised", () => {
    expect(carSpriteKey("bogus")).toBe("car.rectangle");
    expect(carSpriteKey("")).toBe("car.rectangle");
  });

  it("does not treat inherited object properties as car ids", () => {
    expect(carSpriteKey("constructor")).toBe("car.rectangle");
    expect(carSpriteKey("toString")).toBe("car.rectangle");
  });
});
