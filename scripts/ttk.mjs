/**
 * Full-kit time-to-kill, every chassis against every chassis.
 *
 * Single-weapon DPS is the wrong unit for this game: a car carries three slots, and which one it can
 * press next is decided by three interacting clocks — each slot's own cooldown, the switch lock a
 * shot leaves on the OTHER slots (`recoveryMs`), and the fact that a press in flight blocks
 * everything until its last volley exits. A weapon's `damage` field says almost nothing about how
 * fast the car holding it finishes someone.
 *
 * So this simulates presses on the tick grid and reports seconds-to-kill. Every number it uses comes
 * from built shared, through the ACTIVE MODE's own accessors — `weapons()`, `cars()`,
 * `weaponTicksOf`, `damageFor`, `hpOf` — so it cannot go stale against a balance edit. Re-run it
 * after one and read what moved. `--mode=<id|name>` picks which mode it measures (MC41), defaulting
 * to `DEFAULT_GAME_MODE`; the mode is printed at the top of every matrix it prints.
 *
 * ## What it deliberately does NOT model, and why the numbers are an upper bound
 *
 * **Every shot connects and the target never leaves range.** That is generous everywhere and wildly
 * generous for the roster's held/attached weapons — `afterburner` is a 220-unit attached cone that
 * has to be held on a moving car for 2.2 s, and `lance` is a beam the shooter has to steer onto the
 * target for 1.5 s of linger after its 0.7 s windup. Those are the largest single numbers on the
 * board and the least likely to be earned in full. Discount them heavily when reading a matchup they
 * dominate.
 *
 * **The defender does nothing.** No dodging, no cover, and — the one that really bites — none of its
 * own kit: Bastion's `fortified` (pure 0.7x damage taken, no heal since the status overhaul) would
 * stretch its own mirror considerably if the defender ever got to raise it.
 *
 * **No travel time.** Projectiles land on the tick they exit, so this is a point-blank reading.
 * Distance is exactly the axis Bullseye's whole design lives on, so the matrix understates it by
 * construction — see the type triangle's "1 beats 3" edge in
 * `docs/superpowers/specs/2026-08-30-chassis-rename-and-weapon-redistribution-design.md` (T1).
 *
 * **Homing accuracy, dash landing, slam windows and bounce paths are unmodeled.** `predator`'s
 * homing always finds its target; `thunderclap`'s dash always lands its hull hit; `wildcharge`'s
 * 10 s charge window always ends in a slam rather than expiring unspent; `thumper`'s bounce always
 * re-threads a target rather than bouncing off into empty arena. Every one of those is a chance to
 * whiff that this file cannot see, and Mirage and Bastion carry three of the four between them — so
 * on top of the point-blank and never-leaves-range assumptions above, the matrix specifically
 * UNDERSTATES Mirage and Bastion relative to how their kits actually land in play.
 *
 * **`kind: "maneuver"` rows are not a special case for `pressPlan`** — a dash or a charge is just
 * another instant hit landing on the press tick, same as any zero-wind-up projectile. `thunderclap`
 * (Mirage) plays that straight and contributes its `damage` on its `cooldownMs` to a sustained
 * rotation like any other row. `wildcharge` (Bastion) does not: it is a 20 s one-hit ultimate whose
 * 250 damage only pays out on a hull contact that may never come inside its 10 s window, and folding
 * a windfall that size into a greedy sustained-DPS loop would read as free damage every cycle rather
 * than the swingy, conditional hit it is. `SUSTAINED_ROTATION_EXCLUDED` below drops it from the
 * matrix and the presses breakdown for that reason; `pressPlan("bastion", "wildcharge")` still works
 * and still shows up in the "what one press does" table, since that number is honest on its own.
 *
 * It is a damage-ceiling model, not a prediction of play. `npm run playtest` measures what the sim
 * actually does; this measures what the tables permit.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_GAME_MODE,
  TICK_RATE_HZ,
  cars,
  combat,
  damageFor,
  fireSlotsOf,
  hpOf,
  modeConfigOf,
  modeLabelOf,
  parseModeArg,
  slotsOf,
  weaponTicksOf,
  weapons,
  withMode,
} from "../packages/shared/dist/index.js";

// `cars()`, `weapons()` and `combat()` are the ACTIVE MODE's tables, not the raw `CAR_TABLE` /
// `WEAPON_TABLE` / `COMBAT_CONFIG` globals this file read until MC41. That swap is what makes
// `--mode` reach the numbers rather than only the header: the globals are mode-blind, so a matrix
// built from them would have carried whichever mode's label the flag asked for over the default
// mode's figures. Every call below sits inside a function, never at module scope — a module-scope
// `const T = cars()` would freeze the first mode installed for the life of the process, which is
// precisely how this flag would appear to work and silently not.

/** Give up on a matchup after this long rather than looping forever on a kit that cannot kill. */
export const TTK_LIMIT_SECONDS = 60;

/** `spiked`'s pulse, the one status that deals damage on its own. Mirrors its `STATUS_TABLE` row. */
const SPIKE_PULSE_TICKS = Math.ceil((400 * TICK_RATE_HZ) / 1000);
const SPIKE_PULSE_DAMAGE = 8;
/** `corroded`'s `damageTaken` multiplier. */
const CORRODED_MULTIPLIER = 1.3;

/**
 * Weapons dropped from the greedy sustained-rotation loop in `simulateTtk`, even though `pressPlan`
 * still describes them normally. See the header's `kind: "maneuver"` section for why `wildcharge`
 * alone is here and `thunderclap` deliberately is not.
 */
const SUSTAINED_ROTATION_EXCLUDED = new Set(["wildcharge"]);

/**
 * Everything one press of `weaponId` does to a SINGLE target, on the tick grid.
 *
 * `events` is `[tickOffset, damage]` pairs — one per pellet group, per wave, and per damage tick of
 * a lingering beam. `exit` is when the press stops blocking the car's other slots.
 *
 * Damage is scaled per hit through `damageFor`, never once over a total: the sim rounds at each
 * impact, so a total scaled afterwards is a different number from the one a player takes.
 */
export function pressPlan(attacker, weaponId) {
  const def = weapons()[weaponId];
  const ticks = weaponTicksOf(weaponId);
  const perHit = damageFor(cars()[attacker].attack, def.damage);
  const pellets = def.kind === "projectile" ? def.pellets.pelletsPerVolley : 1;
  const life = ticks.flight + ticks.lifetime;
  const interval = ticks.damageInterval;
  const ticking = def.kind === "beam" && Number.isFinite(interval) && interval > 0;

  const events = [];
  const applies = [];
  for (let wave = 0; wave < def.volley.volleys; wave += 1) {
    const born = ticks.startUp + wave * ticks.volleyInterval;
    if (ticking) {
      // A lingering beam re-arms against anything still inside it every `damageInterval`.
      for (let k = 0; k * interval < life; k += 1) events.push([born + k * interval, perHit]);
    } else {
      events.push([born, perHit * pellets]);
    }
    const isFinalWave = wave === def.volley.volleys - 1;
    for (const [index, application] of (def.applies ?? []).entries()) {
      if (application.target !== "opponents") continue;
      if (application.onWave === "final" && !isFinalWave) continue;
      applies.push([born, application.statusId, ticks.applyDurations[index] ?? 0]);
    }
  }

  return {
    weaponId,
    events,
    applies,
    exit: ticks.startUp + (def.volley.volleys - 1) * ticks.volleyInterval,
    cooldown: ticks.cooldown,
    recovery: ticks.recovery,
    total: events.reduce((sum, pair) => sum + pair[1], 0),
  };
}

/**
 * Seconds for `attacker`'s whole kit to kill `defender`, playing greedily: whenever the car is free
 * to act, press the biggest thing currently off cooldown and not switch-locked, among slots not in
 * `SUSTAINED_ROTATION_EXCLUDED`.
 *
 * Greedy is not provably optimal — a patient player could hold a big cooldown for a corroded window
 * — but it is close, and it is behaviour a reader can check by hand against `presses`.
 *
 * `debuffs: false` drops `corroded`'s amplification and `spiked`'s bleed, which is the honest way to
 * see how much of a matchup is the weapons and how much is the status riders.
 *
 * The kit is `fireSlotsOf` (BA31) — a time-to-kill that ignored a trigger the car actually pulls
 * would answer a question nobody asked. The ATTACKER AXIS is still `armedCarIds()`, off `slotsOf`:
 * a chassis whose only weapon is the basic attack every chassis has books a row that measures
 * nothing.
 */
export function simulateTtk(attacker, defender, options = {}) {
  const debuffs = options.debuffs !== false;
  const kit = fireSlotsOf(attacker)
    .filter((id) => !SUSTAINED_ROTATION_EXCLUDED.has(id))
    .map((id) => pressPlan(attacker, id));
  const maxHp = hpOf(defender);
  const limit = TTK_LIMIT_SECONDS * TICK_RATE_HZ;

  let hp = maxHp;
  const readyAt = kit.map(() => 0);
  const presses = new Map();
  const inFlight = [];
  let busyUntil = -1;
  let switchLockUntil = 0;
  let lastSlot = -1;
  let corrodedUntil = 0;
  let spikedUntil = 0;
  let nextSpikeAt = 0;

  for (let tick = 0; tick <= limit; tick += 1) {
    if (debuffs && tick < spikedUntil && tick >= nextSpikeAt) {
      hp -= SPIKE_PULSE_DAMAGE;
      nextSpikeAt = tick + SPIKE_PULSE_TICKS;
    }
    // Resolve on `<=`, not `===`: a press scheduled for this very tick is queued after this loop has
    // already run, and an equality gate would strand every zero-wind-up weapon in the game.
    for (let i = inFlight.length - 1; i >= 0; i -= 1) {
      if (inFlight[i][0] > tick) continue;
      const scale = debuffs && tick < corrodedUntil ? CORRODED_MULTIPLIER : 1;
      hp -= Math.round(inFlight[i][1] * scale);
      inFlight.splice(i, 1);
    }
    if (hp <= 0) return { ticks: tick, seconds: tick / TICK_RATE_HZ, presses, maxHp, killed: true };

    if (tick <= busyUntil) continue;
    let best = -1;
    for (let slot = 0; slot < kit.length; slot += 1) {
      if (tick < readyAt[slot]) continue;
      if (slot !== lastSlot && tick < switchLockUntil) continue;
      if (best < 0 || kit[slot].total > kit[best].total) best = slot;
    }
    if (best < 0) continue;

    const plan = kit[best];
    for (const pair of plan.events) inFlight.push([tick + pair[0], pair[1]]);
    if (debuffs) {
      for (const application of plan.applies) {
        const offset = application[0];
        const statusId = application[1];
        const duration = application[2];
        if (statusId === "corroded") corrodedUntil = Math.max(corrodedUntil, tick + offset + duration);
        if (statusId === "spiked") {
          if (tick >= spikedUntil) nextSpikeAt = tick + offset;
          spikedUntil = Math.max(spikedUntil, tick + offset + duration);
        }
      }
    }
    busyUntil = tick + plan.exit;
    readyAt[best] = tick + plan.exit + plan.cooldown;
    switchLockUntil = tick + plan.exit + plan.recovery;
    lastSlot = best;
    presses.set(plan.weaponId, (presses.get(plan.weaponId) ?? 0) + 1);
  }

  return { ticks: Infinity, seconds: Infinity, presses, maxHp, killed: false };
}

// ------------------------------------------------------------------------------- the CLI shell

/**
 * Every chassis in the table, shipped or not. This is the DEFENDER axis: an unreleased prototype
 * still has a hull, and "can anything actually kill this thing" is exactly the question you want
 * answered while tuning its hp — which is why this matrix covers the mode's car table whole where the
 * player-facing guide covers `activeCarIds()`.
 */
const carIds = () => Object.keys(cars());

/**
 * Chassis that can actually fire. This is the ATTACKER axis, and the two are deliberately not the
 * same list: an inactive chassis may legally carry no weapons at all (see "Adding an inactive
 * chassis" in `docs/config-reference.md`), and a weaponless attacker books a guaranteed "never" row
 * that measures nothing — the same reason the balance harness skips an empty kit on its own side.
 * A prototype joins this axis the moment someone authors it a kit, with no edit here.
 */
export const armedCarIds = () => carIds().filter((id) => slotsOf(id).length > 0);

/**
 * Which chassis can fire this weapon in THIS build, or `undefined` when nobody can (VS32).
 *
 * Total on purpose. It used to throw, which was safe only while every authored row was reachable:
 * a row parked past `N` (`WEAPON_SLOT_CONFIG.maxAbilitySlots`), or authored and uncarried like
 * `tremor`, has no reachable carrier and must be skipped and named rather than killing the whole
 * run. `fireSlotsOf` is already truncated to `N` (Tasks 1-2), so this needs no truncation of its
 * own — a weapon past the cut is simply absent from every chassis's list.
 */
export function carrierOf(weaponId) {
  return carIds().find((id) => fireSlotsOf(id).includes(weaponId));
}

/** Every weapon row no chassis can fire in this build, for the matrix's footer. */
export function unreachableWeaponIds() {
  return Object.keys(weapons()).filter((id) => carrierOf(id) === undefined);
}

const nameOf = (id) => cars()[id].name;
const cell = (result) => (result.killed ? `${result.seconds.toFixed(1)}s` : "never");

function matrix(label, options) {
  const defenders = carIds();
  const lines = [`\n${label}`];
  lines.push(
    "attacker \\ defender".padEnd(20) +
      defenders.map((d) => `${nameOf(d)} (${hpOf(d)}hp)`.padStart(20)).join(""),
  );
  for (const attacker of armedCarIds()) {
    const row = defenders.map((d) => cell(simulateTtk(attacker, d, options)).padStart(20));
    lines.push(nameOf(attacker).padEnd(20) + row.join(""));
  }
  const unarmed = carIds().filter((id) => slotsOf(id).length === 0);
  if (unarmed.length > 0) {
    lines.push(
      `  (no attacker row for ${unarmed.map(nameOf).join(", ")} — no kit authored yet, so they ` +
        `appear as targets only)`,
    );
  }
  const unreachable = unreachableWeaponIds();
  if (unreachable.length > 0) {
    lines.push(
      `  (unreachable this build, swept nowhere above: ${unreachable.join(", ")} — authored in ` +
        `the weapon table but on no chassis's fire slots, whether parked past N or carried by nobody)`,
    );
  }
  return lines.join("\n");
}

function inputs() {
  const lines = ["\nWhat ONE press of each weapon puts on a single target"];
  for (const attacker of armedCarIds()) {
    const combatCfg = combat();
    const scale =
      1 + (cars()[attacker].attack - combatCfg.attackBaseline) * combatCfg.damagePerAttack;
    lines.push(`\n  ${nameOf(attacker)} — attack ${cars()[attacker].attack} (x${scale.toFixed(2)})`);
    for (const weaponId of fireSlotsOf(attacker)) {
      const plan = pressPlan(attacker, weaponId);
      const spread = Math.max(...plan.events.map((pair) => pair[0])) / TICK_RATE_HZ;
      lines.push(
        `    ${weaponId.padEnd(12)}${String(plan.total).padStart(4)} dmg  ` +
          `cd ${(plan.cooldown / TICK_RATE_HZ).toFixed(1).padStart(4)}s  ` +
          `blocks other slots ${((plan.exit + plan.recovery) / TICK_RATE_HZ).toFixed(2)}s  ` +
          `${plan.events.length} hit${plan.events.length === 1 ? "" : "s"} over ${spread.toFixed(2)}s`,
      );
    }
  }
  return lines.join("\n");
}

function breakdown() {
  const lines = ["\nPresses spent, against the tankiest target"];
  for (const attacker of armedCarIds()) {
    const result = simulateTtk(attacker, "bastion");
    const spent = [...result.presses].map((entry) => `${entry[0]} x${entry[1]}`).join(", ");
    lines.push(`  ${nameOf(attacker).padEnd(10)}${cell(result).padStart(7)}   ${spent}`);
  }
  return lines.join("\n");
}

/**
 * `mode` is passed in rather than read back from the installed bundle: the caller resolved the flag
 * and installed that mode, and a parameter cannot disagree with what it installed.
 */
export function report(mode = DEFAULT_GAME_MODE) {
  return [
    "Full-kit time-to-kill. Every shot connects and the target never leaves range,",
    "so these are damage ceilings rather than predictions — read this file's header.",
    `Mode: ${modeLabelOf(mode)}.`,
    matrix("Seconds to kill (with corroded amplification and spiked bleed)", { debuffs: true }),
    matrix("Seconds to kill (weapons only, no status riders)", { debuffs: false }),
    inputs(),
    breakdown(),
    "",
  ].join("\n");
}

/**
 * `npm run ttk -- --mode=<id|name>`. The only flag this script takes; anything else throws rather
 * than being ignored, and so does an unknown mode — a typo that silently measured the default would
 * print a matrix headed with the mode the reader asked for and filled with another one's numbers.
 */
export function parseTtkArgs(argv) {
  let mode = DEFAULT_GAME_MODE;
  for (const arg of argv) {
    const match = /^--mode(?:=(.*))?$/.exec(arg);
    if (!match) {
      throw new Error(`ttk: unrecognised argument "${arg}" — the only flag is --mode=<id|name>`);
    }
    if (match[1] === undefined || match[1] === "") {
      throw new Error("ttk: --mode requires a value (--mode=<id|name>)");
    }
    mode = parseModeArg(match[1]);
  }
  return mode;
}

const invoked = process.argv[1] && resolve(process.argv[1]);
if (invoked && invoked === resolve(fileURLToPath(import.meta.url))) {
  // The flag is parsed OUTSIDE the scope — which bundle to install is the answer parsing produces,
  // so it cannot already be installed while producing it — and the single wrapper at the CLI entry
  // point (MC12) is still the only mode-scoped boundary in this file, rather than one scattered
  // around each config read.
  try {
    const mode = parseTtkArgs(process.argv.slice(2));
    withMode(modeConfigOf(mode), () => {
      process.stdout.write(report(mode));
    });
  } catch (err) {
    // A bad flag is a user error, not a crash to read a stack trace for — same shape as
    // `balance/run.ts`'s entry guard.
    process.stderr.write(`ttk failed: ${err.message}\n`);
    process.exitCode = 1;
  }
}
