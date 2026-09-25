/**
 * Deathmatch: the respawn timer, spawn protection (`phased`), the match clock and the ranking.
 *
 * Drives the real tick pipeline — `respawnSweep` at the top of the tick, `runPipeline` (with its
 * `phaseEndSweep`), then `DEATHMATCH_CONTROLLER.afterTick` — through `ModeWorld` (`../shared.ts`).
 * Deaths are real deaths (`killNextTick`), so `diedAtTick`, the kill booking and the respawn gate
 * all see what a live match would.
 */
import {
  activeCarIds,
  derived,
  drive,
  forwardMaxSpeedOf,
  forwardOf,
  hpOf,
  isSolid,
  weaponDefOf,
  type CarId,
} from "@motor-combat-moba/shared";
import { Reporter } from "../../common/reporter.js";
import { statusesOf } from "../../common/world.js";
import { readStatuses } from "../../../src/sim/status-bridge.js";
import {
  ModeWorld,
  installFamilyMode,
  killNextTick,
  projectileAbilities,
  row,
  subTickOffsets,
} from "../shared.js";

const mode = installFamilyMode("deathmatch");

const reporter = new Reporter(
  "respawn",
  "Deathmatch: respawn delay, spawn protection (no ram contact, shots pass through), the match clock, and kills-then-deaths ranking.",
);

const Y = 360;
const CAR: CarId = "bastion";

/** A duel with `victim` killed by `killer`; returns the world, the death tick and the respawn tick. */
function killAndRespawn(
  spawns: ConstructorParameters<typeof ModeWorld>[1],
  victim: string,
  killer: string,
  onTick?: (w: ModeWorld) => void,
): { w: ModeWorld; died: number; respawned: number; deadAfterKill: boolean } {
  const w = new ModeWorld(mode, spawns);
  w.start();
  w.run(3);
  killNextTick(w, victim, killer);
  w.tick();
  const died = w.get(victim).diedAtTick;
  // The loop below stops on the first alive tick, so "dead on the kill tick" is the whole check.
  const deadAfterKill = !w.get(victim).alive;
  let respawned = 0;
  const limit = derived().deathmatchTicks.respawnDelay + 10;
  for (let i = 0; i < limit && respawned === 0; i++) {
    w.tick();
    onTick?.(w);
    if (w.get(victim).alive) respawned = w.state.tick;
  }
  return { w, died, respawned, deadAfterKill };
}

/* ------------------------------------------------------------- R1. respawn delay */
function respawnDelay(): void {
  const t = derived().deathmatchTicks;
  const { w, died, respawned, deadAfterKill } = killAndRespawn(
    [
      { id: "a", carId: CAR, x: 300, y: Y, angle: 0 },
      { id: "b", carId: CAR, x: 980, y: Y, angle: Math.PI },
    ],
    "b",
    "a",
  );
  const expected = died + t.respawnDelay;
  const ok = died > 0 && deadAfterKill && Math.abs(respawned - expected) <= 1;
  row(
    reporter,
    "R1. Killed at tick T -> dead until T + respawnDelay, respawns within +-1 tick",
    ok,
    `respawnDelay ${t.respawnDelay} ticks; died T, back on tick T + ${t.respawnDelay}`,
    `died tick ${died}, alive again tick ${respawned} (delta ${respawned - died}); ` +
      `dead from the kill tick until then: ${deadAfterKill}`,
    `kill booked: a.kills ${w.get("a").kills}, b.deaths ${w.get("b").deaths}; ` +
      `b.hp after respawn ${w.get("b").hp}/${hpOf(CAR)}`,
  );
}

/* ------------------------------------------------------------- R2. spawn protection window */
function phaseWindow(): void {
  const t = derived().deathmatchTicks;
  const { w } = killAndRespawn(
    [
      { id: "a", carId: CAR, x: 300, y: Y, angle: 0 },
      { id: "b", carId: CAR, x: 980, y: Y, angle: Math.PI },
    ],
    "b",
    "a",
  );
  // `killAndRespawn` stopped on the respawn tick. Sample from the NEXT tick's pre-pipeline moment;
  // the respawn tick itself is read now (its pipeline ran with the status already written — M21).
  const b = w.get("b");
  const respawnTick = w.state.tick;
  const solidAtRespawn = isSolid({ status: b.status, alive: b.alive, statuses: readStatuses(b) }, respawnTick);
  let phasedTicks = w.isPhased("b") ? 1 : 0;
  let counting = true;
  w.beforePipeline = () => {
    if (!counting) return;
    if (w.isPhased("b")) phasedTicks++;
    else counting = false;
  };
  w.run(t.phaseMax + 10);
  const ok = solidAtRespawn === false && phasedTicks >= t.phase && phasedTicks <= t.phaseMax;
  row(
    reporter,
    "R2. After respawn the car is phased for >= phase ticks (idle, nothing overlapping)",
    ok,
    `not solid on the respawn tick; phased for >= ${t.phase} ticks (cap ${t.phaseMax})`,
    `respawned tick ${respawnTick}, solid then: ${solidAtRespawn}; phased on ${phasedTicks} simulated ticks`,
  );
}

/* ------------------------------------------------------------- R3. ram at max speed while phased */
function ramWhilePhased(): void {
  // The fastest active chassis is the hardest possible ram.
  const rammer = activeCarIds().reduce((best, id) =>
    forwardMaxSpeedOf(id) > forwardMaxSpeedOf(best) ? id : best,
  );
  const vmax = forwardMaxSpeedOf(rammer);
  const perTick = vmax / 30;
  const halfLength = drive().carWidth / 2;
  const halfWidth = drive().carHeight / 2;

  /**
   * Placed, as every probe places: the victim broadside in open floor, the rammer's nose `gap`
   * short of its flank at full speed, throttle held. Statuses are collected on every tick rather
   * than read at the end, so a short `ramLock` that expired before the last tick still counts.
   */
  const ramRun = (w: ModeWorld, gap: number) => {
    w.teleport("b", 640, Y, Math.PI / 2);
    w.teleport("a", 640 - halfWidth - halfLength - gap, Y, 0);
    const a = w.get("a");
    a.vx = vmax;
    a.vy = 0;
    let minDist = Infinity;
    let bMaxSpeed = 0;
    let phasedThroughout = true;
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      w.input("a", { throttle: 1 });
      if (!w.isPhased("b")) phasedThroughout = false;
      w.tick();
      const b = w.get("b");
      minDist = Math.min(minDist, Math.hypot(a.x - b.x, a.y - b.y));
      bMaxSpeed = Math.max(bMaxSpeed, Math.hypot(b.vx, b.vy));
      for (const st of statusesOf(a)) seen.add(`a:${st.statusId}`);
      for (const st of statusesOf(b)) seen.add(`b:${st.statusId}`);
    }
    const touched = bMaxSpeed > 1 || seen.has("a:ramLock") || seen.has("b:reeling") || w.get("b").hp < hpOf(CAR);
    const text =
      `closest centres ${minDist.toFixed(1).padStart(5)}u, victim peak speed ${bMaxSpeed.toFixed(1).padStart(5)}, ` +
      `rammer fwd speed after ${forwardOf(a.vx, a.vy, a.angle).toFixed(1).padStart(5)}, statuses seen [${[...seen].join(",")}]`;
    return { touched, minDist, phasedThroughout, text };
  };

  const lines: string[] = [];
  let contacts = 0;
  let unmet = 0;
  let controlMissed = 0;
  for (const gap of subTickOffsets(20, perTick)) {
    const { w } = killAndRespawn(
      [
        { id: "a", carId: rammer, x: 300, y: Y, angle: 0 },
        { id: "b", carId: CAR, x: 980, y: Y, angle: Math.PI },
      ],
      "b",
      "a",
    );
    const phased = ramRun(w, gap);
    if (phased.touched) contacts++;
    if (phased.minDist > 20 || !phased.phasedThroughout) unmet++;

    // Control: the identical ram into a solid car must register, or the zero above proves nothing.
    const c = new ModeWorld(mode, [
      { id: "a", carId: rammer, x: 300, y: Y, angle: 0 },
      { id: "b", carId: CAR, x: 980, y: Y, angle: Math.PI },
    ]);
    c.start();
    c.run(3);
    const control = ramRun(c, gap);
    if (!control.touched) controlMissed++;

    lines.push(
      `gap ${gap.toFixed(1).padStart(5)}u  phased: ${phased.text}, phased throughout ${phased.phasedThroughout}\n` +
        `             control: ${control.text}`,
    );
  }
  row(
    reporter,
    `R3. A ${rammer} ram at max speed (${vmax.toFixed(1)} u/s) through a phased car, 5 sub-tick phases`,
    contacts === 0 && unmet === 0 && controlMissed === 0,
    "phased: no contact at any phase (victim never moves, no reeling / ramLock, hp untouched) and the " +
      "cars actually meet; the solid control rams at every phase",
    `${contacts} phase(s) with contact; ${unmet} phase(s) where the cars never met or protection lapsed; ` +
      `${controlMissed} control(s) with no ram`,
    lines.join("\n"),
  );
}

/* ------------------------------------------------------------- R4. projectiles pass through */
function shotsWhilePhased(): void {
  const lines: string[] = [];
  let hits = 0;
  let unmeasured = 0;
  for (const { weaponId, carId, bit } of projectileAbilities()) {
    const def = weaponDefOf(weaponId);
    const perTick = def.speed / 30;
    // Close enough that the shot lands well inside the phase window (<= 15 ticks of flight).
    const base = Math.min(def.range * 0.4, def.range - 20, perTick * 15);
    const phasedDamage: number[] = [];
    const controlDamage: number[] = [];
    for (const d of subTickOffsets(base, perTick)) {
      // Phased target: killed, respawned, then placed at `d`.
      const { w } = killAndRespawn(
        [
          { id: "a", carId, x: 200, y: Y, angle: 0 },
          { id: "b", carId: CAR, x: 980, y: Y, angle: Math.PI },
        ],
        "b",
        "a",
      );
      w.teleport("a", 200, Y, 0);
      w.teleport("b", 200 + d, Y, 0);
      w.input("a", { fireSlots: bit });
      let stayedPhased = true;
      for (let i = 0; i < 30; i++) {
        if (!w.isPhased("b")) stayedPhased = false;
        w.tick();
      }
      phasedDamage.push(hpOf(CAR) - w.get("b").hp);
      if (!stayedPhased) unmeasured++;

      // Control: the identical geometry, target solid.
      const c = new ModeWorld(mode, [
        { id: "a", carId, x: 200, y: Y, angle: 0 },
        { id: "b", carId: CAR, x: 200 + d, y: Y, angle: 0 },
      ]);
      c.start();
      c.input("a", { fireSlots: bit });
      c.run(30);
      const dealt = hpOf(CAR) - c.get("b").hp;
      controlDamage.push(dealt);
      if (dealt === 0) unmeasured++;
    }
    hits += phasedDamage.filter((x) => x > 0).length;
    lines.push(
      `${weaponId.padEnd(12)} (${carId}) at ${base.toFixed(0)}u + 0..4/5 tick: ` +
        `phased took [${phasedDamage.join(", ")}]  solid control took [${controlDamage.join(", ")}]`,
    );
  }
  row(
    reporter,
    "R4. Every ability projectile passes through a phased car, 5 sub-tick phases",
    hits === 0 && unmeasured === 0,
    "phased target 0 damage at every phase; the solid control is hit at every phase",
    `${hits} phase(s) where the phased car took damage; ${unmeasured} phase(s) unmeasured ` +
      `(control missed, or protection lapsed mid-flight)`,
    lines.join("\n"),
  );
}

/* ------------------------------------------------------------- R5/R6. the clock and the ranking */
function clockAndRanking(): void {
  const t = derived().deathmatchTicks;
  const w = new ModeWorld(mode, [
    { id: "a", carId: CAR, x: 300, y: 250, angle: 0 },
    { id: "b", carId: CAR, x: 300, y: 470, angle: 0 },
    { id: "c", carId: CAR, x: 980, y: Y, angle: Math.PI },
  ]);
  w.start();
  const endsTick = w.state.matchEndsTick;
  // The tallies are written straight onto the scoreboard fields `DEATHMATCH_CONTROLLER` ranks on;
  // staging seven real kills would measure the respawn loop again, not the ranking.
  const set = (id: string, kills: number, deaths: number) => {
    w.get(id).kills = kills;
    w.get(id).deaths = deaths;
  };
  set("a", 3, 1);
  set("b", 3, 0);
  set("c", 0, 6);
  w.run(t.match + 10);
  row(
    reporter,
    "R5. The match ends at matchEndsTick exactly",
    !!w.ended && endsTick === w.state.matchStartedAtTick + t.match && w.ended.tick === endsTick,
    `matchEndsTick = start ${w.state.matchStartedAtTick} + ${t.match}; ends on tick ${endsTick}`,
    w.ended ? `matchEndsTick ${endsTick}; ended on tick ${w.ended.tick}` : `matchEndsTick ${endsTick}; never ended`,
  );
  row(
    reporter,
    "R6. Ranking is kills, then fewest deaths (a 3/1, b 3/0, c 0/6 -> b)",
    w.ended?.outcome.winnerSessionId === "b",
    `winnerSessionId "b", winnerTeam -1`,
    w.ended
      ? `winnerSessionId "${w.ended.outcome.winnerSessionId}", winnerTeam ${w.ended.outcome.winnerTeam}`
      : "no outcome",
  );
}

respawnDelay();
phaseWindow();
ramWhilePhased();
shotsWhilePhased();
clockAndRanking();

reporter.finish();
