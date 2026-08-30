/**
 * Ram probes.
 *
 * The pipeline is `serverTick` (drive + resolveWorld) -> `ramTick` -> combat. `resolveWorld`
 * reflects `speed` on contact; `resolveRam` then reads that same `speed` to compute the approach
 * term. So the order in which a ram is measured relative to its own bounce is the whole question
 * here, and the tick grid decides it.
 */
import { RAM_CONFIG, forwardMaxSpeedOf, type CarId } from "@motor-combat-moba/shared";
import { PlaytestWorld } from "./world.js";
import { Reporter } from "./reporter.js";

function ramOf(
  startGap: number,
  atkCar: CarId,
  vicCar: CarId,
  side: "rear" | "front" | "flank",
  ticks = 8,
): { shove: number; angVel: number; authority: number; approachAtContact: number } {
  // Victim at the origin facing +x. Attacker approaches along +x from behind (rear), from in front
  // (front, victim facing -x), or from above (flank).
  const vy = 360;
  const vx = 640;
  const setups = {
    rear: { va: 0, ax: vx - 48 - startGap, ay: vy, aa: 0 },
    front: { va: Math.PI, ax: vx - 48 - startGap, ay: vy, aa: 0 },
    flank: { va: 0, ax: vx, ay: vy - 40 - startGap, aa: Math.PI / 2 },
  } as const;
  const s = setups[side];
  const w = new PlaytestWorld([
    { id: "atk", carId: atkCar, x: s.ax, y: s.ay, angle: s.aa, speed: forwardMaxSpeedOf(atkCar) },
    { id: "vic", carId: vicCar, x: vx, y: vy, angle: s.va },
  ]);

  let best = { shove: 0, angVel: 0, authority: 1, approachAtContact: 0 };
  for (let i = 0; i < ticks; i++) {
    const speedBefore = w.get("atk").speed;
    w.input("atk", { throttle: 1 });
    w.tick();
    const v = w.get("vic");
    const shove = Math.hypot(v.shoveX, v.shoveY);
    if (shove > best.shove) {
      best = { shove, angVel: v.angVel, authority: v.authority, approachAtContact: speedBefore };
    }
  }
  return best;
}

const reporter = new Reporter(
  "ram",
  "Ram trigger rate as a function of the sub-tick phase of the impact.",
);

/* ------------------------------------------------------------------ R1. does a ram fire at all */
function triggerPhaseSweep(): void {
  const rows: string[] = [];
  let worstRate = 1;
  for (const side of ["rear", "flank", "front"] as const) {
    const line: string[] = [];
    let fired = 0;
    let total = 0;
    for (let gap = 0; gap < 21; gap += 1) {
      const r = ramOf(gap, "bastion", "bullseye", side);
      total++;
      if (r.shove > 0.01) fired++;
      line.push(r.shove > 0.01 ? `${gap}:${r.shove.toFixed(0)}` : `${gap}:--`);
    }
    worstRate = Math.min(worstRate, fired / total);
    rows.push(`${side.toUpperCase().padEnd(6)} fired on ${fired}/${total} approach phases`);
    rows.push(`       ${line.join(" ")}`);
  }
  report(
    "R1. Does a ram fire at all, as a function of where the tick grid lands?",
    worstRate < 0.9 ? "FINDING" : "OK",
    "A bastion (mass 90, the designated rammer) at top speed hits a stationary bullseye.\n" +
      "`startGap` is the clearance at t=0; the car covers 10.5 u/tick, so sweeping the gap sweeps\n" +
      "the sub-tick phase of the impact — the only thing that differs between these runs.\n" +
      rows.join("\n"),
  );
}

/* ------------------------------------------------- R2. the same sweep for every chassis pairing */
function pairingMatrix(): void {
  const rows: string[] = [];
  let worstRate = 1;
  const cars: CarId[] = ["mirage", "bullseye", "bastion"];
  for (const atk of cars) {
    for (const vic of cars) {
      const out: string[] = [];
      for (const side of ["rear", "flank", "front"] as const) {
        let fired = 0;
        let peak = 0;
        for (let gap = 0; gap < 21; gap++) {
          const r = ramOf(gap, atk, vic, side);
          if (r.shove > 0.01) fired++;
          peak = Math.max(peak, r.shove);
        }
        worstRate = Math.min(worstRate, fired / 21);
        out.push(`${side} ${String(Math.round((fired / 21) * 100)).padStart(3)}% (peak ${peak.toFixed(0)})`);
      }
      rows.push(`${atk.padEnd(9)} -> ${vic.padEnd(9)} ${out.join("   ")}`);
    }
  }
  report(
    "R2. Ram hit rate across every attacker/victim pairing",
    worstRate < 0.9 ? "FINDING" : "OK",
    rows.join("\n"),
  );
}

/* ------------------------------------------------------------------------- R3. the mechanism */
/**
 * The regression guard for the trigger fix.
 *
 * `resolveWorld` still reflects the attacker's `speed` on the contact tick — that is the drive
 * model working as designed. What changed is that ram no longer READS that number: `serverTick`
 * reports the speed each car carried into the tick, and `ramTick` uses it as the approach term.
 *
 * So the shape this probe asserts is deliberately odd-looking: the attacker's post-resolve speed is
 * deeply negative AND the victim is knocked, on the same tick. If those two ever stop coinciding,
 * the approach term has been rewired back to the post-collision value and the 8-20% trigger rate is
 * back.
 */
function speedBeforeAndAfterResolve(): void {
  const w = new PlaytestWorld([
    { id: "atk", carId: "bastion", x: 640 - 48 - 4, y: 360, angle: 0, speed: forwardMaxSpeedOf("bastion") },
    { id: "vic", carId: "bullseye", x: 640, y: 360, angle: 0 },
  ]);
  const rows: string[] = [];
  let firedOnContactTick = false;
  let rebounded = false;
  for (let i = 0; i < 4; i++) {
    const carriedIn = w.get("atk").speed;
    w.input("atk", { throttle: 1 });
    w.tick();
    const a = w.get("atk");
    const v = w.get("vic");
    const shove = Math.hypot(v.shoveX, v.shoveY);
    // The contact tick is the first one on which a knock appears.
    if (i === 0) {
      firedOnContactTick = shove > 0.01;
      rebounded = a.speed < 0;
    }
    rows.push(
      `t${i + 1}: carried in ${carriedIn.toFixed(1)} -> ${a.speed.toFixed(1)} after resolveWorld; ` +
        `ram's approach term is the carried-in ${carriedIn.toFixed(1)} ` +
        `${carriedIn >= RAM_CONFIG.minApproachSpeed ? "(>= minApproachSpeed)" : "(below minApproachSpeed)"}; ` +
        `victim shove ${shove.toFixed(1)}`,
    );
  }
  report(
    "R3. The fix: ram reads the carried-in speed, not the post-resolve rebound",
    firedOnContactTick && rebounded ? "OK" : "FINDING",
    `minApproachSpeed is ${RAM_CONFIG.minApproachSpeed}; restitution still rebounds a head-on ` +
      `contact to -35% of impact speed.\n` +
      rows.join("\n") +
      `\nOn the contact tick the attacker rebounded (${rebounded}) AND the victim was knocked ` +
      `(${firedOnContactTick}). Both must hold: the rebound is the drive model, the knock is the ` +
      `fix. Shove on later ticks is the first knock decaying — ram is edge-triggered, so holding ` +
      `the throttle does not re-fire it.`,
  );
}

/* ------------------------------------------------------------- R4. the approach a player makes */
function drivenRam(): void {
  const rows: string[] = [];
  let worstRate = 1;
  for (const atk of ["mirage", "bullseye", "bastion"] as CarId[]) {
    let fired = 0;
    const runs = 40;
    let peakShove = 0;
    for (let d = 0; d < runs; d++) {
      // Vary the run-up distance by 1 unit per run: same drive, different sub-tick impact phase.
      const w = new PlaytestWorld([
        { id: "atk", carId: atk, x: 300 + d, y: 360, angle: 0 },
        { id: "vic", carId: "bullseye", x: 640, y: 360, angle: 0 },
      ]);
      let shove = 0;
      for (let i = 0; i < 90; i++) {
        w.input("atk", { throttle: 1 });
        w.tick();
        const v = w.get("vic");
        shove = Math.max(shove, Math.hypot(v.shoveX, v.shoveY));
      }
      if (shove > 0.01) fired++;
      peakShove = Math.max(peakShove, shove);
    }
    worstRate = Math.min(worstRate, fired / runs);
    rows.push(
      `${atk.padEnd(9)} rear-ends a parked bullseye from ${runs} different run-up distances: ` +
        `${fired}/${runs} landed a knock (${Math.round((fired / runs) * 100)}%), ` +
        `peak shove ${peakShove.toFixed(0)} u/s`,
    );
  }
  report(
    "R4. A realistic driven ram: accelerate from rest into a parked car",
    worstRate < 0.9 ? "FINDING" : "OK",
    "The approach a player actually makes — no teleported starting speed.\n" + rows.join("\n"),
  );
}

const report = reporter.report.bind(reporter);

triggerPhaseSweep();
pairingMatrix();
speedBeforeAndAfterResolve();
drivenRam();

reporter.finish();
