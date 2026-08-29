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

console.log("=".repeat(78));
console.log("PROBE R1 — does a ram fire at all, as a function of where the tick grid lands?");
console.log("=".repeat(78));
console.log(
  "A hexagon (mass 85, the designated rammer) at top speed hits a stationary oval.\n" +
    "`startGap` is the clearance at t=0; the car covers 10.5 u/tick, so sweeping the gap\n" +
    "sweeps the sub-tick phase of the impact — the only thing that differs between these runs.\n",
);

for (const side of ["rear", "flank", "front"] as const) {
  const line: string[] = [];
  let fired = 0;
  let total = 0;
  for (let gap = 0; gap < 21; gap += 1) {
    const r = ramOf(gap, "hexagon", "oval", side);
    total++;
    if (r.shove > 0.01) fired++;
    line.push(r.shove > 0.01 ? `${gap}:${r.shove.toFixed(0)}` : `${gap}:--`);
  }
  console.log(`${side.toUpperCase().padEnd(6)} fired on ${fired}/${total} approach phases`);
  console.log(`       ${line.join(" ")}`);
}

console.log(`\n${"=".repeat(78)}`);
console.log("PROBE R2 — the same sweep for every attacker/victim pair, as a hit rate");
console.log("=".repeat(78));
const cars: CarId[] = ["rectangle", "oval", "hexagon"];
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
      out.push(`${side} ${String(Math.round((fired / 21) * 100)).padStart(3)}% (peak ${peak.toFixed(0)})`);
    }
    console.log(`${atk.padEnd(9)} -> ${vic.padEnd(9)} ${out.join("   ")}`);
  }
}

console.log(`\n${"=".repeat(78)}`);
console.log("PROBE R3 — why: attacker speed before vs after resolveWorld, on the contact tick");
console.log("=".repeat(78));
{
  const w = new PlaytestWorld([
    { id: "atk", carId: "hexagon", x: 640 - 48 - 4, y: 360, angle: 0, speed: forwardMaxSpeedOf("hexagon") },
    { id: "vic", carId: "oval", x: 640, y: 360, angle: 0 },
  ]);
  console.log(
    `minApproachSpeed is ${RAM_CONFIG.minApproachSpeed}; restitution rebounds a head-on ` +
      `contact to -35% of impact speed.\n`,
  );
  for (let i = 0; i < 4; i++) {
    const before = w.get("atk").speed;
    w.input("atk", { throttle: 1 });
    w.tick();
    const a = w.get("atk");
    const v = w.get("vic");
    console.log(
      `t${i + 1}: attacker speed ${before.toFixed(1)} -> ${a.speed.toFixed(1)} after resolve; ` +
        `ram sees ${a.speed.toFixed(1)} ` +
        `${a.speed < RAM_CONFIG.minApproachSpeed ? "(BELOW minApproachSpeed - no ram)" : "(ram fires)"}; ` +
        `victim shove ${Math.hypot(v.shoveX, v.shoveY).toFixed(1)}`,
    );
  }
}

console.log(`\n${"=".repeat(78)}`);
console.log("PROBE R4 — a realistic driven ram: accelerate from rest into a parked car");
console.log("=".repeat(78));
console.log("The approach a player actually makes — no teleported starting speed.\n");
for (const atk of cars) {
  let fired = 0;
  const runs = 40;
  let peakShove = 0;
  for (let d = 0; d < runs; d++) {
    // Vary the run-up distance by 1 unit per run: same drive, different sub-tick impact phase.
    const w = new PlaytestWorld([
      { id: "atk", carId: atk, x: 300 + d, y: 360, angle: 0 },
      { id: "vic", carId: "oval", x: 640, y: 360, angle: 0 },
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
  console.log(
    `${atk.padEnd(9)} rear-ends a parked oval from ${runs} different run-up distances: ` +
      `${fired}/${runs} landed a knock (${Math.round((fired / runs) * 100)}%), peak shove ${peakShove.toFixed(0)} u/s`,
  );
}
