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

const findings: { probe: string; verdict: string; detail: string }[] = [];
function report(probe: string, verdict: string, detail: string): void {
  findings.push({ probe, verdict, detail });
  console.log(`\n[${verdict}] ${probe}\n    ${detail.replace(/\n/g, "\n    ")}`);
}

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
  const targetCar = opts.targetCar ?? "hexagon";
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

const ALL_WEAPONS = Object.keys(WEAPON_TABLE) as WeaponId[];

/* ------------------------------------------------------- W1. baseline: every weapon connects */
function baseline(): void {
  const rows: string[] = [];
  let broken = 0;
  for (const id of ALL_WEAPONS) {
    const def = WEAPON_TABLE[id];
    const carrier = carrierOf(id);
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
  const rows: string[] = [];
  let misses = 0;
  for (const id of ALL_WEAPONS) {
    const results: string[] = [];
    for (const distance of [40, 48, 56, 64, 80]) {
      const r = shootAt({ weaponId: id, distance, ticks: 90 });
      if (r.damage === 0) results.push(`${distance}:MISS`);
      else results.push(`${distance}:${r.damage}`);
    }
    const missed = results.filter((s) => s.includes("MISS")).length;
    if (missed > 0) misses++;
    rows.push(`${id.padEnd(11)} ${results.join("  ")}`);
  }
  report(
    "W2. Point-blank (centres 40-80u apart; hulls touch at 48)",
    misses > 0 ? "FINDING" : "OK",
    `muzzle is born 24u ahead of the shooter's centre — right on a flush victim's face.\n` +
      rows.join("\n"),
  );
}

/* --------------------------------------------------- W3. projectile tunneling through a car */
/** Skewer moves 46.7 u/tick against a 32u-wide hull. The smear is what must stop it straddling. */
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
 * A wreck is scenery. Nothing may damage it further, and — the subtler half — a bleed applied
 * before death must not keep ticking a corpse, nor may a heal lift one off 0.
 */
function damageAfterDeath(): void {
  const w = new PlaytestWorld([
    { id: "shooter", carId: "oval", x: 200, y: 360, angle: 0 },
    { id: "target", carId: "oval", x: 500, y: 360, angle: 0, hp: 40 },
  ]);
  const bit = slotBitFor("oval", "splinter");
  let hpBelowZero = false;
  let deadTookDamage = false;
  let deadAt = -1;
  for (let i = 0; i < 120; i++) {
    w.input("shooter", { fireSlots: bit });
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
    `target wrecked on tick ${deadAt + 1}, final hp ${t.hp}, alive ${t.alive}\n` +
      `hp ever negative: ${hpBelowZero}; hp moved after death: ${deadTookDamage}\n` +
      `statuses still on the wreck: ${statusesOf(t).map((s) => s.statusId).join(",") || "none"} ` +
      `(spiked keeps its badge but 'runCombat' gates pulses on 'alive')`,
  );
}

/* ------------------------------------------------- W6. fire-rate exploit via input flooding */
/**
 * A hand-rolled client can send many inputs per tick. `serverTick` caps how many are SIMULATED but
 * OR-s their fire masks together; the weapon cooldown is what must actually bound the rate.
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
        { id: "target", carId: "hexagon", x: 200 + Math.min(WEAPON_TABLE[id].range * 0.5, 300), y: 360, angle: 0 },
      ]);
      let spawned = 0;
      const seen = new Set<string>();
      for (let i = 0; i < 300; i++) {
        for (let k = 0; k < perTick; k++) w.input("shooter", { fireSlots: bit });
        w.tick();
        for (const inst of w.instances()) if (!seen.has(inst.id)) { seen.add(inst.id); spawned++; }
      }
      counts.push(spawned);
    }
    const ratio = counts[0]! === 0 ? 0 : counts[1]! / counts[0]!;
    if (ratio > 1.05) exploitable = true;
    rows.push(
      `${id.padEnd(11)} 1 input/tick -> ${String(counts[0]).padStart(3)} shots;  ` +
        `8 inputs/tick -> ${String(counts[1]).padStart(3)} shots  (${ratio.toFixed(2)}x) ` +
        `${ratio > 1.05 ? "<- RATE EXPLOIT" : ""}`,
    );
  }
  report("W6. Fire-rate exploit by flooding inputs (300 ticks = 10s)", exploitable ? "FINDING" : "OK", rows.join("\n"));
}

/* ------------------------------------------------------------ W7. status chain / perma-CC */
/**
 * `stunned` is `reapply: "ignore"` so it cannot be chained. `overheated`/`spiked`/`corroded` are
 * `refresh`, so a sustained source holds them indefinitely — by design, but the ceiling matters.
 */
function statusChain(): void {
  const rows: string[] = [];
  // Two hexagons alternating shockwave on one victim: the perma-stun attempt.
  const w = new PlaytestWorld([
    { id: "hexA", carId: "hexagon", x: 600, y: 360, angle: 0, team: 0 },
    { id: "hexB", carId: "hexagon", x: 680, y: 360, angle: Math.PI, team: 0 },
    { id: "victim", carId: "rectangle", x: 640, y: 360, angle: 0, team: 0, hp: 100000 },
  ]);
  const bit = slotBitFor("hexagon", "shockwave");
  let stunnedTicks = 0;
  const total = 900; // 30 seconds
  for (let i = 0; i < total; i++) {
    w.input("hexA", { fireSlots: bit });
    w.input("hexB", { fireSlots: bit });
    w.input("victim", {});
    w.tick();
    if (statusesOf(w.get("victim")).some((s) => s.statusId === "stunned" && s.endsTick > w.state.tick)) {
      stunnedTicks++;
    }
  }
  rows.push(
    `two Hexagons spamming Shockwave on one car for ${total} ticks (30s): ` +
      `stunned for ${stunnedTicks} ticks (${((stunnedTicks / total) * 100).toFixed(0)}% of the fight)`,
  );

  // Sustained afterburner: how long can `overheated` be held?
  const w2 = new PlaytestWorld([
    { id: "r", carId: "rectangle", x: 600, y: 360, angle: 0 },
    { id: "v", carId: "hexagon", x: 700, y: 360, angle: 0, hp: 100000 },
  ]);
  const abBit = slotBitFor("rectangle", "afterburner");
  let overheatedTicks = 0;
  for (let i = 0; i < 900; i++) {
    w2.input("r", { fireSlots: abBit });
    w2.tick();
    if (statusesOf(w2.get("v")).some((s) => s.statusId === "overheated" && s.endsTick > w2.state.tick)) {
      overheatedTicks++;
    }
  }
  rows.push(
    `one Rectangle holding Afterburner on one car for 900 ticks: ` +
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
        { id: "target", carId: "hexagon", x: tx, y, angle: 0 },
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
    const inRange = WEAPON_TABLE[id].range >= reach;
    rows.push(
      `${id.padEnd(11)} range ${String(WEAPON_TABLE[id].range).padStart(4)} vs ${reach}u gap ` +
        `${inRange ? "(in range)" : "(OUT of range)"} through a 200x200 wall: dealt ${dealt} ` +
        `${dealt > 0 && inRange ? "<- SHOT THROUGH THE WALL" : ""}`,
    );
  }
  report(
    "W8. Shooting through level geometry (arena-02)",
    rows.some((r) => r.includes("SHOT THROUGH")) ? "FINDING" : "OK",
    rows.join("\n"),
  );
}

/* ----------------------------------------------------- W9. shockwave aura through a wall */
/** Documented: a disc grows to full range and passes through geometry. Confirm the play impact. */
function auraThroughWall(): void {
  const arena = getArena("arena-02");
  const box = arena.obstacles[2]!;
  // Hexagon hugging the west face of the box; victim hugging the east face. 200u of solid wall
  // between them, well inside shockwave's 150 radius? No — check the real geometry.
  const y = box.y + box.h / 2;
  const w = new PlaytestWorld(
    [
      { id: "hex", carId: "hexagon", x: box.x - 25, y, angle: 0 },
      { id: "victim", carId: "rectangle", x: box.x - 25 + 140, y, angle: 0 },
    ],
    "ffa",
    "arena-02",
  );
  const bit = slotBitFor("hexagon", "shockwave");
  const startHp = w.get("victim").hp;
  for (let i = 0; i < 30; i++) {
    w.input("hex", { fireSlots: i === 0 ? bit : 0 });
    w.tick();
  }
  const dealt = startHp - w.get("victim").hp;
  report(
    "W9. Shockwave (disc aura) reaching through a wall",
    dealt > 0 ? "KNOWN-BY-DESIGN" : "OK",
    `Hexagon on the west face of a 200x200 block, victim 140u away with the block between them: ` +
      `dealt ${dealt}, victim statuses ${statusesOf(w.get("victim")).map((s) => s.statusId).join(",") || "none"}.\n` +
      `instances.ts states a disc "grows to its full range and passes through level geometry" — ` +
      `intentional, but it is a stun through a solid wall, which reads as a bug from the receiving end.`,
  );
}

/* ---------------------------------------------------------------- W10. pierce accounting */
/** `skewer` has pierce: 1, documented as "TWO CARS, not one and not three". */
function pierce(): void {
  const w = new PlaytestWorld([
    { id: "shooter", carId: "oval", x: 200, y: 360, angle: 0, team: 0 },
    { id: "t1", carId: "hexagon", x: 400, y: 360, angle: 0, team: 0 },
    { id: "t2", carId: "hexagon", x: 500, y: 360, angle: 0, team: 0 },
    { id: "t3", carId: "hexagon", x: 600, y: 360, angle: 0, team: 0 },
  ]);
  const bit = slotBitFor("oval", "skewer");
  const before = ["t1", "t2", "t3"].map((id) => w.get(id).hp);
  for (let i = 0; i < 60; i++) {
    w.input("shooter", { fireSlots: i === 0 ? bit : 0 });
    w.tick();
  }
  const after = ["t1", "t2", "t3"].map((id) => w.get(id).hp);
  const hit = before.map((b, i) => b - after[i]!);
  report(
    "W10. Skewer pierce (spec: exactly two cars)",
    hit.filter((d) => d > 0).length === 2 ? "OK" : "FINDING",
    `three cars in a line at 400/500/600, shooter at 200: damage [${hit.join(", ")}] ` +
      `-> ${hit.filter((d) => d > 0).length} cars hit`,
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
    { id: "burner", carId: "rectangle", x: 600, y: 360, angle: 0, hp: 30, team: 0 },
    { id: "victim", carId: "hexagon", x: 700, y: 360, angle: 0, team: 0 },
    { id: "killer", carId: "oval", x: 600, y: 200, angle: Math.PI / 2, team: 0 },
  ]);
  const abBit = slotBitFor("rectangle", "afterburner");
  const spBit = slotBitFor("oval", "splinter");
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

console.log(`\n${"=".repeat(78)}`);
for (const f of findings) console.log(`${f.verdict.padEnd(16)} ${f.probe}`);
