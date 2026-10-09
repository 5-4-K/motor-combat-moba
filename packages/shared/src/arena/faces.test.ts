import { describe, expect, it } from "vitest";
import { facesOfNormal, WORLD_FACES } from "./faces.js";

describe("facesOfNormal (TC23)", () => {
  it("lists the four faces n-e-s-w", () => {
    expect(WORLD_FACES).toEqual(["n", "e", "s", "w"]);
  });

  it("names the face an axis vector leaves through", () => {
    expect(facesOfNormal(0, -1)).toEqual(["n"]);
    expect(facesOfNormal(1, 0)).toEqual(["e"]);
    expect(facesOfNormal(0, 1)).toEqual(["s"]);
    expect(facesOfNormal(-1, 0)).toEqual(["w"]);
  });

  it("takes the dominant axis", () => {
    expect(facesOfNormal(0.6, -0.8)).toEqual(["n"]);
  });

  it("names both faces on an exact tie", () => {
    expect(facesOfNormal(1, 1)).toEqual(["e", "s"]);
  });

  it("names every face for a zero vector", () => {
    expect(facesOfNormal(0, 0)).toEqual(["n", "e", "s", "w"]);
  });
});
