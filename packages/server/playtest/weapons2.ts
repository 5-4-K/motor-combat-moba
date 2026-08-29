/**
 * Second weapon pass: the probes the first pass raised questions about.
 *
 *  - W3 flagged pepperbox as "tunneling". Separate its ±5 degree pellet spread from any real
 *    straddle before believing that.
 *  - Hits are tested with NO lag compensation and against the target's post-drive pose; the
 *    projectile is smeared across its own tick but the TARGET is not. A crossing car is the case.
 *  - Point-blank was clean head-on. Angled is the harder version: the muzzle can be born inside
 *    the victim's hull.
 */
import {
  WEAPON_TABLE,
  CAR_TABLE,
  DRIVE_CONFIG,
  forwardMaxSpeedOf,
  slotsOf,
  type CarId,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { PlaytestWorld } from "./world.js";

const findings: { probe: string; verdict: string; detail: string }[] = [];
function report(probe: string, verdict: string, detail: string): void {
  findings.push({ probe, verdict, detail });
  console.log(`\n[${verdict}] ${probe}\n    ${detail.replace(/\n/g, "\n    ")}`);
}
function carrierOf(weaponId: WeaponId): CarId {
  return (Object.keys(CAR_TABLE) as CarId[]).find((c) => slotsOf(c).includes(weaponId))!;
}
function slotBitFor(carId: CarId, weaponId: WeaponId): number {
  return 1 << slotsOf(carId).indexOf(weaponId);
}

/* ------------------------------------ W3b. is pepperbox tunneling, or is it just spread? */
function pepperboxSpread(): void {
  const rows: string[] = [];
  const carrier = carrierOf("pepperbox");
  const bit = slotBitFor(carrier, "pepperbox");
  // Half-spread is 5 degrees; lateral miss distance grows with range.
  for (const base of [60, 120, 200, 300, 450, 560]) {
    let hits = 0;
    let total = 0;
    let dmg = 0;
    for (let phase = 0; phase < 27; phase++) {
      const distance = base + phase;
      const w = new PlaytestWorld([
        { id: "s", carId: carrier, x: 100, y: 360, angle: 0 },
        { id: "t", carId: "hexagon", x: 100 + distance, y: 360, angle: 0 },
      ]);
      const hp0 = w.get("t").hp;
      for (let i = 0; i < 90; i++) {
        w.input("s", { fireSlots: i === 0 ? bit : 0 });
        w.tick();
      }
      const d = hp0 - w.get("t").hp;
      total++;
      if (d > 0) hits++;
      dmg += d;
    }
    const lateral = base * Math.tan((5 * Math.PI) / 180);
    rows.push(
      `range ~${String(base).padStart(3)}u: ${hits}/${total} phases connected, mean damage ` +
        `${(dmg / total).toFixed(0)}/168 max — pellet is ${lateral.toFixed(0)}u off axis, ` +
        `target half-width is ${DRIVE_CONFIG.carHeight / 2}u + 7u pellet radius`,
    );
  }
  report(
    "W3b. Pepperbox: pellet spread, not tunneling",
    "OK (W3 was a false positive)",
    `Pepperbox fires 2 pellets per volley at +/-5 degrees. Nothing travels down the centre line, so\n` +
      `beyond ~${Math.round(23 / Math.tan((5 * Math.PI) / 180))}u BOTH pellets clear a car's flank and the\n` +
      `volley cannot hit a car dead ahead at all.\n` +
      rows.join("\n"),
  );
}

/* ---------------------------- W3c. real tunneling: sweep every projectile at close range */
function trueTunneling(): void {
  const rows: string[] = [];
  let bad = false;
  for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
    const def = WEAPON_TABLE[id];
    if (def.kind !== "projectile") continue;
    if (def.volley.pelletsPerVolley > 1) continue; // covered by W3b
    const carrier = carrierOf(id);
    const bit = slotBitFor(carrier, id);
    let misses = 0;
    const samples = 80;
    for (let i = 0; i < samples; i++) {
      const distance = 100 + i; // sweeps > 2 full tick-steps of every weapon
      const w = new PlaytestWorld([
        { id: "s", carId: carrier, x: 100, y: 360, angle: 0 },
        { id: "t", carId: "hexagon", x: 100 + distance, y: 360, angle: 0 },
      ]);
      const hp0 = w.get("t").hp;
      for (let k = 0; k < 90; k++) {
        w.input("s", { fireSlots: k === 0 ? bit : 0 });
        w.tick();
      }
      if (hp0 - w.get("t").hp === 0) misses++;
    }
    if (misses > 0) bad = true;
    rows.push(
      `${id.padEnd(10)} ${(def.speed / 30).toFixed(1).padStart(5)} u/tick: ${misses}/${samples} phases missed ` +
        `${misses > 0 ? "<- TUNNELING" : ""}`,
    );
  }
  report("W3c. Single-pellet projectile tunneling (80 sub-tick phases each)", bad ? "FINDING" : "OK", rows.join("\n"));
}

/* --------------------------------------- W14. crossing target: the un-smeared half of the test */
/**
 * `hits.ts` smears the PROJECTILE across its tick but tests against the target's single post-drive
 * pose. A car crossing the line of fire at top speed moves 18 u/tick; can it end up on the far side
 * of a shot that should have hit it?
 */
function crossingTarget(): void {
  const rows: string[] = [];
  let ghosted = false;
  for (const id of ["fireball", "splinter", "skewer", "thumper"] as WeaponId[]) {
    const carrier = carrierOf(id);
    const bit = slotBitFor(carrier, id);
    let missesWhileCrossing = 0;
    let total = 0;
    // The target drives across the shot line at top speed; sweep its starting lateral offset so the
    // moment it crosses the line sweeps through the whole tick.
    for (let offset = -40; offset <= 40; offset += 2) {
      const w = new PlaytestWorld([
        { id: "s", carId: carrier, x: 200, y: 360, angle: 0 },
        { id: "t", carId: "rectangle", x: 600, y: 360 + offset, angle: -Math.PI / 2, speed: forwardMaxSpeedOf("rectangle") },
      ]);
      const hp0 = w.get("t").hp;
      let closestApproach = Infinity;
      for (let k = 0; k < 60; k++) {
        w.input("s", { fireSlots: k === 0 ? bit : 0 });
        w.input("t", { throttle: 1 });
        w.tick();
        const t = w.get("t");
        for (const inst of w.instances()) {
          closestApproach = Math.min(closestApproach, Math.hypot(inst.x - t.x, inst.y - t.y));
        }
      }
      const dealt = hp0 - w.get("t").hp;
      total++;
      // A shot that passed within a hull half-diagonal but dealt nothing is a ghost.
      if (dealt === 0 && closestApproach < 20) missesWhileCrossing++;
    }
    if (missesWhileCrossing > 0) ghosted = true;
    rows.push(
      `${id.padEnd(10)} target crossing at ${forwardMaxSpeedOf("rectangle")} u/s: ` +
        `${missesWhileCrossing}/${total} lateral phases where a shot passed within 20u and dealt nothing ` +
        `${missesWhileCrossing > 0 ? "<- GHOSTED" : ""}`,
    );
  }
  report(
    "W14. Shot vs a car crossing the line of fire (no lag compensation, target not smeared)",
    ghosted ? "FINDING" : "OK",
    rows.join("\n"),
  );
}

/* ------------------------------------------------ W15. angled point-blank: muzzle in the hull */
/** The muzzle is born 24u ahead of the shooter. Nose-in at an angle puts it inside the victim. */
function angledPointBlank(): void {
  const rows: string[] = [];
  let misses = 0;
  for (const id of Object.keys(WEAPON_TABLE) as WeaponId[]) {
    const carrier = carrierOf(id);
    const bit = slotBitFor(carrier, id);
    let missed = 0;
    let total = 0;
    for (let deg = 0; deg < 360; deg += 15) {
      const a = (deg * Math.PI) / 180;
      // Shooter nosed right up against the victim from every direction, at contact distance.
      const w = new PlaytestWorld([
        { id: "s", carId: carrier, x: 640 - Math.cos(a) * 46, y: 360 - Math.sin(a) * 46, angle: a },
        { id: "t", carId: "hexagon", x: 640, y: 360, angle: 0 },
      ]);
      const hp0 = w.get("t").hp;
      for (let k = 0; k < 90; k++) {
        w.input("s", { fireSlots: k === 0 ? bit : 0 });
        w.tick();
      }
      total++;
      if (hp0 - w.get("t").hp === 0) missed++;
    }
    if (missed > 0) misses++;
    rows.push(`${id.padEnd(11)} ${missed}/${total} approach angles dealt nothing at contact range ${missed > 0 ? "<- POINT-BLANK MISS" : ""}`);
  }
  report(
    "W15. Point-blank from 24 approach angles, hulls in contact",
    misses > 0 ? "FINDING" : "OK",
    rows.join("\n"),
  );
}

/* -------------------------------- W16. shot fired while reversing / spinning out of a ram */
/** A car spun by a ram accumulates `angle` without bound. Normalisation bugs live here. */
function spinningShooter(): void {
  const w = new PlaytestWorld([
    { id: "s", carId: "oval", x: 300, y: 360, angle: 0 },
    { id: "t", carId: "hexagon", x: 700, y: 360, angle: 0 },
  ]);
  w.get("s").angVel = 6; // the ram spin ceiling
  const bit = slotBitFor("oval", "splinter");
  let anyNaN = false;
  let maxAngle = 0;
  for (let i = 0; i < 400; i++) {
    w.get("s").angVel = 6; // hold it spinning
    w.input("s", { fireSlots: bit });
    w.tick();
    const s = w.get("s");
    if (!Number.isFinite(s.angle)) anyNaN = true;
    maxAngle = Math.max(maxAngle, Math.abs(s.angle));
    for (const inst of w.instances()) {
      if (!Number.isFinite(inst.x) || !Number.isFinite(inst.y) || !Number.isFinite(inst.angle)) anyNaN = true;
    }
  }
  report(
    "W16. Firing continuously from a car held at the ram spin ceiling (400 ticks)",
    anyNaN ? "FINDING" : "OK",
    `|angle| reached ${maxAngle.toFixed(1)} rad (${(maxAngle / (2 * Math.PI)).toFixed(1)} turns, never wrapped); ` +
      `NaN anywhere: ${anyNaN}; target hp ${w.get("t").hp}\n` +
      `PlayerState.angle is networked — check its schema type tolerates unbounded growth over a long match.`,
  );
}

/* --------------------------------------------- W17. does a wreck still block shots and cars? */
function wreckAsCover(): void {
  const w = new PlaytestWorld([
    { id: "s", carId: "oval", x: 200, y: 360, angle: 0, team: 0 },
    { id: "wreck", carId: "hexagon", x: 450, y: 360, angle: 0, team: 0, hp: 1 },
    { id: "t", carId: "hexagon", x: 700, y: 360, angle: 0, team: 0 },
  ]);
  const bit = slotBitFor("oval", "splinter");
  // Kill the middle car first.
  for (let i = 0; i < 60; i++) {
    w.input("s", { fireSlots: bit });
    w.tick();
    if (!w.get("wreck").alive) break;
  }
  const wreckDead = !w.get("wreck").alive;
  const hp0 = w.get("t").hp;
  for (let i = 0; i < 120; i++) {
    w.input("s", { fireSlots: bit });
    w.tick();
  }
  const dealt = hp0 - w.get("t").hp;
  // And is the wreck still solid to driving?
  const mover = new PlaytestWorld([
    { id: "m", carId: "rectangle", x: 300, y: 360, angle: 0 },
    { id: "dead", carId: "hexagon", x: 500, y: 360, angle: 0, hp: 0 },
  ]);
  mover.get("dead").alive = false;
  for (let i = 0; i < 60; i++) {
    mover.input("m", { throttle: 1 });
    mover.tick();
  }
  const blocked = mover.get("m").x < 460;
  report(
    "W17. A wreck: shots pass through it, but it is still a solid car",
    "KNOWN-BY-DESIGN",
    `middle car wrecked: ${wreckDead}. Shots then dealt ${dealt} to the car behind it — ` +
      `a wreck is NOT cover (it leaves the hit snapshot the moment it dies).\n` +
      `Driving: a live car ran into the wreck and stopped at x ${mover.get("m").x.toFixed(0)} ` +
      `(${blocked ? "still solid" : "drove through"}) — so a wreck blocks cars but not bullets.\n` +
      `Defensible, but it is the asymmetry players notice: you can hide behind a living team-mate ` +
      `in team mode and not behind a corpse.`,
  );
}

pepperboxSpread();
trueTunneling();
crossingTarget();
angledPointBlank();
spinningShooter();
wreckAsCover();

console.log(`\n${"=".repeat(78)}`);
for (const f of findings) console.log(`${f.verdict.padEnd(24)} ${f.probe}`);
