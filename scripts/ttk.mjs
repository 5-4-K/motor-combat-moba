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
 * from built shared — `WEAPON_TABLE`, `CAR_TABLE`, `WEAPON_TICKS`, `damageFor`, `hpOf` — so it
 * cannot go stale against a balance edit. Re-run it after one and read what moved.
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
 * own kit: Bastion's `fortified` self-heal would stretch its own mirror considerably.
 *
 * **No travel time.** Projectiles land on the tick they exit, so this is a point-blank reading.
 * Distance is exactly the axis Bullseye's whole design lives on, so the matrix understates it by
 * construction — see the type triangle's "1 beats 3" edge in
 * `docs/superpowers/specs/2026-08-30-chassis-rename-and-weapon-redistribution-design.md` (T1).
 *
 * It is a damage-ceiling model, not a prediction of play. `npm run playtest` measures what the sim
 * actually does; this measures what the tables permit.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAR_TABLE,
  COMBAT_CONFIG,
  TICK_RATE_HZ,
  WEAPON_TABLE,
  damageFor,
  hpOf,
  slotsOf,
  weaponTicksOf,
} from "../packages/shared/dist/index.js";

/** Give up on a matchup after this long rather than looping forever on a kit that cannot kill. */
export const TTK_LIMIT_SECONDS = 60;

/** `spiked`'s pulse, the one status that deals damage on its own. Mirrors its `STATUS_TABLE` row. */
const SPIKE_PULSE_TICKS = Math.ceil((400 * TICK_RATE_HZ) / 1000);
const SPIKE_PULSE_DAMAGE = 8;
/** `corroded`'s `damageTaken` multiplier. */
const CORRODED_MULTIPLIER = 1.3;

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
  const def = WEAPON_TABLE[weaponId];
  const ticks = weaponTicksOf(weaponId);
  const perHit = damageFor(CAR_TABLE[attacker].attack, def.damage);
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
 * to act, press the biggest thing currently off cooldown and not switch-locked.
 *
 * Greedy is not provably optimal — a patient player could hold a big cooldown for a corroded window
 * — but it is close, and it is behaviour a reader can check by hand against `presses`.
 *
 * `debuffs: false` drops `corroded`'s amplification and `spiked`'s bleed, which is the honest way to
 * see how much of a matchup is the weapons and how much is the status riders.
 */
export function simulateTtk(attacker, defender, options = {}) {
  const debuffs = options.debuffs !== false;
  const kit = slotsOf(attacker).map((id) => pressPlan(attacker, id));
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

const carIds = () => Object.keys(CAR_TABLE);
const nameOf = (id) => CAR_TABLE[id].name;
const cell = (result) => (result.killed ? `${result.seconds.toFixed(1)}s` : "never");

function matrix(label, options) {
  const cars = carIds();
  const lines = [`\n${label}`];
  lines.push(
    "attacker \\ defender".padEnd(20) +
      cars.map((d) => `${nameOf(d)} (${hpOf(d)}hp)`.padStart(20)).join(""),
  );
  for (const attacker of cars) {
    const row = cars.map((d) => cell(simulateTtk(attacker, d, options)).padStart(20));
    lines.push(nameOf(attacker).padEnd(20) + row.join(""));
  }
  return lines.join("\n");
}

function inputs() {
  const lines = ["\nWhat ONE press of each weapon puts on a single target"];
  for (const attacker of carIds()) {
    const scale =
      1 + (CAR_TABLE[attacker].attack - COMBAT_CONFIG.attackBaseline) * COMBAT_CONFIG.damagePerAttack;
    lines.push(`\n  ${nameOf(attacker)} — attack ${CAR_TABLE[attacker].attack} (x${scale.toFixed(2)})`);
    for (const weaponId of slotsOf(attacker)) {
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
  for (const attacker of carIds()) {
    const result = simulateTtk(attacker, "bastion");
    const spent = [...result.presses].map((entry) => `${entry[0]} x${entry[1]}`).join(", ");
    lines.push(`  ${nameOf(attacker).padEnd(10)}${cell(result).padStart(7)}   ${spent}`);
  }
  return lines.join("\n");
}

export function report() {
  return [
    "Full-kit time-to-kill. Every shot connects and the target never leaves range,",
    "so these are damage ceilings rather than predictions — read this file's header.",
    matrix("Seconds to kill (with corroded amplification and spiked bleed)", { debuffs: true }),
    matrix("Seconds to kill (weapons only, no status riders)", { debuffs: false }),
    inputs(),
    breakdown(),
    "",
  ].join("\n");
}

const invoked = process.argv[1] && resolve(process.argv[1]);
if (invoked && invoked === resolve(fileURLToPath(import.meta.url))) {
  process.stdout.write(report());
}
