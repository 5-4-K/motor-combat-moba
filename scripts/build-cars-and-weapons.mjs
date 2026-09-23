#!/usr/bin/env node
/**
 * Builds `packages/client/public/manual.html` — the player-facing cars-and-weapons guide that the
 * join screen's button opens.
 *
 * **It is a stat sheet, not a magazine.** The 2026-09-17 restructure cut it from thirteen A4-style
 * sheets (cover, legend, a page per chassis, a page per weapon, two comparison tables) to one
 * continuous page with two sections: CARS — each chassis's ratings and the stats of its three
 * weapons — and EFFECTS — what every status a player can be put in actually does. A weapon's
 * effects link into that second section, so "what is Corroded?" is one click rather than a search.
 * Prose is one line per chassis and one per weapon; everything else on the page is generated.
 *
 * **Those two sections are published once per ACTIVE MODE (MC41), behind a tab strip.** Every
 * balance table in this game belongs to a `GameMode` now, so a single page could only ever publish
 * one mode's numbers and call them the game's. Each tab is one `modelOf` bundle, and every id it
 * defines — `mode-N`, `car-N-<carId>`, `fx-N-<statusId>` — carries the mode, so a weapon's effect
 * chips can only resolve inside their own mode's Effects list. The two shipped modes carry
 * byte-identical tables today, so the tabs render the same content; the structure is what makes a
 * future divergence visible instead of silent.
 *
 * It is a web page rather than a document players download: an <embed>ed file is at the mercy of
 * whatever viewer they have, and on mobile is usually just a download prompt. It still prints — the
 * topbar's Print button hands the browser the page — but it is no longer laid out as A4 sheets, so
 * page breaks fall where the browser puts them rather than where a fixed-height section ends.
 *
 * Every number on it is read from BUILT shared — each mode's own `weapons()`, `cars()`,
 * `weaponTicksOf` and `weaponDamageOf`, inside that mode's `withMode` scope, never the raw `config/`
 * globals the game itself stopped reading — so a balance edit is reprinted by re-running this script
 * and cannot drift from the sim. The prose lives in `cars-and-weapons-copy.mjs`.
 *
 *   npm run build -w @motor-combat-moba/shared   # this reads dist, not src
 *   node scripts/build-cars-and-weapons.mjs
 *
 * The page is generated but committed, so `balanceStamp` below is what stops it going stale unseen.
 * Display fonts are fetched once and inlined as base64; with no network the page falls back to the
 * system stack and still builds. Art is LINKED from `public/art/`, which the client already serves,
 * so an icon swap needs no rebuild here.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASIC_ATTACK_CONFIG,
  DEFAULT_GAME_MODE,
  MODE_TABLE,
  TICK_RATE_HZ,
  activeCarIds,
  activeGameModes,
  basicAttackOf,
  cars,
  combat,
  damageFor,
  dragRateOf,
  engineAccelOf,
  forwardMaxSpeedOf,
  getArena,
  hpOf,
  modeConfigOf,
  playableExtentOf,
  slotsOf,
  statusDefOf,
  statusTable,
  turnRateOf,
  turret,
  weaponDamageOf,
  weaponTicksOf,
  weapons,
  winRuleOf,
  withMode,
} from "@motor-combat-moba/shared";

import {
  CHASSIS_COPY as RAW_CHASSIS_COPY,
  EFFECT_SOURCES as RAW_EFFECT_SOURCES,
  MANUAL_META as RAW_MANUAL_META,
  WEAPON_COPY as RAW_WEAPON_COPY,
} from "./cars-and-weapons-copy.mjs";
import { manualFacts, renderCopy } from "./manual-facts.mjs";

// ---------------------------------------------------------------------------- mode scope (MC12, MC41)
//
// There is no longer ONE mode to install here. The page publishes a tab per ACTIVE mode, so every
// number below belongs to a particular bundle, and the boundary moved from this line down into
// `modelOf` — which wraps a `withMode` around everything one mode's section is derived from.
//
// Nothing in this file calls `installMode` any more. That writes the module-level current bundle for
// the whole PROCESS, which is exactly what a script building two modes' sections in one run must not
// do: having installed one, it could never leave that scope to enter the other's. `withMode`
// restores whatever was installed before it, so the scopes nest and unwind cleanly (MC10, MC11).

/**
 * The prose with its `{roster.fact}` placeholders resolved against the live tables.
 *
 * Done ONCE, here, so every consumer below sees finished sentences and no call site has to remember
 * to render. An unknown token throws out of `renderCopy`, so a typo fails the build rather than
 * shipping a literal "{roster.slotsPerCar}" to players.
 */
const FACTS = manualFacts();
const MANUAL_META = renderCopy(RAW_MANUAL_META, FACTS);
const CHASSIS_COPY = renderCopy(RAW_CHASSIS_COPY, FACTS);
const WEAPON_COPY = renderCopy(RAW_WEAPON_COPY, FACTS);
const EFFECT_SOURCES = renderCopy(RAW_EFFECT_SOURCES, FACTS);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Served by the client. Vite copies `public/` verbatim, so this ships in the LAN zip too. */
export const OUT_WEB_HTML = resolve(ROOT, "packages/client/public/manual.html");

/**
 * The arena ONE MODE plays, for "how far is 900 units really" context — every weapon's reach is
 * reported as a PERCENTAGE of this.
 *
 * **Per mode as of 2026-09-23.** It read the global `ACTIVE_ARENA_ID`, which is nobody's mode: both
 * tabs quoted reach against one arena neither mode necessarily picks first, and the wrong number
 * was then frozen into `balanceStamp` — a literal that can only ever fingerprint itself. A mode's
 * `arenas[0]` is the arena it actually plays (the rest of its list is what it MAY play), which is
 * the same rule `resolveSetMode` and the balance harness's `--arena` default both follow.
 *
 * The PLAYABLE extent, not `arena.width`. Those were the same number until `arena-01` became an
 * octagon inset inside its own image frame, and this read the frame — understating every reach
 * percentage by about 13%. `playableExtentOf` answers the polygon's bounding box when an arena
 * authors a `boundary`. Note that neither the page nor the stamp can catch this class of error on
 * its own: the regenerated page came out byte-identical, because the fingerprint hashes this value
 * and the value was wrong.
 */
function arenaWidthOf(config) {
  return playableExtentOf(getArena(config.arenas[0])).width;
}

// ---------------------------------------------------------------------------- derived stats

// (The chassis a mode publishes, the weapons they carry and the effects those weapons apply are all
// per mode now — see `modelOf` below, which resolves each of them inside that mode's own scope.)

const round = (n, dp = 0) => Number(n.toFixed(dp));
/** Seconds, printed the way the page talks: `1.8s`, `0.7s`, `13s`. */
const secs = (ms) => `${round(ms / 1000, ms % 1000 === 0 ? 0 : 2)}s`;

/**
 * A one-line reading of what a status does, derived from the row itself rather than written out
 * beside it — so retuning a status updates the guide, and adding one needs no copy at all.
 *
 * Ordered worst-first: a player scanning this wants the thing that will kill them, not the thing
 * that will slow them.
 */
function statusBlurb(def) {
  const parts = [];
  // `fullStop` (stunned) and `invulnerable` (armored) used to be the two flags a flag-only row
  // could carry with nothing else in `modifiers` — before this, either row printed no effect line
  // at all: an empty `parts` array joins to "". The 2026-09-18 Unity ram port makes that false:
  // `reeling` and `ramLock` are both flag-carrying rows too, and they are the reason this vocabulary
  // had to grow. Worst-first, so the total stop (the roster's only hard CC) leads even over
  // "no control".
  if ((def.flags ?? []).includes("fullStop")) parts.push("total stop");
  if ((def.flags ?? []).includes("immobilised")) parts.push("no control");
  if ((def.flags ?? []).includes("steeringLocked")) parts.push("no steering");
  // `spinFree` is what makes a ram read as a spin-out rather than a shove. `grip` deliberately has
  // NO special case beside it: ruling P10 ("no grip" vs "low grip") was adjudicated without noticing
  // that the generic modifiers loop below already rendered `reeling`'s 0.6 as `traction −40%`,
  // which is both more precise and the only form that survives a future `grip > 1` buff — a `< 1`
  // test prints nothing at all for one, which is exactly the empty-`parts` failure this function's
  // own comment warns about. P10 is reversed; the channel word does the work.
  if ((def.flags ?? []).includes("spinFree")) parts.push("spins freely");
  if ((def.flags ?? []).includes("disarmed")) parts.push("cannot fire");
  // `ramBlocked` is the whole anti-chain rule — a reeling or ram-locked car cannot ram back. Placed
  // after `disarmed`, not with the other two above: being unable to fire reads as worse than being
  // unable to ram.
  if ((def.flags ?? []).includes("ramBlocked")) parts.push("cannot ram");
  if ((def.flags ?? []).includes("invulnerable")) parts.push("takes no damage");
  if ((def.flags ?? []).includes("phased")) parts.push("cannot be hit or rammed");
  if (def.pulse?.damage) parts.push(`${def.pulse.damage} hp per ${secs(def.pulse.intervalMs)}`);
  if (def.pulse?.heal) parts.push(`repairs ${def.pulse.heal} hp per ${secs(def.pulse.intervalMs)}`);
  if (def.onApply?.cleanse) parts.push(`clears every ${def.onApply.cleanse}`);
  for (const [channel, value] of Object.entries(def.modifiers)) {
    const pct = Math.round(Math.abs(value - 1) * 100);
    parts.push(`${CHANNEL_WORDS[channel] ?? channel} ${value > 1 ? "+" : "−"}${pct}%`);
  }
  return parts.join(" · ");
}

/** Player-facing names for the modifier channels. The code's names are not the player's. */
const CHANNEL_WORDS = {
  topSpeed: "top speed",
  accel: "acceleration",
  turnRate: "steering",
  brakeDecel: "brakes",
  // How fast sideways motion scrubs off. A player feels it as how far a hit carries them, which is
  // why "traction" and not the sim's "grip" — and without a row here the page printed the channel
  // id straight out of the table.
  grip: "traction",
  damageDealt: "damage out",
  damageTaken: "damage taken",
  weaponCooldown: "recharge",
  ramDefence: "ram resistance",
};

/**
 * The noun the page calls one projectile of each hitbox shape.
 *
 * Display vocabulary, like `CHANNEL_WORDS` above — `radiusAlong`/`radiusAcross` is how the sim
 * thinks about a shot and "slug" is how a player does. A shape with no entry falls back to "shot"
 * rather than printing `undefined`, so a new hitbox kind degrades to a correct generic instead of
 * failing the page.
 */
const PROJECTILE_NOUN = { circle: "bolt", ellipse: "dart", capsule: "slug", bar: "bar" };

/** Printed above a card. A basic attack gets its own label instead of a kit slot's (see `derive`). */
const SLOT_LABEL = ["Slot 1", "Slot 2", "Slot 3"];

/** `{ shape, size }` — `size` kept short enough to sit inline in a stat row. */
function hitboxSize(def) {
  const h = def.hitbox;
  if (h.shape === "circle") return `${h.radius * 2} across`;
  if (h.shape === "ellipse") return `${h.radiusAlong * 2} × ${h.radiusAcross * 2}`;
  if (h.shape === "capsule") return `${h.radiusAlong * 2} × ${h.radiusAcross * 2}, flat tail`;
  // A bar travels along its SHORT axis (`radiusAlong` is the thickness along flight), so its face
  // width leads — the same way every other shape leads with its longest dimension.
  if (h.shape === "bar") return `${h.radiusAcross * 2} wide, ${h.radiusAlong * 2} thick`;
  return "";
}

/**
 * One weapon's printed figures, resolved inside `model`'s mode scope.
 *
 * Takes the model rather than reading a module-level table: every number here is that MODE's own, and
 * two modes' copies of the same weapon row may differ without anything else in this file noticing.
 */
function derive(model, id) {
  const def = weapons()[id];
  const ticks = weaponTicksOf(id);
  const carId = model.ownerOf[id];
  const car = cars()[carId];
  const slot = slotsOf(carId).indexOf(id);
  // `-1` means this is the chassis's basic attack, not a kit slot (BA27): indexing `SLOT_LABEL` by
  // a fire-slot index would print `undefined`.
  const slotLabel = slot < 0 ? "Basic attack" : SLOT_LABEL[slot];
  const beam = def.kind === "beam";
  // A maneuver has neither `hitbox` nor `pellets` — the car's own hull is the hit volume and one
  // press lands exactly one hit (the contact, priced in `runCombat` like any other) — so it takes
  // its own branch everywhere the projectile-only fields (`pellets`, `pierce`, `hitbox`) would
  // otherwise be read off a row that does not carry them.
  const maneuver = def.kind === "maneuver";

  // `volley` lives on `WeaponBase`, so a BEAM can be a wave sequence too — dormant today (no
  // shipped row has `volleys > 1`). This file is plain `.mjs` and the compiler never checks it, so
  // a "beams fire once per press" shortcut here would silently under-report a real weapon on the
  // page the day one next ships.
  const shotsPerPress = beam
    ? def.volley.volleys
    : maneuver
      ? 1
      : def.volley.volleys * def.pellets.pelletsPerVolley;
  const burstSpanMs = (def.volley.volleys - 1) * def.volley.volleyIntervalMs;
  // `wildcharge` (a charge) is the one row with `speed: 0` and `range: 0` — a plain division would
  // be 0/0, NaN. `thunderclap` (a dash) has both, and crosses its 400-unit `range` at its `speed`
  // exactly like a projectile would.
  const extendMs = def.speed > 0 ? (def.range / def.speed) * 1000 : 0;
  const totalLifeMs = beam ? extendMs + def.lifetimeMs : (def.lifetimeMs ?? 0);
  // A ticking beam re-arms on its own interval for as long as it lives; everything else lands once
  // per instance, so a projectile's ceiling on one car is its whole pellet count.
  //
  // Counted in TICKS and INCLUSIVE of the opening one, because that is what the sim does:
  // `resolveInstanceHits` damages on the first tick the beam covers a car and only then arms the
  // clock for `damageInterval` ticks later, over the `flight + lifetime` ticks `instanceExpired`
  // keeps the instance alive. Dividing the millisecond life by the interval instead loses that
  // opening hit whenever the life is not a whole multiple of the interval — which cost the retired
  // Bulwark a ninth tick (35 damage) until 2026-08-30.
  const aliveTicks = ticks.flight + ticks.lifetime;
  const damageTicks =
    ticks.damageInterval === Number.POSITIVE_INFINITY
      ? 1
      : Math.floor((aliveTicks - 1) / ticks.damageInterval) + 1;
  // Each of a beam's volleys is its own instance with its own damage clock, so a target that eats
  // every wave takes `damageTicks` from each — dormant today alongside `volleys > 1` itself.
  //
  // For a PROJECTILE this is the pellets of one fan, not every pellet the press emits: the muzzles
  // of a four-way spray point 90° apart, so at most one fan can ever line up with a single car.
  // `shotType` below prints both figures, which is exactly the distinction that needs making.
  const hitsPerTarget = beam ? damageTicks * def.volley.volleys : shotsPerPress;

  const perHit = weaponDamageOf(carId, id);

  return {
    id,
    def,
    ticks,
    carId,
    car,
    slot,
    slotLabel,
    beam,
    maneuver,
    waves: def.volley.volleys,
    burstSpanMs,
    extendMs,
    totalLifeMs,
    hitsPerTarget,
    perHit,
    liveBurst: perHit * hitsPerTarget,
  };
}

/**
 * Everything ONE mode's half of the page is derived from, resolved inside that mode's own scope.
 *
 * The chassis it publishes are the ACTIVE ones only. This is the guide's half of `CarDef.isActive`
 * (PG18): the flag hides an unreleased chassis from car select and from every server-side gate, but
 * this script used to read the table whole — so authoring a car in development shipped its stats, its
 * kit and its silhouette to players on the next `npm run build:manual`, with nothing saying so.
 * Every derivation here follows that list: `ownerOf`, `weapons` (which is `carIds.flatMap(slotsOf)`,
 * so an inactive car's exclusive weapons drop off the page with it), the car sections, and the
 * sources the Effects section credits each status to.
 *
 * `isActive` is itself per mode — `cars` is one of the thirteen tables a mode folder authors — so a
 * chassis published in one mode and held back in another is a shape this already handles.
 */
function modelOf(config) {
  return withMode(config, () => {
    const carIds = activeCarIds();
    const model = {
      config,
      /** The `GameMode` wire value. Every id this mode's section publishes is prefixed with it. */
      mode: config.id,
      /** The tab's label, from `MODE_TABLE` — the same string the lobby card carries (MC41). */
      name: MODE_TABLE[config.id].name,
      carIds,
      /** This mode's own `arenas[0]`, the denominator every Range row's percentage is taken over. */
      arenaWidth: arenaWidthOf(config),
      /**
       * The authored `EFFECT_SOURCES` lines that apply IN THIS MODE (2026-09-23).
       *
       * `phased` is the one mode-shaped entry: `respawnSweep` is the only thing that applies it and
       * it is gated `winRuleOf(mode) === "deathmatch"`, so Brawl cannot inflict it — yet Brawl's
       * Effects tab published `fx-0-phased` reading "The moment after you respawn in Deathmatch",
       * a status describing a game that tab's reader is not playing. `reeling` and `ramLock` come
       * from the contact pass, which every mode runs, so they are unconditional.
       */
      effectSourceLines: Object.fromEntries(
        Object.entries(EFFECT_SOURCES).filter(
          ([statusId]) => statusId !== "phased" || winRuleOf(config.id) === "deathmatch",
        ),
      ),
      ownerOf: Object.fromEntries(
        carIds.flatMap((carId) =>
          [...slotsOf(carId), basicAttackOf(carId)].map((weaponId) => [weaponId, carId]),
        ),
      ),
    };
    model.weapons = carIds
      .flatMap((carId) => [...slotsOf(carId), basicAttackOf(carId)])
      .map((id) => derive(model, id));
    model.byId = Object.fromEntries(model.weapons.map((w) => [w.id, w]));
    model.effectSourceMap = effectSources(model);
    model.publishedEffects = publishedEffectsOf(model);
    return model;
  });
}

/** One model per ACTIVE mode, in `activeGameModes()` order — the order the tab strip publishes. */
const MODELS = activeGameModes().map((mode) => modelOf(modeConfigOf(mode)));

/**
 * The mode the module-level exports answer for.
 *
 * `carrierOf` and `hitsPerTargetOf` exist for `manual-page.test.mjs`, which drives the real sim to
 * check one number against the page; the sim it drives is whichever bundle that test installed, so
 * these answer for the DEFAULT mode and the test scopes itself to match. Everything the page itself
 * prints goes through `MODELS`, never through this.
 */
const DEFAULT_MODEL = MODELS.find((m) => m.mode === DEFAULT_GAME_MODE) ?? MODELS[0];
if (DEFAULT_MODEL === undefined) {
  throw new Error("no active game mode: the guide has nothing to publish");
}

/**
 * How many times one press can damage a SINGLE car — the "if all N land" ceiling the guide prints,
 * for the DEFAULT mode.
 *
 * Exported purely as a seam for `manual-page.test.mjs`, which checks it by driving the real sim
 * instead of repeating the arithmetic above. Nothing in the page build calls this.
 */
export function hitsPerTargetOf(weaponId) {
  return DEFAULT_MODEL.byId[weaponId].hitsPerTarget;
}

/** The chassis that carries each weapon. The test needs it to spawn a shot the way a match does. */
export function carrierOf(weaponId) {
  return DEFAULT_MODEL.ownerOf[weaponId];
}

/**
 * A fingerprint of everything the guide reports, written into the page as a meta tag.
 *
 * The page is generated but committed, so nothing forces a rebuild when the tables move — a weapon
 * retune lands, the suites pass, and players quietly read last week's numbers. `manual-page.test.mjs`
 * recomputes this and compares it against the committed page, which turns that silent staleness into
 * a failing test naming the command to run.
 *
 * Covers the prose as well as the numbers: editing `cars-and-weapons-copy.mjs` without rebuilding
 * goes just as stale. Deliberately NOT a hash of the rendered HTML — that would need the webfont
 * fetch and a browser, and a guard that only runs online is not a guard.
 *
 * **Every input here must be something the page actually prints.** `AIM_CONFIG.lockRange` was hashed
 * until the 2026-09-17 restructure, which stopped printing it, and the config itself was deleted
 * outright when the target-lock feature was removed later that day. The lesson survives the
 * constant: hashing something the page does not print demands a rebuild that produces a
 * byte-identical page but for this tag, which is how a guard gets rubber-stamped.
 *
 * **The inverse hole is real, and nothing closes it: the page prints things no input covers.**
 * Every input here is DATA. The generator's own SELECTION RULES — which of that data reaches the
 * page — are code, and code is not hashable. The worked example, found by review on 2026-09-23:
 * removing the `winRuleOf(config.id) === "deathmatch"` gate on `EFFECT_SOURCES.phased` in `modelOf`
 * — the fix that stopped Brawl's tab publishing a status Brawl cannot inflict — leaves the stamp at
 * `0c7adc2746195fca`, unmoved, because the raw `EFFECT_SOURCES` object it hashes is unchanged and
 * the gate never was an input. The same blindness covers every rule the generator OWNS rather than
 * reads: which statuses `publishedEffectsOf` admits, `statRows`'s "leave a row out when it does not
 * apply", the Basic attack card's branch shape, effect-anchor construction.
 *
 * What that costs, concretely, because it is a delayed fault rather than a silent one:
 * `manual-page.test.mjs` guards the COMMITTED PAGE against this stamp, not the generator against
 * the page. Change a selection rule without running `npm run build:manual` and `npm test` stays
 * green — the committed page still has the old rule's output baked in, and the stamp still agrees
 * with it. Weeks later an unrelated weapon retune moves the stamp, forces a rebuild, and the
 * rebuild republishes `phased` to Brawl: a reddened test on a commit that never touched effects,
 * pointing at the wrong change. **So a generator change owes a `npm run build:manual` that nothing
 * will demand of you.** Run it whenever you edit what this file CHOOSES to print, not only when you
 * edit what it prints FROM.
 *
 * **Per mode as of MC41.** It used to hash the raw `config/` globals, which the game stopped reading
 * when every table became per-mode: a Deathmatch-only rebalance moved nothing here and failed
 * nothing, while the Deathmatch tab shipped last week's numbers. It hashes every ACTIVE mode's
 * bundle instead — one entry per tab, in tab order.
 */
export function stampOfModes(configs) {
  const inputs = {
    // ---- GLOBAL inputs. Not per mode, and the page prints each of them exactly once.
    //
    // Whether the Basic attack card prints at all — the toggle changes what the page says without
    // touching any table the per-mode keys below already hash.
    basicAttackEnabled: BASIC_ATTACK_CONFIG.enabled,
    tickRateHz: TICK_RATE_HZ,
    // The RENDERED copy, not the raw templates: the stamp should fingerprint what the page says.
    copy: { MANUAL_META, CHASSIS_COPY, WEAPON_COPY, EFFECT_SOURCES },
    // ---- One entry per tab.
    //
    // **No `withMode` here (2026-09-23).** Every value below is read off the `ModeConfig` OBJECT,
    // so none of it needs — or can be affected by — whichever bundle happens to be installed. The
    // one exception was `activeCarIds()`, an accessor, and it is spelled as a filter over
    // `config.cars` instead: a scope entered to serve a single accessor call is a scope whose
    // absence nothing would notice, which is exactly the kind that rots into a lie about what this
    // function reads.
    modes: configs.map((config) => ({
      // The section id (`mode-N`) and the tab's label, both printed. They are also what makes
      // ADDING or REMOVING an active mode move the stamp: the two shipped modes carry
      // byte-identical tables today (`modes/table-pinning.test.ts` enforces it), so without these
      // two keys a set of one would hash the same as either mode alone.
      id: config.id,
      name: MODE_TABLE[config.id]?.name ?? "",
      weapons: config.weapons,
      // ACTIVE cars only, matching this mode's own `carIds` — the stamp fingerprints what the page
      // SAYS, and the page says nothing about an inactive chassis. Hashing the car table whole
      // would fail `npm test` on every ratings tweak to an unreleased car. Flipping `isActive` to
      // true still moves the stamp, correctly: that edit really does owe players a rebuild.
      cars: Object.fromEntries(Object.entries(config.cars).filter(([, def]) => def.isActive)),
      combat: config.combat,
      statuses: config.statusTable,
      drive: config.drive,
      // The arena THIS mode plays, whose playable width every Range row's percentage is taken over
      // (2026-09-23). Per mode, because `arenas` is: a global value here fingerprinted itself.
      arenaWidth: arenaWidthOf(config),
      // How many ability slots this mode has. N changes how many weapons each chassis lists, which
      // is something the page SAYS, so it belongs in the fingerprint (VS30).
      abilitySlots: config.slots.maxAbilitySlots,
      // The turret's turn rate, which every turret weapon's Aim point prints (TR47). Only the
      // rate: `defaultOffset` places the shot but the page never states it, so hashing it would
      // demand a rebuild that changes nothing but this tag.
      turretTurnRateDegPerSec: config.turret.turnRateDegPerSec,
    })),
  };
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 16);
}

/**
 * The shipped page's stamp: every ACTIVE mode, in the order the tab strip publishes them.
 *
 * Split from `stampOfModes` so the guard can be TESTED. A test that has to mutate `MODE_TABLE` to
 * prove a non-default mode reaches the hash is a test that leaves a live registry edited behind it;
 * passing a bundle built with `applyOverrides` proves the same thing and installs nothing.
 */
export function balanceStamp() {
  return stampOfModes(activeGameModes().map(modeConfigOf));
}

/** Where the stamp lives in the page, and how the test finds it again. */
export const STAMP_META_NAME = "mc-balance-stamp";

// ---------------------------------------------------------------------------- assets

/**
 * The page links the art the client already serves rather than inlining it: the browser reuses the
 * icons it drew in the HUD, and the page stays a tenth of the size it would otherwise be. Paths are
 * relative, so the guide resolves wherever the client is mounted.
 */
const iconUrl = (id) => `art/weapon-icons/${id}.png`;
const carUrl = (id) => `art/cars/${id}.png`;
/**
 * The manifest is one convention; the file actually being on disk is the one this page can check for
 * itself. A weapon id with no icon yet (the HUD's permanent procedural-glyph fallback, per
 * `docs/asset-pipeline.md`) would otherwise become an `<img>` with a dead `src` — `manual-page.test.mjs`
 * asserts every image the page links actually exists in `packages/client/public/`, so this is what
 * keeps a new, still-unarted weapon id from failing that guard the moment it ships.
 */
const hasWeaponIcon = (id) => existsSync(resolve(ROOT, "packages/client/public", iconUrl(id)));
/**
 * An icon `<img>`, or a flat colour swatch in its place for a weapon with no art yet — the guide's
 * own version of the HUD's procedural fallback. The swatch carries `.icon-fallback`, which `css()`
 * sizes identically to the real `<img>`, so it fills exactly the same box without a second set of
 * dimensions to keep in sync.
 */
function iconMarkup(w) {
  if (hasWeaponIcon(w.id)) return `<img src="${iconUrl(w.id)}" alt="">`;
  return `<div class="icon-fallback" style="background:${lift(w.def.color)}" aria-hidden="true"></div>`;
}

/** Weapon colours are authored to read on the arena's light floor; lift them for a dark page. */
function lift(hex, amount = 0.42) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
}

async function fontCss() {
  const families = "family=Oswald:wght@500;700&family=Barlow:wght@400;500;600;700";
  try {
    const res = await fetch(`https://fonts.googleapis.com/css2?${families}&display=swap`, {
      headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`css ${res.status}`);
    // Google serves one @font-face per weight PER SUBSET (latin, latin-ext, cyrillic, vietnamese).
    // Every one of them gets base64'd into the document, and the manual is English, so dropping the
    // subsets nothing renders takes the inlined faces from ~420 KB to a fraction of that.
    let css = (await res.text())
      .split(/(?=\/\* [a-z-]+ \*\/)/)
      .filter((block) => !block.trimStart().startsWith("/*") || block.trimStart().startsWith("/* latin */"))
      .join("");
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]))];
    for (const url of urls) {
      const font = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!font.ok) throw new Error(`font ${font.status}`);
      const b64 = Buffer.from(await font.arrayBuffer()).toString("base64");
      css = css.split(url).join(`data:font/woff2;base64,${b64}`);
    }
    return css;
  } catch (err) {
    console.warn(`[manual] webfonts unavailable (${err.message}); falling back to system fonts`);
    return "";
  }
}

// ---------------------------------------------------------------------------- effects

/**
 * The anchor a weapon's effect chip links to, and the id that mode's Effects section publishes.
 *
 * One function so the two can never disagree — a chip pointing at an id nothing renders is a dead
 * link that no compiler and no existing guard would catch, which is why `manual-page.test.mjs`
 * resolves every one of them.
 *
 * **Prefixed with the mode.** Each tab carries its own Effects section, so an unprefixed `fx-…`
 * would be defined once per mode in one document — and a browser resolves a duplicate id to the
 * FIRST one. Deathmatch's chips would silently scroll to Brawl's description of the status: one
 * mode's numbers published under another mode's name, with every link still looking fine.
 */
const effectAnchor = (model, statusId) => `fx-${model.mode}-${statusId}`;

/**
 * Every status an ACTIVE chassis can inflict or grant in THIS mode, and what applies it.
 *
 * Three application paths, and a status is only as published as the paths that reach it:
 *  - `WeaponDef.applies` — the ordinary one, `self` or `opponents`.
 *  - `ExplosionDef.applies` — magmablast's blast is the only user, and it is `opponents` only.
 *  - `ImpulseDef.onWallImpact.applies` — wildcharge's hard slam stuns a car it drives into a wall. It
 *    is a duration on a push rather than an ordinary status application, so nothing else on this page
 *    would find it; before the 2026-09-17 restructure the guide never mentioned it at all. Renamed
 *    from `ImpulseDef.wallStun` (a single `{ windowMs, durationMs }`, always `"stunned"`) by the
 *    2026-09-19 restructure to a list, so this reads every entry rather than assuming one.
 *
 * Returns `Map<statusId, { weaponId, durationMs, note }[]>` in `model.weapons` order, so the Effects
 * section credits the sources a player will meet first.
 */
function effectSources(model) {
  const sources = new Map();
  const add = (statusId, entry) => {
    if (!sources.has(statusId)) sources.set(statusId, []);
    sources.get(statusId).push(entry);
  };
  for (const w of model.weapons) {
    for (const a of w.def.applies ?? []) {
      add(a.statusId, { weaponId: w.id, durationMs: a.durationMs, note: a.target === "self" ? "on yourself" : "" });
    }
    for (const a of w.def.explosion?.applies ?? []) {
      add(a.statusId, { weaponId: w.id, durationMs: a.durationMs, note: "from the blast" });
    }
    for (const a of w.def.impulse?.onWallImpact?.applies ?? []) {
      add(a.statusId, { weaponId: w.id, durationMs: a.durationMs, note: "slammed into a wall" });
    }
  }
  return sources;
}

/**
 * The statuses one mode's page publishes, in that mode's `STATUS_TABLE` order.
 *
 * A row appears only if something can actually apply it: a weapon an active chassis carries, or an
 * authored `EFFECT_SOURCES` line for the three that reach a player outside the weapon tables
 * (`reeling` and `ramLock` from the contact pass, `phased` from the deathmatch respawn) AND that
 * applies in THIS mode — `model.effectSourceLines`, which drops `phased` from a mode whose win rule
 * is not `"deathmatch"`, since nothing in such a mode can put a player in it. `armored`
 * and `overhauled` have neither today and so do not appear — publishing a status no shipped code
 * can inflict would be describing a game the player is not playing. Giving one a source is what
 * publishes it.
 *
 * Called inside `modelOf`'s scope, so `statusTable()` is THIS mode's: a mode that retires a status
 * row stops publishing it without anything here knowing the mode by name.
 */
function publishedEffectsOf(model) {
  return Object.keys(statusTable()).filter(
    (id) => model.effectSourceMap.has(id) || id in model.effectSourceLines,
  );
}

// ---------------------------------------------------------------------------- weapon stats

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * What comes out of the muzzle, in one phrase: the shape of the shot and how many of them.
 *
 * The count distinction is the reason this row exists. Pepperbox emits twelve darts and can land
 * three on any one car, because its four muzzles point 90° apart — a page printing only "45 × 3"
 * describes a weapon nobody is firing, and one printing only "12 darts" describes damage nobody
 * takes. Both numbers, side by side, is the honest answer.
 */
function shotType(w) {
  const d = w.def;
  if (w.maneuver) return d.maneuver.type === "dash" ? "Dash" : "Charge";

  const muzzles = (d.muzzles ?? [0]).length;
  const waveNote =
    w.waves > 1 ? `, ${w.waves} waves ${d.volley.volleyIntervalMs}ms apart` : "";

  if (w.beam) {
    const h = d.hitbox;
    const core =
      h.shape === "cone"
        ? `Cone, ${h.angleDeg}° arc`
        : h.shape === "rect"
          ? `Beam, ${h.width} wide`
          : `Field, ${d.range} radius`;
    return `${core}${muzzles > 1 ? ` × ${muzzles} muzzles` : ""}${waveNote}`;
  }

  const noun = PROJECTILE_NOUN[d.hitbox.shape] ?? "shot";
  const perFan = d.pellets.pelletsPerVolley;
  if (perFan === 1 && muzzles === 1) return `Single ${noun}, ${hitboxSize(d)}${waveNote}`;

  const fan =
    perFan > 1 ? `${perFan}-${noun} fan, ${d.pellets.spreadAngleDeg}° spread` : `one ${noun}`;
  const emitted = muzzles * perFan * w.waves;
  return (
    `${muzzles > 1 ? `${muzzles} muzzles × ` : ""}${fan}${waveNote} — ` +
    `${emitted} out, ${w.hitsPerTarget} can hit one car`
  );
}

/**
 * The damage cell: what one hit costs, then what the whole press costs if all of it connects.
 *
 * At the CARRIER's damage, not the table's base — the page prints a weapon underneath the chassis
 * that fires it, so the number beside it should be the number that chassis deals. A blast is priced
 * through `damageFor` rather than `weaponDamageOf`, which reads the weapon row's own damage (the
 * shell's, not the burst's) and would credit magmablast's field with the shell's 50.
 */
function damageText(w) {
  const unit = w.beam ? "per tick" : w.hitsPerTarget > 1 ? "per pellet" : "";
  // "direct" only earns its place when a second damage number follows it.
  const lead = unit || (w.def.explosion ? "direct" : "");
  const parts = [lead ? `${w.perHit} ${lead}` : `${w.perHit}`];
  if (w.hitsPerTarget > 1) {
    parts.push(
      w.beam
        ? `${w.liveBurst} over ${w.hitsPerTarget} ticks`
        : `${w.liveBurst} if all ${w.hitsPerTarget} land`,
    );
  }
  if (w.def.explosion) parts.push(`${damageFor(w.car.attack, w.def.explosion.damage)} blast`);
  return parts.join(" · ");
}

/** Everything the seven required rows do not cover, as short chips. Empty means none apply. */
function propertiesOf(w) {
  const d = w.def;
  const out = [];
  if (d.homing) out.push(`Homes on anything within ${d.homing.acquireRadius} of the shot`);
  if (d.explosion) {
    out.push(
      `Explodes where it dies — ${d.explosion.radius} radius, ${secs(d.explosion.lingerMs)} field` +
        (d.explosion.damageMode === "perEntry" ? ", hits again if you re-enter" : ""),
    );
  }
  if (d.bounces) out.push("Bounces off walls");
  if (d.piercesWalls) out.push("Flies through walls");
  // `pierce` counts the cars passed through AFTER the first, so the total caught is one more.
  if (d.pierce > 0) out.push(`Pierces ${d.pierce + 1} cars`);
  if (d.stock) out.push(`${d.stock.max} banked, ${d.stock.refireDelayMs}ms apart`);
  if (d.holdsDuringFire) out.push("Holds you in place — steering still works");
  if (w.beam && d.attached) out.push("Rides your car and dies with you");
  if (w.beam && !d.attached) out.push("Stamped in place where it spawns");
  if (d.isUnInterruptable) out.push("A stun cannot cancel it");
  if (d.impulse) out.push(`Knocks back at ${d.impulse.speed} u/s`);
  if (w.maneuver && d.maneuver.type === "charge") {
    out.push(`Armed for ${secs(d.maneuver.durationMs)} or until it lands`);
    if (d.maneuver.slamsStunned) out.push("Slams a stunned car too");
  }
  return out;
}

/** The effect chips, each a link into THIS mode's Effects section. */
function effectChips(model, w) {
  const chips = [];
  const push = (statusId, durationMs, note) => {
    const def = statusDefOf(statusId);
    chips.push(
      `<a class="fx fx-${def.kind}" href="#${effectAnchor(model, statusId)}">${esc(def.name)} ` +
        `<b>${secs(durationMs)}</b>${note ? `<i>${esc(note)}</i>` : ""}</a>`,
    );
  };
  for (const a of w.def.applies ?? []) {
    // `onWave: "final"` is a real rule a player has to plan around, so it goes on the page rather
    // than staying a table detail. Dormant today: no shipped row authors `onWave` at all, since
    // none has `volleys > 1`.
    const wave = a.onWave === "final" && w.waves > 1 ? "last wave only" : "";
    push(a.statusId, a.durationMs, [a.target === "self" ? "on you" : "", wave].filter(Boolean).join(", "));
  }
  for (const a of w.def.explosion?.applies ?? []) push(a.statusId, a.durationMs, "from the blast");
  // `impulse.applies` lands the moment the push does — unlike `onWallImpact.applies` below, it is
  // not conditional on anything, so it gets no qualifier. Wild Charge's slam is the only row that
  // authors one today (`reeling`), and without this loop its most consequential property never
  // reached the card at all. Deliberately NOT fed into `effectSources()` above — `EFFECT_SOURCES.reeling`
  // already credits "Wild Charge's slam" in prose, and crediting it again here would double up the
  // Effects section's "From" line for the one weapon that has both.
  for (const a of w.def.impulse?.applies ?? []) push(a.statusId, a.durationMs, "");
  for (const a of w.def.impulse?.onWallImpact?.applies ?? []) {
    push(a.statusId, a.durationMs, "slammed into a wall");
  }
  return chips.join("");
}

/**
 * The stat rows for one weapon, in the order the page reads them, with every row that does not
 * apply LEFT OUT rather than printed as a dash.
 *
 * "Not applicable" is a real state here and there are seven of them: a charge has no range (speed and
 * range are both 0 — it dashes nowhere), a fixed muzzle has no Aim point, six of the nine rows have
 * no wind-up, three have no recovery, four have no lifetime clock at all, three inflict nothing, and
 * a plain shot has no extra properties. A table of dashes would be longer and say less.
 */
function statRows(model, w) {
  const d = w.def;
  const rows = [
    ["Shot type", esc(shotType(w))],
    ["Damage", esc(damageText(w))],
    ["Cooldown", esc(secs(d.cooldownMs))],
  ];
  if (d.range > 0) {
    // A dash's `range` is how far the CAR travels, not how far a shot does — the same field
    // meaning a different thing, and a reader who takes it for a shot's reach has misread the
    // weapon entirely.
    const what = w.maneuver
      ? "how far you lunge"
      : `${round((d.range / model.arenaWidth) * 100)}% of the arena`;
    rows.push(["Range", `${d.range} <span class="sub">${what}</span>`]);
  }
  // A turret weapon fires along the bearing the mouse chose, once the turret has turned to it
  // (TR47). A fixed muzzle prints nothing here: a point that does not apply is left out.
  if (d.turret) {
    rows.push(["Aim", `turret <span class="sub">mouse; turns at ${turret().turnRateDegPerSec}°/s before firing</span>`]);
  }
  if (w.totalLifeMs > 0) {
    rows.push([
      "Lifetime",
      `${esc(secs(w.totalLifeMs))}${w.beam ? ` <span class="sub">grows for ${round(w.extendMs)}ms, then lingers</span>` : ""}`,
    ]);
  }
  if (d.startUpMs > 0) {
    rows.push(["Windup", `${d.startUpMs}ms <span class="sub">${w.ticks.startUp} ticks, and you are visible</span>`]);
  }
  if (d.recoveryMs > 0) {
    rows.push(["Recovery", `${d.recoveryMs}ms <span class="sub">your other slots are locked</span>`]);
  }
  const chips = effectChips(model, w);
  if (chips) rows.push(["Effect", `<div class="fxrow">${chips}</div>`]);
  const props = propertiesOf(w);
  if (props.length > 0) {
    rows.push(["Properties", `<ul class="props">${props.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`]);
  }
  return rows
    .map(([k, v]) => `<div class="row"><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
    .join("");
}

// ---------------------------------------------------------------------------- page sections

function weaponCard(model, w) {
  return `<article class="weapon" style="--acc:${lift(w.def.color)}">
    <header>
      ${iconMarkup(w)}
      <div>
        <h4>${esc(w.def.name)}</h4>
        <span class="slot">${esc(w.slotLabel)}</span>
      </div>
    </header>
    <p class="line">${esc(WEAPON_COPY[w.id].line)}</p>
    <dl class="stats">${statRows(model, w)}</dl>
  </article>`;
}

/**
 * One chassis: its seven ratings, then its three weapons.
 *
 * Each rating prints the 0-100 value AND what it buys, because neither says enough alone — "Speed
 * 85" is meaningless without u/s, and "189 u/s" hides the comparison the bar makes obvious.
 * Handling prints turn RADIUS beside the rate for the same reason: the rate is what the rating sets,
 * the radius is what a corner costs.
 */
export function carSection(carId, model = DEFAULT_MODEL) {
  return withMode(model.config, () => renderCarSection(model, carId));
}

/** The body of `carSection`, already inside its mode's scope. */
function renderCarSection(model, carId) {
  const car = cars()[carId];
  const ratings = [
    ["Speed", car.speed, `${round(forwardMaxSpeedOf(carId))} u/s top`],
    // "s to top" is gone on purpose: under the Unity drive-model port there is no time at which a
    // car reaches its top speed at all (the model is `dv/dt = engineAccel - dragRate*v`, an
    // asymptote, never a clamp) — only a time constant, `1 / dragRate` seconds per e-fold, and
    // `Math.log(10) / dragRate` to reach 90% of it. Labelled honestly as "to 90%", not "to top".
    ["Acceleration", car.accel, `${round(engineAccelOf(carId))} u/s² · ${round(Math.log(10) / dragRateOf(carId), 2)}s to 90%`],
    ["Handling", car.handling, `${round(turnRateOf(carId), 2)} rad/s · ${round(forwardMaxSpeedOf(carId) / turnRateOf(carId))}u turn radius`],
    ["Attack", car.attack, `${round(1 + (car.attack - combat().attackBaseline) * combat().damagePerAttack, 2)}× weapon damage`],
    ["HP", car.hp, `${hpOf(carId)} hull`],
    ["Ram power", car.ramAttack, "how hard it shoves"],
    ["Ram resistance", car.ramDefence, "how hard it is to shove"],
  ];
  // Prefixed with the mode, like every other id this page publishes: the same chassis appears in
  // every tab, and a duplicate id would send both tabs' jump links to whichever came first.
  return `<section class="car" id="car-${model.mode}-${carId}">
    <header class="carhead">
      <img src="${carUrl(carId)}" alt="">
      <div>
        <h3>${esc(car.name)}</h3>
        <p>${esc(CHASSIS_COPY[carId].line)}</p>
      </div>
    </header>
    <ul class="ratings">${ratings
      .map(
        ([label, value, note]) =>
          `<li><span class="bl">${esc(label)}</span><span class="bt"><i style="width:${value}%"></i></span><span class="bv">${value}</span><span class="bn">${esc(note)}</span></li>`,
      )
      .join("")}</ul>
    <div class="weapons">${[
      ...(BASIC_ATTACK_CONFIG.enabled ? [basicAttackOf(carId)] : []),
      // `slotsOf` already truncates to this build's N (VS30) — no second cap needed here.
      ...slotsOf(carId),
    ].map((id) => weaponCard(model, model.byId[id])).join("")}</div>
  </section>`;
}

/** Every effect a player can be put in IN THIS MODE: what it does, how long, and what puts you there. */
function effectsSection(model) {
  const rows = model.publishedEffects.map((statusId) => {
    const def = statusDefOf(statusId);
    const applied = (model.effectSourceMap.get(statusId) ?? []).map(
      (s) =>
        `${esc(weapons()[s.weaponId].name)} ${secs(s.durationMs)}${s.note ? ` (${esc(s.note)})` : ""}`,
    );
    if (model.effectSourceLines[statusId]) applied.push(esc(model.effectSourceLines[statusId]));
    return `<article class="effect" id="${effectAnchor(model, statusId)}" style="--acc:${lift(def.color)}">
      <h4>${esc(def.name)} <span class="kind">${esc(def.kind)}</span></h4>
      <p class="does">${esc(statusBlurb(def))}</p>
      <p class="from"><span>From</span> ${applied.join(" · ")}</p>
    </article>`;
  }).join("");
  return `<section class="effects" id="effects-${model.mode}">
    <h2>Effects</h2>
    <p class="secnote">A car is never in the same effect twice — a second application refreshes the
      clock rather than stacking. Durations are set by whatever applied it, not by the effect.</p>
    <div class="effectgrid">${rows}</div>
  </section>`;
}

// ---------------------------------------------------------------------------- document

function css(fonts) {
  return `${fonts}
:root {
  --ink: #E8EDF4; --dim: #97A3B4; --faint: #66707E;
  --bg: #0D1016; --panel: #151A22; --panel2: #1B212B; --line: #262E3A;
  --display: "Oswald", "Liberation Sans Narrow", "DejaVu Sans", sans-serif;
  --text: "Barlow", "DejaVu Sans", system-ui, sans-serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: var(--text); font-size: 15px; line-height: 1.45;
  -webkit-text-size-adjust: 100%;
}
h1, h2, h3, h4 { font-family: var(--display); margin: 0; letter-spacing: .02em; }
a { color: inherit; }

.topbar {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 10px 20px; background: #0A0D12; border-bottom: 1px solid var(--line);
}
.topbar b { font-family: var(--display); font-size: 17px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.topbar b span { color: var(--faint); font-weight: 500; margin-left: 8px; }
.topbar nav { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.topbar a, .topbar button {
  font: inherit; font-size: 13px; color: var(--dim); text-decoration: none;
  background: var(--panel2); border: 1px solid var(--line); border-radius: 4px;
  padding: 5px 10px; cursor: pointer;
}
.topbar a:hover, .topbar button:hover { color: var(--ink); border-color: #3A465A; }

.jump {
  display: flex; flex-wrap: wrap; gap: 8px;
  max-width: 1180px; margin: 0 auto; padding: 18px 20px 0;
}
.jump a {
  font-family: var(--display); font-size: 13px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--dim); text-decoration: none;
  border: 1px solid var(--line); border-radius: 999px; padding: 4px 14px;
}
.jump a:hover { color: var(--ink); border-color: #3A465A; }

/* ---- the mode tabs ----
   One tab per ACTIVE mode. Only the selected panel is in flow; the print rules below and the
   noscript block in the document head both put every panel back, so a printed guide and a page
   with scripting off carry every mode stacked rather than only the one that happened to open. */
.tabs {
  display: flex; flex-wrap: wrap; gap: 6px;
  max-width: 1180px; margin: 0 auto; padding: 16px 20px 0;
  border-bottom: 1px solid var(--line);
}
.tab {
  font-family: var(--display); font-size: 14px; font-weight: 500;
  letter-spacing: .1em; text-transform: uppercase; color: var(--dim);
  background: transparent; border: 1px solid var(--line); border-bottom: 0;
  border-radius: 5px 5px 0 0; padding: 8px 18px; margin-bottom: -1px; cursor: pointer;
}
.tab:hover { color: var(--ink); }
.tab.on { color: var(--ink); background: var(--panel); border-color: #3A465A; }
.modesec { display: none; }
.modesec.on { display: block; }
.modename {
  font-size: 15px; font-weight: 500; letter-spacing: .16em; text-transform: uppercase;
  color: var(--faint); margin: 22px 0 0;
}

main { max-width: 1180px; margin: 0 auto; padding: 8px 20px 80px; }
.modesec > section > h2 {
  font-size: 28px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  margin: 40px 0 6px; padding-bottom: 8px; border-bottom: 2px solid var(--line);
}
.secnote { color: var(--faint); font-size: 13px; margin: 0 0 20px; max-width: 70ch; }

/* ---- a chassis ---- */
.car { margin: 28px 0 0; padding-top: 22px; border-top: 1px solid var(--line); }
.car:first-of-type { border-top: 0; }
.carhead { display: flex; align-items: center; gap: 18px; margin-bottom: 16px; }
.carhead img { width: 132px; height: auto; flex: 0 0 auto; }
.carhead h3 { font-size: 30px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.carhead p { margin: 4px 0 0; color: var(--dim); max-width: 62ch; }

.ratings { list-style: none; margin: 0 0 20px; padding: 0; display: grid; gap: 5px; }
.ratings li {
  display: grid; grid-template-columns: 116px minmax(90px, 220px) 30px 1fr;
  gap: 10px; align-items: center;
}
.bl { font-family: var(--display); font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: var(--dim); }
.bt { height: 7px; background: var(--panel2); border-radius: 4px; overflow: hidden; }
.bt i { display: block; height: 100%; background: linear-gradient(90deg, #4A6EA8, #7FA8E0); }
.bv { font-family: var(--display); font-size: 14px; font-weight: 700; text-align: right; }
.bn { font-size: 12.5px; color: var(--faint); }

/* ---- a weapon ---- */
/* "start", not the grid default "stretch": a three-weapon row where one card carries twice the
   rows of another would otherwise pad the short ones to match, which reads as missing content. */
.weapons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; align-items: start; }
.weapon {
  background: var(--panel); border: 1px solid var(--line); border-top: 3px solid var(--acc);
  border-radius: 5px; padding: 14px 15px 16px;
}
.weapon header { display: flex; align-items: center; gap: 11px; }
.weapon header img, .icon-fallback { width: 42px; height: 42px; flex: 0 0 auto; border-radius: 4px; }
.weapon h4 { font-size: 19px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--acc); }
.slot { font-family: var(--display); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--faint); }
.line { margin: 10px 0 12px; font-size: 13.5px; color: var(--dim); }

.stats { margin: 0; }
.row { display: grid; grid-template-columns: 92px 1fr; gap: 8px; padding: 5px 0; border-top: 1px solid var(--line); }
.row dt { font-family: var(--display); font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); padding-top: 2px; }
.row dd { margin: 0; font-size: 13.5px; }
.row dd .sub { display: block; color: var(--faint); font-size: 12px; }

.fxrow { display: flex; flex-wrap: wrap; gap: 5px; }
.fx {
  display: inline-flex; align-items: baseline; gap: 5px; text-decoration: none;
  font-size: 12.5px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--panel2);
}
.fx:hover { border-color: #4A5870; }
.fx b { font-weight: 600; color: var(--dim); }
.fx i { font-style: normal; color: var(--faint); font-size: 11.5px; }
.fx-debuff { color: #FF9B7A; }
.fx-buff { color: #8EC6FF; }

.props { list-style: none; margin: 0; padding: 0; }
.props li { font-size: 12.5px; color: var(--dim); padding-left: 13px; position: relative; }
.props li::before { content: "▸"; position: absolute; left: 0; color: var(--faint); font-size: 10px; }

/* ---- effects ---- */
.effectgrid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; align-items: start; }
.effect {
  background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--acc);
  border-radius: 5px; padding: 12px 15px 13px; scroll-margin-top: 70px;
}
.effect:target { border-color: var(--acc); background: var(--panel2); }
.effect h4 { font-size: 18px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--acc); }
.effect .kind { font-family: var(--text); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); margin-left: 6px; }
.effect .does { margin: 5px 0 8px; font-size: 13.5px; }
.effect .from { margin: 0; font-size: 12.5px; color: var(--faint); }
.effect .from span { font-family: var(--display); letter-spacing: .08em; text-transform: uppercase; font-size: 11px; margin-right: 5px; }

@media (max-width: 1000px) {
  .weapons { grid-template-columns: 1fr; }
  .effectgrid { grid-template-columns: 1fr; }
}
@media (max-width: 620px) {
  /* The subtitle is the first thing to go: it wraps the title onto two lines and pushes the two
     buttons into a stack, which costs a third of the first screen to a bar nobody reads twice. */
  .topbar { padding: 8px 14px; }
  .topbar b span { display: none; }
  .topbar nav { flex-wrap: nowrap; }
  .jump, main { padding-left: 14px; padding-right: 14px; }
  .carhead { align-items: flex-start; }
  .carhead img { width: 84px; }
  .carhead h3 { font-size: 24px; }
  .ratings li { grid-template-columns: 104px 1fr 28px; }
  .bn { grid-column: 1 / -1; padding-left: 104px; margin-top: -3px; }
  .row { grid-template-columns: 1fr; gap: 1px; }
}

@media print {
  .topbar, .jump, .tabs { display: none; }
  /* Every mode, stacked, each under its own name — a printout has no tabs to click. */
  .modesec { display: block; }
  .modesec + .modesec { break-before: page; }
  .modename { color: #111; }
  body { background: #fff; color: #111; }
  .weapon, .effect { background: #fff; border-color: #bbb; break-inside: avoid; }
  .car { break-inside: avoid-page; }
  .bl, .bn, .row dt, .props li, .effect .from { color: #555; }
  .bt { background: #eee; }
}
`;
}

/** Shown on screen, hidden in print. Plain links: nothing here needs the client's bundle. */
function topbar() {
  return `<div class="topbar">
    <b>${esc(MANUAL_META.title)} <span>${esc(MANUAL_META.subtitle)}</span></b>
    <nav>
      <a href="./">Back to the game</a>
      <button type="button" onclick="window.print()">Print</button>
    </nav>
  </div>`;
}

/**
 * One mode's whole half of the guide: its own jump strip, its Cars, its Effects.
 *
 * Every id inside carries the mode, and every in-page link inside points at one of them, so a chip
 * in Brawl's weapon list can only ever resolve to Brawl's description of that status.
 */
function modeSection(model, isFirst) {
  return withMode(model.config, () => {
    const jump = [
      ...model.carIds.map(
        (carId) => `<a href="#car-${model.mode}-${carId}">${esc(cars()[carId].name)}</a>`,
      ),
      `<a href="#effects-${model.mode}">Effects</a>`,
    ].join("");

    return `<section class="modesec${isFirst ? " on" : ""}" id="mode-${model.mode}" role="tabpanel" aria-labelledby="tab-${model.mode}">
  <h2 class="modename">${esc(model.name)}</h2>
  <nav class="jump">${jump}</nav>
  <section id="cars-${model.mode}">
    <h2>Cars</h2>
    <p class="secnote">Ratings are 0-100 and the figure beside each one is what it buys.
      Weapon damage is what THAT chassis deals — its Attack rating is already in the number.
      A row a weapon has no answer for is left out rather than printed empty.</p>
    ${model.carIds.map((carId) => carSection(carId, model)).join("\n")}
  </section>
  ${effectsSection(model)}
</section>`;
  });
}

/**
 * The tab strip: one button per active mode, labelled from `MODE_TABLE`'s own `name`.
 *
 * The label is never written here. It is the same string the lobby's mode card carries, so a mode
 * renamed in the registry is renamed on this page by the next build and the two cannot drift.
 */
function tabStrip() {
  return `<nav class="tabs" role="tablist" aria-label="Game mode">${MODELS.map(
    (model, i) =>
      `<button type="button" class="tab${i === 0 ? " on" : ""}" id="tab-${model.mode}"` +
      ` role="tab" aria-controls="mode-${model.mode}" aria-selected="${i === 0 ? "true" : "false"}"` +
      ` data-mode="mode-${model.mode}">${esc(model.name)}</button>`,
  ).join("")}</nav>`;
}

/**
 * The page's only script: it switches tabs, and it follows a `#anchor` into whichever mode's section
 * defines it.
 *
 * That second job is not decoration. Every effect and chassis anchor is mode-prefixed and sits
 * inside a panel that is `display: none` unless its tab is on, so a link someone pasted into chat
 * would otherwise scroll the browser to a hidden element and show an apparently empty page. Opening
 * the owning tab first is what keeps a shared link honest.
 *
 * Inline, dependency-free, and no framework: the guide ships in a LAN zip with no route to the
 * internet, and `manual-page.test.mjs` asserts the page reaches for nothing off the machine.
 */
function tabScript() {
  return `(function () {
  var tabs = [].slice.call(document.querySelectorAll(".tab"));
  var panels = [].slice.call(document.querySelectorAll(".modesec"));
  function show(id) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-mode") === id;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach(function (p) { p.classList.toggle("on", p.id === id); });
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { show(t.getAttribute("data-mode")); });
  });
  function follow() {
    var target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    var panel = target.closest(".modesec");
    if (!panel) return;
    show(panel.id);
    target.scrollIntoView();
  }
  window.addEventListener("hashchange", follow);
  follow();
})();`;
}

/** A tab per active mode, each with its own Cars and Effects, as one self-contained page. */
function buildDocument(fonts) {
  const body = `${tabStrip()}
<main>
${MODELS.map((model, i) => modeSection(model, i === 0)).join("\n")}
</main>
<script>${tabScript()}</script>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="${STAMP_META_NAME}" content="${balanceStamp()}">
<title>${esc(MANUAL_META.title)} — ${esc(MANUAL_META.subtitle)}</title>
<style>${css(fonts)}</style>
<noscript><style>.tabs { display: none; } .modesec { display: block; }</style></noscript>
</head><body>${topbar()}\n${body}</body></html>`;
}

async function main() {
  mkdirSync(dirname(OUT_WEB_HTML), { recursive: true });
  writeFileSync(OUT_WEB_HTML, buildDocument(await fontCss()));
  const kb = Math.round(statSync(OUT_WEB_HTML).size / 1024);
  console.log(
    `[manual] ${MODELS.length} modes — ` +
      MODELS.map(
        (m) => `${m.name}: ${m.weapons.length} weapons / ${m.carIds.length} chassis / ` +
          `${m.publishedEffects.length} effects`,
      ).join("; ") +
      `, stamp ${balanceStamp()} -> ${OUT_WEB_HTML} (${kb} KB)`,
  );
}

// Importable for its exports without building anything: `manual-page.test.mjs` needs `balanceStamp`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
