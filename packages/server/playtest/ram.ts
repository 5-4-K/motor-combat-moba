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
  "Ram trigger rate as a function of the sub-tick phase of the impact, and whether a chase can ram-lock.",
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

/* ------------------------------------------------------- R5. ram-lock: chase in open space */
/**
 * Can the roster's heaviest rammer hold the roster's lightest car in a knock loop, or does one
 * clean escape window always exist? Bastion (mass 90) rear-ends a bullseye (mass 30) that starts
 * at rest with the whole arena open in front of it; from the impact on, both hold full throttle
 * and the victim steers to straighten out — the best escape a player could drive. Bullseye's top
 * speed rating (52) beats Bastion's (30), so the design intent is that control returns and the
 * gap opens; a phase where it never does is a lock the ram's edge-triggering was built to forbid.
 *
 * Swept two ways: the approach gap (the sub-tick phase of the first impact, as R1) and a small
 * lateral offset — a real chase ram lands slightly off-centre, and the off-centre hit is the one
 * that imparts spin, which is the realistic "can never straighten out" hazard.
 */
function chaseRamLock(): void {
  const rows: string[] = [];
  let worstEscape = { escaped: true, gap: 0, phase: "", rams: 0 };
  let maxRams = 0;
  let minAuthoritySeen = 1;
  for (const offset of [0, 6, 12]) {
    let escapes = 0;
    let runs = 0;
    let worstGap = Infinity;
    let ramsAtWorst = 0;
    for (let gap = 0; gap < 21; gap++) {
      const w = new PlaytestWorld([
        {
          id: "atk",
          carId: "bastion",
          x: 260 - 48 - gap,
          y: 360 + offset,
          angle: 0,
          speed: forwardMaxSpeedOf("bastion"),
        },
        { id: "vic", carId: "bullseye", x: 260, y: 360, angle: 0 },
      ]);
      let rams = 0;
      let prevShove = 0;
      let minAuthority = 1;
      let midGap = 0;
      const ticks = 240;
      let t = 0;
      for (; t < ticks; t++) {
        const v = w.get("vic");
        // The victim drives its escape: full throttle up the open lane, steering to straighten —
        // a P-controller on heading, which is also what counter-steers any injected spin.
        w.input("atk", { throttle: 1 });
        w.input("vic", { throttle: 1, steer: Math.max(-1, Math.min(1, -v.angle * 3)) });
        w.tick();
        const shove = Math.hypot(w.get("vic").shoveX, w.get("vic").shoveY);
        // Knock only decays between impacts, so any rise is a fresh ram landing.
        if (shove > prevShove + 5) rams++;
        prevShove = shove;
        minAuthority = Math.min(minAuthority, w.get("vic").authority);
        if (t === Math.floor(ticks / 2)) midGap = w.get("vic").x - w.get("atk").x - 48;
        // The runway ends where open space does: stop at the far wall, judge what we have.
        if (w.get("vic").x > 1280 - 60) break;
      }
      const finalGap = w.get("vic").x - w.get("atk").x - 48;
      // Escaped = clear separation that is still growing when the runway ends. A locked victim
      // ends piled near the attacker (small gap, not growing) whatever tick the run stopped on.
      const escaped = finalGap >= 60 && finalGap > midGap;
      runs++;
      if (escaped) escapes++;
      maxRams = Math.max(maxRams, rams);
      minAuthoritySeen = Math.min(minAuthoritySeen, minAuthority);
      if (finalGap < worstGap) {
        worstGap = finalGap;
        ramsAtWorst = rams;
      }
      if (!escaped && (worstEscape.escaped || finalGap < worstEscape.gap)) {
        worstEscape = { escaped: false, gap: finalGap, phase: `offset ${offset} gap ${gap}`, rams };
      }
    }
    rows.push(
      `offset ${String(offset).padStart(2)}u: escaped ${escapes}/${runs} phases, ` +
        `worst final gap ${worstGap.toFixed(0)}u (${ramsAtWorst} rams landed on that run)`,
    );
  }
  report(
    "R5. Ram-lock: heaviest rammer chasing the lightest car up an open lane",
    worstEscape.escaped ? "OK" : "FINDING",
    `bastion (mass 90, top speed rating 30) rear-ends a resting bullseye (mass 30, rating 52) and ` +
      `keeps chasing; the victim floors it and straightens out. 63 runs: approach gap 0-20 x ` +
      `lateral offset {0, 6, 12}.\n` +
      rows.join("\n") +
      `\nmost rams landed in any single run: ${maxRams}; deepest authority dip ${minAuthoritySeen.toFixed(2)} ` +
      `(RAM_CONFIG.authorityFloor ${RAM_CONFIG.authorityFloor}).` +
      (worstEscape.escaped
        ? `\nEvery phase escaped: the first knock is the attacker's whole payday — by the time ` +
          `authority recovers the speed advantage has the gap opening, and the edge-triggered ram ` +
          `never re-fires without a genuine re-approach.`
        : `\nNOT ESCAPED at ${worstEscape.phase}: final gap ${worstEscape.gap.toFixed(0)}u after ` +
          `${worstEscape.rams} rams — the knock loop closed faster than control returned.`),
  );
}

const report = reporter.report.bind(reporter);

triggerPhaseSweep();
pairingMatrix();
speedBeforeAndAfterResolve();
drivenRam();
chaseRamLock();

reporter.finish();
