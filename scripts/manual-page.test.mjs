import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  CAR_TABLE,
  TICK_RATE_HZ,
  WEAPON_TABLE,
  carHullOf,
  instanceExpired,
  resolveInstanceHits,
  spawnInstances,
  stepInstance,
} from "@motor-combat-moba/shared";
import {
  OUT_WEB_HTML,
  STAMP_META_NAME,
  balanceStamp,
  carrierOf,
  hitsPerTargetOf,
} from "./build-cars-and-weapons.mjs";

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

/**
 * The most times one press of `weaponId` can damage a single car, measured by running the sim.
 *
 * Mirrors `combat.ts` step 4 exactly — step the instance, check expiry, then resolve hits — because
 * a paraphrase of that order is what the arithmetic this guards already got wrong once. The target
 * is swept down the firing line rather than parked at one distance: a growing beam covers a near car
 * for more of its life than a far one, and the printed ceiling is the best case over all placements.
 *
 * ONE PRESS, not one instance. A beam can now be a wave sequence (`shockwave` is three discs 500 ms
 * apart), and each wave is a separate instance with its own per-target damage clock, so a press's
 * ceiling is the sum over its waves. Every wave is run through the real `spawnInstances` with a
 * well-formed `ShotOrder` (`weaponId`, `slot`, `finalVolley`) rather than the first wave's count
 * being multiplied, so a future weapon whose waves differ in damage or hitbox is measured rather
 * than assumed. Only `.damage` is read here, so `finalVolley` does not change this function's
 * number — it is set correctly anyway because a malformed `ShotOrder` is still a bug waiting for a
 * caller that reads more of it.
 */
function simHitsPerTarget(weaponId) {
  const def = WEAPON_TABLE[weaponId];
  const dt = 1 / TICK_RATE_HZ;
  const bounds = { width: 4000, height: 4000 };
  // Centred in a large empty world, so no wall clips the beam and nothing else is in scope.
  const owner = { sessionId: "shooter", team: 0, carId: carrierOf(weaponId), x: 2000, y: 2000, angle: 0 };
  let best = 0;

  for (let distance = 30; distance <= def.range; distance += 10) {
    const snapshot = [
      { sessionId: "target", team: 1, hull: carHullOf(owner.x + distance, owner.y, 0) },
    ];
    let hits = 0;
    for (let volleyIndex = 0; volleyIndex < def.volley.volleys; volleyIndex++) {
      // The waves of a shipped sequence never overlap (500 ms apart, 250 ms of life), so each runs
      // on its own clock from tick 0 and their hits simply add.
      const finalVolley = volleyIndex === def.volley.volleys - 1;
      let instance = spawnInstances({ weaponId, slot: 0, finalVolley }, owner, 0, 0).instances[0];
      for (let tick = 0; tick < 600; tick++) {
        const previous = instance;
        // Tick 0 is the spawn tick: `combat.ts` steps only instances that already existed, so a
        // fresh shot is hit-tested at the muzzle before it has moved. Stepping it here would skip a
        // tick.
        if (tick > 0) {
          instance = stepInstance(instance, { dt, tick, obstacles: [], bounds, ownerPose: owner });
        }
        if (instanceExpired(instance, tick)) break;
        const outcome = resolveInstanceHits(instance, previous, snapshot, "ffa", tick);
        instance = outcome.instance;
        if (outcome.damaged.length > 0) hits++;
      }
    }
    best = Math.max(best, hits);
  }
  return best;
}

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

  /**
   * The staleness guard above proves the page was REBUILT after the tables changed. It cannot prove
   * the rebuild computed anything real: a field the builder reads that has moved to a different path
   * on `WeaponDef` resolves to `undefined`, every arithmetic expression built from it turns to `NaN`,
   * and the stamp still matches because the stamp only fingerprints the SOURCE tables, never the
   * builder's own output. That is exactly how `Damage: NaN` reached a committed page, in five of nine
   * weapon cards, through a fully green suite (R9) — `build-cars-and-weapons.mjs` is plain `.mjs` and
   * nothing else in the repo typechecks it.
   */
  it("never renders NaN anywhere on the page", () => {
    const html = read(path.join(PUBLIC_DIR, manualPath()));
    assert.equal(
      html.includes("NaN"),
      false,
      "the guide page contains NaN — a field build-cars-and-weapons.mjs reads no longer exists at " +
        "that path on WeaponDef. Find the stale access (grep the script for the field that moved) " +
        "and fix it, then run `npm run build:manual` and commit the page it writes.",
    );
  });

  /**
   * The staleness stamp above proves the page matches the TABLES. It cannot prove the arithmetic
   * over those tables is right, and for eighteen days it wasn't: the builder counted a beam's damage
   * ticks as `floor(lifeMs / intervalMs)`, which loses the opening tick. `bulwark` shipped as
   * "35 × 8 = 280" while the sim dealt 315, and every suite passed the whole time.
   *
   * So this one asks the sim. It runs the real spawn/step/expire/hit pipeline, in the same order
   * `combat.ts` runs it, and counts what one press can actually land on one car. Chained to the
   * stamp — page matches builder, builder matches sim — it is the page that is pinned to the game.
   */
  it("prints beam damage totals the sim actually deals", () => {
    for (const [id, def] of Object.entries(WEAPON_TABLE)) {
      // Projectiles are excluded on purpose: their printed ceiling is "every pellet in the volley
      // hits", which no single placement can reproduce — a fanned burst is spread across an arc by
      // construction. A beam's ceiling is a real, reachable number, which is why it can be pinned.
      if (def.kind !== "beam") continue;
      // Uncarried rows (`tremor`) are excluded because the page is: the guide derives its numbers
      // from the kits, so a weapon on no chassis prints nothing this test could pin. The moment a
      // kit lists it, this loop picks it up again with no edit here.
      if (!Object.values(CAR_TABLE).some((car) => car.weapons.includes(id))) continue;
      assert.equal(
        simHitsPerTarget(id),
        hitsPerTargetOf(id),
        `the guide prints ${hitsPerTargetOf(id)} damage tick(s) for ${id}, but the sim deals ` +
          `${simHitsPerTarget(id)}. Fix the derivation in build-cars-and-weapons.mjs, then run ` +
          "`npm run build:manual`.",
      );
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
