/**
 * Conquer: the capture zone, the control bars, the clock, overtime and the leaver rule.
 *
 * Drives the real tick pipeline and `CONQUER_CONTROLLER.afterTick` (which steps the zone off the
 * poses the tick just produced) through `ModeWorld` (`../shared.ts`), on the arena the mode plays.
 * Cars are PLACED in and out of the zone with `teleport` — the zone reads centres, not routes, and
 * a probe that drove there would be measuring the drive model.
 *
 * Vocabulary (spec CQ18–CQ23): the *holder* is the team whose unopposed streak is running (set on
 * the first tick of presence); a team is *in control* once that streak reaches `captureDelay`; the
 * bar fills one tick per tick after that.
 */
import { derived, getArena } from "@motor-combat-moba/shared";
import { Reporter, VERDICT } from "../../common/reporter.js";
import { ModeWorld, installFamilyMode, row } from "../shared.js";

const mode = installFamilyMode("conquer");

const reporter = new Reporter(
  "zone",
  "Conquer: capture delay, 1/tick control, contest freeze, full-bar win, clock win, overtime, and the empty-team leaver rule.",
);

/** The zone and three places around it: centre, a second in-zone seat, and each team's parking spot. */
function spots(w: ModeWorld) {
  const zone = getArena(w.state.arenaId).zone;
  if (!zone) throw new Error(`arena ${w.state.arenaId} has no zone`);
  return {
    zone,
    inA: { x: zone.x, y: zone.y },
    inB: { x: zone.x, y: zone.y - 90 }, // clear of the first car's hull, well inside the radius
    outA: { x: zone.x, y: zone.y + 620 },
    outB: { x: zone.x, y: zone.y - 620 },
  };
}

/** One team-0 car and one team-1 car, both parked outside the zone. */
function duel(): { w: ModeWorld; s: ReturnType<typeof spots> } {
  const w = new ModeWorld(mode, [
    { id: "a", carId: "bastion", x: 0, y: 0, angle: 0, team: 0 },
    { id: "b", carId: "bastion", x: 0, y: 0, angle: Math.PI, team: 1 },
  ]);
  const s = spots(w);
  w.teleport("a", s.outA.x, s.outA.y, 0);
  w.teleport("b", s.outB.x, s.outB.y, Math.PI);
  w.start();
  return { w, s };
}

function bars(w: ModeWorld): string {
  const z = w.state;
  return `bars A ${z.controlTicksA} / B ${z.controlTicksB}, holder ${z.zoneHolder}, streak ${z.zoneStreakTicks}, contested ${z.zoneContested}, overtime ${z.overtime}`;
}

/* ------------------------------------------------------------- Z1. capture, then 1/tick */
function capture(): void {
  const { captureDelay } = derived().conquerTicks;
  const { w, s } = duel();
  w.teleport("a", s.inA.x, s.inA.y);
  const entered = w.state.tick; // first tick in the zone is entered + 1
  let holderTick = 0;
  let controlTick = 0;
  let firstFillTick = 0;
  let badFill = 0;
  let prevA = 0;
  w.run(captureDelay + 101, (tick) => {
    if (!holderTick && w.state.zoneHolder === 0) holderTick = tick;
    if (!controlTick && w.state.zoneHolder === 0 && w.state.zoneStreakTicks >= captureDelay) controlTick = tick;
    if (!firstFillTick && w.state.controlTicksA > 0) firstFillTick = tick;
    if (firstFillTick && w.state.controlTicksA - prevA !== 1) badFill++;
    prevA = w.state.controlTicksA;
  });
  const inControlAfter = controlTick - entered;
  const fillTicks = w.state.tick - firstFillTick + 1;
  row(
    reporter,
    "Z1. One team-0 car in the zone: in control after exactly captureDelay ticks, then +1 per tick",
    inControlAfter === captureDelay && firstFillTick === controlTick + 1 && badFill === 0 &&
      w.state.controlTicksA === fillTicks,
    `in control ${captureDelay} ticks after entering; first fill the tick after; +1 on every tick after that`,
    `in control ${inControlAfter} ticks after entering (tick ${controlTick}); first fill tick ${firstFillTick}; ` +
      `${fillTicks} fill ticks -> bar A ${w.state.controlTicksA}; ticks that did not add exactly 1: ${badFill}`,
  );
  reporter.report(
    "Z1b. zoneHolder is set on the FIRST tick in the zone, not at capture",
    holderTick === entered + 1 ? VERDICT.BY_DESIGN : VERDICT.FINDING,
    `zoneHolder read 0 on tick ${holderTick} (${holderTick - entered} tick after entering); in control on tick ${controlTick}.\n` +
      "The task brief phrases capture as \"zoneHolder becomes 0 after captureDelay ticks\". By spec (CQ18-CQ19,\n" +
      "`ZoneState.holder`) the holder is the team whose streak is RUNNING — it is what drives the gutter's\n" +
      "\"TAKING CONTROL · n\" countdown — and control is `holder` plus `streak >= captureDelay`. Z1 measures that.",
  );
}

/* ------------------------------------------------------------- Z2. contest freezes both bars */
function contest(): void {
  const { captureDelay } = derived().conquerTicks;
  const { w, s } = duel();
  w.teleport("a", s.inA.x, s.inA.y);
  w.run(captureDelay + 30);
  const before = { a: w.state.controlTicksA, b: w.state.controlTicksB };
  w.teleport("b", s.inB.x, s.inB.y, Math.PI);
  let contestedTicks = 0;
  let moved = 0;
  const hold = 60;
  w.run(hold, () => {
    if (w.state.zoneContested && w.state.zoneHolder === -1) contestedTicks++;
    if (w.state.controlTicksA !== before.a || w.state.controlTicksB !== before.b) moved++;
  });
  const during = bars(w);
  // The contest ends; team 0 must build a fresh streak from zero (CQ19) before its bar moves again.
  w.teleport("b", s.outB.x, s.outB.y, Math.PI);
  const cleared = w.state.tick;
  let resumed = 0;
  w.run(captureDelay + 10, (tick) => {
    if (!resumed && w.state.controlTicksA > before.a) resumed = tick;
  });
  row(
    reporter,
    "Z2. A team-1 car entering sets zoneContested and freezes both bars",
    contestedTicks === hold && moved === 0 && resumed - cleared === captureDelay + 1,
    `contested (holder -1) on all ${hold} ticks, bars unchanged at A ${before.a} / B ${before.b}; ` +
      `after it clears, A resumes ${captureDelay + 1} ticks later (a fresh ${captureDelay}-tick streak)`,
    `contested on ${contestedTicks}/${hold} ticks, bars moved on ${moved}; at the end: ${during}; ` +
      `A resumed ${resumed - cleared} ticks after the contest cleared`,
  );
}

/* ------------------------------------------------------------- Z3. full bar ends it before the clock */
function fullBar(): void {
  const { captureDelay, controlTarget } = derived().conquerTicks;
  const { w, s } = duel();
  w.teleport("a", s.inA.x, s.inA.y);
  const entered = w.state.tick;
  w.run(captureDelay + controlTarget + 20);
  const expectedEnd = entered + captureDelay + controlTarget;
  row(
    reporter,
    "Z3. Team 0 alone reaches controlTarget -> wins before the clock",
    !!w.ended && w.ended.outcome.winnerTeam === 0 && w.ended.tick === expectedEnd && w.ended.tick < w.state.matchEndsTick,
    `ends tick ${expectedEnd} (captureDelay ${captureDelay} + controlTarget ${controlTarget}), winnerTeam 0, before matchEndsTick ${w.state.matchEndsTick}`,
    w.ended
      ? `ended tick ${w.ended.tick}, winnerTeam ${w.ended.outcome.winnerTeam}; ${bars(w)}`
      : `never ended; ${bars(w)}`,
  );
}

/**
 * Give each team `fillA` / `fillB` ticks of bar, one team at a time, then park both outside and
 * run to the clock. Returns the world at whatever tick the match ended (or 20 past the clock).
 */
function barsThenClock(fillA: number, fillB: number): ModeWorld {
  const { captureDelay } = derived().conquerTicks;
  const { w, s } = duel();
  if (fillA > 0) {
    w.teleport("a", s.inA.x, s.inA.y);
    w.run(captureDelay + fillA);
    w.teleport("a", s.outA.x, s.outA.y, 0);
    w.tick(); // the zone empties: holder -1, bars stay
  }
  if (fillB > 0) {
    w.teleport("b", s.inA.x, s.inA.y, Math.PI);
    w.run(captureDelay + fillB);
    w.teleport("b", s.outB.x, s.outB.y, Math.PI);
    w.tick();
  }
  w.run(w.state.matchEndsTick - w.state.tick + 20);
  return w;
}

/* ------------------------------------------------------------- Z4. the clock: higher bar wins */
function clockWin(): void {
  const w = barsThenClock(50, 100);
  row(
    reporter,
    "Z4. At matchEndsTick the higher bar wins (A 50, B 100 -> team 1)",
    !!w.ended && w.ended.tick === w.state.matchEndsTick && w.ended.outcome.winnerTeam === 1,
    `ends on matchEndsTick ${w.state.matchEndsTick}, winnerTeam 1`,
    w.ended ? `ended tick ${w.ended.tick}, winnerTeam ${w.ended.outcome.winnerTeam}; ${bars(w)}` : `never ended; ${bars(w)}`,
  );
}

/* ------------------------------------------------------------- Z5. equal bars: overtime */
function overtime(): void {
  const { captureDelay } = derived().conquerTicks;
  const w = barsThenClock(100, 100);
  const atClock = { ended: !!w.ended, overtime: w.state.overtime, text: bars(w) };
  // Overtime resolves to whoever next takes control.
  const { inA } = spots(w);
  w.teleport("a", inA.x, inA.y);
  const entered = w.state.tick;
  w.run(captureDelay + 20);
  row(
    reporter,
    "Z5. Equal bars at matchEndsTick -> overtime; the next team to take control wins",
    !atClock.ended && atClock.overtime && !!w.ended && w.ended.outcome.winnerTeam === 0 &&
      w.ended.tick === entered + captureDelay,
    `not ended and overtime true at the clock; team 0 then wins ${captureDelay} ticks after entering`,
    `at the clock: ended ${atClock.ended}, ${atClock.text}; then ` +
      (w.ended ? `ended ${w.ended.tick - entered} ticks after entering, winnerTeam ${w.ended.outcome.winnerTeam}` : "never ended"),
  );
}

/* ------------------------------------------------------------- Z6. an emptied team loses */
function leaver(): void {
  const w = new ModeWorld(mode, [
    { id: "a0", carId: "bastion", x: 0, y: 0, angle: 0, team: 0 },
    { id: "a1", carId: "mirage", x: 0, y: 0, angle: 0, team: 0 },
    { id: "b0", carId: "bastion", x: 0, y: 0, angle: Math.PI, team: 1 },
    { id: "b1", carId: "mirage", x: 0, y: 0, angle: Math.PI, team: 1 },
  ]);
  const s = spots(w);
  w.teleport("a0", s.outA.x - 100, s.outA.y, 0);
  w.teleport("a1", s.outA.x + 100, s.outA.y, 0);
  w.teleport("b0", s.outB.x - 100, s.outB.y, Math.PI);
  w.teleport("b1", s.outB.x + 100, s.outB.y, Math.PI);
  w.start();
  w.run(10);
  const first = w.leave("b0");
  const second = w.leave("b1");
  row(
    reporter,
    "Z6. Every team-1 car leaving -> afterLeave gives team 0 the win",
    first === undefined && second?.winnerTeam === 0 && second.winnerSessionId === "",
    "first leave: undefined; second leave: winnerTeam 0",
    `first leave: ${first ? `winnerTeam ${first.winnerTeam}` : "undefined"}; ` +
      `second leave: ${second ? `winnerTeam ${second.winnerTeam}, winnerSessionId "${second.winnerSessionId}"` : "undefined"}`,
  );
}

capture();
contest();
fullBar();
clockWin();
overtime();
leaver();

reporter.finish();
