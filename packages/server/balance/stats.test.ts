import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ, type CarId, type DamagedEvent, type FiredEvent, type KilledEvent, type WeaponId } from "@motor-combat-moba/shared";
import { aggregate, wilson } from "./stats.js";
import type { MatchOutcome } from "./match.js";

// ---- local fixture builders -------------------------------------------------------------------
// Kept in this file, not in stats.ts, because they ARE the readability of every assertion below:
// each test constructs exactly the events it needs and nothing else.

type Seat = MatchOutcome["seats"][number];

function seat(overrides: Partial<Seat> & { sessionId: string; carId: CarId }): Seat {
  return {
    kills: 0,
    deaths: 0,
    aliveTicks: 100,
    phasedTicks: 0,
    hp: 100,
    placement: 1,
    ...overrides,
  };
}

/** One `MatchOutcome`, defaulted to a two-seat mirage-vs-bastion match with no events and no
 * winner (a draw), so a test only has to spell out the fields it cares about. */
function synthetic(opts: {
  fired?: readonly FiredEvent[];
  damaged?: readonly DamagedEvent[];
  killed?: readonly KilledEvent[];
  seats?: readonly Seat[];
  winnerSessionId?: string;
  ticks?: number;
  hitClock?: boolean;
}): MatchOutcome {
  return {
    ticks: opts.ticks ?? 100,
    winnerSessionId: opts.winnerSessionId ?? "",
    winnerTeam: -1,
    hitClock: opts.hitClock ?? false,
    seats: opts.seats ?? [
      seat({ sessionId: "a", carId: "mirage", placement: 1 }),
      seat({ sessionId: "b", carId: "bastion", placement: 2 }),
    ],
    events: {
      fired: [...(opts.fired ?? [])],
      damaged: [...(opts.damaged ?? [])],
      killed: [...(opts.killed ?? [])],
    },
  };
}

/** One `DamagedEvent` from a plain `weapon` source — the ordinary case, a hit measured directly
 * off the event rather than inferred through a status (contrast the overheated/pulse test below). */
function dmg(opts: {
  pressId: string;
  weaponId: WeaponId;
  amount: number;
  tick?: number;
  attackerSessionId?: string;
  attackerCarId?: CarId | null;
  victimSessionId?: string;
  victimCarId?: CarId;
  killingBlow?: boolean;
}): DamagedEvent {
  return {
    tick: opts.tick ?? 1,
    victimSessionId: opts.victimSessionId ?? "b",
    victimCarId: opts.victimCarId ?? "bastion",
    attackerSessionId: opts.attackerSessionId ?? "a",
    attackerCarId: opts.attackerCarId ?? "mirage",
    source: { kind: "weapon", weaponId: opts.weaponId, pressId: opts.pressId, isExplosion: false },
    amount: opts.amount,
    killingBlow: opts.killingBlow ?? false,
  };
}

describe("wilson (B35)", () => {
  it("brackets the point estimate", () => {
    const i = wilson(50, 100);
    expect(i.rate).toBeCloseTo(0.5, 6);
    expect(i.low).toBeLessThan(0.5);
    expect(i.high).toBeGreaterThan(0.5);
  });

  it("narrows as n grows", () => {
    const small = wilson(5, 10);
    const large = wilson(500, 1000);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("stays inside [0, 1] at the extremes", () => {
    expect(wilson(0, 10).low).toBeGreaterThanOrEqual(0);
    expect(wilson(10, 10).high).toBeLessThanOrEqual(1);
  });

  it("returns a zero-width interval at the origin for n = 0", () => {
    expect(wilson(0, 0)).toEqual({ rate: 0, low: 0, high: 0, n: 0 });
  });

  it("matches a hand-computed interval at 50/100 (z = 1.959964)", () => {
    // p = 0.5, n = 100, z^2 = 3.8414588...
    // centre = (0.5 + 3.8414588/200) / (1 + 3.8414588/100) = 0.519207... / 1.038414... = 0.500000...
    // halfWidth = (z/1.038414...) * sqrt(0.25/100 + 3.8414588/40000) = 1.887249... * sqrt(0.0025 + 0.0000960...)
    //           = 1.887249... * 0.050953... = 0.096171...
    const i = wilson(50, 100);
    expect(i.low).toBeCloseTo(0.404, 3);
    expect(i.high).toBeCloseTo(0.596, 3);
  });
});

describe("aggregate (B30, B31)", () => {
  it("counts a press as one shot however many pellets it spawns", () => {
    const out = aggregate([
      synthetic({
        fired: [{ pressId: "a#1#1", weaponId: "pepperbox", shooterSessionId: "a", carId: "bullseye", slot: 1, tick: 1 }],
        damaged: [
          dmg({ pressId: "a#1#1", weaponId: "pepperbox", amount: 9 }),
          dmg({ pressId: "a#1#1", weaponId: "pepperbox", amount: 9 }),
        ],
      }),
    ]);
    const row = out.weapons.find((w) => w.weaponId === "pepperbox")!;
    expect(row.presses).toBe(1);
    expect(row.connectingPresses).toBe(1);
    expect(row.hitRate.rate).toBe(1);
    expect(row.damage).toBe(18);
  });

  it("counts a press that landed nothing as a miss", () => {
    const out = aggregate([
      synthetic({
        fired: [{ pressId: "a#1#0", weaponId: "lance", shooterSessionId: "a", carId: "bullseye", slot: 0, tick: 1 }],
        damaged: [],
      }),
    ]);
    expect(out.weapons.find((w) => w.weaponId === "lance")!.hitRate.rate).toBe(0);
  });

  it("credits overheated pulse damage to afterburner and tracks it separately (B5a)", () => {
    const out = aggregate([
      synthetic({
        fired: [{ pressId: "a#1#0", weaponId: "afterburner", shooterSessionId: "a", carId: "mirage", slot: 0, tick: 1 }],
        damaged: [
          dmg({ pressId: "a#1#0", weaponId: "afterburner", amount: 50 }),
          {
            tick: 5,
            victimSessionId: "b",
            victimCarId: "bastion",
            attackerSessionId: "a",
            attackerCarId: "mirage",
            source: { kind: "pulse", statusId: "overheated", sourceSessionId: "a" },
            amount: 8,
            killingBlow: false,
          },
        ],
      }),
    ]);
    const row = out.weapons.find((w) => w.weaponId === "afterburner")!;
    expect(row.damage).toBe(58);
    expect(row.derivedDamage).toBe(8);
  });

  it("reports a weapon that is never pressed, so an ignored row is visible (B31)", () => {
    const out = aggregate([synthetic({ fired: [], damaged: [] })]);
    expect(out.weapons.some((w) => w.presses === 0)).toBe(true);
  });

  it("gives every chassis a full set of weapon rows regardless of what any match's events mention", () => {
    const out = aggregate([synthetic({ fired: [], damaged: [] })]);
    // 3 chassis x 3 slots each, per CAR_TABLE — every row present, none invented, none missing.
    expect(out.weapons).toHaveLength(9);
  });
});

describe("aggregate: draws credit no winner (Task 15 gap: multi-survivor stalemate)", () => {
  it("does not credit any car a win when winnerSessionId is empty", () => {
    // Two matches: one mirage win, one a draw (either an explicit livingSides/deathmatchOutcome DRAW,
    // or `runMatch` hitting maxTicks with more than one seat still alive — both produce
    // `winnerSessionId: ""`, and neither should ever look like a win for either seat).
    const won = synthetic({ winnerSessionId: "a" });
    const drawn = synthetic({ winnerSessionId: "", hitClock: true });

    const out = aggregate([won, drawn]);

    const mirage = out.cars.find((c) => c.carId === "mirage")!;
    const bastion = out.cars.find((c) => c.carId === "bastion")!;

    expect(mirage.matches).toBe(2);
    expect(mirage.wins).toBe(1); // credited only by the won match, never by the draw
    expect(bastion.matches).toBe(2);
    expect(bastion.wins).toBe(0); // bastion never won either match, draw included
  });

  it("does not crash or double-count a draw with more than two seats still alive", () => {
    // A last-standing stalemate: three seats, nobody eliminated, maxTicks hit. `runMatch` reports
    // this the same way as any other draw — `winnerSessionId: ""` — regardless of how many seats
    // survived, so aggregate() must handle it as one ordinary (non-matchup) outcome.
    const stalemate = synthetic({
      winnerSessionId: "",
      hitClock: true,
      seats: [
        seat({ sessionId: "a", carId: "mirage", placement: 1 }),
        seat({ sessionId: "b", carId: "bastion", placement: 1 }),
        seat({ sessionId: "c", carId: "bullseye", placement: 1 }),
      ],
    });

    expect(() => aggregate([stalemate])).not.toThrow();
    const out = aggregate([stalemate]);
    expect(out.cars.every((c) => c.wins === 0)).toBe(true);
    expect(out.cars.reduce((sum, c) => sum + c.matches, 0)).toBe(3); // one appearance per seat, no double count
  });
});

describe("aggregate: pace counts every kill, attributable or not (fix round 3, defect 3)", () => {
  it("counts an unattributable kill in killsPerMinute even though no weapon can claim it", () => {
    // `stunned` has two appliers (`thunderclap` and `roadblock`), so `attributeSource` refuses to
    // guess and returns `weaponId: null` for it — the correct, honest call for `weaponKills`. Before
    // the fix, `totalKills` was incremented inside the same `if (weaponId === null) continue` guard
    // as `weaponKills`, so this kill vanished from `killsPerMinute` too, even though the match log
    // genuinely recorded a kill.
    const out = aggregate([
      synthetic({
        killed: [
          {
            tick: 30,
            victimSessionId: "b",
            victimCarId: "bastion",
            killerSessionId: "a",
            killerCarId: "mirage",
            source: { kind: "pulse", statusId: "stunned", sourceSessionId: "a" },
          },
        ],
      }),
    ]);
    // No weapon can claim credit for this kill...
    expect(out.weapons.every((w) => w.kills === 0)).toBe(true);
    // ...but the match still recorded one, and pace must say so.
    expect(out.pace.killsPerMinute).toBeGreaterThan(0);
  });
});

describe("aggregate: car stats", () => {
  it("computes phasedFraction as phased ticks over alive ticks (B28a)", () => {
    const out = aggregate([
      synthetic({
        seats: [
          seat({ sessionId: "a", carId: "mirage", aliveTicks: 100, phasedTicks: 25 }),
          seat({ sessionId: "b", carId: "bastion", aliveTicks: 100, phasedTicks: 0 }),
        ],
      }),
    ]);
    expect(out.cars.find((c) => c.carId === "mirage")!.phasedFraction).toBeCloseTo(0.25, 6);
    expect(out.cars.find((c) => c.carId === "bastion")!.phasedFraction).toBe(0);
  });

  it("sums damage dealt and taken straight off the events' own CarId fields", () => {
    const out = aggregate([
      synthetic({
        damaged: [
          dmg({ pressId: "a#1#0", weaponId: "magmablast", amount: 40, attackerCarId: "mirage", victimCarId: "bastion" }),
        ],
      }),
    ]);
    expect(out.cars.find((c) => c.carId === "mirage")!.damageDealt).toBe(40);
    expect(out.cars.find((c) => c.carId === "bastion")!.damageTaken).toBe(40);
  });
});

describe("aggregate: matchup matrix", () => {
  it("builds both ordered cells from one 2-seat match", () => {
    const out = aggregate([synthetic({ winnerSessionId: "a" })]); // mirage (a) beats bastion (b)
    const mirageOverBastion = out.matchups.find((m) => m.attacker === "mirage" && m.defender === "bastion")!;
    const bastionOverMirage = out.matchups.find((m) => m.attacker === "bastion" && m.defender === "mirage")!;
    expect(mirageOverBastion.winRate.n).toBe(1);
    expect(mirageOverBastion.winRate.rate).toBe(1);
    expect(bastionOverMirage.winRate.n).toBe(1);
    expect(bastionOverMirage.winRate.rate).toBe(0);
  });

  it("gives every chassis pair a cell, including the three mirrors (B26a)", () => {
    const out = aggregate([synthetic({})]);
    expect(out.matchups).toHaveLength(9); // 3x3 including mirrors
    expect(out.matchups.some((m) => m.attacker === "mirage" && m.defender === "mirage")).toBe(true);
  });
});

describe("aggregate: win-rate denominator is matches, not seats (fix round 2, defect 2)", () => {
  // One 2/2/2 field: two seats per chassis, exactly the composition B27 fixes the harness to. A
  // chassis that wins every match must read 100% — before the fix, `carMatches` incremented once
  // per SEAT rather than once per match, so a chassis holding two of six seats had its `matches`
  // count doubled and every win rate read exactly half of the true figure (evidence from the live
  // run: Mirage won all 3 of 3 matches and the table printed 50.0%, not 100%).
  const sixSeats = (winnerSessionId: string): readonly Seat[] => [
    seat({ sessionId: "m0", carId: "mirage", placement: winnerSessionId === "m0" ? 1 : 2 }),
    seat({ sessionId: "m1", carId: "mirage", placement: winnerSessionId === "m1" ? 1 : 2 }),
    seat({ sessionId: "y0", carId: "bullseye", placement: 3 }),
    seat({ sessionId: "y1", carId: "bullseye", placement: 4 }),
    seat({ sessionId: "b0", carId: "bastion", placement: 5 }),
    seat({ sessionId: "b1", carId: "bastion", placement: 6 }),
  ];

  it("reports 1.0, not 0.5, for a chassis that wins every match it appears in twice per match", () => {
    const outcomes = [
      synthetic({ winnerSessionId: "m0", seats: sixSeats("m0") }),
      synthetic({ winnerSessionId: "m1", seats: sixSeats("m1") }), // mirage's OTHER seat wins this one
      synthetic({ winnerSessionId: "m0", seats: sixSeats("m0") }),
    ];
    const out = aggregate(outcomes);
    const mirage = out.cars.find((c) => c.carId === "mirage")!;

    // Once per MATCH (3), never once per seat (would be 6) — the exact bug: two mirage seats in
    // every match must still only count as three matches, not six.
    expect(mirage.matches).toBe(3);
    expect(mirage.wins).toBe(3);
    expect(mirage.winRate.rate).toBe(1);

    // A chassis that never won still gets the same, correctly-doubled seat count in `matches` —
    // this is not "only mirage is special," the denominator fix applies uniformly.
    const bastion = out.cars.find((c) => c.carId === "bastion")!;
    expect(bastion.matches).toBe(3);
    expect(bastion.wins).toBe(0);
    expect(bastion.winRate.rate).toBe(0);
  });

  it("computes meanAliveSeconds per seat instance (appearance), not per match", () => {
    // Two mirage seats in ONE match with different survival times: the mean must be over the two
    // lives (an appearance-weighted average), not divided by the single match count — dividing by
    // `matches` here would double the reported figure.
    const out = aggregate([
      synthetic({
        seats: [
          seat({ sessionId: "m0", carId: "mirage", aliveTicks: 30 }),
          seat({ sessionId: "m1", carId: "mirage", aliveTicks: 90 }),
          seat({ sessionId: "b0", carId: "bastion", aliveTicks: 60 }),
        ],
      }),
    ]);
    const mirage = out.cars.find((c) => c.carId === "mirage")!;
    expect(mirage.matches).toBe(1);
    expect(mirage.meanAliveSeconds).toBeCloseTo((30 + 90) / 2 / TICK_RATE_HZ, 6);
  });
});
