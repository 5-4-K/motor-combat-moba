import { describe, expect, it } from "vitest";
import { EMPTY_MANIFEST, parseManifest } from "./manifest-schema.js";

describe("parseManifest", () => {
  it("applies defaults to a bare entry", () => {
    const { manifest, problems } = parseManifest({
      sprites: { "car.mirage": { file: "cars/mirage.png" } },
    });
    expect(problems).toEqual([]);
    expect(manifest.sprites["car.mirage"]).toEqual({
      file: "cars/mirage.png",
      rotationOffset: 0,
      scale: "fit",
      colorMode: "tint",
      origin: [0.5, 0.5],
    });
  });

  it("keeps explicit values over defaults", () => {
    const { manifest } = parseManifest({
      sprites: {
        "projectile.bullet": {
          file: "fx/shot.png",
          rotationOffset: 1.5,
          scale: 2,
          colorMode: "none",
          origin: [0.25, 0.75],
        },
      },
    });
    expect(manifest.sprites["projectile.bullet"]).toEqual({
      file: "fx/shot.png",
      rotationOffset: 1.5,
      scale: 2,
      colorMode: "none",
      origin: [0.25, 0.75],
    });
  });

  it("drops only the bad entry and keeps the good ones", () => {
    const { manifest, problems } = parseManifest({
      sprites: {
        "car.bullseye": { file: "cars/bullseye.png" },
        "car.bastion": { file: "cars/bastion.png", colorMode: "rainbow" },
      },
    });
    expect(Object.keys(manifest.sprites)).toEqual(["car.bullseye"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("car.bastion");
  });

  it("rejects an entry with no file", () => {
    const { manifest, problems } = parseManifest({ sprites: { "car.bullseye": { scale: 2 } } });
    expect(manifest.sprites).toEqual({});
    expect(problems[0]).toContain("file");
  });

  it("rejects a non-positive or non-finite scale", () => {
    const { problems } = parseManifest({
      sprites: {
        a: { file: "a.png", scale: 0 },
        b: { file: "b.png", scale: Number.NaN },
        c: { file: "c.png", scale: "big" },
      },
    });
    expect(problems).toHaveLength(3);
  });

  it("refuses prototype-polluting keys", () => {
    const { manifest, problems } = parseManifest(
      JSON.parse(
        '{"sprites":{"__proto__":{"file":"evil.png"},"car.bullseye":{"file":"cars/bullseye.png"}}}',
      ),
    );
    expect(Object.keys(manifest.sprites)).toEqual(["car.bullseye"]);
    expect(problems).toHaveLength(1);
  });

  it("returns the empty manifest for junk input rather than throwing", () => {
    expect(parseManifest(null).manifest).toEqual(EMPTY_MANIFEST);
    expect(parseManifest("nope").manifest).toEqual(EMPTY_MANIFEST);
    expect(parseManifest({ sprites: 7 }).manifest).toEqual(EMPTY_MANIFEST);
  });

  it("treats a manifest with no sprites key as empty and unproblematic", () => {
    const { manifest, problems } = parseManifest({});
    expect(manifest).toEqual(EMPTY_MANIFEST);
    expect(problems).toEqual([]);
  });
});
