/**
 * Last Standing (brawl + team-brawl): does elimination end the match when, and how, it should?
 *
 * Drives the real tick pipeline and `LAST_STANDING_CONTROLLER` through `ModeWorld`
 * (`../shared.ts`). Deaths are real deaths — `killNextTick` routes the lethal hit through combat's
 * damage path, so `alive`, the kill booking and the win check all see what a match would.
 *
 * FFA (brawl) scenarios: kill all but one; the last two die on one tick; a leaver.
 * Team scenarios: wipe team 1; both teams' last cars die on one tick; team 1's last car leaves;
 * friendly fire from every ability projectile, swept over five sub-tick phases.
 */
import { hpOf, rulesOf, weaponDefOf, type CarId } from "@motor-combat-moba/shared";
import { Reporter, VERDICT } from "../../common/reporter.js";
import {
  ModeWorld,
  installFamilyMode,
  killNextTick,
  projectileAbilities,
  row,
  subTickOffsets,
} from "../shared.js";

const mode = installFamilyMode("last-standing");
const sides = rulesOf(mode).sides;

const reporter = new Reporter(
  "elimination",
  "Last Standing: the match ends on the tick the last rival side is eliminated, draws, leavers, and friendly fire (team).",
);

const CAR: CarId = "bastion";
const Y = 360;

function outcomeText(w: ModeWorld): string {
  if (!w.ended) return "no outcome";
  const o = w.ended.outcome;
  return `ended tick ${w.ended.tick}, winnerSessionId "${o.winnerSessionId}", winnerTeam ${o.winnerTeam}`;
}

/**
 * Kill `victims` on one tick and run until the controller answers (or 5 ticks pass). Returns the
 * tick the victims died on, read back off `diedAtTick` rather than assumed — the earliest one (0 if
 * any never died) when they did not all die on the tick the kill was due.
 */
function killAndWatch(w: ModeWorld, victims: readonly string[], killer: string): number {
  w.run(3); // settle: a few ordinary ticks before anything happens
  for (const id of victims) killNextTick(w, id, killer);
  const due = w.state.tick + 1;
  w.run(5);
  // Every victim must have died ON the due tick; anything else reads back as 0 (never died) or a
  // different tick, and the row's "died" figure shows it rather than hiding it.
  const died = victims.map((id) => w.get(id).diedAtTick);
  return died.every((t) => t === due) ? due : Math.min(...died);
}

/* ------------------------------------------------------------------------------ FFA */
function ffaScenarios(): void {
  // E1. Kill all but one.
  {
    const w = new ModeWorld(mode, [
      { id: "a", carId: CAR, x: 300, y: Y, angle: 0 },
      { id: "b", carId: CAR, x: 640, y: Y, angle: 0 },
      { id: "c", carId: CAR, x: 980, y: Y, angle: 0 },
    ]);
    w.start();
    const died = killAndWatch(w, ["b", "c"], "a");
    const ok = !!w.ended && w.ended.tick - died <= 1 && w.ended.outcome.winnerSessionId === "a";
    row(
      reporter,
      "E1. FFA: kill all but one -> survivor wins within 1 tick",
      ok,
      `ends by tick ${died + 1}, winnerSessionId "a"`,
      `${outcomeText(w)}; victims died tick ${died}`,
    );
  }

  // E2. The last two die on the same tick.
  {
    const w = new ModeWorld(mode, [
      { id: "a", carId: CAR, x: 300, y: Y, angle: 0 },
      { id: "b", carId: CAR, x: 980, y: Y, angle: 0 },
    ]);
    w.start();
    const died = killAndWatch(w, ["a", "b"], "");
    const ok =
      !!w.ended &&
      w.ended.tick - died <= 1 &&
      w.ended.outcome.winnerSessionId === "" &&
      w.ended.outcome.winnerTeam === -1;
    row(
      reporter,
      "E2. FFA: last two die on one tick -> draw",
      ok,
      `ends by tick ${died + 1}, winnerSessionId "", winnerTeam -1`,
      `${outcomeText(w)}; both died tick ${died} (a ${w.get("a").diedAtTick}, b ${w.get("b").diedAtTick})`,
    );
  }

  // E3. A leaver.
  {
    const w = new ModeWorld(mode, [
      { id: "a", carId: CAR, x: 300, y: Y, angle: 0 },
      { id: "b", carId: CAR, x: 980, y: Y, angle: 0 },
    ]);
    w.start();
    w.run(10);
    const beforeLeave = w.ended ? outcomeText(w) : "still running";
    const out = w.leave("b");
    const ok = beforeLeave === "still running" && out?.winnerSessionId === "a";
    row(
      reporter,
      "E3. FFA: the only rival leaves -> remaining car wins (afterLeave)",
      ok,
      `still running before the leave; afterLeave -> winnerSessionId "a"`,
      `before: ${beforeLeave}; afterLeave -> ${out ? `winnerSessionId "${out.winnerSessionId}", winnerTeam ${out.winnerTeam}` : "undefined"}`,
    );
  }
}

/* ------------------------------------------------------------------------------ team */
function teamScenarios(): void {
  const twoVtwo = () =>
    new ModeWorld(mode, [
      { id: "a0", carId: CAR, x: 300, y: 250, angle: 0, team: 0 },
      { id: "a1", carId: CAR, x: 300, y: 470, angle: 0, team: 0 },
      { id: "b0", carId: CAR, x: 980, y: 250, angle: Math.PI, team: 1 },
      { id: "b1", carId: CAR, x: 980, y: 470, angle: Math.PI, team: 1 },
    ]);

  // T1. Wipe team 1.
  {
    const w = twoVtwo();
    w.start();
    const died = killAndWatch(w, ["b0", "b1"], "a0");
    const ok = !!w.ended && w.ended.tick - died <= 1 && w.ended.outcome.winnerTeam === 0;
    row(
      reporter,
      "T1. Team: wipe team 1 -> winnerTeam 0 within 1 tick",
      ok,
      `ends by tick ${died + 1}, winnerTeam 0`,
      `${outcomeText(w)}; team 1 died tick ${died}`,
    );
  }

  // T2. Both teams' last cars die on one tick.
  {
    const w = twoVtwo();
    w.start();
    w.run(3);
    killNextTick(w, "a1", "b1");
    killNextTick(w, "b1", "a1");
    w.run(3);
    const mid = w.ended ? outcomeText(w) : "still running";
    const died = killAndWatch(w, ["a0", "b0"], "");
    const ok =
      mid === "still running" &&
      !!w.ended &&
      w.ended.tick - died <= 1 &&
      w.ended.outcome.winnerTeam === -1;
    row(
      reporter,
      "T2. Team: each side's last car dies on one tick -> draw",
      ok,
      `still running at 1v1; ends by tick ${died + 1}, winnerTeam -1`,
      `after first trade: ${mid}; ${outcomeText(w)}; last cars died tick ${died}`,
    );
  }

  // T3. Team 1's last car leaves.
  {
    const w = twoVtwo();
    w.start();
    w.run(5);
    const first = w.leave("b0");
    const second = w.leave("b1");
    const ok = first === undefined && second?.winnerTeam === 0;
    row(
      reporter,
      "T3. Team: every team-1 car leaves -> winnerTeam 0 (afterLeave)",
      ok,
      "first leave: undefined; second leave: winnerTeam 0",
      `first leave: ${first ? `winnerTeam ${first.winnerTeam}` : "undefined"}; ` +
        `second leave: ${second ? `winnerTeam ${second.winnerTeam}` : "undefined"}`,
    );
  }

  // T4. Friendly fire: a team-0 projectile over a team-0 car deals nothing. Every active ability
  // projectile, at five sub-tick phases, with an enemy control at the identical geometry so a
  // zero reads as "blocked by team", never as "missed".
  {
    const lines: string[] = [];
    let leaks = 0;
    let unmeasured = 0;
    for (const { weaponId, carId, bit } of projectileAbilities()) {
      const def = weaponDefOf(weaponId);
      const base = Math.min(def.range * 0.4, def.range - 20);
      const perTick = def.speed / 30;
      const shoot = (distance: number, targetTeam: 0 | 1) => {
        const w = new ModeWorld(mode, [
          { id: "shooter", carId, x: 200, y: Y, angle: 0, team: 0 },
          { id: "target", carId: CAR, x: 200 + distance, y: Y, angle: 0, team: targetTeam },
        ]);
        w.start();
        w.input("shooter", { fireSlots: bit });
        w.run(90);
        return { damage: hpOf(CAR) - w.get("target").hp, selfHp: w.get("shooter").hp };
      };
      const mates: number[] = [];
      const foes: number[] = [];
      for (const d of subTickOffsets(base, perTick)) {
        const mate = shoot(d, 0);
        const foe = shoot(d, 1);
        mates.push(mate.damage);
        foes.push(foe.damage);
        if (mate.damage > 0 || mate.selfHp !== hpOf(carId)) leaks++;
        if (foe.damage === 0) unmeasured++;
      }
      lines.push(
        `${weaponId.padEnd(12)} (${carId}) at ${base.toFixed(0)}u + 0..4/5 tick: ` +
          `teammate took [${mates.join(", ")}]  enemy took [${foes.join(", ")}]`,
      );
    }
    // A control that dealt 0 means the geometry never hit, so that phase's teammate 0 proves
    // nothing — surfaced as a FINDING against the probe rather than read as a pass.
    const verdict = leaks > 0 || unmeasured > 0 ? VERDICT.FINDING : VERDICT.OK;
    reporter.report(
      "T4. Team: friendly fire from every ability projectile, 5 sub-tick phases",
      verdict,
      `expected: teammate 0 damage at every phase, shooter unhurt\n` +
        `measured: ${leaks} leak(s); ${unmeasured} enemy control(s) that dealt 0 (geometry never hit)\n` +
        lines.join("\n"),
    );
  }
}

if (sides === "team") teamScenarios();
else ffaScenarios();

reporter.finish();
