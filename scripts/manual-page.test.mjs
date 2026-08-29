import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { OUT_WEB_HTML, STAMP_META_NAME, balanceStamp } from "./build-cars-and-weapons.mjs";

/**
 * Guards on the generated cars-and-weapons guide page.
 *
 * Two things about that page are invisible to the compiler and to every other suite. The join screen
 * links a path that is a string on one side and a file on the other, so a renamed output is a 404 in
 * a player's face. And the page is generated but COMMITTED, so a balance edit that skips
 * `npm run build:manual` leaves players reading last week's numbers while everything passes. This
 * file is what makes both of those fail loudly.

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

  /**
   * The staleness guard. `balanceStamp` fingerprints every table and every line of prose the guide
   * reports, so this fails the moment a weapon, a chassis or the copy moves without a rebuild — the
   * one failure mode a generated-but-committed file has that a generated-at-build-time one does not.
   */
  it("was rebuilt after the last change to the tables or the prose", () => {
    const html = read(path.join(PUBLIC_DIR, manualPath()));
    const stamped = new RegExp(`<meta name="${STAMP_META_NAME}" content="([^"]+)">`).exec(html);
    assert.ok(stamped, `the guide page carries no ${STAMP_META_NAME}; rebuild it`);
    assert.equal(
      stamped[1],
      balanceStamp(),
      "the committed guide page is stale — a balance table or the manual copy changed after it was " +
        "last built. Run `npm run build:manual` and commit the page it writes.",
    );
  });

  it("is the file the build script names as its own output", () => {
    assert.equal(OUT_WEB_HTML, path.join(PUBLIC_DIR, manualPath()));
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
