import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  CAR_TABLE,
  DRIVE_CONFIG,
  RAM_CONFIG,
  STATUS_TABLE,
  TICK_RATE_HZ,
  driveOf,
} from "@motor-combat-moba/shared";

/**
 * The staleness guard on `docs/turn-tuning.md`.
 *
 * That page tabulates the roster's turn numbers by hand — the authored ratings, the global knobs,
 * and every value derived from them — and it is the page someone reads before a tuning edit. It has
 * the failure mode the cars-and-weapons guide has, without the defence: nothing generates it, so a
 * config edit leaves it confidently wrong and every other suite stays green. That is not
 * hypothetical. On 2026-08-31, Mirage's `handling` went 50 -> 60 and this page kept claiming 6.3
 * rad/s and a 91.4 u radius while `config.test.ts` and `manual-page.test.mjs` both failed loudly
 * about the same edit. This file is what makes the third one fail too.
 *
 * **It checks the values, not a fingerprint.** `manual-page.test.mjs` can hash its inputs because
 * its page is generated: a matching stamp proves the builder re-ran. Here there is no builder, so a
 * stamp would only ever prove someone typed a new stamp. Reading the numbers back out of the
 * markdown and recomputing them from shared is the only assertion worth making — and it is the
 * stronger one, because it catches a hand-edit that updated four cells and missed the fifth.
 *
 * **Precision comes from the cell, never from this file.** Each cell is compared against the
 * computed value rounded to however many decimals that cell displays, so the page stays free to
 * print 6.84 in one row and 0.1704 in another. Pinning precision here would mean this test dictating
 * the page's formatting, and every rounding change would land as a test edit.
 *
 * What it deliberately does NOT check: numbers in prose. The page argues from figures in sentences —
 * how far the Bullseye/Mirage radius inversion narrowed, what raising `turnRatePerRating` to 0.072
 * would do to Bastion. Those go stale too, and no table parser will ever see them. They stay a
 * review-time responsibility; see the page's own "Keeping this page honest" section.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC = path.join(ROOT, "docs/turn-tuning.md");
const REBUILD = "Update the tables in docs/turn-tuning.md — see its \"Keeping this page honest\" section.";

/** Every contiguous run of `|`-prefixed lines in the document, as arrays of trimmed cells. */
function tablesIn(markdown) {
  const tables = [];
  let current = null;
  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("|")) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (current === null) current = [];
      current.push(cells);
    } else if (current !== null) {
      tables.push(current);
      current = null;
    }
  }
  if (current !== null) tables.push(current);
  // Drop the `|---|---|` separator row every markdown table carries under its header.
  return tables.map((rows) => rows.filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c))));
}

/**
 * The one table in the document whose header row satisfies `matches`.
 *
 * Deliberately fails on two matches as loudly as on none: a second table with the same shape means
 * the page grew a section this file is silently not checking, which is the failure this whole suite
 * exists to prevent.
 */
function tableWhere(tables, matches, what) {
  const found = tables.filter((rows) => rows.length > 0 && matches(rows[0]));
  assert.equal(found.length, 1, `expected exactly one ${what} table in docs/turn-tuning.md, found ${found.length}`);
  const [table] = found;
  return { header: table[0], rows: table.slice(1) };
}

/** The first number in a cell, and how many decimals it was printed to. `**8.028 rad/s**` -> 8.028, 3. */
function cellNumber(cell, where) {
  const match = /-?\d+(?:\.\d+)?/.exec(cell);
  assert.ok(match, `${where}: no number in cell ${JSON.stringify(cell)}. ${REBUILD}`);
  const [text] = match;
  const dot = text.indexOf(".");
  return { value: Number(text), decimals: dot === -1 ? 0 : text.length - dot - 1 };
}

/** Assert a cell prints `expected`, at whatever precision the cell itself chose. */
function assertCell(cell, expected, where) {
  const { value, decimals } = cellNumber(cell, where);
  const rounded = Number(expected.toFixed(decimals));
  assert.equal(
    value,
    rounded,
    `${where}: page says ${value}, config gives ${rounded}` +
      (decimals === 0 ? "" : ` (at ${decimals}dp; exact ${expected})`) +
      `. ${REBUILD}`,
  );
}

/** The label a row is keyed by, stripped of markdown emphasis and code fencing. */
const labelOf = (cells) => cells[0].replace(/[`*]/g, "").trim();

/**
 * Which column holds which chassis, read from the header rather than assumed.
 *
 * This is also where a fourth chassis is caught: the columns must be exactly the roster, so adding a
 * car without adding its column fails here rather than going unnoticed in a page that then describes
 * two thirds of the game.
 */
function carColumns(header, what) {
  const byName = new Map(Object.values(CAR_TABLE).map((car) => [car.name, car.id]));
  const columns = new Map();
  header.forEach((cell, index) => {
    const id = byName.get(cell.replace(/[`*]/g, "").trim());
    if (id !== undefined) columns.set(id, index);
  });
  assert.deepEqual(
    [...columns.keys()].sort(),
    Object.keys(CAR_TABLE).sort(),
    `the ${what} table's chassis columns do not match CAR_TABLE. ${REBUILD}`,
  );
  return columns;
}

const doc = fs.readFileSync(DOC, "utf8");
const tables = tablesIn(doc);
const deg = (radians) => (radians * 180) / Math.PI;

describe("docs/turn-tuning.md", () => {
  it("prints the per-car ratings CAR_TABLE actually holds", () => {
    const { header, rows } = tableWhere(tables, (h) => labelOf(h) === "Rating", "per-car ratings");
    const columns = carColumns(header, "per-car ratings");
    const expected = {
      "handling (turn rate)": (id) => CAR_TABLE[id].handling,
      "speed (the other half of radius)": (id) => CAR_TABLE[id].speed,
    };
    assert.deepEqual(rows.map(labelOf), Object.keys(expected), `unexpected rows in the per-car table. ${REBUILD}`);
    for (const cells of rows) {
      for (const [id, column] of columns) {
        assertCell(cells[column], expected[labelOf(cells)](id), `per-car "${labelOf(cells)}" / ${id}`);
      }
    }
  });

  /**
   * The global table is where a knob that moves the whole roster is written down, so every row is
   * pinned to its own config field. `spinMaxRate` and `authorityFloor` are here rather than in a ram
   * doc because a reader tuning turning needs to know a ram can overrule them.
   */
  it("prints the global knobs at their configured values", () => {
    const { rows } = tableWhere(
      tables,
      (h) => labelOf(h) === "Knob" && h.some((c) => labelOf([c]) === "Where"),
      "global knobs",
    );
    const expected = {
      baseTurnRate: DRIVE_CONFIG.baseTurnRate,
      turnRatePerRating: DRIVE_CONFIG.turnRatePerRating,
      stopTurnRatio: DRIVE_CONFIG.stopTurnRatio,
      "overheated turnRate": STATUS_TABLE.overheated.modifiers.turnRate,
      authorityFloor: RAM_CONFIG.authorityFloor,
      spinMaxRate: RAM_CONFIG.spinMaxRate,
      baseMaxSpeed: DRIVE_CONFIG.baseMaxSpeed,
      speedPerRating: DRIVE_CONFIG.speedPerRating,
      reverseSpeedRatio: DRIVE_CONFIG.reverseSpeedRatio,
    };
    assert.deepEqual(rows.map(labelOf), Object.keys(expected), `unexpected rows in the global table. ${REBUILD}`);
    for (const cells of rows) {
      assertCell(cells[2], expected[labelOf(cells)], `global "${labelOf(cells)}"`);
    }
  });

  /**
   * Rows are matched in order, not by label, because the derived table repeats "in degrees" under
   * both rate rows. Asserting the full ordered label list is what makes an inserted, dropped or
   * reordered row fail here instead of quietly going unchecked.
   */
  it("prints derived values that shared actually computes", () => {
    const { header, rows } = tableWhere(
      tables,
      (h) => labelOf(h) === "Stat" && h.some((c) => labelOf([c]) === "Formula"),
      "derived values",
    );
    const columns = carColumns(header, "derived values");

    const overheated = STATUS_TABLE.overheated.modifiers.turnRate;
    const floor = RAM_CONFIG.authorityFloor;
    const spec = [
      ["Turn rate", (d) => d.turnRate],
      ["— in degrees", (d) => deg(d.turnRate)],
      ["— per tick", (d) => d.turnRate / TICK_RATE_HZ],
      ["— degrees per tick", (d) => deg(d.turnRate) / TICK_RATE_HZ],
      ["Turn rate at rest", (d) => d.turnRateAtStop],
      ["— in degrees", (d) => deg(d.turnRateAtStop)],
      ["Top speed", (d) => d.maxSpeed],
      ["Reverse top speed", (d) => d.reverseMaxSpeed],
      ["Turn radius", (d) => d.maxSpeed / d.turnRate],
      ["Reverse turn radius", (d) => d.reverseMaxSpeed / d.turnRate],
      ["180° while moving", (d) => Math.PI / d.turnRate],
      ["360° while moving", (d) => (2 * Math.PI) / d.turnRate],
      ["180° from standstill", (d) => Math.PI / d.turnRateAtStop],
      ["Rate while overheated", (d) => d.turnRate * overheated],
      ["Rate at ram authority floor", (d) => d.turnRate * floor],
    ];
    assert.deepEqual(
      rows.map(labelOf),
      spec.map(([label]) => label),
      `the derived table's rows changed. ${REBUILD}`,
    );

    rows.forEach((cells, index) => {
      const [label, compute] = spec[index];
      for (const [id, column] of columns) {
        assertCell(cells[column], compute(driveOf(id)), `derived "${label}" / ${id}`);
      }
    });
  });

  /**
   * The last two derived rows restate a multiplier in their formula column. Nothing typed ties that
   * text to the config it quotes, so it is the cell most able to contradict the row it labels — the
   * page would go on printing "x 0.65" beside values correctly recomputed at 0.7.
   */
  it("quotes the two turn multipliers at their configured values", () => {
    const { rows } = tableWhere(
      tables,
      (h) => labelOf(h) === "Stat" && h.some((c) => labelOf([c]) === "Formula"),
      "derived values",
    );
    const formulaOf = (label) => rows.find((cells) => labelOf(cells) === label)?.[1];
    for (const [label, expected] of [
      ["Rate while overheated", STATUS_TABLE.overheated.modifiers.turnRate],
      ["Rate at ram authority floor", RAM_CONFIG.authorityFloor],
    ]) {
      const formula = formulaOf(label);
      assert.ok(formula, `the derived table has no "${label}" row. ${REBUILD}`);
      assertCell(formula, expected, `derived "${label}" formula`);
    }
  });
});
