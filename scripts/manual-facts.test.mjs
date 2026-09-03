/**
 * Guards the rule `cars-and-weapons-copy.mjs` states and used to break: numbers never live in the
 * prose.
 *
 * `balanceStamp` cannot do this job. It hashes the copy file, so it only ever asks "was the page
 * rebuilt from this text" — never "is this text true". Three sentences had gone stale underneath it
 * by 2026-09-04, one of them contradicting a generated cell two lines above it on the same page.
 *
 * These tests attack the two ways the discipline can fail: a placeholder that does not resolve
 * (caught at build time, asserted here so the failure is legible), and a figure typed as a literal
 * instead of a token (which builds fine and rots silently — the actual historical failure).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CHASSIS_COPY, MANUAL_META, SLOT_ROLES, WEAPON_COPY } from "./cars-and-weapons-copy.mjs";
import { inWords, manualFacts, renderCopy, tokensUsedIn } from "./manual-facts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COPY_SRC = readFileSync(resolve(ROOT, "scripts/cars-and-weapons-copy.mjs"), "utf8");
const RAW = { MANUAL_META, CHASSIS_COPY, SLOT_ROLES, WEAPON_COPY };

/** Just the prose: the quoted string literals, with `//` comment lines dropped. */
function proseOnly() {
  return COPY_SRC.split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .match(/"(?:[^"\\]|\\.)*"/g)
    .join("\n");
}

describe("manual copy facts", () => {
  it("resolves every placeholder the prose uses", () => {
    // `renderCopy` throws on an unknown token, so this is the build failing early and legibly
    // rather than a literal "{predator.lifeSec}" reaching a player's screen.
    assert.doesNotThrow(() => renderCopy(RAW, manualFacts()));
  });

  it("leaves no placeholder unresolved in the rendered prose", () => {
    const rendered = JSON.stringify(renderCopy(RAW, manualFacts()));
    const leftovers = rendered.match(/\{[a-zA-Z][\w.]*(?::words)?\}/g) ?? [];
    assert.deepEqual(leftovers, [], `unresolved placeholders: ${leftovers.join(", ")}`);
  });

  it("defines no fact the prose never uses", () => {
    // A fact nobody quotes is a number with no reader, and it will quietly stop matching the tables
    // it claims to track. Deleting the sentence must delete the fact.
    const used = tokensUsedIn(RAW);
    const unused = Object.keys(manualFacts()).filter((token) => !used.has(token));
    assert.deepEqual(unused, [], `facts defined but never quoted: ${unused.join(", ")}`);
  });

  /**
   * The real guard, and the one that would have caught the historical bug at the moment it was
   * written rather than however many retunes later.
   *
   * If a fact's CURRENT value appears as a literal in the prose, someone typed the number instead of
   * the token. That copy is correct today and silently wrong after the next retune — which is
   * exactly how predator came to claim a 300 ms recharge against a table reading 1000.
   */
  it("has no fact's value typed as digits in the prose", () => {
    const prose = proseOnly();
    const offenders = [];
    for (const [token, value] of Object.entries(manualFacts())) {
      // As a whole number rather than as a fragment of a longer one: `2` must not match the `2`
      // inside `2.2`, and `12` must not match the `12` inside `120`.
      const digits = new RegExp(`(?<![\\d.])${String(value).replace(".", "\\.")}(?![\\d.])`);
      if (digits.test(prose)) offenders.push(`${token} (${value}) is typed as digits`);
    }
    assert.deepEqual(
      offenders,
      [],
      `Write the token, not the number — see manual-facts.mjs:\n  ${offenders.join("\n  ")}`,
    );
  });

  /**
   * Spelled-out numbers, caught only where they QUANTIFY something.
   *
   * A blanket ban on number-words is unworkable — "one press", "two of its three weapons" and "each
   * one" are ordinary English and would all trip it. What is never ordinary English is a number word
   * sitting directly on a unit: "two seconds", "120 units", "five cars". That is a measurement, and
   * a measurement belongs in a token.
   *
   * The units listed are the ones the guide actually quotes. Adding a sentence that measures
   * something new means adding its unit here, which is the point: the list is the inventory of what
   * this file is watching.
   */
  it("has no spelled-out measurement in the prose", () => {
    const NUMBER_WORDS =
      "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
    // `cars?` is deliberately NOT here. It is the one unit that reads as ordinary English as often
    // as it reads as a measurement — "a dash that clips two cars in the same tick" and "hits more
    // than one car at once" are both prose, not figures, and neither belongs in a token. The cost is
    // that a hand-typed "five cars" would slip through; `roadblock.maxCars` is already a token, so
    // that costs nothing today, and a false alarm on every honest sentence would cost more.
    const UNITS =
      "seconds?|milliseconds?|minutes?|units?|darts?|degrees?|weapons?|chassis|pellets?|cones?|waves?|muzzles?";
    // `[- ]` so both "two-second life" and "two seconds" are caught.
    const measurement = new RegExp(`\\b(${NUMBER_WORDS})[- ](${UNITS})\\b`, "gi");
    const found = [...proseOnly().matchAll(measurement)].map((m) => m[0]);
    assert.deepEqual(
      found,
      [],
      `Spelled-out measurements belong in manual-facts.mjs as {token:words}:\n  ${found.join("\n  ")}`,
    );
  });

  it("spells small whole numbers and refuses the rest rather than guessing", () => {
    assert.equal(inWords(2, "t"), "two");
    assert.equal(inWords(12, "t"), "twelve");
    assert.equal(inWords(40, "t"), "forty");
    // A value that outgrew what the sentence can spell must fail the build, not render
    // "two point four-second life".
    assert.throws(() => inWords(2.4, "lance.committedSec"), /cannot be spelled out/);
    assert.throws(() => inWords(135, "pepperbox.fanDamage"), /cannot be spelled out/);
  });

  it("derives every fact from the tables, so a retune rewrites the sentence", () => {
    // Not a value check -- the point is that these are computed, and the surest evidence of that is
    // that they track a table nobody edited by hand here. Spot-checked against the live rows.
    const facts = manualFacts();
    assert.equal(facts["predator.inFlight"], 2);
    assert.equal(facts["afterburner.ticksPerSec"], 2);
    assert.equal(facts["roadblock.maxCars"], 5);
    assert.equal(facts["pepperbox.totalDarts"], 12);
    assert.equal(facts["wildcharge.armorPct"], 30);
  });
});
