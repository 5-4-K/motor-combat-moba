import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  CAR_TABLE,
  DRIVE_CONFIG,
  RAM_CONFIG,
  TICK_RATE_HZ,
  DEFAULT_GAME_MODE,
  driveOf,
  installMode,
  modeConfigOf,
  modifiersOf,
} from "@motor-combat-moba/shared";

// This doc-honesty check calls shared's config accessors directly, so it needs a mode installed the
// same way any other suite does since the shared package stopped bootstrapping the default mode at
// module load (MC12).
installMode(modeConfigOf(DEFAULT_GAME_MODE));

/**
 * The `grip` multiplier a reeling car ACTUALLY drives with — the authored `STATUS_TABLE.reeling`
 * value put through the same `modifiersOf` clamp `stepDrive` reads it through, rather than lifted raw
 * off the row. See the note on the derived table's spec list for why the difference matters.
 *
 * Was `turnRate` until the 2026-09-18 Unity ram port redefined `reeling`: it now carries no
 * `turnRate` or `accel` multiplier at all (control is gone outright, via flags), and the one
 * channel it still scales is `grip`.
 */
const reelingGrip = () =>
  modifiersOf([{ statusId: "reeling", startTick: 0, endsTick: 1, sourceSessionId: "" }], 0).grip;

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
   * The per-car direct-values table (drag rate, brake deceleration) joined `CAR_TABLE` on
   * 2026-09-06 alongside the heavy-car pass, and it's the one per-car table stages 2-5 will keep
   * touching. `coastHalfLifeSeconds` is gone — the Unity drive-model port (car-physics-port stage 1)
   * deleted the field outright, replacing proportional coast with the same `dragRate` that also sets
   * top speed and wind-up (`dragRateOf`, `config/car-config.ts`) — so its row is replaced with one
   * reading that derived rate instead. It doesn't feed a turn-rate or radius formula, so it can't
   * share the ratings table's row list (`turn-tuning-doc.test.mjs`'s own `deepEqual` on that list is
   * why the prior implementer put it in its own table rather than as a row there) — but nothing else
   * exempts it from being read back the same way every other table on this page is.
   */
  it("prints the per-car direct values CAR_TABLE actually holds", () => {
    const { header, rows } = tableWhere(tables, (h) => labelOf(h) === "Value", "per-car direct values");
    const columns = carColumns(header, "per-car direct values");
    const expected = {
      "dragRate — drag (1/s)": (id) => driveOf(id).dragRate,
      "brakeDecel — brake deceleration (u/s²)": (id) => CAR_TABLE[id].brakeDecel,
    };
    assert.deepEqual(
      rows.map(labelOf),
      Object.keys(expected),
      `unexpected rows in the per-car direct-values table. ${REBUILD}`,
    );
    for (const cells of rows) {
      for (const [id, column] of columns) {
        assertCell(cells[column], expected[labelOf(cells)](id), `direct value "${labelOf(cells)}" / ${id}`);
      }
    }
  });

  /**
   * The global table is where a knob that moves the whole roster is written down, so every row is
   * pinned to its own config field. `spinMaxRate` is here rather than in a ram doc because a reader
   * tuning turning needs to know a ram can overrule it. An `authorityFloor` row sat beside it until
   * stage 3b of the 2026-09-06 car-physics rework deleted that field: ram control loss is the
   * `reeling` status now, and its flags and `grip` multiplier live in `STATUS_TABLE`, not here.
   *
   * `stopTurnRatio` and `reverseSpeedRatio` are gone: the Unity drive-model port deleted both fields
   * outright (yaw is speed-independent, so there is no separate at-rest rate to ratio against; reverse
   * top speed is now the emergent `engineAccel × reverseAccelFactor / dragRate`, not an authored
   * ratio). `baseDrag`/`dragPerRating` are the one number that sets top speed, wind-up AND roll
   * (`dragRateOf`); `lateralGripRate` is the drift knob the old model had no equivalent for;
   * `reverseAccelFactor` and `reverseEpsilon` are the reverse-gear knobs the port introduced.
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
      spinMaxRate: RAM_CONFIG.spinMaxRate,
      reelingSpinDecayRate: RAM_CONFIG.reelingSpinDecayRate,
      baseMaxSpeed: DRIVE_CONFIG.baseMaxSpeed,
      speedPerRating: DRIVE_CONFIG.speedPerRating,
      baseDrag: DRIVE_CONFIG.baseDrag,
      dragPerRating: DRIVE_CONFIG.dragPerRating,
      lateralGripRate: DRIVE_CONFIG.lateralGripRate,
      reverseAccelFactor: DRIVE_CONFIG.reverseAccelFactor,
      reverseEpsilon: DRIVE_CONFIG.reverseEpsilon,
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

    // "Turn rate at rest" (and its degrees row) and "180° from standstill" are gone: `turnRateAtStop`
    // no longer exists on `ChassisDrive` (the Unity drive-model port, car-physics-port stage 1) —
    // yaw is speed-independent, so there is no separate at-rest rate for either row to scale.
    //
    // **"Rate while reeling" was restored under the drive-model port, then RETIRED again by the
    // 2026-09-18 Unity RAM port's stage 3 Task 4 — this time correctly.** `reeling` no longer
    // carries a `turnRate` (or `accel`) multiplier at all: the 2026-09-18 port redefines it as a car
    // with no inputs (`immobilised`, `steeringLocked`, `spinFree`, `ramBlocked`), and the one
    // channel it still scales is `grip` (0.6), which is what replaces this row below as "Grip while
    // reeling".
    //
    // It is read through `modifiersOf`, NOT off `STATUS_TABLE.reeling.modifiers.grip` directly: the
    // raw number is what the row AUTHORS, and `modifiersOf` clamps it against `STATUS_LIMITS` before
    // `stepDrive` ever multiplies by it. The two agree today only because a single, unstacked 0.6
    // never reaches either `STATUS_LIMITS.grip` bound. Author a harsher value, or a second row on
    // this channel, and a raw read would put a number on the page that the sim never applies — the
    // exact staleness this row exists to catch, arriving through the guard itself.
    //
    // "Engine push", "Time to 90% of top speed", "Roll
    // distance from top speed" and "Slip angle at full lock" are new: top speed is no longer an
    // authored clamp but the equilibrium of the engine's push against drag, so those are the numbers
    // that actually describe wind-up and roll under that model. "Reverse top speed" now reads the
    // emergent `maxSpeed × reverseAccelFactor` rather than an authored ratio; "Reverse turn radius"
    // follows it through.
    //
    // The slip-angle formula deliberately includes `dragRate` in its denominator alongside
    // `lateralGripRate`: drag acts on the whole velocity vector every tick (`stepDrive`'s step 2), so
    // it bleeds the lateral component too, not only the forward one. `atan(turnRate /
    // lateralGripRate)` alone — ignoring drag — overstates the drift by about a third; see
    // `DRIVE_CONFIG.lateralGripRate`'s own comment for the measured comparison.
    const spec = [
      ["Turn rate", (d) => d.turnRate],
      ["— in degrees", (d) => deg(d.turnRate)],
      ["— per tick", (d) => d.turnRate / TICK_RATE_HZ],
      ["— degrees per tick", (d) => deg(d.turnRate) / TICK_RATE_HZ],
      ["Engine push", (d) => d.engineAccel],
      ["Time to 90% of top speed", (d) => Math.log(10) / d.dragRate],
      ["Top speed", (d) => d.maxSpeed],
      ["Roll distance from top speed", (d) => d.maxSpeed / d.dragRate],
      ["Reverse top speed", (d) => d.maxSpeed * DRIVE_CONFIG.reverseAccelFactor],
      ["Turn radius", (d) => d.maxSpeed / d.turnRate],
      ["Reverse turn radius", (d) => (d.maxSpeed * DRIVE_CONFIG.reverseAccelFactor) / d.turnRate],
      ["Slip angle at full lock", (d) => deg(Math.atan(d.turnRate / (d.dragRate + DRIVE_CONFIG.lateralGripRate)))],
      ["180° while moving", (d) => Math.PI / d.turnRate],
      ["360° while moving", (d) => (2 * Math.PI) / d.turnRate],
      // Uniform across the roster: `grip` is a global rate (`DRIVE_CONFIG.lateralGripRate`), not a
      // per-car one, so every chassis's cell is the same number. `d` is unused on purpose — the
      // formula is still keyed per-column so a fourth chassis still gets a cell to check.
      ["Grip while reeling", () => DRIVE_CONFIG.lateralGripRate * reelingGrip()],
      // `ChassisDrive.spinPerTick` — read off the resolved chassis rather than recomputed from
      // `RAM_CONFIG.reelingSpinDecayRate` here, for the same reason every other row reads `driveOf`:
      // the page must be checked against what the sim actually multiplies by, and `car-config.ts` is
      // where that conversion happens. Uniform across the roster today because the rate is global,
      // but keyed per-column like the rest so a per-car decay would still be checked cell by cell.
      ["Spin kept per tick while reeling", (d) => d.spinPerTick],
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

});
