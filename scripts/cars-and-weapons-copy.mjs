/**
 * The editorial half of the manual: everything a player needs that is NOT in
 * `WEAPON_TABLE`. Numbers never live here — `build-cars-and-weapons.mjs` reads every stat from
 * built shared, so a balance edit reprints the manual correctly without touching this file.
 *
 * **That rule covers the SENTENCES too, and did not always.** The stat cells were generated from
 * the start; the prose quoted figures by hand, and three of them had gone wrong by 2026-09-04 —
 * predator claiming a 300 ms recharge against a table reading 1000, afterburner claiming five damage
 * ticks a second against a `damageFrequencyMs` of 500, and a chassis note citing a full-connect
 * number that appears nowhere on the page. `balanceStamp` cannot catch that: it hashes this file, so
 * it only asks "was the page rebuilt from this text", never "is this text true".
 *
 * So write `{roster.slotsPerCar}`, not `3`. Tokens are defined in `manual-facts.mjs`, derived from
 * the tables; `{token:words}` spells small whole numbers out ("three"). An unknown token fails the
 * build, and `manual-facts.test.mjs` fails if a token's current value is typed as a literal here
 * instead.
 *
 * **One line each, and no more.** The 2026-09-17 restructure cut this file from a magazine to a
 * caption track: the page is a stat sheet now, and every figure on it is generated. A sentence here
 * exists only to say the thing the numbers cannot — what the weapon is *for*. If a line you are
 * tempted to add restates a stat the page already prints beside it, the page already says it.
 */

export const MANUAL_META = {
  title: "Motor Combat",
  subtitle: "Cars & Weapons",
};

/** One line per chassis: what it is, not how it plays. The stats below it answer the rest. */
export const CHASSIS_COPY = {
  mirage: {
    line:
      "The fastest chassis and the thinnest hull. Two of its {roster.slotsPerCar:words} weapons " +
      "only reach at contact range, so it has to arrive, land the kit, and leave.",
  },
  bullseye: {
    line:
      "The longest reach in the game, paid for with the lightest hull on the grid. Its opener " +
      "steers itself once it is near you — the other two ask you to aim.",
  },
  bastion: {
    line:
      "The slowest chassis and the biggest hull. It cannot chase you, so it stops you instead: two " +
      "of its {roster.slotsPerCar:words} weapons stun or slam.",
  },
};

/** One line per weapon. What it is for — the stat list under it covers what it does. */
export const WEAPON_COPY = {
  magmablast: { line: "A fast bolt that leaves a corroding field wherever it dies." },
  thunderclap: { line: "A lunge that ends the fight where it lands." },
  afterburner: { line: "Flame cones off the nose and the tail at once." },
  predator: { line: "Fired blind — it picks its target after it is already in the air." },
  pepperbox: { line: "Darts out of every side at once. The panic button." },
  lance: { line: "Held in place, then sweep the beam across the line." },
  thumper: { line: "A bouncing slug, the biggest projectile in the game." },
  roadblock: { line: "A wall on the move. It stuns through cover." },
  wildcharge: { line: "Armor up, then hard-slam the first car you touch." },
};

/**
 * Where an effect comes from when no weapon row says so.
 *
 * The Effects section derives each row's sources from `WEAPON_TABLE` — which weapon applies it, and
 * for how long — and that covers every status a gun can inflict. Two reach a player another way
 * entirely: the contact pass writes `reeling`, and the deathmatch respawn writes `phased`. Neither
 * is in a weapon table to be read, so the source line is authored here.
 *
 * A status with no weapon source and no line here does not appear on the page at all, which is the
 * intended behaviour for a `STATUS_TABLE` row nothing in the shipped game can apply (`armored` and
 * `overhauled` today). Adding a source for one is how it gets published.
 */
export const EFFECT_SOURCES = {
  reeling: "Every ram, and Wild Charge's slam.",
  phased: "The moment after you respawn in Deathmatch.",
};
