import { describe, expect, it } from "vitest";
import {
  INITIAL_ZONE,
  captureCountdownSeconds,
  conquerLeaveOutcome,
  conquerOutcome,
  controlPercentText,
  inControl,
  stepZone,
  zonePresence,
  type ZoneState,
} from "./conquer.js";

const D = 150;
const T = 1800;
const run = (z: ZoneState, present: [number, number], n: number): ZoneState => {
  let s = z;
  for (let i = 0; i < n; i++) s = stepZone(s, present, D, T);
  return s;
};

describe("zonePresence (CQ18)", () => {
  const zone = { x: 0, y: 0, radius: 100 };
  it("counts living roster cars whose CENTRE is inside, per team", () => {
    expect(
      zonePresence(zone, [
        { x: 0, y: 100, team: 0, alive: true, inRoster: true }, // on the rim: in
        { x: 0, y: 101, team: 0, alive: true, inRoster: true }, // just out
        { x: 10, y: 0, team: 1, alive: true, inRoster: true },
        { x: 0, y: 0, team: 1, alive: false, inRoster: true }, // dead: out
        { x: 0, y: 0, team: 0, alive: true, inRoster: false }, // left the match: out
      ]),
    ).toStrictEqual([1, 1]);
  });
});

describe("stepZone (CQ19)", () => {
  it("an empty zone does nothing", () => {
    expect(run(INITIAL_ZONE, [0, 0], 500)).toStrictEqual(INITIAL_ZONE);
  });

  it("takes control on the D-th tick and fills from the next one", () => {
    const at = run(INITIAL_ZONE, [1, 0], D);
    expect(at.holder).toBe(0);
    expect(at.streak).toBe(D);
    expect(inControl(at, D)).toBe(0);
    expect(at.controlTicks).toStrictEqual([0, 0]);
    expect(stepZone(at, [1, 0], D, T).controlTicks).toStrictEqual([1, 0]);
  });

  it("saturates the streak at D", () => {
    expect(run(INITIAL_ZONE, [2, 0], D + 40).streak).toBe(D);
  });

  it("contested freezes both bars and resets the countdown; leaving restarts it from zero", () => {
    const filling = run(INITIAL_ZONE, [1, 0], D + 10);
    expect(filling.controlTicks).toStrictEqual([10, 0]);
    const contested = stepZone(filling, [1, 1], D, T);
    expect(contested).toStrictEqual({ controlTicks: [10, 0], holder: -1, streak: 0, contested: true });
    const back = run(contested, [1, 0], D);
    expect(back.controlTicks).toStrictEqual([10, 0]); // D ticks of countdown again, no fill yet
    expect(stepZone(back, [1, 0], D, T).controlTicks).toStrictEqual([11, 0]);
  });

  it("the holder dying (present -> 0) resets the streak for team B too", () => {
    const b = run(INITIAL_ZONE, [0, 1], 100);
    const gone = stepZone(b, [0, 0], D, T);
    expect(gone.holder).toBe(-1);
    expect(gone.streak).toBe(0);
    expect(gone.contested).toBe(false);
  });

  it("switching holder restarts the streak at 1", () => {
    const a = run(INITIAL_ZONE, [1, 0], 50);
    expect(stepZone(a, [0, 1], D, T)).toMatchObject({ holder: 1, streak: 1 });
  });

  it("caps the bar at the target", () => {
    const nearly: ZoneState = { controlTicks: [T - 1, 0], holder: 0, streak: D, contested: false };
    expect(run(nearly, [1, 0], 5).controlTicks).toStrictEqual([T, 0]);
  });
});

describe("conquerOutcome (CQ21)", () => {
  const z = (a: number, b: number, holder: -1 | 0 | 1 = -1, streak = 0): ZoneState => ({
    controlTicks: [a, b],
    holder,
    streak,
    contested: false,
  });

  it("a full bar wins, even on the tick the clock expires", () => {
    expect(conquerOutcome(z(T, 5), 1000, 1000, false, D, T)).toStrictEqual({ ended: true, winnerTeam: 0 });
    expect(conquerOutcome(z(5, T), 999, 1000, false, D, T)).toStrictEqual({ ended: true, winnerTeam: 1 });
  });

  it("before the clock nothing ends", () => {
    expect(conquerOutcome(z(900, 10), 999, 1000, false, D, T)).toStrictEqual({ ended: false, overtime: false });
  });

  it("at the clock the higher bar wins", () => {
    expect(conquerOutcome(z(900, 10), 1000, 1000, false, D, T)).toStrictEqual({ ended: true, winnerTeam: 0 });
    expect(conquerOutcome(z(1, 2), 1000, 1000, false, D, T)).toStrictEqual({ ended: true, winnerTeam: 1 });
  });

  it("a tie at the clock starts overtime, including 0-0", () => {
    expect(conquerOutcome(z(0, 0), 1000, 1000, false, D, T)).toStrictEqual({ ended: false, overtime: true });
    expect(conquerOutcome(z(77, 77), 1000, 1000, false, D, T)).toStrictEqual({ ended: false, overtime: true });
  });

  it("in overtime the first team in control wins; a countdown alone does not", () => {
    expect(conquerOutcome(z(0, 0, 1, D - 1), 1300, 1000, true, D, T)).toStrictEqual({ ended: false, overtime: true });
    expect(conquerOutcome(z(0, 0, 1, D), 1301, 1000, true, D, T)).toStrictEqual({ ended: true, winnerTeam: 1 });
  });

  it("a team already in control when overtime starts wins on the next evaluation", () => {
    const tied = z(40, 40, 0, D);
    expect(conquerOutcome(tied, 1000, 1000, false, D, T)).toStrictEqual({ ended: false, overtime: true });
    expect(conquerOutcome(tied, 1001, 1000, true, D, T)).toStrictEqual({ ended: true, winnerTeam: 0 });
  });

  it("matchEndsTick 0 means no clock (never ends on time)", () => {
    expect(conquerOutcome(z(1, 0), 99999, 0, false, D, T)).toStrictEqual({ ended: false, overtime: false });
  });
});

describe("conquerLeaveOutcome (CQ23)", () => {
  it("an emptied team loses; both empty is a draw; otherwise play on", () => {
    expect(conquerLeaveOutcome([0, 2])).toStrictEqual({ ended: true, winnerTeam: 1 });
    expect(conquerLeaveOutcome([1, 0])).toStrictEqual({ ended: true, winnerTeam: 0 });
    expect(conquerLeaveOutcome([0, 0])).toStrictEqual({ ended: true, winnerTeam: -1 });
    expect(conquerLeaveOutcome([2, 3])).toStrictEqual({ ended: false });
  });
});

describe("HUD text helpers (CQ3, CQ55)", () => {
  it("floors the percentage to two decimals and never shows 100% early", () => {
    expect(controlPercentText(0, T)).toBe("0.00%");
    expect(controlPercentText(765, T)).toBe("42.50%");
    expect(controlPercentText(T - 1, T)).toBe("99.94%");
    expect(controlPercentText(T, T)).toBe("100.00%");
  });
  it("counts the capture down 5..1 and reads 0 once in control", () => {
    expect(captureCountdownSeconds(1, D, 30)).toBe(5);
    expect(captureCountdownSeconds(120, D, 30)).toBe(1);
    expect(captureCountdownSeconds(D, D, 30)).toBe(0);
  });
});
