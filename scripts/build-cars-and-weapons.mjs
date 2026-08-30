#!/usr/bin/env node
/**
 * Builds `packages/client/public/manual.html` — the player-facing cars-and-weapons guide, three
 * chassis and nine weapons, that the join screen's button opens.
 *
 * It is a web page rather than a document players download: an <embed>ed file is at the mercy of
 * whatever viewer they have, and on mobile is usually just a download prompt. The layout is still
 * paginated and still prints — the topbar's Print button hands the browser the same A4 sheets — but
 * that is a courtesy of the stylesheet, not a second output this script has to produce.
 *
 * Every number on it is read from BUILT shared (`WEAPON_TABLE`, `CAR_TABLE`, `WEAPON_TICKS`,
 * `weaponDamageOf`), never transcribed, so a balance edit is reprinted by re-running this script and
 * cannot drift from the sim. The prose lives in `cars-and-weapons-copy.mjs`.
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
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_ARENA_ID,
  AIM_CONFIG,
  CAR_TABLE,
  COMBAT_CONFIG,
  DRIVE_CONFIG,
  STATUS_TABLE,
  TICK_RATE_HZ,
  WEAPON_TABLE,
  WEAPON_TICKS,
  forwardMaxSpeedOf,
  getArena,
  hpOf,
  slotsOf,
  statusDefOf,
  weaponDamageOf,
} from "@motor-combat-moba/shared";

import { CHASSIS_COPY, MANUAL_META, SLOT_ROLES, WEAPON_COPY } from "./cars-and-weapons-copy.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Served by the client. Vite copies `public/` verbatim, so this ships in the LAN zip too. */
export const OUT_WEB_HTML = resolve(ROOT, "packages/client/public/manual.html");

/**
 * The arena the build ships, for "how far is 900 units really" context.
 *
 * Read from `ACTIVE_ARENA_ID` rather than written out, because every weapon's reach is reported as a
 * PERCENTAGE of this. `ARENA_02` is 2000 wide against `ARENA_01`'s 1280, so pointing the build at
 * the other arena would overstate all nine of those figures by half again — and, hardcoded, would do
 * it silently: `balanceStamp` hashes this value, so a literal would only ever fingerprint itself.
 */
const ARENA_WIDTH = getArena(ACTIVE_ARENA_ID).width;
/** Rating 50 is average by definition (`COMBAT_CONFIG.attackBaseline` is the same pivot). */
const AVERAGE_RATING = 50;
const AVERAGE_HP = AVERAGE_RATING * COMBAT_CONFIG.hpPerRating;

// ---------------------------------------------------------------------------- derived stats

const CAR_IDS = Object.keys(CAR_TABLE);
const OWNER_OF = Object.fromEntries(
  CAR_IDS.flatMap((carId) => slotsOf(carId).map((weaponId) => [weaponId, carId])),
);

const round = (n, dp = 0) => Number(n.toFixed(dp));

/**
 * A one-line reading of what a status does, derived from the row itself rather than written out
 * beside it — so retuning a status updates the guide, and adding one needs no copy at all.
 *
 * Ordered worst-first: a player scanning this wants the thing that will kill them, not the thing
 * that will slow them.
 */
function statusBlurb(def) {
  const parts = [];
  if ((def.flags ?? []).includes("immobilised")) parts.push("no control");
  if (def.pulse?.damage) parts.push(`${def.pulse.damage} hp per ${round(def.pulse.intervalMs / 1000, 2)}s`);
  if (def.pulse?.heal) parts.push(`repairs ${def.pulse.heal} hp per ${round(def.pulse.intervalMs / 1000, 2)}s`);
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
  damageDealt: "damage out",
  damageTaken: "damage taken",
  weaponCooldown: "recharge",
  ramMass: "ram weight",
};

/** `{ shape, size }` — `size` is kept short enough never to wrap inside the spec panel. */
function hitboxLine(def) {
  const h = def.hitbox;
  if (h.shape === "circle") return { shape: "Circle", size: `${h.radius * 2} across` };
  if (h.shape === "ellipse") return { shape: "Ellipse", size: `${h.radiusAlong * 2} × ${h.radiusAcross * 2}` };
  if (h.shape === "rect") return { shape: "Beam", size: `${h.width} × ${def.range}` };
  // A disc grows in every direction at once, so its `range` is a radius rather than a reach.
  if (h.shape === "disc") return { shape: "Aura", size: `${def.range} radius` };
  return { shape: "Cone", size: `${h.angleDeg}° × ${def.range}` };
}

/** Rough swept footprint, only ever compared against the other eight rows. */
function footprint(def) {
  const h = def.hitbox;
  if (h.shape === "circle") return Math.PI * h.radius ** 2;
  if (h.shape === "ellipse") return Math.PI * h.radiusAlong * h.radiusAcross;
  if (h.shape === "rect") return h.width * def.range;
  if (h.shape === "disc") return Math.PI * def.range ** 2;
  return ((h.angleDeg / 360) * Math.PI * def.range ** 2);
}

function derive(id) {
  const def = WEAPON_TABLE[id];
  const ticks = WEAPON_TICKS[id];
  const carId = OWNER_OF[id];
  const car = CAR_TABLE[carId];
  const slot = slotsOf(carId).indexOf(id);
  const beam = def.kind === "beam";

  // `volley` lives on `WeaponBase`, so a BEAM can be a wave sequence too — `shockwave` is three
  // discs 500ms apart. This file is plain `.mjs` and the compiler never checks it, so a "beams fire
  // once per press" shortcut here would silently under-report a real weapon on the page players
  // read. Both kinds go through the same volley arithmetic; only what one volley *contains*
  // differs, which is exactly the line `PelletDef` was split out on.
  const shotsPerPress = beam
    ? def.volley.volleys
    : def.volley.volleys * def.pellets.pelletsPerVolley;
  const burstSpanMs = (def.volley.volleys - 1) * def.volley.volleyIntervalMs;
  const extendMs = (def.range / def.speed) * 1000;
  const totalLifeMs = beam ? extendMs + def.lifetimeMs : extendMs;
  // A ticking beam re-arms on its own interval for as long as it lives; everything else lands once
  // per instance, so a projectile's ceiling on one car is its whole pellet count.
  //
  // Counted in TICKS and INCLUSIVE of the opening one, because that is what the sim does:
  // `resolveInstanceHits` damages on the first tick the beam covers a car and only then arms the
  // clock for `damageInterval` ticks later, over the `flight + lifetime` ticks `instanceExpired`
  // keeps the instance alive. Dividing the millisecond life by the interval instead loses that
  // opening hit whenever the life is not a whole multiple of the interval — which cost Bulwark a
  // ninth tick (35 damage, and the top of the damage-per-press ranking) until 2026-08-30.
  const aliveTicks = ticks.flight + ticks.lifetime;
  const damageTicks =
    ticks.damageInterval === Number.POSITIVE_INFINITY
      ? 1
      : Math.floor((aliveTicks - 1) / ticks.damageInterval) + 1;
  // Each of a beam's volleys is its own instance with its own damage clock, so a target that eats
  // every wave takes `damageTicks` from each: `shockwave` is 1 x 3, `bulwark` 10 x 1.
  const hitsPerTarget = beam ? damageTicks * def.volley.volleys : shotsPerPress;

  const baseBurst = def.damage * hitsPerTarget;
  // Recharge starts at the LAST shot of a press (`fire.ts`), so a multi-volley burst pushes the
  // whole cycle out by its own span. Wind-up counts for the same reason.
  const cycleMs = def.startUpMs + burstSpanMs + def.cooldownMs;
  const perHit = weaponDamageOf(carId, id);
  const liveBurst = perHit * hitsPerTarget;

  return {
    id,
    def,
    ticks,
    carId,
    car,
    slot,
    beam,
    shotsPerPress,
    waves: def.volley.volleys,
    burstSpanMs,
    extendMs,
    totalLifeMs,
    hitsPerTarget,
    baseBurst,
    cycleMs,
    perHit,
    liveBurst,
    sustainedDps: baseBurst / (cycleMs / 1000),
    liveDps: liveBurst / (cycleMs / 1000),
    pctOfAverageCar: (baseBurst / AVERAGE_HP) * 100,
    footprint: footprint(def),
    attackScale: 1 + (car.attack - COMBAT_CONFIG.attackBaseline) * COMBAT_CONFIG.damagePerAttack,
  };
}

const WEAPONS = CAR_IDS.flatMap((carId) => slotsOf(carId)).map(derive);
const byId = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/**
 * How many times one press can damage a SINGLE car — the "full connect" ceiling the guide prints,
 * and the multiplier behind its damage figure, its share-of-a-car figure and its DPS.
 *
 * Exported purely as a seam for `manual-page.test.mjs`, which checks it by driving the real sim
 * instead of repeating the arithmetic above. Nothing in the page build calls this.
 */
export function hitsPerTargetOf(weaponId) {
  return byId[weaponId].hitsPerTarget;
}

/** The chassis that carries each weapon. The test needs it to spawn a shot the way a match does. */
export function carrierOf(weaponId) {
  return OWNER_OF[weaponId];
}

const MAX = {
  power: Math.max(...WEAPONS.map((w) => w.baseBurst)),
  cadence: Math.max(...WEAPONS.map((w) => 1000 / w.cycleMs)),
  reach: Math.max(...WEAPONS.map((w) => w.def.range)),
  area: Math.max(...WEAPONS.map((w) => Math.sqrt(w.footprint))),
  commit: Math.max(...WEAPONS.map((w) => w.def.startUpMs + w.def.recoveryMs + w.def.cooldownMs)),
};

function bars(w) {
  return [
    ["Damage", (w.baseBurst / MAX.power) * 100, `${w.baseBurst} full connect`],
    ["Rate", ((1000 / w.cycleMs) / MAX.cadence) * 100, `${round(1000 / w.cycleMs, 2)} presses/s`],
    ["Reach", (w.def.range / MAX.reach) * 100, `${w.def.range} units`],
    ["Area", (Math.sqrt(w.footprint) / MAX.area) * 100, `${hitboxLine(w.def).shape}, ${hitboxLine(w.def).size}`],
    [
      "Commitment",
      ((w.def.startUpMs + w.def.recoveryMs + w.def.cooldownMs) / MAX.commit) * 100,
      `${round((w.def.startUpMs + w.def.recoveryMs + w.def.cooldownMs) / 1000, 1)}s locked in`,
    ],
  ];
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
 */
export function balanceStamp() {
  const inputs = {
    weapons: WEAPON_TABLE,
    cars: CAR_TABLE,
    combat: COMBAT_CONFIG,
    statuses: STATUS_TABLE,
    drive: DRIVE_CONFIG,
    lockRange: AIM_CONFIG.lockRange,
    tickRateHz: TICK_RATE_HZ,
    arenaWidth: ARENA_WIDTH,
    copy: { MANUAL_META, CHASSIS_COPY, SLOT_ROLES, WEAPON_COPY },
  };
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 16);
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

// ---------------------------------------------------------------------------- page fragments

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const SLOT_LABEL = ["Slot 1 — Go-to", "Slot 2 — Mid", "Slot 3 — Ultimate"];

function page(cls, inner) {
  return `<section class="page ${cls}">${inner}</section>`;
}

function cover() {
  const grid = WEAPONS.map(
    (w) =>
      `<figure><img src="${iconUrl(w.id)}" alt=""><figcaption style="color:${lift(w.def.color)}">${esc(
        w.def.name,
      )}</figcaption></figure>`,
  ).join("");
  return page(
    "cover",
    `<div class="cover-rule"></div>
     <p class="kicker">Field Manual · ${WEAPONS.length} weapons · ${CAR_IDS.length} chassis</p>
     <h1>${esc(MANUAL_META.title)}</h1>
     <h2>${esc(MANUAL_META.subtitle)}</h2>
     <p class="blurb">${esc(MANUAL_META.blurb)}</p>
     <div class="cover-grid">${grid}</div>
     <p class="cover-foot">All figures read straight from the shipping balance tables.
       Damage shown at an average chassis unless a chassis is named.</p>`,
  );
}

function legend() {
  const roles = SLOT_ROLES.map(
    (r, i) => `<li><b>${i + 1}. ${esc(r.name)}</b><span>${esc(r.line)}</span></li>`,
  ).join("");
  return page(
    "legend",
    `<header class="phead"><span class="pnum">How to read this</span><h2>The five bars, and the words next to them</h2></header>
     <div class="two-col">
       <div>
         <h3>The bars</h3>
         <dl class="defs">
           <dt>Damage</dt><dd>Everything one press can put into a single car if all of it connects. For a shotgun that is every pellet; for a burning cone that is every tick of it.</dd>
           <dt>Rate</dt><dd>How often you get to press. Counts the wind-up and the burst, not just the recharge.</dd>
           <dt>Reach</dt><dd>How far the shot travels, or how far the beam grows. The arena is ${ARENA_WIDTH} units wide and a car is ${DRIVE_CONFIG.carWidth} long.</dd>
           <dt>Area</dt><dd>How much room the hitbox covers. Big area forgives bad aim.</dd>
           <dt>Commitment</dt><dd>Wind-up plus recovery plus recharge — how long the press owns you.</dd>
         </dl>
         <h3>Slots</h3>
         <ol class="roles">${roles}</ol>
       </div>
       <div>
         <h3>Terms</h3>
         <dl class="defs">
           <dt>Lock-on</dt><dd>Some weapons fire at whatever the car has locked instead of straight down the nose. The lock reaches ${AIM_CONFIG.lockRange} units and aims where the target <i>is</i>, with no lead — so it helps most up close. ${WEAPONS.filter((w) => !w.def.usesAimAssist).length} of the ${WEAPONS.length} weapons do not use it at all.</dd>
           <dt>Wind-up</dt><dd>Delay between the press and the shot. You keep driving, but you cannot take the press back.</dd>
           <dt>Recovery</dt><dd>Lockout on your <i>other</i> two slots after a press.</dd>
           <dt>Recharge</dt><dd>Time before this weapon is ready again. It starts at the last shot of the press, not the first.</dd>
           <dt>Stock</dt><dd>Shots you can bank. One weapon has them.</dd>
           <dt>Pierce</dt><dd>Cars a shot carries on through after the first one it hits.</dd>
           <dt>Attack scale</dt><dd>Your chassis multiplies every weapon's damage. ${CAR_IDS.map(
             (id) => `${CAR_TABLE[id].name} ${round(1 + (CAR_TABLE[id].attack - COMBAT_CONFIG.attackBaseline) * COMBAT_CONFIG.damagePerAttack, 1)}×`,
           ).join(", ")}.</dd>
         </dl>
         <div class="callout">
           <b>The yardstick.</b> An average car has ${AVERAGE_HP} hull HP. Every “% of a car” in this
           book is measured against that, before your chassis's attack scale is applied. The sim runs
           at ${TICK_RATE_HZ} ticks a second, so every duration here is rounded up to a whole tick in play.
         </div>
       </div>
     </div>
     <div class="triangle">
       <h3>Three chassis, one triangle</h3>
       <div class="tri">${CAR_IDS.map(
         (carId, i) => `<div>
           <img src="${carUrl(carId)}" alt="">
           <b>${esc(CAR_TABLE[carId].name)}</b>
           <span>${esc(CHASSIS_COPY[carId].codename)}</span>
           <p>${esc(CHASSIS_COPY[carId].theme)}</p>
         </div>${i < CAR_IDS.length - 1 ? '<i class="arrow">&#9654;</i>' : ""}`,
       ).join("")}</div>
       <p class="note">Mirage catches Bullseye · Bullseye kites Bastion · Bastion punishes Mirage.
         Nobody is safe from everybody — and the kit is most of the reason why.</p>
     </div>`,
  );
}

function chassisPage(carId) {
  const car = CAR_TABLE[carId];
  const copy = CHASSIS_COPY[carId];
  const kit = slotsOf(carId).map((id) => byId[id]);
  const ratings = [
    ["Speed", car.speed, `${round(forwardMaxSpeedOf(carId))} u/s top`],
    ["Attack", car.attack, `${round(1 + (car.attack - COMBAT_CONFIG.attackBaseline) * COMBAT_CONFIG.damagePerAttack, 2)}× damage`],
    ["Hull", car.hp, `${hpOf(carId)} HP`],
    ["Mass", car.mass, "ram authority"],
  ];
  const bars_ = ratings
    .map(
      ([label, value, note]) =>
        `<li><span class="bl">${label}</span><span class="bt"><i style="width:${value}%"></i></span><span class="bv">${value}</span><span class="bn">${esc(note)}</span></li>`,
    )
    .join("");
  const kitRows = kit
    .map(
      (w) => `<li style="--acc:${lift(w.def.color)}">
        <img src="${iconUrl(w.id)}" alt="">
        <div class="kn"><b>${esc(w.def.name)}</b><span>${esc(SLOT_LABEL[w.slot])}</span>
          <p>${esc(WEAPON_COPY[w.id].tagline)}</p></div>
        <dl class="kstats">
          <div><dt>Damage</dt><dd>${w.liveBurst}</dd></div>
          <div><dt>Recharge</dt><dd>${round(w.def.cooldownMs / 1000, 1)}s</dd></div>
          <div><dt>Reach</dt><dd>${w.def.range}</dd></div>
          <div><dt>Lock</dt><dd>${w.def.usesAimAssist ? "Yes" : "No"}</dd></div>
        </dl>
      </li>`,
    )
    .join("");
  return page(
    "chassis",
    `<header class="phead"><span class="pnum">Chassis</span><h2>${esc(car.name)} <em>— ${esc(copy.codename)}</em></h2></header>
     <div class="chassis-hero">
       <img class="carshot" src="${carUrl(carId)}" alt="">
       <div>
         <p class="theme">“${esc(copy.theme)}”</p>
         <p class="body">${esc(copy.body)}</p>
       </div>
     </div>
     <ul class="ratings">${bars_}</ul>
     <div class="matchup">
       <p><b>Beats</b> ${esc(copy.beats)}</p>
       <p><b>Loses to</b> ${esc(copy.losesTo)}</p>
     </div>
     <h3 class="kit-head">The kit <em>— one page each, overleaf</em></h3>
     <ul class="kit">${kitRows}</ul>`,
  );
}

function specRows(w) {
  const d = w.def;
  const multi = w.hitsPerTarget > 1;
  const rows = [
    ["Damage", `${d.damage}${multi ? ` × ${w.hitsPerTarget}` : ""}`,
      multi ? (w.beam ? (w.waves > 1 ? "per wave" : "per tick") : "per shot")
            : `${round(w.pctOfAverageCar)}% of an average car`],
    ["On ${car}", `${w.perHit}${w.hitsPerTarget > 1 ? ` × ${w.hitsPerTarget} = ${w.liveBurst}` : ""}`,
      `${round(w.attackScale, 1)}× attack scale`],
    ["Recharge", `${round(d.cooldownMs / 1000, 2)}s`, d.stock ? `per stock · ${d.stock.max} banked` : "single stock"],
    ["Sustained", `${round(w.sustainedDps)} dps`, "if every press connects"],
    ["Reach", `${d.range}`, `${round((d.range / ARENA_WIDTH) * 100)}% of the arena · ${round(d.range / DRIVE_CONFIG.carWidth, 1)} car lengths`],
    ["Speed", `${d.speed} u/s`, w.beam ? `full extent in ${round(w.extendMs)}ms` : `crosses its range in ${round(w.extendMs)}ms`],
    ["Hitbox", hitboxLine(d).size, hitboxLine(d).shape.toLowerCase()],
  ];
  if (multi) rows.splice(1, 0, ["Full connect", `${w.baseBurst}`, `${round(w.pctOfAverageCar)}% of an average car`]);
  if (w.beam) rows.push(["Lifetime", `${round(w.totalLifeMs / 1000, 2)}s`, d.attached ? "rides your car" : "stamped in place"]);
  if (!w.beam && d.volley.volleys * d.pellets.pelletsPerVolley > 1)
    rows.push(["Volley", `${d.volley.volleys} × ${d.pellets.pelletsPerVolley}`, `${d.volley.volleyIntervalMs}ms apart · ${d.pellets.spreadAngleDeg}° fan`]);
  // A beam sequence has no pellets to fan, so it gets its own row rather than sharing the one
  // above: three waves is the whole shape of the press and the page must say so.
  if (w.beam && w.waves > 1)
    rows.push(["Waves", `${w.waves}`, `${d.volley.volleyIntervalMs}ms apart · ${round(w.burstSpanMs / 1000, 2)}s to land them all`]);
  if (!w.beam && d.pierce > 0) rows.push(["Pierce", `${d.pierce + 1} cars`, "keeps going after the first"]);
  // The dump window is counted in TICKS, not in authored milliseconds: `refireDelayMs: 110` rounds
  // up to 4 ticks (133ms), so two gaps are 267ms rather than the 220ms the raw field multiplies to.
  // The player waits whole ticks, so the page must print whole ticks.
  if (d.stock)
    rows.push([
      "Salvo",
      `${d.stock.max} × ${w.perHit} = ${d.stock.max * w.perHit}`,
      `dumped in ${round(((d.stock.max - 1) * w.ticks.refireDelay * 1000) / TICK_RATE_HZ / 1000, 2)}s`,
    ]);
  if (d.startUpMs > 0) rows.push(["Wind-up", `${d.startUpMs}ms`, `${w.ticks.startUp} ticks — you are visible`]);
  rows.push(["Recovery", d.recoveryMs > 0 ? `${d.recoveryMs}ms` : "none", d.recoveryMs > 0 ? "other slots locked" : "gates nothing else"]);
  rows.push(["Lock-on", d.usesAimAssist ? "Yes" : "No", d.usesAimAssist ? `assists inside ${AIM_CONFIG.lockRange} units` : "fires down your nose"]);
  // What a weapon DOES to you beyond the damage number is the thing a player most needs the guide
  // for: nothing on screen says "this one stuns", and the badge only appears once it is too late.
  for (const a of d.applies ?? []) {
    const def = statusDefOf(a.statusId);
    // `onWave: "final"` is a real rule a player has to plan around — shockwave's debuff arrives
    // only if the target is still in the ring for the LAST wave — so it goes on the page rather
    // than staying a table detail.
    const wave = a.onWave === "final" && w.waves > 1 ? ` · last wave only` : "";
    rows.push([
      a.target === "self" ? "Grants you" : "Inflicts",
      def.name,
      `${round(a.durationMs / 1000, 2)}s · ${statusBlurb(def)}${wave}`,
    ]);
  }

  return rows
    .map(
      ([k, v, n]) =>
        `<div class="spec"><dt>${esc(k.replace("${car}", w.car.name))}</dt><dd>${esc(v)}<span>${esc(n)}</span></dd></div>`,
    )
    .join("");
}

function weaponPage(w, index) {
  const copy = WEAPON_COPY[w.id];
  const acc = lift(w.def.color);
  const barHtml = bars(w)
    .map(
      ([label, pct, note]) =>
        `<li><span class="bl">${label}</span><span class="bt"><i style="width:${Math.max(2, round(pct, 1))}%"></i></span><span class="bn">${esc(note)}</span></li>`,
    )
    .join("");
  return page(
    "weapon",
    `<div class="wpn" style="--acc:${acc};--raw:${w.def.color}">
       <header class="phead"><span class="pnum">${String(index + 1).padStart(2, "0")} / ${String(WEAPONS.length).padStart(2, "0")}</span>
         <span class="owner">${esc(w.car.name)} · ${esc(SLOT_LABEL[w.slot])}</span></header>
       <div class="hero">
         <img src="${iconUrl(w.id)}" alt="">
         <div>
           <h1>${esc(w.def.name)}</h1>
           <p class="shape">${esc(copy.shape)}</p>
           <p class="tagline">${esc(copy.tagline)}</p>
         </div>
       </div>
       <ul class="bars">${barHtml}</ul>
       <div class="wbody">
         <div class="prose">
           <p>${esc(copy.what)}</p>
           <p>${esc(copy.how)}</p>
           <div class="tip"><b>Used properly</b><p>${esc(copy.tip)}</p></div>
         </div>
         <dl class="specs">${specRows(w)}</dl>
       </div>
       <footer class="wfoot">
         <span class="swatch" style="background:${w.def.color}"></span>
         Incoming ${esc(w.def.name)} draws in this colour — <code>${w.def.color}</code>. Every car firing it fires the same shade.
       </footer>
     </div>`,
  );
}

function compare() {
  const rows = WEAPONS.map(
    (w) => `<tr>
      <td class="nm"><span class="dot" style="background:${w.def.color}"></span>${esc(w.def.name)}</td>
      <td>${esc(w.car.name)}</td>
      <td>${w.slot + 1}</td>
      <td>${w.beam ? "Beam" : "Shot"}</td>
      <td class="n">${w.def.damage}${w.hitsPerTarget > 1 ? `×${w.hitsPerTarget}` : ""}</td>
      <td class="n">${w.baseBurst}</td>
      <td class="n">${round(w.pctOfAverageCar)}%</td>
      <td class="n">${round(w.def.cooldownMs / 1000, 2)}s</td>
      <td class="n">${w.def.range}</td>
      <td class="n">${round(w.sustainedDps)}</td>
      <td>${w.def.usesAimAssist ? "Yes" : "—"}</td>
    </tr>`,
  ).join("");
  return page(
    "compare",
    `<header class="phead"><span class="pnum">At a glance</span><h2>All nine, side by side</h2></header>
     <table class="grid">
       <thead><tr>
         <th>Weapon</th><th>Chassis</th><th>Slot</th><th>Type</th><th>Damage</th>
         <th>Full connect</th><th>% of a car</th><th>Recharge</th><th>Reach</th><th>DPS</th><th>Lock</th>
       </tr></thead>
       <tbody>${rows}</tbody>
     </table>
     <p class="note">“Full connect” is everything one press can land on a single car. “% of a car” is
       that figure against an average ${AVERAGE_HP} HP hull, before your chassis's attack scale. “DPS”
       assumes every press connects in full and counts wind-up, burst and recharge.</p>
     <h3 class="sub">Damage per press, ranked</h3>
     <ul class="rank">${[...WEAPONS]
       .sort((a, b) => b.baseBurst - a.baseBurst)
       .map(
         (w) => `<li>
           <span class="rn">${esc(w.def.name)}</span>
           <span class="rt"><i style="width:${round((w.baseBurst / MAX.power) * 100, 1)}%;background:${lift(w.def.color, 0.2)}"></i></span>
           <span class="rv">${w.baseBurst}</span>
           <span class="rp">${round(w.pctOfAverageCar)}% of a car</span>
         </li>`,
       )
       .join("")}</ul>
     <p class="note">Full connect, before any chassis's attack scale. The top three bars are the
       three ultimates — and also the three longest waits.</p>
     <div class="palette">
       <h3>Read the colour, know the shot</h3>
       <div class="swatches">${CAR_IDS.map(
         (carId) => `<div><b>${esc(CAR_TABLE[carId].name)}</b>${slotsOf(carId)
           .map(
             (id) =>
               `<span><i style="background:${WEAPON_TABLE[id].color}"></i>${esc(WEAPON_TABLE[id].name)} <code>${WEAPON_TABLE[id].color}</code></span>`,
           )
           .join("")}</div>`,
       ).join("")}</div>
       <p class="note">Shot colour is per weapon, never per player — the car wearing your enemy's
         colour is the thing on screen. Colour answers <i>who is shooting</i>; shape answers
         <i>what is coming</i>.</p>
     </div>`,
  );
}

function ceilings() {
  const wreck = WEAPONS.map(
    (w) => `<tr>
      <td class="nm"><span class="dot" style="background:${w.def.color}"></span>${esc(w.def.name)}</td>
      ${CAR_IDS.map((id) => `<td class="n">${Math.ceil(hpOf(id) / w.liveBurst)}</td>`).join("")}
      <td class="n">${w.liveBurst}</td>
      <td>${esc(w.car.name)}</td>
    </tr>`,
  ).join("");
  const cost = WEAPONS.map(
    (w) => `<tr>
      <td class="nm"><span class="dot" style="background:${w.def.color}"></span>${esc(w.def.name)}</td>
      <td class="n">${w.def.startUpMs > 0 ? `${w.def.startUpMs}ms` : "—"}</td>
      <td class="n">${w.burstSpanMs > 0 ? `${w.burstSpanMs}ms` : "—"}</td>
      <td class="n">${w.def.recoveryMs > 0 ? `${w.def.recoveryMs}ms` : "—"}</td>
      <td class="n">${round(w.def.cooldownMs / 1000, 2)}s</td>
      <td class="n">${round(w.cycleMs / 1000, 2)}s</td>
      <td>${w.def.stock ? `${w.def.stock.max} banked · ${w.def.stock.refireDelayMs}ms apart` : "—"}</td>
    </tr>`,
  ).join("");
  return page(
    "ceilings",
    `<header class="phead"><span class="pnum">At a glance</span><h2>Ceilings and costs</h2></header>
     <h3 class="sub">Presses to wreck</h3>
     <table class="grid tight">
       <thead><tr><th>Weapon</th>${CAR_IDS.map(
         (id) => `<th class="n">vs ${esc(CAR_TABLE[id].name)}<span>${hpOf(id)} HP</span></th>`,
       ).join("")}<th class="n">Per press</th><th>Firing from</th></tr></thead>
       <tbody>${wreck}</tbody>
     </table>
     <p class="note">Presses needed if every one of them connects in full, at the damage its own
       chassis actually deals. A real fight is never this tidy — treat these as the ceiling, not the plan.</p>
     <h3 class="sub">What a press costs you</h3>
     <table class="grid tight">
       <thead><tr>
         <th>Weapon</th><th class="n">Wind-up</th><th class="n">Burst</th><th class="n">Recovery</th>
         <th class="n">Recharge</th><th class="n">Full cycle</th><th>Stock</th>
       </tr></thead>
       <tbody>${cost}</tbody>
     </table>
     <p class="note">Wind-up is before the shot, recovery locks your <i>other</i> slots, and the
       recharge only starts at the press's last shot — which is why the full cycle is the honest number.</p>`,
  );
}

// ---------------------------------------------------------------------------- document

function css(fonts) {
  return `${fonts}
:root {
  --ink: #E8EDF4; --dim: #97A3B4; --faint: #66707E;
  --bg: #0D1016; --panel: #151A22; --line: #262E3A;
  --display: "Oswald", "Liberation Sans Narrow", "DejaVu Sans", sans-serif;
  --body: "Barlow", "Liberation Sans", "DejaVu Sans", sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4; margin: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: var(--body); color: var(--ink); background: var(--bg); font-size: 10pt; line-height: 1.5; }
.page { width: 210mm; height: 297mm; padding: 15mm 16mm; position: relative; overflow: hidden;
        page-break-after: always; background: var(--bg); display: flex; flex-direction: column; }
.page:last-child { page-break-after: auto; }
.chassis { justify-content: space-between; }
h1, h2, h3, .kicker, .pnum, .owner, .bl, th { font-family: var(--display); font-weight: 700;
        text-transform: uppercase; letter-spacing: .06em; }
code { font-family: "DejaVu Sans Mono", monospace; font-size: .85em; color: var(--dim); }

/* ---- shared page header ---- */
.phead { display: flex; align-items: baseline; justify-content: space-between; gap: 6mm;
         border-bottom: 1.5pt solid var(--line); padding-bottom: 2.5mm; margin-bottom: 7mm; }
.phead h2 { font-size: 17pt; letter-spacing: .04em; }
.phead h2 em { color: var(--faint); font-style: normal; font-weight: 500; }
.pnum, .owner { font-size: 8.5pt; color: var(--faint); letter-spacing: .18em; font-weight: 500; }

/* ---- cover ---- */
.cover { justify-content: flex-start; padding-top: 26mm; }
.cover-rule { height: 3pt; width: 34mm; background: #E8590C; margin-bottom: 8mm; }
.cover .kicker { font-size: 9pt; color: var(--faint); letter-spacing: .3em; margin-bottom: 5mm; }
.cover h1 { font-size: 54pt; line-height: .95; letter-spacing: .01em; }
.cover h2 { font-size: 22pt; color: var(--dim); font-weight: 500; letter-spacing: .3em; margin-top: 2mm; }
.cover .blurb { font-size: 12pt; color: var(--dim); max-width: 118mm; margin-top: 9mm; line-height: 1.6; }
.cover-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7mm 6mm; margin-top: auto; margin-bottom: 8mm; }
.cover-grid figure { background: var(--panel); border: 1pt solid var(--line); border-radius: 2mm;
        padding: 5mm 3mm 3.5mm; text-align: center; }
.cover-grid img { width: 18mm; height: 18mm; }
.cover-grid figcaption { font-family: var(--display); font-size: 9.5pt; text-transform: uppercase;
        letter-spacing: .1em; margin-top: 2.5mm; }
.cover-foot { font-size: 8.5pt; color: var(--faint); border-top: 1pt solid var(--line); padding-top: 3mm; }

/* ---- legend ---- */
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
.two-col h3 { font-size: 11pt; color: #E8590C; letter-spacing: .12em; margin-bottom: 3mm; }
.two-col h3 + * { margin-bottom: 8mm; }
.defs dt { font-family: var(--display); font-size: 10pt; text-transform: uppercase; letter-spacing: .08em; margin-top: 3.5mm; }
.defs dd { color: var(--dim); font-size: 9.5pt; }
.roles { list-style: none; }
.roles li { border-left: 2pt solid var(--line); padding: 1mm 0 1mm 4mm; margin-bottom: 3mm; }
.roles b { font-family: var(--display); text-transform: uppercase; letter-spacing: .08em; display: block; font-size: 10pt; }
.roles span { color: var(--dim); font-size: 9.5pt; }
.callout { background: var(--panel); border-left: 2.5pt solid #E8590C; padding: 4mm 5mm;
        font-size: 9.5pt; color: var(--dim); margin-top: 4mm; }
.callout b { color: var(--ink); }

/* ---- chassis ---- */
.chassis-hero { display: grid; grid-template-columns: 46mm 1fr; gap: 8mm; align-items: center; margin-bottom: 8mm; }
.carshot { width: 46mm; filter: brightness(1.25) contrast(1.05); }
.theme { font-family: var(--display); font-size: 14pt; letter-spacing: .04em; color: #E8590C; margin-bottom: 3mm; }
.body { color: var(--dim); font-size: 10.5pt; }
.ratings { list-style: none; margin-bottom: 7mm; }
.ratings li, .bars li { display: grid; grid-template-columns: 24mm 1fr 10mm auto; align-items: center;
        gap: 3mm; padding: 1.6mm 0; border-bottom: 1pt solid var(--line); }
.bl { font-size: 8.5pt; color: var(--dim); letter-spacing: .14em; font-weight: 500; }
.bt { height: 3.4mm; background: #1D2430; border-radius: 1pt; overflow: hidden; }
.bt i { display: block; height: 100%; background: var(--acc, #E8590C); }
.bv { font-family: var(--display); font-size: 11pt; text-align: right; }
.bn { font-size: 8.5pt; color: var(--faint); text-align: right; min-width: 40mm; }
.matchup { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-bottom: 8mm; }
.matchup p { background: var(--panel); padding: 4mm; font-size: 9.5pt; color: var(--dim); border-radius: 1.5mm; }
.matchup b { display: block; font-family: var(--display); text-transform: uppercase; letter-spacing: .12em;
        font-size: 9pt; color: var(--ink); margin-bottom: 1mm; }
.kit-head { font-size: 11pt; color: var(--faint); letter-spacing: .18em; margin-bottom: 3mm; }
.kit-head em { font-style: normal; font-weight: 500; letter-spacing: .1em; text-transform: none; }
.kit { list-style: none; display: grid; gap: 4mm; }
.kit li { display: grid; grid-template-columns: 16mm 1fr 62mm; align-items: center; gap: 5mm;
        background: var(--panel); border-left: 2.5pt solid var(--acc); padding: 4.5mm 5mm; border-radius: 0 1.5mm 1.5mm 0; }
.kstats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; text-align: right; }
.kstats dt { font-family: var(--display); font-size: 7pt; text-transform: uppercase;
        letter-spacing: .1em; color: var(--faint); }
.kstats dd { font-family: var(--display); font-size: 12pt; color: var(--ink); }
.kit img { width: 14mm; height: 14mm; }
.kit b { font-family: var(--display); font-size: 13pt; text-transform: uppercase; letter-spacing: .06em;
        color: var(--acc); display: block; }
.kit span { font-size: 8.5pt; color: var(--faint); letter-spacing: .1em; text-transform: uppercase; }
.kit p { font-size: 10pt; color: var(--dim); font-style: italic; }

/* ---- weapon ---- */
.wpn { display: flex; flex-direction: column; height: 100%; }
.hero { display: grid; grid-template-columns: 30mm 1fr; gap: 7mm; align-items: center; margin-bottom: 6mm; }
.hero img { width: 30mm; height: 30mm; }
.hero h1 { font-size: 34pt; line-height: 1; color: var(--acc); letter-spacing: .02em; }
.shape { font-size: 8.5pt; color: var(--faint); letter-spacing: .16em; text-transform: uppercase; margin-top: 2mm; }
.tagline { font-size: 13pt; color: var(--dim); font-style: italic; margin-top: 3mm; }
.bars { list-style: none; margin-bottom: 6mm; }
.bars li { grid-template-columns: 24mm 1fr auto; }
.wbody { display: grid; grid-template-columns: 1fr 68mm; gap: 8mm; flex: 1; }
.prose p { font-size: 10.5pt; color: var(--dim); margin-bottom: 4mm; }
.tip { background: var(--panel); border-left: 2.5pt solid var(--acc); padding: 4.5mm 5mm; margin-top: 2mm; }
.tip b { font-family: var(--display); text-transform: uppercase; letter-spacing: .14em; font-size: 9pt;
        color: var(--acc); display: block; margin-bottom: 1.5mm; }
.tip p { margin: 0; font-size: 10pt; color: var(--ink); }
.specs { background: var(--panel); border: 1pt solid var(--line); border-radius: 2mm; padding: 3.5mm 5mm; align-self: start; }
.spec { display: grid; grid-template-columns: 25mm 1fr; gap: 2mm; padding: 1.6mm 0; border-bottom: 1pt solid var(--line); }
.spec:last-child { border-bottom: 0; }
.spec dt { font-family: var(--display); font-size: 8.5pt; text-transform: uppercase; letter-spacing: .1em;
        color: var(--faint); padding-top: .6mm; }
.spec dd { font-family: var(--display); font-size: 11pt; text-align: right; letter-spacing: .02em; white-space: nowrap; }
.spec dd span { display: block; font-family: var(--body); font-size: 8pt; font-weight: 400; color: var(--faint);
        text-transform: none; letter-spacing: 0; line-height: 1.35; white-space: normal; }
.wfoot { margin-top: 6mm; padding-top: 3mm; border-top: 1pt solid var(--line); font-size: 8.5pt;
        color: var(--faint); display: flex; align-items: center; gap: 3mm; }
.swatch { width: 6mm; height: 6mm; border-radius: 1pt; display: inline-block; flex: none; }

/* ---- counter triangle ---- */
.triangle { margin-top: auto; border-top: 1pt solid var(--line); padding-top: 6mm; }
.triangle h3 { font-size: 11pt; color: #E8590C; letter-spacing: .12em; margin-bottom: 4mm; }
.tri { display: flex; align-items: center; gap: 4mm; }
.tri > div { flex: 1; background: var(--panel); border: 1pt solid var(--line); border-radius: 2mm;
        padding: 4mm 4mm 4.5mm; text-align: center; }
.tri img { width: 26mm; filter: brightness(1.25); margin-bottom: 2mm; }
.tri b { font-family: var(--display); font-size: 12pt; text-transform: uppercase; letter-spacing: .08em; display: block; }
.tri span { font-size: 8.5pt; color: var(--faint); text-transform: uppercase; letter-spacing: .14em; }
.tri p { font-size: 9pt; color: var(--dim); font-style: italic; margin-top: 2.5mm; }
.arrow { color: #E8590C; font-size: 12pt; font-style: normal; flex: none; }

/* ---- compare ---- */
.sub { font-family: var(--display); font-size: 11pt; color: #E8590C; letter-spacing: .12em;
        text-transform: uppercase; margin: 6mm 0 3mm; }
.grid th span { display: block; font-family: var(--body); font-size: 7.5pt; letter-spacing: 0;
        text-transform: none; color: var(--faint); font-weight: 400; }
.tight td { padding: 1.7mm 2mm; }
.grid { width: 100%; border-collapse: collapse; font-size: 9pt; }
.grid th { font-size: 8pt; color: var(--faint); letter-spacing: .1em; text-align: left;
        border-bottom: 1.5pt solid var(--line); padding: 0 2mm 2mm; font-weight: 500; }
.grid td { padding: 2.4mm 2mm; border-bottom: 1pt solid var(--line); color: var(--dim); }
.grid .n { text-align: right; font-family: var(--display); font-size: 10pt; color: var(--ink); }
.grid .nm { color: var(--ink); font-family: var(--display); text-transform: uppercase;
        letter-spacing: .05em; font-size: 10pt; white-space: nowrap; }
.dot { width: 2.6mm; height: 2.6mm; border-radius: 50%; display: inline-block; margin-right: 2mm; }
.note { font-size: 8.5pt; color: var(--faint); margin-top: 4mm; }
.rank { list-style: none; }
.rank li { display: grid; grid-template-columns: 30mm 1fr 12mm 26mm; align-items: center; gap: 3mm;
        padding: 0.9mm 0; }
.rn { font-family: var(--display); font-size: 9.5pt; text-transform: uppercase; letter-spacing: .06em; }
.rt { height: 3.2mm; background: #1D2430; border-radius: 1pt; overflow: hidden; }
.rt i { display: block; height: 100%; }
.rv { font-family: var(--display); font-size: 11pt; text-align: right; }
.rp { font-size: 8.5pt; color: var(--faint); text-align: right; }
.palette { margin-top: auto; border-top: 1pt solid var(--line); padding-top: 5mm; }
.ceilings .sub:first-of-type { margin-top: 0; }
.palette h3 { font-size: 11pt; color: #E8590C; letter-spacing: .12em; margin-bottom: 3.5mm; }
.swatches { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; }
.swatches > div > b { font-family: var(--display); font-size: 9pt; text-transform: uppercase;
        letter-spacing: .12em; color: var(--faint); display: block; margin-bottom: 2mm; }
.swatches span { display: flex; align-items: center; gap: 2.5mm; font-size: 9pt; color: var(--dim); padding: .5mm 0; }
.swatches i { width: 4mm; height: 4mm; border-radius: 1pt; flex: none; }

/* ---- on a screen: the same pages, stacked as a scrolling document ---- */
.topbar { display: none; }
@media screen {
  body { background: #07090D; padding-bottom: 12mm; }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 6mm;
        position: sticky; top: 0; z-index: 5; padding: 3.5mm 6mm;
        background: rgba(13, 16, 22, .94); border-bottom: 1pt solid var(--line);
        backdrop-filter: blur(6px); }
  .topbar b { font-family: var(--display); font-size: 11pt; text-transform: uppercase;
        letter-spacing: .14em; font-weight: 700; }
  .topbar b span { color: var(--faint); font-weight: 500; }
  .topbar nav { display: flex; gap: 3mm; }
  .topbar a, .topbar button { font-family: var(--display); font-size: 9.5pt; text-transform: uppercase;
        letter-spacing: .12em; color: var(--ink); text-decoration: none; cursor: pointer;
        background: transparent; border: 1pt solid var(--line); border-radius: 1.5mm;
        padding: 2mm 4mm; }
  .topbar a:hover, .topbar button:hover { border-color: #E8590C; color: #E8590C; }
  .page { margin: 6mm auto; box-shadow: 0 2mm 9mm rgba(0, 0, 0, .55); border-radius: 1.5mm; }
  /* Pages are a fixed A4 wide, so a narrow window scales the whole document down rather than
     scrolling sideways through it. */
  @media (max-width: 880px) { body { zoom: .58; } }
  @media (max-width: 520px) { body { zoom: .40; } }
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

/** The whole book, as one self-contained page. */
function buildDocument(fonts) {
  // Chassis first, then ITS OWN three weapons, then the next chassis. The book reads as three
  // self-contained kits rather than as a roster followed by a separate appendix of guns — which is
  // also the order a player meets them in, since picking a car picks all three slots at once.
  // `WEAPONS` is already built in chassis/slot order, so the "01 / 09" counters stay sequential.
  const pages = [
    cover(),
    legend(),
    ...CAR_IDS.flatMap((carId) => [
      chassisPage(carId),
      ...slotsOf(carId).map((id) => weaponPage(byId[id], WEAPONS.indexOf(byId[id]))),
    ]),
    compare(),
    ceilings(),
  ].join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="${STAMP_META_NAME}" content="${balanceStamp()}">
<title>${esc(MANUAL_META.title)} — ${esc(MANUAL_META.subtitle)}</title>
<style>${css(fonts)}</style></head><body>${topbar()}\n${pages}</body></html>`;
}

async function main() {
  mkdirSync(dirname(OUT_WEB_HTML), { recursive: true });
  writeFileSync(OUT_WEB_HTML, buildDocument(await fontCss()));
  const kb = Math.round(statSync(OUT_WEB_HTML).size / 1024);
  console.log(
    `[manual] ${WEAPONS.length} weapons, ${CAR_IDS.length} chassis, stamp ${balanceStamp()} -> ` +
      `${OUT_WEB_HTML} (${kb} KB)`,
  );
}

// Importable for its exports without building anything: `manual-page.test.mjs` needs `balanceStamp`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
