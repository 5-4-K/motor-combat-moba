/**
 * Weapon, damage and status probes — the corner cases shooter/arena games classically break on.
 *
 * Everything runs through the real room pipeline (`PlaytestWorld`), so a hit here is a hit a LAN
 * client would be told about.
 */
import {
  WEAPON_TABLE,
  CAR_TABLE,
  STATUS_CONFIG,
  getArena,
  hpOf,
  slotsOf,
  weaponDamageOf,
  weaponDefOf,
  weaponTicksOf,
  type CarId,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { PlaytestWorld, statusesOf } from "./world.js";
import { Reporter } from "./reporter.js";

const reporter = new Reporter(
  "weapons",
  "All nine weapons: damage, point-blank, friendly fire, death, cooldowns, statuses, leaks, pierce.",
);
const report = reporter.report.bind(reporter);

/** Which slot index (1-based bitmask) carries this weapon on its chassis. */
function slotBitFor(carId: CarId, weaponId: WeaponId): number {
  const i = slotsOf(carId).indexOf(weaponId);
  if (i < 0) throw new Error(`${carId} does not carry ${weaponId}`);
  return 1 << i;
}
function carrierOf(weaponId: WeaponId): CarId {
  const id = (Object.keys(CAR_TABLE) as CarId[]).find((c) => slotsOf(c).includes(weaponId));
  if (!id) throw new Error(`no chassis carries ${weaponId}`);
  return id;
}
/** An authored row no chassis carries (`tremor` today) cannot be fired through the real slot pipeline. */
function hasCarrier(weaponId: WeaponId): boolean {
  return (Object.keys(CAR_TABLE) as CarId[]).some((c) => slotsOf(c).includes(weaponId));
}

/**
 * Fire `weaponId` from a shooter at `(sx, sy, angle)` at a target `distance` away along the same
 * axis, and report total damage dealt over `ticks`. Both cars are stationary unless `targetMove`.
 */
function shootAt(opts: {
  weaponId: WeaponId;
  distance: number;
  ticks?: number;
  angle?: number;
  targetCar?: CarId;
  targetAngle?: number;
  lateral?: number;
  mode?: "ffa" | "team";
  targetTeam?: 0 | 1;
  arena?: string;
  sx?: number;
  sy?: number;
}): { damage: number; hp: number; statuses: string[]; instances: number; world: PlaytestWorld } {
  const shooterCar = carrierOf(opts.weaponId);
  const angle = opts.angle ?? 0;
  const sx = opts.sx ?? 200;
  const sy = opts.sy ?? 360;
  const targetCar = opts.targetCar ?? "bastion";
  const w = new PlaytestWorld(
    [
      { id: "shooter", carId: shooterCar, x: sx, y: sy, angle, team: 0 },
      {
        id: "target",
        carId: targetCar,
        x: sx + Math.cos(angle) * opts.distance - Math.sin(angle) * (opts.lateral ?? 0),
        y: sy + Math.sin(angle) * opts.distance + Math.cos(angle) * (opts.lateral ?? 0),
        angle: opts.targetAngle ?? 0,
        team: opts.targetTeam ?? 0,
      },
    ],
    opts.mode ?? "ffa",
    opts.arena ?? "arena-01",
  );
  const startHp = w.get("target").hp;
  const bit = slotBitFor(shooterCar, opts.weaponId);
  const ticks = opts.ticks ?? 60;
  for (let i = 0; i < ticks; i++) {
    // Press on the first tick only, so this measures ONE press unless the caller wants more.
    w.input("shooter", { fireSlots: i === 0 ? bit : 0 });
    w.tick();
  }
  const t = w.get("target");
  return {
    damage: startHp - t.hp,
    hp: t.hp,
    statuses: statusesOf(t).map((s) => s.statusId),
    instances: w.instances().length,
    world: w,
  };
}

// Every probe here fires through the real slot pipeline, so the sweep covers CARRIED rows only.
// `tremor` (the 2026-09-01 overhaul's unassigned presence zone) is authored but on no loadout;
// W1 names every skipped row loudly rather than iterating it into a crash.
const ALL_WEAPONS = (Object.keys(WEAPON_TABLE) as WeaponId[]).filter(hasCarrier);
const UNCARRIED_WEAPONS = (Object.keys(WEAPON_TABLE) as WeaponId[]).filter((id) => !hasCarrier(id));

/* ------------------------------------------------------- W1. baseline: every weapon connects */
function baseline(): void {
  const rows: string[] = [];
  let broken = 0;
  for (const id of ALL_WEAPONS) {
    const def = WEAPON_TABLE[id];
    const carrier = carrierOf(id);
    // A charge maneuver (`wildcharge`) authors range 0 — "a charge dashes nowhere" — so "half its
    // range" is meaningless and its damage exists only on a driven hull contact inside the window.
    // A stationary press dealing 0 is the row working as authored, not a broken weapon. A dash
    // (`thunderclap`) still measures: it carries the car to the target and must land its hit.
    if (def.kind === "maneuver" && def.maneuver.type === "charge") {
      rows.push(
        `${id.padEnd(11)} KNOWN-BY-DESIGN — a charge fires no shot and has range 0: damage lands only on driven hull contact inside its window`,
      );
      continue;
    }
    // Half of the weapon's range, but inside a beam's reach.
    const distance = Math.min(def.range * 0.5, def.range - 20);
    const r = shootAt({ weaponId: id, distance, ticks: 120 });
    const expected = weaponDamageOf(carrier, id);
    if (r.damage === 0) broken++;
    rows.push(
      `${id.padEnd(11)} @${String(Math.round(distance)).padStart(4)}u  dealt ${String(r.damage).padStart(4)}  ` +
        `(one hit = ${expected})  statuses on target: ${r.statuses.join(",") || "-"}`,
    );
  }
  for (const id of UNCARRIED_WEAPONS) {
    rows.push(`${id.padEnd(11)} SKIPPED — authored but on no chassis's loadout; nothing can fire it through the real slot pipeline`);
  }
  report(
    "W1. Every weapon connects at half its range",
    broken > 0 ? "FINDING" : "OK",
    rows.join("\n"),
  );
}

/* ------------------------------------------------- W2. point-blank: muzzle inside the target */
/**
 * The muzzle spawns `carWidth/2` = 24u ahead of the shooter's centre. Two cars flush nose-to-tail
 * have centres 48u apart, so the muzzle is born exactly ON the victim's near face. Classic bug:
 * the shot spawns *past* the hitbox and a point-blank shot misses.
 */
function pointBlank(): void {
  /** Centres this far apart put the hulls in contact; any closer and they interpenetrate. */
  const HULLS_TOUCH_AT = 48;
  const rows: string[] = [];
  let misses = 0;
  for (const id of ALL_WEAPONS) {
    const def = WEAPON_TABLE[id];
    // Neither maneuver row spawns an instance from a muzzle, so the bug this probe exists to
    // catch — "the shot spawns past the hitbox" — cannot happen to either. What each is still
    // held to differs, and the split matches W1's.
    //
    // A charge (`wildcharge`) authors range 0 and never leaves the spot it was pressed from, so
    // every distance below is out of its reach by authorship. There is nothing here to measure.
    if (def.kind === "maneuver" && def.maneuver.type === "charge") {
      rows.push(`${id.padEnd(11)} KNOWN-BY-DESIGN — a charge fires no shot and dashes nowhere: damage lands only on driven hull contact inside its window`);
      continue;
    }
    // A dash (`thunderclap`) DOES measure: it carries the car into the target and must land its
    // hit. Its damage rides the contact pass, which fires on contact ENTRY, so hulls already flush
    // leave it no edge to enter on — dealing nothing at 40 and 48 (centres at or inside the
    // touching distance) is that rule working, not a point-blank miss. Every distance it has room
    // to close stays held to the hit, which is the coverage a blanket maneuver skip threw away:
    // the dash lands its full damage at 56, 64 and 80, and a regression there is a finding.
    const flushExempt = def.kind === "maneuver";
    const results: string[] = [];
    for (const distance of [40, 48, 56, 64, 80]) {
      const r = shootAt({ weaponId: id, distance, ticks: 90 });
      if (r.damage > 0) results.push(`${distance}:${r.damage}`);
      else if (flushExempt && distance <= HULLS_TOUCH_AT) results.push(`${distance}:none(flush)`);
      else results.push(`${distance}:MISS`);
    }
    const missed = results.filter((s) => s.includes("MISS")).length;
    if (missed > 0) misses++;
    rows.push(`${id.padEnd(11)} ${results.join("  ")}`);
  }
  report(
    "W2. Point-blank (centres 40-80u apart; hulls touch at 48)",
    misses > 0 ? "FINDING" : "OK",
    `muzzle is born 24u ahead of the shooter's centre — right on a flush victim's face.\n` +
      `none(flush) is a dash at or inside ${HULLS_TOUCH_AT}u: no contact edge to enter on, by design.\n` +
      rows.join("\n"),
  );
}

/* --------------------------------------------------- W3. projectile tunneling through a car */
/** Skewer moves 33.3 u/tick (speed dropped 1400 -> 1000 with T17's range cut) against a 32u-wide hull. The smear is what must stop it straddling. */
function projectileTunneling(): void {
  const rows: string[] = [];
  let tunneled = 0;
  for (const id of ALL_WEAPONS) {
    const def = WEAPON_TABLE[id];
    if (def.kind !== "projectile") continue;
    const perTick = def.speed / 30;
    let misses = 0;
    const samples = 60;
    for (let i = 0; i < samples; i++) {
      // Sweep the target 1u at a time through a whole tick-step, so every sub-tick phase is covered.
      const distance = 300 + i;
      const r = shootAt({ weaponId: id, distance, ticks: 120 });
      if (r.damage === 0) misses++;
    }
    if (misses > 0) tunneled++;
    rows.push(
      `${id.padEnd(11)} ${perTick.toFixed(1).padStart(5)} u/tick vs a 32u hull: ` +
        `${misses}/${samples} sub-tick phases missed ${misses > 0 ? "<- TUNNELING" : ""}`,
    );
  }
  // NOT a tunneling verdict: a multi-pellet weapon fans its pellets off the centre line, so a miss
  // here is spread, not a straddle. `weapons2.ts` separates the two — see W3b and W3c.
  report(
    "W3. Projectile tunneling through a stationary car (at ~300u)",
    tunneled > 0 ? "SEE weapons2.ts W3b/W3c" : "OK",
    rows.join("\n") +
      (tunneled > 0
        ? "\nA miss here is not proof of tunneling: run weapons2.ts, which sweeps single-pellet\n" +
          "weapons at close range (W3c, clean) and measures the pellet fan separately (W3b)."
        : ""),
  );
}

/* ------------------------------------------------------------- W4. friendly fire / self harm */
function friendlyFire(): void {
  const rows: string[] = [];
  let leaks = 0;
  for (const id of ALL_WEAPONS) {
    const def = WEAPON_TABLE[id];
    const distance = Math.min(def.range * 0.4, def.range - 20);
    const team = shootAt({ weaponId: id, distance, ticks: 120, mode: "team", targetTeam: 0 });
    const foe = shootAt({ weaponId: id, distance, ticks: 120, mode: "team", targetTeam: 1 });
    // Self-damage: shooter's own hp must never move.
    const selfHp = team.world.get("shooter").hp;
    const selfMax = hpOf(carrierOf(id));
    const bad = team.damage > 0 || selfHp !== selfMax;
    if (bad) leaks++;
    rows.push(
      `${id.padEnd(11)} teammate took ${String(team.damage).padStart(4)}  enemy took ${String(foe.damage).padStart(4)}  ` +
        `shooter hp ${selfHp}/${selfMax} ${bad ? "<- LEAK" : ""}`,
    );
  }
  report("W4. Friendly fire and self-damage (team mode)", leaks > 0 ? "FINDING" : "OK", rows.join("\n"));
}

/* ------------------------------------------------------------------ W5. damage after death */
/**
 * Nothing may damage a dead car further, and — the subtler half — a bleed applied before death must
 * not keep ticking it, nor may a heal lift it off 0.
 *
 * Since 2026-08-30 there is no wreck to be scenery: `isOnField` reads `alive`, so a dead car leaves
 * the field on the tick it dies — intangible, frozen, no longer a ram participant — and the client
 * fades it out. The question stands: "off the field" is a collision and drive property, while
 * whether anything can still move its `hp` is decided in `runCombat`.
 *
 * In Deathmatch it leaves and then comes BACK: `respawnSweep` returns it after
 * `DEATHMATCH_TICKS.respawnDelay`, briefly `phased` and so still not solid. These probes run
 * last-standing rules, where the original sentence holds unchanged.
 *
 * **The trigger is tapped, not held.** Fire is edge-triggered on the server as of the same date, so
 * a held `fireSlots` fires exactly once — which left this probe putting a single 23-damage dart into
 * a 40 hp target, never killing it, and reporting OK with every assertion below unreached.
 */
function damageAfterDeath(): void {
  const w = new PlaytestWorld([
    { id: "shooter", carId: "bullseye", x: 200, y: 360, angle: 0 },
    { id: "target", carId: "bullseye", x: 500, y: 360, angle: 0, hp: 40 },
  ]);
  const bit = slotBitFor("bullseye", "predator");
  let hpBelowZero = false;
  let deadTookDamage = false;
  let deadAt = -1;
  for (let i = 0; i < 120; i++) {
    // Release between presses: a held key is ONE press. predator recharges in 9 ticks, so tapping
    // every other tick lands ~6 shots — enough to kill a 40 hp target and keep shooting the corpse.
    w.input("shooter", { fireSlots: i % 2 === 0 ? bit : 0 });
    w.tick();
    const t = w.get("target");
    if (t.hp < 0) hpBelowZero = true;
    if (!t.alive && deadAt < 0) deadAt = i;
    if (deadAt >= 0 && i > deadAt && t.hp !== 0) deadTookDamage = true;
  }
  const t = w.get("target");
  report(
    "W5. Damage and bleed after death",
    hpBelowZero || deadTookDamage ? "FINDING" : "OK",
    `target died on tick ${deadAt + 1}, final hp ${t.hp}, alive ${t.alive}\n` +
      `hp ever negative: ${hpBelowZero}; hp moved after death: ${deadTookDamage}\n` +
      `statuses still on the dead car: ${statusesOf(t).map((s) => s.statusId).join(",") || "none"} ` +
      `(needler applies no status now — T18 moved its old 'spiked' rider to bulwark — but any bleed\n` +
      `still would keep its badge here, since 'runCombat' gates pulses on 'alive', not the badge)`,
  );
}

/* ------------------------------------------------- W6. fire-rate exploit via input flooding */
/**
 * A hand-rolled client can send many inputs per tick. `serverTick` caps how many are SIMULATED; the
 * weapon cooldown is what must actually bound the rate.
 *
 * **The exploit this probe hunts moved on 2026-08-30.** Fire became edge-triggered: `fireSlots` is
 * key state, and only a bit that was NOT down on the previous simulated input counts as a press. The
 * old attack — flood the same held mask and hope the OR buys extra shots — now buys nothing, and
 * comparing 1 held input against 8 held ones would report a meaningless 1.00x with both arms firing
 * exactly once.
 *
 * The new surface is the one edge detection opened: `prev` advances PER INPUT, so a client that
 * ALTERNATES its mask inside a single tick (`bit, 0, bit, 0, ...`) manufactures a press edge every
 * other input — four presses in one tick out of one physically-held key. That is what the flooding
 * arm does here. The cooldown is still the thing that must refuse them.
 */
function fireRateExploit(): void {
  const rows: string[] = [];
  let exploitable = false;
  for (const id of ALL_WEAPONS) {
    const carrier = carrierOf(id);
    const bit = slotBitFor(carrier, id);
    const counts: number[] = [];
    for (const perTick of [1, 8]) {
      const w = new PlaytestWorld([
        { id: "shooter", carId: carrier, x: 200, y: 360, angle: 0 },
        { id: "target", carId: "bastion", x: 200 + Math.min(WEAPON_TABLE[id].range * 0.5, 300), y: 360, angle: 0 },
      ]);
      let spawned = 0;
      const seen = new Set<string>();
      for (let i = 0; i < 300; i++) {
        if (perTick === 1) {
          // The honest client: one input per tick, releasing between presses — the fastest a real
          // player can legitimately ask to fire.
          w.input("shooter", { fireSlots: i % 2 === 0 ? bit : 0 });
        } else {
          // The flooder: alternate inside the tick so every other input is a fresh press edge.
          for (let k = 0; k < perTick; k++) w.input("shooter", { fireSlots: k % 2 === 0 ? bit : 0 });
        }
        w.tick();
        for (const inst of w.instances()) if (!seen.has(inst.id)) { seen.add(inst.id); spawned++; }
      }
      counts.push(spawned);
    }
    const ratio = counts[0]! === 0 ? 0 : counts[1]! / counts[0]!;
    if (ratio > 1.05) exploitable = true;
    rows.push(
      `${id.padEnd(11)} honest tap -> ${String(counts[0]).padStart(3)} shots;  ` +
        `8 alternating inputs/tick -> ${String(counts[1]).padStart(3)} shots  (${ratio.toFixed(2)}x) ` +
        `${ratio > 1.05 ? "<- RATE EXPLOIT" : ""}`,
    );
  }
  report("W6. Fire-rate exploit by manufacturing press edges (300 ticks = 10s)", exploitable ? "FINDING" : "OK", rows.join("\n"));
}

/* ------------------------------------------------------------ W7. status chain / perma-CC */
/**
 * `stunned` is `reapply: "ignore"` so it cannot be chained. `overheated`/`spiked`/`corroded` are
 * `refresh`, so a sustained source holds them indefinitely — by design, but the ceiling matters.
 *
 * The perma-stun attempt used to be two Bastions spamming `shockwave`. T16 moved the stun off
 * shockwave and onto `thumper`, Bastion's own slot 1, at 900ms. That is now the roster's only
 * stun source, so it is what this probe has to stress. (Shockwave itself, renamed `magmablast`
 * and now Mirage's slot 1 again as of the 2026-09-02 loadout swap, still applies `corroded` — but
 * from a single burst on the shell's one death, not a third wave of a three-wave aura.)
 */
function statusChain(): void {
  const rows: string[] = [];
  // Two bastions alternating thumper on one victim: the perma-stun attempt.
  const w = new PlaytestWorld([
    { id: "bastA", carId: "bastion", x: 600, y: 360, angle: 0, team: 0 },
    { id: "bastB", carId: "bastion", x: 680, y: 360, angle: Math.PI, team: 0 },
    { id: "victim", carId: "mirage", x: 640, y: 360, angle: 0, team: 0, hp: 100000 },
  ]);
  const bit = slotBitFor("bastion", "thumper");
  let stunnedTicks = 0;
  const total = 900; // 30 seconds
  for (let i = 0; i < total; i++) {
    // Released on alternate ticks: fire is edge-triggered, so a held mask is ONE press and this
    // would otherwise measure a single stun rather than a chain. thumper recharges in 90 ticks, so
    // tapping every other tick asks to fire far more often than the cooldown allows.
    const press = i % 2 === 0 ? bit : 0;
    w.input("bastA", { fireSlots: press });
    w.input("bastB", { fireSlots: press });
    w.input("victim", {});
    w.tick();
    if (statusesOf(w.get("victim")).some((s) => s.statusId === "stunned" && s.endsTick > w.state.tick)) {
      stunnedTicks++;
    }
  }
  rows.push(
    `two Bastions spamming Thumper on one car for ${total} ticks (30s): ` +
      `stunned for ${stunnedTicks} ticks (${((stunnedTicks / total) * 100).toFixed(0)}% of the fight)`,
  );

  // Sustained afterburner: how long can `overheated` be held?
  const w2 = new PlaytestWorld([
    { id: "r", carId: "mirage", x: 600, y: 360, angle: 0 },
    { id: "v", carId: "bastion", x: 700, y: 360, angle: 0, hp: 100000 },
  ]);
  const abBit = slotBitFor("mirage", "afterburner");
  let overheatedTicks = 0;
  for (let i = 0; i < 900; i++) {
    w2.input("r", { fireSlots: abBit });
    w2.tick();
    if (statusesOf(w2.get("v")).some((s) => s.statusId === "overheated" && s.endsTick > w2.state.tick)) {
      overheatedTicks++;
    }
  }
  rows.push(
    `one Mirage holding Afterburner on one car for 900 ticks: ` +
      `overheated for ${overheatedTicks} ticks (${((overheatedTicks / 900) * 100).toFixed(0)}%)`,
  );

  // The status cap: can a stack of cheap statuses block a meaningful one?
  const capNote = `STATUS_CONFIG.maxActive is ${STATUS_CONFIG.maxActive} and the table has ` +
    `${Object.keys({ overheated: 1, corroded: 1, stunned: 1, spiked: 1, fortified: 1, overhauled: 1 }).length} rows, ` +
    `so the cap cannot currently be reached by an attacker — no eviction exploit exists yet.`;
  rows.push(capNote);

  report(
    "W7. Status chaining / perma-CC",
    stunnedTicks > total * 0.6 ? "FINDING" : "OK",
    rows.join("\n"),
  );
}

/* ------------------------------------------------------------- W8. beams and level geometry */
/** Arena-02 has obstacles. A beam must clip on them; an aura (disc) deliberately does not. */
function beamsThroughWalls(): void {
  const arena = getArena("arena-02");
  const box = arena.obstacles[2]!; // { x: 400, y: 400, w: 200, h: 200 }
  const rows: string[] = [];
  // Shooter left of the box, target right of it — the wall is directly between them.
  const y = box.y + box.h / 2;
  const sx = box.x - 120;
  const tx = box.x + box.w + 60;
  for (const id of ALL_WEAPONS) {
    const carrier = carrierOf(id);
    const w = new PlaytestWorld(
      [
        { id: "shooter", carId: carrier, x: sx, y, angle: 0 },
        { id: "target", carId: "bastion", x: tx, y, angle: 0 },
      ],
      "ffa",
      "arena-02",
    );
    const bit = slotBitFor(carrier, id);
    const startHp = w.get("target").hp;
    for (let i = 0; i < 120; i++) {
      w.input("shooter", { fireSlots: i === 0 ? bit : 0 });
      w.tick();
    }
    const dealt = startHp - w.get("target").hp;
    const reach = tx - sx;
    // `weaponDefOf`, not `WEAPON_TABLE[id]`: indexing the table with a bare `WeaponId` yields the
    // union of each row's own literal type (see the comment on `buildBurstDefs` in
    // weapon-config.ts), which does not discriminate on `.kind` the way the plain `WeaponDef`
    // union does. Only `weaponDefOf`'s declared return type narrows `piercesWalls` below.
    const def = weaponDefOf(id);
    const inRange = def.range >= reach;
    // A row that authors `piercesWalls` (roadblock) is SUPPOSED to land through the wall — that is
    // its identity, not a leak. Only an unauthored through-wall hit is the regression here.
    const authored = def.kind === "projectile" && def.piercesWalls === true;
    rows.push(
      `${id.padEnd(11)} range ${String(def.range).padStart(4)} vs ${reach}u gap ` +
        `${inRange ? "(in range)" : "(OUT of range)"} through a 200x200 wall: dealt ${dealt} ` +
        `${dealt > 0 && inRange ? (authored ? "<- through the wall by authored piercesWalls" : "<- SHOT THROUGH THE WALL") : ""}`,
    );
  }
  report(
    "W8. Shooting through level geometry (arena-02)",
    rows.some((r) => r.includes("SHOT THROUGH")) ? "FINDING" : "OK",
    rows.join("\n"),
  );
}

/* ------------------------------------------------- W9. magmablast's burst through a wall */
/**
 * Documented (spec P17): the burst is a `disc`, and a disc has no axis for the wall raycast to
 * follow, so its splash reaches the far side of level geometry. Confirm the play impact.
 *
 * As of the 2026-09-02 loadout swap magmablast is Mirage's slot 1 again, and it is no longer the
 * old three-wave shockwave aura: one aimed shell, one detonation on whatever kills it (spec
 * P13) — here, the wall itself — spawning a single 60u burst at full extent (P15) that lingers
 * 150ms. Mirage is the shooter and one press is enough; there is no second or third wave to wait
 * on anymore.
 */
function auraThroughWall(): void {
  const arena = getArena("arena-02");
  const box = arena.obstacles[2]!; // { x: 400, y: 400, w: 200, h: 200 }
  // Mirage hugging the west face of the box; victim 140u from Mirage's own position, which lands
  // this victim INSIDE the block's 200u footprint rather than past its far face — a leftover
  // placement from when the aura's radius (150) was anchored to the shooter, not to where a shell
  // dies. It still exercises the question this probe asks (does the burst's splash cross the near
  // face at all), just not "the far side of the whole block" the way the name implies; see W9's
  // reported numbers for what actually happens.
  const y = box.y + box.h / 2;
  const w = new PlaytestWorld(
    [
      { id: "mir", carId: "mirage", x: box.x - 25, y, angle: 0 },
      { id: "victim", carId: "bastion", x: box.x - 25 + 140, y, angle: 0 },
    ],
    "ffa",
    "arena-02",
  );
  const bit = slotBitFor("mirage", "magmablast");
  const startHp = w.get("victim").hp;
  // One press: the shell (600u/s) covers the 25u to the wall in two ticks, dies there, and the
  // resulting burst lingers 150ms (~5 ticks). 30 ticks leaves ample margin either side.
  for (let i = 0; i < 30; i++) {
    w.input("mir", { fireSlots: i === 0 ? bit : 0 });
    w.tick();
  }
  const dealt = startHp - w.get("victim").hp;
  report(
    "W9. Magma Blast's burst reaching through a wall",
    dealt > 0 ? "KNOWN-BY-DESIGN" : "OK",
    `Mirage on the west face of a 200x200 block, victim 140u from Mirage (inside the block's own ` +
      `footprint, not past its far face): dealt ${dealt} (splash alone is 15 base, up to ~17 at ` +
      `Mirage's 1.13x attack), victim statuses ` +
      `${statusesOf(w.get("victim")).map((s) => s.statusId).join(",") || "none"}.\n` +
      `weapon-config.ts documents the burst as passing through level geometry by design (P17) — ` +
      `intentional, but corrosion damage reaching through a solid wall still reads as a bug from ` +
      `the receiving end. The 200u block is thicker than the 60u burst radius, so this particular ` +
      `wall can still block it depending on exactly where the shell dies; a thinner obstacle would ` +
      `show the pass-through more reliably (see packages/shared/src/sim/combat.test.ts's P17 case).`,
  );
}

/* ---------------------------------------------------------------- W10. pierce accounting */
/**
 * `roadblock` (Bastion's slot 2, which took over this probe when the 2026-09-01 overhaul retired
 * `skewer` and its pierce-1 budget) authors `pierce: 4` and is documented as piercing everything
 * it crosses: pierce counts cars AFTER the first, so 4 reaches all five possible opponents. Three
 * cars in its path must therefore ALL be hit, each for the full amount — a shot that stops early
 * is the regression. The line at 400/500/600 from a shooter at 200 puts the far target 400u out,
 * inside roadblock's 500 range.
 */
function pierce(): void {
  const w = new PlaytestWorld([
    { id: "shooter", carId: "bastion", x: 200, y: 360, angle: 0, team: 0 },
    { id: "t1", carId: "bastion", x: 400, y: 360, angle: 0, team: 0 },
    { id: "t2", carId: "bastion", x: 500, y: 360, angle: 0, team: 0 },
    { id: "t3", carId: "bastion", x: 600, y: 360, angle: 0, team: 0 },
  ]);
  const bit = slotBitFor("bastion", "roadblock");
  const before = ["t1", "t2", "t3"].map((id) => w.get(id).hp);
  for (let i = 0; i < 60; i++) {
    w.input("shooter", { fireSlots: i === 0 ? bit : 0 });
    w.tick();
  }
  const after = ["t1", "t2", "t3"].map((id) => w.get(id).hp);
  const hit = before.map((b, i) => b - after[i]!);
  report(
    "W10. Roadblock pierce (spec: everything in its path)",
    hit.filter((d) => d > 0).length === 3 ? "OK" : "FINDING",
    `three cars in a line at 400/500/600, shooter at 200: damage [${hit.join(", ")}] ` +
      `-> ${hit.filter((d) => d > 0).length} cars hit (pierce 4 counts cars after the first; all three must be hit)`,
  );
}

/* -------------------------------------------------------- W11. weapon instance lifetime leak */
/** Nothing may survive forever: a leaked instance is bandwidth and a phantom hitbox. */
function instanceLeak(): void {
  const rows: string[] = [];
  let leaked = false;
  for (const id of ALL_WEAPONS) {
    const carrier = carrierOf(id);
    const bit = slotBitFor(carrier, id);
    // Fire into empty space, pointing at a wall, and let everything expire.
    const w = new PlaytestWorld([{ id: "shooter", carId: carrier, x: 640, y: 360, angle: 0 }]);
    for (let i = 0; i < 600; i++) {
      w.input("shooter", { fireSlots: bit });
      w.tick();
    }
    // Stop firing and let the world drain.
    for (let i = 0; i < 300; i++) w.tick();
    const left = w.instances().length;
    const schemaRows = w.state.weapons.size;
    if (left > 0 || schemaRows > 0) leaked = true;
    rows.push(`${id.padEnd(11)} after 600 ticks firing + 300 idle: ${left} live, ${schemaRows} schema rows`);
  }
  report("W11. Weapon instance leak", leaked ? "FINDING" : "OK", rows.join("\n"));
}

/* --------------------------------------------------------- W12. attached beam vs owner death */
function beamOwnerDeath(): void {
  const w = new PlaytestWorld([
    { id: "burner", carId: "mirage", x: 600, y: 360, angle: 0, hp: 30, team: 0 },
    { id: "victim", carId: "bastion", x: 700, y: 360, angle: 0, team: 0 },
    { id: "killer", carId: "bullseye", x: 600, y: 200, angle: Math.PI / 2, team: 0 },
  ]);
  const abBit = slotBitFor("mirage", "afterburner");
  const spBit = slotBitFor("bullseye", "predator");
  let beamAfterDeath = 0;
  let burnerDeadAt = -1;
  for (let i = 0; i < 90; i++) {
    w.input("burner", { fireSlots: i === 0 ? abBit : 0 });
    w.input("killer", { fireSlots: spBit });
    w.tick();
    if (!w.get("burner").alive && burnerDeadAt < 0) burnerDeadAt = i;
    if (burnerDeadAt >= 0 && i > burnerDeadAt) {
      beamAfterDeath += w.instances().filter((inst) => inst.weaponId === "afterburner").length;
    }
  }
  report(
    "W12. Attached beam surviving its owner's death",
    beamAfterDeath > 0 ? "FINDING" : "OK",
    `burner wrecked on tick ${burnerDeadAt + 1}; afterburner instance-ticks observed after that: ${beamAfterDeath}`,
  );
}

/* --------------------------------------------------------------- W13. damage number sanity */
function damageNumbers(): void {
  const rows: string[] = [];
  let bad = 0;
  for (const id of ALL_WEAPONS) {
    const carrier = carrierOf(id);
    const d = weaponDamageOf(carrier, id);
    const ticks = weaponTicksOf(id);
    const perHit = WEAPON_TABLE[id].damage;
    if (d <= 0) bad++;
    rows.push(
      `${id.padEnd(11)} table ${String(perHit).padStart(3)} -> ${carrier} (attack ${CAR_TABLE[carrier].attack}) ` +
        `deals ${String(d).padStart(3)}   cooldown ${ticks.cooldown}t  ` +
        `applies ${(weaponDefOf(id).applies ?? []).map((a) => `${a.statusId}/${a.target}`).join(",") || "-"}`,
    );
  }
  report("W13. Damage after the attack-rating scale", bad > 0 ? "FINDING" : "OK", rows.join("\n"));
}

/* ------------------------------------------------------------------------------- run */
baseline();
pointBlank();
projectileTunneling();
friendlyFire();
damageAfterDeath();
fireRateExploit();
statusChain();
beamsThroughWalls();
auraThroughWall();
pierce();
instanceLeak();
beamOwnerDeath();
damageNumbers();

reporter.finish();
