/**
 * Every number the guide's PROSE quotes, derived from the live tables.
 *
 * `cars-and-weapons-copy.mjs` opens by saying "Numbers never live here". Its stat cells honoured
 * that from the start; its sentences did not, and three of them had gone wrong by 2026-09-04 —
 * predator claiming a 300 ms recharge against a table reading 1000, afterburner claiming five damage
 * ticks a second against a `damageFrequencyMs` of 500, and a chassis note citing a 286 that appears
 * nowhere on the page. `balanceStamp` cannot catch that class of error: it hashes the prose, so it
 * only ever asks "was the page rebuilt from this text", never "is this text true".
 *
 * So the prose writes `{predator.acquireRadius}` and this file answers it. A retune now rewrites the
 * sentence exactly as it already rewrote the cell beside it.
 *
 * **Adding a fact:** put it here, derived — never typed. If you find yourself writing a literal,
 * that is the bug this file exists to prevent. `manual-facts.test.mjs` fails on a token the prose
 * never uses, so a fact and its sentence are added and deleted together.
 */
import {
  CAR_TABLE,
  STATUS_TABLE,
  WEAPON_TABLE,
  slotsOf,
  statusDefOf,
} from "@motor-combat-moba/shared";

/** Trims float noise without printing a misleading `2.4000000000000004`. */
const round = (n, dp = 2) => Number(n.toFixed(dp));

/** How long a status this weapon applies to its opponents lasts, in seconds. */
function appliedSeconds(weaponId, statusId) {
  const applied = (WEAPON_TABLE[weaponId].applies ?? []).find((a) => a.statusId === statusId);
  if (!applied) throw new Error(`${weaponId} no longer applies ${statusId}`);
  return round(applied.durationMs / 1000);
}

/** A status's multiplier expressed as the percentage the guide talks in. */
function percentOff(statusId, channel) {
  const value = statusDefOf(statusId).modifiers[channel];
  if (typeof value !== "number") throw new Error(`${statusId} has no ${channel} modifier`);
  return round(Math.abs(1 - value) * 100, 1);
}

/**
 * The flat token map the prose is rendered against. Keys are `weapon.fact`; every value is a number
 * computed from a table, so none of them can drift from what the stat cells print.
 */
export function manualFacts() {
  const w = WEAPON_TABLE;

  const predator = w.predator;
  const afterburner = w.afterburner;
  const magmablast = w.magmablast;
  const pepperbox = w.pepperbox;
  const lance = w.lance;
  const thumper = w.thumper;
  const roadblock = w.roadblock;
  const wildcharge = w.wildcharge;
  const thunderclap = w.thunderclap;

  const carIds = Object.keys(CAR_TABLE);

  return {
    // --- the roster itself ------------------------------------------------------------------
    // Derived exactly as the build derives them, so the cover blurb cannot outlive a chassis or a
    // loadout change. CARRIED weapons, not table rows: `tremor` has a row nobody fires.
    "roster.weapons": carIds.flatMap((carId) => slotsOf(carId)).length,
    "roster.chassis": carIds.length,
    // Every chassis carries the same number of slots, so this is one number rather than three.
    "roster.slotsPerCar": slotsOf(carIds[0]).length,

    // --- predator ---------------------------------------------------------------------------
    "predator.acquireRadius": predator.homing.acquireRadius,
    "predator.lifeSec": round(predator.lifetimeMs / 1000),
    "predator.cooldownSec": round(predator.cooldownMs / 1000),
    // A shot fired now expires exactly as the (lifetime/cooldown)-th press lands, so this is a
    // floor rather than a ceil: at 2000/1000 that is two alive, not three.
    "predator.inFlight": Math.floor(predator.lifetimeMs / predator.cooldownMs),

    // --- thunderclap ------------------------------------------------------------------------
    "thunderclap.dashUnits": thunderclap.range,
    "thunderclap.stunSec": appliedSeconds("thunderclap", "stunned"),

    // --- afterburner ------------------------------------------------------------------------
    "afterburner.ticksPerSec": round(1000 / afterburner.damageFrequencyMs),
    // Growth plus linger: the cones exist while the beam extends AND for its authored lifetime.
    "afterburner.burnSec": round(
      (afterburner.lifetimeMs + (afterburner.range / afterburner.speed) * 1000) / 1000,
    ),

    // --- magmablast -------------------------------------------------------------------------
    "magmablast.blastRadius": magmablast.explosion.radius,
    "magmablast.corrodeSec": round(
      magmablast.explosion.applies.find((a) => a.statusId === "corroded").durationMs / 1000,
    ),
    "magmablast.corrodePct": percentOff("corroded", "damageTaken"),

    // --- pepperbox --------------------------------------------------------------------------
    "pepperbox.muzzleCount": pepperbox.muzzles.length,
    "pepperbox.totalDarts": pepperbox.muzzles.length * pepperbox.pellets.pelletsPerVolley,
    "pepperbox.dartsPerFan": pepperbox.pellets.pelletsPerVolley,
    "pepperbox.spreadDeg": pepperbox.pellets.spreadAngleDeg,
    "pepperbox.muzzleSpacingDeg": round(360 / pepperbox.muzzles.length),
    // The page's own "full connect" figure: base damage before the chassis attack scale, which is
    // what the stat cell beside this prose prints.
    "pepperbox.fanDamage": pepperbox.damage * pepperbox.pellets.pelletsPerVolley,

    // --- lance ------------------------------------------------------------------------------
    "lance.windupMs": lance.startUpMs,
    // Same derivation as `afterburner.ticksPerSec`, and the same number: the 2026-09-04 retune put
    // both beams on one cadence, so the two sentences quoting this stay in step by construction.
    "lance.ticksPerSec": round(1000 / lance.damageFrequencyMs),
    "lance.lingerSec": round(lance.lifetimeMs / 1000),
    "lance.recoverySec": round(lance.recoveryMs / 1000),
    // Wind-up, then growth, then linger — everything before recovery starts.
    "lance.committedSec": round(
      (lance.startUpMs + (lance.range / lance.speed) * 1000 + lance.lifetimeMs) / 1000,
    ),

    // --- thumper ----------------------------------------------------------------------------
    "thumper.flightSec": round(thumper.lifetimeMs / 1000),
    "thumper.slowPct": percentOff("spiked", "topSpeed"),
    "thumper.spikeSec": appliedSeconds("thumper", "spiked"),

    // --- roadblock --------------------------------------------------------------------------
    "roadblock.widthUnits": roadblock.hitbox.radiusAcross * 2,
    // `pierce` counts the opponents passed through AFTER the first, so the total caught is one more.
    "roadblock.maxCars": roadblock.pierce + 1,
    "roadblock.stunSec": appliedSeconds("roadblock", "stunned"),

    // --- wildcharge -------------------------------------------------------------------------
    "wildcharge.armorSec": round(
      wildcharge.applies.find((a) => a.statusId === "fortified").durationMs / 1000,
    ),
    "wildcharge.armorPct": percentOff("fortified", "damageTaken"),
    "wildcharge.slamDamage": wildcharge.damage,
  };
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty",
];
const TENS = { 30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety", 100: "a hundred" };

/**
 * A number spelled out, for prose that reads better in words ("two-second life").
 *
 * Deliberately NARROW: whole numbers to twenty, then round tens. Anything else throws rather than
 * guessing, which turns "this value grew past what the sentence can spell" into a failed build
 * instead of a sentence reading "two point four-second life".
 */
export function inWords(value, token) {
  if (Number.isInteger(value) && value >= 0 && value <= 20) return ONES[value];
  if (Number.isInteger(value) && TENS[value]) return TENS[value];
  throw new Error(
    `manual copy asked for {${token}:words}, but ${value} cannot be spelled out. ` +
      `Use {${token}} for the digits, or rewrite the sentence.`,
  );
}

/** `{token}` and `{token:words}`, the two forms the prose may ask for. */
const PLACEHOLDER = /\{([a-zA-Z][\w.]*)(?::(words))?\}/g;

/** One prose string with its placeholders filled in. Throws on a token this file does not define. */
export function renderCopyString(text, facts) {
  return text.replace(PLACEHOLDER, (_match, token, form) => {
    if (!(token in facts)) {
      throw new Error(
        `manual copy references {${token}}, which manual-facts.mjs does not define. ` +
          `Add it there — derived from the tables, never typed.`,
      );
    }
    const value = facts[token];
    return form === "words" ? inWords(value, token) : String(value);
  });
}

/** Every string in a copy tree, rendered. Structure and key order are preserved exactly. */
export function renderCopy(node, facts) {
  if (typeof node === "string") return renderCopyString(node, facts);
  if (Array.isArray(node)) return node.map((item) => renderCopy(item, facts));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, renderCopy(v, facts)]));
  }
  return node;
}

/** Which tokens a copy tree actually uses, so an unused fact can be caught and deleted. */
export function tokensUsedIn(node, found = new Set()) {
  if (typeof node === "string") {
    for (const m of node.matchAll(PLACEHOLDER)) found.add(m[1]);
  } else if (Array.isArray(node)) {
    for (const item of node) tokensUsedIn(item, found);
  } else if (node && typeof node === "object") {
    for (const v of Object.values(node)) tokensUsedIn(v, found);
  }
  return found;
}

export { STATUS_TABLE };
