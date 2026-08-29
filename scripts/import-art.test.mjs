import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeFit,
  importWarnings,
  formatManifest,
  keyBackgroundInPlace,
  mergeManifestEntry,
  outputSizeFor,
} from "./import-art.mjs";

const HULL = { width: 48, height: 32 };

/** Build an RGBA buffer from a picture where `L` is a light pixel and `D` a dark one. */
function rgba(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = rows[y][x] === "L" ? 240 : 20;
      const i = (y * width + x) * 4;
      buf[i] = buf[i + 1] = buf[i + 2] = value;
      buf[i + 3] = 255;
    }
  }
  return { buf, width, height };
}

const alphaAt = (buf, width, x, y) => buf[(y * width + x) * 4 + 3];

describe("outputSizeFor", () => {
  it("scales a landscape source so its long edge hits the target", () => {
    assert.deepEqual(outputSizeFor({ width: 1197, height: 698 }, 192), {
      width: 192,
      height: 112,
    });
  });

  it("scales a portrait source by its height instead", () => {
    assert.deepEqual(outputSizeFor({ width: 698, height: 1197 }, 192), {
      width: 112,
      height: 192,
    });
  });

  it("never collapses an extreme aspect to a zero dimension", () => {
    const size = outputSizeFor({ width: 4000, height: 3 }, 192);
    assert.equal(size.width, 192);
    assert.equal(size.height, 1);
  });
});

describe("describeFit", () => {
  it("reports a 3:2 texture filling the hull exactly", () => {
    const fit = describeFit({ width: 192, height: 128 }, HULL);
    assert.equal(fit.scale, 0.25);
    assert.equal(fit.drawnWidth, 48);
    assert.equal(fit.drawnHeight, 32);
  });

  it("reports the wasted hull height when the art is too long", () => {
    const fit = describeFit({ width: 192, height: 112 }, HULL);
    assert.equal(fit.scale, 0.25);
    assert.equal(fit.drawnWidth, 48);
    assert.equal(fit.drawnHeight, 28);
  });

  it("fits against the tighter axis when the art is too tall", () => {
    const fit = describeFit({ width: 128, height: 192 }, HULL);
    assert.ok(Math.abs(fit.scale - 32 / 192) < 1e-9);
    assert.ok(Math.abs(fit.drawnHeight - 32) < 1e-9);
    assert.ok(fit.drawnWidth < HULL.width);
  });
});

describe("mergeManifestEntry", () => {
  it("adds a bare row to an empty manifest", () => {
    const next = mergeManifestEntry({ sprites: {} }, "car.mirage", "cars/mirage.png");
    assert.deepEqual(next.sprites, {
      "car.mirage": { file: "cars/mirage.png" },
    });
  });

  it("keeps hand-tuned fields when the same car is re-imported", () => {
    const before = {
      sprites: {
        "car.bastion": {
          file: "cars/old.png",
          rotationOffset: 1.5707963,
          colorMode: "none",
          origin: [0.4, 0.5],
        },
      },
    };
    const next = mergeManifestEntry(before, "car.bastion", "cars/bastion.png");
    assert.deepEqual(next.sprites["car.bastion"], {
      file: "cars/bastion.png",
      rotationOffset: 1.5707963,
      colorMode: "none",
      origin: [0.4, 0.5],
    });
  });

  it("leaves other cars untouched", () => {
    const before = { sprites: { "car.bullseye": { file: "cars/bullseye.png", scale: 2 } } };
    const next = mergeManifestEntry(before, "car.mirage", "cars/mirage.png");
    assert.deepEqual(next.sprites["car.bullseye"], { file: "cars/bullseye.png", scale: 2 });
  });

  it("does not mutate the manifest it was given", () => {
    const before = { sprites: {} };
    mergeManifestEntry(before, "car.mirage", "cars/mirage.png");
    assert.deepEqual(before.sprites, {});
  });

  it("treats a manifest with no sprites key as empty", () => {
    const next = mergeManifestEntry({}, "car.bullseye", "cars/bullseye.png");
    assert.deepEqual(next.sprites, { "car.bullseye": { file: "cars/bullseye.png" } });
  });
});

describe("importWarnings", () => {
  it("warns when the source carries no alpha channel", () => {
    const warnings = importWarnings({
      hasAlpha: false,
      format: "jpeg",
      source: { width: 192, height: 128 },
      hull: HULL,
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /alpha/i);
  });

  it("warns when the art is far longer than the hull", () => {
    const warnings = importWarnings({
      hasAlpha: true,
      format: "png",
      source: { width: 230, height: 100 },
      hull: HULL,
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /hull/i);
  });

  it("stays silent for art that matches the hull", () => {
    assert.deepEqual(
      importWarnings({
        hasAlpha: true,
        format: "png",
        source: { width: 192, height: 128 },
        hull: HULL,
      }),
      [],
    );
  });

  it("reports both problems at once", () => {
    const warnings = importWarnings({
      hasAlpha: false,
      format: "jpeg",
      source: { width: 230, height: 100 },
      hull: HULL,
    });
    assert.equal(warnings.length, 2);
  });
});

describe("keyBackgroundInPlace", () => {
  it("clears the background reachable from the corners", () => {
    const { buf, width, height } = rgba(["LLLLL", "LDDDL", "LDLDL", "LDDDL", "LLLLL"]);
    keyBackgroundInPlace(buf, { width, height });
    assert.equal(alphaAt(buf, width, 0, 0), 0);
    assert.equal(alphaAt(buf, width, 4, 4), 0);
    assert.equal(alphaAt(buf, width, 2, 0), 0);
  });

  it("does not leak through a closed dark outline", () => {
    const { buf, width, height } = rgba(["LLLLL", "LDDDL", "LDLDL", "LDDDL", "LLLLL"]);
    keyBackgroundInPlace(buf, { width, height });
    assert.equal(alphaAt(buf, width, 2, 2), 255, "the enclosed light pixel must survive");
  });

  it("leaves the outline itself opaque", () => {
    const { buf, width, height } = rgba(["LLLLL", "LDDDL", "LDLDL", "LDDDL", "LLLLL"]);
    keyBackgroundInPlace(buf, { width, height });
    assert.equal(alphaAt(buf, width, 1, 1), 255);
    assert.equal(alphaAt(buf, width, 3, 3), 255);
  });

  it("reports how much of the image it cleared", () => {
    const { buf, width, height } = rgba(["LLLLL", "LDDDL", "LDLDL", "LDDDL", "LLLLL"]);
    const cleared = keyBackgroundInPlace(buf, { width, height });
    assert.equal(cleared, 16);
  });

  it("cannot start a fill from a dark corner", () => {
    const { buf, width, height } = rgba(["DLLL", "LLLL", "LLLL", "LLLL"]);
    const cleared = keyBackgroundInPlace(buf, { width, height });
    assert.equal(alphaAt(buf, width, 0, 0), 255);
    assert.equal(cleared, 15);
  });
});

describe("importWarnings with the background already keyed", () => {
  it("does not tell you to re-run a flag you already used", () => {
    const warnings = importWarnings({
      hasAlpha: false,
      format: "jpeg",
      source: { width: 192, height: 128 },
      hull: HULL,
      keyed: true,
    });
    assert.equal(warnings.length, 0);
  });

  it("still reports a hull mismatch when the background was keyed", () => {
    const warnings = importWarnings({
      hasAlpha: false,
      format: "jpeg",
      source: { width: 230, height: 100 },
      hull: HULL,
      keyed: true,
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /hull/i);
  });
});

describe("formatManifest", () => {
  it("keeps an origin pair on one line so the file stays hand-editable", () => {
    const text = formatManifest({
      sprites: { "car.bullseye": { file: "cars/bullseye.png", origin: [0.45, 0.5] } },
    });
    assert.match(text, /"origin": \[0\.45, 0\.5\]/);
  });

  it("still indents the object structure two spaces", () => {
    const text = formatManifest({ sprites: { "car.bullseye": { file: "cars/bullseye.png" } } });
    assert.match(text, /\n  "sprites": \{\n    "car\.bullseye": \{\n      "file": "cars\/bullseye\.png"/);
  });

  it("ends with a trailing newline", () => {
    assert.ok(formatManifest({ sprites: {} }).endsWith("}\n"));
  });

  it("round-trips through JSON.parse unchanged", () => {
    const manifest = {
      sprites: { "car.bastion": { file: "a.png", origin: [0.25, 0.75], scale: 2 } },
    };
    assert.deepEqual(JSON.parse(formatManifest(manifest)), manifest);
  });
});
