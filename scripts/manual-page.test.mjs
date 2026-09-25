import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  CAR_TABLE,
  GameMode,
  MODE_TABLE,
  TICK_RATE_HZ,
  TURRET_CONFIG,
  WEAPON_TABLE,
  DEFAULT_GAME_MODE,
  activeCarIds,
  activeGameModes,
  applyOverrides,
  carHullOf,
  installMode,
  instanceExpired,
  modeConfigOf,
  resolveInstanceHits,
  spawnInstances,
  stepInstance,
  winRuleOf,
} from "@motor-combat-moba/shared";
import { EFFECT_SOURCES } from "./cars-and-weapons-copy.mjs";

// THIS FILE's own config reads need a mode installed: `simHitsPerTarget` drives the real sim
// (`spawnInstances`, `stepInstance`, `resolveInstanceHits`), `activeCarIds()` and `carHullOf` read
// the bundle, and `cfg()` throws outside a scope (MC12). It is installed here, before the dynamic
// import below, rather than in a `beforeEach`, because several cases read config at describe level.
//
// The module under test no longer needs it. `build-cars-and-weapons.mjs` used to `installMode` the
// default bundle at module load and derive everything under it; since MC41 it scopes each mode's
// derivation in its own `withMode` and installs nothing, so a static import would be safe. The
// dynamic import is kept anyway: the ordering it guarantees is what stops this file's own
// `installMode` from being silently load-order-dependent again the day the builder changes back.
installMode(modeConfigOf(DEFAULT_GAME_MODE));

const {
  OUT_WEB_HTML,
  STAMP_META_NAME,
  balanceStamp,
  carSection,
  carrierOf,
  hitsPerTargetOf,
  modelOf,
  stampOfModes,
} = await import("./build-cars-and-weapons.mjs");

/**
 * A model of the DEFAULT mode with `slots.basicAttackEnabled` set to `enabled` (GM9, Task 4: the
 * flag is per mode now, no raw `BASIC_ATTACK_CONFIG` global left to flip). `carSection(carId,
 * model)` takes this in place of the shipped `DEFAULT_MODEL` for the cases below that need to
 * exercise both positions of the toggle.
 */
function modelWithBasicAttack(enabled) {
  return modelOf(applyOverrides(modeConfigOf(DEFAULT_GAME_MODE), { "slots.basicAttackEnabled": enabled }));
}

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

/**
 * The page sliced into one chunk per mode tab, keyed by `GameMode` value.
 *
 * Sliced on the `<section class="modesec" id="mode-N">` openers rather than parsed: the sections
 * nest further `<section>` elements, so a regex for the matching close tag would find the wrong one.
 * Each chunk therefore runs from its own opener to the next mode's (the last one to end of file),
 * which is exactly the span whose ids and links must agree with each other and with nothing else.
 */
function modeSections(html) {
  const opens = [...html.matchAll(/<section class="[^"]*modesec[^"]*" id="mode-(\d+)"/g)].map((m) => ({
    mode: Number(m[1]),
    at: m.index,
  }));
  return new Map(
    opens.map((open, i) => [
      open.mode,
      html.slice(open.at, i + 1 < opens.length ? opens[i + 1].at : html.length),
    ]),
  );
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
   * VS30. `N` (`WEAPON_SLOT_CONFIG.maxAbilitySlots`) changes what the page SAYS — how many weapons
   * each chassis lists — so a change to it that skipped `npm run build:manual` would ship a guide
   * advertising slots the build lacks. The module exposes no inputs-key helper to assert against
   * directly, so this reads `balanceStamp`'s own source and checks the literal input is there —
   * a structural check that fails if the line is ever deleted, rather than a value check that
   * cannot see whether the field was wired into the hash at all.
   */
  it("folds the build's slot count into the stamp", () => {
    const src = read(BUILDER);
    // Per mode since MC41: `slots` is one of the thirteen tables a mode folder authors, so the
    // input is the BUNDLE's copy, not the raw global the game stopped reading.
    assert.match(src, /abilitySlots: config\.slots\.maxAbilitySlots/);
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
      // Rows the page does not print are excluded, because the page is what this pins: the guide
      // derives its numbers from ACTIVE chassis kits, so a weapon on no chassis (`tremor`) prints
      // nothing, and neither does one carried only by a chassis still in development. The moment an
      // active kit lists it, this loop picks it up again with no edit here.
      if (!activeCarIds().some((carId) => CAR_TABLE[carId].weapons.includes(id))) continue;
      assert.equal(
        simHitsPerTarget(id),
        hitsPerTargetOf(id),
        `the guide prints ${hitsPerTargetOf(id)} damage tick(s) for ${id}, but the sim deals ` +
          `${simHitsPerTarget(id)}. Fix the derivation in build-cars-and-weapons.mjs, then run ` +
          "`npm run build:manual`.",
      );
    }
  });

  /**
   * The 2026-09-17 restructure made the page cross-reference itself: a weapon's Effect chips are
   * links into the Effects section, so "what does Corroded do" is one click rather than a search.
   *
   * Nothing else can catch a dead one. The anchor is a string on both sides, the compiler never
   * sees this file, and a browser answers a missing `#id` by silently doing nothing — so a status
   * that stops being published (its last carrier retired, its source removed) would leave every
   * chip pointing at it as a link that looks fine and goes nowhere.
   */
  it("resolves every in-page link to an anchor that exists", () => {
    const html = read(path.join(PUBLIC_DIR, manualPath()));
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    assert.ok(targets.length > 0, "the manual carries no in-page links at all");
    const dead = [...new Set(targets)].filter((target) => !ids.has(target));
    assert.deepEqual(
      dead,
      [],
      `the manual links to anchors nothing on the page defines: ${dead.join(", ")}. ` +
        "An effect is only published when something can apply it — see PUBLISHED_EFFECTS in " +
        "build-cars-and-weapons.mjs.",
    );
  });

  /**
   * The other half of the same pairing, and the reason both halves are now scoped to ONE TAB.
   *
   * An effect the page describes but never links to is a section nobody can reach from the weapon
   * that inflicts it. Both directions matter, and only one of them is a broken link.
   *
   * Since MC41 the page publishes an Effects list per mode, so the global check above cannot see the
   * failure that matters: a chip in Brawl's weapon list resolving into DEATHMATCH's Effects section
   * would publish that mode's duration and description under Brawl's name, with every link alive and
   * nothing failing. Anchors are mode-prefixed to make that impossible, and this is what holds the
   * prefixing in place — each tab's ids and each tab's links must close over each other.
   */
  it("resolves every effect link within its own mode's section", () => {
    const sections = modeSections(read(path.join(PUBLIC_DIR, manualPath())));
    assert.equal(sections.size, activeGameModes().length, "a mode tab is missing from the page");
    for (const mode of activeGameModes()) {
      const section = sections.get(mode);
      assert.ok(section, `no section for mode ${mode}`);
      const published = [...section.matchAll(/\sid="(fx-[^"]+)"/g)].map((m) => m[1]);
      const linked = [...section.matchAll(/href="#(fx-[^"]+)"/g)].map((m) => m[1]);
      assert.ok(published.length > 0, `mode ${mode} publishes no effects`);
      assert.ok(linked.length > 0, `mode ${mode} links to no effects`);
      // Every id this tab defines carries this tab's mode, and every effect link inside it points
      // at one of them — no chip reaches across into another tab's list.
      for (const id of [...published, ...linked]) {
        assert.match(id, new RegExp(`^fx-${mode}-`), `${id} is published in mode ${mode}'s section`);
      }
      const dead = [...new Set(linked)].filter((id) => !published.includes(id));
      assert.deepEqual(dead, [], `mode ${mode} links to effects its own section does not define`);
      // `ramLock` and `phased` come from the contact pass and from the deathmatch respawn, not from
      // a weapon row, so nothing in the Cars section links to them by construction. `reeling` is
      // named here too even though Wild Charge's own impulse chip links to it now (its slam's
      // immediate push, not the wall-impact one) — the exemption still covers the contact pass's
      // ordinary-ram source, which no weapon card names. All three are named in EFFECT_SOURCES,
      // which is exactly what publishes them.
      const fromCopy = new Set(Object.keys(EFFECT_SOURCES).map((id) => `fx-${mode}-${id}`));
      const orphans = published.filter((id) => !linked.includes(id) && !fromCopy.has(id));
      assert.deepEqual(
        orphans,
        [],
        `mode ${mode} describes effects no weapon links to: ${orphans.join(", ")}`,
      );
    }
  });

  /**
   * A tab must not publish an effect its own mode cannot inflict.
   *
   * `phased` is the one case, and it was live until 2026-09-23: `respawnSweep` is the only thing
   * that applies it and is gated `winRuleOf(mode) === "deathmatch"`, so Brawl cannot put anyone in
   * it — yet Brawl's tab published `fx-0-phased` reading "The moment after you respawn in
   * Deathmatch". `EFFECT_SOURCES` is an authored list with no mode in it; the generator gates that
   * one line now, and this is what holds the gate.
   *
   * Asserted BOTH ways deliberately. "Brawl does not publish it" alone would pass just as well if
   * the generator dropped `phased` from every tab, which would be the opposite mistake — a status
   * a real mode does inflict, described nowhere.
   */
  it("publishes `phased` in the deathmatch tabs and nowhere else", () => {
    const sections = modeSections(read(path.join(PUBLIC_DIR, manualPath())));
    for (const mode of activeGameModes()) {
      const section = sections.get(mode);
      const publishes = section.includes(`id="fx-${mode}-phased"`);
      assert.equal(
        publishes,
        winRuleOf(mode) === "deathmatch",
        winRuleOf(mode) === "deathmatch"
          ? `mode ${mode} respawns cars but does not publish the spawn-protection effect`
          : `mode ${mode} publishes "phased", which nothing in a ${winRuleOf(mode)} match applies`,
      );
    }
  });

  /**
   * MC41. Every balance table belongs to a mode, so a page with one Cars list and one Effects list
   * could only ever publish one mode's numbers and call them the game's — a Deathmatch-only
   * rebalance changed nothing here and failed nothing. One tab per active mode is the fix, and this
   * is what fails if a mode is added to the registry and the page is not rebuilt around it.
   */
  it("publishes a Cars and an Effects section for every active mode", () => {
    const html = read(path.join(PUBLIC_DIR, manualPath()));
    for (const mode of activeGameModes()) {
      assert.match(html, new RegExp(`id="mode-${mode}"`), `no section for mode ${mode}`);
      assert.match(html, new RegExp(`id="cars-${mode}"`), `mode ${mode} publishes no Cars section`);
      assert.match(html, new RegExp(`id="effects-${mode}"`), `mode ${mode} publishes no Effects section`);
    }
  });

  /**
   * A reader looking at two tabs has to be told which one they are on, and the label has to be the
   * mode's real name rather than copy invented here — `MODE_TABLE`'s `name` is the same string the
   * lobby card carries, so a rename reaches both or neither.
   */
  it("labels every tab with that mode's registry name", () => {
    const html = read(path.join(PUBLIC_DIR, manualPath()));
    for (const mode of activeGameModes()) {
      const name = MODE_TABLE[mode].name;
      assert.match(html, new RegExp(`data-mode="mode-${mode}">${name}</button>`), `no tab named ${name}`);
      assert.match(html, new RegExp(`<h2 class="modename">${name}</h2>`), `mode ${mode} is unlabelled`);
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

describe("the basic-attack toggle (slots().basicAttackEnabled)", () => {
  // Each case below builds a MODEL with the position it is about (`modelWithBasicAttack`), rather
  // than mutating a raw global — GM9 (Task 4) deleted `BASIC_ATTACK_CONFIG`, so there is nothing
  // left to set or restore.

  it("prints a Basic attack card for a chassis when the toggle is enabled", () => {
    assert.match(carSection("bastion", modelWithBasicAttack(true)), /Basic attack/);
  });

  it("omits the Basic attack card when the toggle is disabled", () => {
    assert.doesNotMatch(carSection("bastion", modelWithBasicAttack(false)), /Basic attack/);
  });

  it("moves balanceStamp when the toggle changes, so a stale build fails loudly", () => {
    const enabledConfig = applyOverrides(modeConfigOf(DEFAULT_GAME_MODE), { "slots.basicAttackEnabled": true });
    const disabledConfig = applyOverrides(modeConfigOf(DEFAULT_GAME_MODE), { "slots.basicAttackEnabled": false });
    assert.notEqual(stampOfModes([enabledConfig]), stampOfModes([disabledConfig]));
  });
});

/**
 * MC41. `balanceStamp` used to hash the raw `config/` tables — the ones the game stopped reading
 * when every table became per-mode. A page built from one mode's bundle and fingerprinted from a
 * global the sim ignores is a guard that cannot see the change it exists to catch.
 *
 * `stampOfModes` is the pure inner function precisely so these cases can be written: proving a
 * non-default mode reaches the hash by editing `MODE_TABLE` would leave a live registry mutated for
 * every later test in the process, while `applyOverrides` builds a tuned SIBLING bundle and installs
 * nothing.
 */
describe("balanceStamp covers every active mode (MC41)", () => {
  it("is stable across two calls with nothing changed", () => {
    assert.equal(balanceStamp(), balanceStamp());
  });

  it("moves when a NON-default active mode's tables move", () => {
    // A stamp computed over ONE mode would let a Deathmatch rebalance ship a page whose Deathmatch
    // tab still shows last week's numbers, with nothing failing.
    const shipped = balanceStamp();
    const tweaked = applyOverrides(modeConfigOf(GameMode.FFA_DEATHMATCH), {
      "weapon.predator.damage": 999,
    });
    assert.notEqual(
      stampOfModes([modeConfigOf(GameMode.FFA_LAST_STANDING), tweaked]),
      shipped,
      "a Deathmatch-only balance edit does not move the guide's staleness stamp",
    );
  });

  it("moves when the default mode's tables move", () => {
    // The other half of the pair: the stamp must not have quietly become "Deathmatch only" either.
    const shipped = balanceStamp();
    const tweaked = applyOverrides(modeConfigOf(GameMode.FFA_LAST_STANDING), {
      "weapon.predator.damage": 999,
    });
    assert.notEqual(stampOfModes([tweaked, modeConfigOf(GameMode.FFA_DEATHMATCH)]), shipped);
  });

  /**
   * Not in the brief, and the case the other three cannot see: publishing a mode, or retiring one,
   * changes the page — a whole tab appears or disappears — while every number inside every surviving
   * mode stays exactly where it was.
   *
   * The second assertion is the sharp one. Brawl and Deathmatch carry byte-identical tables today
   * (`modes/table-pinning.test.ts` enforces it), so a stamp that hashed only the tables would give
   * the two single-mode sets the SAME fingerprint — swapping which mode ships would move nothing.
   * It is the mode's own id and its `MODE_TABLE` name, both printed on the page, that separate them.
   */
  it("moves when an active mode is added to or removed from the set", () => {
    const brawl = modeConfigOf(GameMode.FFA_LAST_STANDING);
    const deathmatch = modeConfigOf(GameMode.FFA_DEATHMATCH);
    assert.notEqual(
      stampOfModes([brawl]),
      stampOfModes([brawl, deathmatch]),
      "publishing a second mode does not move the guide's staleness stamp",
    );
    assert.notEqual(
      stampOfModes([brawl]),
      stampOfModes([deathmatch]),
      "two modes with identical tables hash the same — the mode's own identity is not in the stamp",
    );
  });

  it("is the stamp the shipped page carries", () => {
    // Ties the split to the guard it serves: `balanceStamp()` is `stampOfModes` over exactly the
    // active set, so refactoring one of the two apart from the other fails here rather than in a
    // rebuild nobody runs.
    assert.equal(balanceStamp(), stampOfModes(activeGameModes().map(modeConfigOf)));
  });
});

/**
 * TR47. A weapon that fires from the turret prints an "Aim" point; one with a fixed muzzle prints
 * nothing new, because a point that does not apply is left out, never printed as a dash. Read off
 * the rendered chassis sections rather than the builder's internals, so a card that loses the row
 * (or a fixed-muzzle card that grows one) fails here by weapon name.
 */
describe("the turret Aim point (TR47)", () => {
  it("prints Aim on every turret card and on no fixed-muzzle card", () => {
    // Basic attack ON, so the basic-attack cards — nine of the turret rows — are on the page to be
    // checked (GM9, Task 4: built as a model rather than by flipping the deleted raw global).
    const model = modelWithBasicAttack(true);
    let turretCards = 0;
    let fixedCards = 0;
    for (const carId of activeCarIds()) {
      // Resolved per chassis: the nine basic-attack rows share one display name.
      const own = [CAR_TABLE[carId].basicAttack, ...CAR_TABLE[carId].weapons];
      const byName = new Map(own.map((id) => [WEAPON_TABLE[id].name, id]));
      const cards = carSection(carId, model).split('<article class="weapon"').slice(1);
      for (const card of cards) {
        const name = /<h4>([^<]+)<\/h4>/.exec(card)?.[1];
        const id = byName.get(name);
        assert.ok(id, `${carId}: a weapon card names "${name}", which no WEAPON_TABLE row is called`);
        const printsAim = /<dt>Aim<\/dt>/.test(card);
        if (WEAPON_TABLE[id].turret) {
          turretCards++;
          assert.ok(printsAim, `${id} fires from the turret but its card prints no Aim point`);
          assert.match(card, new RegExp(`${TURRET_CONFIG.turnRateDegPerSec}°/s`));
        } else {
          fixedCards++;
          assert.ok(!printsAim, `${id} has a fixed muzzle but its card prints an Aim point`);
        }
      }
    }
    assert.ok(turretCards > 0 && fixedCards > 0, "the check saw only one kind of card");
  });

  it("folds the printed turn rate into the stamp", () => {
    // Structural, like VS30's check above: the key is the stamp's own input line, so a mention of
    // the knob elsewhere in the builder (the Aim row itself) cannot satisfy it.
    // Per mode since MC41, for the same reason as `abilitySlots` above.
    assert.match(read(BUILDER), /turretTurnRateDegPerSec: config\.turret\.turnRateDegPerSec/);
  });
});
