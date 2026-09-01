/**
 * Second weapon pass: the probes the first pass raised questions about.
 *
 *  - W3 flagged pepperbox as "tunneling". Separate its ±6 degree pellet spread — one volley of
 *    three since T12, not three staggered volleys of two — from any real straddle before believing
 *    that.
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
import { Reporter } from "./reporter.js";

const reporter = new Reporter(
  "weapons2",
  "Pellet spread vs tunneling, crossing targets, point-blank angles, spin, dead cars as cover.",
);
const report = reporter.report.bind(reporter);
function carrierOf(weaponId: WeaponId): CarId {
  const id = (Object.keys(CAR_TABLE) as CarId[]).find((c) => slotsOf(c).includes(weaponId));
  if (!id) throw new Error(`no chassis carries ${weaponId}`);
  return id;
}
/**
 * Which slot index (1-based bitmask) carries this weapon on its chassis. Throws rather than
 * silently returning a garbage bit: `1 << -1` is `-2147483648`, and a scenario naming a weapon its
 * chassis no longer carries would otherwise fire that mask and report a clean, empty result —
 * exactly the failure T8 found in three scenarios here and in weapons.ts. A setup mistake like
 * this is allowed to be loud; only the measurement loop over live scenarios has to keep going.
 */
function slotBitFor(carId: CarId, weaponId: WeaponId): number {
  const i = slotsOf(carId).indexOf(weaponId);
  if (i < 0) throw new Error(`${carId} does not carry ${weaponId}`);
  return 1 << i;
}

/* ------------------------------------ W3b. is pepperbox tunneling, or is it just spread? */
/**
 * T12 collapsed pepperbox from three sequential volleys of two pellets (+/-5 degrees, no pellet on
 * the heading) into one volley of THREE pellets at -6/0/+6 degrees. That is a different shape, not
 * just a smaller one: `fanOffset` puts the middle pellet's offset at exactly 0, so — unlike the old
 * fan — one pellet always travels the centre line. The old finding here ("the volley cannot hit a
 * car dead ahead at all beyond ~effective range") was a property of a fan with nothing on-axis, and
 * it cannot recur now that one always exists. What is still worth measuring is whether the two
 * OUTER pellets keep connecting, and whether the always-on-axis pellet ever somehow fails to.
 */
function pepperboxSpread(): void {
  const rows: string[] = [];
  const carrier = carrierOf("pepperbox");
  const bit = slotBitFor(carrier, "pepperbox");
  let centrePelletEverMissed = false;
  for (const base of [60, 120, 200, 300, 450, 560]) {
    let total = 0;
    let dmg = 0;
    let zeroDamagePhases = 0;
    for (let phase = 0; phase < 27; phase++) {
      const distance = base + phase;
      const w = new PlaytestWorld([
        { id: "s", carId: carrier, x: 100, y: 360, angle: 0 },
        { id: "t", carId: "bastion", x: 100 + distance, y: 360, angle: 0 },
      ]);
      const hp0 = w.get("t").hp;
      for (let i = 0; i < 90; i++) {
        w.input("s", { fireSlots: i === 0 ? bit : 0 });
        w.tick();
      }
      const d = hp0 - w.get("t").hp;
      total++;
      dmg += d;
      if (d === 0) zeroDamagePhases++;
    }
    // A total miss (0 damage) at any range inside the weapon's own reach means even the on-axis
    // pellet failed to connect — that IS a finding, unlike the old flanking-pellet miss.
    if (zeroDamagePhases > 0) centrePelletEverMissed = true;
    const outerLateral = base * Math.tan((6 * Math.PI) / 180);
    rows.push(
      `range ~${String(base).padStart(3)}u: mean damage ${(dmg / total).toFixed(0)}/135 max ` +
        `(${zeroDamagePhases}/${total} phases dealt 0${zeroDamagePhases > 0 ? " <- CENTRE PELLET MISSED" : ""}) — ` +
        `outer pellets are ${outerLateral.toFixed(0)}u off axis, target half-width is ` +
        `${DRIVE_CONFIG.carHeight / 2}u + 6u pellet radius`,
    );
  }
  const authoredRange = WEAPON_TABLE.pepperbox.range;
  report(
    "W3b. Pepperbox: pellet spread (not tunneling), and the reach it actually has",
    centrePelletEverMissed ? "FINDING" : "OK",
    `NOT tunneling: W3's flag was a false positive. Pepperbox now fires ONE volley of THREE\n` +
      `pellets at 0/+6/-6 degrees, so — unlike the old two-pellet fan this replaced — one pellet\n` +
      `always travels the heading. A target dead ahead can lose the two flanking pellets to range\n` +
      `(the old finding, and expected) but should never be missed outright inside the weapon's own\n` +
      `${authoredRange}u range, which is also what manual.html advertises.\n` +
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
    if (def.pellets.pelletsPerVolley > 1) continue; // covered by W3b
    const carrier = carrierOf(id);
    const bit = slotBitFor(carrier, id);
    let misses = 0;
    const samples = 80;
    for (let i = 0; i < samples; i++) {
      const distance = 100 + i; // sweeps > 2 full tick-steps of every weapon
      const w = new PlaytestWorld([
        { id: "s", carId: carrier, x: 100, y: 360, angle: 0 },
        { id: "t", carId: "bastion", x: 100 + distance, y: 360, angle: 0 },
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
 * pose. A car crossing the line of fire at top speed moves 19.2 u/tick (Mirage's top speed rose
 * 540 -> 576 in T8's restat); can it end up on the far side of a shot that should have hit it?
 */
function crossingTarget(): void {
  const rows: string[] = [];
  let ghosted = false;
  for (const id of ["predator", "shockwave", "roadblock", "thumper"] as WeaponId[]) {
    const carrier = carrierOf(id);
    const bit = slotBitFor(carrier, id);
    let missesWhileCrossing = 0;
    let total = 0;
    // The target drives across the shot line at top speed; sweep its starting lateral offset so the
    // moment it crosses the line sweeps through the whole tick.
    for (let offset = -40; offset <= 40; offset += 2) {
      const w = new PlaytestWorld([
        { id: "s", carId: carrier, x: 200, y: 360, angle: 0 },
        { id: "t", carId: "mirage", x: 600, y: 360 + offset, angle: -Math.PI / 2, speed: forwardMaxSpeedOf("mirage") },
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
      `${id.padEnd(10)} target crossing at ${forwardMaxSpeedOf("mirage")} u/s: ` +
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
        { id: "t", carId: "bastion", x: 640, y: 360, angle: 0 },
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
    { id: "s", carId: "bullseye", x: 300, y: 360, angle: 0 },
    { id: "t", carId: "bastion", x: 700, y: 360, angle: 0 },
  ]);
  w.get("s").angVel = 6; // the ram spin ceiling
  const bit = slotBitFor("bullseye", "shockwave");
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

/* ------------------------------- W17. is a dead car intangible to shots AND to driving? */
/**
 * There is no wreck. `isOnField` has read `alive` since 2026-08-30, so a car leaves the field the
 * tick its hp reaches 0: not simulated, not solid, not a ram participant, and gone from the hit
 * snapshot. It is only still DRAWN, fading over `DEATH_FADE_MS`.
 *
 * In Deathmatch it leaves and then comes BACK: `respawnSweep` returns it after
 * `DEATHMATCH_TICKS.respawnDelay`, briefly `phased` and so still not solid. These probes run
 * last-standing rules, where the original sentence holds unchanged.
 *
 * Before that a corpse stayed a collision hull — solid to driving but transparent to combat — and
 * this probe existed to document that asymmetry. It now checks the opposite: that both halves agree
 * a corpse stops nothing. Either one blocking again is a FINDING.
 *
 * The trigger has to be RELEASED between shots. Holding `fireSlots` fires once on the press edge and
 * never again, and the phase-2 zero that produces reads exactly like a corpse blocking every shot —
 * which is how this probe used to conclude "not cover" from a run that fired no bullets at all.
 * `shotsFired` is reported so that zero can never be mistaken for a measurement again.
 */
function deadCarIsIntangible(): void {
  const w = new PlaytestWorld([
    { id: "s", carId: "bullseye", x: 200, y: 360, angle: 0, team: 0 },
    { id: "corpse", carId: "bastion", x: 450, y: 360, angle: 0, team: 0, hp: 1 },
    { id: "t", carId: "bastion", x: 700, y: 360, angle: 0, team: 0 },
  ]);
  const bit = slotBitFor("bullseye", "shockwave");
  // Kill the middle car first.
  for (let i = 0; i < 60; i++) {
    w.input("s", { fireSlots: bit });
    w.tick();
    if (!w.get("corpse").alive) break;
  }
  const corpseDead = !w.get("corpse").alive;
  const hp0 = w.get("t").hp;
  let shotsFired = 0;
  let live = w.instances().length;
  for (let i = 0; i < 120; i++) {
    // Release every other tick: the sim fires on a press EDGE, not on a held key.
    w.input("s", { fireSlots: i % 2 === 1 ? 0 : bit });
    w.tick();
    const now = w.instances().length;
    if (now > live) shotsFired += now - live;
    live = now;
  }
  const dealt = hp0 - w.get("t").hp;
  // And is the corpse solid to driving?
  const mover = new PlaytestWorld([
    { id: "m", carId: "mirage", x: 300, y: 360, angle: 0 },
    { id: "dead", carId: "bastion", x: 500, y: 360, angle: 0, hp: 0 },
  ]);
  mover.get("dead").alive = false;
  for (let i = 0; i < 60; i++) {
    mover.input("m", { throttle: 1 });
    mover.tick();
  }
  const blocked = mover.get("m").x < 460;
  const shotsPassed = dealt > 0;
  report(
    "W17. A dead car is intangible to shots and to driving",
    corpseDead && shotsPassed && !blocked ? "OK" : "FINDING",
    `middle car killed: ${corpseDead}. The shooter then fired ${shotsFired} needles through where ` +
      `it died and dealt ${dealt} to the car behind it — the corpse is ` +
      `${shotsPassed ? "not cover" : "acting as COVER"}.\n` +
      `Driving: a live car ran at the corpse and ended at x ${mover.get("m").x.toFixed(0)} ` +
      `(${blocked ? "STILL SOLID" : "drove through"}); it would have stopped near x 452 if solid.\n` +
      `Both halves have to agree: a corpse leaves the field the tick it dies, so it stops neither ` +
      `bullets nor cars. Either one blocking is the regression this probe watches for.`,
  );
}

pepperboxSpread();
trueTunneling();
crossingTarget();
angledPointBlank();
spinningShooter();
deadCarIsIntangible();

reporter.finish();
