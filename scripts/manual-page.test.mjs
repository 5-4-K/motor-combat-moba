import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Guards on the generated manual page. The join screen links a path that no type checker can see —
 * `MANUAL_PATH` is a string on one side and a file the build script writes on the other — so the
 * only thing standing between a renamed output and a 404 in a player's face is this file.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "packages/client/public");
const BUILDER = path.join(ROOT, "scripts/build-cars-and-weapons.mjs");
const CONFIG = path.join(ROOT, "packages/client/src/config/manual.ts");

const read = (file) => fs.readFileSync(file, "utf8");

/** `MANUAL_PATH`'s value, read as source text — the config is TypeScript, so it cannot be imported. */
function manualPath() {
  const match = /export const MANUAL_PATH = "([^"]+)"/.exec(read(CONFIG));
  assert.ok(match, "config/manual.ts must export a string literal MANUAL_PATH");
  return match[1];
}

describe("the generated manual page", () => {
  it("exists at the path the join screen links to", () => {
    const file = path.join(PUBLIC_DIR, manualPath());
    assert.ok(
      fs.existsSync(file),
      `${manualPath()} is missing from packages/client/public/. Run \`npm run build:manual\`.`,
    );
  });

  it("is the file the build script writes", () => {
    assert.match(read(BUILDER), new RegExp(`packages/client/public/${manualPath()}`));
  });

  it("is a whole document and not a fragment", () => {
    const html = read(path.join(PUBLIC_DIR, manualPath()));
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<title>[^<]+<\/title>/);
  });

  /**
   * The release zip is played on LANs with no route to the internet, where a remote font or image
   * does not fail loudly — it silently falls back and wrecks the page. `assertFontsVendored` makes
   * the same check over the built CSS; this one covers the manual, which is HTML and so slips past
   * that guard entirely.
   */
  it("reaches for nothing off the machine", () => {
    const html = read(path.join(PUBLIC_DIR, manualPath()));
    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com", "http://", "https://"]) {
      assert.equal(html.includes(host), false, `manual page references ${host}`);
    }
  });

  it("points at art the client already ships", () => {
    const html = read(path.join(PUBLIC_DIR, manualPath()));
    const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(srcs.length > 0, "the manual draws no images at all");
    for (const src of new Set(srcs)) {
      assert.ok(
        fs.existsSync(path.join(PUBLIC_DIR, src)),
        `manual references ${src}, which is not in packages/client/public/`,
      );
    }
  });
});
